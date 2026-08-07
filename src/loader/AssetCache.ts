import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { IDisposable } from '../types';

// 开启 Three.js 文件层缓存：GLTFLoader / TextureLoader 内部的 FileLoader
// 会按 URL 缓存原始字节，避免同地址子资源重复网络请求。
THREE.Cache.enabled = true;

/**
 * 模型加载选项。
 */
export interface ModelLoadOptions {

  /**
   * 扩展 GLTFLoader，用于按需配置 DRACO / Meshopt / KTX2 等解码器。
   * 仅在该模型**首次**加载时生效。
   *
   * @example
   * ```ts
   * cache.registerModel('robot', '/models/robot.glb', {
   *   extendLoader: (loader) => {
   *     const draco = new DRACOLoader();
   *     draco.setDecoderPath('/libs/draco/');
   *     loader.setDRACOLoader(draco);
   *   },
   * });
   * ```
   */
  extendLoader?: (loader: GLTFLoader) => void;

  /** 加载进度回调。 */
  onProgress?: (event: ProgressEvent) => void;
}

/**
 * 贴图加载选项。
 */
export interface TextureLoadOptions {

  /** 颜色空间，用作颜色 / 漫反射贴图时通常设为 sRGB。 @default THREE.SRGBColorSpace */
  colorSpace?: THREE.ColorSpace;

  /** S 方向包裹模式。 @default THREE.ClampToEdgeWrapping */
  wrapS?: THREE.Wrapping;

  /** T 方向包裹模式。 @default THREE.ClampToEdgeWrapping */
  wrapT?: THREE.Wrapping;

  /** 各向异性过滤等级。 @default 1 */
  anisotropy?: number;

  /** 是否沿 Y 轴翻转。 @default true */
  flipY?: boolean;
}

/**
 * 克隆选项，控制克隆体与原始模型共享哪些资源。
 */
export interface CloneOptions {

  /**
   * 是否共享 geometry。`true` 共享引用（省内存），`false` 复制独立几何（可独立变形）。 @default true
   */
  shareGeometry?: boolean;

  /**
   * 是否共享 material。`true` 共享引用，`false` 复制独立材质（改色不串）。 @default true
   */
  shareMaterial?: boolean;

  /**
   * 是否共享 material 内的 texture。`true` 共享引用，`false` 复制独立 texture（改 repeat / offset / colorSpace 不串）。
   * 仅在 `shareMaterial: false` 时生效；独立 texture 的 image 数据仍共享。 @default true
   */
  shareTexture?: boolean;
}

/**
 * 生成器产物：用于按需生成（而非从 URL 加载）的模型，如 AI 生成。
 * 二选一：`bytes`（已拿到 glb 字节，走 `GLTFLoader.parse`）或 `src`（远程 URL，走 `GLTFLoader.load`）。
 */
export interface GeneratedModelResult {

  /** glb / gltf 字节，优先用此路径（不经过 THREE.Cache）。 */
  bytes?: ArrayBuffer;

  /** 远程 URL（生成器返回链接的情况）。 */
  src?: string;
}

/**
 * 模型生成器：按 key 生成一次，结果由 AssetCache 缓存。
 * 生成器只应在**首次**加载时被调用；并发与后续命中由 AssetCache 去重 / 缓存接管。
 */
export type ModelGenerator = () => Promise<GeneratedModelResult>;

interface RegistryEntry<T> {
  readonly url: string;
  readonly options?: T;
}

interface GeneratorEntry {
  readonly generator: ModelGenerator;
  readonly options?: ModelLoadOptions;
}

const DEFAULT_WRAP = THREE.ClampToEdgeWrapping;
const DEFAULT_ANISOTROPY = 1;

/**
 * AssetCache —— 模型与贴图的按需加载 / 内存缓存组件。
 *
 * 采用**两层缓存**：
 * 1. 文件层 —— `THREE.Cache` 缓存原始字节（开启即生效）；
 * 2. 对象层 —— 组件内部以 `Map<url, Promise>` 缓存解析后的 `GLTF` / `Texture`，
 *   避免重复的解析开销，并对并发请求做去重（同一 URL 只发起一次网络请求）。
 *
 * **使用流程：**
 * 1. `registerModel(key, url)` / `registerTexture(key, url)` 声明资源（不触发加载）；
 * 2. `loadModel(key)` / `loadTexture(key)` 按需加载 —— 首次发起网络请求并缓存，后续命中缓存**不再请求**；
 * 3. 同一模型多处复用时使用 `cloneModel(key)`，返回共享几何 / 材质的克隆体。
 *
 * **复用注意：**
 * - `loadModel(key)` 返回缓存中的**共享实例**。`Object3D` 只能有一个父节点，请勿直接
 *   加入多个父节点；需多处复用请用 `cloneModel(key)`。
 * - `cloneModel` 通过 `SkeletonUtils.clone` 浅拷贝，**共享** geometry / material / texture，
 *   修改材质会作用于所有实例。单独改色前请先 `material.clone()`。
 *
 * **释放注意：**
 * - `clearModel(key)` / `clearTexture(key)` 仅移除缓存引用，不释放 GPU 资源（安全，可重新加载）；
 * - `disposeModel(key)` / `disposeTexture(key)` 会释放 GPU 资源，若仍有克隆体 / 引用在用，
 *   它们将失效 —— 仅在确认无引用时调用。
 *
 * @example
 * ```ts
 * import { AssetCache } from '@a3d/a3d-components/loader';
 *
 * const cache = new AssetCache();
 *
 * // 1. 注册（不加载）
 * cache.registerModel('robot', '/models/robot.glb');
 * cache.registerTexture('metal', '/textures/metal.png');
 *
 * // 2. 按需加载（首次请求，之后命中缓存）
 * const robot = await cache.loadModel('robot');
 * scene.add(robot.scene);
 *
 * // 3. 克隆复用：默认浅拷贝（全共享），传 options 控制独立粒度
 * const a = await cache.cloneModel('robot');                           // 浅，全共享
 * const b = await cache.cloneModel('robot', { shareMaterial: false }); // 独立材质
 * scene.add(a);
 * scene.add(b);
 *
 * // 4. 贴图
 * const tex = await cache.loadTexture('metal');
 * material.map = tex;
 *
 * // 5. 从场景移除（缓存保留）与清理缓存
 * scene.remove(robot.scene);    // 仅移除显示，重新 loadModel 瞬时命中
 * cache.clearModel('robot');    // 移除缓存引用，重新 loadModel 走网络
 * ```
 *
 * Implements {@link IDisposable}.
 */
export class AssetCache implements IDisposable {
  private readonly modelCache = new Map<string, Promise<GLTF>>();
  private readonly textureCache = new Map<string, Promise<THREE.Texture>>();
  private readonly loadedModels = new Map<string, GLTF>();
  private readonly loadedTextures = new Map<string, THREE.Texture>();
  private readonly registry = new Map<string, RegistryEntry<ModelLoadOptions>>();
  private readonly textureRegistry = new Map<string, RegistryEntry<TextureLoadOptions>>();
  private readonly generatorRegistry = new Map<string, GeneratorEntry>();
  private readonly modelLoader = new GLTFLoader();
  private disposed = false;

  /**
   * 注册一个模型资源（仅声明，不加载）。
   * @param key - 资源键，后续 `loadModel(key)` / `cloneModel(key)` 使用。
   * @param url - 模型文件 URL（`.glb` / `.gltf`）。
   * @param options - 加载选项（仅首次加载时生效）。
   * @returns this，支持链式调用。
   */
  registerModel(key: string, url: string, options?: ModelLoadOptions): this {
    this.registry.set(key, { url, options });
    return this;
  }

  /**
   * 注册一个**生成器**模型资源（仅声明，不加载）。
   *
   * 用于按需生成的模型（如混元 AI 生成）：没有固定 URL，首次 `loadModel(key)` /
   * `cloneModel(key)` 时调用生成器取得 `bytes` 或 `src`，解析后缓存，后续命中直接复用。
   *
   * 并发与重复调用由 AssetCache 去重：同 key 共享一个 in-flight promise，生成器只被调用一次。
   * `options.extendLoader` 在**首次**解析时生效（如配置 DRACO）。
   * @param key - 资源键，后续 `loadModel(key)` / `cloneModel(key)` 使用。
   * @param generator - 生成器，返回 `{ bytes }` 或 `{ src }`。
   * @param options - 加载选项（仅首次解析时生效）。
   * @returns this，支持链式调用。
   */
  registerModelGenerator(key: string, generator: ModelGenerator, options?: ModelLoadOptions): this {
    this.generatorRegistry.set(key, { generator, options });
    return this;
  }

  /**
   * 注册一个贴图资源（仅声明，不加载）。
   * @param key - 资源键，后续 `loadTexture(key)` 使用。
   * @param url - 贴图文件 URL。
   * @param options - 加载选项（仅首次加载时生效）。
   * @returns this，支持链式调用。
   */
  registerTexture(key: string, url: string, options?: TextureLoadOptions): this {
    this.textureRegistry.set(key, { url, options });
    return this;
  }

  /**
   * 按需加载模型。首次发起网络请求并缓存解析结果，后续命中缓存直接返回，
   * **不再发起网络请求**。返回缓存中的共享 `GLTF` 实例。
   *
   * **注意：** 返回的是共享实例，请勿直接加入多个父节点，复用请用 {@link cloneModel}。
   * @param key - {@link registerModel} 时使用的键。
   */
  async loadModel(key: string): Promise<GLTF> {
    if (this.generatorRegistry.has(key)) {
      return this.loadModelFromGenerator(key);
    }
    const entry = this.registry.get(key);
    if (!entry) {
      throw new Error(`[AssetCache] 未注册的模型 key: "${key}"`);
    }
    return this.loadModelFromUrl(entry.url, entry.options);
  }

  /**
   * 直接按 URL 加载模型（无需注册）。同样命中 / 写入缓存。
   * @param url - 模型文件 URL。
   * @param options - 加载选项（仅首次加载时生效）。
   */
  async loadModelFromUrl(url: string, options?: ModelLoadOptions): Promise<GLTF> {
    this.assertNotDisposed();
    const cached = this.modelCache.get(url);
    if (cached) {
      return cached;
    }

    const promise = this.requestGLTF(url, options).then((gltf) => {
      this.loadedModels.set(url, gltf);
      return gltf;
    });
    // 缓存 Promise 而非结果，对并发请求去重：同一 URL 只发起一次网络请求。
    this.modelCache.set(url, promise);
    return promise;
  }

  /**
   * 按生成器 key 加载模型。生成器只在首次调用，结果（GLTF）按 key 缓存，
   * 后续命中直接复用，并发共享同一个 in-flight promise（生成器只被调用一次）。
   *
   * 生成器返回 `bytes` 走 `GLTFLoader.parse`（不经过 THREE.Cache），
   * 返回 `src` 走 `GLTFLoader.load`（与 URL 路径一致，命中 THREE.Cache）。
   */
  private async loadModelFromGenerator(key: string): Promise<GLTF> {
    this.assertNotDisposed();
    const cached = this.modelCache.get(key);
    if (cached) {
      return cached;
    }
    const entry = this.generatorRegistry.get(key);
    const promise = (async () => {
      const result = await entry!.generator();
      let gltf: GLTF;
      if (result.bytes) {
        gltf = await this.parseGLTFBytes(result.bytes, entry!.options);
      } else if (result.src) {
        gltf = await this.requestGLTF(result.src, entry!.options);
      } else {
        throw new Error(`[AssetCache] 生成器未返回 bytes 或 src: "${key}"`);
      }
      this.loadedModels.set(key, gltf);
      return gltf;
    })();
    // 缓存 Promise 而非结果，对并发去重：同 key 并发只调用一次生成器。
    this.modelCache.set(key, promise);
    return promise;
  }

  /** 把 glb 字节解析成 GLTF（不经过 THREE.Cache，用于生成器返回 bytes 的情况）。 */
  private parseGLTFBytes(bytes: ArrayBuffer, options?: ModelLoadOptions): Promise<GLTF> {
    const loader = this.getLoader(options);
    return new Promise<GLTF>((resolve, reject) => {
      loader.parse(bytes, '', resolve, reject);
    });
  }

  /**
   * 克隆模型，默认**最浅拷贝**（共享 geometry / material / texture，最省内存），
   * 可通过 options 控制哪些资源独立复制。支持骨骼动画。
   *
   * - `cloneModel(key)` —— 浅拷贝，全共享（与 three.js `Object3D.clone` 语义一致）。
   * - `cloneModel(key, { shareMaterial: false })` —— 共享 geometry，独立 material。
   * - `cloneModel(key, { shareGeometry: false, shareMaterial: false, shareTexture: false })` —— 深拷贝，全独立。
   *
   * **注意：** 共享材质时修改会作用于所有实例，需独立改色传 `shareMaterial: false` 或用 {@link cloneMaterial}。
   * @param key - {@link registerModel} 时使用的键。
   * @param options - 共享选项，默认全共享（最浅）。
   */
  async cloneModel(key: string, options?: CloneOptions): Promise<THREE.Object3D> {
    const gltf = await this.loadModel(key);
    return this.cloneObject3D(gltf.scene, {
      shareGeometry: options?.shareGeometry ?? true,
      shareMaterial: options?.shareMaterial ?? true,
      shareTexture: options?.shareTexture ?? true,
    });
  }

  /**
   * 按需加载贴图，命中缓存后**不再发起网络请求**。返回共享 `Texture` 实例。
   *
   * **注意：** Texture 可被多个材质共享引用；修改 `repeat` / `offset` / `colorSpace`
   * 会作用于所有引用处，如需独立修改请 `texture.clone()` 后再使用。
   * @param key - {@link registerTexture} 时使用的键。
   */
  async loadTexture(key: string): Promise<THREE.Texture> {
    const entry = this.textureRegistry.get(key);
    if (!entry) {
      throw new Error(`[AssetCache] 未注册的贴图 key: "${key}"`);
    }
    return this.loadTextureFromUrl(entry.url, entry.options);
  }

  /**
   * 直接按 URL 加载贴图（无需注册）。
   * @param url - 贴图文件 URL。
   * @param options - 加载选项（仅首次加载时生效）。
   */
  async loadTextureFromUrl(url: string, options?: TextureLoadOptions): Promise<THREE.Texture> {
    this.assertNotDisposed();
    const cached = this.textureCache.get(url);
    if (cached) {
      return cached;
    }

    const promise = this.requestTexture(url, options);
    this.textureCache.set(url, promise);
    return promise;
  }

  /**
   * 后台预加载模型（不返回结果，加载完成后自动进入缓存）。
   * 适合在空闲时预热，后续 `loadModel` 直接命中缓存。
   */
  preloadModel(key: string): void {
    void this.loadModel(key);
  }

  /** 后台预加载贴图。适合在空闲时预热，后续 `loadTexture` 直接命中缓存。 */
  preloadTexture(key: string): void {
    void this.loadTexture(key);
  }

  /** 是否已注册该模型（含 URL 注册与生成器注册）。 */
  hasModel(key: string): boolean {
    return this.registry.has(key) || this.generatorRegistry.has(key);
  }

  /** 是否已注册该生成器模型。 */
  hasModelGenerator(key: string): boolean {
    return this.generatorRegistry.has(key);
  }

  /** 是否已注册该贴图。 */
  hasTexture(key: string): boolean {
    return this.textureRegistry.has(key);
  }

  /** 模型是否已加载完成并进入缓存。 */
  isModelLoaded(key: string): boolean {
    if (this.generatorRegistry.has(key)) {
      return this.loadedModels.has(key);
    }
    const entry = this.registry.get(key);
    return entry ? this.loadedModels.has(entry.url) : false;
  }

  /** 贴图是否已加载完成并进入缓存。 */
  isTextureLoaded(key: string): boolean {
    const entry = this.textureRegistry.get(key);
    return entry ? this.loadedTextures.has(entry.url) : false;
  }

  /**
   * 移除指定模型的缓存引用（**不释放 GPU 资源**，安全）。
   * 之后再次 `loadModel` 会重新发起网络请求。
   * @returns this，支持链式调用。
   */
  clearModel(key: string): this {
    // 生成器条目无 url，按 key 直接清；不涉及 THREE.Cache（bytes 解析不经过它）。
    if (this.generatorRegistry.has(key)) {
      this.modelCache.delete(key);
      this.loadedModels.delete(key);
      return this;
    }
    const entry = this.registry.get(key);
    if (entry) {
      this.modelCache.delete(entry.url);
      this.loadedModels.delete(entry.url);
      THREE.Cache.remove(entry.url);
    }
    return this;
  }

  /**
   * 移除指定贴图的缓存引用（**不释放 GPU 资源**，安全）。
   * 之后再次 `loadTexture` 会重新发起网络请求。
   * @returns this，支持链式调用。
   */
  clearTexture(key: string): this {
    const entry = this.textureRegistry.get(key);
    if (entry) {
      this.textureCache.delete(entry.url);
      this.loadedTextures.delete(entry.url);
      THREE.Cache.remove(entry.url);
    }
    return this;
  }

  /** 移除所有模型与贴图的缓存引用（不释放 GPU 资源）。 */
  clearAll(): this {
    this.modelCache.clear();
    this.textureCache.clear();
    this.loadedModels.clear();
    this.loadedTextures.clear();
    this.generatorRegistry.clear();
    THREE.Cache.clear();
    return this;
  }

  /**
   * 释放指定模型的 GPU 资源并移除缓存。
   *
   * **警告：** 会释放原始模型的 geometry / material / texture。若仍有 {@link cloneModel}
   * 产生的克隆体在用（它们共享这些资源），克隆体将失效。仅在确认无引用时调用。
   * @returns this，支持链式调用。
   */
  disposeModel(key: string): this {
    // 生成器条目无 url，按 key 释放与清理。
    if (this.generatorRegistry.has(key)) {
      const gltf = this.loadedModels.get(key);
      if (gltf) {
        this.disposeObject3D(gltf.scene);
      }
      this.modelCache.delete(key);
      this.loadedModels.delete(key);
      return this;
    }
    const entry = this.registry.get(key);
    if (entry) {
      const gltf = this.loadedModels.get(entry.url);
      if (gltf) {
        this.disposeObject3D(gltf.scene);
      }
      this.modelCache.delete(entry.url);
      this.loadedModels.delete(entry.url);
      THREE.Cache.remove(entry.url);
    }
    return this;
  }

  /**
   * 释放指定贴图的 GPU 资源并移除缓存。
   * **警告：** 若该贴图仍被材质引用，引用处将失效。
   * @returns this，支持链式调用。
   */
  disposeTexture(key: string): this {
    const entry = this.textureRegistry.get(key);
    if (entry) {
      const tex = this.loadedTextures.get(entry.url);
      tex?.dispose();
      this.textureCache.delete(entry.url);
      this.loadedTextures.delete(entry.url);
      THREE.Cache.remove(entry.url);
    }
    return this;
  }

  /**
   * 释放所有模型与贴图的 GPU 资源并清空缓存。
   * 调用后该实例不可再使用。
   */
  disposeAll(): this {
    for (const gltf of this.loadedModels.values()) {
      this.disposeObject3D(gltf.scene);
    }
    for (const tex of this.loadedTextures.values()) {
      tex.dispose();
    }
    this.modelCache.clear();
    this.textureCache.clear();
    this.loadedModels.clear();
    this.loadedTextures.clear();
    this.generatorRegistry.clear();
    THREE.Cache.clear();
    this.disposed = true;
    return this;
  }

  /** 释放整个缓存实例，等价于 {@link disposeAll}。 */
  dispose(): void {
    this.disposeAll();
  }

  // ===================== internal =====================

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error('[AssetCache] 实例已 dispose，无法继续使用。');
    }
  }

  private getLoader(options?: ModelLoadOptions): GLTFLoader {
    if (!options?.extendLoader) {
      return this.modelLoader;
    }
    // 有扩展配置时创建独立 loader，避免污染共享实例。
    const loader = new GLTFLoader();
    options.extendLoader(loader);
    return loader;
  }

  private requestGLTF(url: string, options?: ModelLoadOptions): Promise<GLTF> {
    const loader = this.getLoader(options);
    return new Promise<GLTF>((resolve, reject) => {
      loader.load(url, resolve, options?.onProgress, reject);
    });
  }

  private requestTexture(url: string, options?: TextureLoadOptions): Promise<THREE.Texture> {
    return new Promise<THREE.Texture>((resolve, reject) => {
      // 用 FileLoader 走 THREE.Cache，使 clearTexture 能真正触发重新网络请求；
      // TextureLoader 内部用 Image 元素、走浏览器 HTTP 缓存，不受 THREE.Cache 控制。
      const loader = new THREE.FileLoader();
      loader.setResponseType('blob');
      loader.load(
        url,
        (blob) => {
          const image = new Image();
          image.crossOrigin = 'anonymous';
          image.src = URL.createObjectURL(blob as unknown as Blob);
          image.onload = () => {
            URL.revokeObjectURL(image.src);
            const texture = new THREE.Texture(image);
            texture.colorSpace = options?.colorSpace ?? THREE.SRGBColorSpace;
            texture.wrapS = options?.wrapS ?? DEFAULT_WRAP;
            texture.wrapT = options?.wrapT ?? DEFAULT_WRAP;
            texture.anisotropy = options?.anisotropy ?? DEFAULT_ANISOTROPY;
            if (options?.flipY !== undefined) {
              texture.flipY = options.flipY;
            }
            texture.needsUpdate = true;
            this.loadedTextures.set(url, texture);
            resolve(texture);
          };
          image.onerror = reject;
        },
        undefined,
        reject,
      );
    });
  }

  /** 释放一个 Object3D 子树下的 geometry / material / texture。 */
  private disposeObject3D(root: THREE.Object3D): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.geometry) {
        return;
      }
      mesh.geometry.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((m) => this.disposeMaterial(m));
      } else if (material) {
        this.disposeMaterial(material);
      }
    });
  }

  /** 释放材质及其引用的贴图。 */
  private disposeMaterial(material: THREE.Material): void {
    const props = material as unknown as Record<string, unknown>;
    for (const value of Object.values(props)) {
      if (value instanceof THREE.Texture) {
        value.dispose();
      }
    }
    material.dispose();
  }

  /** 按选项克隆 Object3D 树：先浅拷贝整树（支持骨骼），再按需独立 geometry / material / texture。 */
  private cloneObject3D(
    root: THREE.Object3D,
    options: Required<CloneOptions>,
  ): THREE.Object3D {
    const cloned = cloneSkeleton(root);
    if (options.shareGeometry && options.shareMaterial && options.shareTexture) {
      return cloned;
    }
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      if (!options.shareGeometry && mesh.geometry) {
        mesh.geometry = mesh.geometry.clone();
      }
      if ((!options.shareMaterial || !options.shareTexture) && mesh.material) {
        mesh.material = this.cloneMaterial(mesh.material, options);
      }
    });
    return cloned;
  }

  /**
   * 克隆材质，可控制 material 与其 texture 是否共享。
   *
   * @param material - 单个材质或材质数组（如 `Mesh.material`）。
   * @param options - 共享选项。
   *   `shareMaterial: false` 复制独立材质；`shareTexture: false` 进一步复制独立 texture
   *   （仅 `shareMaterial: false` 时生效）。
   * @returns `shareMaterial` 为 `true` 时返回原材质引用，否则返回克隆材质。
   *
   * @example
   * ```ts
   * // 复制独立材质，但共享其 texture
   * const mat = cache.cloneMaterial(mesh.material, { shareMaterial: false });
   * // 复制独立材质 + 独立 texture（改 repeat 不影响原材质）
   * const mat2 = cache.cloneMaterial(mesh.material, { shareMaterial: false, shareTexture: false });
   * ```
   */
  cloneMaterial(
    material: THREE.Material | THREE.Material[],
    options?: CloneOptions,
  ): THREE.Material | THREE.Material[] {
    const shareMaterial = options?.shareMaterial ?? true;
    const shareTexture = options?.shareTexture ?? true;
    const cloneOne = (m: THREE.Material): THREE.Material => {
      if (shareMaterial) {
        return m;
      }
      const cloned = m.clone();
      if (!shareTexture) {
        AssetCache.cloneMaterialTextures(cloned);
      }
      return cloned;
    };
    return Array.isArray(material) ? material.map(cloneOne) : cloneOne(material);
  }

  /** 复制材质上所有 texture 引用为独立 texture（image 数据仍共享）。 */
  private static cloneMaterialTextures(material: THREE.Material): void {
    const props = material as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(props)) {
      if (value instanceof THREE.Texture) {
        (material as unknown as Record<string, THREE.Texture>)[key] = value.clone();
      }
    }
  }
}
