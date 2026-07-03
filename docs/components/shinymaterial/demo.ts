import * as THREE from 'three';
import { ShinyMaterial } from '../../../src/material/ShinyMaterial';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- ShinyMaterial Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  const colors = [0xe94560, 0x0f3460, 0x533483, 0xf5c542, 0x00bcd4];
  const mats: ShinyMaterial[] = [];
  const balls: THREE.Mesh[] = [];
  colors.forEach((c, i) => {
    const mat = new ShinyMaterial({ color: c, metalness: 0.1 + i * 0.15, roughness: 0.1 + i * 0.1 });
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 64, 64), mat);
    m.position.set((i - 2) * 1.3, 0.5, 0);
    m.castShadow = m.receiveShadow = true;
    scene.add(m); mats.push(mat); balls.push(m);
  });
  addSimpleOrbit(canvas, camera);

  let sel = 2;
  ctrl.innerHTML = `
    <label><span>Metalness: <code id="v-sm-m">0.30</code></span>
    <input type="range" id="inp-sm-m" min="0" max="1" step="0.01" value="0.30"></label>
    <label><span>Roughness: <code id="v-sm-r">0.20</code></span>
    <input type="range" id="inp-sm-r" min="0" max="1" step="0.01" value="0.20"></label>
    <label><span>Target:</span>
    <select id="sel-sm">${['Red','Navy','Purple','Gold','Cyan'].map((n,i)=>`<option value="${i}"${i===2?' selected':''}>${n}</option>`).join('')}</select></label>
    <button id="btn-sm-all">Apply to All</button>`;

  function sync() {
    (ctrl.querySelector('#inp-sm-m') as HTMLInputElement).value = String(mats[sel].metalness);
    (ctrl.querySelector('#inp-sm-r') as HTMLInputElement).value = String(mats[sel].roughness);
    ctrl.querySelector('#v-sm-m')!.textContent = mats[sel].metalness.toFixed(2);
    ctrl.querySelector('#v-sm-r')!.textContent = mats[sel].roughness.toFixed(2);
  }
  ctrl.querySelector('#inp-sm-m')!.addEventListener('input', (e) => {
    mats[sel].setShininess(+(e.target as HTMLInputElement).value, mats[sel].roughness);
    ctrl.querySelector('#v-sm-m')!.textContent = mats[sel].metalness.toFixed(2);
  });
  ctrl.querySelector('#inp-sm-r')!.addEventListener('input', (e) => {
    mats[sel].setShininess(mats[sel].metalness, +(e.target as HTMLInputElement).value);
    ctrl.querySelector('#v-sm-r')!.textContent = mats[sel].roughness.toFixed(2);
  });
  ctrl.querySelector('#sel-sm')!.addEventListener('change', (e) => { sel = +(e.target as HTMLSelectElement).value; sync(); });
  ctrl.querySelector('#btn-sm-all')!.addEventListener('click', () => {
    mats.forEach((m) => m.setShininess(mats[sel].metalness, mats[sel].roughness));
  });

  startLoop(renderer, scene, camera, resize, (dt) => {
    balls.forEach((b, i) => {
      b.rotation.y += dt * (0.3 + i * 0.1);
      b.position.y = 0.5 + Math.sin(performance.now() * 0.001 + i) * 0.2;
    });
  });
}
