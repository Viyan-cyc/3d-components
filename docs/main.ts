import * as THREE from 'three';
import gsap from 'gsap';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import 'highlight.js/styles/github.css';
import { BaseGroup } from '../src/core/BaseGroup';
import { Wall } from '../src/core/Wall';
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
  // 四个拐角（按 path 顶点顺序）：左前 / 右前 / 右后 / 左后
  const corners = ['左前', '右前', '右后', '左后'];
  const params = { height: 2.6, corners: [1, 1, 1, 1], close: true, door: true };
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
        hole,
      }],
      material: wallMaterial,
    });
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
    <label class="check"><input type="checkbox" id="inp-wall-d" checked>门洞 hole</label>`;

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
