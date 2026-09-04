/**
 * gen-component-docs.mjs
 *
 * 把 docs/components/<name>/index.html（手写结构化文档）解析成
 * docs/components.json（机器可读），供 opencode 的 list_3d_components /
 * get_3d_component_doc 工具消费。只装组件 API 事实：name/summary/importPath/
 * extends/constructor/options/dataTypes/properties/methods/examples。
 *
 * 跑法：node scripts/gen-component-docs.mjs（3d-components 仓库根）。
 * 零依赖：纯 node fs + 字符串切分。模板稳定（class 名固定 page/tag/desc/sig/pt/method），
 * 唯一有嵌套的是 div.method（内含 div.sig），靠"按 <div class="method"> 切分 + 叶子非贪婪"处理。
 *
 * 组件收集（无 allowlist）：扫描 docs/components 下各子目录的 index.html，页面 tag 区写了
 *   <span class="tag">import <code>@a3d/a3d-components/<domain></code></span>
 * 才进 catalog——这一行是「公开可创建组件」的声明位，与组件知识同源。
 * 无 import tag 的页面 = 参考文档（utils/材质/控制器等非 Object3D 子类），跳过。
 *
 * 新增组件时：1) 写 docs/components/<name>/index.html（遵循同模板）；
 * 2) 页面 tag 区加 import tag 行。无需改本脚本。
 */
/* eslint-disable no-console -- CLI 构建脚本，console 是唯一进度输出手段 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const docsComponentsDir = join(repoRoot, 'docs', 'components');
const outFile = join(repoRoot, 'docs', 'components.json');

// import tag 域（core/heat/material）= @a3d/a3d-components 子模块，barrel 导出全部组件类
const IMPORT_TAG_RE = /<span class="tag">import\s*<code>([\s\S]*?)<\/code><\/span>/;

// ── 基础工具 ──

const decodeEntities = (s) => s
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, '\'')
  .replace(/&apos;/g, '\'')
  .replace(/&nbsp;/g, ' ')
  // &amp; 最后，避免双重解码
  .replace(/&amp;/g, '&');

const stripTags = (s) => decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

const firstMatch = (s, re) => {
  const m = s.match(re);
  return m ? m[1] : '';
};

const allMatches = (s, re) => {
  const out = [];
  let m;
  while ((m = re.exec(s))) {
    out.push(m[1]);
  }
  return out;
};

// ── 表格行解析 ──

const parseRows = (tbl, arity) => {
  const rows = [];
  for (const tr of allMatches(tbl, /<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = allMatches(tr, /<td[^>]*>([\s\S]*?)<\/td>/g).map(stripTags);
    if (cells.length >= arity) {
      rows.push(cells);
    }
  }
  return rows;
};

// 4 列（参数/字段：name,type,default,description）
const parseRows4 = (tbl) => parseRows(tbl, 4).map((c) => ({
  name: c[0],
  type: c[1],
  default: c[2],
  description: c[3],
}));

// 3 列（属性：name,type,description）
const parseRows3 = (tbl) => parseRows(tbl, 3).map((c) => ({ name: c[0], type: c[1], description: c[2] }));

// dataTypes 表列数不统一：3 列（字段/类型/说明，无默认值，如 HeatMapPoint/HeatMapData）
// 或 4 列（参数/类型/默认值/说明，如 PathData/WallData）。先试 4 列，空则回退 3 列。
const parseDataTable = (tbl) => {
  const rows4 = parseRows(tbl, 4);
  if (rows4.length > 0) {
    return rows4.map((c) => ({
      name: c[0], type: c[1], default: c[2], description: c[3],
    }));
  }
  return parseRows(tbl, 3).map((c) => ({
    name: c[0], type: c[1], default: '—', description: c[2],
  }));
};

// ── 单组件解析 ──

const parseComponent = (dir) => {
  const file = join(docsComponentsDir, dir, 'index.html');
  const html = readFileSync(file, 'utf-8');

  // head = 第一个 <div class="method"> 之前的全部（含 h2/desc/extends/构造 sig/参数表/属性表）
  // methods = 各 <div class="method"> 之后的块（每个含 .sig + p）
  const parts = html.split('<div class="method">');
  const head = parts[0];

  // import tag = 公开可创建组件声明；无 tag = 参考文档，跳过（正常路径，非告警）
  const importPath = stripTags(firstMatch(html, IMPORT_TAG_RE));
  if (!importPath) {
    console.log(`[gen] - ${dir}: 无 import tag（参考文档），跳过`);
    return null;
  }

  // 组件名以页面 <h2> 为准（单一来源，目录名不再参与命名）
  const name = stripTags(firstMatch(head, /<h2[^>]*>([\s\S]*?)<\/h2>/));
  if (!name) {
    console.warn(`[gen] ! ${dir}: 缺少 <h2> 组件名，跳过`);
    return null;
  }

  const summary = stripTags(firstMatch(head, /<p class="desc">([\s\S]*?)<\/p>/));
  const extends_ = stripTags(firstMatch(head, /<span class="tag">extends\s*<code>([\s\S]*?)<\/code><\/span>/));
  // 构造签名 = head 里第一个 div.sig（无嵌套 div，非贪婪到首个 </div> 安全）
  const constructor = stripTags(firstMatch(head, /<div class="sig">([\s\S]*?)<\/div>/));

  // 参数表：head 里每个 <h4> + 紧跟的 <table class="pt">。第一个 = options，其余 = dataTypes
  const h4Chunks = head.split('<h4').slice(1).map((c) => `<h4${ c}`);
  const paramTables = [];
  for (const chunk of h4Chunks) {
    // 只取「当前 h4 到第一个 <h3> 之前」的内容。否则 HeatMapGradient 这类「h4 后跟
    // <pre><code> 代码块而非 table」的段落会越界匹配到后面 Properties 的 table（h3 之后）。
    const h3Seg = chunk.match(/^([\s\S]*?)<h3/);
    const seg = h3Seg ? h3Seg[1] : chunk;
    const tbl = firstMatch(seg, /<table class="pt">([\s\S]*?)<\/table>/);
    if (tbl) {
      const beforeTable = seg.split('<table')[0];
      // 类型名优先取 h4 里的 <code>（如 "Parameters — <code>HeatMapOptions</code>"）；
      // 无 <code> 的纯文本 h4（如 "<h4>HeatMapPoint</h4>"）取去标签后的 h4 文本。
      let typeName = stripTags(firstMatch(beforeTable, /<code>([\s\S]*?)<\/code>/));
      if (!typeName) {
        typeName = stripTags(beforeTable).replace(/^Parameters\s*[—-]\s*/, '').trim();
      }
      paramTables.push({ name: typeName || '(unnamed)', table: tbl });
    }
    // 无 table 的 h4（如 HeatMapGradient 用 pre 代码块表示类型）→ 不进 dataTypes，跳过，
    // 其代码块已被下方 examples 抓取。
  }
  const options = paramTables.length > 0 ? parseRows4(paramTables[0].table) : [];
  const dataTypes = paramTables.slice(1).map((t) => ({ name: t.name, fields: parseDataTable(t.table) }));

  // 属性表：<h3>Properties</h3> 到下一个 <h3> 之间的 table（3 列）
  let properties = [];
  const propSeg = firstMatch(head, /<h3[^>]*>\s*Properties\s*<\/h3>([\s\S]*?)(?=<h3|$)/);
  if (propSeg) {
    properties = parseRows3(firstMatch(propSeg, /<table class="pt">([\s\S]*?)<\/table>/));
  }

  // 方法：parts[1..] 每块 = 一个 method 的内容（到下一个 <div class="method">）
  const methods = [];
  for (let i = 1; i < parts.length; i++) {
    const blk = parts[i];
    const sig = stripTags(firstMatch(blk, /<div class="sig">([\s\S]*?)<\/div>/));
    const desc = stripTags(firstMatch(blk, /<p>([\s\S]*?)<\/p>/));
    if (sig) {
      methods.push({ signature: sig, description: desc });
    }
  }

  // 示例：全文所有 <pre><code>…</code></pre>（code 不嵌套，非贪婪安全）
  const examples = allMatches(
    html,
    /<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g,
  ).map((c) => decodeEntities(c).replace(/\r\n/g, '\n').trim());

  return {
    name,
    summary,
    importPath,
    extends: extends_,
    constructor,
    options,
    dataTypes,
    properties,
    methods,
    examples,
  };
};

// ── 主流程 ──

const main = () => {
  const out = [];
  const dirs = readdirSync(docsComponentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  for (const dir of dirs) {
    try {
      const doc = parseComponent(dir);
      if (doc) {
        out.push(doc);
        console.log(`[gen] ✓ ${doc.name}: ${doc.options.length} options, ${doc.dataTypes.length} dataTypes, ` +
            `${doc.properties.length} properties, ${doc.methods.length} methods, ${doc.examples.length} examples`);
      }
    } catch (e) {
      console.error(`[gen] ${dir} 解析失败:`, e.message);
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(outFile, `${JSON.stringify(out, null, 2) }\n`, 'utf-8');
  console.log(`[gen] 写入 ${outFile}（${out.length} 个组件）`);
};

main();
