import {
  AttachedBindMode,
  type BindMode,
  Box3,
  type BufferAttribute,
  type BufferGeometry,
  type Camera,
  Color,
  ColorManagement,
  type ColorRepresentation,
  type DataTexture,
  DetachedBindMode,
  InstancedBufferAttribute,
  type Intersection,
  type Material,
  Matrix4,
  Mesh,
  type Object3D,
  type Object3DEventMap,
  type Raycaster,
  type Scene,
  type Skeleton,
  Sphere,
  Vector3,
  type WebGLProgram,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import { InstancedEntity } from './InstancedEntity';
import { type BVHParams, InstancedMeshBVH } from './InstancedMeshBVH';
import {
  type CustomSortCallback,
  type OnFrustumEnterCallback,
  frustumCullingAlreadyPerformed,
  performFrustumCulling,
} from './feature/FrustumCulling';
import {
  type Entity,
  type UpdateEntityCallback,
  addInstances,
  clearInstances,
  removeInstances,
  resizeBuffers,
  updateInstances,
  updateInstancesPosition,
} from './feature/Instances';
import {
  type LODInfo,
  addLOD,
  addShadowLOD,
  removeLOD,
  setFirstLODDistance,
  updateAllLOD,
  updateAllShadowLOD,
  updateLOD,
  updateShadowLOD,
} from './feature/LOD';
import { SquareDataTexture, type UniformValue, type UniformValueObj } from './utils/SquareDataTexture';
import { getMorphAt, setMorphAt } from './feature/Morph';
import {
  type UniformSchemaShader,
  getUniformAt,
  initUniformsPerInstance,
  setUniformAt,
} from './feature/Uniforms';
import { initSkeleton, setBonesAt } from './feature/Skeleton';
import { patchProperties, unpatchProperties } from './utils/PropertiesOverride';
import { GLInstancedBufferAttribute } from './utils/GLInstancedBufferAttribute';
import { patchShaderChunks } from './shaders/ShaderChunk';
import { raycast } from './feature/Raycasting';

// Patch shader chunks on import
patchShaderChunks();

const DEFAULT_CAPACITY = 1000;
const MATRIX_ELEMENTS = 16;
const W_OFFSET = 3;
const COL1_BASE = 4;
const COL2_BASE = 8;
const COL3_BASE = 12;
const COLOR_ELEMENTS = 4;
const ALPHA_OFFSET = 3;
const CHANNELS_RGBA = 4;
const PIXELS_PER_MATRIX = 4;
const BYTES_PER_UINT32 = 4;

const tempBox3 = new Box3();
const tempSphere = new Sphere();
const tempMat4 = new Matrix4();
const tempCol = new Color();
const tempPosition = new Vector3();

/**
 * Parameters for configuring an `InstancedMesh2` instance.
 */
export interface InstancedMesh2Params {

    /** Maximum number of instances that buffers can hold. @default 1000 */
    capacity?: number;

    /** Create an array of `InstancedEntity` for per-instance manipulation. @default false */
    createEntities?: boolean;

    /** Allow `InstancedEntity.rotation` (Euler), synced with quaternion. @default false */
    allowsEuler?: boolean;

    /** WebGL renderer. If not provided, buffers init on first render. */
    renderer?: WebGLRenderer;
}

interface RenderInfo {
    frame: number;
    camera: Camera | null;
    shadowCamera: Camera | null;
}

/** Shape of three.js internal material properties returned by `renderer.properties.get`. */
interface MaterialProperties {
    uniforms?: unknown;
    currentProgram?: { program?: WebGLProgram; getUniforms: () => { map: unknown } };
}

/**
 * Enhanced `InstancedMesh` with per-instance frustum culling, BVH-accelerated raycasting,
 * LOD, per-instance uniforms, skeletal animation, morph targets, and indirect instancing.
 *
 * Unlike standard `THREE.InstancedMesh`, this class uses **indirect instancing** via data textures,
 * allowing per-instance culling/sorting without buffer reallocation.
 *
 * @template TData Type for additional instance data.
 * @template TGeometry Type extending `BufferGeometry`.
 * @template TMaterial Type extending `Material` or an array of `Material`.
 */
export class InstancedMesh2<
    TData = Record<string, never>,
    TGeometry extends BufferGeometry = BufferGeometry,
    TMaterial extends Material | Material[] = Material | Material[],
    TEventMap extends Object3DEventMap = Object3DEventMap
> extends Mesh<TGeometry, TMaterial, TEventMap> {
  /** The number of instances rendered in the last frame. */
  public declare count: number;

  /** @defaultValue `InstancedMesh2` */
  public override readonly type = 'InstancedMesh2';

  /** Indicates if this is an `InstancedMesh2`. */
  public readonly isInstancedMesh2 = true;

  /** Array of `Entity` representing individual instances (only if `createEntities: true`). */
  public instances: Entity<TData>[] | null = null;

  /** Attribute storing indices of instances to render. */
  public instanceIndex: GLInstancedBufferAttribute | null = null;

  /** Texture storing per-instance transformation matrices. */
  public matricesTexture!: SquareDataTexture;

  /** Texture storing per-instance colors. */
  public colorsTexture: SquareDataTexture | null = null;

  /** Texture storing per-instance morph target influences. */
  public morphTexture: DataTexture | null = null;

  /** Texture storing per-instance bone matrices. */
  public boneTexture: SquareDataTexture | null = null;

  /** Texture storing per-instance custom uniforms. */
  public uniformsTexture: SquareDataTexture | null = null;

  /** Bounding box enclosing all instances. */
  public boundingBox: Box3 | null = null;

  /** Bounding sphere enclosing all instances. */
  public boundingSphere: Sphere | null = null;

  /** BVH structure for optimized culling and intersection testing. */
  public bvh: InstancedMeshBVH | null = null;

  /** Custom sort function for instances. */
  public customSort: CustomSortCallback | null = null;

  /** Only raycast against frustum-visible instances. @default false */
  public raycastOnlyFrustum = false;

  /** Array storing visibility and availability: [visible0, active0, visible1, active1, ...] */
  public readonly availabilityArray: boolean[];

  /** LOD management data. */

  public LODinfo: LODInfo<TData> | null = null;

  /** Auto frustum culling before render. @default true */
  public autoUpdate = true;

  /** Bind mode for skeletal animation. @default `AttachedBindMode` */
  public bindMode: BindMode = AttachedBindMode;

  /** Base matrix for bound bone transforms. */
  public bindMatrix: Matrix4 | null = null;

  /** Inverse bind matrix. */
  public bindMatrixInverse: Matrix4 | null = null;

  /** Skeleton for per-instance skeletal animation. */
  public skeleton: Skeleton | null = null;

  /** Auto-update BVH when instance matrices change. @default true */
  public autoUpdateBVH = true;

  /** Callback when an instance is inside the frustum. */
  public onFrustumEnter: OnFrustumEnterCallback | null = null;

  /** @internal */ _renderer: WebGLRenderer | null = null;
  /** @internal */ _instancesCount = 0;
  /** @internal */ _instancesArrayCount = 0;
  /** @internal */ _perObjectFrustumCulled = true;
  /** @internal */ _sortObjects = false;
  /** @internal */ _capacity: number;
  /** @internal */ _indexArrayNeedsUpdate = false;
  /** @internal */ _geometry: TGeometry;
  /** @internal */ _parentLOD: InstancedMesh2 | null;
  /** @internal */ _lastRenderInfo!: RenderInfo;
  /** @internal */ _useOpacity = false;
  /** @internal */ readonly _allowsEuler: boolean;
  /** @internal */ readonly _tempInstance: InstancedEntity;
  /** @internal */ _createEntities: boolean;

  // HACK: make Three.js renderer treat this as instanced
  /** @internal */ isInstancedMesh = true;
  /** @internal */ instanceMatrix = new InstancedBufferAttribute(new Float32Array(0), MATRIX_ELEMENTS);
  /** @internal */ instanceColor = null;

  protected _currentMaterial: Material | null = null;
  protected _customProgramCacheKeyBase: (() => string) | null = null;
  protected _onBeforeCompileBase: ((
    parameters: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer,
  ) => void) | null = null;

  protected _definesBase: Record<string, unknown> | null = null;
  protected _freeIds: number[] = [];

  /** The capacity of the instance buffers. */
  public get capacity(): number {
    return this._capacity;
  }

  /** The number of active instances. */
  public get instancesCount(): number {
    return this._instancesCount;
  }

  /** Per-instance frustum culling. @default true */
  public get perObjectFrustumCulled(): boolean {
    return this._perObjectFrustumCulled;
  }

  public set perObjectFrustumCulled(value: boolean) {
    this._perObjectFrustumCulled = value;
    this._indexArrayNeedsUpdate = true;
  }

  /** Sort instances before rendering. @default false */
  public get sortObjects(): boolean {
    return this._sortObjects;
  }

  public set sortObjects(value: boolean) {
    this._sortObjects = value;
    this._indexArrayNeedsUpdate = true;
  }

  /** BufferGeometry instance. */
  // @ts-expect-error Overridden accessor
  public override get geometry(): TGeometry {
    return this._geometry;
  }

  public override set geometry(value: TGeometry) {
    this._geometry = value;
    this.patchGeometry(value);
  }

  /**
     * Creates an `InstancedMesh2`.
     * @remarks Geometry cannot be shared. If reused, it will be cloned.
     */
  constructor(geometry: TGeometry, material: TMaterial, params: InstancedMesh2Params = {}, lod?: InstancedMesh2) {
    if (!geometry) {
      throw new Error('"geometry" is mandatory.');
    }
    if (!material) {
      throw new Error('"material" is mandatory.');
    }

    const { allowsEuler, renderer, createEntities } = params;

    super(geometry);

    const requestedCapacity = params.capacity ?? 0;
    const capacity = requestedCapacity > 0 ? requestedCapacity : DEFAULT_CAPACITY;
    this._renderer = renderer ?? null;
    this._capacity = capacity;
    this._parentLOD = lod ?? null;
    this._geometry = geometry;
    this.material = material;
    this._allowsEuler = allowsEuler ?? false;
    this._tempInstance = new InstancedEntity(this, -1, allowsEuler ?? false);
    this.availabilityArray = lod?.availabilityArray ?? new Array(capacity * 2);
    this._createEntities = createEntities ?? false;

    this.initLastRenderInfo();
    this.initIndexAttribute();
    this.initMatricesTexture();
  }

  // eslint-disable-next-line max-params
  public override onBeforeShadow(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    shadowCamera: Camera,
    geometry: BufferGeometry,
    depthMaterial: Material,
    group: unknown,
  ): void {
    void group;
    this.patchMaterial(renderer, depthMaterial);
    this.updateTextures(renderer, depthMaterial);

    const frame = renderer.info.render.frame;
    if (this.instanceIndex && this.autoUpdate
      && !frustumCullingAlreadyPerformed.call(this, frame, camera, shadowCamera)) {
      performFrustumCulling.call(this, shadowCamera, camera);
    }

    if (this.count === 0) {
      return;
    }

    this.instanceIndex!.update(this._renderer!, this.count);
    this.bindTextures(renderer, depthMaterial);
  }

  // eslint-disable-next-line max-params
  public override onBeforeRender(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    geometry: BufferGeometry,
    material: Material,
    group: unknown,
  ): void {
    void group;
    this.patchMaterial(renderer, material);
    this.updateTextures(renderer, material);

    if (!this.instanceIndex) {
      this._renderer = renderer;
      return;
    }

    const frame = renderer.info.render.frame;
    if (this.autoUpdate && !frustumCullingAlreadyPerformed.call(this, frame, camera, null)) {
      performFrustumCulling.call(this, camera);
    }

    if (this.count === 0) {
      return;
    }

    this.instanceIndex.update(this._renderer!, this.count);
    this.bindTextures(renderer, material);
  }

  // eslint-disable-next-line max-params
  public override onAfterShadow(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    shadowCamera: Camera,
    geometry: BufferGeometry,
    depthMaterial: Material,
    group: unknown,
  ): void {
    void group;
    this.unpatchMaterial(renderer, depthMaterial);
  }

  // eslint-disable-next-line max-params
  public override onAfterRender(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    geometry: BufferGeometry,
    material: Material,
    group: unknown,
  ): void {
    this.unpatchMaterial(renderer, material);
    if (this.instanceIndex || (group && !this.isLastGroup((group as { materialIndex: number }).materialIndex))) {
      return;
    }
    this.initIndexAttribute();
  }

  // ─── Instance Management ──────────────────────────────────────────

  /** Adds new instances. Optionally initializes them via callback. */
  public addInstances(count: number, onCreation?: UpdateEntityCallback<Entity<TData>>): this {
    return addInstances.call(this, count, onCreation as UpdateEntityCallback) as unknown as this;
  }

  /** Removes instances by their ids. */
  public removeInstances(...ids: number[]): this {
    return removeInstances.call(this, ...ids) as unknown as this;
  }

  /** Clears all instances and resets count. */
  public clearInstances(): this {
    return clearInstances.call(this) as unknown as this;
  }

  /** Updates instances by applying a callback to each. Calls `updateMatrix` for each. */
  public updateInstances(onUpdate: UpdateEntityCallback<Entity<TData>>): this {
    return updateInstances.call(this, onUpdate as UpdateEntityCallback) as unknown as this;
  }

  /** Updates instances position only. Calls `updateMatrixPosition` for each. */
  public updateInstancesPosition(onUpdate: UpdateEntityCallback<Entity<TData>>): this {
    return updateInstancesPosition.call(this, onUpdate as UpdateEntityCallback) as unknown as this;
  }

  /** Resizes internal buffers to accommodate the specified capacity. */
  public resizeBuffers(capacity: number): this {
    return resizeBuffers.call(this, capacity) as unknown as this;
  }

  // ─── BVH ──────────────────────────────────────────────────────────

  /** Creates and computes the BVH. Recommended after all matrices are assigned. */
  public computeBVH(config: BVHParams = {}): void {
    if (!this.bvh) {
      this.bvh = new InstancedMeshBVH(
        this as unknown as InstancedMesh2,
        config.margin,
        config.getBBoxFromBSphere,
        config.accurateCulling,
      );
    }
    this.bvh.clear();
    this.bvh.create();
  }

  /** Disposes the BVH structure. */
  public disposeBVH(): void {
    this.bvh = null;
  }

  // ─── Matrix ───────────────────────────────────────────────────────

  /** Sets the local transformation matrix for a specific instance. */
  public setMatrixAt(id: number, matrix: Matrix4): void {
    matrix.toArray(this.matricesTexture._data, id * MATRIX_ELEMENTS);

    if (this.instances) {
      const instance = this.instances[id];
      matrix.decompose(instance.position, instance.quaternion, instance.scale);
    }

    this.matricesTexture.enqueueUpdate(id);

    if (this.bvh && this.autoUpdateBVH) {
      this.bvh.move(id);
    }
  }

  /** Gets the local transformation matrix of a specific instance. */
  public getMatrixAt(id: number, matrix = tempMat4): Matrix4 {
    return matrix.fromArray(this.matricesTexture._data, id * MATRIX_ELEMENTS);
  }

  /** Retrieves the position of a specific instance. */
  public getPositionAt(index: number, target = tempPosition): Vector3 {
    const offset = index * MATRIX_ELEMENTS;
    const array = this.matricesTexture._data;
    target.x = array[offset + COL3_BASE];
    target.y = array[offset + COL3_BASE + 1];
    target.z = array[offset + COL3_BASE + 2];
    return target;
  }

  /** @internal */
  public getPositionAndMaxScaleOnAxisAt(index: number, position: Vector3): number {
    const offset = index * MATRIX_ELEMENTS;
    const array = this.matricesTexture._data;

    const te0 = array[offset];
    const te1 = array[offset + 1];
    const te2 = array[offset + 2];
    const scaleXSq = te0 * te0 + te1 * te1 + te2 * te2;

    const te4 = array[offset + COL1_BASE];
    const te5 = array[offset + COL1_BASE + 1];
    const te6 = array[offset + COL1_BASE + 2];
    const scaleYSq = te4 * te4 + te5 * te5 + te6 * te6;

    const te8 = array[offset + COL2_BASE];
    const te9 = array[offset + COL2_BASE + 1];
    const te10 = array[offset + COL2_BASE + 2];
    const scaleZSq = te8 * te8 + te9 * te9 + te10 * te10;

    position.x = array[offset + COL3_BASE];
    position.y = array[offset + COL3_BASE + 1];
    position.z = array[offset + COL3_BASE + 2];

    return Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
  }

  /** @internal */
  public applyMatrixAtToSphere(index: number, sphere: Sphere, center: Vector3, radius: number): void {
    const offset = index * MATRIX_ELEMENTS;
    const array = this.matricesTexture._data;

    const te0 = array[offset];
    const te1 = array[offset + 1];
    const te2 = array[offset + 2];
    const te3 = array[offset + W_OFFSET];
    const te4 = array[offset + COL1_BASE];
    const te5 = array[offset + COL1_BASE + 1];
    const te6 = array[offset + COL1_BASE + 2];
    const te7 = array[offset + COL1_BASE + W_OFFSET];
    const te8 = array[offset + COL2_BASE];
    const te9 = array[offset + COL2_BASE + 1];
    const te10 = array[offset + COL2_BASE + 2];
    const te11 = array[offset + COL2_BASE + W_OFFSET];
    const te12 = array[offset + COL3_BASE];
    const te13 = array[offset + COL3_BASE + 1];
    const te14 = array[offset + COL3_BASE + 2];
    const te15 = array[offset + COL3_BASE + W_OFFSET];

    const position = sphere.center;
    const x = center.x;
    const y = center.y;
    const z = center.z;
    const w = 1 / (te3 * x + te7 * y + te11 * z + te15);

    position.x = (te0 * x + te4 * y + te8 * z + te12) * w;
    position.y = (te1 * x + te5 * y + te9 * z + te13) * w;
    position.z = (te2 * x + te6 * y + te10 * z + te14) * w;

    const scaleXSq = te0 * te0 + te1 * te1 + te2 * te2;
    const scaleYSq = te4 * te4 + te5 * te5 + te6 * te6;
    const scaleZSq = te8 * te8 + te9 * te9 + te10 * te10;

    sphere.radius = radius * Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
  }

  // ─── Visibility / Availability ────────────────────────────────────

  public setVisibilityAt(id: number, visible: boolean): void {
    this.availabilityArray[id * 2] = visible;
    this._indexArrayNeedsUpdate = true;
  }

  public getVisibilityAt(id: number): boolean {
    return this.availabilityArray[id * 2];
  }

  public setActiveAt(id: number, active: boolean): void {
    this.availabilityArray[id * 2 + 1] = active;
    this._indexArrayNeedsUpdate = true;
  }

  public getActiveAt(id: number): boolean {
    return this.availabilityArray[id * 2 + 1];
  }

  public getActiveAndVisibilityAt(id: number): boolean {
    const offset = id * 2;
    return this.availabilityArray[offset] && this.availabilityArray[offset + 1];
  }

  public setActiveAndVisibilityAt(id: number, value: boolean): void {
    const offset = id * 2;
    this.availabilityArray[offset] = value;
    this.availabilityArray[offset + 1] = value;
    this._indexArrayNeedsUpdate = true;
  }

  // ─── Color / Opacity ──────────────────────────────────────────────

  public setColorAt(id: number, color: ColorRepresentation): void {
    if (this.colorsTexture === null) {
      this.initColorsTexture();
    }

    if ((color as Color).isColor) {
      (color as Color).toArray(this.colorsTexture!._data, id * COLOR_ELEMENTS);
    } else {
      tempCol.set(color).toArray(this.colorsTexture!._data, id * COLOR_ELEMENTS);
    }

    this.colorsTexture!.enqueueUpdate(id);
  }

  public getColorAt(id: number, color = tempCol): Color {
    return color.fromArray(this.colorsTexture!._data, id * COLOR_ELEMENTS);
  }

  public setOpacityAt(id: number, value: number): void {
    if (!this._useOpacity) {
      if (this.colorsTexture === null) {
        this.initColorsTexture();
      } else {
        this.materialsNeedsUpdate();
      }
      this._useOpacity = true;
    }

    this.colorsTexture!._data[id * COLOR_ELEMENTS + ALPHA_OFFSET] = value;
    this.colorsTexture!.enqueueUpdate(id);
  }

  public getOpacityAt(id: number): number {
    if (!this._useOpacity) {
      return 1;
    }
    return this.colorsTexture!._data[id * COLOR_ELEMENTS + ALPHA_OFFSET];
  }

  // ─── Copy To ──────────────────────────────────────────────────────

  public copyTo(id: number, target: Object3D): void {
    this.getMatrixAt(id, target.matrix).decompose(target.position, target.quaternion, target.scale);
  }

  // ─── Bounding ─────────────────────────────────────────────────────

  public computeBoundingBox(): void {
    const geometry = this._geometry;
    const count = this._instancesArrayCount;

    this.boundingBox ??= new Box3();
    if (geometry.boundingBox === null) {
      geometry.computeBoundingBox();
    }

    const geoBoundingBox = geometry.boundingBox!;
    const boundingBox = this.boundingBox;
    boundingBox.makeEmpty();

    for (let i = 0; i < count; i++) {
      if (!this.getActiveAt(i)) {
        // eslint-disable-next-line no-continue
        continue;
      }
      tempBox3.copy(geoBoundingBox).applyMatrix4(this.getMatrixAt(i));
      boundingBox.union(tempBox3);
    }
  }

  public computeBoundingSphere(): void {
    const geometry = this._geometry;
    const count = this._instancesArrayCount;

    this.boundingSphere ??= new Sphere();
    if (geometry.boundingSphere === null) {
      geometry.computeBoundingSphere();
    }

    const geoBoundingSphere = geometry.boundingSphere!;
    const boundingSphere = this.boundingSphere;
    boundingSphere.makeEmpty();

    for (let i = 0; i < count; i++) {
      if (!this.getActiveAt(i)) {
        // eslint-disable-next-line no-continue
        continue;
      }
      tempSphere.copy(geoBoundingSphere).applyMatrix4(this.getMatrixAt(i));
      boundingSphere.union(tempSphere);
    }
  }

  // ─── LOD ──────────────────────────────────────────────────────────

  public setFirstLODDistance(distance: number): this {
    return setFirstLODDistance.call(this, distance) as unknown as this;
  }

  public addLOD(
    geometry: BufferGeometry,
    material: Material | Material[],
    distance?: number,
    hysteresis?: number,
  ): this {
    return addLOD.call(this, geometry, material, distance, hysteresis) as unknown as this;
  }

  public addShadowLOD(geometry: BufferGeometry, distance?: number, hysteresis?: number): this {
    return addShadowLOD.call(this, geometry, distance, hysteresis) as unknown as this;
  }

  public updateLOD(levelIndex: number, distance?: number, hysteresis?: number): this {
    return updateLOD.call(this, levelIndex, distance, hysteresis) as unknown as this;
  }

  public updateShadowLOD(levelIndex: number, distance?: number, hysteresis?: number): this {
    return updateShadowLOD.call(this, levelIndex, distance, hysteresis) as unknown as this;
  }

  public updateAllLOD(distances?: number[], hysteresis?: number | number[]): this {
    return updateAllLOD.call(this, distances, hysteresis) as unknown as this;
  }

  public updateAllShadowLOD(distances?: number[], hysteresis?: number | number[]): this {
    return updateAllShadowLOD.call(this, distances, hysteresis) as unknown as this;
  }

  public removeLOD(levelIndex: number, removeObject?: boolean): this {
    return removeLOD.call(this, levelIndex, removeObject) as unknown as this;
  }

  // ─── Skeleton ─────────────────────────────────────────────────────

  public initSkeleton(skeleton: Skeleton, disableMatrixAutoUpdate?: boolean): void {
    initSkeleton.call(this, skeleton, disableMatrixAutoUpdate);
  }

  public setBonesAt(id: number, updateBonesMatrices?: boolean, excludeBonesSet?: Set<string>): void {
    setBonesAt.call(this, id, updateBonesMatrices, excludeBonesSet);
  }

  // ─── Uniforms ─────────────────────────────────────────────────────

  public initUniformsPerInstance(schema: unknown): void {
    initUniformsPerInstance.call(this, schema as UniformSchemaShader);
  }

  public getUniformAt(id: number, name: string, target?: UniformValueObj): UniformValue {
    return getUniformAt.call(this, id, name, target);
  }

  public setUniformAt(id: number, name: string, value: UniformValue): void {
    setUniformAt.call(this, id, name, value);
  }

  // ─── Morph ────────────────────────────────────────────────────────

  public getMorphAt(id: number, object?: unknown): unknown {
    return getMorphAt.call(this, id, object as Mesh);
  }

  public setMorphAt(id: number, object: unknown): void {
    setMorphAt.call(this, id, object as Mesh);
  }

  // ─── Raycasting ───────────────────────────────────────────────────

  public override raycast(raycaster: unknown, result: unknown[]): void {
    raycast.call(this, raycaster as Raycaster, result as Intersection[]);
  }

  // ─── Frustum Culling (public) ─────────────────────────────────────

  public performFrustumCulling(camera: Camera, cameraLOD = camera): void {
    performFrustumCulling.call(this, camera, cameraLOD);
  }

  // ─── Clone / Copy ─────────────────────────────────────────────────

  public override clone(recursive?: boolean): this {
    const params: InstancedMesh2Params = {
      capacity: this._capacity,
      renderer: this._renderer ?? undefined,
      allowsEuler: this._allowsEuler,
      createEntities: this._createEntities,
    };
    const ctor = this.constructor as new (
      geometry: TGeometry, material: TMaterial, params: InstancedMesh2Params,
    ) => this;
    // eslint-disable-next-line new-cap
    return new ctor(this.geometry, this.material, params).copy(this, recursive);
  }

  public override copy(source: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, recursive?: boolean): this {
    super.copy(source, recursive);

    this.count = source._capacity;
    this._instancesCount = source._instancesCount;
    this._instancesArrayCount = source._instancesArrayCount;
    this._capacity = source._capacity;

    if (source.boundingBox !== null) {
      this.boundingBox = source.boundingBox.clone();
    }
    if (source.boundingSphere !== null) {
      this.boundingSphere = source.boundingSphere.clone();
    }

    this.matricesTexture = source.matricesTexture.clone();
    this.matricesTexture.image.data = (this.matricesTexture.image.data as Uint8Array).slice();

    if (source.colorsTexture !== null) {
      this.colorsTexture = source.colorsTexture.clone();
      this.colorsTexture.image.data = (this.colorsTexture.image.data as Uint8Array).slice();
    }

    if (source.uniformsTexture !== null) {
      this.uniformsTexture = source.uniformsTexture.clone();
      this.uniformsTexture.image.data = (this.uniformsTexture.image.data as Uint8Array).slice();
    }

    if (source.morphTexture !== null) {
      this.morphTexture = source.morphTexture.clone();
      this.morphTexture.image.data = (this.morphTexture.image.data as Uint8Array).slice();
    }

    if (source.boneTexture !== null) {
      this.boneTexture = source.boneTexture.clone();
      this.boneTexture.image.data = (this.boneTexture.image.data as Uint8Array).slice();
    }

    return this;
  }

  // ─── Dispose ──────────────────────────────────────────────────────

  public dispose(): void {
    this.dispatchEvent({ type: 'dispose' } as never);

    this.matricesTexture.dispose();
    this.colorsTexture?.dispose();
    this.morphTexture?.dispose();
    this.boneTexture?.dispose();
    this.uniformsTexture?.dispose();
  }

  public override updateMatrixWorld(force?: boolean): void {
    super.updateMatrixWorld(force);

    if (!this.bindMatrixInverse) {
      return;
    }

    if (this.bindMode === AttachedBindMode) {
      this.bindMatrixInverse.copy(this.matrixWorld).invert();
    } else if (this.bindMode === DetachedBindMode) {
      this.bindMatrixInverse.copy(this.bindMatrix!).invert();
    } else {
      // eslint-disable-next-line no-console
      console.warn(`Unrecognized bindMode: ${ this.bindMode}`);
    }
  }

  // ─── Protected Internals ──────────────────────────────────────────

  protected updateTextures(renderer: WebGLRenderer, material: Material): void {
    const materialProperties = renderer.properties.get(material);

    this.matricesTexture.update(renderer, materialProperties, 'matricesTexture');
    this.colorsTexture?.update(renderer, materialProperties, 'colorsTexture');
    this.uniformsTexture?.update(renderer, materialProperties, 'uniformsTexture');
    this.boneTexture?.update(renderer, materialProperties, 'boneTexture');
  }

  protected bindTextures(renderer: WebGLRenderer, material: Material): void {
    const materialProperties = renderer.properties.get(material) as MaterialProperties;
    const materialUniforms = materialProperties.uniforms;
    if (!materialUniforms) {
      return;
    }

    const currentProgramProperties = materialProperties.currentProgram;
    const currentProgram = currentProgramProperties?.program;
    if (!currentProgram) {
      return;
    }

    const gl = renderer.getContext() as WebGL2RenderingContext;
    const programUniforms = currentProgramProperties.getUniforms().map;

    const activeProgram = gl.getParameter(gl.CURRENT_PROGRAM);
    renderer.state.useProgram(currentProgram);

    this.matricesTexture.bindToProgram(renderer, gl, programUniforms, materialUniforms, 'matricesTexture');
    this.colorsTexture?.bindToProgram(renderer, gl, programUniforms, materialUniforms, 'colorsTexture');
    this.uniformsTexture?.bindToProgram(renderer, gl, programUniforms, materialUniforms, 'uniformsTexture');
    this.boneTexture?.bindToProgram(renderer, gl, programUniforms, materialUniforms, 'boneTexture');

    renderer.state.useProgram(activeProgram);
  }

  protected isLastGroup(materialIndex: number): boolean {
    const materials = this.material as Material[];
    for (let i = materials.length - 1; i >= materialIndex; i--) {
      if (materials[i].visible) {
        return i === materialIndex;
      }
    }
    return false;
  }

  protected initIndexAttribute(): void {
    if (!this._renderer) {
      this.count = 0;
      return;
    }

    const gl = this._renderer.getContext() as WebGL2RenderingContext;
    const capacity = this._capacity;
    const array = new Uint32Array(capacity);

    for (let i = 0; i < capacity; i++) {
      array[i] = i;
    }

    this.instanceIndex = new GLInstancedBufferAttribute(gl, gl.UNSIGNED_INT, 1, BYTES_PER_UINT32, array);
    this._geometry.setAttribute('instanceIndex', this.instanceIndex as unknown as BufferAttribute);
  }

  protected initLastRenderInfo(): void {
    if (!this._parentLOD) {
      this._lastRenderInfo = { frame: -1, camera: null, shadowCamera: null };
    }
  }

  protected initMatricesTexture(): void {
    if (!this._parentLOD) {
      this.matricesTexture = new SquareDataTexture(Float32Array, CHANNELS_RGBA, PIXELS_PER_MATRIX, this._capacity);
    }
  }

  protected initColorsTexture(): void {
    if (!this._parentLOD) {
      this.colorsTexture = new SquareDataTexture(Float32Array, CHANNELS_RGBA, 1, this._capacity);
      this.colorsTexture.colorSpace = ColorManagement.workingColorSpace;
      this.colorsTexture._data.fill(1);
      this.materialsNeedsUpdate();
    }
  }

  protected materialsNeedsUpdate(): void {
    if ((this.material as Material).isMaterial) {
      (this.material as Material).needsUpdate = true;
      return;
    }

    for (const material of (this.material as Material[])) {
      material.needsUpdate = true;
    }
  }

  protected patchGeometry(geometry: TGeometry): void {
    let geom = geometry;
    const instanceIndex = geom.getAttribute('instanceIndex') as unknown as GLInstancedBufferAttribute;

    if (instanceIndex) {
      if (instanceIndex === this.instanceIndex) {
        return;
      }

      // eslint-disable-next-line no-console
      console.warn('The geometry has been cloned because it was already used.');
      geom = geom.clone();
      geom.deleteAttribute('instanceIndex');
    }

    if (this.instanceIndex) {
      geom.setAttribute('instanceIndex', this.instanceIndex as unknown as BufferAttribute);
    }
  }

  protected _customProgramCacheKey = (): string => [
    'ez',
    String(Boolean(this.colorsTexture)),
    String(this._useOpacity),
    String(Boolean(this.boneTexture)),
    String(Boolean(this.uniformsTexture)),
    this._customProgramCacheKeyBase?.call(this._currentMaterial) ?? '',
  ].join('_');

  protected _onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer): void => {
    if (this._onBeforeCompileBase) {
      this._onBeforeCompileBase.call(this._currentMaterial, shader, renderer);
    }

    shader.defines = { ...shader.defines };
    shader.defines.USE_INSTANCING_INDIRECT = '';

    shader.uniforms.matricesTexture = { value: this.matricesTexture };

    if (this.uniformsTexture) {
      shader.uniforms.uniformsTexture = { value: this.uniformsTexture };
      const { vertex, fragment } = this.uniformsTexture.getUniformsGLSL('uniformsTexture', 'instanceIndex', 'uint');
      shader.vertexShader = shader.vertexShader.replace('void main() {', vertex);
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', fragment);
    }

    if (this.colorsTexture && shader.fragmentShader.includes('#include <color_pars_fragment>')) {
      shader.defines.USE_INSTANCING_COLOR_INDIRECT = '';
      shader.uniforms.colorsTexture = { value: this.colorsTexture };
      shader.vertexShader = shader.vertexShader.replace('<color_vertex>', '<instanced_color_vertex>');

      if (shader.vertexColors) {
        shader.defines.USE_VERTEX_COLOR = '';
      }

      shader.defines.USE_COLOR_ALPHA = '';
    }

    if (this.boneTexture) {
      shader.defines.USE_SKINNING = '';
      shader.defines.USE_INSTANCING_SKINNING = '';
      shader.uniforms.bindMatrix = { value: this.bindMatrix };
      shader.uniforms.bindMatrixInverse = { value: this.bindMatrixInverse };
      shader.uniforms.bonesPerInstance = { value: this.skeleton!.bones.length };
      shader.uniforms.boneTexture = { value: this.boneTexture };
    }
  };

  protected patchMaterial(renderer: WebGLRenderer, material: Material): void {
    this._currentMaterial = material;
    this._customProgramCacheKeyBase = material.customProgramCacheKey;
    this._onBeforeCompileBase = material.onBeforeCompile;
    this._definesBase = material.defines ?? null;
    material.customProgramCacheKey = this._customProgramCacheKey;
    material.onBeforeCompile = this._onBeforeCompile;
    patchProperties(this, renderer, material);
  }

  protected unpatchMaterial(renderer: WebGLRenderer, material: Material): void {
    this._currentMaterial = null;
    unpatchProperties(renderer);
    material.defines = this._definesBase!;
    material.onBeforeCompile = this._onBeforeCompileBase!;
    material.customProgramCacheKey = this._customProgramCacheKeyBase!;
    this._onBeforeCompileBase = null;
    this._customProgramCacheKeyBase = null;
    this._definesBase = null;
  }
}
