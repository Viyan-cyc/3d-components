/**
 * @internal Frustum class - inlined from bvh.js.
 * Extracts 6 clipping planes from a projection matrix and tests AABBs against them.
 */

import type { FloatArray } from './BVHNode';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const WebGLCoordinateSystem = 0;
// eslint-disable-next-line @typescript-eslint/naming-convention
export const WebGPUCoordinateSystem = 1;
export type CoordinateSystem = typeof WebGLCoordinateSystem | typeof WebGPUCoordinateSystem;

const FRUSTUM_PLANE_COUNT = 6;
const FRUSTUM_COMPONENTS = 24;
const PLANE_COMPONENTS = 4;
const BOTTOM_PLANE_INDEX = 3;
const TOP_PLANE_MASK = 0b100000;

// Box layout: interleaved min/max [minX, maxX, minY, maxY, minZ, maxZ]
const BOX_Y_MIN_POS = 2;
const BOX_Y_MAX_POS = 3;
const BOX_Z_MIN_POS = 4;
const BOX_Z_MAX_POS = 5;

const PLANE_CONSTANT_OFFSET = 3;

export class Frustum {
  public array: FloatArray;
  public coordinateSystem: CoordinateSystem;

  constructor(highPrecision: boolean, coordinateSystem: CoordinateSystem) {
    this.coordinateSystem = coordinateSystem;
    this.array = highPrecision
      ? new Float64Array(FRUSTUM_COMPONENTS)
      : new Float32Array(FRUSTUM_COMPONENTS);
  }

  public setFromProjectionMatrix(mat: FloatArray | number[]): this {
    // Left
    this.updatePlane(0, mat[3] + mat[0], mat[7] + mat[4], mat[11] + mat[8], mat[15] + mat[12]);
    // Right
    this.updatePlane(1, mat[3] - mat[0], mat[7] - mat[4], mat[11] - mat[8], mat[15] - mat[12]);
    // Top
    this.updatePlane(2, mat[3] - mat[1], mat[7] - mat[5], mat[11] - mat[9], mat[15] - mat[13]);
    // Bottom
    this.updatePlane(
      BOTTOM_PLANE_INDEX,
      mat[3] + mat[1], mat[7] + mat[5], mat[11] + mat[9], mat[15] + mat[13],
    );
    // Far
    this.updatePlane(PLANE_COMPONENTS, mat[3] - mat[2], mat[7] - mat[6], mat[11] - mat[10], mat[15] - mat[14]);

    if (this.coordinateSystem === WebGLCoordinateSystem) {
      // Near (WebGL)
      this.updatePlane(
        FRUSTUM_PLANE_COUNT - 1,
        mat[3] + mat[2], mat[7] + mat[6], mat[11] + mat[10], mat[15] + mat[14],
      );
    } else if (this.coordinateSystem === WebGPUCoordinateSystem) {
      // Near (WebGPU)
      this.updatePlane(FRUSTUM_PLANE_COUNT - 1, mat[2], mat[6], mat[10], mat[14]);
    }

    return this;
  }

  protected updatePlane(index: number, x: number, y: number, z: number, constant: number): void {
    const array = this.array;
    const offset = index * PLANE_COMPONENTS;
    const length = Math.sqrt(x * x + y * y + z * z);
    array[offset] = x / length;
    array[offset + 1] = y / length;
    array[offset + 2] = z / length;
    array[offset + PLANE_CONSTANT_OFFSET] = constant / length;
  }

  /** Returns -1 = OUT, 0 = IN, > 0 = INTERSECT (mask of remaining planes). */
  public intersectsBoxMask(box: FloatArray, mask: number): number {
    const array = this.array;
    let result = mask;

    for (let i = 0; i < FRUSTUM_PLANE_COUNT; i++) {
      const bit = TOP_PLANE_MASK >> i;
      if ((result & bit) === 0) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const offset = i * PLANE_COMPONENTS;
      const px = array[offset];
      const py = array[offset + 1];
      const pz = array[offset + 2];
      const planeConstant = array[offset + PLANE_CONSTANT_OFFSET];

      const ix = px > 0 ? 1 : 0;
      const iy = py > 0 ? BOX_Y_MAX_POS : BOX_Y_MIN_POS;
      const iz = pz > 0 ? BOX_Z_MAX_POS : BOX_Z_MIN_POS;

      const xMin = box[ix];
      const xMax = box[ix ^ 1];
      const yMin = box[iy];
      const yMax = box[iy ^ 1];
      const zMin = box[iz];
      const zMax = box[iz ^ 1];

      const minDot = (px * xMin) + (py * yMin) + (pz * zMin);
      if (minDot < -planeConstant) {
        return -1;
      }

      const maxDot = (px * xMax) + (py * yMax) + (pz * zMax);
      if (maxDot > -planeConstant) {
        result ^= bit;
      }
    }
    return result;
  }

  /** Simple boolean frustum-box test. */
  public isIntersected(box: FloatArray, mask: number): boolean {
    const array = this.array;

    for (let i = 0; i < FRUSTUM_PLANE_COUNT; i++) {
      const bit = TOP_PLANE_MASK >> i;
      if ((mask & bit) === 0) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const offset = i * PLANE_COMPONENTS;
      const px = array[offset];
      const py = array[offset + 1];
      const pz = array[offset + 2];
      const planeConstant = array[offset + PLANE_CONSTANT_OFFSET];

      const xMin = px > 0 ? box[1] : box[0];
      const yMin = py > 0 ? box[BOX_Y_MAX_POS] : box[BOX_Y_MIN_POS];
      const zMin = pz > 0 ? box[BOX_Z_MAX_POS] : box[BOX_Z_MIN_POS];

      const minDot = (px * xMin) + (py * yMin) + (pz * zMin);
      if (minDot < -planeConstant) {
        return false;
      }
    }
    return true;
  }

  /** Frustum test with BVH margin - use in OnFrustumIntersectionCallback if margin > 0. */
  public isIntersectedMargin(box: FloatArray, mask: number, margin: number): boolean {
    if (mask === 0) {
      return true;
    }
    const array = this.array;

    for (let i = 0; i < FRUSTUM_PLANE_COUNT; i++) {
      const bit = TOP_PLANE_MASK >> i;
      if ((mask & bit) === 0) {
        // eslint-disable-next-line no-continue
        continue;
      }

      const offset = i * PLANE_COMPONENTS;
      const px = array[offset];
      const py = array[offset + 1];
      const pz = array[offset + 2];
      const planeConstant = array[offset + PLANE_CONSTANT_OFFSET];

      const xMin = px > 0 ? box[1] - margin : box[0] + margin;
      const yMin = py > 0 ? box[BOX_Y_MAX_POS] - margin : box[BOX_Y_MIN_POS] + margin;
      const zMin = pz > 0 ? box[BOX_Z_MAX_POS] - margin : box[BOX_Z_MIN_POS] + margin;

      const minDot = (px * xMin) + (py * yMin) + (pz * zMin);
      if (minDot < -planeConstant) {
        return false;
      }
    }
    return true;
  }
}
