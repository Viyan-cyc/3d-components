/**
 * @internal Frustum culling feature module.
 * Adds per-instance frustum culling, sorting, and LOD-aware culling to InstancedMesh2.
 */

import {
  type BufferGeometry, type Camera, Frustum, type Material, Matrix4, type Object3DEventMap, Sphere, Vector3,
} from 'three';
import { type InstancedRenderItem, InstancedRenderList } from '../utils/InstancedRenderList';
import type { LODLevel, LODRenderList } from './LOD';
import type { BVHNode } from '../bvh/BVHNode';
import type { InstancedMesh2 } from '../InstancedMesh2';

/** Custom sorting callback for render items. */
export type CustomSortCallback = (list: InstancedRenderItem[]) => void;

/** Callback invoked when an instance is within the frustum. */
export type OnFrustumEnterCallback = (
  index: number,
  camera: Camera,
  cameraLOD?: Camera,
  lodIndex?: number,
) => boolean;

const frustumLocal = new Frustum();
const renderListLocal = new InstancedRenderList();
const projScreenMatrixLocal = new Matrix4();
const invMatrixWorldLocal = new Matrix4();
const forwardLocal = new Vector3();
const cameraPosLocal = new Vector3();
const cameraLODPosLocal = new Vector3();
const positionLocal = new Vector3();
const sphereLocal = new Sphere();

/** Sort opaque instances front-to-back. */
export const sortOpaque = (a: InstancedRenderItem, b: InstancedRenderItem): number => a.depth - b.depth;

/** Sort transparent instances back-to-front. */
export const sortTransparent = (a: InstancedRenderItem, b: InstancedRenderItem): number => b.depth - a.depth;

/** Get LOD index for a given squared distance. */
export const getObjectLODIndexForDistance = (levels: LODLevel[], distance: number): number => {
  for (let i = levels.length - 1; i > 0; i--) {
    const level = levels[i];
    const levelDistance = level.distance - (level.distance * level.hysteresis);
    if (distance >= levelDistance) {
      return i;
    }
  }
  return 0;
};

export const updateIndexArray = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>): void {
  if (!this._indexArrayNeedsUpdate) {
    return;
  }

  const array = this.instanceIndex!.array;
  const instancesArrayCount = this._instancesArrayCount;
  let count = 0;

  for (let i = 0; i < instancesArrayCount; i++) {
    if (this.getActiveAndVisibilityAt(i)) {
      array[count++] = i;
    }
  }

  this.count = count;
  this._indexArrayNeedsUpdate = false;
};

const updateRenderList = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>): void {
  const instancesArrayCount = this._instancesArrayCount;

  for (let i = 0; i < instancesArrayCount; i++) {
    if (this.getActiveAndVisibilityAt(i)) {
      const depth = this.getPositionAt(i)
        .sub(cameraPosLocal)
        .dot(forwardLocal);
      renderListLocal.push(depth, i);
    }
  }
};

const bvhCulling = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, camera: Camera): void {
  const array = this.instanceIndex!.array;
  const instancesArrayCount = this._instancesArrayCount;
  const sortObjects = this._sortObjects;
  const onFrustumEnter = this.onFrustumEnter;
  let count = 0;

  this.bvh!.frustumCulling(
    projScreenMatrixLocal,
    (node: BVHNode<Record<string, never>, number>) => {
      const index = node.object;
      if (index === undefined) {
        return;
      }

      if (
        index < instancesArrayCount
        && this.getVisibilityAt(index)
        && (!onFrustumEnter || onFrustumEnter(index, camera))
      ) {
        if (sortObjects) {
          const depth = this.getPositionAt(index)
            .sub(cameraPosLocal)
            .dot(forwardLocal);
          renderListLocal.push(depth, index);
        } else {
          array[count++] = index;
        }
      }
    },
  );

  this.count = count;
};

const applySortToIndexArray = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, array: Uint32Array): void {
  const customSort = this.customSort;

  if (customSort === null) {
    const isTransparent = (this.material as Material)?.transparent;
    renderListLocal.array.sort(isTransparent ? sortTransparent : sortOpaque);
  } else {
    customSort(renderListLocal.array);
  }

  const list = renderListLocal.array;
  const count = list.length;
  for (let i = 0; i < count; i++) {
    array[i] = list[i].index;
  }

  this.count = count;
  renderListLocal.reset();
};

const linearCulling = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, camera: Camera): void {
  const array = this.instanceIndex!.array;
  if (!this.geometry.boundingSphere) {
    this.geometry.computeBoundingSphere();
  }
  const bSphere = this._geometry.boundingSphere!;
  const radius = bSphere.radius;
  const center = bSphere.center;
  const instancesArrayCount = this._instancesArrayCount;
  const geometryCentered = center.x === 0
    && center.y === 0
    && center.z === 0;
  const sortObjects = this._sortObjects;
  const onFrustumEnter = this.onFrustumEnter;
  let count = 0;

  frustumLocal.setFromProjectionMatrix(projScreenMatrixLocal);

  for (let i = 0; i < instancesArrayCount; i++) {
    if (!this.getActiveAndVisibilityAt(i)) {
      // eslint-disable-next-line no-continue
      continue;
    }

    if (geometryCentered) {
      const maxScale = this.getPositionAndMaxScaleOnAxisAt(i, sphereLocal.center);
      sphereLocal.radius = radius * maxScale;
    } else {
      this.applyMatrixAtToSphere(i, sphereLocal, center, radius);
    }

    if (
      frustumLocal.intersectsSphere(sphereLocal)
      && (!onFrustumEnter || onFrustumEnter(i, camera))
    ) {
      if (sortObjects) {
        const depth = positionLocal
          .subVectors(sphereLocal.center, cameraPosLocal)
          .dot(forwardLocal);
        renderListLocal.push(depth, i);
      } else {
        array[count++] = i;
      }
    }
  }

  this.count = count;
};

export const frustumCulling = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, camera: Camera): void {
  const sortObjects = this._sortObjects;
  const perObjectFrustumCulled = this._perObjectFrustumCulled;
  const array = this.instanceIndex!.array;

  this.instanceIndex!._needsUpdate = true;

  if (!perObjectFrustumCulled && !sortObjects) {
    updateIndexArray.call(this);
    return;
  }

  if (sortObjects) {
    invMatrixWorldLocal.copy(this.matrixWorld).invert();
    cameraPosLocal
      .setFromMatrixPosition(camera.matrixWorld)
      .applyMatrix4(invMatrixWorldLocal);
    forwardLocal
      .set(0, 0, -1)
      .transformDirection(camera.matrixWorld)
      .transformDirection(invMatrixWorldLocal);
  }

  if (perObjectFrustumCulled) {
    projScreenMatrixLocal
      .multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      )
      .multiply(this.matrixWorld);

    if (this.bvh) {
      bvhCulling.call(this, camera);
    } else {
      linearCulling.call(this, camera);
    }
  } else {
    updateRenderList.call(this);
  }

  if (sortObjects) {
    applySortToIndexArray.call(this, array as Uint32Array);
  }
};

interface LODIntersectionParams {
  instanceIndex: number;
  sortObjects: boolean;
  camera: Camera;
  cameraLOD: Camera;
  levels: LODLevel[];
  count: number[];
  indexes: Uint32Array[];
  onFrustumEnter: OnFrustumEnterCallback;
}

const processLODIntersection = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, params: LODIntersectionParams): void {
  const {
    instanceIndex, sortObjects, camera, cameraLOD,
    levels, count, indexes, onFrustumEnter,
  } = params;

  if (sortObjects) {
    if (!onFrustumEnter || onFrustumEnter(instanceIndex, camera, cameraLOD)) {
      const distance = sphereLocal.center
        .distanceToSquared(cameraLODPosLocal);
      renderListLocal.push(distance, instanceIndex);
    }
  } else {
    const distance = sphereLocal.center
      .distanceToSquared(cameraLODPosLocal);
    const levelIndex = getObjectLODIndexForDistance(levels, distance);

    if (!onFrustumEnter || onFrustumEnter(instanceIndex, camera, cameraLOD, levelIndex)) {
      indexes[levelIndex][count[levelIndex]++] = instanceIndex;
    }
  }
};

interface LODCullingParams {
  lodRenderList: LODRenderList;
  indexes: Uint32Array[];
  sortObjects: boolean;
  camera: Camera;
  cameraLOD: Camera;
}

const linearCullingLOD = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, params: LODCullingParams): void {
  const {
    lodRenderList, indexes, sortObjects, camera, cameraLOD,
  } = params;
  const { count, levels } = lodRenderList;
  if (!this.geometry.boundingSphere) {
    this.geometry.computeBoundingSphere();
  }
  const bSphere = this._geometry.boundingSphere!;
  const radius = bSphere.radius;
  const center = bSphere.center;
  const instancesArrayCount = this._instancesArrayCount;
  const geometryCentered = center.x === 0
    && center.y === 0
    && center.z === 0;
  const onFrustumEnter = this.onFrustumEnter;

  frustumLocal.setFromProjectionMatrix(projScreenMatrixLocal);

  for (let i = 0; i < instancesArrayCount; i++) {
    if (!this.getActiveAndVisibilityAt(i)) {
      // eslint-disable-next-line no-continue
      continue;
    }

    if (geometryCentered) {
      const maxScale = this.getPositionAndMaxScaleOnAxisAt(i, sphereLocal.center);
      sphereLocal.radius = radius * maxScale;
    } else {
      this.applyMatrixAtToSphere(i, sphereLocal, center, radius);
    }

    if (frustumLocal.intersectsSphere(sphereLocal)) {
      processLODIntersection.call(this, {
        instanceIndex: i,
        sortObjects,
        camera,
        cameraLOD,
        levels,
        count,
        indexes,
        onFrustumEnter: onFrustumEnter!,
      });
    }
  }
};

const handleBvhCullingLODSorted = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  instancesArrayCount: number,
  onFrustumEnter: OnFrustumEnterCallback,
  camera: Camera,
  cameraLOD: Camera,
): void {
  this.bvh!.frustumCulling(
    projScreenMatrixLocal,
    (node: BVHNode<Record<string, never>, number>) => {
      const index = node.object;
      if (index === undefined) {
        return;
      }
      if (
        index < instancesArrayCount
        && this.getVisibilityAt(index)
        && (!onFrustumEnter || onFrustumEnter(index, camera, cameraLOD))
      ) {
        const distance = this.getPositionAt(index)
          .distanceToSquared(cameraLODPosLocal);
        renderListLocal.push(distance, index);
      }
    },
  );
};

interface BvhCullingLODCallbackCtx {
  instancesArrayCount: number;
  onFrustumEnter: OnFrustumEnterCallback;
  camera: Camera;
  cameraLOD: Camera;
  levels: LODLevel[];
  count: number[];
  indexes: Uint32Array[];
}

const handleBvhCullingLODUnsorted = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  ctx: BvhCullingLODCallbackCtx,
): void {
  const {
    instancesArrayCount, onFrustumEnter, camera, cameraLOD, levels, count, indexes,
  } = ctx;
  this.bvh!.frustumCullingLOD(
    projScreenMatrixLocal,
    cameraLODPosLocal,
    levels,
    (
      node: BVHNode<Record<string, never>, number>,
      level: number,
    ) => {
      const index = node.object;
      if (index === undefined) {
        return;
      }
      if (
        index < instancesArrayCount
        && this.getVisibilityAt(index)
      ) {
        let resolvedLevel = level;
        if (level === null) {
          const distance = this.getPositionAt(index)
            .distanceToSquared(cameraLODPosLocal);
          resolvedLevel = getObjectLODIndexForDistance(levels, distance);
        }

        if (!onFrustumEnter || onFrustumEnter(index, camera, cameraLOD, resolvedLevel)) {
          indexes[resolvedLevel][count[resolvedLevel]++] = index;
        }
      }
    },
  );
};

const bvhCullingLOD = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, params: LODCullingParams): void {
  const {
    lodRenderList, indexes, sortObjects, camera, cameraLOD,
  } = params;
  const { count, levels } = lodRenderList;
  const instancesArrayCount = this._instancesArrayCount;
  const onFrustumEnter = this.onFrustumEnter;

  if (sortObjects) {
    handleBvhCullingLODSorted.call(this, instancesArrayCount, onFrustumEnter!, camera, cameraLOD);
  } else {
    handleBvhCullingLODUnsorted.call(this, {
      instancesArrayCount, onFrustumEnter: onFrustumEnter!, camera, cameraLOD, levels, count, indexes,
    });
  }
};

const applyLODSortToIndexes = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  levels: LODLevel[],
  count: number[],
  indexes: Uint32Array[],
): void {
  const customSort = this.customSort;
  const list = renderListLocal.array;
  let levelIndex = 0;
  let levelDistance = levels[1].distance;

  if (customSort === null) {
    const isTransparent = (levels[0].object.material as Material)?.transparent;
    list.sort(isTransparent ? sortTransparent : sortOpaque);
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

  renderListLocal.reset();
};

const setupCullingMatrices = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, camera: Camera, cameraLOD: Camera): void {
  projScreenMatrixLocal
    .multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    )
    .multiply(this.matrixWorld);
  invMatrixWorldLocal.copy(this.matrixWorld).invert();
  cameraPosLocal
    .setFromMatrixPosition(camera.matrixWorld)
    .applyMatrix4(invMatrixWorldLocal);
  cameraLODPosLocal
    .setFromMatrixPosition(cameraLOD.matrixWorld)
    .applyMatrix4(invMatrixWorldLocal);
};

const resetLODLevels = function (levels: LODLevel[], count: number[]): boolean {
  for (let i = 0; i < levels.length; i++) {
    if (!levels[i].object.instanceIndex) {
      return false;
    }
    count[i] = 0;
    levels[i].object.instanceIndex!._needsUpdate = true;
  }
  return true;
};

const applyLODCounts = function (levels: LODLevel[], count: number[]): void {
  for (let i = 0; i < levels.length; i++) {
    levels[i].object.count = count[i];
  }
};

export const frustumCullingLOD = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  lodRenderList: LODRenderList,
  camera: Camera,
  cameraLOD: Camera,
): void {
  const { count, levels } = lodRenderList;

  if (!resetLODLevels(levels, count)) {
    return;
  }

  const isShadowRendering = camera !== cameraLOD;
  const sortObjects = !isShadowRendering && this._sortObjects;

  setupCullingMatrices.call(this, camera, cameraLOD);

  const indexes = lodRenderList.levels.map((x) => x.object.instanceIndex!.array) as Uint32Array[];
  const cullingParams: LODCullingParams = {
    lodRenderList, indexes, sortObjects, camera, cameraLOD,
  };

  if (this.bvh) {
    bvhCullingLOD.call(this, cullingParams);
  } else {
    linearCullingLOD.call(this, cullingParams);
  }

  if (sortObjects) {
    applyLODSortToIndexes.call(this, levels, count, indexes);
  }

  applyLODCounts(levels, count);
};

export const performFrustumCulling = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, camera: Camera, cameraLOD = camera): void {
  const mainMesh = this._parentLOD ?? this;
  const lodInfo = mainMesh.LODinfo;
  let lodRenderList: LODRenderList | null | undefined;

  if (lodInfo) {
    const isShadowRendering = camera !== cameraLOD;
    if (isShadowRendering) {
      lodRenderList = lodInfo.shadowRender ?? lodInfo.render;
    } else {
      lodRenderList = lodInfo.render;
    }

    for (const object of lodInfo.objects) {
      object.count = 0;
    }
  } else if (mainMesh._perObjectFrustumCulled || mainMesh._sortObjects) {
    mainMesh.count = 0;
  }

  if (mainMesh._instancesArrayCount === 0) {
    return;
  }

  if (lodRenderList && lodRenderList.levels.length > 0) {
    frustumCullingLOD.call(
      mainMesh as InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
      lodRenderList,
      camera,
      cameraLOD,
    );
  } else {
    frustumCulling.call(mainMesh as InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, camera);
  }
};

export const frustumCullingAlreadyPerformed = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  frame: number,
  camera: Camera,
  shadowCamera: Camera | null,
): boolean {
  const lastRenderInfo = this._lastRenderInfo;
  if (
    lastRenderInfo.frame === frame
    && lastRenderInfo.camera === camera
    && lastRenderInfo.shadowCamera === shadowCamera
  ) {
    return true;
  }

  lastRenderInfo.frame = frame;
  lastRenderInfo.camera = camera;
  lastRenderInfo.shadowCamera = shadowCamera;
  return false;
};

// Re-export LODLevel type for convenience
export type { LODLevel, LODRenderList } from './LOD';
