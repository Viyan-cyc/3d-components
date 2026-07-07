// @ts-nocheck
import { AttachedBindMode, Box3, BufferAttribute, BufferGeometry, Camera, Color, ColorManagement, DataTexture, DetachedBindMode, InstancedBufferAttribute, Material, Matrix4, Mesh, Object3D, Scene, Skeleton, Sphere, Vector3, WebGLRenderer } from 'three';
import type { BindMode, ColorRepresentation, Object3DEventMap, TypedArray, WebGLProgramParametersWithUniforms } from 'three';
import { InstancedMeshBVH } from './InstancedMeshBVH';
import type { BVHParams } from './InstancedMeshBVH';
import { InstancedEntity } from './InstancedEntity';
import { performFrustumCulling, frustumCullingAlreadyPerformed, frustumCulling, updateIndexArray, frustumCullingLOD, getObjectLODIndexForDistance } from './feature/FrustumCulling';
import type { CustomSortCallback, OnFrustumEnterCallback } from './feature/FrustumCulling';
import { addInstances, removeInstances, clearInstances, updateInstances, updateInstancesPosition, setInstancesArrayCount, resizeBuffers, createEntities } from './feature/Instances';
import type { Entity, UpdateEntityCallback } from './feature/Instances';
import { setFirstLODDistance, addLOD, addShadowLOD, updateLOD, updateShadowLOD, updateAllLOD, updateAllShadowLOD, removeLOD } from './feature/LOD';
import type { LODInfo, LODLevel, LODRenderList } from './feature/LOD';
import { initSkeleton, setBonesAt } from './feature/Skeleton';
import { initUniformsPerInstance, getUniformAt, setUniformAt } from './feature/Uniforms';
import { getMorphAt, setMorphAt } from './feature/Morph';
import { raycast } from './feature/Raycasting';
import { GLInstancedBufferAttribute } from './utils/GLInstancedBufferAttribute';
import { patchProperties, unpatchProperties } from './utils/PropertiesOverride';
import { SquareDataTexture } from './utils/SquareDataTexture';
import type { UniformValue, UniformValueObj } from './utils/SquareDataTexture';
import { patchShaderChunks } from './shaders/ShaderChunk';

// Patch shader chunks on import
patchShaderChunks();

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
    TData = {},
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
    public instances: Entity<TData>[] = null;
    /** Attribute storing indices of instances to render. */
    public instanceIndex: GLInstancedBufferAttribute = null;
    /** Texture storing per-instance transformation matrices. */
    public matricesTexture: SquareDataTexture;
    /** Texture storing per-instance colors. */
    public colorsTexture: SquareDataTexture = null;
    /** Texture storing per-instance morph target influences. */
    public morphTexture: DataTexture = null;
    /** Texture storing per-instance bone matrices. */
    public boneTexture: SquareDataTexture = null;
    /** Texture storing per-instance custom uniforms. */
    public uniformsTexture: SquareDataTexture = null;
    /** Bounding box enclosing all instances. */
    public boundingBox: Box3 = null;
    /** Bounding sphere enclosing all instances. */
    public boundingSphere: Sphere = null;
    /** BVH structure for optimized culling and intersection testing. */
    public bvh: InstancedMeshBVH = null;
    /** Custom sort function for instances. */
    public customSort: CustomSortCallback = null;
    /** Only raycast against frustum-visible instances. @default false */
    public raycastOnlyFrustum = false;
    /** Array storing visibility and availability: [visible0, active0, visible1, active1, ...] */
    public readonly availabilityArray: boolean[];
    /** LOD management data. */
    public LODinfo: LODInfo<TData> = null;
    /** Auto frustum culling before render. @default true */
    public autoUpdate = true;
    /** Bind mode for skeletal animation. @default `AttachedBindMode` */
    public bindMode: BindMode = AttachedBindMode;
    /** Base matrix for bound bone transforms. */
    public bindMatrix: Matrix4 = null;
    /** Inverse bind matrix. */
    public bindMatrixInverse: Matrix4 = null;
    /** Skeleton for per-instance skeletal animation. */
    public skeleton: Skeleton = null;
    /** Auto-update BVH when instance matrices change. @default true */
    public autoUpdateBVH = true;
    /** Callback when an instance is inside the frustum. */
    public onFrustumEnter: OnFrustumEnterCallback = null;

    /** @internal */ _renderer: WebGLRenderer = null;
    /** @internal */ _instancesCount = 0;
    /** @internal */ _instancesArrayCount = 0;
    /** @internal */ _perObjectFrustumCulled = true;
    /** @internal */ _sortObjects = false;
    /** @internal */ _capacity: number;
    /** @internal */ _indexArrayNeedsUpdate = false;
    /** @internal */ _geometry: TGeometry;
    /** @internal */ _parentLOD: InstancedMesh2;
    /** @internal */ _lastRenderInfo: RenderInfo;
    /** @internal */ _useOpacity = false;
    /** @internal */ readonly _allowsEuler: boolean;
    /** @internal */ readonly _tempInstance: InstancedEntity;
    /** @internal */ _createEntities: boolean;

    // HACK: make Three.js renderer treat this as instanced
    /** @internal */ isInstancedMesh = true;
    /** @internal */ instanceMatrix = new InstancedBufferAttribute(new Float32Array(0), 16);
    /** @internal */ instanceColor = null;

    protected _currentMaterial: Material = null;
    protected _customProgramCacheKeyBase: () => string = null;
    protected _onBeforeCompileBase: (parameters: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => void = null;
    protected _definesBase: { [key: string]: any } = null;
    protected _freeIds: number[] = [];

    /** The capacity of the instance buffers. */
    public get capacity(): number { return this._capacity; }

    /** The number of active instances. */
    public get instancesCount(): number { return this._instancesCount; }

    /** Per-instance frustum culling. @default true */
    public get perObjectFrustumCulled(): boolean { return this._perObjectFrustumCulled; }
    public set perObjectFrustumCulled(value: boolean) {
        this._perObjectFrustumCulled = value;
        this._indexArrayNeedsUpdate = true;
    }

    /** Sort instances before rendering. @default false */
    public get sortObjects(): boolean { return this._sortObjects; }
    public set sortObjects(value: boolean) {
        this._sortObjects = value;
        this._indexArrayNeedsUpdate = true;
    }

    /** BufferGeometry instance. */
    // @ts-expect-error Overridden accessor
    public override get geometry(): TGeometry { return this._geometry; }
    public override set geometry(value: TGeometry) {
        this._geometry = value;
        this.patchGeometry(value);
    }

    /**
     * Creates an `InstancedMesh2`.
     * @remarks Geometry cannot be shared. If reused, it will be cloned.
     */
    constructor(geometry: TGeometry, material: TMaterial, params: InstancedMesh2Params = {}, LOD?: InstancedMesh2) {
        if (!geometry) throw new Error('"geometry" is mandatory.');
        if (!material) throw new Error('"material" is mandatory.');

        const { allowsEuler, renderer, createEntities } = params;

        super(geometry, null);

        const capacity = params.capacity > 0 ? params.capacity : _defaultCapacity;
        this._renderer = renderer;
        this._capacity = capacity;
        this._parentLOD = LOD;
        this._geometry = geometry;
        this.material = material;
        this._allowsEuler = allowsEuler ?? false;
        this._tempInstance = new InstancedEntity(this, -1, allowsEuler);
        this.availabilityArray = LOD?.availabilityArray ?? new Array(capacity * 2);
        this._createEntities = createEntities;

        this.initLastRenderInfo();
        this.initIndexAttribute();
        this.initMatricesTexture();
    }

    public override onBeforeShadow(renderer: WebGLRenderer, scene: Scene, camera: Camera, shadowCamera: Camera, geometry: BufferGeometry, depthMaterial: Material, group: any): void {
        this.patchMaterial(renderer, depthMaterial);
        this.updateTextures(renderer, depthMaterial);

        const frame = renderer.info.render.frame;
        if (this.instanceIndex && this.autoUpdate && !frustumCullingAlreadyPerformed.call(this, frame, camera, shadowCamera)) {
            performFrustumCulling.call(this, shadowCamera, camera);
        }

        if (this.count === 0) return;

        this.instanceIndex.update(this._renderer, this.count);
        this.bindTextures(renderer, depthMaterial);
    }

    public override onBeforeRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, material: Material, group: any): void {
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

        if (this.count === 0) return;

        this.instanceIndex.update(this._renderer, this.count);
        this.bindTextures(renderer, material);
    }

    public override onAfterShadow(renderer: WebGLRenderer, scene: Scene, camera: Camera, shadowCamera: Camera, geometry: BufferGeometry, depthMaterial: Material, group: any): void {
        this.unpatchMaterial(renderer, depthMaterial);
    }

    public override onAfterRender(renderer: WebGLRenderer, scene: Scene, camera: Camera, geometry: BufferGeometry, material: Material, group: any): void {
        this.unpatchMaterial(renderer, material);
        if (this.instanceIndex || (group && !this.isLastGroup(group.materialIndex))) return;
        this.initIndexAttribute();
    }

    // ─── Instance Management ──────────────────────────────────────────

    /** Adds new instances. Optionally initializes them via callback. */
    public addInstances(count: number, onCreation?: UpdateEntityCallback<Entity<TData>>): this {
        return addInstances.call(this, count, onCreation);
    }

    /** Removes instances by their ids. */
    public removeInstances(...ids: number[]): this {
        return removeInstances.call(this, ...ids);
    }

    /** Clears all instances and resets count. */
    public clearInstances(): this {
        return clearInstances.call(this);
    }

    /** Updates instances by applying a callback to each. Calls `updateMatrix` for each. */
    public updateInstances(onUpdate: UpdateEntityCallback<Entity<TData>>): this {
        return updateInstances.call(this, onUpdate);
    }

    /** Updates instances position only. Calls `updateMatrixPosition` for each. */
    public updateInstancesPosition(onUpdate: UpdateEntityCallback<Entity<TData>>): this {
        return updateInstancesPosition.call(this, onUpdate);
    }

    /** Resizes internal buffers to accommodate the specified capacity. */
    public resizeBuffers(capacity: number): this {
        return resizeBuffers.call(this, capacity);
    }

    // ─── BVH ──────────────────────────────────────────────────────────

    /** Creates and computes the BVH. Recommended after all matrices are assigned. */
    public computeBVH(config: BVHParams = {}): void {
        if (!this.bvh) this.bvh = new InstancedMeshBVH(this, config.margin, config.getBBoxFromBSphere, config.accurateCulling);
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
        matrix.toArray(this.matricesTexture._data, id * 16);

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
    public getMatrixAt(id: number, matrix = _tempMat4): Matrix4 {
        return matrix.fromArray(this.matricesTexture._data, id * 16);
    }

    /** Retrieves the position of a specific instance. */
    public getPositionAt(index: number, target = _position): Vector3 {
        const offset = index * 16;
        const array = this.matricesTexture._data;
        target.x = array[offset + 12];
        target.y = array[offset + 13];
        target.z = array[offset + 14];
        return target;
    }

    /** @internal */
    public getPositionAndMaxScaleOnAxisAt(index: number, position: Vector3): number {
        const offset = index * 16;
        const array = this.matricesTexture._data;

        const te0 = array[offset + 0], te1 = array[offset + 1], te2 = array[offset + 2];
        const scaleXSq = te0 * te0 + te1 * te1 + te2 * te2;

        const te4 = array[offset + 4], te5 = array[offset + 5], te6 = array[offset + 6];
        const scaleYSq = te4 * te4 + te5 * te5 + te6 * te6;

        const te8 = array[offset + 8], te9 = array[offset + 9], te10 = array[offset + 10];
        const scaleZSq = te8 * te8 + te9 * te9 + te10 * te10;

        position.x = array[offset + 12];
        position.y = array[offset + 13];
        position.z = array[offset + 14];

        return Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
    }

    /** @internal */
    public applyMatrixAtToSphere(index: number, sphere: Sphere, center: Vector3, radius: number): void {
        const offset = index * 16;
        const array = this.matricesTexture._data;

        const te0 = array[offset + 0], te1 = array[offset + 1], te2 = array[offset + 2], te3 = array[offset + 3];
        const te4 = array[offset + 4], te5 = array[offset + 5], te6 = array[offset + 6], te7 = array[offset + 7];
        const te8 = array[offset + 8], te9 = array[offset + 9], te10 = array[offset + 10], te11 = array[offset + 11];
        const te12 = array[offset + 12], te13 = array[offset + 13], te14 = array[offset + 14], te15 = array[offset + 15];

        const position = sphere.center;
        const x = center.x, y = center.y, z = center.z;
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
        if (this.colorsTexture === null) this.initColorsTexture();

        if ((color as Color).isColor) {
            (color as Color).toArray(this.colorsTexture._data, id * 4);
        } else {
            _tempCol.set(color).toArray(this.colorsTexture._data, id * 4);
        }

        this.colorsTexture.enqueueUpdate(id);
    }

    public getColorAt(id: number, color = _tempCol): Color {
        return color.fromArray(this.colorsTexture._data, id * 4);
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

        this.colorsTexture._data[id * 4 + 3] = value;
        this.colorsTexture.enqueueUpdate(id);
    }

    public getOpacityAt(id: number): number {
        if (!this._useOpacity) return 1;
        return this.colorsTexture._data[id * 4 + 3];
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
        if (geometry.boundingBox === null) geometry.computeBoundingBox();

        const geoBoundingBox = geometry.boundingBox;
        const boundingBox = this.boundingBox;
        boundingBox.makeEmpty();

        for (let i = 0; i < count; i++) {
            if (!this.getActiveAt(i)) continue;
            _box3.copy(geoBoundingBox).applyMatrix4(this.getMatrixAt(i));
            boundingBox.union(_box3);
        }
    }

    public computeBoundingSphere(): void {
        const geometry = this._geometry;
        const count = this._instancesArrayCount;

        this.boundingSphere ??= new Sphere();
        if (geometry.boundingSphere === null) geometry.computeBoundingSphere();

        const geoBoundingSphere = geometry.boundingSphere;
        const boundingSphere = this.boundingSphere;
        boundingSphere.makeEmpty();

        for (let i = 0; i < count; i++) {
            if (!this.getActiveAt(i)) continue;
            _sphere.copy(geoBoundingSphere).applyMatrix4(this.getMatrixAt(i));
            boundingSphere.union(_sphere);
        }
    }

    // ─── LOD ──────────────────────────────────────────────────────────

    public setFirstLODDistance(distance: number): this { return setFirstLODDistance.call(this, distance); }
    public addLOD(geometry: BufferGeometry, material: Material | Material[], distance?: number, hysteresis?: number): this { return addLOD.call(this, geometry, material, distance, hysteresis); }
    public addShadowLOD(geometry: BufferGeometry, distance?: number, hysteresis?: number): this { return addShadowLOD.call(this, geometry, distance, hysteresis); }
    public updateLOD(levelIndex: number, distance?: number, hysteresis?: number): this { return updateLOD.call(this, levelIndex, distance, hysteresis); }
    public updateShadowLOD(levelIndex: number, distance?: number, hysteresis?: number): this { return updateShadowLOD.call(this, levelIndex, distance, hysteresis); }
    public updateAllLOD(distances?: number[], hysteresis?: number | number[]): this { return updateAllLOD.call(this, distances, hysteresis); }
    public updateAllShadowLOD(distances?: number[], hysteresis?: number | number[]): this { return updateAllShadowLOD.call(this, distances, hysteresis); }
    public removeLOD(levelIndex: number, removeObject?: boolean): this { return removeLOD.call(this, levelIndex, removeObject); }

    // ─── Skeleton ─────────────────────────────────────────────────────

    public initSkeleton(skeleton: Skeleton, disableMatrixAutoUpdate?: boolean): void { initSkeleton.call(this, skeleton, disableMatrixAutoUpdate); }
    public setBonesAt(id: number, updateBonesMatrices?: boolean, excludeBonesSet?: Set<string>): void { setBonesAt.call(this, id, updateBonesMatrices, excludeBonesSet); }

    // ─── Uniforms ─────────────────────────────────────────────────────

    public initUniformsPerInstance(schema: any): void { initUniformsPerInstance.call(this, schema); }
    public getUniformAt(id: number, name: string, target?: UniformValueObj): UniformValue { return getUniformAt.call(this, id, name, target); }
    public setUniformAt(id: number, name: string, value: UniformValue): void { setUniformAt.call(this, id, name, value); }

    // ─── Morph ────────────────────────────────────────────────────────

    public getMorphAt(id: number, object?: any): any { return getMorphAt.call(this, id, object); }
    public setMorphAt(id: number, object: any): void { setMorphAt.call(this, id, object); }

    // ─── Raycasting ───────────────────────────────────────────────────

    public override raycast(raycaster: any, result: any[]): void { raycast.call(this, raycaster, result); }

    // ─── Frustum Culling (public) ─────────────────────────────────────

    public performFrustumCulling(camera: Camera, cameraLOD = camera): void {
        performFrustumCulling.call(this, camera, cameraLOD);
    }

    // ─── Clone / Copy ─────────────────────────────────────────────────

    public override clone(recursive?: boolean): this {
        const params: InstancedMesh2Params = {
            capacity: this._capacity,
            renderer: this._renderer,
            allowsEuler: this._allowsEuler,
            createEntities: this._createEntities
        };
        return new (this as any).constructor(this.geometry, this.material, params).copy(this, recursive);
    }

    public override copy(source: InstancedMesh2, recursive?: boolean): this {
        super.copy(source, recursive);

        this.count = source._capacity;
        this._instancesCount = source._instancesCount;
        this._instancesArrayCount = source._instancesArrayCount;
        this._capacity = source._capacity;

        if (source.boundingBox !== null) this.boundingBox = source.boundingBox.clone();
        if (source.boundingSphere !== null) this.boundingSphere = source.boundingSphere.clone();

        this.matricesTexture = source.matricesTexture.clone();
        this.matricesTexture.image.data = (this.matricesTexture.image.data as TypedArray).slice();

        if (source.colorsTexture !== null) {
            this.colorsTexture = source.colorsTexture.clone();
            this.colorsTexture.image.data = (this.colorsTexture.image.data as TypedArray).slice();
        }

        if (source.uniformsTexture !== null) {
            this.uniformsTexture = source.uniformsTexture.clone();
            this.uniformsTexture.image.data = (this.uniformsTexture.image.data as TypedArray).slice();
        }

        if (source.morphTexture !== null) {
            this.morphTexture = source.morphTexture.clone();
            this.morphTexture.image.data = (this.morphTexture.image.data as TypedArray).slice();
        }

        if (source.boneTexture !== null) {
            this.boneTexture = source.boneTexture.clone();
            this.boneTexture.image.data = (this.boneTexture.image.data as TypedArray).slice();
        }

        return this;
    }

    // ─── Dispose ──────────────────────────────────────────────────────

    public dispose(): void {
        this.dispatchEvent<any>({ type: 'dispose' });

        this.matricesTexture.dispose();
        this.colorsTexture?.dispose();
        this.morphTexture?.dispose();
        this.boneTexture?.dispose();
        this.uniformsTexture?.dispose();
    }

    public override updateMatrixWorld(force?: boolean): void {
        super.updateMatrixWorld(force);

        if (!this.bindMatrixInverse) return;

        if (this.bindMode === AttachedBindMode) {
            this.bindMatrixInverse.copy(this.matrixWorld).invert();
        } else if (this.bindMode === DetachedBindMode) {
            this.bindMatrixInverse.copy(this.bindMatrix).invert();
        } else {
            console.warn('Unrecognized bindMode: ' + this.bindMode);
        }
    }

    // ─── Protected Internals ──────────────────────────────────────────

    protected updateTextures(renderer: WebGLRenderer, material: Material): void {
        const materialProperties = renderer.properties.get(material) as any;

        this.matricesTexture.update(renderer, materialProperties, 'matricesTexture');
        this.colorsTexture?.update(renderer, materialProperties, 'colorsTexture');
        this.uniformsTexture?.update(renderer, materialProperties, 'uniformsTexture');
        this.boneTexture?.update(renderer, materialProperties, 'boneTexture');
    }

    protected bindTextures(renderer: WebGLRenderer, material: Material): void {
        const materialProperties = renderer.properties.get(material) as any;
        const materialUniforms = materialProperties.uniforms;
        if (!materialUniforms) return;

        const currentProgramProperties = materialProperties.currentProgram;
        const currentProgram = currentProgramProperties?.program;
        if (!currentProgram) return;

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
            if (materials[i].visible) return i === materialIndex;
        }
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

        this.instanceIndex = new GLInstancedBufferAttribute(gl, gl.UNSIGNED_INT, 1, 4, array);
        this._geometry.setAttribute('instanceIndex', this.instanceIndex as unknown as BufferAttribute);
    }

    protected initLastRenderInfo(): void {
        if (!this._parentLOD) {
            this._lastRenderInfo = { frame: -1, camera: null, shadowCamera: null };
        }
    }

    protected initMatricesTexture(): void {
        if (!this._parentLOD) {
            this.matricesTexture = new SquareDataTexture(Float32Array, 4, 4, this._capacity);
        }
    }

    protected initColorsTexture(): void {
        if (!this._parentLOD) {
            this.colorsTexture = new SquareDataTexture(Float32Array, 4, 1, this._capacity);
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
        const instanceIndex = geometry.getAttribute('instanceIndex') as unknown as GLInstancedBufferAttribute;

        if (instanceIndex) {
            if (instanceIndex === this.instanceIndex) return;

            console.warn('The geometry has been cloned because it was already used.');
            geometry = geometry.clone();
            geometry.deleteAttribute('instanceIndex');
        }

        if (this.instanceIndex) {
            geometry.setAttribute('instanceIndex', this.instanceIndex as unknown as BufferAttribute);
        }
    }

    protected _customProgramCacheKey = (): string => {
        return `ez_${!!this.colorsTexture}_${this._useOpacity}_${!!this.boneTexture}_${!!this.uniformsTexture}_${this._customProgramCacheKeyBase.call(this._currentMaterial)}`;
    };

    protected _onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer): void => {
        if (this._onBeforeCompileBase) this._onBeforeCompileBase.call(this._currentMaterial, shader, renderer);

        shader.defines = { ...shader.defines };
        shader.defines['USE_INSTANCING_INDIRECT'] = '';

        shader.uniforms.matricesTexture = { value: this.matricesTexture };

        if (this.uniformsTexture) {
            shader.uniforms.uniformsTexture = { value: this.uniformsTexture };
            const { vertex, fragment } = this.uniformsTexture.getUniformsGLSL('uniformsTexture', 'instanceIndex', 'uint');
            shader.vertexShader = shader.vertexShader.replace('void main() {', vertex);
            shader.fragmentShader = shader.fragmentShader.replace('void main() {', fragment);
        }

        if (this.colorsTexture && shader.fragmentShader.includes('#include <color_pars_fragment>')) {
            shader.defines['USE_INSTANCING_COLOR_INDIRECT'] = '';
            shader.uniforms.colorsTexture = { value: this.colorsTexture };
            shader.vertexShader = shader.vertexShader.replace('<color_vertex>', '<instanced_color_vertex>');

            if (shader.vertexColors) {
                shader.defines['USE_VERTEX_COLOR'] = '';
            }

            shader.defines['USE_COLOR_ALPHA'] = '';
        }

        if (this.boneTexture) {
            shader.defines['USE_SKINNING'] = '';
            shader.defines['USE_INSTANCING_SKINNING'] = '';
            shader.uniforms.bindMatrix = { value: this.bindMatrix };
            shader.uniforms.bindMatrixInverse = { value: this.bindMatrixInverse };
            shader.uniforms.bonesPerInstance = { value: this.skeleton.bones.length };
            shader.uniforms.boneTexture = { value: this.boneTexture };
        }
    };

    protected patchMaterial(renderer: WebGLRenderer, material: Material): void {
        this._currentMaterial = material;
        this._customProgramCacheKeyBase = material.customProgramCacheKey;
        this._onBeforeCompileBase = material.onBeforeCompile;
        this._definesBase = material.defines;
        material.customProgramCacheKey = this._customProgramCacheKey;
        material.onBeforeCompile = this._onBeforeCompile;
        patchProperties(this, renderer, material);
    }

    protected unpatchMaterial(renderer: WebGLRenderer, material: Material): void {
        this._currentMaterial = null;
        unpatchProperties(renderer);
        material.defines = this._definesBase;
        material.onBeforeCompile = this._onBeforeCompileBase;
        material.customProgramCacheKey = this._customProgramCacheKeyBase;
        this._onBeforeCompileBase = null;
        this._customProgramCacheKeyBase = null;
        this._definesBase = null;
    }
}

const _defaultCapacity = 1000;
const _box3 = new Box3();
const _sphere = new Sphere();
const _tempMat4 = new Matrix4();
const _tempCol = new Color();
const _position = new Vector3();

/** @internal Extend Material.defines type */
declare module 'three' {
    interface Material {
        defines: { [key: string]: any };
    }
}
