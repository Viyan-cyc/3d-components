// @ts-nocheck
import { Box3, Matrix4, Raycaster, Sphere, Vector3 } from 'three';
import { BVH, HybridBuilder } from './bvh';
import type { BVHNode, onFrustumIntersectionCallback, onFrustumIntersectionLODCallback, onIntersectionCallback, onIntersectionRayCallback } from './bvh';
import { box3ToArray, vec3ToArray } from './bvh/conversionUtils';
import { WebGLCoordinateSystem } from './bvh/frustum';
import type { LODLevel } from './feature/LOD';
import type { InstancedMesh2 } from './InstancedMesh2';

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
    public bvh: BVH<{}, number>;
    public nodesMap = new Map<number, BVHNode<{}, number>>();
    public accurateCulling: boolean;
    protected LODsMap = new Map<LODLevel[], Float32Array>();
    protected _margin: number;
    protected _origin: Float32Array;
    protected _dir: Float32Array;
    protected _boxArray: Float32Array;
    protected _cameraPos: Float32Array;
    protected _getBoxFromSphere: boolean;
    protected _geoBoundingSphere: Sphere = null;
    protected _sphereTarget: SphereTarget = null;

    constructor(target: InstancedMesh2, margin = 0, getBBoxFromBSphere = false, accurateCulling = true) {
        this.target = target;
        this.accurateCulling = accurateCulling;
        this._margin = margin;

        const geometry = target._geometry;

        if (!geometry.boundingBox) geometry.computeBoundingBox();
        this.geoBoundingBox = geometry.boundingBox;

        if (getBBoxFromBSphere) {
            if (!geometry.boundingSphere) geometry.computeBoundingSphere();

            const center = geometry.boundingSphere.center;
            if (center.x === 0 && center.y === 0 && center.z === 0) {
                this._geoBoundingSphere = geometry.boundingSphere;
                this._sphereTarget = { centerX: 0, centerY: 0, centerZ: 0, maxScale: 0 };
            } else {
                console.warn('"getBoxFromSphere" is ignored because geometry is not centered.');
                getBBoxFromBSphere = false;
            }
        }

        this.bvh = new BVH(new HybridBuilder(), WebGLCoordinateSystem);
        this._origin = new Float32Array(3);
        this._dir = new Float32Array(3);
        this._cameraPos = new Float32Array(3);
        this._getBoxFromSphere = getBBoxFromBSphere;
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
            if (!this.target.getActiveAt(i)) continue;
            boxes[index] = this.getBox(i, new Float32Array(6));
            objects[index] = i;
            index++;
        }

        this.bvh.createFromArray(objects as unknown as number[], boxes, (node) => {
            this.nodesMap.set(node.object, node);
        }, this._margin);
    }

    /** Inserts an instance into the BVH. */
    public insert(id: number): void {
        const node = this.bvh.insert(id, this.getBox(id, new Float32Array(6)), this._margin);
        this.nodesMap.set(id, node);
    }

    /** Inserts a range of instances. */
    public insertRange(ids: number[]): void {
        const count = ids.length;
        const boxes: Float32Array[] = new Array(count);

        for (let i = 0; i < count; i++) {
            boxes[i] = this.getBox(ids[i], new Float32Array(6));
        }

        this.bvh.insertRange(ids, boxes, this._margin, (node) => {
            this.nodesMap.set(node.object, node);
        });
    }

    /** Moves an instance within the BVH (update node.box before calling). */
    public move(id: number): void {
        const node = this.nodesMap.get(id);
        if (!node) return;
        this.getBox(id, node.box as Float32Array);
        this.bvh.move(node, this._margin);
    }

    /** Deletes an instance from the BVH. */
    public delete(id: number): void {
        const node = this.nodesMap.get(id);
        if (!node) return;
        this.bvh.delete(node);
        this.nodesMap.delete(id);
    }

    /** Clears the BVH. */
    public clear(): void {
        this.bvh.clear();
        this.nodesMap.clear();
    }

    /** Performs frustum culling on the BVH. */
    public frustumCulling(projScreenMatrix: Matrix4, onFrustumIntersection: onFrustumIntersectionCallback<{}, number>): void {
        if (this._margin > 0 && this.accurateCulling) {
            this.bvh.frustumCulling(projScreenMatrix.elements, (node, frustum, mask) => {
                if (frustum.isIntersectedMargin(node.box, mask, this._margin)) {
                    onFrustumIntersection(node);
                }
            });
        } else {
            this.bvh.frustumCulling(projScreenMatrix.elements, onFrustumIntersection);
        }
    }

    /** Performs frustum culling with LOD. */
    public frustumCullingLOD(projScreenMatrix: Matrix4, cameraPosition: Vector3, levels: LODLevel[], onFrustumIntersection: onFrustumIntersectionLODCallback<{}, number>): void {
        if (!this.LODsMap.has(levels)) {
            this.LODsMap.set(levels, new Float32Array(levels.length));
        }

        const levelsArray = this.LODsMap.get(levels);
        for (let i = 0; i < levels.length; i++) {
            levelsArray[i] = levels[i].distance;
        }

        const camera = this._cameraPos;
        camera[0] = cameraPosition.x;
        camera[1] = cameraPosition.y;
        camera[2] = cameraPosition.z;

        if (this._margin > 0 && this.accurateCulling) {
            this.bvh.frustumCullingLOD(projScreenMatrix.elements, camera, levelsArray, (node, level, frustum, mask) => {
                if (frustum.isIntersectedMargin(node.box, mask, this._margin)) {
                    onFrustumIntersection(node, level);
                }
            });
        } else {
            this.bvh.frustumCullingLOD(projScreenMatrix.elements, camera, levelsArray, onFrustumIntersection);
        }
    }

    /** Performs raycasting on the BVH. */
    public raycast(raycaster: Raycaster, onIntersection: onIntersectionRayCallback<number>): void {
        const ray = raycaster.ray;
        const origin = this._origin;
        const dir = this._dir;

        vec3ToArray(ray.origin, origin);
        vec3ToArray(ray.direction, dir);

        this.bvh.rayIntersections(dir, origin, onIntersection, raycaster.near, raycaster.far);
    }

    /** Checks if a box intersects any instance bounding box. */
    public intersectBox(target: Box3, onIntersection: onIntersectionCallback<number>): boolean {
        if (!this._boxArray) this._boxArray = new Float32Array(6);
        const array = this._boxArray;
        box3ToArray(target, array);
        return this.bvh.intersectsBox(array, onIntersection);
    }

    protected getBox(id: number, array: Float32Array): Float32Array {
        if (this._getBoxFromSphere) {
            const matrixArray = this.target.matricesTexture._data as Float32Array;
            const { centerX, centerY, centerZ, maxScale } = this.getSphereFromMatrix_centeredGeometry(id, matrixArray, this._sphereTarget);
            const radius = this._geoBoundingSphere.radius * maxScale;
            array[0] = centerX - radius; array[1] = centerX + radius;
            array[2] = centerY - radius; array[3] = centerY + radius;
            array[4] = centerZ - radius; array[5] = centerZ + radius;
        } else {
            _box3.copy(this.geoBoundingBox).applyMatrix4(this.target.getMatrixAt(id));
            box3ToArray(_box3, array);
        }

        return array;
    }

    protected getSphereFromMatrix_centeredGeometry(id: number, array: Float32Array, target: SphereTarget): SphereTarget {
        const offset = id * 16;

        const m0 = array[offset + 0]; const m1 = array[offset + 1]; const m2 = array[offset + 2];
        const m4 = array[offset + 4]; const m5 = array[offset + 5]; const m6 = array[offset + 6];
        const m8 = array[offset + 8]; const m9 = array[offset + 9]; const m10 = array[offset + 10];

        const scaleXSq = m0 * m0 + m1 * m1 + m2 * m2;
        const scaleYSq = m4 * m4 + m5 * m5 + m6 * m6;
        const scaleZSq = m8 * m8 + m9 * m9 + m10 * m10;

        target.maxScale = Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));

        target.centerX = array[offset + 12];
        target.centerY = array[offset + 13];
        target.centerZ = array[offset + 14];

        return target;
    }
}

const _box3 = new Box3();
