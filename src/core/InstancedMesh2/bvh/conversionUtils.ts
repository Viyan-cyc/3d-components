// @ts-nocheck
/**
 * @internal Conversion utilities - inlined from bvh.js.
 * Converts Three.js Vector3/Box3 to BVH FloatArray format.
 */

import type { FloatArray } from './BVHNode';

export interface Vector3Like { x: number; y: number; z: number }
export interface Box3Like { min: Vector3Like; max: Vector3Like }

export function vec3ToArray(vector: Vector3Like, target: FloatArray): FloatArray {
    target[0] = vector.x;
    target[1] = vector.y;
    target[2] = vector.z;
    return target;
}

export function box3ToArray(box: Box3Like, target: FloatArray): FloatArray {
    const min = box.min;
    const max = box.max;
    target[0] = min.x;
    target[1] = max.x;
    target[2] = min.y;
    target[3] = max.y;
    target[4] = min.z;
    target[5] = max.z;
    return target;
}
