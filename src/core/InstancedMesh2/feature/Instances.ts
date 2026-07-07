/**
 * @internal Instance management feature module.
 * Adds add/remove/update/clear instances to InstancedMesh2.
 */

import { InstancedEntity } from '../InstancedEntity';
import type { InstancedMesh2 } from '../InstancedMesh2';

/** Extended entity type with custom data. */
export type Entity<T> = InstancedEntity & T;
/** Callback to update or initialize an entity. */
export type UpdateEntityCallback<T = InstancedEntity> = (obj: Entity<T>, index: number) => void;

function clearInstance(instance: InstancedEntity): InstancedEntity {
    instance.position.set(0, 0, 0);
    instance.scale.set(1, 1, 1);
    instance.quaternion.identity();
    return instance;
}

function clearTempInstance(this: InstancedMesh2, index: number): InstancedEntity {
    const instance = this._tempInstance;
    (instance as any).id = index;
    return clearInstance(instance);
}

function clearTempInstancePosition(this: InstancedMesh2, index: number): InstancedEntity {
    const instance = this._tempInstance;
    (instance as any).id = index;
    instance.position.set(0, 0, 0);
    return instance;
}

export function updateInstances(this: InstancedMesh2, onUpdate: UpdateEntityCallback): InstancedMesh2 {
    const end = this._instancesArrayCount;
    const instances = this.instances;

    for (let i = 0; i < end; i++) {
        if (!this.getActiveAt(i)) continue;
        const instance = instances ? instances[i] : clearTempInstance.call(this, i);
        onUpdate(instance, i);
        instance.updateMatrix();
    }

    return this;
}

export function updateInstancesPosition(this: InstancedMesh2, onUpdate: UpdateEntityCallback): InstancedMesh2 {
    const end = this._instancesArrayCount;
    const instances = this.instances;

    for (let i = 0; i < end; i++) {
        if (!this.getActiveAt(i)) continue;
        const instance = instances ? instances[i] : clearTempInstancePosition.call(this, i);
        onUpdate(instance, i);
        instance.updateMatrixPosition();
    }

    return this;
}

export function createEntities(this: InstancedMesh2, start: number): InstancedMesh2 {
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
        if (instances[i]) continue;
        instances[i] = new InstancedEntity(this, i, this._allowsEuler);
    }

    return this;
}

export function addInstances(this: InstancedMesh2, count: number, onCreation?: UpdateEntityCallback): InstancedMesh2 {
    if (!onCreation && this.bvh) {
        console.warn('InstancedMesh2: if `computeBVH()` has already been called, it is better to valorize the instances in the `onCreation` callback for better performance.');
    }

    const freeIds = this._freeIds;
    if (freeIds.length > 0) {
        let maxId = -1;
        const freeIdsUsed = Math.min(freeIds.length, count);
        const freeidsEnd = freeIds.length - freeIdsUsed;

        for (let i = freeIds.length - 1; i >= freeidsEnd; i--) {
            const id = freeIds[i];
            if (id > maxId) maxId = id;
            addInstance.call(this, id, onCreation);
        }

        freeIds.length -= freeIdsUsed;
        count -= freeIdsUsed;
        this._instancesArrayCount = Math.max(maxId + 1, this._instancesArrayCount);
    }

    const start = this._instancesArrayCount;
    const end = start + count;
    setInstancesArrayCount.call(this, end);

    for (let i = start; i < end; i++) {
        addInstance.call(this, i, onCreation);
    }

    return this;
}

function addInstance(this: InstancedMesh2, id: number, onCreation?: UpdateEntityCallback): void {
    this._instancesCount++;
    this.setActiveAndVisibilityAt(id, true);
    const instance = this.instances ? clearInstance(this.instances[id]) : clearTempInstance.call(this, id);

    if (onCreation) {
        onCreation(instance, id);
        instance.updateMatrix();
    } else {
        instance.setMatrixIdentity();
    }

    this.bvh?.insert(id);
}

export function removeInstances(this: InstancedMesh2, ...ids: number[]): InstancedMesh2 {
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
        if (this.getActiveAt(i)) break;
        this._instancesArrayCount--;
    }

    return this;
}

export function clearInstances(this: InstancedMesh2): InstancedMesh2 {
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
}

export function setInstancesArrayCount(this: InstancedMesh2, count: number): void {
    if (count < this._instancesArrayCount) {
        const bvh = this.bvh;
        if (bvh) {
            for (let i = this._instancesArrayCount - 1; i >= count; i--) {
                if (!this.getActiveAt(i)) continue;
                bvh.delete(i);
            }
        }

        this._instancesArrayCount = count;
        return;
    }

    if (count > this._capacity) {
        let newCapacity = this._capacity + (this._capacity >> 1) + 512;
        while (newCapacity < count) {
            newCapacity += (newCapacity >> 1) + 512;
        }

        resizeBuffers.call(this, newCapacity);
    }

    const start = this._instancesArrayCount;
    this._instancesArrayCount = count;
    if (this._createEntities) createEntities.call(this, start);
}

export function resizeBuffers(this: InstancedMesh2, capacity: number): InstancedMesh2 {
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
            this.colorsTexture._data.fill(1, oldCapacity * 4);
        }
    }

    this.uniformsTexture?.resize(capacity);

    return this;
}
