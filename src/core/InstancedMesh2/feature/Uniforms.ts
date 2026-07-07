// @ts-nocheck
/**
 * @internal Per-instance custom uniforms feature module.
 */

import type { InstancedMesh2 } from '../InstancedMesh2';
import { SquareDataTexture } from '../utils/SquareDataTexture';
import type { ChannelSize, UniformMap, UniformMapType, UniformType, UniformValue, UniformValueObj } from '../utils/SquareDataTexture';

type UniformSchema = { [x: string]: UniformType };
type UniformSchemaShader = { vertex?: UniformSchema; fragment?: UniformSchema };

type UniformSchemaResult = {
    channels: ChannelSize;
    pixelsPerInstance: number;
    uniformMap: UniformMap;
    fetchInFragmentShader: boolean;
};

export function initUniformsPerInstance(this: InstancedMesh2, schema: UniformSchemaShader): void {
    if (!this._parentLOD) {
        const { channels, pixelsPerInstance, uniformMap, fetchInFragmentShader } = getUniformSchemaResult(schema);
        this.uniformsTexture = new SquareDataTexture(Float32Array, channels, pixelsPerInstance, this._capacity, uniformMap, fetchInFragmentShader);
        this.materialsNeedsUpdate();
    }
}

export function getUniformAt(this: InstancedMesh2, id: number, name: string, target?: UniformValueObj): UniformValue {
    if (!this.uniformsTexture) {
        throw new Error('Before get/set uniform, it\'s necessary to use "initUniformsPerInstance".');
    }
    return this.uniformsTexture.getUniformAt(id, name, target);
}

export function setUniformAt(this: InstancedMesh2, id: number, name: string, value: UniformValue): void {
    if (!this.uniformsTexture) {
        throw new Error('Before get/set uniform, it\'s necessary to use "initUniformsPerInstance".');
    }
    this.uniformsTexture.setUniformAt(id, name, value);
    this.uniformsTexture.enqueueUpdate(id);
}

function getUniformSchemaResult(schema: UniformSchemaShader): UniformSchemaResult {
    let totalSize = 0;
    const uniformMap = new Map<string, UniformMapType>();
    const uniforms: { type: UniformType; name: string; size: number }[] = [];
    const vertexSchema = schema.vertex ?? {};
    const fragmentSchema = schema.fragment ?? {};
    let fetchInFragmentShader = true;

    for (const name in vertexSchema) {
        const type = vertexSchema[name];
        const size = getUniformSize(type);
        totalSize += size;
        uniforms.push({ name, type, size });
        fetchInFragmentShader = false;
    }

    for (const name in fragmentSchema) {
        if (!vertexSchema[name]) {
            const type = fragmentSchema[name];
            const size = getUniformSize(type);
            totalSize += size;
            uniforms.push({ name, type, size });
        }
    }

    uniforms.sort((a, b) => b.size - a.size);

    const tempOffset: number[] = [];
    for (const { name, size, type } of uniforms) {
        const offset = getUniformOffset(size, tempOffset);
        uniformMap.set(name, { offset, size, type });
    }

    const pixelsPerInstance = Math.ceil(totalSize / 4);
    const channels = Math.min(totalSize, 4) as ChannelSize;

    return { channels, pixelsPerInstance, uniformMap, fetchInFragmentShader };
}

function getUniformOffset(size: number, tempOffset: number[]): number {
    if (size < 4) {
        for (let i = 0; i < tempOffset.length; i++) {
            if (tempOffset[i] + size <= 4) {
                const offset = i * 4 + tempOffset[i];
                tempOffset[i] += size;
                return offset;
            }
        }
    }

    const offset = tempOffset.length * 4;
    for (; size > 0; size -= 4) {
        tempOffset.push(size);
    }

    return offset;
}

function getUniformSize(type: UniformType): number {
    switch (type) {
        case 'float': return 1;
        case 'vec2': return 2;
        case 'vec3': return 3;
        case 'vec4': return 4;
        case 'mat3': return 9;
        case 'mat4': return 16;
        default: throw new Error(`Invalid uniform type: ${type}`);
    }
}
