import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Minimal Three.js scene setup shared across all demos.
 * Returns everything needed for a render loop.
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

  // Ground grid — darker for light bg
  const grid = new THREE.GridHelper(10, 20, 0xccd0d8, 0xdfe2e8);
  scene.add(grid);

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
