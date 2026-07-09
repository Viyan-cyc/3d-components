import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Minimal Three.js scene setup shared across all demos.
 * Returns everything needed for a render loop.
 *
 * **Demo style guide (keep consistent across all demos):**
 * - Background: default light grey `0xe8ecf1`; avoid dark backgrounds.
 * - No `GridHelper` — use the library `Grid` component or a real ground plane.
 * - Ground plane (when needed): use {@link createGround} for a unified look.
 * - Lighting: a neutral ambient + directional key light (set up here).
 */
export function createScene(canvas: HTMLCanvasElement, bgColor = 0xe8ecf1) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bgColor);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(4, 2.5, 6);
  camera.lookAt(0, 0, 0);

  // Ambient + directional light
  const ambient = new THREE.AmbientLight(0x8899aa, 0.8);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(5, 10, 5);
  dir.castShadow = true;
  scene.add(dir);

  // Handle resize
  function resize() {
    const parent = canvas.parentElement!;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    }
  }

  return { renderer, scene, camera, resize };
}

/**
 * Create the standard demo ground plane — a large, light, matte floor
 * that catches shadows. Shared across demos so the floor always looks
 * the same. The caller owns disposal of the returned mesh's geometry
 * and material.
 *
 * @param size - Side length of the (square) ground plane. @default 40
 */
export function createGround(size = 40): THREE.Mesh {
  const ground = new THREE.Mesh(
    size === 40
      ? GROUND_GEOMETRY
      : new THREE.PlaneGeometry(size, size),
    GROUND_MATERIAL,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  return ground;
}

// Shared geometry/material so every demo floor is identical.
const GROUND_GEOMETRY = new THREE.PlaneGeometry(40, 40);
const GROUND_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xeef0f3,
  roughness: 1,
  metalness: 0,
});

/**
 * Start a standard render loop with auto-resize.
 * Returns a stop function.
 */
export function startLoop(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  resize: () => void,
  tick: (dt: number) => void,
) {
  let last = performance.now();
  let running = true;

  function frame() {
    if (!running) return;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1); // cap dt
    last = now;

    resize();
    tick(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  return () => {
    running = false;
  };
}

/**
 * Orbit controls — a thin wrapper around three.js' built-in `OrbitControls`.
 *
 * - Left drag      → orbit (yaw + pitch)
 * - Right drag     → pan
 * - Wheel / pinch  → dolly zoom
 *
 * Returns the `OrbitControls` instance so callers can tweak it further.
 * (Enable `controls.enableDamping` and call `controls.update()` in the render
 * loop if you want inertia.)
 */
export function addSimpleOrbit(
  canvas: HTMLCanvasElement,
  camera: THREE.Object3D,
  getTarget?: () => THREE.Vector3,
): OrbitControls {
  const controls = new OrbitControls(camera as THREE.Camera, canvas);
  controls.target.copy(getTarget?.() ?? new THREE.Vector3(0, 0, 0));
  controls.minDistance = 0.5;
  controls.maxDistance = 30;
  controls.update();
  return controls;
}
