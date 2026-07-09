import * as THREE from 'three';
import { Grid } from '../../../src/core/Grid';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- Grid Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  camera.position.set(7, 5, 9);
  camera.lookAt(0, 0, 0);

  // 无限网格（远处线性淡出更明显）
  const grid = new Grid({ primaryScale: 5, secondaryScale: 1, fadeStart: 20, fadeEnd: 80 });
  scene.add(grid);

  // 摆几个盒子在网格上，演示网格被物体正确遮挡 + 坐标轴对齐
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.4, metalness: 0.2 });
  [[0, 0.5, 0], [4, 0.75, -3], [-3, 0.5, 3]].forEach((p, i) => {
    const s = i === 1 ? 1.5 : 1;
    const box = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), boxMat);
    box.position.set(p[0], p[1], p[2]);
    box.castShadow = box.receiveShadow = true;
    scene.add(box);
  });

  addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 0, 0));

  const params = {
    plane: 'xz' as 'xz' | 'xy', primaryScale: 5, secondaryScale: 1,
    showAxis: true, linearFade: true, start: 20, end: 80,
  };

  ctrl.innerHTML = `
    <button id="btn-grid-plane">平面: XZ (地面)</button>
    <label><span>主网格 primaryScale: <code id="v-g-p">5</code></span>
    <input type="range" id="inp-g-p" min="1" max="20" step="0.5" value="5"></label>
    <label><span>次网格 secondaryScale: <code id="v-g-s">1</code></span>
    <input type="range" id="inp-g-s" min="0.5" max="10" step="0.5" value="1"></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px">
      <label><span>淡出起: <code id="v-g-fs">20</code></span>
      <input type="range" id="inp-g-fs" min="0" max="60" step="1" value="20"></label>
      <label><span>淡出止: <code id="v-g-fe">80</code></span>
      <input type="range" id="inp-g-fe" min="20" max="200" step="5" value="80"></label>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;align-items:center">
      <label class="check" style="justify-content:flex-start"><input type="color" id="inp-g-c" value="#333333">网格</label>
      <label class="check" style="justify-content:flex-start"><input type="color" id="inp-g-xc" value="#ff0000">X轴</label>
      <label class="check" style="justify-content:flex-start"><input type="color" id="inp-g-zc" value="#0000ff">Z/Y轴</label>
    </div>
    <label class="check"><input type="checkbox" id="inp-g-axis" checked>显示坐标轴</label>
    <label class="check"><input type="checkbox" id="inp-g-lf" checked>距离淡出 linearFade</label>`;

  const planeBtn = ctrl.querySelector('#btn-grid-plane') as HTMLButtonElement;
  planeBtn.addEventListener('click', () => {
    params.plane = params.plane === 'xz' ? 'xy' : 'xz';
    planeBtn.textContent = `平面: ${params.plane.toUpperCase()} (${params.plane === 'xz' ? '地面' : '立面'})`;
    grid.setPlane(params.plane);
  });

  const bind = (sel: string, valId: string, key: keyof typeof params, apply: (v: number) => void, fmt = (v: number) => v.toFixed(1)) => {
    ctrl.querySelector(sel)!.addEventListener('input', (e) => {
      const v = +(e.target as HTMLInputElement).value;
      (params as any)[key] = v;
      ctrl.querySelector(`#${valId}`)!.textContent = fmt(v);
      apply(v);
    });
  };
  bind('#inp-g-p', 'v-g-p', 'primaryScale', (v) => grid.setPrimaryScale(v));
  bind('#inp-g-s', 'v-g-s', 'secondaryScale', (v) => grid.setSecondaryScale(v));
  bind('#inp-g-fs', 'v-g-fs', 'start', (v) => grid.setFade(v, params.end), (v) => v.toFixed(0));
  bind('#inp-g-fe', 'v-g-fe', 'end', (v) => grid.setFade(params.start, v), (v) => v.toFixed(0));
  ctrl.querySelector('#inp-g-axis')!.addEventListener('change', (e) => {
    params.showAxis = (e.target as HTMLInputElement).checked;
    grid.setShowAxis(params.showAxis);
  });
  ctrl.querySelector('#inp-g-lf')!.addEventListener('change', (e) => {
    params.linearFade = (e.target as HTMLInputElement).checked;
    grid.setLinearFade(params.linearFade);
  });
  ctrl.querySelector('#inp-g-c')!.addEventListener('input', (e) => grid.setColor((e.target as HTMLInputElement).value));
  ctrl.querySelector('#inp-g-xc')!.addEventListener('input', (e) => grid.setXAxisColor((e.target as HTMLInputElement).value));
  ctrl.querySelector('#inp-g-zc')!.addEventListener('input', (e) => grid.setZAxisColor((e.target as HTMLInputElement).value));

  startLoop(renderer, scene, camera, resize, () => {});
}
