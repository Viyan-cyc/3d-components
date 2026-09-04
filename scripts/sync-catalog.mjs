#!/usr/bin/env node
/**
 * sync-catalog.mjs — 「新组件接 LLM」一键同步（三步机械链）
 *
 * 何时跑：在 3d-components 加完新组件后（写源码 src/<domain>/、写文档页
 * docs/components/<name>/index.html 含 <h2>+import tag、barrel index.ts 已导出），
 * 在 3d-components 根跑 `npm run sync:catalog`。
 *
 * 做三步（每步失败即中止，非零退出）：
 *   1. gen:component-docs   —— 解析 docs/components 下各 index.html → docs/components.json
 *   2. bun install          —— UXAI 同步 file 依赖（@a3d/a3d-components 拷贝进 node_modules/.bun）
 *   3. gen:component-catalog —— opencode 读 components.json 重新烘焙 COMPONENT_CATALOG.txt
 *      （这是 plan prompt 的 {COMPONENT_CATALOG} 目录注入源，静态产物非运行时 docCache）
 *
 * 最后仍须手动：重启 opencode 进程 —— .txt 都是 import 时读、docCache 是模块级缓存，
 * 不重启 process 级缓存不失效，新组件不会对 LLM 可见。
 *
 * 跨平台：纯 node fs + child_process；本脚本与 UXAI 仓的相对位置固定（3d-components 与
 * UXAI 同级，opencode 在 UXAI/packages/opencode），用 import.meta.url 定位，不依赖 cwd。
 */
/* eslint-disable no-console -- 同步脚本，console 即唯一进度输出 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const compRoot = resolve(__dirname, '..');
const uxaiRoot = resolve(__dirname, '..', '..', 'UXAI');
const opencodeRoot = resolve(uxaiRoot, 'packages', 'opencode');

const fail = (msg, code = 1) => {
  console.error(msg);
  process.exit(code);
};

// node 脚本：用 process.execPath（本进程 node 绝对路径），免 shell。
const runNode = (label, script, cwd) => {
  console.log(`\n[${label}] node ${script}`);
  console.log(`  cwd: ${cwd}`);
  const r = spawnSync(process.execPath, [script], { cwd, stdio: 'inherit' });
  if (r.error) {
    fail(`[${label}] 启动失败: ${r.error.message}`);
  }
  if (r.status !== 0) {
    fail(`[${label}] 失败（退出码 ${r.status}），中止后续步骤。`, r.status ?? 1);
  }
};

// PATH 命令（bun）：单字符串 + shell —— Windows 下 bun 是 npm shim 需 shell 解析（cmd 找 bun.cmd/bun），
// Unix 下 shell 也是 sh -c。刻意传整串而非 (cmd, args[])：既省转义，又避开 Node DEP0190
// （shell:true 时传 args 数组的拼接注入告警）。命令是硬编码常量，无用户输入，无注入面。
const runCmd = (label, commandLine, cwd) => {
  console.log(`\n[${label}] ${commandLine}`);
  console.log(`  cwd: ${cwd}`);
  const r = spawnSync(commandLine, { cwd, stdio: 'inherit', shell: true });
  if (r.error) {
    fail(`[${label}] 启动失败: ${r.error.message}`);
  }
  if (r.status !== 0) {
    fail(`[${label}] 失败（退出码 ${r.status}），中止后续步骤。`, r.status ?? 1);
  }
};

if (!existsSync(uxaiRoot)) {
  fail(`未找到 UXAI 仓（期望 ${uxaiRoot}）。本脚本假设 3d-components 与 UXAI 同级目录，` +
      '目录结构不同则不能直接用。');
}

runNode('gen:component-docs', 'scripts/gen-component-docs.mjs', compRoot);

runCmd('bun install', 'bun install', uxaiRoot);

runCmd('gen:component-catalog', 'bun run gen:component-catalog', opencodeRoot);

console.log('\n✅ 三步同步完成。');
console.log('   最后一步（手动）: 重启 opencode 进程，docCache + .txt 才会重新加载，新组件才对 LLM 可见。');
