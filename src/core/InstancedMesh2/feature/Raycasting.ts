// @ts-nocheck
/**
 * @internal Raycasting feature module.
 */

import { Matrix4, Mesh, Ray, Raycaster, Sphere, Vector3 } from 'three';
import type { Intersection } from 'three';
import type { InstancedMesh2 } from '../InstancedMesh2';

const _intersections: Intersection[] = [];
const _mesh = new Mesh();
const _ray = new Ray();
const _direction = new Vector3();
const _worldScale = new Vector3();
const _invMatrixWorld = new Matrix4();
const _sphere = new Sphere();

export function raycast(this: InstancedMesh2, raycaster: Raycaster, result: Intersection[]): void {
    if (this._parentLOD || !this.material || this._instancesArrayCount === 0 || !this.instanceIndex) return;

    _mesh.geometry = this._geometry;
    _mesh.material = this.material;

    const originalRay = raycaster.ray;
    const originalNear = raycaster.near;
    const originalFar = raycaster.far;

    _invMatrixWorld.copy(this.matrixWorld).invert();

    _worldScale.setFromMatrixScale(this.matrixWorld);
    _direction.copy(raycaster.ray.direction).multiply(_worldScale);
    const scaleFactor = _direction.length();

    raycaster.ray = _ray.copy(raycaster.ray).applyMatrix4(_invMatrixWorld);
    raycaster.near /= scaleFactor;
    raycaster.far /= scaleFactor;

    raycastInstances.call(this, raycaster, result);

    raycaster.ray = originalRay;
    raycaster.near = originalNear;
    raycaster.far = originalFar;
}

function raycastInstances(this: InstancedMesh2, raycaster: Raycaster, result: Intersection[]): void {
    if (this.bvh) {
        this.bvh.raycast(raycaster, (instanceId) => checkObjectIntersection.call(this, raycaster, instanceId, result));
    } else {
        if (this.boundingSphere === null) this.computeBoundingSphere();
        _sphere.copy(this.boundingSphere);
        if (!raycaster.ray.intersectsSphere(_sphere)) return;

        const instancesToCheck = this.instanceIndex.array;
        const raycastFrustum = this.raycastOnlyFrustum && this._perObjectFrustumCulled;
        const checkCount = raycastFrustum ? this.count : this._instancesArrayCount;

        for (let i = 0; i < checkCount; i++) {
            checkObjectIntersection.call(this, raycaster, instancesToCheck[i], result);
        }
    }
}

function checkObjectIntersection(this: InstancedMesh2, raycaster: Raycaster, objectIndex: number, result: Intersection[]): void {
    if (objectIndex > this._instancesArrayCount || !this.getActiveAndVisibilityAt(objectIndex)) return;

    this.getMatrixAt(objectIndex, _mesh.matrixWorld);

    _mesh.raycast(raycaster, _intersections);

    for (const intersect of _intersections) {
        intersect.instanceId = objectIndex;
        intersect.object = this;
        result.push(intersect);
    }

    _intersections.length = 0;
}
