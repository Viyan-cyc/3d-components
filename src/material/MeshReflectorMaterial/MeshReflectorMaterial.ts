
import * as THREE from 'three';
import { BlurPass } from './BlurPass';
import type { IDisposable } from '../../types';

// ---- Default value constants ----

/** Default resolution of the reflection render target. */
const DEFAULT_RESOLUTION = 256;

/** Default minimum depth threshold for depth-aware blur. */
const DEFAULT_MIN_DEPTH_THRESHOLD = 0.9;

/** Default bias controlling the ratio between depth and blur. */
const DEFAULT_DEPTH_TO_BLUR_RATIO_BIAS = 0.25;

/** Default base color for the reflector material. */
const DEFAULT_COLOR = 0xffffff;

/** Scale factor for converting clip-space to texture-space coordinates. */
const CLIP_TO_TEXTURE_SCALE = 0.5;

// ---- Merged default options ----

/**
 * Default values for all non-texture reflector options.
 * Spread before user options to provide fallbacks without
 * destructuring defaults (which inflate cyclomatic complexity).
 */
const DEFAULT_REFLECTOR_OPTIONS = {
  resolution: DEFAULT_RESOLUTION,
  blur: [0, 0] as [number, number],
  mixBlur: 0,
  mixStrength: 1,
  mixContrast: 1,
  mirror: 0,
  distortion: 1,
  minDepthThreshold: DEFAULT_MIN_DEPTH_THRESHOLD,
  maxDepthThreshold: 1,
  depthScale: 0,
  depthToBlurRatioBias: DEFAULT_DEPTH_TO_BLUR_RATIO_BIAS,
  reflectorOffset: 0,
  color: DEFAULT_COLOR as THREE.ColorRepresentation,
  metalness: 0,
  roughness: 0,
};

// ---- GLSL shader snippets ----

/** Vertex shader prefix: adds textureMatrix uniform and my_vUv varying. */
const VERTEX_SHADER_PREFIX = `
  uniform mat4 textureMatrix;
  varying vec4 my_vUv;
`;

/** Vertex shader replacement for #include <project_vertex>. */
const VERTEX_SHADER_REPLACEMENT = `#include <project_vertex>
  my_vUv = textureMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );`;

/** Fragment shader prefix: adds reflection-related uniforms and varyings. */
const FRAGMENT_SHADER_PREFIX = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tDiffuseBlur;
  uniform sampler2D tDepth;
  uniform sampler2D distortionMap;
  uniform float distortion;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform bool hasBlur;
  uniform float mixBlur;
  uniform float mirror;
  uniform float mixStrength;
  uniform float minDepthThreshold;
  uniform float maxDepthThreshold;
  uniform float mixContrast;
  uniform float depthScale;
  uniform float depthToBlurRatioBias;
  varying vec4 my_vUv;
`;

/** Fragment shader replacement for #include <emissivemap_fragment>. */
const FRAGMENT_SHADER_REPLACEMENT = `#include <emissivemap_fragment>

  float distortionFactor = 0.0;
  #ifdef USE_DISTORTION
    distortionFactor = texture2D(distortionMap, vUv).r * distortion;
  #endif

  vec4 new_vUv = my_vUv;
  new_vUv.x += distortionFactor;
  new_vUv.y += distortionFactor;

  vec4 base = texture2DProj(tDiffuse, new_vUv);
  vec4 blur = texture2DProj(tDiffuseBlur, new_vUv);

  vec4 merge = base;

  #ifdef USE_NORMALMAP
    vec2 normal_uv = vec2(0.0);
    vec4 normalColor = texture2D(normalMap, vUv * normalScale);
    vec3 my_normal = normalize(vec3(
      normalColor.r * 2.0 - 1.0,
      normalColor.b,
      normalColor.g * 2.0 - 1.0
    ));
    vec3 coord = new_vUv.xyz / new_vUv.w;
    normal_uv = coord.xy + coord.z * my_normal.xz * 0.05;
    vec4 base_normal = texture2D(tDiffuse, normal_uv);
    vec4 blur_normal = texture2D(tDiffuseBlur, normal_uv);
    merge = base_normal;
    blur = blur_normal;
  #endif

  float depthFactor = 0.0001;
  float blurFactor = 0.0;

  #ifdef USE_DEPTH
    vec4 depth = texture2DProj(tDepth, new_vUv);
    depthFactor = smoothstep(
      minDepthThreshold, maxDepthThreshold,
      1.0-(depth.r * depth.a)
    );
    depthFactor *= depthScale;
    depthFactor = max(0.0001, min(1.0, depthFactor));

    #ifdef USE_BLUR
      blur = blur * min(1.0, depthFactor + depthToBlurRatioBias);
      merge = merge * min(1.0, depthFactor + 0.5);
    #else
      merge = merge * depthFactor;
    #endif

  #endif

  float reflectorRoughnessFactor = roughness;
  #ifdef USE_ROUGHNESSMAP
    vec4 reflectorTexelRoughness = texture2D( roughnessMap, vUv );
    reflectorRoughnessFactor *= reflectorTexelRoughness.g;
  #endif

  #ifdef USE_BLUR
    blurFactor = min(1.0, mixBlur * reflectorRoughnessFactor);
    merge = mix(merge, blur, blurFactor);
  #endif

  vec4 newMerge = vec4(0.0, 0.0, 0.0, 1.0);
  newMerge.r = (merge.r - 0.5) * mixContrast + 0.5;
  newMerge.g = (merge.g - 0.5) * mixContrast + 0.5;
  newMerge.b = (merge.b - 0.5) * mixContrast + 0.5;

  diffuseColor.rgb = diffuseColor.rgb * (
    (1.0 - min(1.0, mirror)) + newMerge.rgb * mixStrength
  );
`;

// ---- Module-level helpers ----

/**
 * Create the pair of render targets used for the reflection pipeline.
 * FBO1 holds the sharp reflection + depth; FBO2 receives the blurred result.
 */
const createReflectionTargets = (resolution: number): {
  fbo1: THREE.WebGLRenderTarget;
  fbo2: THREE.WebGLRenderTarget;
} => {
  const rtParams = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
  };
  const fbo1 = new THREE.WebGLRenderTarget(resolution, resolution, rtParams);
  fbo1.depthBuffer = true;
  fbo1.depthTexture = new THREE.DepthTexture(resolution, resolution);
  fbo1.depthTexture.format = THREE.DepthFormat;
  fbo1.depthTexture.type = THREE.UnsignedShortType;
  const fbo2 = new THREE.WebGLRenderTarget(resolution, resolution, rtParams);
  return { fbo1, fbo2 };
};

// ---- Options interface ----

/**
 * Options for constructing a {@link MeshReflectorMaterial}.
 *
 * All properties are optional and default to a clean mirror-like reflection.
 *
 * @example
 * ```ts
 * const opts: MeshReflectorMaterialOptions = {
 *   mixBlur: 0.5,
 *   blur: [400, 400],
 *   mirror: 0.9,
 *   resolution: 512,
 * };
 * ```
 */
export interface MeshReflectorMaterialOptions {

  /**
   * Resolution of the reflection render target (width = height).
   * Higher values produce sharper reflections at the cost of GPU performance.
   * @default 256
   */
  resolution?: number;

  /**
   * Blur radius for the reflection texture.
   * - A single number applies the same blur in both directions.
   * - A `[width, height]` tuple allows asymmetric blur.
   * - Set to `0` or `[0, 0]` to disable blur.
   * @default [0, 0]
   */
  blur?: number | [number, number];

  /**
   * How much the blurred reflection is mixed in (0–1).
   * - `0` = only sharp reflection
   * - `1` = fully blurred reflection
   * Only effective when `blur` is non-zero.
   * @default 0
   */
  mixBlur?: number;

  /**
   * Overall strength of the reflection mix (0–1+).
   * - `0` = no reflection (pure base material)
   * - `1` = full reflection strength
   * @default 1
   */
  mixStrength?: number;

  /**
   * Contrast adjustment applied to the reflection color.
   * - `1` = no change
   * - `> 1` = higher contrast
   * - `< 1` = lower contrast
   * @default 1
   */
  mixContrast?: number;

  /**
   * How mirror-like the reflection is (0–1).
   * - `0` = reflection is blended with the base material color
   * - `1` = reflection replaces the base material color entirely
   * @default 0
   */
  mirror?: number;

  /**
   * Distortion intensity (0–1+).
   * Requires a `distortionMap` texture to take effect.
   * @default 1
   */
  distortion?: number;

  /**
   * A texture used to distort the reflection UV coordinates.
   * The red channel is used as the distortion offset.
   * When set, `USE_DISTORTION` define is enabled.
   */
  distortionMap?: THREE.Texture;

  /**
   * Minimum depth threshold for depth-aware blur.
   * Pixels with depth below this value receive no depth-based blur.
   * @default 0.9
   */
  minDepthThreshold?: number;

  /**
   * Maximum depth threshold for depth-aware blur.
   * Pixels with depth above this value receive full depth-based blur.
   * @default 1
   */
  maxDepthThreshold?: number;

  /**
   * Scale factor for depth-based blur effect.
   * - `0` = disable depth-aware blur
   * - `> 0` = enable depth-aware blur with this scale
   * @default 0
   */
  depthScale?: number;

  /**
   * Bias controlling the ratio between depth and blur.
   * Higher values make the blur more dominant over depth.
   * @default 0.25
   */
  depthToBlurRatioBias?: number;

  /**
   * Offset of the reflector plane along its normal direction.
   * Useful to avoid z-fighting when the reflector sits exactly on a surface.
   * @default 0
   */
  reflectorOffset?: number;

  /**
   * Base color of the material.
   * Accepts any value that `THREE.Color.set()` understands.
   * @default 0xffffff
   */
  color?: THREE.ColorRepresentation;

  /**
   * Metalness of the base material (0–1).
   * @default 0
   */
  metalness?: number;

  /**
   * Roughness of the base material (0–1).
   * Also affects blur mixing: higher roughness → more blur.
   * @default 0
   */
  roughness?: number;
}

/**
 * MeshReflectorMaterial — a **planar reflection material** for Three.js.
 *
 * Extends `THREE.MeshStandardMaterial` with real-time planar reflection
 * rendering. The material renders the scene from a mirrored virtual camera
 * into a render target, then composites the reflection onto the surface
 * with configurable blur, distortion, and depth-aware effects.
 *
 * **Features:**
 * - Real-time planar reflections (mirror, floor, water, etc.)
 * - Multi-pass Kawase blur for soft reflections
 * - Depth-aware blur (near objects sharper, far objects blurrier)
 * - Normal-map-aware reflection distortion
 * - Distortion map support for water-like effects
 * - Configurable reflection strength, contrast, and mirror mode
 * - Oblique clip plane to prevent artifacts behind the reflector
 *
 * **Usage:**
 * Unlike React-based implementations, this is a pure Three.js class.
 * Call `updateBeforeRender(renderer, scene, camera)` every frame
 * **before** `renderer.render(scene, camera)` to update the reflection.
 *
 * @example
 * ```ts
 * import { MeshReflectorMaterial } from '@a3d/a3d-components/material';
 *
 * // Create a reflective floor
 * const reflectorMat = new MeshReflectorMaterial({
 *   mirror: 0.75,
 *   blur: [300, 100],
 *   mixBlur: 1,
 *   mixStrength: 0.8,
 *   resolution: 512,
 *   color: 0x999999,
 * });
 * const floor = new THREE.Mesh(
 *   new THREE.PlaneGeometry(10, 10),
 *   reflectorMat,
 * );
 * floor.rotation.x = -Math.PI / 2;
 * reflectorMat.bindToMesh(floor);
 * scene.add(floor);
 *
 * // In your render loop:
 * function animate() {
 *   requestAnimationFrame(animate);
 *   reflectorMat.updateBeforeRender(renderer, scene, camera);
 *   renderer.render(scene, camera);
 * }
 * ```
 *
 * @extends THREE.MeshStandardMaterial
 * @implements IDisposable
 */
export class MeshReflectorMaterial extends THREE.MeshStandardMaterial implements IDisposable {
  // ---- Uniform backing fields (wrapped objects for Three.js uniform binding) ----
  private _uTDiffuse = { value: null as THREE.Texture | null };
  private _uTDepth = { value: null as THREE.DepthTexture | null };
  private _uDistortionMap = { value: null as THREE.Texture | null };
  private _uTDiffuseBlur = { value: null as THREE.Texture | null };
  private _uTextureMatrix = { value: null as THREE.Matrix4 | null };
  private _uHasBlur = { value: false };
  private _uMirror = { value: 0.0 };
  private _uMixBlur = { value: 0.0 };
  private _uBlurStrength = { value: 1.0 };
  private _uMinDepthThreshold = { value: DEFAULT_MIN_DEPTH_THRESHOLD };
  private _uMaxDepthThreshold = { value: 1.0 };
  private _uDepthScale = { value: 0.0 };
  private _uDepthToBlurRatioBias = { value: DEFAULT_DEPTH_TO_BLUR_RATIO_BIAS };
  private _uDistortion = { value: 1.0 };
  private _uMixContrast = { value: 1.0 };

  // ---- Reflection pipeline resources ----
  private _fbo1: THREE.WebGLRenderTarget;
  private _fbo2: THREE.WebGLRenderTarget;
  private _blurPass: BlurPass | null = null;
  private _hasBlurFlag: boolean;

  // ---- Reflection camera math (reusable objects) ----
  private _reflectorPlane = new THREE.Plane();
  private _normal = new THREE.Vector3();
  private _reflectorWorldPosition = new THREE.Vector3();
  private _cameraWorldPosition = new THREE.Vector3();
  private _rotationMatrix = new THREE.Matrix4();
  private _lookAtPosition = new THREE.Vector3(0, 0, -1);
  private _clipPlane = new THREE.Vector4();
  private _view = new THREE.Vector3();
  private _target = new THREE.Vector3();
  private _q = new THREE.Vector4();
  private _mat4 = new THREE.Matrix4();
  private _virtualCamera = new THREE.PerspectiveCamera();

  private _reflectorOffset: number;

  // ---- Track the mesh this material is attached to ----
  private _parentMesh: THREE.Mesh | null = null;

  /**
   * @param options - Configuration object. All properties are optional.
   */
  constructor(options: MeshReflectorMaterialOptions = {}) {
    const opts = { ...DEFAULT_REFLECTOR_OPTIONS, ...options };
    const {
      resolution, blur, mixBlur, mixStrength, mixContrast,
      mirror, distortion, distortionMap, minDepthThreshold,
      maxDepthThreshold, depthScale, depthToBlurRatioBias,
      reflectorOffset, color, metalness, roughness,
    } = opts;

    super({ color, metalness, roughness });
    this._reflectorOffset = reflectorOffset;

    const blurArr: [number, number] =
      Array.isArray(blur) ? blur : [blur, blur];
    const blurX = blurArr[0];
    const blurY = blurArr[1];
    this._hasBlurFlag = blurX + blurY > 0;

    const { fbo1, fbo2 } = createReflectionTargets(resolution);
    this._fbo1 = fbo1;
    this._fbo2 = fbo2;

    if (this._hasBlurFlag) {
      this._blurPass = new BlurPass({
        resolution,
        width: blurX,
        height: blurY,
        minDepthThreshold,
        maxDepthThreshold,
        depthScale,
        depthToBlurRatioBias,
      });
    }

    this._assignUniforms({
      mirror,
      mixBlur,
      mixStrength,
      minDepthThreshold,
      maxDepthThreshold,
      depthScale,
      depthToBlurRatioBias,
      distortion,
      distortionMap,
      mixContrast,
    });

    this._initDefines(depthScale, distortionMap);
  }

  /** Assign uniform values from constructor options. */
  private _assignUniforms(opts: {
    mirror: number;
    mixBlur: number;
    mixStrength: number;
    minDepthThreshold: number;
    maxDepthThreshold: number;
    depthScale: number;
    depthToBlurRatioBias: number;
    distortion: number;
    distortionMap?: THREE.Texture | null;
    mixContrast: number;
  }): void {
    this._uTDiffuse.value = this._fbo1.texture;
    this._uTDepth.value = this._fbo1.depthTexture;
    this._uTDiffuseBlur.value = this._fbo2.texture;
    this._uTextureMatrix.value = this._mat4;
    this._uHasBlur.value = this._hasBlurFlag;
    this._uMirror.value = opts.mirror;
    this._uMixBlur.value = opts.mixBlur;
    this._uBlurStrength.value = opts.mixStrength;
    this._uMinDepthThreshold.value = opts.minDepthThreshold;
    this._uMaxDepthThreshold.value = opts.maxDepthThreshold;
    this._uDepthScale.value = opts.depthScale;
    this._uDepthToBlurRatioBias.value = opts.depthToBlurRatioBias;
    this._uDistortion.value = opts.distortion;
    this._uDistortionMap.value = opts.distortionMap ?? null;
    this._uMixContrast.value = opts.mixContrast;
  }

  /** Initialize shader defines from constructor options. */
  private _initDefines(depthScale: number, distortionMap?: THREE.Texture): void {
    if (this._hasBlurFlag) {
      this.defines!.USE_BLUR = '';
    }
    if (depthScale > 0) {
      this.defines!.USE_DEPTH = '';
    }
    if (distortionMap) {
      this.defines!.USE_DISTORTION = '';
    }
  }

  // ---- Uniform getters / setters ----

  /** The sharp reflection texture (auto-set from internal FBO). */
  get tDiffuse(): THREE.Texture | null {
    return this._uTDiffuse.value;
  }

  set tDiffuse(v: THREE.Texture | null) {
    this._uTDiffuse.value = v;
  }

  /** The depth texture of the reflection (auto-set from internal FBO). */
  get tDepth(): THREE.DepthTexture | null {
    return this._uTDepth.value;
  }

  set tDepth(v: THREE.DepthTexture | null) {
    this._uTDepth.value = v;
  }

  /** The blurred reflection texture (auto-set from internal FBO). */
  get tDiffuseBlur(): THREE.Texture | null {
    return this._uTDiffuseBlur.value;
  }

  set tDiffuseBlur(v: THREE.Texture | null) {
    this._uTDiffuseBlur.value = v;
  }

  /** The texture matrix that transforms world positions to reflection UV. */
  get textureMatrix(): THREE.Matrix4 | null {
    return this._uTextureMatrix.value;
  }

  set textureMatrix(v: THREE.Matrix4 | null) {
    this._uTextureMatrix.value = v;
  }

  /** Whether blur is active. */
  get hasBlur(): boolean {
    return this._uHasBlur.value;
  }

  set hasBlur(v: boolean) {
    this._uHasBlur.value = v;
  }

  /** Mirror factor (0 = blend with base, 1 = pure reflection). */
  get mirror(): number {
    return this._uMirror.value;
  }

  set mirror(v: number) {
    this._uMirror.value = v;
  }

  /** Blur mix factor (0 = sharp only, 1 = fully blurred). */
  get mixBlur(): number {
    return this._uMixBlur.value;
  }

  set mixBlur(v: number) {
    this._uMixBlur.value = v;
  }

  /** Reflection strength multiplier. */
  get mixStrength(): number {
    return this._uBlurStrength.value;
  }

  set mixStrength(v: number) {
    this._uBlurStrength.value = v;
  }

  /** Min depth threshold for depth-aware blur. */
  get minDepthThreshold(): number {
    return this._uMinDepthThreshold.value;
  }

  set minDepthThreshold(v: number) {
    this._uMinDepthThreshold.value = v;
  }

  /** Max depth threshold for depth-aware blur. */
  get maxDepthThreshold(): number {
    return this._uMaxDepthThreshold.value;
  }

  set maxDepthThreshold(v: number) {
    this._uMaxDepthThreshold.value = v;
  }

  /** Depth scale for depth-aware blur. */
  get depthScale(): number {
    return this._uDepthScale.value;
  }

  set depthScale(v: number) {
    this._uDepthScale.value = v;
  }

  /** Depth-to-blur ratio bias. */
  get depthToBlurRatioBias(): number {
    return this._uDepthToBlurRatioBias.value;
  }

  set depthToBlurRatioBias(v: number) {
    this._uDepthToBlurRatioBias.value = v;
  }

  /** Distortion intensity. */
  get distortion(): number {
    return this._uDistortion.value;
  }

  set distortion(v: number) {
    this._uDistortion.value = v;
  }

  /** Distortion map texture. */
  get distortionMap(): THREE.Texture | null {
    return this._uDistortionMap.value;
  }

  set distortionMap(v: THREE.Texture | null) {
    this._uDistortionMap.value = v;
  }

  /** Reflection contrast. */
  get mixContrast(): number {
    return this._uMixContrast.value;
  }

  set mixContrast(v: number) {
    this._uMixContrast.value = v;
  }

  /** Reflector offset along its normal. */
  get reflectorOffset(): number {
    return this._reflectorOffset;
  }

  set reflectorOffset(v: number) {
    this._reflectorOffset = v;
  }

  /**
   * Inject reflection uniforms and shader code into the standard material.
   *
   * Called automatically by Three.js when the material is first used
   * for rendering. You should not need to call this directly.
   */
  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    if (!shader.defines?.USE_UV) {
      shader.defines ??= {};
      shader.defines.USE_UV = '';
    }
    this._injectUniforms(shader);
    this._injectVertexShader(shader);
    this._injectFragmentShader(shader);
  }

  /** Inject reflection-related uniforms into the shader program. */
  private _injectUniforms(shader: THREE.WebGLProgramParametersWithUniforms): void {
    shader.uniforms.hasBlur = this._uHasBlur;
    shader.uniforms.tDiffuse = this._uTDiffuse;
    shader.uniforms.tDepth = this._uTDepth;
    shader.uniforms.distortionMap = this._uDistortionMap;
    shader.uniforms.tDiffuseBlur = this._uTDiffuseBlur;
    shader.uniforms.textureMatrix = this._uTextureMatrix;
    shader.uniforms.mirror = this._uMirror;
    shader.uniforms.mixBlur = this._uMixBlur;
    shader.uniforms.mixStrength = this._uBlurStrength;
    shader.uniforms.minDepthThreshold = this._uMinDepthThreshold;
    shader.uniforms.maxDepthThreshold = this._uMaxDepthThreshold;
    shader.uniforms.depthScale = this._uDepthScale;
    shader.uniforms.depthToBlurRatioBias = this._uDepthToBlurRatioBias;
    shader.uniforms.distortion = this._uDistortion;
    shader.uniforms.mixContrast = this._uMixContrast;
  }

  /** Inject vertex shader modifications for reflection UV projection. */
  private _injectVertexShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
    shader.vertexShader = VERTEX_SHADER_PREFIX + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      VERTEX_SHADER_REPLACEMENT,
    );
  }

  /** Inject fragment shader modifications for reflection compositing. */
  private _injectFragmentShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
    shader.fragmentShader = FRAGMENT_SHADER_PREFIX + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      FRAGMENT_SHADER_REPLACEMENT,
    );
  }

  /**
   * Update the reflection texture for the current frame.
   *
   * **Must be called every frame before `renderer.render(scene, camera)`.**
   * This renders the scene from a mirrored virtual camera with an oblique
   * clip plane into an internal render target, then optionally applies
   * a multi-pass blur.
   *
   * @param renderer - The WebGL renderer.
   * @param scene - The scene to reflect.
   * @param camera - The main camera (used to compute the virtual camera position).
   * @returns `true` if the reflection was rendered, `false` if the reflector
   *          is facing away from the camera (no update needed).
   *
   * @example
   * ```ts
   * function animate() {
   *   requestAnimationFrame(animate);
   *   reflectorMat.updateBeforeRender(renderer, scene, camera);
   *   renderer.render(scene, camera);
   * }
   * ```
   */
  updateBeforeRender(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ): boolean {
    const parent = this._parentMesh;
    if (!parent || (parent).material !== this) {
      return false;
    }

    // Compute virtual camera position and oblique clip plane
    const shouldRender = this._computeVirtualCamera(parent, camera);
    if (!shouldRender) {
      return false;
    }

    // Temporarily hide the reflector mesh to avoid self-reflection
    parent.visible = false;

    // Save renderer state
    const currentXrEnabled = renderer.xr.enabled;
    const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;

    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this._fbo1);
    renderer.state.buffers.depth.setMask(true);
    if (!renderer.autoClear) {
      renderer.clear();
    }
    renderer.render(scene, this._virtualCamera);

    // Apply blur if enabled
    if (this._hasBlurFlag && this._blurPass) {
      this._blurPass.render(renderer, this._fbo1, this._fbo2);
    }

    // Restore state
    renderer.xr.enabled = currentXrEnabled;
    renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
    parent.visible = true;
    renderer.setRenderTarget(null);

    return true;
  }

  /**
   * Bind this material to a mesh. Call after assigning the material to a mesh.
   *
   * This is necessary because the material needs to know which mesh it's
   * attached to in order to compute the reflection plane. Without React's
   * component tree, we need an explicit binding.
   *
   * @param mesh - The mesh that uses this material.
   * @returns This instance for chaining.
   *
   * @example
   * ```ts
   * const floor = new THREE.Mesh(geometry, reflectorMat);
   * reflectorMat.bindToMesh(floor);
   * scene.add(floor);
   * ```
   */
  bindToMesh(mesh: THREE.Mesh): this {
    this._parentMesh = mesh;
    return this;
  }

  /**
   * Compute the virtual camera position and oblique clip plane
   * for the reflection render.
   *
   * Implements the oblique clip plane technique from:
   * http://www.terathon.com/code/oblique.html
   * Paper: http://www.terathon.com/lengyel/Lengyel-Oblique.pdf
   *
   * @returns `true` if the reflector is facing the camera (should render),
   *          `false` if facing away (skip render).
   */
  private _computeVirtualCamera(
    parent: THREE.Object3D,
    camera: THREE.PerspectiveCamera,
  ): boolean {
    const reflectorWorldPosition = this._reflectorWorldPosition;
    const cameraWorldPosition = this._cameraWorldPosition;
    const rotationMatrix = this._rotationMatrix;
    const normal = this._normal;
    const view = this._view;
    const target = this._target;
    const virtualCamera = this._virtualCamera;

    reflectorWorldPosition.setFromMatrixPosition(parent.matrixWorld);
    cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
    rotationMatrix.extractRotation(parent.matrixWorld);

    normal.set(0, 0, 1).applyMatrix4(rotationMatrix);
    reflectorWorldPosition.addScaledVector(normal, this._reflectorOffset);

    view.subVectors(reflectorWorldPosition, cameraWorldPosition);

    // Avoid rendering when reflector is facing away
    if (view.dot(normal) > 0) {
      return false;
    }

    view.reflect(normal).negate();
    view.add(reflectorWorldPosition);

    rotationMatrix.extractRotation(camera.matrixWorld);
    this._lookAtPosition
      .set(0, 0, -1)
      .applyMatrix4(rotationMatrix)
      .add(cameraWorldPosition);

    target.subVectors(reflectorWorldPosition, this._lookAtPosition);
    target.reflect(normal).negate();
    target.add(reflectorWorldPosition);

    this._setupVirtualCamera(virtualCamera, view, target, { rotationMatrix, normal }, camera);

    this._updateTextureMatrix(parent);
    this._applyObliqueClipPlane();

    return true;
  }

  /** Position the virtual camera and copy projection from the main camera. */
  private _setupVirtualCamera(
    virtualCamera: THREE.PerspectiveCamera,
    view: THREE.Vector3,
    target: THREE.Vector3,
    transform: { rotationMatrix: THREE.Matrix4; normal: THREE.Vector3 },
    camera: THREE.PerspectiveCamera,
  ): void {
    virtualCamera.position.copy(view);
    virtualCamera.up
      .set(0, 1, 0)
      .applyMatrix4(transform.rotationMatrix)
      .reflect(transform.normal);
    virtualCamera.lookAt(target);
    virtualCamera.far = camera.far;
    virtualCamera.updateMatrixWorld();
    virtualCamera.projectionMatrix.copy(camera.projectionMatrix);
  }

  /**
   * Update the texture matrix that transforms world positions to
   * reflection UV coordinates.
   */
  private _updateTextureMatrix(parent: THREE.Object3D): void {
    const textureMatrix = this._mat4;
    textureMatrix.set(
      CLIP_TO_TEXTURE_SCALE, 0, 0, CLIP_TO_TEXTURE_SCALE,
      0, CLIP_TO_TEXTURE_SCALE, 0, CLIP_TO_TEXTURE_SCALE,
      0, 0, CLIP_TO_TEXTURE_SCALE, CLIP_TO_TEXTURE_SCALE,
      0, 0, 0, 1,
    );
    textureMatrix.multiply(this._virtualCamera.projectionMatrix);
    textureMatrix.multiply(this._virtualCamera.matrixWorldInverse);
    textureMatrix.multiply(parent.matrixWorld);
  }

  /**
   * Apply the oblique clip plane to the virtual camera's projection matrix.
   * Prevents rendering of geometry behind the reflector plane.
   */
  private _applyObliqueClipPlane(): void {
    this._reflectorPlane.setFromNormalAndCoplanarPoint(this._normal, this._reflectorWorldPosition);
    this._reflectorPlane.applyMatrix4(this._virtualCamera.matrixWorldInverse);

    const clipPlane = this._clipPlane;
    clipPlane.set(
      this._reflectorPlane.normal.x,
      this._reflectorPlane.normal.y,
      this._reflectorPlane.normal.z,
      this._reflectorPlane.constant,
    );

    const q = this._q;
    const projMatrix = this._virtualCamera.projectionMatrix;
    q.x = (Math.sign(clipPlane.x) + projMatrix.elements[8])
      / projMatrix.elements[0];
    q.y = (Math.sign(clipPlane.y) + projMatrix.elements[9])
      / projMatrix.elements[5];
    q.z = -1;
    q.w = (1 + projMatrix.elements[10]) / projMatrix.elements[14];

    clipPlane.multiplyScalar(2 / clipPlane.dot(q));

    projMatrix.elements[2] = clipPlane.x;
    projMatrix.elements[6] = clipPlane.y;
    projMatrix.elements[10] = clipPlane.z + 1;
    projMatrix.elements[14] = clipPlane.w;
  }

  /**
   * Set the mirror factor.
   *
   * @param v - Mirror value (0 = blend with base, 1 = pure reflection).
   * @returns This instance for chaining.
   */
  setMirror(v: number): this {
    this._uMirror.value = v;
    return this;
  }

  /**
   * Set the blur mix factor.
   *
   * @param v - Blur mix (0 = sharp only, 1 = fully blurred).
   * @returns This instance for chaining.
   */
  setMixBlur(v: number): this {
    this._uMixBlur.value = v;
    return this;
  }

  /**
   * Set the reflection strength.
   *
   * @param v - Strength multiplier.
   * @returns This instance for chaining.
   */
  setMixStrength(v: number): this {
    this._uBlurStrength.value = v;
    return this;
  }

  /**
   * Set the reflection contrast.
   *
   * @param v - Contrast (1 = no change, >1 = higher, <1 = lower).
   * @returns This instance for chaining.
   */
  setMixContrast(v: number): this {
    this._uMixContrast.value = v;
    return this;
  }

  /**
   * Set the distortion intensity.
   *
   * @param v - Distortion factor.
   * @returns This instance for chaining.
   */
  setDistortion(v: number): this {
    this._uDistortion.value = v;
    return this;
  }

  /**
   * Release all GPU resources held by this material.
   *
   * Disposes render targets, blur pass, and calls `super.dispose()`.
   * After calling this method the material must not be used not be used again.
   */
  dispose(): void {
    this._fbo1.dispose();
    this._fbo2.dispose();
    this._blurPass?.dispose();
    super.dispose();
  }
}
