import * as THREE from 'three';
import { Wall } from '../../../src/core/Wall';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- Wall Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  // Floor to catch wall shadows
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0xeef0f3, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  scene.add(floor);

  camera.position.set(6.5, 5, 8.5);
  camera.lookAt(0, 1.2, 0);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xdad3c8, roughness: 0.85, metalness: 0 });
  const wallTexture = new THREE.TextureLoader().load('../../uv.jpg', (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    rebuild();
  });
  // 四个拐角（按 path 顶点顺序）：左前 / 右前 / 右后 / 左后
  const cornerNames = ['左前', '右前', '右后', '左后'];
  const params = {
    height: 2.6,
    globalRadius: 1,
    corners: [1, 1, 1, 1] as (number | undefined)[],
    usePerCorner: false,
    close: true,
    door: true,
    texture: true,
    uvMode: 'repeat' as 'repeat' | 'stretch',
  };
  let wall: Wall | null = null;

  function rebuild() {
    if (wall) { scene.remove(wall); wall.dispose(); }
    // 门洞在第 0 段（前墙 [-3,-2]→[3,-2]）的立面上：沿墙 1.5~2.5m、高 0~2.1m，贯通墙体厚度
    const hole = params.door
      ? [{ segment: 0, path: [[1.5, 0], [2.5, 0], [2.5, 2.1], [1.5, 2.1]] as [number, number][], radius: 0.1 }]
      : [];

    // 构建 radius 参数：如果启用逐顶点，用 corners 数组（undefined 回退到全局值）；否则用全局标量
    const radius = params.usePerCorner ? params.corners : params.globalRadius;

    wall = new Wall({
      walls: [{
        // 6×4 矩形房间（围绕原点）
        path: [[-3, 0, -2], [3, 0, -2], [3, 0, 2], [-3, 0, 2]],
        width: 0.25,
        height: params.height,
        radius,
        radiusSegments: 16,
        close: params.close,
        uvMode: params.uvMode,            // repeat=按米平铺 / stretch=一张铺满
        hole,
      }],
      material: wallMaterial,
    });
    // 贴图：repeat 模式下 u/v 为米，1m 重复一次；stretch 模式下一张铺满整面墙。
    if (params.texture) {
      wallTexture.repeat.set(
        params.uvMode === 'stretch' ? 1 : 1,
        params.uvMode === 'stretch' ? 1 : 1 / params.height,
      );
      wallMaterial.map = wallTexture;
      wallMaterial.color.set(0xffffff);
    } else {
      wallMaterial.map = null;
      wallMaterial.color.set(0xdad3c8);
    }
    wallMaterial.needsUpdate = true;
    scene.add(wall);
  }
  rebuild();
  addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 1.2, 0));

  const cornerSliders = cornerNames
    .map(
      (name, i) =>
        `<label><span>${name}: <code id="v-wall-c${i}">1.00</code></span>` +
        `<input type="range" class="inp-wall-corner" data-idx="${i}" min="0" max="2" step="0.05" value="1" ${params.usePerCorner ? '' : 'disabled'}></label>`,
    )
    .join('');

  ctrl.innerHTML = `
    <label><span>高度 Height: <code id="v-wall-h">2.60</code></span>
    <input type="range" id="inp-wall-h" min="1" max="4" step="0.1" value="2.6"></label>
    <label><span>全局圆角 radius: <code id="v-wall-r">1.00</code></span>
    <input type="range" id="inp-wall-r" min="0" max="2" step="0.05" value="1"></label>
    <label class="check"><input type="checkbox" id="inp-wall-pc">逐顶点圆角</label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px" id="corner-grid">${cornerSliders}</div>
    <label class="check"><input type="checkbox" id="inp-wall-c" checked>闭合 close</label>
    <label class="check"><input type="checkbox" id="inp-wall-d" checked>门洞 hole</label>
    <label class="check"><input type="checkbox" id="inp-wall-t" checked>贴图 texture</label>
    <label><span>UV:</span>
      <select id="sel-wall-uv">
        <option value="repeat" selected>repeat · 按米平铺</option>
        <option value="stretch">stretch · 铺满整墙</option>
      </select></label>`;

  // 高度
  ctrl.querySelector('#inp-wall-h')!.addEventListener('input', (e) => {
    params.height = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-wall-h')!.textContent = params.height.toFixed(2);
    rebuild();
  });

  // 全局圆角
  ctrl.querySelector('#inp-wall-r')!.addEventListener('input', (e) => {
    params.globalRadius = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-wall-r')!.textContent = params.globalRadius.toFixed(2);
    // 同步到逐顶点滑块（当未启用逐顶点时）
    if (!params.usePerCorner) {
      for (let i = 0; i < 4; i++) params.corners[i] = params.globalRadius;
      ctrl.querySelectorAll<HTMLInputElement>('.inp-wall-corner').forEach((inp, i) => {
        inp.value = String(params.globalRadius);
        ctrl.querySelector(`#v-wall-c${i}`)!.textContent = params.globalRadius.toFixed(2);
      });
    }
    rebuild();
  });

  // 逐顶点开关
  ctrl.querySelector('#inp-wall-pc')!.addEventListener('change', (e) => {
    params.usePerCorner = (e.target as HTMLInputElement).checked;
    ctrl.querySelectorAll<HTMLInputElement>('.inp-wall-corner').forEach((inp) => {
      inp.disabled = !params.usePerCorner;
    });
    rebuild();
  });

  // 逐顶点滑块
  ctrl.querySelectorAll<HTMLInputElement>('.inp-wall-corner').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const idx = +(t.dataset.idx ?? '0');
      const val = +t.value;
      params.corners[idx] = val === 0 ? undefined : val;
      ctrl.querySelector(`#v-wall-c${idx}`)!.textContent = val.toFixed(2);
      rebuild();
    });
  });

  // 闭合
  ctrl.querySelector('#inp-wall-c')!.addEventListener('change', (e) => {
    params.close = (e.target as HTMLInputElement).checked;
    rebuild();
  });

  // 门洞
  ctrl.querySelector('#inp-wall-d')!.addEventListener('change', (e) => {
    params.door = (e.target as HTMLInputElement).checked;
    rebuild();
  });

  // 贴图
  ctrl.querySelector('#inp-wall-t')!.addEventListener('change', (e) => {
    params.texture = (e.target as HTMLInputElement).checked;
    rebuild();
  });

  // UV 模式
  ctrl.querySelector('#sel-wall-uv')!.addEventListener('change', (e) => {
    params.uvMode = (e.target as HTMLSelectElement).value as 'repeat' | 'stretch';
    rebuild();
  });

  startLoop(renderer, scene, camera, resize, () => {});
}
