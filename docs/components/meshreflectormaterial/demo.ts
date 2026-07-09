import * as THREE from 'three';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { MeshReflectorMaterial } from '../../../src/material/MeshReflectorMaterial';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- MeshReflectorMaterial Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): (() => void) | void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  // ---- Reflector floor ----
  const reflectorMat = new MeshReflectorMaterial({
    mirror: 0.6,
    mixBlur: 1,
    mixStrength: 0.7,
    mixContrast: 1.0,
    blur: [300, 100],
    resolution: 512,
    color: 0xbbbbbb,
    roughness: 0.3,
  });
  const floorGeo = new THREE.PlaneGeometry(12, 12);
  const floor = new THREE.Mesh(floorGeo, reflectorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1;
  reflectorMat.bindToMesh(floor);
  scene.add(floor);

  // ---- Scene objects to reflect ----
  const objects: THREE.Mesh[] = [];

  // A single sphere
  const sphereMat = new THREE.MeshStandardMaterial({
    color: 0xe94560,
    metalness: 0.3,
    roughness: 0.4,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 32), sphereMat);
  sphere.position.set(0, 0.4, -1);
  sphere.castShadow = true;
  scene.add(sphere);
  objects.push(sphere);

  // ---- "Hello" text lying flat on the ground ----
  const fontLoader = new FontLoader();
  const textMat = new THREE.MeshStandardMaterial({
    color: 0xf5c542,
    metalness: 0.5,
    roughness: 0.3,
  });
  let textMesh: THREE.Mesh | null = null;
  fontLoader.load('/components/meshreflectormaterial/helvetiker_regular.typeface.json', (font) => {
    const textGeo = new TextGeometry('Hello', {
      font,
      size: 0.8,
      depth: 0.15,
      curveSegments: 8,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.015,
      bevelSegments: 3,
    });
    textGeo.center();
    textMesh = new THREE.Mesh(textGeo, textMat);
    // Stand upright facing the camera
    textMesh.position.set(0, -1 + 0.8, 1.5);
    textMesh.castShadow = true;
    scene.add(textMesh);
    objects.push(textMesh);
  });

  // Lights
  const pointLight = new THREE.PointLight(0xffffff, 0.8, 10);
  pointLight.position.set(3, 3, 2);
  scene.add(pointLight);

  const pointLight2 = new THREE.PointLight(0xffffff, 0.8, 10);
  pointLight2.position.set(-3, 3, -2);
  scene.add(pointLight2);

  // ---- Orbit controls ----
  const orbit = addSimpleOrbit(canvas, camera);
  orbit.target.set(0, 0, 0);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.05;
  orbit.update();

  // ---- Controls UI ----
  ctrl.innerHTML = `
    <label><span>Mirror: <code id="v-mirror">0.60</code></span>
    <input type="range" id="inp-mirror" min="0" max="1" step="0.01" value="0.60"></label>
    <label><span>MixBlur: <code id="v-mixblur">1.00</code></span>
    <input type="range" id="inp-mixblur" min="0" max="1" step="0.01" value="1.00"></label>
    <label><span>Strength: <code id="v-strength">0.70</code></span>
    <input type="range" id="inp-strength" min="0" max="2" step="0.01" value="0.70"></label>
    <label><span>Contrast: <code id="v-contrast">1.00</code></span>
    <input type="range" id="inp-contrast" min="0.5" max="2" step="0.01" value="1.00"></label>
    <label><span>Roughness: <code id="v-rough">0.30</code></span>
    <input type="range" id="inp-rough" min="0" max="1" step="0.01" value="0.30"></label>
  `;

  // Bind controls
  ctrl.querySelector('#inp-mirror')!.addEventListener('input', (e) => {
    const v = +(e.target as HTMLInputElement).value;
    reflectorMat.setMirror(v);
    ctrl.querySelector('#v-mirror')!.textContent = v.toFixed(2);
  });
  ctrl.querySelector('#inp-mixblur')!.addEventListener('input', (e) => {
    const v = +(e.target as HTMLInputElement).value;
    reflectorMat.setMixBlur(v);
    ctrl.querySelector('#v-mixblur')!.textContent = v.toFixed(2);
  });
  ctrl.querySelector('#inp-strength')!.addEventListener('input', (e) => {
    const v = +(e.target as HTMLInputElement).value;
    reflectorMat.setMixStrength(v);
    ctrl.querySelector('#v-strength')!.textContent = v.toFixed(2);
  });
  ctrl.querySelector('#inp-contrast')!.addEventListener('input', (e) => {
    const v = +(e.target as HTMLInputElement).value;
    reflectorMat.setMixContrast(v);
    ctrl.querySelector('#v-contrast')!.textContent = v.toFixed(2);
  });
  ctrl.querySelector('#inp-rough')!.addEventListener('input', (e) => {
    const v = +(e.target as HTMLInputElement).value;
    reflectorMat.roughness = v;
    reflectorMat.needsUpdate = true;
    ctrl.querySelector('#v-rough')!.textContent = v.toFixed(2);
  });

  // ---- Render loop ----
  let running = true;
  let last = performance.now();

  function frame() {
    if (!running) return;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    resize();

    // Animate objects
    const t = now * 0.001;
    // Bounce the sphere
    sphere.position.y = 0.4 + Math.sin(t * 1.5) * 0.3;
    sphere.rotation.y += dt * 0.5;
    // Slowly spin the text on the floor
    if (textMesh) textMesh.rotation.y += dt * 0.3;

    orbit.update();

    // Update reflection before main render
    reflectorMat.updateBeforeRender(renderer, scene, camera as THREE.PerspectiveCamera);
    renderer.render(scene, camera);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  // Return cleanup function
  return () => {
    running = false;
    reflectorMat.dispose();
    floorGeo.dispose();
    objects.forEach((obj) => {
      (obj as THREE.Mesh).geometry.dispose();
      ((obj as THREE.Mesh).material as THREE.Material).dispose();
    });
  };
}
