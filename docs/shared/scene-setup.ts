import * as THREE from 'three';

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

/** Orbit-like rotation around Y axis via pointer drag + wheel zoom */
export function addSimpleOrbit(
  canvas: HTMLCanvasElement,
  camera: THREE.Object3D,
  getTarget?: () => THREE.Vector3,
) {
  let mode: 'none' | 'rotate' | 'pan' = 'none';
  let prevX = 0;
  let prevY = 0;
  const t0 = getTarget?.() ?? new THREE.Vector3(0, 0, 0);
  let angle = Math.atan2(camera.position.z - t0.z, camera.position.x - t0.x);
  const target = () => getTarget?.() ?? t0;
  const MIN_DIST = 0.5;
  const MAX_DIST = 30;

  // Prevent right-click context menu on canvas
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    prevX = e.clientX;
    prevY = e.clientY;
    // Right button or Shift+left → pan; left button → rotate
    if (e.button === 2 || e.shiftKey) {
      mode = 'pan';
      canvas.style.cursor = 'grabbing';
    } else if (e.button === 0) {
      mode = 'rotate';
    }
  });

  window.addEventListener('pointerup', () => {
    mode = 'none';
    canvas.style.cursor = '';
  });

  window.addEventListener('pointermove', (e) => {
    if (mode === 'none') return;
    const dx = e.clientX - prevX;
    const dy = e.clientY - prevY;
    prevX = e.clientX;
    prevY = e.clientY;

    if (mode === 'rotate') {
      angle += dx * 0.005;

      const t = target();
      const dxz = camera.position.x - t.x;
      const dz = camera.position.z - t.z;
      const r = Math.sqrt(dxz * dxz + dz * dz);
      camera.position.x = t.x + Math.cos(angle) * r;
      camera.position.z = t.z + Math.sin(angle) * r;
      camera.lookAt(t);
    } else if (mode === 'pan') {
      const t = target();
      const dist = camera.position.distanceTo(t);
      const speed = dist * 0.002;

      // Camera-local axes in world space
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();

      const offset = right.multiplyScalar(-dx * speed).add(up.multiplyScalar(dy * speed));
      camera.position.add(offset);
      // Also move target so orbit stays centered on same world point
      if (!getTarget) t0.add(offset);
      camera.lookAt(target());
    }
  });

  // Wheel / pinch zoom
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const t = target();
    const dir = camera.position.clone().sub(t);
    const dist = dir.length();
    const zoom = 1 + e.deltaY * 0.001;
    const newDist = Math.max(MIN_DIST, Math.min(MAX_DIST, dist * zoom));
    dir.normalize().multiplyScalar(newDist);
    camera.position.copy(t).add(dir);
  }, { passive: false });
}
