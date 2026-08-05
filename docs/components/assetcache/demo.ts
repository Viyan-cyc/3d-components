import * as THREE from 'three';
import { AssetCache } from '../../../src/loader/AssetCache';
import { createScene, createGround, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

const MODEL_URL = '/components/assetcache/DamagedHelmet.glb';
const MODEL_KEY = 'helmet';
const UV_URL = '/uv.jpg';
const UV_KEY = 'uv';
const MODEL_HEIGHT = 3;

// ---- AssetCache Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): (() => void) | void {
  const { renderer, scene, camera, resize } = createScene(canvas);
  scene.add(createGround());

  camera.position.set(5, 3, 7);
  camera.lookAt(0, MODEL_HEIGHT / 2, 0);

  const orbit = addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, MODEL_HEIGHT / 2, 0));
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.05;
  orbit.minDistance = 2;
  orbit.maxDistance = 25;

  const cache = new AssetCache();
  cache.registerModel(MODEL_KEY, MODEL_URL);
  cache.registerTexture(UV_KEY, UV_URL);

  const mixers: THREE.AnimationMixer[] = [];
  const added: THREE.Object3D[] = [];
  let slot = 0;
  let plane: THREE.Mesh | null = null;
  const planes: THREE.Mesh[] = [];
  let shallowCount = 0;
  let deepCount = 0;

  // ---- 控制面板 ----
  ctrl.style.maxWidth = '360px';
  ctrl.innerHTML = `
    <div class="info" id="ac-status" style="display:flex;gap:12px">
      <span id="ac-status-model" style="flex:1;min-width:0">准备加载模型…</span>
      <span id="ac-status-tex" style="flex:1;min-width:0">准备加载贴图…</span>
    </div>
    <div class="info" id="ac-state" style="display:flex;gap:12px;margin-top:6px;font-size:11px">
      <span id="ac-state-model" style="flex:1;min-width:0"></span>
      <span id="ac-state-tex" style="flex:1;min-width:0"></span>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px">
      <div style="flex:1;min-width:150px">
        <div style="font-weight:600;font-size:12px;margin-bottom:4px">模型</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button id="ac-load">加载模型 loadModel</button>
          <button id="ac-loadurl">按URL加载 loadModelFromUrl</button>
          <button id="ac-clone">浅克隆 cloneModel</button>
          <button id="ac-deep">深克隆改色 cloneModel</button>
          <button id="ac-preloadModel">预加载 preloadModel</button>
          <button id="ac-remove">删除模型</button>
          <button id="ac-clearModel">清缓存 clearModel</button>
          <button id="ac-disposeModel">释放 disposeModel</button>
        </div>
      </div>
      <div style="flex:1;min-width:150px">
        <div style="font-weight:600;font-size:12px;margin-bottom:4px">贴图</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button id="ac-loadTex">加载贴图 loadTexture</button>
          <button id="ac-loadTexUrl">按URL加载 loadTextureFromUrl</button>
          <button id="ac-cloneMatShallow">浅克隆 cloneMaterial</button>
          <button id="ac-cloneMatDeep">深克隆改色 cloneMaterial</button>
          <button id="ac-preloadTex">预加载 preloadTexture</button>
          <button id="ac-removePlane">删除平面</button>
          <button id="ac-clearTex">清缓存 clearTexture</button>
          <button id="ac-disposeTex">释放 disposeTexture</button>
        </div>
      </div>
    </div>
    <div class="info" style="margin-top:6px">贴图（uv.jpg）应用到场景中所有克隆体（独立材质）；预加载后台写入缓存，状态栏「加载」变 ✓。</div>
  `;
  const statusModelEl = ctrl.querySelector<HTMLElement>('#ac-status-model')!;
  const statusTexEl = ctrl.querySelector<HTMLElement>('#ac-status-tex')!;
  const stateModelEl = ctrl.querySelector<HTMLElement>('#ac-state-model')!;
  const stateTexEl = ctrl.querySelector<HTMLElement>('#ac-state-tex')!;

  function setModelMsg(msg: string): void {
    statusModelEl.textContent = msg;
  }

  function setTexMsg(msg: string): void {
    statusTexEl.textContent = msg;
  }

  function refreshState(): void {
    stateModelEl.textContent = `模型: 注册${cache.hasModel(MODEL_KEY) ? '✓' : '✗'} 加载${cache.isModelLoaded(MODEL_KEY) ? '✓' : '✗'} · 对象 ${added.length}`;
    stateTexEl.textContent = `贴图: 注册${cache.hasTexture(UV_KEY) ? '✓' : '✗'} 加载${cache.isTextureLoaded(UV_KEY) ? '✓' : '✗'} · 平面 ${(plane ? 1 : 0) + planes.length}`;
  }

  /** 缩放到目标高度并贴地，沿 x 偏移，开启阴影。 */
  function place(obj: THREE.Object3D, xOffset: number): void {
    obj.scale.setScalar(1);
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = MODEL_HEIGHT / Math.max(size.y, 1e-6);
    obj.scale.setScalar(s);
    obj.position.set(xOffset - center.x * s, -box.min.y * s, -center.z * s);
    obj.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
  }

  function playAnimations(root: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    if (!clips.length) {
      return;
    }
    const mixer = new THREE.AnimationMixer(root);
    clips.forEach((clip) => mixer.clipAction(clip).play());
    mixers.push(mixer);
  }

  function ensureAdded(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }): void {
    if (added.includes(gltf.scene)) {
      return;
    }
    place(gltf.scene, 0);
    scene.add(gltf.scene);
    added.push(gltf.scene);
    playAnimations(gltf.scene, gltf.animations);
  }

  /** 交替正负 x 位置，避免克隆体重叠。 */
  function nextSlot(): number {
    slot += 1;
    return slot % 2 === 0 ? slot * 2.5 : -slot * 2.5;
  }

  // ---- 模型 ----
  async function loadByKey(): Promise<void> {
    const t0 = performance.now();
    const gltf = await cache.loadModel(MODEL_KEY);
    const dt = performance.now() - t0;
    ensureAdded(gltf);
    setModelMsg(`loadModel('${MODEL_KEY}') · ${dt.toFixed(0)} ms · 动画 ${gltf.animations.length} 个`);
    refreshState();
  }

  async function loadByUrl(): Promise<void> {
    const t0 = performance.now();
    const gltf = await cache.loadModelFromUrl(MODEL_URL);
    const dt = performance.now() - t0;
    ensureAdded(gltf);
    setModelMsg(`loadModelFromUrl · ${dt.toFixed(0)} ms（无需注册，命中缓存）`);
    refreshState();
  }

  async function addShallowClone(): Promise<void> {
    const clone = await cache.cloneModel(MODEL_KEY);
    place(clone, nextSlot());
    scene.add(clone);
    added.push(clone);
    setModelMsg('cloneModel(key) · 浅拷贝，共享 geometry / material / texture');
    refreshState();
  }

  async function addDeepClone(): Promise<void> {
    const clone = await cache.cloneModel(MODEL_KEY);
    place(clone, nextSlot());
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      mesh.material = cache.cloneMaterial(mesh.material, { shareMaterial: false });
      (mesh.material as THREE.MeshStandardMaterial).color.set(0xe94560);
    });
    scene.add(clone);
    added.push(clone);
    setModelMsg('cloneModel + cloneMaterial({ shareMaterial: false }) · 独立材质改红');
    refreshState();
  }

  /** 确保平面存在：已存在则更新 map，不存在则创建（贴上 tex）。 */
  function ensurePlane(tex: THREE.Texture): void {
    if (plane) {
      (plane.material as THREE.MeshStandardMaterial).map = tex;
      (plane.material as THREE.MeshStandardMaterial).needsUpdate = true;
      return;
    }
    plane = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }),
    );
    plane.position.set(0, 1.5, -4);
    scene.add(plane);
  }

  /** 清空材质上所有贴图引用（map / normalMap / roughnessMap / metalnessMap / emissiveMap 等）。 */
  function clearAllTextures(material: THREE.Material): void {
    const props = material as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(props)) {
      if (value instanceof THREE.Texture) {
        (material as unknown as Record<string, THREE.Texture | null>)[key] = null;
      }
    }
    material.needsUpdate = true;
  }

  async function loadTexByKey(): Promise<void> {
    const tex = await cache.loadTexture(UV_KEY);
    ensurePlane(tex);
    setTexMsg(`loadTexture('${UV_KEY}') · uv.jpg 贴到平面`);
    refreshState();
  }

  async function loadTexByUrl(): Promise<void> {
    const tex = await cache.loadTextureFromUrl(UV_URL);
    ensurePlane(tex);
    setTexMsg(`loadTextureFromUrl · uv.jpg 贴到平面（无需注册）`);
    refreshState();
  }

  /** 浅克隆：新建平面，共享原材质（不改色，改色会串）。 */
  async function cloneMatShallow(): Promise<void> {
    if (!plane) {
      setTexMsg('平面未创建');
      return;
    }
    await cache.loadTexture(UV_KEY);
    const src = (plane as THREE.Mesh).material as THREE.Material;
    const mat = cache.cloneMaterial(src) as THREE.MeshStandardMaterial; // shareMaterial:true → 共享原材质
    shallowCount += 1;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    p.position.set(shallowCount * 2.5, 1.5, -4);
    scene.add(p);
    planes.push(p);
    setTexMsg('cloneMaterial() · 新平面共享原材质（不改色，改色会串）');
    refreshState();
  }

  /** 深克隆：新建平面，独立材质 + 独立 texture 改蓝（改色不串）。 */
  async function cloneMatDeep(): Promise<void> {
    if (!plane) {
      setTexMsg('平面未创建');
      return;
    }
    await cache.loadTexture(UV_KEY);
    const src = (plane as THREE.Mesh).material as THREE.Material;
    const mat = cache.cloneMaterial(src, { shareMaterial: false, shareTexture: false }) as THREE.MeshStandardMaterial;
    mat.color.set(0x4560e9);
    deepCount += 1;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    p.position.set(-deepCount * 2.5, 1.5, -4);
    scene.add(p);
    planes.push(p);
    setTexMsg('cloneMaterial({ shareMaterial: false, shareTexture: false }) · 新平面独立材质改蓝，改色不串');
    refreshState();
  }

  /** 初始化：加载模型与贴图平面，分别显示两者耗时。 */
  async function initLoad(): Promise<void> {
    const t0 = performance.now();
    const gltf = await cache.loadModel(MODEL_KEY);
    const dtM = performance.now() - t0;
    ensureAdded(gltf);
    const t1 = performance.now();
    const tex = await cache.loadTexture(UV_KEY);
    const dtT = performance.now() - t1;
    ensurePlane(tex);
    setModelMsg(`loadModel('${MODEL_KEY}') · ${dtM.toFixed(0)} ms · 动画 ${gltf.animations.length} 个`);
    setTexMsg(`loadTexture('${UV_KEY}') · ${dtT.toFixed(0)} ms`);
    refreshState();
  }

  function preloadM(): void {
    cache.preloadModel(MODEL_KEY);
    setModelMsg('preloadModel 已触发（后台加载，完成后「模型加载」变 ✓）');
    refreshState();
  }

  function preloadT(): void {
    cache.preloadTexture(UV_KEY);
    setTexMsg('preloadTexture 已触发（后台加载，完成后「贴图加载」变 ✓）');
    refreshState();
  }

  function removePlane(): void {
    if (plane) {
      scene.remove(plane);
      plane.geometry.dispose();
      (plane.material as THREE.Material).dispose();
      plane = null;
    }
    planes.forEach((p) => {
      scene.remove(p);
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    });
    planes.length = 0;
    shallowCount = 0;
    deepCount = 0;
    setTexMsg('所有平面已删除（贴图缓存保留）');
    refreshState();
  }

  function removeModels(): void {
    added.forEach((obj) => scene.remove(obj));
    added.length = 0;
    mixers.length = 0;
    slot = 0;
    setModelMsg('模型已从场景移除 · 缓存保留，重新 loadModel 瞬时命中');
    refreshState();
  }

  function clearM(): void {
    cache.clearModel(MODEL_KEY);
    setModelMsg('clearModel · 模型缓存已清，下次 loadModel 走网络');
    refreshState();
  }

  function clearT(): void {
    cache.clearTexture(UV_KEY);
    setTexMsg('clearTexture · 贴图缓存已清，下次 loadTexture 走网络');
    refreshState();
  }

  function disposeM(): void {
    cache.disposeModel(MODEL_KEY);
    added.forEach((obj) => scene.remove(obj));
    added.length = 0;
    mixers.length = 0;
    slot = 0;
    setModelMsg('disposeModel · 释放模型 GPU 资源并移除场景对象（缓存已清，下次 loadModel 走网络）');
    refreshState();
  }

  function disposeT(): void {
    cache.disposeTexture(UV_KEY);
    if (plane) {
      clearAllTextures((plane as THREE.Mesh).material as THREE.Material);
    }
    planes.forEach((p) => clearAllTextures((p as THREE.Mesh).material as THREE.Material));
    setTexMsg('disposeTexture · 释放贴图 GPU 并清空所有平面贴图引用（下次 loadTexture 走网络）');
    refreshState();
  }

  // ---- 绑定按钮 ----
  ctrl.querySelector('#ac-load')!.addEventListener('click', () => void loadByKey());
  ctrl.querySelector('#ac-loadurl')!.addEventListener('click', () => void loadByUrl());
  ctrl.querySelector('#ac-clone')!.addEventListener('click', () => void addShallowClone());
  ctrl.querySelector('#ac-deep')!.addEventListener('click', () => void addDeepClone());
  ctrl.querySelector('#ac-preloadModel')!.addEventListener('click', preloadM);
  ctrl.querySelector('#ac-remove')!.addEventListener('click', removeModels);
  ctrl.querySelector('#ac-clearModel')!.addEventListener('click', clearM);
  ctrl.querySelector('#ac-disposeModel')!.addEventListener('click', disposeM);
  ctrl.querySelector('#ac-loadTex')!.addEventListener('click', () => void loadTexByKey());
  ctrl.querySelector('#ac-loadTexUrl')!.addEventListener('click', () => void loadTexByUrl());
  ctrl.querySelector('#ac-cloneMatShallow')!.addEventListener('click', () => void cloneMatShallow());
  ctrl.querySelector('#ac-cloneMatDeep')!.addEventListener('click', () => void cloneMatDeep());
  ctrl.querySelector('#ac-preloadTex')!.addEventListener('click', preloadT);
  ctrl.querySelector('#ac-removePlane')!.addEventListener('click', removePlane);
  ctrl.querySelector('#ac-clearTex')!.addEventListener('click', clearT);
  ctrl.querySelector('#ac-disposeTex')!.addEventListener('click', disposeT);

  void initLoad();

  // ---- 渲染循环 ----
  const stop = startLoop(renderer, scene, camera, resize, (dt) => {
    for (const m of mixers) {
      m.update(dt);
    }
    orbit.update();
  });

  return () => {
    stop();
    mixers.forEach((m) => m.stopAllAction());
    added.forEach((obj) => scene.remove(obj));
    if (plane) {
      scene.remove(plane);
      plane.geometry.dispose();
      (plane.material as THREE.Material).dispose();
    }
    planes.forEach((p) => {
      scene.remove(p);
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    });
    cache.disposeAll();
  };
}
