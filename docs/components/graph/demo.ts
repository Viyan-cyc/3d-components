import * as THREE from 'three';
import { Graph3D } from '../../../src/graph/Graph3D';
import type { GraphData } from '../../../src/graph/types';
import { createScene, createGround, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- Graph3D Demo ----
// 第一步交付：渲染球体节点 + 直线段边，演示 setData 重建。
// 另演示「每节点独立材质」：点「随机高亮」把单个节点变红，其余不受影响。

/** 生成一份随机连通图数据（约 n 个节点、随机边）。 */
function randomGraph(n: number): GraphData {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));
  const edges: { source: string; target: string }[] = [];
  // 先连成一条骨架链保证连通，再加若干随机边
  for (let i = 1; i < n; i++) {
    edges.push({ source: `n${i - 1}`, target: `n${i}` });
  }
  for (let k = 0; k < n; k++) {
    const a = (Math.random() * n) | 0;
    const b = (Math.random() * n) | 0;
    if (a !== b) edges.push({ source: `n${a}`, target: `n${b}` });
  }
  return { nodes, edges };
}

/** 默认节点颜色（与模板一致，高亮后用于还原）。 */
const NODE_COLOR_DEFAULT = 0x4a90e2;
/** 高亮颜色。 */
const NODE_COLOR_HIGHLIGHT = 0xff3b30;

export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  camera.position.set(6, 5, 8);
  camera.lookAt(0, 0, 0);

  // 统一地面（遵循 demo style guide：无 GridHelper，用 createGround）
  scene.add(createGround());

  // 材质「模板」：每个节点/边构造时 clone 一份独立实例，
  // 故单独改某节点颜色不会影响其他节点（见「随机高亮」按钮）。
  const nodeMaterialTemplate = new THREE.MeshStandardMaterial({
    color: NODE_COLOR_DEFAULT,
    roughness: 0.35,
    metalness: 0.2,
  });
  const edgeMaterialTemplate = new THREE.LineBasicMaterial({
    color: 0x9aa7b8,
    transparent: true,
    opacity: 0.85,
  });

  const graph = new Graph3D({
    nodeSize: 0.35,
    nodeMaterial: nodeMaterialTemplate,
    edgeMaterial: edgeMaterialTemplate,
    initialRadius: 3.5,
  });
  scene.add(graph);

  // 节点数量
  let count = 12;
  graph.setData(randomGraph(count));

  // 渲染循环：转发 update 给 graph（第一步无每帧逻辑，预留）
  addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 0, 0));
  startLoop(renderer, scene, camera, resize, (dt) => {
    graph.update(dt);
  });

  // ---- 控制面板 ----
  ctrl.innerHTML = `
    <button id="btn-g-rebuild">重新生成随机图</button>
    <button id="btn-g-highlight">随机高亮一个节点</button>
    <label><span>节点数: <code id="v-g-count">12</code></span>
    <input type="range" id="inp-g-count" min="3" max="60" step="1" value="12"></label>
    <p class="desc" id="g-status" style="font-size:12px;margin:2px 0"></p>`;

  const countLabel = ctrl.querySelector('#v-g-count')!;
  const status = ctrl.querySelector('#g-status')!;

  const renderStatus = () => {
    status.innerHTML = `节点 <code>${graph.getNodes().length}</code> · 边 <code>${graph.getEdges().length}</code>`;
  };
  renderStatus();

  const rebuild = () => {
    graph.setData(randomGraph(count));
    countLabel.textContent = String(count);
    renderStatus();
  };

  ctrl.querySelector('#btn-g-rebuild')!.addEventListener('click', rebuild);
  ctrl.querySelector('#inp-g-count')!.addEventListener('input', (e) => {
    count = +(e.target as HTMLInputElement).value;
    countLabel.textContent = String(count);
  });
  ctrl.querySelector('#inp-g-count')!.addEventListener('change', rebuild);

  // 随机高亮：先把所有节点还原默认色，再把随机一个变红 —— 证明每节点材质独立。
  ctrl.querySelector('#btn-g-highlight')!.addEventListener('click', () => {
    const nodes = graph.getNodes();
    for (const node of nodes) {
      node.getMaterial().color.setHex(NODE_COLOR_DEFAULT);
    }
    const pick = nodes[(Math.random() * nodes.length) | 0];
    if (pick) {
      pick.getMaterial().color.setHex(NODE_COLOR_HIGHLIGHT);
      status.innerHTML = `高亮: <code>${pick.nodeId}</code> · 节点 <code>${nodes.length}</code> · 边 <code>${graph.getEdges().length}</code>`;
    }
  });

  // 返回 dispose：释放 graph（各元素 clone 的材质由 graph 内部释放）+ 模板材质
  return function dispose() {
    graph.dispose();
    nodeMaterialTemplate.dispose();
    edgeMaterialTemplate.dispose();
    scene.remove(graph);
    // ground 是共享几何/材质（scene-setup 内常量），不在此释放
  };
}
