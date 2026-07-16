// Graph3D 布局 Tab demo —— 共享类型与控件构造工具。
// 4 个布局 Tab（circular/force/hex/grid）各实现 LayoutTab，由 demo.ts 编排切换。
// 控件标记严格沿用 docs/style.css 的 .demo-ctrl 约定（经 :is(.demo-ctrl,.demo-tabs) 复用）。

import type { Graph3D } from '../../../../src/graph/Graph3D';
import type { LayoutPreset, LayoutType } from '../../../../src/graph/layouts/types';
import type { GraphData, EdgeData } from '../../../../src/graph/types';

export type EdgeMode = 'line' | 'path' | 'mixed';

/**
 * 生成一份随机连通图数据（约 n 个节点、随机边）。
 * 每个节点带 `group` 字段（`g0/g1/g2`）供环形/蜂巢的「分组分层」演示。
 */
export function randomGraph(n: number, edgeMode: EdgeMode): GraphData {
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    group: `g${i % 3}`, // 分组分层演示用
  }));
  const edges: EdgeData[] = [];
  // 先连成一条骨架链保证连通，再加若干随机边。
  for (let i = 1; i < n; i++) edges.push({ source: `n${i - 1}`, target: `n${i}` });
  for (let k = 0; k < n; k++) {
    const a = (Math.random() * n) | 0;
    const b = (Math.random() * n) | 0;
    if (a !== b) edges.push({ source: `n${a}`, target: `n${b}` });
  }
  // 按当前边形态模式给每条边打 type。
  for (const e of edges) {
    if (edgeMode === 'line') e.type = 'line';
    else if (edgeMode === 'path') e.type = 'path';
    else e.type = Math.random() < 0.5 ? 'line' : 'path';
  }
  return { nodes, edges };
}

/**
 * 各布局 Tab 共享的运行时上下文。
 * - `graph`：跨 Tab 持久的 Graph3D 实例（切 Tab 只 setLayout 重排，不重建）。
 * - `apply`：统一封装 setLayout —— 默认读全局 animate 开关、附带坐标读数刷新回调；
 *   `instant:true` 表示即时（无动画，用于滑块拖动实时响应）。
 * - `randomGraph`：用当前全局边形态生成示例数据。
 */
export interface LayoutTabContext {
  graph: Graph3D;
  apply: (preset: LayoutPreset, opts?: { instant?: boolean; duration?: number }) => void;
  randomGraph: (n: number) => GraphData;
}

/** 每个布局 Tab 实现：在 host 渲染本布局专属控件，返回解绑清理函数。 */
export interface LayoutTab {
  type: LayoutType;
  label: string;
  mount(host: HTMLElement, ctx: LayoutTabContext): () => void;
}

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** 实时拖动（input 事件）回调。 */
  onInput?: (v: number) => void;
  /** 释放（change 事件）回调。 */
  onCommit?: (v: number) => void;
  /** 值显示格式化（默认保留 2 位）。 */
  format?: (v: number) => string;
}

/**
 * 构造一条 house-style 滑块：`<label><span>label: <code>v</code></span><input type="range">`。
 * 沿用 .demo-ctrl label 的列布局与 range 轨道/滑块样式。
 */
export function slider(opts: SliderOpts): HTMLLabelElement {
  const fmt = opts.format ?? ((v) => v.toFixed(2));
  const wrap = document.createElement('label');
  const span = document.createElement('span');
  span.innerHTML = `${opts.label}: <code>${fmt(opts.value)}</code>`;
  const code = span.querySelector('code')!;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.value = String(opts.value);
  input.addEventListener('input', () => {
    const v = +input.value;
    code.textContent = fmt(v);
    opts.onInput?.(v);
  });
  input.addEventListener('change', () => opts.onCommit?.(+input.value));
  wrap.appendChild(span);
  wrap.appendChild(input);
  return wrap;
}

/** 构造一条 house-style 下拉：`<label><span>label:</span><select>...</select>`。 */
export function select<T extends string>(
  opts: { label: string; value: T; options: Array<{ value: T; label: string }> },
  onChange: (v: T) => void,
): HTMLLabelElement {
  const wrap = document.createElement('label');
  const span = document.createElement('span');
  span.textContent = `${opts.label}:`;
  const sel = document.createElement('select');
  for (const o of opts.options) {
    const op = document.createElement('option');
    op.value = o.value;
    op.textContent = o.label;
    if (o.value === opts.value) op.selected = true;
    sel.appendChild(op);
  }
  sel.addEventListener('change', () => onChange(sel.value as T));
  wrap.appendChild(span);
  wrap.appendChild(sel);
  return wrap;
}

/** 构造一条 house-style 复选框：`<label class="check"><input type="checkbox">label</label>`。 */
export function check(
  label: string,
  checked: boolean,
  onChange: (v: boolean) => void,
): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = 'check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  wrap.appendChild(input);
  wrap.append(label);
  return wrap;
}

/** 构造一条状态说明 `<p>`，返回元素与 set(html) 更新器。 */
export function statusLine(initial = ''): { el: HTMLParagraphElement; set: (html: string) => void } {
  const p = document.createElement('p');
  p.className = 'info';
  p.innerHTML = initial;
  return { el: p, set: (html) => (p.innerHTML = html) };
}
