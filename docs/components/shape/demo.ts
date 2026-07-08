import * as THREE from 'three';
import { Shape } from '../../../src/core/Shape';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- Shape Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  // Floor to catch shadows
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0xeef0f3, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  scene.add(floor);

  camera.position.set(6, 5, 8);
  camera.lookAt(2, 0.3, 2.5);

  const shapeMaterial = new THREE.MeshStandardMaterial({ color: 0xdad3c8, roughness: 0.85, metalness: 0 });
  const tileTexture = new THREE.TextureLoader().load('../../uv.jpg', (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    rebuild();
  });

  // L 形轮廓的 6 个拐角名称
  const cornerNames = ['A', 'B', 'C', 'D', 'E', 'F'];
  const params = {
    height: 0.6,
    globalRadius: 0.3,
    corners: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3] as (number | undefined)[],
    usePerCorner: false,
    uvMode: 'repeat' as 'repeat' | 'stretch',
    texture: true,
  };
  let shape: Shape | null = null;

  function rebuild() {
    if (shape) { scene.remove(shape); shape.dispose(); }

    // 构建 radius 参数：如果启用逐顶点，用 corners 数组；否则用全局标量
    const radius = params.usePerCorner ? params.corners : params.globalRadius;

    shape = new Shape({
      shapes: [{
        // L 形异形轮廓
        path: [
          [0, 0, 0],   // A
          [4, 0, 0],   // B
          [4, 0, 2],   // C
          [2, 0, 2],   // D
          [2, 0, 5],   // E
          [0, 0, 5],   // F
        ],
        height: params.height,
        radius,
        radiusSegments: 16,
        uvMode: params.uvMode,
      }],
      material: shapeMaterial,
    });

    // 贴图设置
    if (params.texture) {
      tileTexture.repeat.set(
        params.uvMode === 'stretch' ? 1 : 1,
        params.uvMode === 'stretch' ? 1 : 1 / params.height,
      );
      shapeMaterial.map = tileTexture;
      shapeMaterial.color.set(0xffffff);
    } else {
      shapeMaterial.map = null;
      shapeMaterial.color.set(0xdad3c8);
    }
    shapeMaterial.needsUpdate = true;
    scene.add(shape);
  }
  rebuild();
  addSimpleOrbit(canvas, camera, () => new THREE.Vector3(2, 0.3, 2.5));

  // ---- 控制面板 ----
  const cornerSliders = cornerNames
    .map(
      (name, i) =>
        `<label><span>${name}: <code id="v-shape-c${i}">0.30</code></span>` +
        `<input type="range" class="inp-shape-corner" data-idx="${i}" min="0" max="2" step="0.05" value="0.3" ${params.usePerCorner ? '' : 'disabled'}></label>`,
    )
    .join('');

  ctrl.innerHTML = `
    <label><span>高度 Height: <code id="v-shape-h">0.60</code></span>
    <input type="range" id="inp-shape-h" min="0.1" max="3" step="0.05" value="0.6"></label>
    <label><span>全局圆角 radius: <code id="v-shape-r">0.30</code></span>
    <input type="range" id="inp-shape-r" min="0" max="2" step="0.05" value="0.3"></label>
    <label class="check"><input type="checkbox" id="inp-shape-pc">逐顶点圆角</label>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2px 8px" id="corner-grid">${cornerSliders}</div>
    <label class="check"><input type="checkbox" id="inp-shape-t" checked>贴图 texture</label>
    <label><span>UV:</span>
      <select id="sel-shape-uv">
        <option value="repeat" selected>repeat · 按米平铺</option>
        <option value="stretch">stretch · 铺满</option>
      </select></label>`;

  // 高度
  ctrl.querySelector('#inp-shape-h')!.addEventListener('input', (e) => {
    params.height = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-shape-h')!.textContent = params.height.toFixed(2);
    rebuild();
  });

  // 全局圆角
  ctrl.querySelector('#inp-shape-r')!.addEventListener('input', (e) => {
    params.globalRadius = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-shape-r')!.textContent = params.globalRadius.toFixed(2);
    // 同步到逐顶点滑块（当未启用逐顶点时）
    if (!params.usePerCorner) {
      for (let i = 0; i < 6; i++) params.corners[i] = params.globalRadius;
      ctrl.querySelectorAll<HTMLInputElement>('.inp-shape-corner').forEach((inp, i) => {
        inp.value = String(params.globalRadius);
        ctrl.querySelector(`#v-shape-c${i}`)!.textContent = params.globalRadius.toFixed(2);
      });
    }
    rebuild();
  });

  // 逐顶点开关
  ctrl.querySelector('#inp-shape-pc')!.addEventListener('change', (e) => {
    params.usePerCorner = (e.target as HTMLInputElement).checked;
    ctrl.querySelectorAll<HTMLInputElement>('.inp-shape-corner').forEach((inp) => {
      inp.disabled = !params.usePerCorner;
    });
    rebuild();
  });

  // 逐顶点滑块
  ctrl.querySelectorAll<HTMLInputElement>('.inp-shape-corner').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const idx = +(t.dataset.idx ?? '0');
      const val = +t.value;
      params.corners[idx] = val === 0 ? undefined : val;
      ctrl.querySelector(`#v-shape-c${idx}`)!.textContent = val.toFixed(2);
      rebuild();
    });
  });

  // 贴图
  ctrl.querySelector('#inp-shape-t')!.addEventListener('change', (e) => {
    params.texture = (e.target as HTMLInputElement).checked;
    rebuild();
  });

  // UV 模式
  ctrl.querySelector('#sel-shape-uv')!.addEventListener('change', (e) => {
    params.uvMode = (e.target as HTMLSelectElement).value as 'repeat' | 'stretch';
    rebuild();
  });

  startLoop(renderer, scene, camera, resize, () => {});
}
