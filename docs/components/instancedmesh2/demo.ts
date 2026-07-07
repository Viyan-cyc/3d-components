import * as THREE from 'three';
import { InstancedMesh2 } from '../../../src/core/InstancedMesh2';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ============================================================
// Low-poly tree geometries — 4 LOD levels
// L4 (finest) → L1 (coarsest)
// Each geometry carries vertex colors: brown trunk + green crown.
// ============================================================

const TRUNK_COLOR = new THREE.Color(0x6b4226);
const CROWN_COLOR = new THREE.Color(0x3ba55d);

/** Merge geometries into a single non-indexed BufferGeometry with vertex colors. */
function mergeGeometriesWithColor(
  parts: { geo: THREE.BufferGeometry; color: THREE.Color }[],
): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  const allPositions: number[] = [];
  const allNormals: number[] = [];
  const allColors: number[] = [];

  for (const { geo, color } of parts) {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const norm = geo.getAttribute('normal') as THREE.BufferAttribute;
    const idx = geo.getIndex();
    const r = color.r, g = color.g, b = color.b;

    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        const vi = idx.getX(i);
        allPositions.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
        allNormals.push(norm.getX(vi), norm.getY(vi), norm.getZ(vi));
        allColors.push(r, g, b);
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        allPositions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        allNormals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
        allColors.push(r, g, b);
      }
    }
    geo.dispose();
  }

  merged.setAttribute('position', new THREE.Float32BufferAttribute(allPositions, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(allNormals, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(allColors, 3));
  return merged;
}

function T(geo: THREE.BufferGeometry) { return { geo, color: TRUNK_COLOR }; }
function C(geo: THREE.BufferGeometry) { return { geo, color: CROWN_COLOR }; }

/** L4 — 最精致：3层圆锥树冠 + 圆柱树干 (scaled ×0.5) */
function createTreeL4(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.06, 0.09, 0.6, 8); trunk.translate(0, 0.3, 0);
  const c1 = new THREE.ConeGeometry(0.5, 0.7, 8); c1.translate(0, 1.0, 0);
  const c2 = new THREE.ConeGeometry(0.4, 0.6, 8); c2.translate(0, 1.4, 0);
  const c3 = new THREE.ConeGeometry(0.25, 0.45, 8); c3.translate(0, 1.7, 0);
  return mergeGeometriesWithColor([T(trunk), C(c1), C(c2), C(c3)]);
}

/** L3 — 中等：2层圆锥 + 树干 */
function createTreeL3(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.07, 0.1, 0.6, 6); trunk.translate(0, 0.3, 0);
  const c1 = new THREE.ConeGeometry(0.45, 0.9, 6); c1.translate(0, 1.1, 0);
  const c2 = new THREE.ConeGeometry(0.28, 0.5, 6); c2.translate(0, 1.6, 0);
  return mergeGeometriesWithColor([T(trunk), C(c1), C(c2)]);
}

/** L2 — 简化：单层圆锥 + 树干 */
function createTreeL2(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.08, 0.11, 0.5, 5); trunk.translate(0, 0.25, 0);
  const crown = new THREE.ConeGeometry(0.42, 1.2, 5); crown.translate(0, 1.2, 0);
  return mergeGeometriesWithColor([T(trunk), C(crown)]);
}

/** L1 — 最简：4面锥体 + 细树干 */
function createTreeL1(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.09, 0.12, 0.4, 4); trunk.translate(0, 0.2, 0);
  const crown = new THREE.ConeGeometry(0.35, 1.4, 4); crown.translate(0, 1.1, 0);
  return mergeGeometriesWithColor([T(trunk), C(crown)]);
}

// ============================================================
// Concentric rings — 从中心向外同心圆扩散排列
// ============================================================

/**
 * Generate positions on concentric rings, from center outward.
 * Each ring has circumference / spacing trees, with slight angular jitter.
 * Returns exactly `count` positions, sorted by distance from center (inner first).
 * Spacing ensures no overlap between adjacent trees on the same ring
 * and between trees on neighboring rings.
 */
function concentricRings2D(
  spacing: number,   // minimum distance between any two trees
  count: number,     // exact number of positions to generate
  rng = Math.random,
): [number, number][] {
  const points: [number, number][] = [];

  // First tree at center
  points.push([0, 0]);

  let ringRadius = spacing; // first ring radius

  while (points.length < count) {
    // Number of trees on this ring: circumference / spacing
    const circumference = 2 * Math.PI * ringRadius;
    const treesOnRing = Math.max(6, Math.floor(circumference / spacing));

    // Angular step + small jitter
    const angleStep = (2 * Math.PI) / treesOnRing;

    for (let i = 0; i < treesOnRing && points.length < count; i++) {
      const angle = angleStep * i + (rng() - 0.5) * angleStep * 0.5;
      const x = ringRadius * Math.cos(angle);
      const z = ringRadius * Math.sin(angle);
      points.push([x, z]);
    }

    ringRadius += spacing;
  }

  return points;
}

// ============================================================
// Demo
// ============================================================
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): () => void {
  const { renderer, scene, camera, resize } = createScene(canvas, 0xeef2f5);

  // Remove defaults, set up warm lighting
  scene.children
    .filter((c) => c instanceof THREE.GridHelper)
    .forEach((c) => scene.remove(c));
  scene.children
    .filter((c) => c instanceof THREE.AmbientLight || c instanceof THREE.DirectionalLight)
    .forEach((c) => scene.remove(c));

  const ambient = new THREE.AmbientLight(0xffeedd, 1.2);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
  sun.position.set(8, 18, 6);
  sun.castShadow = false; // too expensive for 100k
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xa8c4e0, 0x8a7a5a, 0.4);
  scene.add(hemi);

  camera.near = 0.5;
  camera.far = 1200;
  camera.updateProjectionMatrix();
  camera.position.set(5, 20, 80);
  camera.lookAt(0, 2, 0);

  // ---- Scene parameters ----
  const TREE_SPACING = 3.0; // min distance between trees
  const MAX_COUNT = 100000;

  // ---- Ground plane (circular to match concentric layout) ----
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(600, 64),
    new THREE.MeshStandardMaterial({ color: 0xb8a88a, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // ---- Tree geometries (4 LOD levels, with vertex colors) ----
  const geoL4 = createTreeL4();
  const geoL3 = createTreeL3();
  const geoL2 = createTreeL2();
  const geoL1 = createTreeL1();

  // Material with vertexColors — trunk brown & crown green baked into geometry
  const treeMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.75,
    metalness: 0.0,
  });

  // ---- Generate concentric ring positions (exactly MAX_COUNT) ----
  const positions = concentricRings2D(TREE_SPACING, MAX_COUNT);
  const TOTAL = positions.length;

  // ---- InstancedMesh2 with LOD ----
  const mesh = new InstancedMesh2(geoL4, treeMat, {
    capacity: TOTAL,
    createEntities: true,
    allowsEuler: true,
    renderer,
  });

  mesh.setFirstLODDistance(0);
  mesh.addLOD(geoL3, treeMat, 25);   // L3: 25 units
  mesh.addLOD(geoL2, treeMat, 70);   // L2: 70 units
  mesh.addLOD(geoL1, treeMat, 160);  // L1: 160 units

  // Place ALL instances at jittered grid positions
  mesh.addInstances(TOTAL, (obj, i) => {
    const [x, z] = positions[i];
    obj.position.set(x, 0, z);
    const s = 0.8 + Math.random() * 0.5;
    obj.scale.set(s, s, s);
    obj.rotation.y = Math.random() * Math.PI * 2;
    obj.updateMatrix();
  });

  // Per-instance color tint variation — multiply vertex color for natural diversity
  const tempColor = new THREE.Color();
  for (let i = 0; i < mesh.instancesCount; i++) {
    // Warm/cool random tint: slightly shift hue per tree
    const hue = 0.28 + (Math.random() - 0.5) * 0.06;  // around green
    const sat = 0.55 + Math.random() * 0.25;
    const lig = 0.35 + Math.random() * 0.2;
    tempColor.setHSL(hue, sat, lig);
    mesh.setColorAt(i, tempColor);
  }

  mesh.computeBVH({ getBBoxFromBSphere: true });
  mesh.receiveShadow = true;
  scene.add(mesh);

  // ---- Dynamic instance count ----
  // All instances exist; we toggle visibility to control count.
  let visibleCount = TOTAL;

  function setVisibleCount(count: number) {
    count = Math.max(0, Math.min(count, TOTAL));
    // Make newly visible instances active+visible
    for (let i = visibleCount; i < count; i++) {
      mesh.setActiveAndVisibilityAt(i, true);
    }
    // Hide instances beyond new count
    for (let i = count; i < visibleCount; i++) {
      mesh.setActiveAndVisibilityAt(i, false);
    }
    visibleCount = count;
  }

  // ---- Orbit controls ----
  const orbit = addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 2, 0));
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.screenSpacePanning = false;
  orbit.minDistance = 3;
  orbit.maxDistance = 600;
  orbit.maxPolarAngle = Math.PI * 0.48;
  orbit.target.set(0, 2, 0);

  // ---- LOD distance indicators (rings on ground) ----
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xd4c8a8, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
  const distances = [25, 70, 160];
  const rings: THREE.Mesh[] = [];
  distances.forEach((d) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(d - 0.15, d + 0.15, 64), ringMat.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    scene.add(ring);
    rings.push(ring);
  });

  // ---- Controls ----
  ctrl.innerHTML = `
    <div style="font-size:12px;color:#666;margin-bottom:6px">
      🌲 低模树 LOD 演示 — 拉远/靠近相机观察细节切换
    </div>
    <div id="lod-stats" style="font-size:11px;line-height:1.6;color:#444;background:#f0f0f0;padding:6px 8px;border-radius:4px;margin-bottom:6px">
      生成中...
    </div>
    <label><span>实例数: <code id="v-count">${TOTAL.toLocaleString()}</code></span>
    <input type="range" id="inp-count" min="1" max="${TOTAL}" step="1" value="${TOTAL}"></label>
    <label><span>L3 距离: <code id="v-l3">25</code></span>
    <input type="range" id="inp-l3" min="5" max="60" step="1" value="25"></label>
    <label><span>L2 距离: <code id="v-l2">70</code></span>
    <input type="range" id="inp-l2" min="20" max="120" step="1" value="70"></label>
    <label><span>L1 距离: <code id="v-l1">160</code></span>
    <input type="range" id="inp-l1" min="50" max="300" step="1" value="160"></label>
    <label class="check"><input type="checkbox" id="inp-rings" checked>显示距离环</label>
    <label class="check"><input type="checkbox" id="inp-bvh" checked>BVH 加速</label>
    <label class="check"><input type="checkbox" id="inp-cull" checked>逐实例视锥裁剪</label>
  `;

  const countSlider = ctrl.querySelector('#inp-count') as HTMLInputElement;
  const l3Slider = ctrl.querySelector('#inp-l3') as HTMLInputElement;
  const l2Slider = ctrl.querySelector('#inp-l2') as HTMLInputElement;
  const l1Slider = ctrl.querySelector('#inp-l1') as HTMLInputElement;
  const ringsCheck = ctrl.querySelector('#inp-rings') as HTMLInputElement;
  const bvhCheck = ctrl.querySelector('#inp-bvh') as HTMLInputElement;
  const cullCheck = ctrl.querySelector('#inp-cull') as HTMLInputElement;
  const statsDiv = ctrl.querySelector('#lod-stats') as HTMLDivElement;

  // Instance count slider
  countSlider.addEventListener('input', () => {
    const n = +countSlider.value;
    ctrl.querySelector('#v-count')!.textContent = n.toLocaleString();
    setVisibleCount(n);
  });

  function updateLODDistances() {
    const d3 = +l3Slider.value, d2 = +l2Slider.value, d1 = +l1Slider.value;
    ctrl.querySelector('#v-l3')!.textContent = d3.toFixed(0);
    ctrl.querySelector('#v-l2')!.textContent = d2.toFixed(0);
    ctrl.querySelector('#v-l1')!.textContent = d1.toFixed(0);
    mesh.updateLOD(1, d3);
    mesh.updateLOD(2, d2);
    mesh.updateLOD(3, d1);
    [d3, d2, d1].forEach((d, i) => {
      rings[i].geometry.dispose();
      rings[i].geometry = new THREE.RingGeometry(d - 0.15, d + 0.15, 64);
    });
  }

  l3Slider.addEventListener('input', updateLODDistances);
  l2Slider.addEventListener('input', updateLODDistances);
  l1Slider.addEventListener('input', updateLODDistances);
  ringsCheck.addEventListener('change', () => rings.forEach((r) => { r.visible = ringsCheck.checked; }));
  bvhCheck.addEventListener('change', () => {
    if (bvhCheck.checked) mesh.computeBVH({ getBBoxFromBSphere: true });
    else mesh.disposeBVH();
  });
  cullCheck.addEventListener('change', () => { mesh.perObjectFrustumCulled = cullCheck.checked; });

  // ---- Render loop ----
  let running = true;
  let last = performance.now();

  function frame() {
    if (!running) return;
    const now = performance.now();
    last = now;

    resize();
    orbit.update();
    renderer.render(scene, camera);

    // Update LOD stats
    if (mesh.LODinfo) {
      const counts = mesh.LODinfo.render.count;
      const total = counts.reduce((a, b) => a + b, 0);
      statsDiv.innerHTML = mesh.LODinfo.render.levels.map((_, i) => {
        const label = i === 0 ? 'L4 (精致)' : i === 1 ? 'L3' : i === 2 ? 'L2' : 'L1 (简化)';
        const c = counts[i] || 0;
        const pct = total > 0 ? ((c / total) * 100).toFixed(1) : '0';
        return `<b>${label}</b>: ${c.toLocaleString()} (${pct}%)`;
      }).join('<br>') + `<br><b>总计渲染</b>: ${total.toLocaleString()} / ${visibleCount.toLocaleString()}`;
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  return () => {
    running = false;
    mesh.dispose();
    geoL4.dispose(); geoL3.dispose(); geoL2.dispose(); geoL1.dispose();
    rings.forEach((r) => { r.geometry.dispose(); });
    renderer.dispose();
  };
}
