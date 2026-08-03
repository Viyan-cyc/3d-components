/**
 * @internal Raycasting feature module.
 */

import {
  type BufferGeometry,
  type Intersection,
  type Material,
  Matrix4,
  Mesh,
  type Object3DEventMap,
  Ray,
  type Raycaster,
  Sphere,
  Vector3,
} from 'three';
import type { InstancedMesh2 } from '../InstancedMesh2';

const intersectionsLocal: Intersection[] = [];
const meshLocal = new Mesh();
const rayLocal = new Ray();
const directionLocal = new Vector3();
const worldScaleLocal = new Vector3();
const invMatrixWorldLocal = new Matrix4();
const sphereLocal = new Sphere();

const checkObjectIntersection = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  raycaster: Raycaster,
  objectIndex: number,
  result: Intersection[],
): void {
  if (
    objectIndex > this._instancesArrayCount
    || !this.getActiveAndVisibilityAt(objectIndex)
  ) {
    return;
  }

  this.getMatrixAt(objectIndex, meshLocal.matrixWorld);
  meshLocal.raycast(raycaster, intersectionsLocal);

  for (const intersect of intersectionsLocal) {
    intersect.instanceId = objectIndex;
    intersect.object = this;
    result.push(intersect);
  }

  intersectionsLocal.length = 0;
};

const raycastInstances = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  raycaster: Raycaster,
  result: Intersection[],
): void {
  if (this.bvh) {
    this.bvh.raycast(raycaster, (instanceId: number) => {
      checkObjectIntersection.call(this, raycaster, instanceId, result);
    });
  } else {
    if (this.boundingSphere === null) {
      this.computeBoundingSphere();
    }
    sphereLocal.copy(this.boundingSphere!);
    if (!raycaster.ray.intersectsSphere(sphereLocal)) {
      return;
    }

    const instancesToCheck = this.instanceIndex!.array;
    const raycastFrustum = this.raycastOnlyFrustum
      && this._perObjectFrustumCulled;
    const checkCount = raycastFrustum
      ? this.count
      : this._instancesArrayCount;

    for (let i = 0; i < checkCount; i++) {
      checkObjectIntersection.call(this, raycaster, instancesToCheck[i], result);
    }
  }
};

export const raycast = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  raycaster: Raycaster,
  result: Intersection[],
): void {
  if (
    this._parentLOD
    || !this.material
    || this._instancesArrayCount === 0
    || !this.instanceIndex
  ) {
    return;
  }

  meshLocal.geometry = this._geometry;
  meshLocal.material = this.material;

  const originalRay = raycaster.ray;
  const originalNear = raycaster.near;
  const originalFar = raycaster.far;

  invMatrixWorldLocal.copy(this.matrixWorld).invert();

  worldScaleLocal.setFromMatrixScale(this.matrixWorld);
  directionLocal.copy(raycaster.ray.direction).multiply(worldScaleLocal);
  const scaleFactor = directionLocal.length();

  raycaster.ray = rayLocal.copy(raycaster.ray).applyMatrix4(invMatrixWorldLocal);
  raycaster.near /= scaleFactor;
  raycaster.far /= scaleFactor;

  raycastInstances.call(this, raycaster, result);

  raycaster.ray = originalRay;
  raycaster.near = originalNear;
  raycaster.far = originalFar;
};
