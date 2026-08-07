import * as THREE from 'three';
import { AssetCache } from '../../../src/loader/AssetCache';
import { MaterialManager } from '../../../src/material/MaterialManager';
import { createScene, createGround, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

const UV_URL = '/uv.jpg';
const BOX_GAP = 2.4;

// ---- MaterialManager Demo ----
// 4 个 box 对比材质/贴图的 4 种共享组合,每个可改颜色 / repeat,验证影响范围。
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): (() => void) | void {
  const { renderer, scene, camera, resize } = createScene(canvas);
  scene.add(createGround());

  camera.position.set(0, 3.5, 9);
  camera.lookAt(0, 0.6, 0);
  const orbit = addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 0.6, 0));
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.05;

  const cache = new AssetCache();
  const boxGeo = new THREE.BoxGeometry(1.6, 1.2, 1.6);
  const emptyMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

  const boxes: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(boxGeo);
    m.position.set((i - 1.5) * BOX_GAP, 0.8, 0);
    m.castShadow = true;
    scene.add(m);
    boxes.push(m);
  }

  // ---- 控制面板(DOM 先就绪)----
  ctrl.style.maxWidth = '460px';
  ctrl.innerHTML = `
    <div class="info" id="mm-status" style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;align-items:center">
      <span id="mm-theme">theme: red</span>
      <span>占位色: <input type="color" id="mm-ph" value="#444444" style="width:42px;height:20px;vertical-align:middle"></span>
      <button id="mm-applyPh">应用占位色</button>
      <button id="mm-reload">重载贴图(演示占位)</button>
    </div>
    <div class="info" id="mm-msg" style="margin-top:4px;font-size:11px;min-height:14px"></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
      <button id="mm-red">切换 red 主题</button>
      <button id="mm-blue">切换 blue 主题</button>
      <button id="mm-dis1" title="共享材质不释放,Box1 仍可换肤(Box2 继续用同一材质)">dispose Box1(copy)</button>
      <button id="mm-dis4" title="释放独立材质+贴图,Box4 材质失效变黑(脱离管理)">dispose Box4(clone贴图clone)</button>
      <button id="mm-disAll">manager.dispose</button>
    </div>
    <table class="pt" style="margin-top:8px;font-size:11px">
      <thead><tr><th>Box</th><th>模式</th><th>改颜色</th><th>改repeat</th><th>当前</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>材质copy(共享)</td><td><button id="mm-c1">颜色</button></td><td><button id="mm-r1">repeat</button></td><td id="mm-s1">-</td></tr>
        <tr><td>2</td><td>材质copy(共享)</td><td><button id="mm-c2">颜色</button></td><td><button id="mm-r2">repeat</button></td><td id="mm-s2">-</td></tr>
        <tr><td>3</td><td>材质clone,贴图copy</td><td><button id="mm-c3">颜色</button></td><td><button id="mm-r3">repeat</button></td><td id="mm-s3">-</td></tr>
        <tr><td>4</td><td>材质clone,贴图clone</td><td><button id="mm-c4">颜色</button></td><td><button id="mm-r4">repeat</button></td><td id="mm-s4">-</td></tr>
      </tbody>
    </table>
    <div class="info" style="margin-top:6px;font-size:11px">
      改颜色看材质共享(Box1↔2 联动),改 repeat 看贴图共享(Box1/2/3 联动,Box4 独立)。占位色 + 重载看贴图未就绪占位。dispose 说明悬停按钮。
    </div>
  `;

  const themeEl = ctrl.querySelector<HTMLElement>('#mm-theme')!;
  const msgEl = ctrl.querySelector<HTMLElement>('#mm-msg')!;
  const phInput = ctrl.querySelector<HTMLInputElement>('#mm-ph')!;

  function setMsg(msg: string): void {
    msgEl.textContent = msg;
  }

  // ---- MaterialManager(可重建,用于演示占位)----
  let mm = buildManager(0x444444);
  let unsubs: Array<() => void> = [];
  let mats: THREE.MeshStandardMaterial[] = [];
  let subsState: boolean[] = [false, false, false, false];

  function buildManager(placeholderColor: number): MaterialManager {
    return new MaterialManager({
      themes: {
        red: { box: { type: 'standard', color: 0xe94560, roughness: 0.4, metalness: 0.1, map: { url: UV_URL, colorSpace: THREE.SRGBColorSpace } } },
        blue: { box: { type: 'standard', color: 0x4560e9, roughness: 0.2, metalness: 0.4, map: { url: UV_URL, colorSpace: THREE.SRGBColorSpace } } },
      },
      current: 'red',
      assetCache: cache,
      placeholderColor,
      onError: (k, e) => setMsg(`[err] ${k}: ${(e as Error).message}`),
    });
  }

  // copy/clone 4 个 box;Box1/2 共享材质,Box3 clone(true),Box4 clone(false)
  function setupBoxes(): void {
    unsubs = [];
    subsState = [false, false, false, false];
    unsubs.push(mm.copy('box', (mat, reason) => { if (reason === 'init') boxes[0].material = mat; }));
    unsubs.push(mm.copy('box', (mat, reason) => { if (reason === 'init') boxes[1].material = mat; }));
    unsubs.push(mm.clone('box', (mat, reason) => { if (reason === 'init') boxes[2].material = mat; }, true));
    unsubs.push(mm.clone('box', (mat, reason) => { if (reason === 'init') boxes[3].material = mat; }, false));
    mats = boxes.map((b) => b.material as THREE.MeshStandardMaterial);
  }
  setupBoxes();

  function randColor(): number {
    return Math.floor(Math.random() * 0xffffff);
  }
  function randRepeat(): [number, number] {
    return [1 + Math.floor(Math.random() * 4), 1 + Math.floor(Math.random() * 4)];
  }

  function setColor(i: number): void {
    const c = randColor();
    mats[i].color.set(c);
    setMsg(`Box${i + 1} 颜色改 → ${c.toString(16).padStart(6, '0')}(观察共享 / 独立)`);
    refresh();
  }
  function setRepeat(i: number): void {
    const r = randRepeat();
    const m = mats[i];
    if (m.map) {
      m.map.repeat.set(r[0], r[1]);
      setMsg(`Box${i + 1} repeat 改 → ${r[0]},${r[1]}(观察贴图共享 / 独立)`);
    } else {
      setMsg(`Box${i + 1} 贴图未就绪,稍后再试`);
    }
    refresh();
  }

  function refresh(): void {
    themeEl.textContent = `theme: ${mm.getTheme()}`;
    for (let i = 0; i < 4; i++) {
      const m = mats[i];
      const col = m ? m.color.getHexString() : '-';
      const rep = m && m.map ? `${m.map.repeat.x.toFixed(0)},${m.map.repeat.y.toFixed(0)}` : '无贴图';
      const state = subsState[i] ? '已dispose' : '活跃';
      ctrl.querySelector<HTMLElement>(`#mm-s${i + 1}`)!.textContent = `${col} ${rep} [${state}]`;
    }
  }

  function bind(id: string, fn: () => void): void {
    ctrl.querySelector<HTMLElement>(id)!.addEventListener('click', fn);
  }

  bind('#mm-c1', () => setColor(0));
  bind('#mm-c2', () => setColor(1));
  bind('#mm-c3', () => setColor(2));
  bind('#mm-c4', () => setColor(3));
  bind('#mm-r1', () => setRepeat(0));
  bind('#mm-r2', () => setRepeat(1));
  bind('#mm-r3', () => setRepeat(2));
  bind('#mm-r4', () => setRepeat(3));

  bind('#mm-red', () => { void mm.setTheme('red').then(refresh); });
  bind('#mm-blue', () => { void mm.setTheme('blue').then(refresh); });
  bind('#mm-applyPh', () => {
    const hex = parseInt(phInput.value.slice(1), 16);
    mm.setPlaceholderColor(hex);
    setMsg(`占位色已改为 ${phInput.value}(点「重载贴图」看效果)`);
  });
  bind('#mm-reload', () => {
    // 重建 manager:新材质 mat.map 为 null,贴图重新加载时触发占位
    unsubs.forEach((u) => u());
    mm.dispose();
    cache.clearAll();
    const ph = parseInt(phInput.value.slice(1), 16);
    mm = buildManager(ph);
    setupBoxes();
    setMsg('贴图已重载,观察占位色 → 就绪恢复');
    refresh();
  });
  bind('#mm-dis1', () => {
    const u = unsubs[0];
    if (u && !subsState[0]) { u(); subsState[0] = true; setMsg('Box1 订阅已 dispose —— 共享材质未释放,Box1 仍可换肤(Box2 继续用同一材质)'); refresh(); }
  });
  bind('#mm-dis4', () => {
    const u = unsubs[3];
    if (u && !subsState[3]) {
      u();
      subsState[3] = true;
      boxes[3].material = emptyMat;
      mats[3] = emptyMat as unknown as THREE.MeshStandardMaterial;
      setMsg('Box4 dispose:材质 program + owned Texture 已释放');
      refresh();
    }
  });
  bind('#mm-disAll', () => {
    mm.dispose();
    for (let i = 0; i < 4; i++) {
      boxes[i].material = emptyMat;
      mats[i] = emptyMat as unknown as THREE.MeshStandardMaterial;
      subsState[i] = true;
    }
    setMsg('manager.dispose:所有材质 program 释放;owned Texture 释放,共享贴图归 AssetCache');
    refresh();
  });

  const stop = startLoop(renderer, scene, camera, resize, () => { orbit.update(); });
  const texTimer = window.setInterval(refresh, 500);
  refresh();

  return () => {
    window.clearInterval(texTimer);
    unsubs.forEach((u) => u());
    mm.dispose();
    cache.disposeAll();
    boxGeo.dispose();
    orbit.dispose();
    stop();
  };
}
