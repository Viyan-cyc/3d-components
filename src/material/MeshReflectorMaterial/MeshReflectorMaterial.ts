import * as THREE from 'three';
import { BlurPass } from './BlurPass';
import type { IDisposable } from '../../types';

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
 * import { MeshReflectorMaterial } from '@cyc/3d-components/material';
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
  private _uMinDepthThreshold = { value: 0.9 };
  private _uMaxDepthThreshold = { value: 1.0 };
  private _uDepthScale = { value: 0.0 };
  private _uDepthToBlurRatioBias = { value: 0.25 };
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
    const {
      resolution = 256,
      blur = [0, 0],
      mixBlur = 0,
      mixStrength = 1,
      mixContrast = 1,
      mirror = 0,
      distortion = 1,
      distortionMap,
      minDepthThreshold = 0.9,
      maxDepthThreshold = 1,
      depthScale = 0,
      depthToBlurRatioBias = 0.25,
      reflectorOffset = 0,
      color = 0xffffff,
      metalness = 0,
      roughness = 0,
    } = options;

    super({ color, metalness, roughness });

    this._reflectorOffset = reflectorOffset;

    // Normalize blur to [x, y]
    const blurArr: [number, number] = Array.isArray(blur) ? blur : [blur, blur];
    const blurX = blurArr[0];
    const blurY = blurArr[1];
    this._hasBlurFlag = blurX + blurY > 0;

    // Create render targets
    const rtParams = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
    };

    this._fbo1 = new THREE.WebGLRenderTarget(resolution, resolution, rtParams);
    this._fbo1.depthBuffer = true;
    this._fbo1.depthTexture = new THREE.DepthTexture(resolution, resolution);
    this._fbo1.depthTexture.format = THREE.DepthFormat;
    this._fbo1.depthTexture.type = THREE.UnsignedShortType;

    this._fbo2 = new THREE.WebGLRenderTarget(resolution, resolution, rtParams);

    // Create blur pass if needed
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

    // Set uniform values
    this._uTDiffuse.value = this._fbo1.texture;
    this._uTDepth.value = this._fbo1.depthTexture;
    this._uTDiffuseBlur.value = this._fbo2.texture;
    this._uTextureMatrix.value = this._mat4;
    this._uHasBlur.value = this._hasBlurFlag;
    this._uMirror.value = mirror;
    this._uMixBlur.value = mixBlur;
    this._uBlurStrength.value = mixStrength;
    this._uMinDepthThreshold.value = minDepthThreshold;
    this._uMaxDepthThreshold.value = maxDepthThreshold;
    this._uDepthScale.value = depthScale;
    this._uDepthToBlurRatioBias.value = depthToBlurRatioBias;
    this._uDistortion.value = distortion;
    this._uDistortionMap.value = distortionMap ?? null;
    this._uMixContrast.value = mixContrast;

    // Set defines — these trigger shader recompilation, so they must be set before first render
    if (this._hasBlurFlag) this.defines.USE_BLUR = '';
    if (depthScale > 0) this.defines.USE_DEPTH = '';
    if (distortionMap) this.defines.USE_DISTORTION = '';
  }

  // ---- Uniform getters / setters ----

  /** The sharp reflection texture (auto-set from internal FBO). */
  get tDiffuse(): THREE.Texture | null { return this._uTDiffuse.value; }
  set tDiffuse(v: THREE.Texture | null) { this._uTDiffuse.value = v; }

  /** The depth texture of the reflection (auto-set from internal FBO). */
  get tDepth(): THREE.DepthTexture | null { return this._uTDepth.value; }
  set tDepth(v: THREE.DepthTexture | null) { this._uTDepth.value = v; }

  /** The blurred reflection texture (auto-set from internal FBO). */
  get tDiffuseBlur(): THREE.Texture | null { return this._uTDiffuseBlur.value; }
  set tDiffuseBlur(v: THREE.Texture | null) { this._uTDiffuseBlur.value = v; }

  /** The texture matrix that transforms world positions to reflection UV. */
  get textureMatrix(): THREE.Matrix4 | null { return this._uTextureMatrix.value; }
  set textureMatrix(v: THREE.Matrix4 | null) { this._uTextureMatrix.value = v; }

  /** Whether blur is active. */
  get hasBlur(): boolean { return this._uHasBlur.value; }
  set hasBlur(v: boolean) { this._uHasBlur.value = v; }

  /** Mirror factor (0 = blend with base, 1 = pure reflection). */
  get mirror(): number { return this._uMirror.value; }
  set mirror(v: number) { this._uMirror.value = v; }

  /** Blur mix factor (0 = sharp only, 1 = fully blurred). */
  get mixBlur(): number { return this._uMixBlur.value; }
  set mixBlur(v: number) { this._uMixBlur.value = v; }

  /** Reflection strength multiplier. */
  get mixStrength(): number { return this._uBlurStrength.value; }
  set mixStrength(v: number) { this._uBlurStrength.value = v; }

  /** Min depth threshold for depth-aware blur. */
  get minDepthThreshold(): number { return this._uMinDepthThreshold.value; }
  set minDepthThreshold(v: number) { this._uMinDepthThreshold.value = v; }

  /** Max depth threshold for depth-aware blur. */
  get maxDepthThreshold(): number { return this._uMaxDepthThreshold.value; }
  set maxDepthThreshold(v: number) { this._uMaxDepthThreshold.value = v; }

  /** Depth scale for depth-aware blur. */
  get depthScale(): number { return this._uDepthScale.value; }
  set depthScale(v: number) { this._uDepthScale.value = v; }

  /** Depth-to-blur ratio bias. */
  get depthToBlurRatioBias(): number { return this._uDepthToBlurRatioBias.value; }
  set depthToBlurRatioBias(v: number) { this._uDepthToBlurRatioBias.value = v; }

  /** Distortion intensity. */
  get distortion(): number { return this._uDistortion.value; }
  set distortion(v: number) { this._uDistortion.value = v; }

  /** Distortion map texture. */
  get distortionMap(): THREE.Texture | null { return this._uDistortionMap.value; }
  set distortionMap(v: THREE.Texture | null) { this._uDistortionMap.value = v; }

  /** Reflection contrast. */
  get mixContrast(): number { return this._uMixContrast.value; }
  set mixContrast(v: number) { this._uMixContrast.value = v; }

  /** Reflector offset along its normal. */
  get reflectorOffset(): number { return this._reflectorOffset; }
  set reflectorOffset(v: number) { this._reflectorOffset = v; }

  /**
   * Inject reflection uniforms and shader code into the standard material.
   *
   * Called automatically by Three.js when the material is first used for rendering.
   * You should not need to call this directly.
   */
  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
    if (!shader.defines?.USE_UV) {
      shader.defines ??= {};
      shader.defines.USE_UV = '';
    }

    // Inject uniforms
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

    // Vertex shader: add textureMatrix uniform and my_vUv varying
    shader.vertexShader = `
      uniform mat4 textureMatrix;
      varying vec4 my_vUv;
    ${shader.vertexShader}`;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
        my_vUv = textureMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );`,
    );

    // Fragment shader: add reflection uniforms and compositing logic
    shader.fragmentShader = `
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
    ${shader.fragmentShader}`;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>

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
        vec3 my_normal = normalize( vec3( normalColor.r * 2.0 - 1.0, normalColor.b,  normalColor.g * 2.0 - 1.0 ) );
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
        depthFactor = smoothstep(minDepthThreshold, maxDepthThreshold, 1.0-(depth.r * depth.a));
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

      diffuseColor.rgb = diffuseColor.rgb * ((1.0 - min(1.0, mirror)) + newMerge.rgb * mixStrength);
      `,
    );
  }

  /**
   * Update the reflection texture for the current frame.
   *
   * **Must be called every frame before `renderer.render(scene, camera)`.**
   * This renders the scene from a mirrored virtual camera with an oblique clip plane
   * into an internal render target, then optionally applies a multi-pass blur.
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
    if (!parent || (parent as THREE.Mesh).material !== this) return false;

    // Compute virtual camera position and oblique clip plane
    const shouldRender = this._computeVirtualCamera(parent, camera);
    if (!shouldRender) return false;

    // Temporarily hide the reflector mesh to avoid self-reflection
    parent.visible = false;

    // Save renderer state
    const currentXrEnabled = renderer.xr.enabled;
    const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;

    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this._fbo1);
    renderer.state.buffers.depth.setMask(true);
    if (!renderer.autoClear) renderer.clear();
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
    const lookAtPosition = this._lookAtPosition;
    const clipPlane = this._clipPlane;
    const q = this._q;
    const textureMatrix = this._mat4;
    const virtualCamera = this._virtualCamera;
    const reflectorPlane = this._reflectorPlane;

    reflectorWorldPosition.setFromMatrixPosition(parent.matrixWorld);
    cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);
    rotationMatrix.extractRotation(parent.matrixWorld);

    normal.set(0, 0, 1).applyMatrix4(rotationMatrix);
    reflectorWorldPosition.addScaledVector(normal, this._reflectorOffset);

    view.subVectors(reflectorWorldPosition, cameraWorldPosition);

    // Avoid rendering when reflector is facing away
    if (view.dot(normal) > 0) return false;

    view.reflect(normal).negate();
    view.add(reflectorWorldPosition);

    rotationMatrix.extractRotation(camera.matrixWorld);
    lookAtPosition.set(0, 0, -1).applyMatrix4(rotationMatrix).add(cameraWorldPosition);

    target.subVectors(reflectorWorldPosition, lookAtPosition);
    target.reflect(normal).negate();
    target.add(reflectorWorldPosition);

    virtualCamera.position.copy(view);
    virtualCamera.up.set(0, 1, 0).applyMatrix4(rotationMatrix).reflect(normal);
    virtualCamera.lookAt(target);
    virtualCamera.far = camera.far;
    virtualCamera.updateMatrixWorld();
    virtualCamera.projectionMatrix.copy(camera.projectionMatrix);

    // Update the texture matrix
    textureMatrix.set(0.5, 0.0, 0.0, 0.5, 0.0, 0.5, 0.0, 0.5, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 1.0);
    textureMatrix.multiply(virtualCamera.projectionMatrix);
    textureMatrix.multiply(virtualCamera.matrixWorldInverse);
    textureMatrix.multiply(parent.matrixWorld);

    // Oblique clip plane
    reflectorPlane.setFromNormalAndCoplanarPoint(normal, reflectorWorldPosition);
    reflectorPlane.applyMatrix4(virtualCamera.matrixWorldInverse);

    clipPlane.set(
      reflectorPlane.normal.x,
      reflectorPlane.normal.y,
      reflectorPlane.normal.z,
      reflectorPlane.constant,
    );

    const projectionMatrix = virtualCamera.projectionMatrix;
    q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
    q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
    q.z = -1.0;
    q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];

    clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));

    projectionMatrix.elements[2] = clipPlane.x;
    projectionMatrix.elements[6] = clipPlane.y;
    projectionMatrix.elements[10] = clipPlane.z + 1.0;
    projectionMatrix.elements[14] = clipPlane.w;

    return true;
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
