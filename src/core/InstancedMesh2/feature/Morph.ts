// @ts-nocheck
/**
 * @internal Per-instance morph targets feature module.
 */

import { DataTexture, FloatType, Mesh, RedFormat } from 'three';
import type { InstancedMesh2 } from '../InstancedMesh2';

const _tempMesh = new Mesh();

export function getMorphAt(this: InstancedMesh2, id: number, object = _tempMesh): Mesh {
    const objectInfluences = object.morphTargetInfluences;
    const array = this.morphTexture.source.data.data;
    const len = objectInfluences.length + 1;
    const dataIndex = id * len + 1;

    for (let i = 0; i < objectInfluences.length; i++) {
        objectInfluences[i] = array[dataIndex + i];
    }

    return object;
}

export function setMorphAt(this: InstancedMesh2, id: number, object: Mesh): void {
    const objectInfluences = object.morphTargetInfluences;
    const len = objectInfluences.length + 1;

    if (this.morphTexture === null && !this._parentLOD) {
        this.morphTexture = new DataTexture(new Float32Array(len * this._capacity), len, this._capacity, RedFormat, FloatType);
    }

    const array = this.morphTexture.source.data.data;
    let morphInfluencesSum = 0;

    for (const objectInfluence of objectInfluences) {
        morphInfluencesSum += objectInfluence;
    }

    const morphBaseInfluence = this._geometry.morphTargetsRelative ? 1 : 1 - morphInfluencesSum;
    const dataIndex = len * id;
    array[dataIndex] = morphBaseInfluence;
    array.set(objectInfluences, dataIndex + 1);
    this.morphTexture.needsUpdate = true;
}
