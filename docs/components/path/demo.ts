import * as THREE from 'three';
import { Path } from '../../../src/core/Path';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// 路径数据：2D Hilbert 曲线，移植自 t3d.js geometry_builder_lines 示例的 CurveUtils.hilbert2D。
// 参考：https://github.com/uinosoft/t3d.js/blob/dev/examples/geometry_builder_lines.html

type Pt = [number, number, number];

/** 2D Hilbert 曲线（点落在 y = cy 的 XZ 平面上）。移植自 t3d CurveUtils.hilbert2D。 */
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

  // 演示路径数据：2D Hilbert 曲线（XZ 平面），参考 t3d geometry_builder_lines 示例。
  const basePoints = hilbert2D(0, 0, 0, 4, 1, 0, 1, 2, 3);

  const params = {
    mode: 'tube' as 'tube' | 'plane',
    bevelRadius: 0.5,
    size: 0.2,          // tube=radius / plane=width
    close: false,
    sharp: true,
    arrow: false,
    caps: true,
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
    });
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
    <label class="check"><input type="checkbox" id="inp-p-caps" checked>封盖 caps <em>(tube)</em></label>`;

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

  startLoop(renderer, scene, camera, resize, () => {});
}
