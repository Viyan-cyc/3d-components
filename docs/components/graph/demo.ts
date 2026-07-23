import * as THREE from 'three';
import { Graph3D } from '../../../src/graph/Graph3D';
import { PickController } from '../../../src/graph/interaction/PickController';
import { GizmoHelper, GizmoViewport } from '../../../src/helper';
import type { LayoutPreset, LayoutType } from '../../../src/graph/layouts/types';
import { createScene, addSimpleOrbit } from '../../shared/scene-setup';
import { randomGraph, type EdgeMode, type LayoutTab, type LayoutTabContext } from './layouts/shared';
import { circularTab } from './layouts/circular';
import { forceTab } from './layouts/force';
import { hexTab } from './layouts/hex';
import { gridTab } from './layouts/grid';

// ---- Graph3D Demo：每布局一个 Tab ----
// 4 个布局算法（环形 / 力导向 / 六边形 / 网格）各自一个 Tab，配本布局专属实时参数滑块。
// 架构：一个持久 Graph3D 跨所有 Tab 复用，切 Tab = graph.setLayout 重排（节点 gsap 飞动）；
// 场景/渲染循环/Orbit/Gizmo/Pick 全 Tab 共用、不随 Tab 切换重建（单 WebGL context，最轻量）。
// 全局控件（节点数/边形态/选中/反馈/动画）在右浮层；布局 Tab + 参数在左浮层。

const TABS: LayoutTab[] = [circularTab, forceTab, hexTab, gridTab];

export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): (() => void) {
  // 左浮层（布局 Tab）由 index.html 提供；demo 自取，main.ts 不需感知。
  const card = canvas.parentElement!;
  const layoutHost = card.querySelector<HTMLElement>('.demo-tabs') ?? ctrl;

  // ---- 持久场景（全 Tab 共用）----
  const { renderer, scene, camera, resize } = createScene(canvas);
  camera.position.set(7, 5.5, 9);
  camera.lookAt(0, 0, 0);
  // 本场景不加地面：xy（立面）模式下水平地面会遮挡竖直布局的节点/瓦片。

  // 材质「模板」：每节点/边构造时 clone 独立实例，单独改某元素不影响其它。
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

  // 全局状态
  let count = 12;
  let edgeMode: EdgeMode = 'line';
  let animateLayout = true;

  // 捕获 orbit 以便 dispose（修复既有泄漏：OrbitControls 的 DOM 监听原先从不释放）。
  const orbit = addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 0, 0));

  // GizmoHelper：右下角视口导航 gizmo，实时镜像主相机朝向，点击轴头平滑切到标准视角。
  // 不加入主场景（自带虚拟场景）；renderOverlay 必须在主渲染之后调用（见下方自定义循环）。
  const gizmo = new GizmoHelper({ camera, renderer, controls: orbit, alignment: 'top-center', size: 100 });
  gizmo.setContent(new GizmoViewport({ onPick: (dir) => gizmo.tweenCamera(dir) }));

  // ---- 全局控制面板（右浮层）----
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
      <legend style="font-size:12px">选中模式</legend>
      <label><input type="radio" name="g-selmode" value="single" checked> 单选(互斥)</label>
      <label><input type="radio" name="g-selmode" value="multiple"> 多选(累加)</label>
    </fieldset>
    <fieldset class="g-fb" style="border:1px solid #d0d6de;padding:4px 8px;margin:4px 0">
      <legend style="font-size:12px">内置反馈</legend>
      <label><input type="checkbox" id="cb-hov" checked> 悬停(节点放大+边发光)</label>
      <label><input type="checkbox" id="cb-sel" checked> 选中(常亮)</label>
      <label><input type="checkbox" id="cb-nbr" checked> 邻边高亮</label>
      <label><input type="checkbox" id="cb-g-anim" checked> 布局过渡动画</label>
    </fieldset>
    <p class="desc" id="g-status" style="font-size:12px;margin:2px 0"></p>
    <p class="desc" id="g-coords" style="font-size:12px;margin:2px 0;color:#5a6473"></p>
    <p class="info">布局参数在左侧 Tab 面板</p>`;

  const countLabel = ctrl.querySelector('#v-g-count')!;
  const status = ctrl.querySelector('#g-status')!;
  const coordsEl = ctrl.querySelector('#g-coords')!;
  const edgeSelect = ctrl.querySelector('#sel-g-edge') as HTMLSelectElement;

  let statusSticky = false;
  function setStatus(html: string, sticky: boolean) {
    statusSticky = sticky;
    status.innerHTML = html;
  }
  function selectionSummary(): string {
    const n = pick.getSelectedNodes();
    const ed = pick.getSelectedEdges();
    return `节点[${n.length}]${n.length ? ':' + n.join(',') : ''} · 边[${ed.length}]`;
  }
  function renderStatus() {
    status.innerHTML = `节点 <code>${graph.getNodes().length}</code> · 边 <code>${graph.getEdges().length}</code> · ${selectionSummary()}`;
  }
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

  // PickController：拾取 + 内置反馈 + 事件回调（跨 Tab 持久，graph 不变则无需重绑）。
  const pick = new PickController({
    domElement: canvas,
    graph,
    camera,
    selectionMode: 'single',
    onHover: (e) => setStatus(`hover <code>${e.kind}</code> · <code>${e.id}</code>`, false),
    onSelect: (e) =>
      setStatus(`${e.type} <code>${e.kind}</code> · <code>${e.id}</code> · ${selectionSummary()}`, true),
  });

  // 渲染循环（自定义而非 startLoop）：GizmoHelper.renderOverlay 必须在主场景渲染之后调用，
  // startLoop 内部自行 render 且不暴露渲染后钩子，故这里手动驱动 resize/tick/render/overlay。
  let last = performance.now();
  let running = true;
  function frame(): void {
    if (!running) return;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    resize();
    graph.update(dt);
    pick.update(dt);
    gizmo.update(dt); // 同步 gizmo 朝向 + 动画相机
    renderer.render(scene, camera);
    gizmo.renderOverlay(); // 必须在主渲染之后

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- 布局 Tab 上下文 ----
  const ctx: LayoutTabContext = {
    graph,
    apply: (preset: LayoutPreset, opts) =>
      graph.setLayout(preset, {
        animate: opts?.instant ? false : animateLayout,
        duration: opts?.duration ?? 0.7,
        onComplete: showCoords,
      }),
    randomGraph: (n) => randomGraph(n, edgeMode), // 读当前边形态
  };

  // ---- Tab 编排（左浮层）----
  const seg = document.createElement('div');
  seg.className = 'seg';
  const panel = document.createElement('div');
  panel.className = 'seg-panel';
  const segButtons = new Map<LayoutType, HTMLButtonElement>();
  for (const tab of TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = tab.label;
    btn.addEventListener('click', () => selectTab(tab.type));
    seg.appendChild(btn);
    segButtons.set(tab.type, btn);
  }
  layoutHost.appendChild(seg);
  layoutHost.appendChild(panel);

  let activeType: LayoutType | null = null;
  let activeCleanup: (() => void) | null = null;
  function selectTab(type: LayoutType) {
    if (type === activeType) return;
    if (activeCleanup) {
      try {
        activeCleanup();
      } catch {
        /* ignore */
      }
      activeCleanup = null;
    }
    panel.innerHTML = ''; // 清掉上一 Tab 控件（监听随元素 GC）
    const tab = TABS.find((t) => t.type === type)!;
    activeCleanup = tab.mount(panel, ctx);
    activeType = type;
    segButtons.forEach((b, t) => b.classList.toggle('active', t === type));
  }

  // ---- 全局控件绑定 ----
  const rebuild = () => {
    // 布局已被 setLayout 记忆，setData 内部自动重应用当前 Tab 布局。
    graph.setData(randomGraph(count, edgeMode));
    countLabel.textContent = String(count);
    setStatus('', false);
    renderStatus();
    showCoords();
  };
  ctrl.querySelector('#btn-g-rebuild')!.addEventListener('click', rebuild);
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
  ctrl.querySelector('#cb-g-anim')!.addEventListener('change', (e) => {
    animateLayout = (e.target as HTMLInputElement).checked;
  });
  ctrl.querySelectorAll<HTMLInputElement>('input[name="g-selmode"]').forEach((r) => {
    r.addEventListener('change', (e) => {
      pick.setSelectionMode((e.target as HTMLInputElement).value as 'single' | 'multiple');
      renderStatus();
    });
  });
  ctrl.querySelector('#cb-hov')!.addEventListener('change', (e) =>
    pick.setHighlightOnHover((e.target as HTMLInputElement).checked),
  );
  ctrl.querySelector('#cb-sel')!.addEventListener('change', (e) =>
    pick.setHighlightOnSelect((e.target as HTMLInputElement).checked),
  );
  ctrl.querySelector('#cb-nbr')!.addEventListener('change', (e) =>
    pick.setNeighborHighlight((e.target as HTMLInputElement).checked),
  );

  // ---- 初始化：示例数据 + 默认进环形 Tab ----
  graph.setData(randomGraph(count, edgeMode));
  renderStatus();
  selectTab('circular');

  // 返回 dispose：释放当前 Tab、Pick、循环、Orbit、graph、模板材质。
  return function dispose() {
    if (activeCleanup) {
      try {
        activeCleanup();
      } catch {
        /* ignore */
      }
      activeCleanup = null;
    }
    pick.dispose();
    running = false; // 停止渲染循环
    gizmo.dispose(); // 释放 gizmo 监听与虚拟场景资源
    orbit.dispose(); // 修复：释放 OrbitControls 的 DOM 监听
    graph.dispose();
    nodeMaterialTemplate.dispose();
    edgeMaterialTemplate.dispose();
    scene.remove(graph);
  };
}
