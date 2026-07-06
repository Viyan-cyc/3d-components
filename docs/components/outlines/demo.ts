import * as THREE from 'three';
import { Outlines } from '../../../src/core/Outlines';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- Outlines Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  camera.position.set(0, 1.5, 5);
  camera.lookAt(0, 0, 0);

  // 几个候选几何体，展示描边在不同曲率 / 折痕下的表现。
  const geometries: Record<string, THREE.BufferGeometry> = {
    icosahedron: new THREE.IcosahedronGeometry(1, 0),
    torusKnot: new THREE.TorusKnotGeometry(0.7, 0.25, 100, 16),
    box: new THREE.BoxGeometry(1.4, 1.4, 1.4),
  };

  const material = new THREE.MeshStandardMaterial({ color: 0x4a90e2, roughness: 0.4, metalness: 0.2 });

  const params = {
    geo: 'icosahedron' as keyof typeof geometries,
    color: '#ff3b3b',
    thickness: 0.05,
    screenspace: false,
    angle: Math.PI,
  };

  let mesh: THREE.Mesh | null = null;
  let outline: Outlines | null = null;

  function rebuild() {
    if (outline) { mesh?.remove(outline); outline.dispose(); }
    if (mesh) { scene.remove(mesh); }

    mesh = new THREE.Mesh(geometries[params.geo], material);
    outline = new Outlines({
      mesh,
      color: params.color,
      thickness: params.thickness,
      screenspace: params.screenspace,
      angle: params.angle,
    });
    if (params.screenspace) outline.attachRenderer(renderer);
    mesh.add(outline);
    scene.add(mesh);
  }
  rebuild();
  addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 0, 0));

  ctrl.innerHTML = `
    <label><span>几何 Geometry:</span>
      <select id="sel-o-geo">
        <option value="icosahedron" selected>icosahedron · 二十面体</option>
        <option value="torusKnot">torusKnot · 环面结</option>
        <option value="box">box · 立方体</option>
      </select></label>
    <label><span>颜色 Color:</span>
      <input type="color" id="inp-o-color" value="#ff3b3b"></label>
    <label><span>厚度 thickness: <code id="v-o-thk">0.050</code></span>
    <input type="range" id="inp-o-thk" min="0" max="0.3" step="0.005" value="0.05"></label>
    <label><span>折痕 angle: <code id="v-o-ang">3.14</code></span>
    <input type="range" id="inp-o-ang" min="0" max="${Math.PI.toFixed(4)}" step="0.01" value="${Math.PI.toFixed(4)}"></label>
    <label class="check"><input type="checkbox" id="inp-o-ss">屏幕空间 screenspace</label>`;

  ctrl.querySelector('#sel-o-geo')!.addEventListener('change', (e) => {
    params.geo = (e.target as HTMLSelectElement).value as keyof typeof geometries;
    rebuild();
  });
  ctrl.querySelector('#inp-o-color')!.addEventListener('input', (e) => {
    params.color = (e.target as HTMLInputElement).value;
    rebuild();
  });
  ctrl.querySelector('#inp-o-thk')!.addEventListener('input', (e) => {
    params.thickness = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-o-thk')!.textContent = params.thickness.toFixed(3);
    rebuild();
  });
  ctrl.querySelector('#inp-o-ang')!.addEventListener('input', (e) => {
    params.angle = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-o-ang')!.textContent = params.angle.toFixed(2);
    rebuild();
  });
  ctrl.querySelector('#inp-o-ss')!.addEventListener('change', (e) => {
    params.screenspace = (e.target as HTMLInputElement).checked;
    rebuild();
  });

  // 缓慢自转，方便观察轮廓
  startLoop(renderer, scene, camera, resize, () => {
    if (mesh) { mesh.rotation.y += 0.004; mesh.rotation.x += 0.002; }
  });
}
