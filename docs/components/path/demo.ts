import * as THREE from 'three';
import { Path } from '../../../src/core/Path';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// 路径数据：2D Hilbert 曲线。

type Pt = [number, number, number];

/** 2D Hilbert 曲线（点落在 y = cy 的 XZ 平面上）。 */
function hilbert2D(cx: number, cy: number, cz: number, size: number, iter: number,
  v0: number, v1: number, v2: number, v3: number): Pt[] {
  const half = size / 2;
  const vec_s: Pt[] = [
    [cx - half, cy, cz - half],
    [cx - half, cy, cz + half],
    [cx + half, cy, cz + half],
    [cx + half, cy, cz - half],
  ];
  const vec = [vec_s[v0], vec_s[v1], vec_s[v2], vec_s[v3]];
  if (--iter >= 0) {
    return [
      ...hilbert2D(vec[0][0], vec[0][1], vec[0][2], half, iter, v0, v3, v2, v1),
      ...hilbert2D(vec[1][0], vec[1][1], vec[1][2], half, iter, v0, v1, v2, v3),
      ...hilbert2D(vec[2][0], vec[2][1], vec[2][2], half, iter, v0, v1, v2, v3),
      ...hilbert2D(vec[3][0], vec[3][1], vec[3][2], half, iter, v2, v1, v0, v3),
    ];
  }
  return vec;
}

// ---- Path Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  camera.position.set(5, 4.5, 7);
  camera.lookAt(0, 1, 0);

  // 共享材质（外部传入，dispose 时不会被 Path 释放）
  const pathMaterial = new THREE.MeshStandardMaterial({ color: 0x4a90e2, roughness: 0.45, metalness: 0.1 });
  const pathTexture = new THREE.TextureLoader().load('../../uv.jpg', (tex) => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    rebuild();
  });

  // 演示路径数据：2D Hilbert 曲线（XZ 平面）。
  const basePoints = hilbert2D(0, 0, 0, 4, 1, 0, 1, 2, 3);

  const params = {
    mode: 'tube' as 'tube' | 'plane',
    bevelRadius: 0.5,
    size: 0.2,          // tube=radius / plane=width
    close: false,
    sharp: true,
    arrow: false,
    caps: true,
    texture: true,
    uvMode: 'repeat' as 'repeat' | 'stretch',
    flow: true,
    flowColor: '#00ffff',
    flowSpeed: 0.5,
    flowDir: 1 as 1 | -1,
    flowRepeat: 1,
    flowTail: 0.5,
  };
  let path: Path | null = null;

  function rebuild() {
    if (path) { scene.remove(path); path.dispose(); }
    path = new Path({
      paths: [{
        path: basePoints,
        mode: params.mode,
        bevelRadius: params.bevelRadius,
        close: params.close,
        uvMode: params.uvMode,
        up: [0, 1, 0],
        ...(params.mode === 'tube'
          ? {
              radius: params.size,
              radialSegments: 12,
              generateStartCap: params.caps,
              generateEndCap: params.caps,
            }
          : {
              width: params.size,
              side: 'both' as const,
              sharp: params.sharp,
              arrow: params.arrow,
            }),
      }],
      material: pathMaterial,
      flow: params.flow
        ? {
            enabled: true,
            color: params.flowColor,
            speed: params.flowSpeed,
            direction: params.flowDir,
            repeat: params.flowRepeat,
            intensity: 2.5,
            tailLength: params.flowTail,
          }
        : undefined,
    });
    // 贴图设置
    if (params.texture) {
      pathMaterial.map = pathTexture;
      pathMaterial.color.set(0xffffff);
    } else {
      pathMaterial.map = null;
      pathMaterial.color.set(0x4a90e2);
    }
    pathMaterial.needsUpdate = true;
    scene.add(path);
  }
  rebuild();
  addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 1, 0));

  ctrl.innerHTML = `
    <label><span>模式 Mode:</span>
      <select id="sel-p-mode">
        <option value="tube" selected>tube · 圆管</option>
        <option value="plane">plane · 扁平带</option>
      </select></label>
    <label><span>圆角 bevelRadius: <code id="v-p-bev">0.50</code></span>
    <input type="range" id="inp-p-bev" min="0" max="1.2" step="0.05" value="0.5"></label>
    <label><span>尺寸 size: <code id="v-p-size">0.20</code></span>
    <input type="range" id="inp-p-size" min="0.05" max="0.6" step="0.01" value="0.2"></label>
    <label class="check"><input type="checkbox" id="inp-p-close">闭合 close</label>
    <label class="check"><input type="checkbox" id="inp-p-sharp" checked>锐角修补 sharp <em>(plane)</em></label>
    <label class="check"><input type="checkbox" id="inp-p-arrow">末端箭头 arrow <em>(plane)</em></label>
    <label class="check"><input type="checkbox" id="inp-p-caps" checked>封盖 caps <em>(tube)</em></label>
    <label class="check"><input type="checkbox" id="inp-p-t" checked>贴图 texture</label>
    <label><span>UV:</span>
      <select id="sel-p-uv">
        <option value="repeat" selected>repeat · 按米平铺</option>
        <option value="stretch">stretch · 铺满</option>
      </select></label>
    <hr>
    <label class="check"><input type="checkbox" id="inp-p-flow" checked>流光 flow</label>
    <label><span>流光色:</span>
      <select id="sel-p-fc">
        <option value="#00ffff" selected>青</option>
        <option value="#ff3366">红</option>
        <option value="#ffcc00">金</option>
        <option value="#ffffff">白</option>
      </select></label>
    <label><span>速度: <code id="v-p-fs">0.50</code></span>
    <input type="range" id="inp-p-fs" min="0" max="2" step="0.05" value="0.5"></label>
    <label><span>方向:</span>
      <select id="sel-p-fd">
        <option value="1" selected>正向 →</option>
        <option value="-1">反向 ←</option>
      </select></label>
    <label><span>重复: <code id="v-p-fr">1</code></span>
    <input type="range" id="inp-p-fr" min="1" max="6" step="1" value="1"></label>
    <label><span>长度: <code id="v-p-ft">0.50</code></span>
    <input type="range" id="inp-p-ft" min="0.1" max="1" step="0.05" value="0.5"></label>`;

  function updateDisabled() {
    const plane = params.mode === 'plane';
    (ctrl.querySelector('#inp-p-sharp') as HTMLInputElement).disabled = !plane;
    (ctrl.querySelector('#inp-p-arrow') as HTMLInputElement).disabled = !plane;
    (ctrl.querySelector('#inp-p-caps') as HTMLInputElement).disabled = plane;
  }
  updateDisabled();

  ctrl.querySelector('#sel-p-mode')!.addEventListener('change', (e) => {
    params.mode = (e.target as HTMLSelectElement).value as 'tube' | 'plane';
    updateDisabled();
    rebuild();
  });
  ctrl.querySelector('#inp-p-bev')!.addEventListener('input', (e) => {
    params.bevelRadius = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-p-bev')!.textContent = params.bevelRadius.toFixed(2);
    rebuild();
  });
  ctrl.querySelector('#inp-p-size')!.addEventListener('input', (e) => {
    params.size = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-p-size')!.textContent = params.size.toFixed(2);
    rebuild();
  });
  ctrl.querySelector('#inp-p-close')!.addEventListener('change', (e) => {
    params.close = (e.target as HTMLInputElement).checked;
    rebuild();
  });
  ctrl.querySelector('#inp-p-sharp')!.addEventListener('change', (e) => {
    params.sharp = (e.target as HTMLInputElement).checked;
    rebuild();
  });
  ctrl.querySelector('#inp-p-arrow')!.addEventListener('change', (e) => {
    params.arrow = (e.target as HTMLInputElement).checked;
    rebuild();
  });
  ctrl.querySelector('#inp-p-caps')!.addEventListener('change', (e) => {
    params.caps = (e.target as HTMLInputElement).checked;
    rebuild();
  });
  ctrl.querySelector('#inp-p-t')!.addEventListener('change', (e) => {
    params.texture = (e.target as HTMLInputElement).checked;
    rebuild();
  });
  ctrl.querySelector('#sel-p-uv')!.addEventListener('change', (e) => {
    params.uvMode = (e.target as HTMLSelectElement).value as 'repeat' | 'stretch';
    rebuild();
  });
  ctrl.querySelector('#inp-p-flow')!.addEventListener('change', (e) => {
    params.flow = (e.target as HTMLInputElement).checked;
    rebuild();
  });
  ctrl.querySelector('#sel-p-fc')!.addEventListener('change', (e) => {
    params.flowColor = (e.target as HTMLSelectElement).value;
    path?.setFlowColor(params.flowColor);
  });
  ctrl.querySelector('#inp-p-fs')!.addEventListener('input', (e) => {
    params.flowSpeed = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-p-fs')!.textContent = params.flowSpeed.toFixed(2);
    path?.setFlowSpeed(params.flowSpeed);
  });
  ctrl.querySelector('#sel-p-fd')!.addEventListener('change', (e) => {
    params.flowDir = +(e.target as HTMLSelectElement).value as 1 | -1;
    path?.setFlowDirection(params.flowDir);
  });
  ctrl.querySelector('#inp-p-fr')!.addEventListener('input', (e) => {
    params.flowRepeat = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-p-fr')!.textContent = String(params.flowRepeat);
    path?.setFlowRepeat(params.flowRepeat);
  });
  ctrl.querySelector('#inp-p-ft')!.addEventListener('input', (e) => {
    params.flowTail = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-p-ft')!.textContent = params.flowTail.toFixed(2);
    path?.setFlowTailLength(params.flowTail);
  });

  startLoop(renderer, scene, camera, resize, () => {});
}
