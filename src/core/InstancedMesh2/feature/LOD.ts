/**
 * @internal LOD (Level of Detail) feature module.
 */

import {
  type BufferGeometry,
  type Material,
  type Object3DEventMap,
  ShaderMaterial,
} from 'three';
import type { InstancedMesh2, InstancedMesh2Params } from '../InstancedMesh2';

/**
 * LOD information for an InstancedMesh2.
 */
export interface LODInfo<TData = Record<string, never>> {
  render: LODRenderList<TData> | null;
  shadowRender: LODRenderList<TData> | null;
  objects: InstancedMesh2<TData>[];
}

/**
 * A list of render levels for LOD.
 */
export interface LODRenderList<TData = Record<string, never>> {
  levels: LODLevel<TData>[];
  count: number[];
}

/**
 * A single LOD level.
 */
export interface LODLevel<TData = Record<string, never>> {
  distance: number;
  hysteresis: number;
  object: InstancedMesh2<TData>;
}

const disposeLOD = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(object: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>): void {
  object.geometry.dispose();
  const mat = object.material;
  if (Array.isArray(mat)) {
    for (const m of mat) {
      m.dispose();
    }
  } else {
    mat.dispose();
  }
};

const patchProperty = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  obj: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  propertyName: keyof InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
): void {
  Object.defineProperty(obj, propertyName, {
    get(this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>) {
      return this._parentLOD[propertyName];
    },
  });
};

const patchLevel = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  obj: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
): void {
  const props: (keyof InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>)[] = [
    'renderOrder', '_lastRenderInfo', 'matricesTexture',
    'colorsTexture', 'uniformsTexture', 'morphTexture',
    'boneTexture', 'skeleton', 'bindMatrixInverse', 'bindMatrix',
  ];
  for (const prop of props) {
    patchProperty(obj, prop);
  }
};

interface AddLevelOptions<TData = Record<string, never>> {
  renderList: LODRenderList<TData>;
  geometry: BufferGeometry;
  material: Material | Material[] | null;
  distance: number;
  hysteresis: number;
}

const addLevel = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  options: AddLevelOptions<TData>,
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  const {
    renderList, geometry, material, distance, hysteresis,
  } = options;
  const objectsList = this.LODinfo.objects;
  const levels = renderList.levels;
  let index: number;
  let object: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>;
  const squaredDistance = distance ** 2;

  const objIndex = objectsList.findIndex((e) => e.geometry === geometry);
  if (objIndex === -1) {
    const params: InstancedMesh2Params = { capacity: this._capacity, renderer: this._renderer ?? undefined };
    const ctor = this.constructor as new (
      geometry: BufferGeometry,
      material: Material | Material[],
      params: InstancedMesh2Params,
      lod?: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
    ) => InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>;
    // eslint-disable-next-line new-cap
    object = new ctor(geometry, material ?? new ShaderMaterial(), params, this);
    object.frustumCulled = false;
    patchLevel.call(this, object);
    objectsList.push(object);
    this.add(object);
  } else {
    object = objectsList[objIndex] as InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>;
    if (material) {
      object.material = material as TMaterial;
    }
  }

  for (index = 0; index < levels.length; index++) {
    if (squaredDistance < levels[index].distance) {
      break;
    }
  }

  levels.splice(index, 0, { distance: squaredDistance, hysteresis, object });
  renderList.count.push(0);

  return object;
};

export const setFirstLODDistance = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  distance: number,
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  if (this._parentLOD) {
    throw new Error('Cannot create LOD for this InstancedMesh2.');
  }

  if (!this.LODinfo) {
    this.LODinfo = { render: null, shadowRender: null, objects: [this] };
  }

  if (!this.LODinfo.render) {
    this.LODinfo.render = {
      levels: [{ distance, hysteresis: 0, object: this }],
      count: [0],
    };
  }

  return this;
};

export const addLOD = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  geometry: BufferGeometry,
  material: Material | Material[],
  distance = 0,
  hysteresis = 0,
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  if (this._parentLOD) {
    throw new Error('Cannot create LOD for this InstancedMesh2.');
  }

  if (!this.LODinfo?.render && distance === 0) {
    throw new Error('Cannot set distance to 0 for the first LOD.'
      + ' Call "setFirstLODDistance" before "addLOD".');
  }

  setFirstLODDistance.call(this, 0);
  addLevel.call(this, {
    renderList: this.LODinfo.render, geometry, material, distance, hysteresis,
  });

  return this;
};

export const addShadowLOD = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  geometry: BufferGeometry,
  distance = 0,
  hysteresis = 0,
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  if (this._parentLOD) {
    throw new Error('Cannot create LOD for this InstancedMesh2.');
  }

  if (!this.LODinfo) {
    this.LODinfo = { render: null, shadowRender: null, objects: [this] };
  }

  if (!this.LODinfo.shadowRender) {
    this.LODinfo.shadowRender = { levels: [], count: [] };
  }

  const object = addLevel.call(this, {
    renderList: this.LODinfo.shadowRender, geometry, material: null, distance, hysteresis,
  });
  object.castShadow = true;
  this.castShadow = true;

  return this;
};

const updateLevel = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  renderList: LODRenderList<TData> | null,
  levelIndex: number,
  distance: number | null | undefined,
  hysteresis: number | null | undefined,
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  if (!renderList) {
    throw new Error('Render list is invalid.');
  }

  const level = renderList.levels[levelIndex];
  if (!level) {
    throw new Error('Cannot update an empty LOD.');
  }

  if (distance !== null && distance !== undefined && !Number.isNaN(distance)) {
    level.distance = distance ** 2;
  }
  if (hysteresis !== null && hysteresis !== undefined && !Number.isNaN(hysteresis)) {
    level.hysteresis = hysteresis;
  }

  return this;
};

export const updateLOD = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  levelIndex: number,
  distance?: number,
  hysteresis?: number,
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  const list = this?.LODinfo?.render;
  if (levelIndex === 0) {
    throw new Error('Cannot change distance for LOD0.');
  }
  return updateLevel.call(
    this,
    list,
    levelIndex, distance, hysteresis,
  ) as InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>;
};

export const updateShadowLOD = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  levelIndex: number,
  distance?: number,
  hysteresis?: number,
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  return updateLevel.call(
    this,
    this.LODinfo?.shadowRender,
    levelIndex, distance, hysteresis,
  ) as InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>;
};

const validateDistances = function (distances: number[]): void {
  for (let i = 1; i < distances.length; i++) {
    if (distances[i] <= distances[i - 1]) {
      throw new Error('LOD distances must be strictly increasing:'
        + ` d[${i - 1}]=${distances[i - 1]} < d[${i}]=${distances[i]}`);
    }
  }
};

const buildDistances = function <TData>(
  isRender: boolean,
  levels: LODLevel<TData>[],
  start: number,
  distances: number[] | undefined,
): number[] {
  if (!distances?.length) {
    return [];
  }

  let result: number[];
  if (isRender && distances[0] === 0) {
    result = distances.slice(1, Math.min(levels.length, distances.length));
  } else {
    result = distances.slice(0, Math.min(levels.length - start, distances.length));
  }

  validateDistances(result);
  return result;
};

const updateAllLevels = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  renderList: LODRenderList<TData> | null,
  distances: number[] | undefined,
  hysteresis?: number | number[],
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  if (!renderList?.levels) {
    throw new Error('Invalid LOD list.');
  }
  const levels = renderList.levels;
  const isRender = this.LODinfo?.render === renderList;

  const start = isRender ? 1 : 0;
  if (isRender) {
    levels[0].distance = 0;
  }

  const hasDistances = distances !== undefined && distances.length > 0;
  const resolvedDistances = buildDistances(isRender, levels, start, distances);

  const total = hasDistances
    ? resolvedDistances.length
    : (levels.length - start);

  for (let i = 0; i < total; i++) {
    const distance = hasDistances ? resolvedDistances[i] : undefined;
    const hyst = Array.isArray(hysteresis) ? hysteresis[i] : hysteresis;
    updateLevel.call(this, renderList, start + i, distance, hyst);
  }

  return this;
};

export const updateAllLOD = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  distances?: number[],
  hysteresis?: number | number[],
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  return updateAllLevels.call(
    this,
    this.LODinfo?.render,
    distances, hysteresis,
  ) as InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>;
};

export const updateAllShadowLOD = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  distances?: number[],
  hysteresis?: number | number[],
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  return updateAllLevels.call(
    this,
    this.LODinfo?.shadowRender,
    distances, hysteresis,
  ) as InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>;
};

const removeShadowLevel = function <TData>(
  info: LODInfo<TData>,
  levelIndex: number,
): void {
  const shadow = info?.shadowRender;
  if (shadow?.levels && levelIndex < shadow.levels.length) {
    shadow.levels.splice(levelIndex, 1);
    shadow.count?.splice?.(levelIndex, 1);
    if (shadow.levels.length === 0) {
      info.shadowRender = null;
    }
  }
};

const removeLevelObject = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  info: LODInfo<TData>,
  obj: InstancedMesh2<TData>,
  removeObject: boolean,
): void {
  if (!removeObject || obj === this) {
    return;
  }
  try {
    this.remove(obj);
    const idx = info.objects?.indexOf(obj) ?? -1;
    if (idx !== -1) {
      info.objects.splice(idx, 1);
    }
    disposeLOD(obj);
  } catch (e) {

    console.error(e);
  }
};

export const removeLOD = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  levelIndex: number,
  removeObject = true,
): InstancedMesh2<TData, TGeometry, TMaterial, TEventMap> {
  const info = this.LODinfo;
  const list = info?.render;
  if (!list?.levels) {
    throw new Error('Invalid LOD list.');
  }

  const n = list.levels.length;
  if (levelIndex < 0 || levelIndex >= n) {
    throw new Error('Level index OOB');
  }
  if (n > 1 && levelIndex === 0) {
    throw new Error('Cannot remove LOD0 while others exist');
  }

  const [removed] = list.levels.splice(levelIndex, 1);
  list.count?.splice?.(levelIndex, 1);
  if (list.levels.length <= 1) {
    info.render = null;
  }

  const obj = removed.object;
  removeShadowLevel(info, levelIndex);
  removeLevelObject.call(
    this,
    info, obj, removeObject,
  );

  return this;
};
