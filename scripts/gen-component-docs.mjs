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
 * 公开 Object3D 组件用 allowlist（3d-components 自己的公开 API 面）。新增组件时：
 * 1) 写 docs/components/<name>/index.html（遵循同模板）；2) 把名字加进下面 COMPONENTS。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const docsComponentsDir = join(repoRoot, 'docs', 'components');
const outFile = join(repoRoot, 'docs', 'components.json');

// 公开 Object3D 组件 API（均在 core 子路径）。dir = name.toLowerCase()。
const COMPONENTS = [
  'Wall',
  'Shape',
  'Grid',
  'Path',
  'Outlines',
  'Wireframe',
  'BitmapText',
  'Html',
  'Sky',
  'InstancedMesh2',
];
const IMPORT_PATH = '@a3d/a3d-components/core';

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

// ── 单组件解析 ──

const parseComponent = (name) => {
  const file = join(docsComponentsDir, name.toLowerCase(), 'index.html');
  if (!existsSync(file)) {
    console.warn(`[gen] 缺少 ${file}，跳过 ${name}`);
    return null;
  }
  const html = readFileSync(file, 'utf-8');

  // head = 第一个 <div class="method"> 之前的全部（含 h2/desc/extends/构造 sig/参数表/属性表）
  // methods = 各 <div class="method"> 之后的块（每个含 .sig + p）
  const parts = html.split('<div class="method">');
  const head = parts[0];

  const h2 = stripTags(firstMatch(head, /<h2[^>]*>([\s\S]*?)<\/h2>/));
  if (h2 && h2 !== name) {
    console.warn(`[gen] ${name}: h2 实际为 "${h2}"，与 allowlist 不符`);
  }
  const summary = stripTags(firstMatch(head, /<p class="desc">([\s\S]*?)<\/p>/));
  const extends_ = stripTags(firstMatch(head, /<span class="tag">extends\s*<code>([\s\S]*?)<\/code><\/span>/));
  // 构造签名 = head 里第一个 div.sig（无嵌套 div，非贪婪到首个 </div> 安全）
  const constructor = stripTags(firstMatch(head, /<div class="sig">([\s\S]*?)<\/div>/));

  // 参数表：head 里每个 <h4> + 紧跟的 <table class="pt">。第一个 = options，其余 = dataTypes
  const h4Chunks = head.split('<h4').slice(1).map((c) => `<h4${ c}`);
  const paramTables = [];
  for (const chunk of h4Chunks) {
    const tbl = firstMatch(chunk, /<table class="pt">([\s\S]*?)<\/table>/);
    if (tbl) {
      const beforeTable = chunk.split('<table')[0];
      const typeName = stripTags(firstMatch(beforeTable, /<code>([\s\S]*?)<\/code>/));
      paramTables.push({ name: typeName || '(unnamed)', fields: parseRows4(tbl) });
    } else {
      console.warn(`[gen] ${name}: 某 h4 后无 table，跳过该表`);
    }
  }
  const options = paramTables.length > 0 ? paramTables[0].fields : [];
  const dataTypes = paramTables.slice(1);

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
    importPath: IMPORT_PATH,
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
  for (const name of COMPONENTS) {
    try {
      const doc = parseComponent(name);
      if (doc) {
        out.push(doc);
        console.log(`[gen] ✓ ${name}: ${doc.options.length} options, ${doc.dataTypes.length} dataTypes, ` +
            `${doc.properties.length} properties, ${doc.methods.length} methods, ${doc.examples.length} examples`);
      }
    } catch (e) {
      console.error(`[gen] ${name} 解析失败:`, e.message);
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(outFile, `${JSON.stringify(out, null, 2) }\n`, 'utf-8');
  console.log(`[gen] 写入 ${outFile}（${out.length} 个组件）`);
};

main();
