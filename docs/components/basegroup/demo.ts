import * as THREE from 'three';
import { BaseGroup } from '../../../src/core/BaseGroup';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- BaseGroup Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  const grp = new BaseGroup({ name: 'DemoGroup', scale: 1.5 });
  const knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.5, 0.15, 64, 16),
    new THREE.MeshStandardMaterial({ color: 0xe94560, roughness: 0.25, metalness: 0.1 }),
  );
  knot.castShadow = true; knot.position.y = 0.4;
  grp.add(knot);
  scene.add(grp);
  addSimpleOrbit(canvas, camera);

  ctrl.innerHTML = `
    <label><span>Scale: <code id="v-bg-s">1.5</code></span>
    <input type="range" id="inp-bg-s" min="0.5" max="3" step="0.1" value="1.5"></label>
    <button id="btn-bg-r">Reset</button>`;

  ctrl.querySelector('#inp-bg-s')!.addEventListener('input', (e) => {
    const v = +(e.target as HTMLInputElement).value;
    grp.scale.setScalar(v);
    ctrl.querySelector('#v-bg-s')!.textContent = v.toFixed(1);
  });
  ctrl.querySelector('#btn-bg-r')!.addEventListener('click', () => {
    grp.position.set(0, 0, 0); grp.rotation.set(0, 0, 0);
  });

  startLoop(renderer, scene, camera, resize, (dt) => {
    grp.update(dt);
    grp.rotation.y += dt * 0.5;
  });
}
