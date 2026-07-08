import * as THREE from 'three';
import { Sky } from '../../../src/core/Sky';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- Sky Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): void {
  const { renderer, scene, camera, resize } = createScene(canvas, 0xf5f5f5);

  // 移除默认的 GridHelper
  scene.children
    .filter((c) => c instanceof THREE.GridHelper)
    .forEach((c) => scene.remove(c));

  // 天空穹顶
  const sky = new Sky({
    size: 500,
    topColor: 0x109df4,
    bottomColor: 0xf5f5f5,
    offset: 0,
    exponent: 0.6,
  });
  scene.add(sky);

  // 调整相机远裁剪面以容纳天空球
  camera.near = 0.1;
  camera.far = 1000;
  camera.updateProjectionMatrix();
  camera.position.set(0, 2, 8);
  camera.lookAt(0, 0, 0);

  addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 1, 0));

  // 控制面板
  const params = {
    topColor: '#109df4',
    bottomColor: '#f5f5f5',
    offset: 0,
    exponent: 0.6,
  };

  ctrl.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;align-items:center">
      <label class="check" style="justify-content:flex-start"><input type="color" id="inp-sky-top" value="${params.topColor}">天顶色</label>
      <label class="check" style="justify-content:flex-start"><input type="color" id="inp-sky-bottom" value="${params.bottomColor}">地平线色</label>
    </div>
    <label><span>偏移 offset: <code id="v-sky-offset">0</code></span>
    <input type="range" id="inp-sky-offset" min="0" max="100" step="1" value="0"></label>
    <label><span>渐变指数 exponent: <code id="v-sky-exp">0.6</code></span>
    <input type="range" id="inp-sky-exp" min="0.1" max="3.0" step="0.1" value="0.6"></label>`;

  // 颜色选择器
  ctrl.querySelector('#inp-sky-top')!.addEventListener('input', (e) => {
    params.topColor = (e.target as HTMLInputElement).value;
    sky.setTopColor(params.topColor);
  });
  ctrl.querySelector('#inp-sky-bottom')!.addEventListener('input', (e) => {
    params.bottomColor = (e.target as HTMLInputElement).value;
    sky.setBottomColor(params.bottomColor);
  });

  // 滑块
  const bind = (sel: string, valId: string, apply: (v: number) => void, fmt = (v: number) => v.toFixed(1)) => {
    ctrl.querySelector(sel)!.addEventListener('input', (e) => {
      const v = +(e.target as HTMLInputElement).value;
      ctrl.querySelector(`#${valId}`)!.textContent = fmt(v);
      apply(v);
    });
  };
  bind('#inp-sky-offset', 'v-sky-offset', (v) => sky.setOffset(v), (v) => v.toFixed(0));
  bind('#inp-sky-exp', 'v-sky-exp', (v) => sky.setExponent(v));

  startLoop(renderer, scene, camera, resize, () => {});
}
