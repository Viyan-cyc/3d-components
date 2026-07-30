import * as THREE from 'three';
import { CameraControls } from '../../../src/camera';
import { createScene, createGround, startLoop } from '../../shared/scene-setup';

// ---- CameraControls Demo ----
// 交互式演示轨道旋转、推拉、平移和编程式过渡。
// 场景中放置几何体和地面，通过控制面板调用各种 API。
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): () => void {
  const { renderer, scene, camera, resize } = createScene(canvas);
  camera.position.set(4, 3, 5);
  camera.lookAt(0, 0, 0);

  // 用 CameraControls 替代 OrbitControls
  const controls = new CameraControls({
    camera,
    domElement: canvas,
    smoothTime: 0.3,
    draggingSmoothTime: 0.12,
  });

  // 地面
  const ground = createGround(20);
  ground.position.y = -0.5;
  scene.add(ground);

  // 几何体群组
  const group = new THREE.Group();

  const torus = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.5, 0.15, 128, 24),
    new THREE.MeshStandardMaterial({ color: 0x4488ff, roughness: 0.35, metalness: 0.3 }),
  );
  torus.castShadow = true;
  group.add(torus);

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.6, 0.6),
    new THREE.MeshStandardMaterial({ color: 0xff6644, roughness: 0.4, metalness: 0.2 }),
  );
  box.position.set(1.6, 0, 0);
  box.rotation.y = 0.4;
  box.castShadow = true;
  group.add(box);

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 32, 24),
    new THREE.MeshStandardMaterial({ color: 0x44cc88, roughness: 0.3, metalness: 0.2 }),
  );
  sphere.position.set(-1.4, 0, 0.4);
  sphere.castShadow = true;
  group.add(sphere);

  scene.add(group);

  // ---- 控制面板 ----
  const ids = {
    smoothTime: 'inp-cc-smooth',
    polarLimit: 'inp-cc-polar',
    rotFront: 'btn-cc-front',
    rotBack: 'btn-cc-back',
    rotTop: 'btn-cc-top',
    fitAll: 'btn-cc-fit',
    reset: 'btn-cc-reset',
    saveState: 'btn-cc-save',
  };

  ctrl.innerHTML = `
    <label>smoothTime <input type="range" id="${ids.smoothTime}" min="0.05" max="1" step="0.05" value="0.3" style="width:80px"> <span id="v-cc-smooth-val">0.30</span></label>
    <label>极角限制 <input type="range" id="${ids.polarLimit}" min="10" max="170" step="5" value="170" style="width:80px"> <span id="v-cc-polar-val">170°</span></label>
    <button id="${ids.rotFront}" type="button">正视</button>
    <button id="${ids.rotBack}" type="button">后视</button>
    <button id="${ids.rotTop}" type="button">俯视</button>
    <button id="${ids.fitAll}" type="button">适配全部</button>
    <button id="${ids.reset}" type="button">重置</button>
    <button id="${ids.saveState}" type="button">保存状态</button>
    <p style="opacity:.7;font-size:12px;margin:4px 0 0">左键=旋转 · 右键=平移 · 滚轮=推拉</p>`;

  const $ = (id: string): HTMLElement => ctrl.querySelector(`#${id}`)! as HTMLElement;

  // smoothTime 滑块
  ( $(ids.smoothTime) as HTMLInputElement ).addEventListener('input', (e) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    controls.smoothTime = v;
    $('v-cc-smooth-val').textContent = v.toFixed(2);
  });

  // 极角限制
  ( $(ids.polarLimit) as HTMLInputElement ).addEventListener('input', (e) => {
    const deg = parseFloat((e.target as HTMLInputElement).value);
    const rad = THREE.MathUtils.degToRad(deg);
    controls.minPolarAngle = THREE.MathUtils.degToRad(10);
    controls.maxPolarAngle = rad;
    $('v-cc-polar-val').textContent = `${deg}°`;
  });

  // 编程式视角按钮
  $(ids.rotFront).addEventListener('click', () => {
    controls.setLookAt(0, 1, 5, 0, 0, 0, true);
  });
  $(ids.rotBack).addEventListener('click', () => {
    controls.setLookAt(0, 1, -5, 0, 0, 0, true);
  });
  $(ids.rotTop).addEventListener('click', () => {
    controls.setLookAt(0, 5, 0.01, 0, 0, 0, true);
  });

  // fitToBox
  $(ids.fitAll).addEventListener('click', () => {
    const box3 = new THREE.Box3().setFromObject(group);
    controls.fitToBox(box3, true, { paddingLeft: 0.5, paddingRight: 0.5, paddingTop: 0.5, paddingBottom: 0.5, cover: false });
  });

  // 重置
  $(ids.reset).addEventListener('click', () => {
    controls.reset(true);
  });

  // 保存状态
  $(ids.saveState).addEventListener('click', () => {
    controls.saveState();
    ( $(ids.saveState) as HTMLButtonElement ).textContent = '已保存 ✓';
    setTimeout(() => { ( $(ids.saveState) as HTMLButtonElement ).textContent = '保存状态'; }, 1200);
  });

  // ---- 状态读出（独立浮层，在 canvas 左下角） ----
  const pageEl = canvas.closest('.page')!;
  const readout = pageEl.querySelector('#cc-readout') as HTMLElement;
  const _pos = new THREE.Vector3();
  const _target = new THREE.Vector3();

  // ---- 渲染循环 ----
  const clock = new THREE.Clock();
  const tick = (): void => {
    const dt = clock.getDelta();
    controls.update(dt);

    // 读出当前状态
    controls.getPosition(_pos);
    controls.getTarget(_target);
    readout.textContent =
      `pos    ${_pos.x.toFixed(2)}, ${_pos.y.toFixed(2)}, ${_pos.z.toFixed(2)}\n` +
      `target ${_target.x.toFixed(2)}, ${_target.y.toFixed(2)}, ${_target.z.toFixed(2)}\n` +
      `dist   ${controls.distance.toFixed(2)}  ` +
      `azim ${THREE.MathUtils.radToDeg(controls.azimuthAngle).toFixed(0)}°  ` +
      `polar ${THREE.MathUtils.radToDeg(controls.polarAngle).toFixed(0)}°`;
  };
  const stop = startLoop(renderer, scene, camera, resize, tick);

  // ---- 卸载 ----
  return () => {
    stop();
    controls.dispose();
    (torus.material as THREE.Material).dispose();
    torus.geometry.dispose();
    (box.material as THREE.Material).dispose();
    box.geometry.dispose();
    (sphere.material as THREE.Material).dispose();
    sphere.geometry.dispose();
    scene.remove(ground);
  };
}
