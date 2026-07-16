import * as THREE from 'three';
import { GizmoHelper, GizmoViewport } from '../../../src/helper';
import type { GizmoAlignment } from '../../../src/helper';
import { createScene, createGround, addSimpleOrbit } from '../../shared/scene-setup';

// ---- GizmoHelper Demo ----
// 注意：GizmoHelper.renderOverlay() 必须在主渲染之后调用，
// 因此这里用自定义渲染循环（而非 startLoop）。
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): () => void {
  const { renderer, scene, camera, resize } = createScene(canvas);
  camera.position.set(3.5, 2.6, 4.5);
  camera.lookAt(0, 0, 0);

  // 轨道控制器
  const controls = addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 0.4, 0));
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // ---- 参考场景：一个灰色“模型”+ 三轴方向的彩色标记 ----
  const ground = createGround(20);
  scene.add(ground);

  const model = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.7, metalness: 0.05 }),
  );
  model.position.y = 0.5;
  model.castShadow = true;
  model.receiveShadow = true;
  scene.add(model);

  const markerGeo = new THREE.SphereGeometry(0.16, 20, 14);
  const markers: THREE.Mesh[] = [];
  const addMarker = (x: number, y: number, z: number, color: number): void => {
    const m = new THREE.Mesh(markerGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
    m.position.set(x, y, z);
    m.castShadow = true;
    scene.add(m);
    markers.push(m);
  };
  addMarker(2, 0.5, 0, 0xff2060); // +X 红
  addMarker(0, 2.5, 0, 0x20df80); // +Y 绿
  addMarker(0, 0.5, 2, 0x2080ff); // +Z 蓝

  // ---- GizmoHelper + GizmoViewport ----
  const gizmo = new GizmoHelper({ camera, renderer, controls, alignment: 'bottom-right', size: 100 });
  const buildViewport = (): GizmoViewport =>
    new GizmoViewport({ onPick: (dir) => gizmo.tweenCamera(dir) });
  gizmo.setContent(buildViewport());

  // ---- 自定义渲染循环 ----
  let last = performance.now();
  let running = true;
  function frame(): void {
    if (!running) return;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    resize();
    controls.update();
    model.rotation.y += dt * 0.25;
    gizmo.update(dt); // 同步 gizmo 朝向 + 动画相机
    renderer.render(scene, camera);
    gizmo.renderOverlay(); // 必须在主渲染之后

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- 控制面板 ----
  ctrl.innerHTML = `
    <label><span>对齐 alignment</span>
      <select id="inp-gizmo-align">
        <option value="bottom-right">bottom-right</option>
        <option value="bottom-left">bottom-left</option>
        <option value="top-right">top-right</option>
        <option value="top-left">top-left</option>
        <option value="bottom-center">bottom-center</option>
        <option value="top-center">top-center</option>
        <option value="center-center">center-center</option>
      </select></label>
    <label><span>边长 size: <code id="v-gizmo-size">120</code></span>
      <input type="range" id="inp-gizmo-size" min="60" max="220" step="4" value="120"></label>
    <p style="opacity:.7;font-size:12px;margin:4px 0 0">鼠标移到右下角 gizmo 上浮现浅白圆底；悬停气泡时字母变白（负轴字母同时出现），点击轴头平滑切换视角。</p>`;

  ctrl.querySelector('#inp-gizmo-align')!.addEventListener('change', (e) => {
    gizmo.setAlignment((e.target as HTMLSelectElement).value as GizmoAlignment);
  });
  ctrl.querySelector('#inp-gizmo-size')!.addEventListener('input', (e) => {
    const v = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-gizmo-size')!.textContent = String(v);
    gizmo.setSize(v);
  });

  // ---- 卸载 ----
  return () => {
    running = false;
    gizmo.dispose();
    markerGeo.dispose();
    markers.forEach((m) => (m.material as THREE.Material).dispose());
    (model.material as THREE.Material).dispose();
    model.geometry.dispose();
    scene.remove(ground, model, ...markers);
  };
}
