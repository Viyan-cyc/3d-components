import * as THREE from 'three';
import { Rack } from '../../../src/core/Rack';
import type { RackPlank } from '../../../src/core/Rack';
import { createScene, createGround, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- Rack Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  const floor = createGround(40);
  scene.add(floor);

  camera.position.set(5, 3.2, 5.5);
  camera.lookAt(0, 1.2, 0);

  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x4a7dbd, roughness: 0.5, metalness: 0.3 });
  const plankMaterial = new THREE.MeshStandardMaterial({ color: 0xeac58b, roughness: 0.9, metalness: 0 });
  new THREE.TextureLoader().load('../../uv.jpg', (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.repeat.set(2, 2);
    plankMaterial.map = tex;
    plankMaterial.color.set(0xffffff);
    plankMaterial.needsUpdate = true;
  });

  const params = {
    row: 4,
    col: 3,
    width: 1.2,
    height: 0.9,
    depth: 1,
    firstplane: false,
    plankMode: 'percent' as 'solid' | 'percent' | 'fixed' | 'custom',
  };

  // 显式层板模式：逐层逐货位交替宽窄层板，演示数组配置
  function customPlanks(): RackPlank[] {
    const items: RackPlank[] = [];
    let y = 0;
    for (let level = 0; level <= params.col; level++) {
      let x = 0;
      for (let cell = 0; cell < params.row; cell++) {
        items.push({
          position: { x: x + params.width / 2, y, z: -params.depth / 2 },
          width: cell % 2 === 0 ? params.width * 0.8 : params.width * 0.4,
          depth: params.depth - 0.1,
        });
        x += params.width;
      }
      y += params.height;
    }
    return items;
  }

  const rack = new Rack({ frameMaterial, plankMaterial });
  scene.add(rack);

  function rebuild() {
    const goodsPlank = params.plankMode === 'solid' ? undefined
      : params.plankMode === 'percent' ? '60'
        : params.plankMode === 'fixed' ? 0.9
          : customPlanks();
    rack.set({
      row: params.row,
      col: params.col,
      width: params.width,
      height: params.height,
      depth: params.depth,
      firstplane: params.firstplane,
      goodsPlank,
    });
    // 居中：货架 x∈[0,W]、z∈[-D,0]
    rack.position.set(-(params.row * params.width) / 2, 0, params.depth / 2);
  }
  rebuild();
  addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 1.2, 0));

  ctrl.innerHTML = `
    <label><span>货位数 row: <code id="v-rack-row">4</code></span>
    <input type="range" id="inp-rack-row" min="1" max="8" step="1" value="4"></label>
    <label><span>层数 col: <code id="v-rack-col">3</code></span>
    <input type="range" id="inp-rack-col" min="1" max="6" step="1" value="3"></label>
    <label><span>货位宽 width: <code id="v-rack-w">1.20</code></span>
    <input type="range" id="inp-rack-w" min="0.6" max="2" step="0.05" value="1.2"></label>
    <label><span>层高 height: <code id="v-rack-h">0.90</code></span>
    <input type="range" id="inp-rack-h" min="0.4" max="1.6" step="0.05" value="0.9"></label>
    <label><span>深度 depth: <code id="v-rack-d">1.00</code></span>
    <input type="range" id="inp-rack-d" min="0.5" max="2" step="0.05" value="1"></label>
    <label class="check"><input type="checkbox" id="inp-rack-fp">最底层层板 firstplane</label>
    <label><span>层板模式:</span>
      <select id="sel-rack-plank">
        <option value="solid">无 goodsPlank · 通长实心层板</option>
        <option value="percent" selected>字符串 '60' · 百分比宽层板</option>
        <option value="fixed">数值 0.9 · 固定宽层板</option>
        <option value="custom">数组 · 显式层板</option>
      </select></label>`;

  function bindSlider(id: string, key: 'row' | 'col' | 'width' | 'height' | 'depth', digits: number): void {
    const input = ctrl.querySelector<HTMLInputElement>(`#inp-rack-${id}`)!;
    input.addEventListener('input', (e) => {
      params[key] = +(e.target as HTMLInputElement).value;
      ctrl.querySelector(`#v-rack-${id}`)!.textContent = params[key].toFixed(digits);
      rebuild();
    });
  }
  bindSlider('row', 'row', 0);
  bindSlider('col', 'col', 0);
  bindSlider('w', 'width', 2);
  bindSlider('h', 'height', 2);
  bindSlider('d', 'depth', 2);

  ctrl.querySelector('#inp-rack-fp')!.addEventListener('change', (e) => {
    params.firstplane = (e.target as HTMLInputElement).checked;
    rebuild();
  });

  ctrl.querySelector('#sel-rack-plank')!.addEventListener('change', (e) => {
    params.plankMode = (e.target as HTMLSelectElement).value as typeof params.plankMode;
    rebuild();
  });

  startLoop(renderer, scene, camera, resize, () => {});
}
