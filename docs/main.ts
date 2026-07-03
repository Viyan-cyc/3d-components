import * as THREE from 'three';
import gsap from 'gsap';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import 'highlight.js/styles/github.css';
import { BaseGroup } from '../src/core/BaseGroup';
import { Wall } from '../src/core/Wall';
import { Path } from '../src/core/Path';
import { HeatMesh } from '../src/heat/HeatMesh';
import { ShinyMaterial } from '../src/material/ShinyMaterial';
import { Util } from '../src/utils/index';
import { createScene, startLoop, addSimpleOrbit } from './shared/scene-setup';

import './style.css';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('bash', bash);

// ===================== SIDEBAR FOLDERS =====================
document.querySelectorAll<HTMLButtonElement>('.nav-folder').forEach((btn) => {
  btn.addEventListener('click', () => {
    const group = btn.parentElement!;
    group.classList.toggle('open');
    // expand parent group when opening a folder
    if (group.classList.contains('open')) {
      group.querySelectorAll<HTMLElement>('.nav-group').forEach((g) => g.classList.add('open'));
    }
  });
});

// ===================== SIDEBAR SEARCH =====================
const searchInput = document.getElementById('search') as HTMLInputElement;
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  const tree = document.getElementById('nav-tree')!;

  if (!q) {
    // Show all
    tree.querySelectorAll('.nav-item, .nav-group, .nav-fn, .nav-label, .nav-divider, .nav-folder').forEach((el) => {
      (el as HTMLElement).style.display = '';
    });
    // Re-collapse groups
    tree.querySelectorAll('.nav-group').forEach((g) => g.classList.remove('open'));
    return;
  }

  // Hide everything first
  tree.querySelectorAll('.nav-item, .nav-group, .nav-fn, .nav-label, .nav-divider').forEach((el) => {
    (el as HTMLElement).style.display = 'none';
  });
  tree.querySelectorAll<HTMLElement>('.nav-folder').forEach((el) => { el.style.display = 'none'; });

  // Show matching items and their parents
  tree.querySelectorAll<HTMLElement>('.nav-page, .nav-fn').forEach((el) => {
    const text = (el.dataset.search || el.textContent || '').toLowerCase();
    if (text.includes(q)) {
      el.style.display = '';
      // Show parent group
      const group = el.closest('.nav-group');
      if (group) {
        group.style.display = '';
        group.classList.add('open');
        const folder = group.querySelector<HTMLElement>('.nav-folder');
        if (folder) folder.style.display = '';
        // Show labels in between
        group.querySelectorAll<HTMLElement>('.nav-label').forEach((l) => { l.style.display = ''; });
      }
      // Show dividers before visible elements
      const prevDivider = el.parentElement?.previousElementSibling;
      if (prevDivider?.classList.contains('nav-divider')) {
        (prevDivider as HTMLElement).style.display = '';
      }
    }
  });
});

// ===================== HASH ROUTER =====================
const demoInited: Record<string, boolean> = {};
let activePage = '';

function showPage(name: string) {
  if (name === activePage) return;
  activePage = name;

  // Toggle pages
  document.querySelectorAll('.page').forEach((p) => {
    p.classList.toggle('active', p.id === `page-${name}`);
  });

  // Highlight sidebar nav
  document.querySelectorAll('.nav-page').forEach((a) => {
    a.classList.toggle('active', (a as HTMLElement).dataset.page === name);
  });

  // Syntax highlight code blocks on the newly active page
  const page = document.getElementById(`page-${name}`);
  if (page) page.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el as HTMLElement));

  // Lazy-init demo
  if (!demoInited[name] && name !== 'guide') {
    initDemo(name);
  }
}

function navigateTo(name: string) {
  window.location.hash = name;
}

// Bind sidebar nav clicks
document.querySelectorAll('.nav-page').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo((a as HTMLElement).dataset.page!);
  });
});

// Bind hash change
window.addEventListener('hashchange', () => {
  showPage(getPageFromHash());
});

function getPageFromHash(): string {
  const h = window.location.hash.replace('#', '');
  return h || 'guide';
}

// ===================== DEMO INIT =====================
function initDemo(name: string) {
  if (demoInited[name]) return;
  demoInited[name] = true;

  switch (name) {
    case 'basegroup': initBaseGroupDemo(); break;
    case 'wall': initWallDemo(); break;
    case 'path': initPathDemo(); break;
    case 'heatmesh': initHeatMeshDemo(); break;
    case 'shinymaterial': initShinyMaterialDemo(); break;
    case 'utils': initUtilsDemo(); break;
  }
}

// ---- BaseGroup Demo ----
function initBaseGroupDemo() {
  const canvas = document.getElementById('c-basegroup') as HTMLCanvasElement;
  const ctrl = document.getElementById('ctrl-basegroup')!;
  const { renderer, scene, camera, resize } = createScene(canvas);

  const grp = new BaseGroup({ name: 'DemoGroup', scale: 1.5 });
  const knot = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.5, 0.15, 64, 16),
    new THREE.MeshStandardMaterial({ color: 0xe94560, roughness: 0.25, metalness: 0.1 }),
  );
  knot.castShadow = true; knot.position.y = 0.4;
  grp.add(knot);
  scene.add(grp);
  addSimpleOrbit(canvas, camera);

  ctrl.innerHTML = `
    <label><span>Scale: <code id="v-bg-s">1.5</code></span>
    <input type="range" id="inp-bg-s" min="0.5" max="3" step="0.1" value="1.5"></label>
    <button id="btn-bg-r">Reset</button>`;

  ctrl.querySelector('#inp-bg-s')!.addEventListener('input', (e) => {
    const v = +(e.target as HTMLInputElement).value;
    grp.scale.setScalar(v);
    ctrl.querySelector('#v-bg-s')!.textContent = v.toFixed(1);
  });
  ctrl.querySelector('#btn-bg-r')!.addEventListener('click', () => {
    grp.position.set(0, 0, 0); grp.rotation.set(0, 0, 0);
  });

  startLoop(renderer, scene, camera, resize, (dt) => {
    grp.update(dt);
    grp.rotation.y += dt * 0.5;
  });
}

/**
 * 程序生成一面「窗户」贴图：墙底色 + 一扇带窗框 / 中梃的窗。
 * 画布纵向按墙高设计：窗台约在 35% 墙高、窗顶约在 81% 墙高（建筑常规比例）。
 * repeat 模式下 `repeat.y = 1 / height`，让一个 tile 恰好铺满整墙高度 → 窗位始终正确。
 */
function makeWindowTexture(): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  // 墙体底色
  ctx.fillStyle = '#e6ddca';
  ctx.fillRect(0, 0, s, s);
  // 窗户区域（画布 y 从顶部算；窗顶 0.19s、窗台 0.65s ≈ 墙高 81% / 35%）
  const winLeft = s * 0.12;
  const winRight = s * 0.88;
  const winTop = s * 0.19;
  const winBottom = s * 0.65;
  const w = winRight - winLeft;
  const h = winBottom - winTop;
  // 玻璃（自上而下渐变）
  const grad = ctx.createLinearGradient(0, winTop, 0, winBottom);
  grad.addColorStop(0, '#aacbe0');
  grad.addColorStop(1, '#6e94ad');
  ctx.fillStyle = grad;
  ctx.fillRect(winLeft, winTop, w, h);
  // 中梃（十字分格）
  ctx.strokeStyle = '#e6ddca';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(winLeft + w / 2, winTop); ctx.lineTo(winLeft + w / 2, winBottom);
  ctx.moveTo(winLeft, winTop + h / 2); ctx.lineTo(winRight, winTop + h / 2);
  ctx.stroke();
  // 窗框
  ctx.strokeStyle = '#5b5246';
  ctx.lineWidth = 8;
  ctx.strokeRect(winLeft, winTop, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

// ---- Wall Demo ----
function initWallDemo() {
  const canvas = document.getElementById('c-wall') as HTMLCanvasElement;
  const ctrl = document.getElementById('ctrl-wall')!;
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
  const wallTexture = makeWindowTexture();
  // 四个拐角（按 path 顶点顺序）：左前 / 右前 / 右后 / 左后
  const corners = ['左前', '右前', '右后', '左后'];
  const params = {
    height: 2.6, corners: [1, 1, 1, 1], close: true, door: true,
    texture: true, uvMode: 'repeat' as 'repeat' | 'stretch',
  };
  let wall: Wall | null = null;

  function rebuild() {
    if (wall) { scene.remove(wall); wall.dispose(); }
    // 门洞在第 0 段（前墙 [-3,-2]→[3,-2]）的立面上：沿墙 1.5~2.5m、高 0~2.1m，贯通墙体厚度
    const hole = params.door
      ? [{ segment: 0, path: [[1.5, 0], [2.5, 0], [2.5, 2.1], [1.5, 2.1]] as [number, number][], radius: 0.1 }]
      : [];
    wall = new Wall({
      walls: [{
        // 6×4 矩形房间（围绕原点）
        path: [[-3, 0, -2], [3, 0, -2], [3, 0, 2], [-3, 0, 2]],
        width: 0.25,
        height: params.height,
        radius: params.corners,           // 每个拐角单独的半径数组
        radiusSegments: 16,
        close: params.close,
        uvMode: params.uvMode,            // repeat=按米平铺 / stretch=一张铺满
        hole,
      }],
      material: wallMaterial,
    });
    // 贴图：repeat 模式下 u/v 为米，一个窗模块 = 1.5m 宽 × 整墙高；
    // stretch 模式下 u/v 已归一化，一张贴图铺满整面墙。
    if (params.texture) {
      wallTexture.repeat.set(
        params.uvMode === 'stretch' ? 1 : 1 / 1.5,
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

  const cornerSliders = corners
    .map(
      (name, i) =>
        `<label><span>${name}: <code id="v-wall-c${i}">1.00</code></span>` +
        `<input type="range" class="inp-wall-corner" data-idx="${i}" min="0" max="2" step="0.05" value="1"></label>`,
    )
    .join('');

  ctrl.innerHTML = `
    <label><span>高度 Height: <code id="v-wall-h">2.6</code></span>
    <input type="range" id="inp-wall-h" min="1" max="4" step="0.1" value="2.6"></label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px">${cornerSliders}</div>
    <label class="check"><input type="checkbox" id="inp-wall-c" checked>闭合 close</label>
    <label class="check"><input type="checkbox" id="inp-wall-d" checked>门洞 hole</label>
    <label class="check"><input type="checkbox" id="inp-wall-t" checked>贴图 texture</label>
    <label><span>UV:</span>
      <select id="sel-wall-uv">
        <option value="repeat" selected>repeat · 按米平铺</option>
        <option value="stretch">stretch · 铺满整墙</option>
      </select></label>`;

  ctrl.querySelector('#inp-wall-h')!.addEventListener('input', (e) => {
    params.height = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-wall-h')!.textContent = params.height.toFixed(1);
    rebuild();
  });
  ctrl.querySelectorAll<HTMLInputElement>('.inp-wall-corner').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const idx = +(t.dataset.idx ?? '0');
      params.corners[idx] = +t.value;
      ctrl.querySelector(`#v-wall-c${idx}`)!.textContent = params.corners[idx].toFixed(2);
      rebuild();
    });
  });
  ctrl.querySelector('#inp-wall-c')!.addEventListener('change', (e) => {
    params.close = (e.target as HTMLInputElement).checked;
    rebuild();
  });
  ctrl.querySelector('#inp-wall-d')!.addEventListener('change', (e) => {
    params.door = (e.target as HTMLInputElement).checked;
    rebuild();
  });
  ctrl.querySelector('#inp-wall-t')!.addEventListener('change', (e) => {
    params.texture = (e.target as HTMLInputElement).checked;
    rebuild();
  });
  ctrl.querySelector('#sel-wall-uv')!.addEventListener('change', (e) => {
    params.uvMode = (e.target as HTMLSelectElement).value as 'repeat' | 'stretch';
    rebuild();
  });

  startLoop(renderer, scene, camera, resize, () => {});
}

// ---- Path Demo ----
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

/**
 * 程序化贴图：棋盘底 + 中央指向 +U 的箭头。
 * repeat 模式下沿路径反复平铺（能看到多个小箭头），stretch 模式下一张铺满整条路径（一个大箭头）。
 * wrapS = RepeatWrapping：Path 在 repeat 模式下 u 会超过 1，靠它自动平铺。
 */
function makePathTexture(): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#4a90e2'; ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#cfe0f7';
  const n = 4;
  const cell = s / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if ((x + y) % 2 === 0) ctx.fillRect(x * cell, y * cell, cell, cell);
  // 中央箭头（指向 +U = 沿路径方向）
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(s * 0.72, s * 0.5);
  ctx.lineTo(s * 0.3, s * 0.28);
  ctx.lineTo(s * 0.3, s * 0.72);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function initPathDemo() {
  const canvas = document.getElementById('c-path') as HTMLCanvasElement;
  const ctrl = document.getElementById('ctrl-path')!;
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

// ---- HeatMesh Demo ----
function initHeatMeshDemo() {
  const canvas = document.getElementById('c-heatmesh') as HTMLCanvasElement;
  const ctrl = document.getElementById('ctrl-heatmesh')!;
  const { renderer, scene, camera, resize } = createScene(canvas);

  const hGrp = new THREE.Group(); scene.add(hGrp);
  const heats: HeatMesh[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const h = new HeatMesh({ count: 32, radius: 0.35, intensity: 0.3 + Math.random() * 0.4 });
    h.position.set(Math.cos(a) * 2.5, 0, Math.sin(a) * 2.5);
    h.castShadow = true; hGrp.add(h); heats.push(h);
  }
  addSimpleOrbit(canvas, camera);

  ctrl.innerHTML = `
    <label><span>Intensity: <code id="v-hm">0.7</code></span>
    <input type="range" id="inp-hm" min="0.1" max="1" step="0.05" value="0.7"></label>
    <button id="btn-hm-pulse">GSAP Pulse</button>
    <button id="btn-hm-rand">Randomize</button>`;

  ctrl.querySelector('#inp-hm')!.addEventListener('input', (e) => {
    const v = +(e.target as HTMLInputElement).value;
    ctrl.querySelector('#v-hm')!.textContent = v.toFixed(2);
    heats.forEach((h) => h.setIntensity(v));
  });
  ctrl.querySelector('#btn-hm-pulse')!.addEventListener('click', () => {
    heats.forEach((h, i) => gsap.to(h, {
      heatIntensity: 1, duration: 0.3, delay: i * 0.04, yoyo: true, repeat: 3, ease: 'power2.inOut',
      onUpdate: () => { (h.material as THREE.MeshBasicMaterial).opacity = h.heatIntensity; },
    }));
  });
  ctrl.querySelector('#btn-hm-rand')!.addEventListener('click', () => {
    heats.forEach((h, i) => gsap.to(h, {
      heatIntensity: 0.2 + Math.random() * 0.8, duration: 0.5, delay: i * 0.03, ease: 'power2.out',
      onUpdate: () => { (h.material as THREE.MeshBasicMaterial).opacity = h.heatIntensity; },
    }));
  });

  startLoop(renderer, scene, camera, resize, (dt) => {
    hGrp.rotation.y += dt * 0.3;
    heats.forEach((h) => h.update(dt));
  });
}

// ---- ShinyMaterial Demo ----
function initShinyMaterialDemo() {
  const canvas = document.getElementById('c-shinymaterial') as HTMLCanvasElement;
  const ctrl = document.getElementById('ctrl-shinymaterial')!;
  const { renderer, scene, camera, resize } = createScene(canvas);

  const colors = [0xe94560, 0x0f3460, 0x533483, 0xf5c542, 0x00bcd4];
  const mats: ShinyMaterial[] = [];
  const balls: THREE.Mesh[] = [];
  colors.forEach((c, i) => {
    const mat = new ShinyMaterial({ color: c, metalness: 0.1 + i * 0.15, roughness: 0.1 + i * 0.1 });
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 64, 64), mat);
    m.position.set((i - 2) * 1.3, 0.5, 0);
    m.castShadow = m.receiveShadow = true;
    scene.add(m); mats.push(mat); balls.push(m);
  });
  addSimpleOrbit(canvas, camera);

  let sel = 2;
  ctrl.innerHTML = `
    <label><span>Metalness: <code id="v-sm-m">0.30</code></span>
    <input type="range" id="inp-sm-m" min="0" max="1" step="0.01" value="0.30"></label>
    <label><span>Roughness: <code id="v-sm-r">0.20</code></span>
    <input type="range" id="inp-sm-r" min="0" max="1" step="0.01" value="0.20"></label>
    <label><span>Target:</span>
    <select id="sel-sm">${['Red','Navy','Purple','Gold','Cyan'].map((n,i)=>`<option value="${i}"${i===2?' selected':''}>${n}</option>`).join('')}</select></label>
    <button id="btn-sm-all">Apply to All</button>`;

  function sync() {
    (ctrl.querySelector('#inp-sm-m') as HTMLInputElement).value = String(mats[sel].metalness);
    (ctrl.querySelector('#inp-sm-r') as HTMLInputElement).value = String(mats[sel].roughness);
    ctrl.querySelector('#v-sm-m')!.textContent = mats[sel].metalness.toFixed(2);
    ctrl.querySelector('#v-sm-r')!.textContent = mats[sel].roughness.toFixed(2);
  }
  ctrl.querySelector('#inp-sm-m')!.addEventListener('input', (e) => {
    mats[sel].setShininess(+(e.target as HTMLInputElement).value, mats[sel].roughness);
    ctrl.querySelector('#v-sm-m')!.textContent = mats[sel].metalness.toFixed(2);
  });
  ctrl.querySelector('#inp-sm-r')!.addEventListener('input', (e) => {
    mats[sel].setShininess(mats[sel].metalness, +(e.target as HTMLInputElement).value);
    ctrl.querySelector('#v-sm-r')!.textContent = mats[sel].roughness.toFixed(2);
  });
  ctrl.querySelector('#sel-sm')!.addEventListener('change', (e) => { sel = +(e.target as HTMLSelectElement).value; sync(); });
  ctrl.querySelector('#btn-sm-all')!.addEventListener('click', () => {
    mats.forEach((m) => m.setShininess(mats[sel].metalness, mats[sel].roughness));
  });

  startLoop(renderer, scene, camera, resize, (dt) => {
    balls.forEach((b, i) => {
      b.rotation.y += dt * (0.3 + i * 0.1);
      b.position.y = 0.5 + Math.sin(performance.now() * 0.001 + i) * 0.2;
    });
  });
}

// ---- Utils Demo ----
function initUtilsDemo() {
  const canvas = document.getElementById('c-utils') as HTMLCanvasElement;
  const ctrl = document.getElementById('ctrl-utils')!;
  const { renderer, scene, camera, resize } = createScene(canvas);

  const ptGroup = new THREE.Group(); scene.add(ptGroup);
  let cloud: THREE.Points | null = null;

  function build(mode: string) {
    if (cloud) { cloud.geometry.dispose(); (cloud.material as THREE.Material).dispose(); ptGroup.remove(cloud); }
    let pts: { x: number; y: number; z: number }[];
    switch (mode) {
      case 'sphere': pts = Util.createSphere(2, 500); break;
      case 'circle': pts = Util.createCircle(2, 300); break;
      case 'spiral': pts = Util.createSpiral(6, 80, 2.5); break;
      case 'grid':   pts = Util.createGrid(20, 20, 0.25); break;
      default:       pts = Util.createSphere(2, 500);
    }
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(pts.length * 3);
    const col = new Float32Array(pts.length * 3);
    pts.forEach((p, i) => {
      pos[i*3]=p.x; pos[i*3+1]=p.y; pos[i*3+2]=p.z;
      const d = Math.sqrt(p.x*p.x+p.y*p.y+p.z*p.z);
      const t = Util.clamp(d/2.5,0,1);
      const hsl = Util.hslToRgb(0.6-t*0.5, 0.9, 0.3+t*0.4);
      col[i*3]=hsl.r; col[i*3+1]=hsl.g; col[i*3+2]=hsl.b;
    });
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    cloud = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.04, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    ptGroup.add(cloud);
  }
  build('sphere');
  addSimpleOrbit(canvas, camera);

  ctrl.innerHTML = `
    <label><span>Pattern:</span>
    <select id="sel-util"><option value="sphere" selected>Fibonacci Sphere</option><option value="circle">Circle</option><option value="spiral">Spiral</option><option value="grid">Grid</option></select></label>
    <p class="info">Colored by <code>Util.hslToRgb()</code> + <code>Util.clamp()</code>. Drag to orbit.</p>`;

  ctrl.querySelector('#sel-util')!.addEventListener('change', (e) => build((e.target as HTMLSelectElement).value));

  startLoop(renderer, scene, camera, resize, () => {
    ptGroup.rotation.y += 0.003;
    ptGroup.rotation.x += 0.001;
  });
}

// ===================== INIT =====================
// Expand all nav groups by default
document.querySelectorAll('.nav-group').forEach((g) => g.classList.add('open'));

// Show initial page
showPage(getPageFromHash());
