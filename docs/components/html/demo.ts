import * as THREE from 'three';
import { Html } from '../../../src/core/Html';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- Html Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): () => void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  camera.position.set(4, 3, 6);
  camera.lookAt(0, 0, 0);

  // ── Shared container for Html overlays (must be canvas parent) ──
  const container = canvas.parentElement!;

  // ── 1. Simple label (2D projection, centered) ──
  const labelEl = document.createElement('div');
  labelEl.innerHTML = '<div style="background:#fff;padding:8px 16px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.15);font-size:13px;white-space:nowrap">🎯 基础标签</div>';
  const label = new Html({ el: labelEl, center: true, portal: container });
  label.position.set(0, 2.2, 0);
  scene.add(label);

  // ── 2. Distance-scaled info card ──
  const infoEl = document.createElement('div');
  infoEl.innerHTML = '<div style="background:rgba(0,0,0,.78);color:#fff;padding:10px 16px;border-radius:6px;font-size:12px;line-height:1.5;min-width:120px"><b>距离缩放</b><br>靠近变大，远离变小</div>';
  const info = new Html({
    el: infoEl,
    center: true,
    distanceFactor: 8,
    portal: container,
  });
  info.position.set(-2, 1.2, 1);
  scene.add(info);

  // ── 3. CSS3D transform panel ──
  const panelEl = document.createElement('div');
  panelEl.innerHTML = '<div style="width:240px;background:#fff;border-radius:8px;padding:16px;box-shadow:0 4px 20px rgba(0,0,0,.12);font-size:13px"><div style="font-weight:600;margin-bottom:8px;color:#333">📐 CSS3D 变换面板</div><div style="color:#666;line-height:1.6">启用 <code style="background:#ecf5ff;color:#409eff;padding:1px 4px;border-radius:2px">transform: true</code> 后，DOM 元素会在 3D 空间中产生真正的透视变换效果。</div></div>';
  const panel = new Html({
    el: panelEl,
    transform: true,
    distanceFactor: 10,
    portal: container,
  });
  panel.position.set(2, 1.2, -2);
  panel.rotation.y = -0.3;
  scene.add(panel);

  // ── 4. Sprite billboard (always faces camera) ──
  const spriteEl = document.createElement('div');
  spriteEl.innerHTML = '<div style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:8px 14px;border-radius:20px;font-size:12px;white-space:nowrap">✨ Billboard</div>';
  const spriteHtml = new Html({
    el: spriteEl,
    transform: true,
    sprite: true,
    distanceFactor: 10,
    portal: container,
  });
  spriteHtml.position.set(0, 0.3, -2);
  scene.add(spriteHtml);

  // ── 5. Raycast occluded label ──
  const occludedEl = document.createElement('div');
  occludedEl.innerHTML = '<div style="background:#e6f7ff;border:1px solid #91d5ff;padding:6px 12px;border-radius:4px;font-size:12px;color:#1890ff">🔍 射线遮挡检测</div>';
  const occluded = new Html({
    el: occludedEl,
    center: true,
    portal: container,
    onOcclude: (hidden) => {
      occludedEl.style.opacity = hidden ? '0.2' : '1';
      occludedEl.style.transition = 'opacity 0.3s';
    },
  });
  occluded.position.set(1.5, 0.6, 1.5);
  scene.add(occluded);

  // ── 3D objects ──
  const boxGeom = new THREE.BoxGeometry(1.2, 1.2, 1.2);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x5b8ff9, roughness: 0.4 });
  const box = new THREE.Mesh(boxGeom, boxMat);
  box.position.set(1.5, 0.6, 1.5);
  scene.add(box);

  const groundGeom = new THREE.PlaneGeometry(12, 12);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0xd9dee4, roughness: 0.8 });
  const ground = new THREE.Mesh(groundGeom, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  const sphereGeom = new THREE.SphereGeometry(0.5, 32, 32);
  const sphereMat = new THREE.MeshStandardMaterial({ color: 0xf6903d, roughness: 0.3 });
  const sphere = new THREE.Mesh(sphereGeom, sphereMat);
  sphere.position.set(-2, 0.5, 1);
  scene.add(sphere);

  const cylGeom = new THREE.CylinderGeometry(0.4, 0.4, 1.5, 32);
  const cylMat = new THREE.MeshStandardMaterial({ color: 0x5ad8a6, roughness: 0.4 });
  const cylinder = new THREE.Mesh(cylGeom, cylMat);
  cylinder.position.set(0, 0.75, -1);
  scene.add(cylinder);

  addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 0.5, 0));

  // ── Controls ──
  ctrl.innerHTML = `
    <label class="check"><input type="checkbox" id="inp-html-transform">CSS3D 变换</label>
    <label class="check"><input type="checkbox" id="inp-html-sprite">Sprite 面向相机</label>
    <label class="check"><input type="checkbox" id="inp-html-occlude">射线遮挡</label>
    <label><span>distanceFactor: <code id="v-html-df">8</code></span>
    <input type="range" id="inp-html-df" min="1" max="25" step="1" value="8"></label>
    <label><span>旋转 Y: <code id="v-html-ry">0</code>°</span>
    <input type="range" id="inp-html-ry" min="-180" max="180" step="5" value="0"></label>
    <div class="info">拖拽旋转场景，观察 HTML 元素随 3D 位置变化。<br>遮挡标签移到方块后方会变透明。</div>
  `;

  // ── Toggle: CSS3D transform ──
  ctrl.querySelector('#inp-html-transform')!.addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    label.setTransform(on);
    info.setTransform(on);
    panel.setTransform(true); // panel is always transform
    spriteHtml.setTransform(true);
  });

  // ── Toggle: Sprite billboard ──
  ctrl.querySelector('#inp-html-sprite')!.addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    label.setSprite(on);
    info.setSprite(on);
    panel.setSprite(on);
    spriteHtml.setSprite(on);
  });

  // ── Toggle: Raycast occlusion ──
  ctrl.querySelector('#inp-html-occlude')!.addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    occluded.setOcclude(on ? 'raycast' : false);
  });

  // ── Slider: distance factor ──
  const dfSlider = ctrl.querySelector('#inp-html-df') as HTMLInputElement;
  const dfValue = ctrl.querySelector('#v-html-df')!;
  dfSlider.addEventListener('input', () => {
    const v = +dfSlider.value;
    dfValue.textContent = v.toFixed(0);
    label.setDistanceFactor(v);
    info.setDistanceFactor(v);
    panel.setDistanceFactor(v);
    spriteHtml.setDistanceFactor(v);
    occluded.setDistanceFactor(v);
  });

  // ── Slider: rotation Y ──
  const rySlider = ctrl.querySelector('#inp-html-ry') as HTMLInputElement;
  const ryValue = ctrl.querySelector('#v-html-ry')!;
  rySlider.addEventListener('input', () => {
    const deg = +rySlider.value;
    ryValue.textContent = deg.toFixed(0);
    label.rotation.y = THREE.MathUtils.degToRad(deg);
    info.rotation.y = THREE.MathUtils.degToRad(deg);
  });

  // ── Render loop ──
  const clock = new THREE.Clock();
  let running = true;

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);

    const delta = clock.getDelta();
    resize();

    box.rotation.y += delta * 0.3;

    // Update all Html instances
    label.update(delta, camera, renderer);
    info.update(delta, camera, renderer);
    panel.update(delta, camera, renderer);
    spriteHtml.update(delta, camera, renderer);
    occluded.update(delta, camera, renderer);

    renderer.render(scene, camera);
  }

  requestAnimationFrame(frame);

  return () => {
    running = false;
    label.dispose();
    info.dispose();
    panel.dispose();
    spriteHtml.dispose();
    occluded.dispose();
    boxGeom.dispose();
    boxMat.dispose();
    sphereGeom.dispose();
    sphereMat.dispose();
    cylGeom.dispose();
    cylMat.dispose();
    groundGeom.dispose();
    groundMat.dispose();
  };
}
