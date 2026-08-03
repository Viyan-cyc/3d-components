/**
 * @internal Intersection utilities - inlined from bvh.js.
 */

import type { FloatArray } from './BVHNode';
import { minDistanceSqPointToBox } from './boxUtils';

const Y_OFFSET = 2;
const Z_OFFSET = 4;

interface RayBoxOptions {
  box: FloatArray;
  origins: FloatArray;
  dirsInv: FloatArray;
  signs: Uint8Array;
  near: number;
  far: number;
}

export const intersectRayBox = function (opts: RayBoxOptions): boolean {
  const {
    box, origins, dirsInv, signs, near, far,
  } = opts;
  const xSign = signs[0];
  const ySign = signs[1];
  const zSign = signs[2];
  const xOrigin = origins[0];
  const yOrigin = origins[1];
  const zOrigin = origins[2];
  const xDirInv = dirsInv[0];
  const yDirInv = dirsInv[1];
  const zDirInv = dirsInv[2];

  const xMin = (box[xSign] - xOrigin) * xDirInv;
  const xMax = (box[xSign ^ 1] - xOrigin) * xDirInv;
  let tmin = xMin > 0 ? xMin : 0;
  let tmax = xMax < Infinity ? xMax : Infinity;

  const yMin = (box[ySign + Y_OFFSET] - yOrigin) * yDirInv;
  if (yMin > tmax) {
    return false;
  }
  const yMax = (box[ySign ^ 1 + Y_OFFSET] - yOrigin) * yDirInv;
  if (tmin > yMax) {
    return false;
  }
  tmin = yMin > tmin ? yMin : tmin;
  tmax = yMax < tmax ? yMax : tmax;

  const zMin = (box[zSign + Z_OFFSET] - zOrigin) * zDirInv;
  if (zMin > tmax) {
    return false;
  }
  const zMax = (box[zSign ^ 1 + Z_OFFSET] - zOrigin) * zDirInv;
  if (tmin > zMax) {
    return false;
  }
  tmin = zMin > tmin ? zMin : tmin;
  tmax = zMax < tmax ? zMax : tmax;

  return tmin <= far && tmax >= near;
};

export const intersectBoxBox = function (boxA: FloatArray, boxB: FloatArray): boolean {
  return boxA[1] >= boxB[0] && boxB[1] >= boxA[0]
    && boxA[3] >= boxB[2] && boxB[3] >= boxA[2]
    && boxA[5] >= boxB[4] && boxB[5] >= boxA[4];
};

export const intersectSphereBox = function (center: FloatArray, radius: number, box: FloatArray): boolean {
  return minDistanceSqPointToBox(box, center) <= radius * radius;
};
