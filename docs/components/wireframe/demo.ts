import * as THREE from 'three';
import { Wireframe } from '../../../src/core/Wireframe';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- Wireframe Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  camera.position.set(0, 1.2, 5);
  camera.lookAt(0, 0, 0);

  // 原始几何体模板（每次重建 clone 一份，避免 overrideMaterial 就地污染模板）。
  const templates: Record<string, THREE.BufferGeometry> = {
    icosahedron: new THREE.IcosahedronGeometry(1.1, 1),
    sphere: new THREE.SphereGeometry(1.1, 24, 16),
    torusKnot: new THREE.TorusKnotGeometry(0.7, 0.25, 80, 12),
  };

  const params = {
    geo: 'icosahedron' as keyof typeof templates,
    stroke: '#ff3b3b',
    fill: '#225577',
    thickness: 0.1,
    dash: true,
    squeeze: false,
    fillOpacity: 0.25,
    overrideMaterial: false,
    fillMix: 0.5,
  };

  let mesh: THREE.Mesh | null = null;
  let wf: Wireframe | null = null;

  function rebuild() {
    if (wf) { mesh?.remove(wf); wf.dispose(); }
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material = ([] as THREE.Material[]); }

    // overrideMaterial 会就地改写父级几何体 + 材质，故每次都用全新副本，保证可来回切换。
    const geometry = templates[params.geo].clone();
    const material = new THREE.MeshStandardMaterial({ color: 0x4a90e2, roughness: 0.4, metalness: 0.2 });

    mesh = new THREE.Mesh(geometry, material);
    wf = new Wireframe({
      mesh,
      stroke: params.stroke,
      fill: params.fill,
      thickness: params.thickness,
      dash: params.dash,
      squeeze: params.squeeze,
      fillOpacity: params.fillOpacity,
      overrideMaterial: params.overrideMaterial,
      fillMix: params.fillMix,
    });
    mesh.add(wf);
    scene.add(mesh);
  }
  rebuild();
  addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 0, 0));

  ctrl.innerHTML = `
    <label><span>几何 Geometry:</span>
      <select id="sel-w-geo">
        <option value="icosahedron" selected>icosahedron · 二十面体</option>
        <option value="sphere">sphere · 球</option>
        <option value="torusKnot">torusKnot · 环面结</option>
      </select></label>
    <label><span>线条 stroke:</span>
      <input type="color" id="inp-w-stroke" value="#ff3b3b"></label>
    <label><span>填充 fill:</span>
      <input type="color" id="inp-w-fill" value="#225577"></label>
    <label><span>厚度 thickness: <code id="v-w-thk">0.10</code></span>
    <input type="range" id="inp-w-thk" min="0" max="0.5" step="0.01" value="0.1"></label>
    <label><span>填充不透明 fillOpacity: <code id="v-w-fo">0.25</code></span>
    <input type="range" id="inp-w-fo" min="0" max="1" step="0.05" value="0.25"></label>
    <label class="check"><input type="checkbox" id="inp-w-dash" checked>虚线 dash</label>
    <label class="check"><input type="checkbox" id="inp-w-squeeze">收窄 squeeze</label>
    <label class="check"><input type="checkbox" id="inp-w-override">材质覆盖 overrideMaterial <em>(带光照)</em></label>
    <label><span>fillMix: <code id="v-w-fm">0.50</code> <em>(override)</em></span>
    <input type="range" id="inp-w-fm" min="0" max="1" step="0.05" value="0.5"></label>`;

  function $(id: string): HTMLElement { return ctrl.querySelector(id)!; }

  $('#sel-w-geo')!.addEventListener('change', (e) => {
    params.geo = (e.target as HTMLSelectElement).value as keyof typeof templates;
    rebuild();
  });
  $('#inp-w-stroke')!.addEventListener('input', (e) => {
    params.stroke = (e.target as HTMLInputElement).value;
    wf?.setUniform('stroke', params.stroke);
  });
  $('#inp-w-fill')!.addEventListener('input', (e) => {
    params.fill = (e.target as HTMLInputElement).value;
    wf?.setUniform('fill', params.fill);
  });
  $('#inp-w-thk')!.addEventListener('input', (e) => {
    params.thickness = +(e.target as HTMLInputElement).value;
    $('#v-w-thk')!.textContent = params.thickness.toFixed(2);
    wf?.setUniform('thickness', params.thickness);
  });
  $('#inp-w-fo')!.addEventListener('input', (e) => {
    params.fillOpacity = +(e.target as HTMLInputElement).value;
    $('#v-w-fo')!.textContent = params.fillOpacity.toFixed(2);
    wf?.setUniform('fillOpacity', params.fillOpacity);
  });
  $('#inp-w-dash')!.addEventListener('change', (e) => {
    params.dash = (e.target as HTMLInputElement).checked;
    wf?.setUniform('dash', params.dash);
  });
  $('#inp-w-squeeze')!.addEventListener('change', (e) => {
    params.squeeze = (e.target as HTMLInputElement).checked;
    wf?.setUniform('squeeze', params.squeeze);
  });
  $('#inp-w-override')!.addEventListener('change', (e) => {
    params.overrideMaterial = (e.target as HTMLInputElement).checked;
    rebuild();
  });
  $('#inp-w-fm')!.addEventListener('input', (e) => {
    params.fillMix = +(e.target as HTMLInputElement).value;
    $('#v-w-fm')!.textContent = params.fillMix.toFixed(2);
    wf?.setUniform('fillMix', params.fillMix);
  });

  startLoop(renderer, scene, camera, resize, () => {
    if (mesh) { mesh.rotation.y += 0.003; }
  });
}
