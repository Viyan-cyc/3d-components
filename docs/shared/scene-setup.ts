import * as THREE from 'three';

/**
 * Minimal Three.js scene setup shared across all demos.
 * Returns everything needed for a render loop.
 */
export function createScene(canvas: HTMLCanvasElement, bgColor = 0x1a1a2e) {
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
  const ambient = new THREE.AmbientLight(0x404060, 1.2);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 5);
  dir.castShadow = true;
  scene.add(dir);

  // Ground grid
  const grid = new THREE.GridHelper(10, 20, 0x333355, 0x222244);
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

/** Orbit-like rotation around Y axis via pointer drag */
export function addSimpleOrbit(
  canvas: HTMLCanvasElement,
  camera: THREE.Object3D,
  getTarget?: () => THREE.Vector3,
) {
  let dragging = false;
  let prevX = 0;
  let angle = 0;
  const target = () => getTarget?.() ?? new THREE.Vector3(0, 0, 0);

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    prevX = e.clientX;
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - prevX;
    prevX = e.clientX;
    angle += dx * 0.005;

    const t = target();
    const r = camera.position.distanceTo(t);
    camera.position.x = t.x + Math.cos(angle) * r;
    camera.position.z = t.z + Math.sin(angle) * r;
    camera.lookAt(t);
  });
}
