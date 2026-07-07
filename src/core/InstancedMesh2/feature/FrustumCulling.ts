// @ts-nocheck
/**
 * @internal Frustum culling feature module.
 * Adds per-instance frustum culling, sorting, and LOD-aware culling to InstancedMesh2.
 */

import type { BVHNode } from '../bvh/BVHNode';
import { Camera, Frustum, Material, Matrix4, Sphere, Vector3 } from 'three';
import type { InstancedMesh2 } from '../InstancedMesh2';
import { InstancedRenderList } from '../utils/InstancedRenderList';
import type { InstancedRenderItem } from '../utils/InstancedRenderList';
import type { LODRenderList } from './LOD';

/** Custom sorting callback for render items. */
export type CustomSortCallback = (list: InstancedRenderItem[]) => void;

/** Callback invoked when an instance is within the frustum. */
export type OnFrustumEnterCallback = (index: number, camera: Camera, cameraLOD?: Camera, LODindex?: number) => boolean;

const _frustum = new Frustum();
const _renderList = new InstancedRenderList();
const _projScreenMatrix = new Matrix4();
const _invMatrixWorld = new Matrix4();
const _forward = new Vector3();
const _cameraPos = new Vector3();
const _cameraLODPos = new Vector3();
const _position = new Vector3();
const _sphere = new Sphere();

export function performFrustumCulling(this: InstancedMesh2, camera: Camera, cameraLOD = camera): void {
    const mainMesh = this._parentLOD ?? this;
    const LODinfo = mainMesh.LODinfo;
    let LODrenderList: LODRenderList;

    if (LODinfo) {
        const isShadowRendering = camera !== cameraLOD;
        LODrenderList = !isShadowRendering ? LODinfo.render : (LODinfo.shadowRender ?? LODinfo.render);

        for (const object of LODinfo.objects) {
            object.count = 0;
        }
    } else if (mainMesh._perObjectFrustumCulled || mainMesh._sortObjects) {
        mainMesh.count = 0;
    }

    if (mainMesh._instancesArrayCount === 0) return;

    if (LODrenderList?.levels.length > 0) frustumCullingLOD.call(mainMesh, LODrenderList, camera, cameraLOD);
    else frustumCulling.call(mainMesh, camera);
}

export function frustumCullingAlreadyPerformed(this: InstancedMesh2, frame: number, camera: Camera, shadowCamera: Camera | null): boolean {
    const lastRenderInfo = this._lastRenderInfo;
    if (lastRenderInfo.frame === frame && lastRenderInfo.camera === camera && lastRenderInfo.shadowCamera === shadowCamera) {
        return true;
    }

    lastRenderInfo.frame = frame;
    lastRenderInfo.camera = camera;
    lastRenderInfo.shadowCamera = shadowCamera;
    return false;
}

export function frustumCulling(this: InstancedMesh2, camera: Camera): void {
    const sortObjects = this._sortObjects;
    const perObjectFrustumCulled = this._perObjectFrustumCulled;
    const array = this.instanceIndex.array;

    this.instanceIndex._needsUpdate = true;

    if (!perObjectFrustumCulled && !sortObjects) {
        updateIndexArray.call(this);
        return;
    }

    if (sortObjects) {
        _invMatrixWorld.copy(this.matrixWorld).invert();
        _cameraPos.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_invMatrixWorld);
        _forward.set(0, 0, -1).transformDirection(camera.matrixWorld).transformDirection(_invMatrixWorld);
    }

    if (!perObjectFrustumCulled) {
        updateRenderList.call(this);
    } else {
        _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld);

        if (this.bvh) BVHCulling.call(this, camera);
        else linearCulling.call(this, camera);
    }

    if (sortObjects) {
        const customSort = this.customSort;

        if (customSort === null) {
            _renderList.array.sort(!(this.material as Material)?.transparent ? sortOpaque : sortTransparent);
        } else {
            customSort(_renderList.array);
        }

        const list = _renderList.array;
        const count = list.length;
        for (let i = 0; i < count; i++) {
            array[i] = list[i].index;
        }

        this.count = count;
        _renderList.reset();
    }
}

export function updateIndexArray(this: InstancedMesh2): void {
    if (!this._indexArrayNeedsUpdate) return;

    const array = this.instanceIndex.array;
    const instancesArrayCount = this._instancesArrayCount;
    let count = 0;

    for (let i = 0; i < instancesArrayCount; i++) {
        if (this.getActiveAndVisibilityAt(i)) {
            array[count++] = i;
        }
    }

    this.count = count;
    this._indexArrayNeedsUpdate = false;
}

function updateRenderList(this: InstancedMesh2): void {
    const instancesArrayCount = this._instancesArrayCount;

    for (let i = 0; i < instancesArrayCount; i++) {
        if (this.getActiveAndVisibilityAt(i)) {
            const depth = this.getPositionAt(i).sub(_cameraPos).dot(_forward);
            _renderList.push(depth, i);
        }
    }
}

function BVHCulling(this: InstancedMesh2, camera: Camera): void {
    const array = this.instanceIndex.array;
    const instancesArrayCount = this._instancesArrayCount;
    const sortObjects = this._sortObjects;
    const onFrustumEnter = this.onFrustumEnter;
    let count = 0;

    this.bvh.frustumCulling(_projScreenMatrix, (node: BVHNode<{}, number>) => {
        const index = node.object;

        if (index < instancesArrayCount && this.getVisibilityAt(index) && (!onFrustumEnter || onFrustumEnter(index, camera))) {
            if (sortObjects) {
                const depth = this.getPositionAt(index).sub(_cameraPos).dot(_forward);
                _renderList.push(depth, index);
            } else {
                array[count++] = index;
            }
        }
    });

    this.count = count;
}

function linearCulling(this: InstancedMesh2, camera: Camera): void {
    const array = this.instanceIndex.array;
    if (!this.geometry.boundingSphere) this.geometry.computeBoundingSphere();
    const bSphere = this._geometry.boundingSphere;
    const radius = bSphere.radius;
    const center = bSphere.center;
    const instancesArrayCount = this._instancesArrayCount;
    const geometryCentered = center.x === 0 && center.y === 0 && center.z === 0;
    const sortObjects = this._sortObjects;
    const onFrustumEnter = this.onFrustumEnter;
    let count = 0;

    _frustum.setFromProjectionMatrix(_projScreenMatrix);

    for (let i = 0; i < instancesArrayCount; i++) {
        if (!this.getActiveAndVisibilityAt(i)) continue;

        if (geometryCentered) {
            const maxScale = this.getPositionAndMaxScaleOnAxisAt(i, _sphere.center);
            _sphere.radius = radius * maxScale;
        } else {
            this.applyMatrixAtToSphere(i, _sphere, center, radius);
        }

        if (_frustum.intersectsSphere(_sphere) && (!onFrustumEnter || onFrustumEnter(i, camera))) {
            if (sortObjects) {
                const depth = _position.subVectors(_sphere.center, _cameraPos).dot(_forward);
                _renderList.push(depth, i);
            } else {
                array[count++] = i;
            }
        }
    }

    this.count = count;
}

export function frustumCullingLOD(this: InstancedMesh2, LODrenderList: LODRenderList, camera: Camera, cameraLOD: Camera): void {
    const { count, levels } = LODrenderList;

    for (let i = 0; i < levels.length; i++) {
        if (!levels[i].object.instanceIndex) return;
        count[i] = 0;
        levels[i].object.instanceIndex._needsUpdate = true;
    }

    const isShadowRendering = camera !== cameraLOD;
    const sortObjects = !isShadowRendering && this._sortObjects;

    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld);
    _invMatrixWorld.copy(this.matrixWorld).invert();
    _cameraPos.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_invMatrixWorld);
    _cameraLODPos.setFromMatrixPosition(cameraLOD.matrixWorld).applyMatrix4(_invMatrixWorld);

    const indexes = LODrenderList.levels.map((x) => x.object.instanceIndex.array) as Uint32Array[];

    if (this.bvh) BVHCullingLOD.call(this, LODrenderList, indexes, sortObjects, camera, cameraLOD);
    else linearCullingLOD.call(this, LODrenderList, indexes, sortObjects, camera, cameraLOD);

    if (sortObjects) {
        const customSort = this.customSort;
        const list = _renderList.array;
        let levelIndex = 0;
        let levelDistance = levels[1].distance;

        if (customSort === null) {
            list.sort(!(levels[0].object.material as Material)?.transparent ? sortOpaque : sortTransparent);
        } else {
            customSort(list);
        }

        for (let i = 0, l = list.length; i < l; i++) {
            const item = list[i];

            if (item.depth > levelDistance) {
                levelIndex++;
                levelDistance = levels[levelIndex + 1]?.distance ?? Infinity;
            }

            indexes[levelIndex][count[levelIndex]++] = item.index;
        }

        _renderList.reset();
    }

    for (let i = 0; i < levels.length; i++) {
        const object = levels[i].object;
        object.count = count[i];
    }
}

function BVHCullingLOD(this: InstancedMesh2, LODrenderList: LODRenderList, indexes: Uint32Array[], sortObjects: boolean, camera: Camera, cameraLOD: Camera): void {
    const { count, levels } = LODrenderList;
    const instancesArrayCount = this._instancesArrayCount;
    const onFrustumEnter = this.onFrustumEnter;

    if (sortObjects) {
        this.bvh.frustumCulling(_projScreenMatrix, (node: BVHNode<{}, number>) => {
            const index = node.object;
            if (index < instancesArrayCount && this.getVisibilityAt(index) && (!onFrustumEnter || onFrustumEnter(index, camera, cameraLOD))) {
                const distance = this.getPositionAt(index).distanceToSquared(_cameraLODPos);
                _renderList.push(distance, index);
            }
        });
    } else {
        this.bvh.frustumCullingLOD(_projScreenMatrix, _cameraLODPos, levels, (node: BVHNode<{}, number>, level: number) => {
            const index = node.object;
            if (index < instancesArrayCount && this.getVisibilityAt(index)) {
                if (level === null) {
                    const distance = this.getPositionAt(index).distanceToSquared(_cameraLODPos);
                    level = getObjectLODIndexForDistance(levels, distance);
                }

                if (!onFrustumEnter || onFrustumEnter(index, camera, cameraLOD, level)) {
                    indexes[level][count[level]++] = index;
                }
            }
        });
    }
}

function linearCullingLOD(this: InstancedMesh2, LODrenderList: LODRenderList, indexes: Uint32Array[], sortObjects: boolean, camera: Camera, cameraLOD: Camera): void {
    const { count, levels } = LODrenderList;
    if (!this.geometry.boundingSphere) this.geometry.computeBoundingSphere();
    const bSphere = this._geometry.boundingSphere;
    const radius = bSphere.radius;
    const center = bSphere.center;
    const instancesArrayCount = this._instancesArrayCount;
    const geometryCentered = center.x === 0 && center.y === 0 && center.z === 0;
    const onFrustumEnter = this.onFrustumEnter;

    _frustum.setFromProjectionMatrix(_projScreenMatrix);

    for (let i = 0; i < instancesArrayCount; i++) {
        if (!this.getActiveAndVisibilityAt(i)) continue;

        if (geometryCentered) {
            const maxScale = this.getPositionAndMaxScaleOnAxisAt(i, _sphere.center);
            _sphere.radius = radius * maxScale;
        } else {
            this.applyMatrixAtToSphere(i, _sphere, center, radius);
        }

        if (_frustum.intersectsSphere(_sphere)) {
            if (sortObjects) {
                if (!onFrustumEnter || onFrustumEnter(i, camera, cameraLOD)) {
                    const distance = _sphere.center.distanceToSquared(_cameraLODPos);
                    _renderList.push(distance, i);
                }
            } else {
                const distance = _sphere.center.distanceToSquared(_cameraLODPos);
                const levelIndex = getObjectLODIndexForDistance(levels, distance);

                if (!onFrustumEnter || onFrustumEnter(i, camera, cameraLOD, levelIndex)) {
                    indexes[levelIndex][count[levelIndex]++] = i;
                }
            }
        }
    }
}

/** Sort opaque instances front-to-back. */
export function sortOpaque(a: InstancedRenderItem, b: InstancedRenderItem): number {
    return a.depth - b.depth;
}

/** Sort transparent instances back-to-front. */
export function sortTransparent(a: InstancedRenderItem, b: InstancedRenderItem): number {
    return b.depth - a.depth;
}

/** Get LOD index for a given squared distance. */
export function getObjectLODIndexForDistance(levels: LODLevel[], distance: number): number {
    for (let i = levels.length - 1; i > 0; i--) {
        const level = levels[i];
        const levelDistance = level.distance - (level.distance * level.hysteresis);
        if (distance >= levelDistance) return i;
    }
    return 0;
}

// Re-export LODLevel type for convenience
export type { LODLevel, LODRenderList } from './LOD';
