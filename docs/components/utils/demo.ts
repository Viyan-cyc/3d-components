import * as THREE from 'three';
import { Util } from '../../../src/utils/index';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- Utils Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): void {
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
