/**
 * @internal AABB math utilities - inlined from bvh.js.
 */

import type { FloatArray } from './BVHNode';

export const unionBox = function (boxA: FloatArray, boxB: FloatArray, target: FloatArray): void {
  target[0] = boxA[0] > boxB[0] ? boxB[0] : boxA[0];
  target[1] = boxA[1] < boxB[1] ? boxB[1] : boxA[1];
  target[2] = boxA[2] > boxB[2] ? boxB[2] : boxA[2];
  target[3] = boxA[3] < boxB[3] ? boxB[3] : boxA[3];
  target[4] = boxA[4] > boxB[4] ? boxB[4] : boxA[4];
  target[5] = boxA[5] < boxB[5] ? boxB[5] : boxA[5];
};

export const unionBoxChanged = function (boxA: FloatArray, boxB: FloatArray, target: FloatArray): boolean {
  let changed = false;

  const t0 = boxA[0] > boxB[0] ? boxB[0] : boxA[0];
  const t1 = boxA[1] < boxB[1] ? boxB[1] : boxA[1];
  const t2 = boxA[2] > boxB[2] ? boxB[2] : boxA[2];
  const t3 = boxA[3] < boxB[3] ? boxB[3] : boxA[3];
  const t4 = boxA[4] > boxB[4] ? boxB[4] : boxA[4];
  const t5 = boxA[5] < boxB[5] ? boxB[5] : boxA[5];

  if (target[0] > t0) {
    target[0] = t0; changed = true;
  }
  if (target[1] < t1) {
    target[1] = t1; changed = true;
  }
  if (target[2] > t2) {
    target[2] = t2; changed = true;
  }
  if (target[3] < t3) {
    target[3] = t3; changed = true;
  }
  if (target[4] > t4) {
    target[4] = t4; changed = true;
  }
  if (target[5] < t5) {
    target[5] = t5; changed = true;
  }

  return changed;
};

export const isBoxInsideBox = function (innerBox: FloatArray, outerBox: FloatArray): boolean {
  if (outerBox[0] > innerBox[0]) {
    return false;
  }
  if (outerBox[1] < innerBox[1]) {
    return false;
  }
  if (outerBox[2] > innerBox[2]) {
    return false;
  }
  if (outerBox[3] < innerBox[3]) {
    return false;
  }
  if (outerBox[4] > innerBox[4]) {
    return false;
  }
  if (outerBox[5] < innerBox[5]) {
    return false;
  }
  return true;
};

export const isExpanded = function (boxA: FloatArray, target: FloatArray): boolean {
  let expanded = false;

  if (target[0] > boxA[0]) {
    target[0] = boxA[0]; expanded = true;
  }
  if (target[1] < boxA[1]) {
    target[1] = boxA[1]; expanded = true;
  }
  if (target[2] > boxA[2]) {
    target[2] = boxA[2]; expanded = true;
  }
  if (target[3] < boxA[3]) {
    target[3] = boxA[3]; expanded = true;
  }
  if (target[4] > boxA[4]) {
    target[4] = boxA[4]; expanded = true;
  }
  if (target[5] < boxA[5]) {
    target[5] = boxA[5]; expanded = true;
  }

  return expanded;
};

export const expandBox = function (boxA: FloatArray, target: FloatArray): void {
  if (target[0] > boxA[0]) {
    target[0] = boxA[0];
  }
  if (target[1] < boxA[1]) {
    target[1] = boxA[1];
  }
  if (target[2] > boxA[2]) {
    target[2] = boxA[2];
  }
  if (target[3] < boxA[3]) {
    target[3] = boxA[3];
  }
  if (target[4] > boxA[4]) {
    target[4] = boxA[4];
  }
  if (target[5] < boxA[5]) {
    target[5] = boxA[5];
  }
};

export const expandBoxByMargin = function (target: FloatArray, margin: number): void {
  target[0] -= margin;
  target[1] += margin;
  target[2] -= margin;
  target[3] += margin;
  target[4] -= margin;
  target[5] += margin;
};

export const areaBox = function (box: FloatArray): number {
  const d0 = box[1] - box[0];
  const d1 = box[3] - box[2];
  const d2 = box[5] - box[4];
  return 2 * (d0 * d1 + d1 * d2 + d2 * d0);
};

export const areaFromTwoBoxes = function (boxA: FloatArray, boxB: FloatArray): number {
  const minX = boxA[0] > boxB[0] ? boxB[0] : boxA[0];
  const maxX = boxA[1] < boxB[1] ? boxB[1] : boxA[1];
  const minY = boxA[2] > boxB[2] ? boxB[2] : boxA[2];
  const maxY = boxA[3] < boxB[3] ? boxB[3] : boxA[3];
  const minZ = boxA[4] > boxB[4] ? boxB[4] : boxA[4];
  const maxZ = boxA[5] < boxB[5] ? boxB[5] : boxA[5];

  const d0 = maxX - minX;
  const d1 = maxY - minY;
  const d2 = maxZ - minZ;
  return 2 * (d0 * d1 + d1 * d2 + d2 * d0);
};

export const getLongestAxis = function (box: FloatArray): number {
  const xSize = box[1] - box[0];
  const ySize = box[3] - box[2];
  const zSize = box[5] - box[4];

  if (xSize > ySize) {
    return xSize > zSize ? 0 : 2;
  }
  return ySize > zSize ? 1 : 2;
};

export const minDistanceSqPointToBox = function (box: FloatArray, point: FloatArray): number {
  const xMin = box[0] - point[0];
  const xMax = point[0] - box[1];
  let dx = xMin > xMax ? xMin : xMax;
  if (dx < 0) {
    dx = 0;
  }

  const yMin = box[2] - point[1];
  const yMax = point[1] - box[3];
  let dy = yMin > yMax ? yMin : yMax;
  if (dy < 0) {
    dy = 0;
  }

  const zMin = box[4] - point[2];
  const zMax = point[2] - box[5];
  let dz = zMin > zMax ? zMin : zMax;
  if (dz < 0) {
    dz = 0;
  }

  return dx * dx + dy * dy + dz * dz;
};

const BOX_AXIS_STRIDE = 4;

type AxisDistResult = { dMin: number; dMax: number };

interface AxisDistOptions {
  box: FloatArray;
  point: FloatArray;
  axisIndex: number;
  coordIndex: number;
}

const computeAxisDistances = function (opts: AxisDistOptions): AxisDistResult {
  const lo = opts.box[opts.axisIndex] - opts.point[opts.coordIndex];
  const hi = opts.point[opts.coordIndex] - opts.box[opts.axisIndex + 1];
  let dMin: number;
  let dMax: number;

  if (lo > hi) {
    dMin = lo; dMax = hi;
  } else {
    dMin = hi; dMax = lo;
  }
  if (dMin < 0) {
    dMin = 0;
  }

  return { dMin, dMax };
};

export const minMaxDistanceSqPointToBox = function (box: FloatArray, point: FloatArray): { min: number; max: number } {
  const x = computeAxisDistances({
    box, point, axisIndex: 0, coordIndex: 0,
  });
  const y = computeAxisDistances({
    box, point, axisIndex: 2, coordIndex: 1,
  });
  const z = computeAxisDistances({
    box, point, axisIndex: BOX_AXIS_STRIDE, coordIndex: 2,
  });

  return {
    min: x.dMin * x.dMin + y.dMin * y.dMin + z.dMin * z.dMin,
    max: x.dMax * x.dMax + y.dMax * y.dMax + z.dMax * z.dMax,
  };
};
