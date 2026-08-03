/**
 * @internal Per-instance custom uniforms feature module.
 */

import type { BufferGeometry, Material, Object3DEventMap } from 'three';
import {
  type ChannelSize, SquareDataTexture,
  type UniformMap, type UniformMapType, type UniformType,
  type UniformValue, type UniformValueObj,
} from '../utils/SquareDataTexture';
import type { InstancedMesh2 } from '../InstancedMesh2';

const CHANNELS_PER_PIXEL = 4;
const VEC3_SIZE = 3;
const MAT3_SIZE = 9;
const MAT4_SIZE = 16;

export type UniformSchema = { [x: string]: UniformType };
export type UniformSchemaShader = { vertex?: UniformSchema; fragment?: UniformSchema };

type UniformSchemaResult = {
  channels: ChannelSize;
  pixelsPerInstance: number;
  uniformMap: UniformMap;
  fetchInFragmentShader: boolean;
};

const getUniformSize = function (type: UniformType): number {
  switch (type) {
    case 'float': return 1;
    case 'vec2': return 2;
    case 'vec3': return VEC3_SIZE;
    case 'vec4': return CHANNELS_PER_PIXEL;
    case 'mat3': return MAT3_SIZE;
    case 'mat4': return MAT4_SIZE;
    default: throw new Error(`Invalid uniform type: ${type}`);
  }
};

const getUniformOffset = function (size: number, tempOffset: number[]): number {
  let remainingSize = size;

  if (remainingSize < CHANNELS_PER_PIXEL) {
    for (let i = 0; i < tempOffset.length; i++) {
      if (tempOffset[i] + remainingSize <= CHANNELS_PER_PIXEL) {
        const offset = i * CHANNELS_PER_PIXEL + tempOffset[i];
        tempOffset[i] += remainingSize;
        return offset;
      }
    }
  }

  const offset = tempOffset.length * CHANNELS_PER_PIXEL;
  while (remainingSize > 0) {
    const chunkSize = Math.min(remainingSize, CHANNELS_PER_PIXEL);
    tempOffset.push(chunkSize);
    remainingSize -= CHANNELS_PER_PIXEL;
  }

  return offset;
};

const getUniformSchemaResult = function (schema: UniformSchemaShader): UniformSchemaResult {
  let totalSize = 0;
  const uniformMap = new Map<string, UniformMapType>();
  const uniforms: { type: UniformType; name: string; size: number }[] = [];
  const vertexSchema = schema.vertex ?? {};
  const fragmentSchema = schema.fragment ?? {};
  let fetchInFragmentShader = true;

  for (const name of Object.keys(vertexSchema)) {
    if (Object.prototype.hasOwnProperty.call(vertexSchema, name)) {
      const type = vertexSchema[name];
      const size = getUniformSize(type);
      totalSize += size;
      uniforms.push({ name, type, size });
      fetchInFragmentShader = false;
    }
  }

  for (const name of Object.keys(fragmentSchema)) {
    if (Object.prototype.hasOwnProperty.call(fragmentSchema, name)) {
      if (!vertexSchema[name]) {
        const type = fragmentSchema[name];
        const size = getUniformSize(type);
        totalSize += size;
        uniforms.push({ name, type, size });
      }
    }
  }

  uniforms.sort((a, b) => b.size - a.size);

  const tempOffset: number[] = [];
  for (const { name, size, type } of uniforms) {
    const offset = getUniformOffset(size, tempOffset);
    uniformMap.set(name, { offset, size, type });
  }

  const pixelsPerInstance = Math.ceil(totalSize / CHANNELS_PER_PIXEL);
  const channels = Math.min(totalSize, CHANNELS_PER_PIXEL) as ChannelSize;

  return {
    channels, pixelsPerInstance, uniformMap, fetchInFragmentShader,
  };
};

export const initUniformsPerInstance = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  schema: UniformSchemaShader,
): void {
  if (!this._parentLOD) {
    const {
      channels, pixelsPerInstance, uniformMap, fetchInFragmentShader,
    } = getUniformSchemaResult(schema);
    this.uniformsTexture = new SquareDataTexture(
      Float32Array, channels, pixelsPerInstance,
      this._capacity, uniformMap, fetchInFragmentShader,
    );
    this.materialsNeedsUpdate();
  }
};

export const getUniformAt = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  id: number,
  name: string,
  target?: UniformValueObj,
): UniformValue {
  if (!this.uniformsTexture) {
    throw new Error('Before get/set uniform, it\'s necessary to use "initUniformsPerInstance".');
  }
  return this.uniformsTexture.getUniformAt(id, name, target);
};

export const setUniformAt = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  id: number,
  name: string,
  value: UniformValue,
): void {
  if (!this.uniformsTexture) {
    throw new Error('Before get/set uniform, it\'s necessary to use "initUniformsPerInstance".');
  }
  this.uniformsTexture.setUniformAt(id, name, value);
  this.uniformsTexture.enqueueUpdate(id);
};
