import * as THREE from 'three';
import { HeatMap } from '../../../src/heat/HeatMap';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- HeatMap Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): () => void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  // Create heatmap texture generator
  const heatMap = new HeatMap({ width: 512, height: 512, radius: 60, opacity: 0.85 });

  // Generate random data points
  function generateData(count: number) {
    const data = [];
    for (let i = 0; i < count; i++) {
      data.push({
        x: Math.random() * 512,
        y: Math.random() * 512,
        value: 20 + Math.random() * 80,
      });
    }
    return data;
  }

  let currentPointCount = 30;
  heatMap.setData({ max: 100, data: generateData(currentPointCount) });

  // Apply heatmap texture to a plane
  const planeGeo = new THREE.PlaneGeometry(8, 8);
  const planeMat = new THREE.MeshBasicMaterial({
    map: heatMap.texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = 0.01;
  scene.add(plane);

  addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 0, 0));

  // Controls
  ctrl.innerHTML = `
    <label><span>Radius: <code id="v-hm-rd">60</code></span>
    <input type="range" id="inp-hm-rd" min="10" max="120" step="5" value="60"></label>
    <label><span>Opacity: <code id="v-hm-op">0.85</code></span>
    <input type="range" id="inp-hm-op" min="0.1" max="1" step="0.05" value="0.85"></label>
    <label><span>Points: <code id="v-hm-pts">30</code></span>
    <input type="range" id="inp-hm-pts" min="5" max="80" step="5" value="30"></label>
    <button id="btn-hm-clear">清空</button>
    <button id="btn-hm-add">添加热点</button>
    <label><span>配色方案</span>
    <select id="sel-hm-grad">
      <option value="default">蓝→绿→黄→红</option>
      <option value="fire">黑→红→黄→白</option>
      <option value="ocean">深蓝→青→白</option>
      <option value="purple">黑→紫→粉→白</option>
    </select></label>`;

  // Radius slider — instant re-render
  ctrl.querySelector('#inp-hm-rd')!.addEventListener('input', (e) => {
    const v = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-hm-rd')!.textContent = String(v);
    heatMap.setRadius(v);
  });

  // Opacity slider — instant re-render
  ctrl.querySelector('#inp-hm-op')!.addEventListener('input', (e) => {
    const v = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-hm-op')!.textContent = v.toFixed(2);
    heatMap.setOpacity(v);
  });

  // Points slider — re-generate data with new count
  ctrl.querySelector('#inp-hm-pts')!.addEventListener('input', (e) => {
    currentPointCount = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-hm-pts')!.textContent = String(currentPointCount);
    heatMap.setData({ max: 100, data: generateData(currentPointCount) });
  });

  // Clear button
  ctrl.querySelector('#btn-hm-clear')!.addEventListener('click', () => {
    heatMap.clear();
  });

  // Add single point
  ctrl.querySelector('#btn-hm-add')!.addEventListener('click', () => {
    heatMap.addData({
      x: Math.random() * 512,
      y: Math.random() * 512,
      value: 40 + Math.random() * 60,
    });
  });

  // Gradient selector
  const gradients: Record<string, Record<number, string>> = {
    default: { 0.25: 'rgb(0,0,255)', 0.55: 'rgb(0,255,0)', 0.85: 'rgb(255,255,0)', 1.0: 'rgb(255,0,0)' },
    fire: { 0.0: 'rgb(0,0,0)', 0.33: 'rgb(200,0,0)', 0.66: 'rgb(255,200,0)', 1.0: 'rgb(255,255,255)' },
    ocean: { 0.0: 'rgb(0,0,80)', 0.5: 'rgb(0,180,180)', 1.0: 'rgb(255,255,255)' },
    purple: { 0.0: 'rgb(0,0,0)', 0.33: 'rgb(128,0,200)', 0.66: 'rgb(255,100,200)', 1.0: 'rgb(255,255,255)' },
  };

  ctrl.querySelector('#sel-hm-grad')!.addEventListener('change', (e) => {
    const key = (e.target as HTMLSelectElement).value;
    heatMap.setGradient(gradients[key]);
  });

  const stop = startLoop(renderer, scene, camera, resize, () => {});

  return () => {
    stop();
    heatMap.dispose();
    planeGeo.dispose();
    planeMat.dispose();
  };
}
