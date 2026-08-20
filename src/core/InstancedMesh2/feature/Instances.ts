/**
 * @internal Instance management feature module.
 * Adds add/remove/update/clear instances to InstancedMesh2.
 */

import type { BufferGeometry, Material, Object3DEventMap } from 'three';
import { InstancedEntity } from '../InstancedEntity';
import type { InstancedMesh2 } from '../InstancedMesh2';

/** Extended entity type with custom data. */
export type Entity<T> = InstancedEntity & T;

/** Callback to update or initialize an entity. */
export type UpdateEntityCallback<T = InstancedEntity> = (
  obj: Entity<T>, index: number,
) => void;

const BUFFER_GROW_SIZE = 512;
const COLOR_COMPONENTS = 4;

const clearInstance = function (instance: InstancedEntity): InstancedEntity {
  instance.position.set(0, 0, 0);
  instance.scale.set(1, 1, 1);
  instance.quaternion.identity();
  return instance;
};

const clearTempInstance = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, index: number): InstancedEntity {
  const instance = this._tempInstance;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (instance as any).id = index;
  return clearInstance(instance);
};

const clearTempInstancePosition = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, index: number): InstancedEntity {
  const instance = this._tempInstance;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (instance as any).id = index;
  instance.position.set(0, 0, 0);
  return instance;
};

const addInstance = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, id: number, onCreation?: UpdateEntityCallback): void {
  this._instancesCount++;
  this.setActiveAndVisibilityAt(id, true);
  const instance = this.instances
    ? clearInstance(this.instances[id])
    : clearTempInstance.call(this, id);

  if (onCreation) {
    onCreation(instance, id);
    instance.updateMatrix();
  } else {
    instance.setMatrixIdentity();
  }

  this.bvh?.insert(id);
};

const addFreeIdInstances = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  freeIds: number[],
  remaining: number,
  onCreation?: UpdateEntityCallback,
): number {
  let maxId = -1;
  const freeIdsUsed = Math.min(freeIds.length, remaining);
  const freeIdsEnd = freeIds.length - freeIdsUsed;

  for (let i = freeIds.length - 1; i >= freeIdsEnd; i--) {
    const id = freeIds[i];
    if (id > maxId) {
      maxId = id;
    }
    addInstance.call(this, id, onCreation);
  }

  freeIds.length -= freeIdsUsed;
  this._instancesArrayCount = Math.max(maxId + 1, this._instancesArrayCount);
  return remaining - freeIdsUsed;
};

const removeBvhRange = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(mesh: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, from: number, to: number): void {
  const bvh = mesh.bvh;
  if (!bvh) {
    return;
  }
  for (let i = from - 1; i >= to; i--) {
    if (!mesh.getActiveAt(i)) {
      // eslint-disable-next-line no-continue
      continue;
    }
    bvh.delete(i);
  }
};

export const resizeBuffers = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  capacity: number,
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  const oldCapacity = this._capacity;
  this._capacity = capacity;
  const minCapacity = Math.min(capacity, oldCapacity);

  if (this.instanceIndex) {
    const indexArray = new Uint32Array(capacity);
    indexArray.set(new Uint32Array(this.instanceIndex.array.buffer, 0, minCapacity));
    this.instanceIndex.array = indexArray;
  }

  if (this.LODinfo) {
    for (const obj of this.LODinfo.objects) {
      obj._capacity = capacity;

      if (obj.instanceIndex) {
        const indexArray = new Uint32Array(capacity);
        indexArray.set(new Uint32Array(obj.instanceIndex.array.buffer, 0, minCapacity));
        obj.instanceIndex.array = indexArray;
      }
    }
  }

  this.availabilityArray.length = capacity * 2;

  this.matricesTexture.resize(capacity);

  if (this.colorsTexture) {
    this.colorsTexture.resize(capacity);
    if (capacity > oldCapacity) {
      this.colorsTexture._data.fill(1, oldCapacity * COLOR_COMPONENTS);
    }
  }

  this.uniformsTexture?.resize(capacity);

  return this;
};

export const createEntities = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  start: number,
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  const end = this._instancesArrayCount;

  if (!this.instances) {
    this.instances = new Array(end);
  } else if (this.instances.length < end) {
    this.instances.length = end;
  } else {
    return this;
  }

  const instances = this.instances;
  for (let i = start; i < end; i++) {
    if (instances[i]) {
      // eslint-disable-next-line no-continue
      continue;
    }
    instances[i] = new InstancedEntity(this, i, this._allowsEuler) as Entity<TData>;
  }

  return this;
};

export const setInstancesArrayCount = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>, count: number): void {
  if (count < this._instancesArrayCount) {
    removeBvhRange(this, this._instancesArrayCount, count);
    this._instancesArrayCount = count;
    return;
  }

  if (count > this._capacity) {
    let newCapacity = this._capacity + (this._capacity >> 1) + BUFFER_GROW_SIZE;
    while (newCapacity < count) {
      newCapacity += (newCapacity >> 1) + BUFFER_GROW_SIZE;
    }

    resizeBuffers.call(this, newCapacity);
  }

  const start = this._instancesArrayCount;
  this._instancesArrayCount = count;
  if (this._createEntities) {
    createEntities.call(this, start);
  }
};

export const updateInstances = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  onUpdate: UpdateEntityCallback,
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  const end = this._instancesArrayCount;
  const instances = this.instances;

  for (let i = 0; i < end; i++) {
    if (!this.getActiveAt(i)) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const instance = instances ? instances[i] : clearTempInstance.call(this, i);
    onUpdate(instance, i);
    instance.updateMatrix();
  }

  return this;
};

export const updateInstancesPosition = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  onUpdate: UpdateEntityCallback,
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  const end = this._instancesArrayCount;
  const instances = this.instances;

  for (let i = 0; i < end; i++) {
    if (!this.getActiveAt(i)) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const instance = instances
      ? instances[i]
      : clearTempInstancePosition.call(this, i);
    onUpdate(instance, i);
    instance.updateMatrixPosition();
  }

  return this;
};

export const addInstances = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  count: number,
  onCreation?: UpdateEntityCallback,
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  if (!onCreation && this.bvh) {

    console.warn('InstancedMesh2: if `computeBVH()` has already been called,'
      + ' it is better to valorize the instances in the `onCreation`'
      + ' callback for better performance.');
  }

  let remaining = count;
  const freeIds = this._freeIds;
  if (freeIds.length > 0) {
    remaining = addFreeIdInstances.call(this, freeIds, remaining, onCreation);
  }

  const start = this._instancesArrayCount;
  const end = start + remaining;
  setInstancesArrayCount.call(this, end);

  for (let i = start; i < end; i++) {
    addInstance.call(this, i, onCreation);
  }

  return this;
};

export const removeInstances = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  ...ids: number[]
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  const freeIds = this._freeIds;
  const bvh = this.bvh;

  for (const id of ids) {
    if (id < this._instancesArrayCount && this.getActiveAt(id)) {
      this.setActiveAt(id, false);
      freeIds.push(id);
      bvh?.delete(id);
      this._instancesCount--;
    }
  }

  for (let i = this._instancesArrayCount - 1; i >= 0; i--) {
    if (this.getActiveAt(i)) {
      break;
    }
    this._instancesArrayCount--;
  }

  return this;
};

export const clearInstances = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>):
  InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  this._instancesCount = 0;
  this._instancesArrayCount = 0;
  this._freeIds.length = 0;

  this.bvh?.clear();

  if (this.LODinfo) {
    for (const obj of this.LODinfo.objects) {
      obj.count = 0;
    }
  }

  return this;
};
