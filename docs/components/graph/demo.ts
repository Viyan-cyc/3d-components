import * as THREE from 'three';
import { Graph3D } from '../../../src/graph/Graph3D';
import { PickController } from '../../../src/graph/interaction/PickController';
import { Layouts } from '../../../src/graph/layouts';
import type { LayoutFn, BaseLayoutConfig, LayoutPreset } from '../../../src/graph/layouts/types';
import type { GraphData, EdgeData } from '../../../src/graph/types';
import { createScene, createGround, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- Graph3D Demo（第五步交付）----
// 演示：边多形态（line / path 带箭头 / 混合）+ PickController 交互拾取（Step 2）
//      + 核心布局：环形 3D 化、3D 力导向（Step 3）
//      + 扩展布局：六边形蜂巢、网格（Step 4）
//      + 统一声明式布局 API（setLayout，setData 自动编排）+ Barnes-Hut 大图加速（Step 5）。
// 布局经 graph.setLayout(preset, { animate }) 切换并被记忆；setData 后自动重应用。
// 力导向可开 Barnes-Hut（八叉树 O(n log n)），切到大节点数时显示耗时；并对各布局做纯函数独立性自检。

type EdgeMode = 'line' | 'path' | 'mixed';
type LayoutKind =
  | 'placeholder'
  | 'circle-xz'
  | 'circle-xy'
  | 'circle-rings'
  | 'circle-group'
  | 'force-3d'
  | 'force-2d'
  | 'hex'
  | 'hex-layers'
  | 'grid'
  | 'grid-3d';

/** 生成一份随机连通图数据（约 n 个节点、随机边）。每个节点带 group 字段供分组分层演示。 */
function randomGraph(n: number, edgeMode: EdgeMode): GraphData {
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `n${i}`,
    group: `g${i % 3}`, // 分组分层（circle-group）演示用
  }));
  const edges: EdgeData[] = [];
  // 先连成一条骨架链保证连通，再加若干随机边
  for (let i = 1; i < n; i++) {
    edges.push({ source: `n${i - 1}`, target: `n${i}` });
  }
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

export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  camera.position.set(7, 5.5, 9);
  camera.lookAt(0, 0, 0);

  // 统一地面（遵循 demo style guide：无 GridHelper，用 createGround）
  scene.add(createGround());

  // 材质「模板」：每个节点/边构造时 clone 一份独立实例，单独改某元素不影响其它。
  const nodeMaterialTemplate = new THREE.MeshStandardMaterial({
    color: 0x4a90e2,
    roughness: 0.35,
    metalness: 0.2,
  });
  const edgeMaterialTemplate = new THREE.MeshStandardMaterial({
    color: 0x9aa7b8,
    roughness: 0.6,
    metalness: 0.1,
  });

  const graph = new Graph3D({
    nodeSize: 0.35,
    nodeMaterial: nodeMaterialTemplate,
    edgeMaterial: edgeMaterialTemplate,
    edgeType: 'line',
    edgePathRadius: 0.05,
    edgeArrow: true,
    initialRadius: 3.5,
  });
  scene.add(graph);

  // 节点数量 & 边形态 & 布局
  let count = 12;
  let edgeMode: EdgeMode = 'line';
  let currentLayout: LayoutKind = 'placeholder';
  let ringsCount = 3;
  let levelsCount = 2;
  let animateLayout = true;
  let barnesHut = false; // Step 5：力导向 Barnes-Hut 开关
  graph.setData(randomGraph(count, edgeMode));

  addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 0, 0));

  // PickController：拾取 + 内置反馈 + 事件回调。
  const pick = new PickController({
    domElement: canvas,
    graph,
    camera,
    selectionMode: 'single',
    onHover: (e) => setStatus(`hover <code>${e.kind}</code> · <code>${e.id}</code>`, false),
    onSelect: (e) => {
      setStatus(
        `${e.type} <code>${e.kind}</code> · <code>${e.id}</code> · ${selectionSummary()}`,
        true,
      );
    },
  });

  const loop = startLoop(renderer, scene, camera, resize, (dt) => {
    graph.update(dt);
    pick.update(dt);
  });

  // ---- 布局应用 ----
  function fmt(v: number): string {
    return Number.isFinite(v) ? v.toFixed(2) : 'NaN';
  }

  /** 把首 3 个节点坐标写入坐标读数条（坐标输出验证）。 */
  function showCoords(): void {
    const ns = graph.getNodes();
    const sample = ns
      .slice(0, 3)
      .map((nd) => {
        const p = nd.position;
        return `<code>${nd.nodeId}</code>(${fmt(p.x)}, ${fmt(p.y)}, ${fmt(p.z)})`;
      })
      .join('  ');
    coordsEl.innerHTML = `采样坐标 · ${sample}`;
  }

  /**
   * 纯函数独立性自检：绕过 Graph3D 直接调用某个布局函数，断言全部输出为有限值。
   * 落实 DESIGN.md §1.1「Layout 层可独立调用」的验证 —— 对 force/hex/grid 等均生效。
   */
  function checkLayout<C extends BaseLayoutConfig>(
    fn: LayoutFn<C>,
    cfg: C,
    label: string,
  ): void {
    const data = graph.getData();
    if (!data || data.nodes.length === 0) return;
    // 力导向需边；其余布局忽略此字段。调用者显式 edges 优先，否则注入当前图边。
    const explicit = (cfg as { edges?: Array<{ source: unknown; target: unknown }> }).edges;
    const edges =
      explicit ?? data.edges.map((e) => ({ source: e.source, target: e.target }));
    const out = fn(data.nodes, { ...cfg, edges } as C);
    const allFinite = out.every(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z),
    );
    console.log(
      `[graph] ${label} 纯函数自检：`,
      allFinite ? '✓ 全部有限' : '✗ 含 NaN/Infinity',
      out.slice(0, 3),
    );
  }

  /**
   * 把 {@link LayoutKind} 解析为声明式 {@link LayoutPreset}（Step 5）。
   *
   * `placeholder` 返回 `null`（清除布局，退回占位散布）；力导向读 `barnesHut` 开关注入
   * `barnesHut:true`。其余配置与 Step 3/4 的 applyLayout 调用一一对应。
   */
  function presetFor(kind: LayoutKind): LayoutPreset | null {
    switch (kind) {
      case 'placeholder':
        return null;
      case 'circle-xz':
        return { type: 'circular', config: { radius: 3.5, plane: 'xz' } };
      case 'circle-xy':
        return { type: 'circular', config: { radius: 3.5, plane: 'xy' } };
      case 'circle-rings':
        return {
          type: 'circular',
          config: { radius: 1.8, plane: 'xz', rings: ringsCount, radiusStep: 1.1, layerSpacing: 1.6 },
        };
      case 'circle-group':
        return {
          type: 'circular',
          config: { radius: 2.4, plane: 'xz', groupBy: 'group', radiusStep: 0.6, layerSpacing: 1.8 },
        };
      case 'force-3d':
        return {
          type: 'force',
          config: { dimensions: 3, iterations: 300, barnesHut, theta: 0.9 },
        };
      case 'force-2d':
        return { type: 'force', config: { dimensions: 2, plane: 'xz', iterations: 300 } };
      case 'hex':
        return { type: 'hex', config: { radius: 1.3, plane: 'xz', orientation: 'flat' } };
      case 'hex-layers':
        return {
          type: 'hex',
          config: { radius: 1.3, plane: 'xz', layers: levelsCount, layerSpacing: 2.4 },
        };
      case 'grid':
        return { type: 'grid', config: { spacingX: 1.3, spacingZ: 1.3 } };
      case 'grid-3d':
        return {
          type: 'grid',
          config: { levels: levelsCount, spacingX: 1.3, spacingY: 2.4, spacingZ: 1.3 },
        };
    }
  }

  function applyLayoutKind(kind: LayoutKind): void {
    const preset = presetFor(kind);
    // 力导向做纯函数自检 + 耗时计时（大图时可见 Barnes-Hut 提速）；其余布局亦做有限性自检。
    if (preset) {
      const fn = ({
        circular: Layouts.circular,
        force: Layouts.force,
        hex: Layouts.hex,
        grid: Layouts.grid,
      } as Record<string, LayoutFn<BaseLayoutConfig>>)[preset.type];
      const label =
        kind === 'force-3d'
          ? barnesHut
            ? 'Layouts.force(3D+BarnesHut)'
            : 'Layouts.force(3D)'
          : `Layouts.${preset.type}`;
      const t0 = performance.now();
      checkLayout(fn, preset.config as BaseLayoutConfig, label);
      const ms = performance.now() - t0;
      if (kind === 'force-3d') {
        perfEl.innerHTML = `力导向计算耗时 <code>${ms.toFixed(0)}ms</code> · Barnes-Hut <code>${barnesHut ? '开' : '关'}</code>`;
      }
    }
    // 声明式切换：setLayout 记忆预设，setData 后自动重应用（Step 5 核心）。
    graph.setLayout(preset, { animate: animateLayout, duration: kind === 'force-3d' ? 0.9 : 0.7, onComplete: showCoords });
  }

  // ---- 控制面板 ----
  ctrl.innerHTML = `
    <button id="btn-g-rebuild">重新生成随机图</button>
    <button id="btn-g-clear">清除选中</button>
    <label><span>节点数: <code id="v-g-count">12</code></span>
    <input type="range" id="inp-g-count" min="3" max="2000" step="1" value="12"></label>
    <label><span>边形态:</span>
    <select id="sel-g-edge">
      <option value="line">全直线</option>
      <option value="path">全管道(带箭头)</option>
      <option value="mixed">混合</option>
    </select></label>
    <fieldset class="g-fb" style="border:1px solid #d0d6de;padding:4px 8px;margin:4px 0">
      <legend style="font-size:12px">布局 (Step 3-5)</legend>
      <label><span>布局类型:</span>
      <select id="sel-g-layout">
        <option value="placeholder">占位环形(xz)</option>
        <option value="circle-xz">环形 · 地面 xz</option>
        <option value="circle-xy">环形 · 立面 xy</option>
        <option value="circle-rings">同心多环(xz)</option>
        <option value="circle-group">分组分层(xz)</option>
        <option value="force-3d">力导向 · 3D</option>
        <option value="force-2d">力导向 · 2D(xz)</option>
        <option value="hex">六边形蜂巢(xz)</option>
        <option value="hex-layers">蜂巢 · 多层堆叠</option>
        <option value="grid">网格 · 地面(xz)</option>
        <option value="grid-3d">网格 · 三维(levels)</option>
      </select></label>
      <label><span>同心环数: <code id="v-g-rings">3</code></span>
      <input type="range" id="inp-g-rings" min="1" max="6" step="1" value="3"></label>
      <label><span>层数(蜂巢/网格): <code id="v-g-levels">2</code></span>
      <input type="range" id="inp-g-levels" min="2" max="5" step="1" value="2"></label>
      <label><input type="checkbox" id="cb-g-bh"> Barnes-Hut(力导向 O(n log n)，大图加速)</label>
      <label><input type="checkbox" id="cb-g-anim" checked> 过渡动画</label>
    </fieldset>
    <fieldset class="g-fb" style="border:1px solid #d0d6de;padding:4px 8px;margin:4px 0">
      <legend style="font-size:12px">选中模式</legend>
      <label><input type="radio" name="g-selmode" value="single" checked> 单选(互斥)</label>
      <label><input type="radio" name="g-selmode" value="multiple"> 多选(累加)</label>
    </fieldset>
    <fieldset class="g-fb" style="border:1px solid #d0d6de;padding:4px 8px;margin:4px 0">
      <legend style="font-size:12px">内置反馈</legend>
      <label><input type="checkbox" id="cb-hov" checked> 悬停(节点放大+边发光)</label>
      <label><input type="checkbox" id="cb-sel" checked> 选中(常亮)</label>
      <label><input type="checkbox" id="cb-nbr" checked> 邻边高亮(只提亮邻接边)</label>
    </fieldset>
    <p class="desc" id="g-status" style="font-size:12px;margin:2px 0"></p>
    <p class="desc" id="g-perf" style="font-size:12px;margin:2px 0;color:#5a6473"></p>
    <p class="desc" id="g-coords" style="font-size:12px;margin:2px 0;color:#5a6473"></p>`;

  const countLabel = ctrl.querySelector('#v-g-count')!;
  const status = ctrl.querySelector('#g-status')!;
  const coordsEl = ctrl.querySelector('#g-coords')!;
  const edgeSelect = ctrl.querySelector('#sel-g-edge') as HTMLSelectElement;
  const layoutSelect = ctrl.querySelector('#sel-g-layout') as HTMLSelectElement;
  const ringsLabel = ctrl.querySelector('#v-g-rings')!;
  const levelsLabel = ctrl.querySelector('#v-g-levels')!;
  const perfEl = ctrl.querySelector('#g-perf')!;

  let statusSticky = false;
  function setStatus(html: string, sticky: boolean) {
    statusSticky = sticky;
    status.innerHTML = html;
  }
  function selectionSummary(): string {
    const n = pick.getSelectedNodes();
    const ed = pick.getSelectedEdges();
    const parts: string[] = [];
    parts.push(`节点[${n.length}]${n.length ? ':' + n.join(',') : ''}`);
    parts.push(`边[${ed.length}]`);
    return parts.join(' · ');
  }
  function renderStatus() {
    status.innerHTML = `节点 <code>${graph.getNodes().length}</code> · 边 <code>${graph.getEdges().length}</code> · ${selectionSummary()}`;
  }
  renderStatus();
  showCoords();

  const rebuild = () => {
    graph.setData(randomGraph(count, edgeMode));
    countLabel.textContent = String(count);
    setStatus('', false);
    renderStatus();
    // Step 5：布局已被 setLayout 记忆，setData 内部自动重应用 —— 无需此处再 applyLayout。
    // 仅占位布局（未声明 preset）需要刷新坐标读数。
    if (currentLayout === 'placeholder') showCoords();
  };

  ctrl.querySelector('#btn-g-rebuild')!.addEventListener('click', rebuild);
  // 演示开发者主动调用 clearSelection() 口子（点击空白/地面也会内部触发）。
  ctrl.querySelector('#btn-g-clear')!.addEventListener('click', () => {
    pick.clearSelection();
    renderStatus();
  });
  ctrl.querySelector('#inp-g-count')!.addEventListener('input', (e) => {
    count = +(e.target as HTMLInputElement).value;
    countLabel.textContent = String(count);
  });
  ctrl.querySelector('#inp-g-count')!.addEventListener('change', rebuild);
  edgeSelect.addEventListener('change', (e) => {
    edgeMode = (e.target as HTMLSelectElement).value as EdgeMode;
    rebuild();
  });

  // 布局切换。
  layoutSelect.addEventListener('change', (e) => {
    currentLayout = (e.target as HTMLSelectElement).value as LayoutKind;
    applyLayoutKind(currentLayout);
  });
  ctrl.querySelector('#inp-g-rings')!.addEventListener('input', (e) => {
    ringsCount = +(e.target as HTMLInputElement).value;
    ringsLabel.textContent = String(ringsCount);
  });
  ctrl.querySelector('#inp-g-rings')!.addEventListener('change', () => {
    if (currentLayout === 'circle-rings') applyLayoutKind(currentLayout);
  });
  ctrl.querySelector('#inp-g-levels')!.addEventListener('input', (e) => {
    levelsCount = +(e.target as HTMLInputElement).value;
    levelsLabel.textContent = String(levelsCount);
  });
  ctrl.querySelector('#inp-g-levels')!.addEventListener('change', () => {
    if (currentLayout === 'hex-layers' || currentLayout === 'grid-3d') applyLayoutKind(currentLayout);
  });
  ctrl.querySelector('#cb-g-anim')!.addEventListener('change', (e) => {
    animateLayout = (e.target as HTMLInputElement).checked;
  });
  // Step 5：Barnes-Hut 开关（仅影响 3D 力导向；切换后若当前是 force-3d 则重应用以观测耗时变化）。
  ctrl.querySelector('#cb-g-bh')!.addEventListener('change', (e) => {
    barnesHut = (e.target as HTMLInputElement).checked;
    if (currentLayout === 'force-3d') applyLayoutKind(currentLayout);
  });

  // 选中模式切换（单选互斥 / 多选累加）。
  ctrl.querySelectorAll<HTMLInputElement>('input[name="g-selmode"]').forEach((r) => {
    r.addEventListener('change', (e) => {
      pick.setSelectionMode((e.target as HTMLInputElement).value as 'single' | 'multiple');
      renderStatus();
    });
  });

  // 内置反馈开关。
  ctrl.querySelector('#cb-hov')!.addEventListener('change', (e) =>
    pick.setHighlightOnHover((e.target as HTMLInputElement).checked),
  );
  ctrl.querySelector('#cb-sel')!.addEventListener('change', (e) =>
    pick.setHighlightOnSelect((e.target as HTMLInputElement).checked),
  );
  ctrl.querySelector('#cb-nbr')!.addEventListener('change', (e) =>
    pick.setNeighborHighlight((e.target as HTMLInputElement).checked),
  );

  // 返回 dispose：释放 graph、PickController、模板材质、停止渲染循环。
  return function dispose() {
    pick.dispose();
    loop();
    graph.dispose();
    nodeMaterialTemplate.dispose();
    edgeMaterialTemplate.dispose();
    scene.remove(graph);
    // ground 是共享几何/材质（scene-setup 内常量），不在此释放
  };
}
