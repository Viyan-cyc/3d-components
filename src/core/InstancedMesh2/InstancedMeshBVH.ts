import {
  BVH,
  type BVHNode,
  HybridBuilder,
  WebGLCoordinateSystem,
  type OnFrustumIntersectionCallback,
  type OnFrustumIntersectionLODCallback,
  type OnIntersectionCallback,
  type OnIntersectionRayCallback,
} from './bvh';
import {
  Box3,
  type Matrix4,
  type Raycaster,
  type Sphere,
  type Vector3,
} from 'three';
import { box3ToArray, vec3ToArray } from './bvh/conversionUtils';
import type { InstancedMesh2 } from './InstancedMesh2';
import type { LODLevel } from './feature/LOD';

const MATRIX_ELEMENTS = 16;
const VECTOR_SIZE = 3;
const BOX_SIZE = 6;
const COL1_BASE = 4;
const COL2_BASE = 8;
const COL3_BASE = 12;

const tempBox3 = new Box3();

type EmptyObj = Record<string, never>;

/**
 * Parameters for configuring the BVH (Bounding Volume Hierarchy).
 */
export interface BVHParams {

    /** Margin for animated/moving objects. @default 0 */
    margin?: number;

    /** Compute instance AABBs from geometry bounding sphere. Faster but less precise. @default false */
    getBBoxFromBSphere?: boolean;

    /** Enable accurate frustum culling without margin. @default true */
    accurateCulling?: boolean;
}

interface SphereTarget {
    centerX: number;
    centerY: number;
    centerZ: number;
    maxScale: number;
}

/**
 * Manages BVH (Bounding Volume Hierarchy) for `InstancedMesh2`.
 * Provides frustum culling, raycasting, and bounding box computation.
 */
export class InstancedMeshBVH {
  public target: InstancedMesh2;
  public geoBoundingBox: Box3;
  public bvh: BVH<EmptyObj, number>;
  public nodesMap = new Map<number, BVHNode<EmptyObj, number>>();
  public accurateCulling: boolean;
  protected lodsMap = new Map<LODLevel[], Float32Array>();
  protected _margin: number;
  protected _origin: Float32Array;
  protected _dir: Float32Array;
  protected _boxArray: Float32Array | null = null;
  protected _cameraPos: Float32Array;
  protected _getBoxFromSphere: boolean;
  protected _geoBoundingSphere: Sphere | null = null;
  protected _sphereTarget: SphereTarget | null = null;

  constructor(target: InstancedMesh2, margin = 0, getBBoxFromBSphere = false, accurateCulling = true) {
    this.target = target;
    this.accurateCulling = accurateCulling;
    this._margin = margin;

    const geometry = target._geometry;

    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    this.geoBoundingBox = geometry.boundingBox!;

    let useBoxFromSphere = getBBoxFromBSphere;

    if (useBoxFromSphere) {
      if (!geometry.boundingSphere) {
        geometry.computeBoundingSphere();
      }

      const center = geometry.boundingSphere!.center;
      if (center.x === 0 && center.y === 0 && center.z === 0) {
        this._geoBoundingSphere = geometry.boundingSphere!;
        this._sphereTarget = {
          centerX: 0, centerY: 0, centerZ: 0, maxScale: 0,
        };
      } else {
        // eslint-disable-next-line no-console
        console.warn('"getBoxFromSphere" is ignored because geometry is not centered.');
        useBoxFromSphere = false;
      }
    }

    this.bvh = new BVH(new HybridBuilder(), WebGLCoordinateSystem);
    this._origin = new Float32Array(VECTOR_SIZE);
    this._dir = new Float32Array(VECTOR_SIZE);
    this._cameraPos = new Float32Array(VECTOR_SIZE);
    this._getBoxFromSphere = useBoxFromSphere;
  }

  /** Builds the BVH from all active instances (top-down, more efficient than incremental). */
  public create(): void {
    const count = this.target._instancesCount;
    const instancesArrayCount = this.target._instancesArrayCount;
    const boxes: Float32Array[] = new Array(count);
    const objects = new Uint32Array(count);
    let index = 0;

    this.clear();

    for (let i = 0; i < instancesArrayCount; i++) {
      if (!this.target.getActiveAt(i)) {
        // eslint-disable-next-line no-continue
        continue;
      }
      boxes[index] = this.getBox(i, new Float32Array(BOX_SIZE));
      objects[index] = i;
      index++;
    }

    this.bvh.createFromArray(objects as unknown as number[], boxes, (node) => {
      this.nodesMap.set(node.object!, node);
    }, this._margin);
  }

  /** Inserts an instance into the BVH. */
  public insert(id: number): void {
    const node = this.bvh.insert(id, this.getBox(id, new Float32Array(BOX_SIZE)), this._margin);
    this.nodesMap.set(id, node);
  }

  /** Inserts a range of instances. */
  public insertRange(ids: number[]): void {
    const count = ids.length;
    const boxes: Float32Array[] = new Array(count);

    for (let i = 0; i < count; i++) {
      boxes[i] = this.getBox(ids[i], new Float32Array(BOX_SIZE));
    }

    this.bvh.insertRange(ids, boxes, this._margin, (node) => {
      this.nodesMap.set(node.object!, node);
    });
  }

  /** Moves an instance within the BVH (update node.box before calling). */
  public move(id: number): void {
    const node = this.nodesMap.get(id);
    if (!node) {
      return;
    }
    this.getBox(id, node.box as Float32Array);
    this.bvh.move(node, this._margin);
  }

  /** Deletes an instance from the BVH. */
  public delete(id: number): void {
    const node = this.nodesMap.get(id);
    if (!node) {
      return;
    }
    this.bvh.delete(node);
    this.nodesMap.delete(id);
  }

  /** Clears the BVH. */
  public clear(): void {
    this.bvh.clear();
    this.nodesMap.clear();
  }

  /** Performs frustum culling on the BVH. */
  public frustumCulling(
    projScreenMatrix: Matrix4,
    onFrustumIntersection: OnFrustumIntersectionCallback<EmptyObj, number>,
  ): void {
    if (this._margin > 0 && this.accurateCulling) {
      this.bvh.frustumCulling(projScreenMatrix.elements, (node, frustum, mask) => {
        if (frustum && mask !== undefined && frustum.isIntersectedMargin(node.box, mask, this._margin)) {
          onFrustumIntersection(node);
        }
      });
    } else {
      this.bvh.frustumCulling(projScreenMatrix.elements, onFrustumIntersection);
    }
  }

  /** Performs frustum culling with LOD. */
  public frustumCullingLOD(
    projScreenMatrix: Matrix4,
    cameraPosition: Vector3,
    levels: LODLevel[],
    onFrustumIntersection: OnFrustumIntersectionLODCallback<EmptyObj, number>,
  ): void {
    if (!this.lodsMap.has(levels)) {
      this.lodsMap.set(levels, new Float32Array(levels.length));
    }

    const levelsArray = this.lodsMap.get(levels)!;
    for (let i = 0; i < levels.length; i++) {
      levelsArray[i] = levels[i].distance;
    }

    const camera = this._cameraPos;
    camera[0] = cameraPosition.x;
    camera[1] = cameraPosition.y;
    camera[2] = cameraPosition.z;

    if (this._margin > 0 && this.accurateCulling) {
      this.bvh.frustumCullingLOD(projScreenMatrix.elements, camera, levelsArray, (node, level, frustum, mask) => {
        if (frustum && mask !== undefined && frustum.isIntersectedMargin(node.box, mask, this._margin)) {
          onFrustumIntersection(node, level);
        }
      });
    } else {
      this.bvh.frustumCullingLOD(projScreenMatrix.elements, camera, levelsArray, onFrustumIntersection);
    }
  }

  /** Performs raycasting on the BVH. */
  public raycast(raycaster: Raycaster, onIntersection: OnIntersectionRayCallback<number>): void {
    const ray = raycaster.ray;
    const origin = this._origin;
    const dir = this._dir;

    vec3ToArray(ray.origin, origin);
    vec3ToArray(ray.direction, dir);

    this.bvh.rayIntersections(dir, origin, onIntersection, raycaster.near, raycaster.far);
  }

  /** Checks if a box intersects any instance bounding box. */
  public intersectBox(target: Box3, onIntersection: OnIntersectionCallback<number>): boolean {
    if (!this._boxArray) {
      this._boxArray = new Float32Array(BOX_SIZE);
    }
    const array = this._boxArray;
    box3ToArray(target, array);
    return this.bvh.intersectsBox(array, onIntersection);
  }

  protected getBox(id: number, array: Float32Array): Float32Array {
    if (this._getBoxFromSphere) {
      const matrixArray = this.target.matricesTexture._data as Float32Array;
      const {
        centerX, centerY, centerZ, maxScale,
      } = this.getSphereFromMatrixCenteredGeometry(id, matrixArray, this._sphereTarget!);
      const radius = this._geoBoundingSphere!.radius * maxScale;
      array[0] = centerX - radius;
      array[1] = centerX + radius;
      array[2] = centerY - radius;
      array[3] = centerY + radius;
      array[4] = centerZ - radius;
      array[5] = centerZ + radius;
    } else {
      tempBox3.copy(this.geoBoundingBox).applyMatrix4(this.target.getMatrixAt(id));
      box3ToArray(tempBox3, array);
    }

    return array;
  }

  protected getSphereFromMatrixCenteredGeometry(id: number, array: Float32Array, target: SphereTarget): SphereTarget {
    const offset = id * MATRIX_ELEMENTS;

    const m0 = array[offset + 0];
    const m1 = array[offset + 1];
    const m2 = array[offset + 2];
    const m4 = array[offset + COL1_BASE];
    const m5 = array[offset + COL1_BASE + 1];
    const m6 = array[offset + COL1_BASE + 2];
    const m8 = array[offset + COL2_BASE];
    const m9 = array[offset + COL2_BASE + 1];
    const m10 = array[offset + COL2_BASE + 2];

    const scaleXSq = m0 * m0 + m1 * m1 + m2 * m2;
    const scaleYSq = m4 * m4 + m5 * m5 + m6 * m6;
    const scaleZSq = m8 * m8 + m9 * m9 + m10 * m10;

    target.maxScale = Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));

    target.centerX = array[offset + COL3_BASE];
    target.centerY = array[offset + COL3_BASE + 1];
    target.centerZ = array[offset + COL3_BASE + 2];

    return target;
  }
}
