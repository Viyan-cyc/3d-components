// @ts-nocheck
/**
 * @internal LOD (Level of Detail) feature module.
 */

import { BufferGeometry, Material, ShaderMaterial } from 'three';
import type { InstancedMesh2, InstancedMesh2Params } from '../InstancedMesh2';

/**
 * LOD information for an InstancedMesh2.
 */
export interface LODInfo<TData = {}> {
    render: LODRenderList<TData>;
    shadowRender: LODRenderList<TData>;
    objects: InstancedMesh2<TData>[];
}

/**
 * A list of render levels for LOD.
 */
export interface LODRenderList<TData = {}> {
    levels: LODLevel<TData>[];
    count: number[];
}

/**
 * A single LOD level.
 */
export interface LODLevel<TData = {}> {
    distance: number;
    hysteresis: number;
    object: InstancedMesh2<TData>;
}

export function setFirstLODDistance(this: InstancedMesh2, distance: number): InstancedMesh2 {
    if (this._parentLOD) {
        throw new Error('Cannot create LOD for this InstancedMesh2.');
    }

    if (!this.LODinfo) {
        this.LODinfo = { render: null, shadowRender: null, objects: [this] };
    }

    if (!this.LODinfo.render) {
        this.LODinfo.render = {
            levels: [{ distance, hysteresis: 0, object: this }],
            count: [0]
        };
    }

    return this;
}

export function addLOD(this: InstancedMesh2, geometry: BufferGeometry, material: Material | Material[], distance = 0, hysteresis = 0): InstancedMesh2 {
    if (this._parentLOD) {
        throw new Error('Cannot create LOD for this InstancedMesh2.');
    }

    if (!this.LODinfo?.render && distance === 0) {
        throw new Error('Cannot set distance to 0 for the first LOD. Call "setFirstLODDistance" before "addLOD".');
    }

    setFirstLODDistance.call(this, 0);

    addLevel.call(this, this.LODinfo.render, geometry, material, distance, hysteresis);

    return this;
}

export function addShadowLOD(this: InstancedMesh2, geometry: BufferGeometry, distance = 0, hysteresis = 0): InstancedMesh2 {
    if (this._parentLOD) {
        throw new Error('Cannot create LOD for this InstancedMesh2.');
    }

    if (!this.LODinfo) {
        this.LODinfo = { render: null, shadowRender: null, objects: [this] };
    }

    if (!this.LODinfo.shadowRender) {
        this.LODinfo.shadowRender = { levels: [], count: [] };
    }

    const object = addLevel.call(this, this.LODinfo.shadowRender, geometry, null, distance, hysteresis);
    object.castShadow = true;
    this.castShadow = true;

    return this;
}

function addLevel(this: InstancedMesh2, renderList: LODRenderList, geometry: BufferGeometry, material: Material, distance: number, hysteresis: number): InstancedMesh2 {
    const objectsList = this.LODinfo.objects;
    const levels = renderList.levels;
    let index: number;
    let object: InstancedMesh2;
    distance = distance ** 2;

    const objIndex = objectsList.findIndex((e) => e.geometry === geometry);
    if (objIndex === -1) {
        const params: InstancedMesh2Params = { capacity: this._capacity, renderer: this._renderer };
        object = new (this as any).constructor(geometry, material ?? new ShaderMaterial(), params, this);
        object.frustumCulled = false;
        patchLevel.call(this, object);
        objectsList.push(object);
        this.add(object);
    } else {
        object = objectsList[objIndex];
        if (material) object.material = material;
    }

    for (index = 0; index < levels.length; index++) {
        if (distance < levels[index].distance) break;
    }

    levels.splice(index, 0, { distance, hysteresis, object });
    renderList.count.push(0);

    return object;
}

export function updateLOD(this: InstancedMesh2, levelIndex: number, distance?: number, hysteresis?: number): InstancedMesh2 {
    const list = this?.LODinfo?.render;
    if (levelIndex === 0) throw new Error('Cannot change distance for LOD0.');
    return updateLevel.call(this, list, levelIndex, distance, hysteresis);
}

export function updateShadowLOD(this: InstancedMesh2, levelIndex: number, distance?: number, hysteresis?: number): InstancedMesh2 {
    return updateLevel.call(this, this.LODinfo?.shadowRender, levelIndex, distance, hysteresis);
}

function updateLevel(this: InstancedMesh2, renderList: LODRenderList, levelIndex: number, distance: number, hysteresis: number): InstancedMesh2 {
    if (!renderList) throw new Error('Render list is invalid.');

    const level = renderList.levels[levelIndex];
    if (!level) throw new Error('Cannot update an empty LOD.');

    if (distance != null && !Number.isNaN(distance)) {
        level.distance = distance ** 2;
    }
    if (hysteresis != null && !Number.isNaN(hysteresis)) {
        level.hysteresis = hysteresis;
    }

    return this;
}

export function updateAllLOD(this: InstancedMesh2, distances?: number[], hysteresis?: number | number[]): InstancedMesh2 {
    return updateAllLevels.call(this, this.LODinfo?.render, distances, hysteresis);
}

export function updateAllShadowLOD(this: InstancedMesh2, distances?: number[], hysteresis?: number | number[]): InstancedMesh2 {
    return updateAllLevels.call(this, this.LODinfo?.shadowRender, distances, hysteresis);
}

function updateAllLevels(this: InstancedMesh2, renderList: LODRenderList, distances: number[], hysteresis?: number | number[]): InstancedMesh2 {
    if (!renderList?.levels) throw new Error('Invalid LOD list.');
    const levels = renderList.levels;
    const isRender = this.LODinfo?.render === renderList;

    const start = isRender ? 1 : 0;
    if (isRender) levels[0].distance = 0;

    const hasDistances = distances?.length > 0;

    let _distances: number[] = [];
    if (hasDistances) {
        _distances = (isRender && distances[0] === 0)
            ? distances.slice(1, Math.min(levels.length, distances.length))
            : distances.slice(0, Math.min(levels.length - start, distances.length));

        _distances.every((_d, i) => {
            if (i > 0 && _d <= _distances[i - 1]) throw new Error(`LOD distances must be strictly increasing: d[${i - 1}]=${_distances[i - 1]} < d[${i}]=${_d}`);
            return true;
        });
    }

    const total = hasDistances ? _distances.length : (levels.length - start);

    for (let i = 0; i < total; i++) {
        const _d = hasDistances ? _distances[i] : undefined;
        const _h = Array.isArray(hysteresis) ? (hysteresis as number[])[i] : hysteresis;

        updateLevel.call(this, renderList, start + i, _d, _h);
    }

    return this;
}

export function removeLOD(this: InstancedMesh2, levelIndex: number, removeObject = true): InstancedMesh2 {
    const info = this.LODinfo;
    const list = info?.render;
    if (!list?.levels) throw new Error('Invalid LOD list.');

    const n = list.levels.length;
    if (levelIndex < 0 || levelIndex >= n) throw new Error('Level index OOB');
    if (n > 1 && levelIndex === 0) throw new Error('Cannot remove LOD0 while others exist');

    const [removed] = list.levels.splice(levelIndex, 1);
    list.count?.splice?.(levelIndex, 1);
    if (list.levels.length <= 1) info.render = null;

    const obj = removed.object;

    const shadow = this.LODinfo?.shadowRender;
    if (shadow?.levels && levelIndex < shadow.levels.length) {
        shadow.levels.splice(levelIndex, 1);
        shadow.count?.splice?.(levelIndex, 1);
        if (shadow.levels.length === 0) this.LODinfo.shadowRender = null;
    }

    if (removeObject && obj !== this) {
        try {
            this.remove(obj);
            const idx = info.objects?.indexOf(obj) ?? -1;
            if (idx !== -1) info.objects.splice(idx, 1);
            disposeLOD(obj);
        } catch (e) {
            console.error(e);
        }
    }
    return this;
}

function disposeLOD(object: InstancedMesh2): void {
    object.geometry.dispose();
    const mat = object.material;
    if (Array.isArray(mat)) for (const m of mat) m.dispose();
    else mat.dispose();
}

function patchLevel(this: InstancedMesh2, obj: InstancedMesh2): void {
    Object.defineProperty(obj, 'renderOrder', {
        get(this: InstancedMesh2) { return this._parentLOD.renderOrder; }
    });

    Object.defineProperty(obj, '_lastRenderInfo', {
        get(this: InstancedMesh2) { return this._parentLOD._lastRenderInfo; }
    });

    Object.defineProperty(obj, 'matricesTexture', {
        get(this: InstancedMesh2) { return this._parentLOD.matricesTexture; }
    });

    Object.defineProperty(obj, 'colorsTexture', {
        get(this: InstancedMesh2) { return this._parentLOD.colorsTexture; }
    });

    Object.defineProperty(obj, 'uniformsTexture', {
        get(this: InstancedMesh2) { return this._parentLOD.uniformsTexture; }
    });

    Object.defineProperty(obj, 'morphTexture', {
        get(this: InstancedMesh2) { return this._parentLOD.morphTexture; }
    });

    Object.defineProperty(obj, 'boneTexture', {
        get(this: InstancedMesh2) { return this._parentLOD.boneTexture; }
    });

    Object.defineProperty(obj, 'skeleton', {
        get(this: InstancedMesh2) { return this._parentLOD.skeleton; }
    });

    Object.defineProperty(obj, 'bindMatrixInverse', {
        get(this: InstancedMesh2) { return this._parentLOD.bindMatrixInverse; }
    });

    Object.defineProperty(obj, 'bindMatrix', {
        get(this: InstancedMesh2) { return this._parentLOD.bindMatrix; }
    });
}
