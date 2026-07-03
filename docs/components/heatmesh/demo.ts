import * as THREE from 'three';
import gsap from 'gsap';
import { HeatMesh } from '../../../src/heat/HeatMesh';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- HeatMesh Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  const hGrp = new THREE.Group(); scene.add(hGrp);
  const heats: HeatMesh[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const h = new HeatMesh({ count: 32, radius: 0.35, intensity: 0.3 + Math.random() * 0.4 });
    h.position.set(Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5);
    h.castShadow = true; hGrp.add(h); heats.push(h);
  }
  addSimpleOrbit(canvas, camera);

  ctrl.innerHTML = `
    <label><span>Intensity: <code id="v-hm">0.7</code></span>
    <input type="range" id="inp-hm" min="0.1" max="1" step="0.05" value="0.7"></label>
    <button id="btn-hm-pulse">GSAP Pulse</button>
    <button id="btn-hm-rand">Randomize</button>`;

  ctrl.querySelector('#inp-hm')!.addEventListener('input', (e) => {
    const v = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-hm')!.textContent = v.toFixed(2);
    heats.forEach((h) => h.setIntensity(v));
  });
  ctrl.querySelector('#btn-hm-pulse')!.addEventListener('click', () => {
    heats.forEach((h, i) => gsap.to(h, {
      heatIntensity: 1, duration: 0.3, delay: i * 0.04, yoyo: true, repeat: 3, ease: 'power2.inOut',
      onUpdate: () => { (h.material as THREE.MeshBasicMaterial).opacity = h.heatIntensity; },
    }));
  });
  ctrl.querySelector('#btn-hm-rand')!.addEventListener('click', () => {
    heats.forEach((h, i) => gsap.to(h, {
      heatIntensity: 0.2 + Math.random() * 0.8, duration: 0.5, delay: i * 0.03, ease: 'power2.out',
      onUpdate: () => { (h.material as THREE.MeshBasicMaterial).opacity = h.heatIntensity; },
    }));
  });

  startLoop(renderer, scene, camera, resize, (dt) => {
    hGrp.rotation.y += dt * 0.3;
    heats.forEach((h) => h.update(dt));
  });
}
