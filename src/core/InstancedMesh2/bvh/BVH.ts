/**
 * @internal Main BVH class - inlined from bvh.js.
 * Provides spatial queries: frustum culling, raycasting, box/sphere intersection.
 */

import type { BVHNode, FloatArray } from './BVHNode';
import type { IBVHBuilder, OnLeafCreationCallback } from './HybridBuilder';
import { minDistanceSqPointToBox, minMaxDistanceSqPointToBox } from './boxUtils';

import { type CoordinateSystem, Frustum, WebGLCoordinateSystem } from './frustum';
import { intersectBoxBox, intersectRayBox, intersectSphereBox } from './intersectUtils';

export type OnTraverseCallback<N, L> = (node: BVHNode<N, L>, depth: number) => boolean;
export type OnIntersectionCallback<L> = (obj: L) => boolean;
export type OnClosestDistanceCallback<L> = (obj: L) => number;
export type OnIntersectionRayCallback<L> = (obj: L) => void;
export type OnFrustumIntersectionCallback<N, L> = (
  node: BVHNode<N, L>, frustum?: Frustum, mask?: number,
) => void;
export type OnFrustumIntersectionLODCallback<N, L> = (
  node: BVHNode<N, L>, level: number, frustum?: Frustum, mask?: number,
) => void;

const DIR_INV_COMPONENTS = 3;
const ALL_PLANES_MASK = 0b111111;

/* ---- standalone helpers (defined before use) ---- */

const traverseNode = function <N, L>(
  node: BVHNode<N, L>, depth: number,
  callback: OnTraverseCallback<N, L>,
): void {
  if (node.object !== undefined) {
    callback(node, depth);
    return;
  }

  const stopTraversal = callback(node, depth);
  if (!stopTraversal) {
    traverseNode(node.left, depth + 1, callback);
    traverseNode(node.right, depth + 1, callback);
  }
};

interface RayOpts<N, L> {
  node: BVHNode<N, L>;
  origin: FloatArray;
  dirInv: FloatArray;
  sign: Uint8Array;
  near: number;
  far: number;
  onIntersection: OnIntersectionCallback<L>;
}

interface RayIntersectionsOpts<N, L> {
  node: BVHNode<N, L>;
  origin: FloatArray;
  dirInv: FloatArray;
  sign: Uint8Array;
  near: number;
  far: number;
  onIntersection: OnIntersectionRayCallback<L>;
}

const checkRayIntersection = function <N, L>(opts: RayOpts<N, L>): boolean {
  if (!intersectRayBox({
    box: opts.node.box,
    origins: opts.origin,
    dirsInv: opts.dirInv,
    signs: opts.sign,
    near: opts.near,
    far: opts.far,
  })) {
    return false;
  }
  if (opts.node.object !== undefined) {
    return opts.onIntersection(opts.node.object);
  }
  return checkRayIntersection<N, L>({ ...opts, node: opts.node.left })
    || checkRayIntersection<N, L>({ ...opts, node: opts.node.right });
};

interface BoxIntersectionOpts<N, L> {
  node: BVHNode<N, L>;
  box: FloatArray;
  onIntersection: OnIntersectionCallback<L>;
}

const checkBoxIntersection = function <N, L>(opts: BoxIntersectionOpts<N, L>): boolean {
  if (!intersectBoxBox(opts.box, opts.node.box)) {
    return false;
  }
  if (opts.node.object !== undefined) {
    return opts.onIntersection(opts.node.object);
  }
  return checkBoxIntersection<N, L>({ ...opts, node: opts.node.left })
    || checkBoxIntersection<N, L>({ ...opts, node: opts.node.right });
};

interface SphereIntersectionOpts<N, L> {
  node: BVHNode<N, L>;
  center: FloatArray;
  radius: number;
  onIntersection: OnIntersectionCallback<L>;
}

const checkSphereIntersection = function <N, L>(opts: SphereIntersectionOpts<N, L>): boolean {
  if (!intersectSphereBox(opts.center, opts.radius, opts.node.box)) {
    return false;
  }
  if (opts.node.object !== undefined) {
    return opts.onIntersection(opts.node.object);
  }
  return checkSphereIntersection<N, L>({ ...opts, node: opts.node.left })
    || checkSphereIntersection<N, L>({ ...opts, node: opts.node.right });
};

const collectRayIntersections = function <N, L>(opts: RayIntersectionsOpts<N, L>): void {
  if (!intersectRayBox({
    box: opts.node.box,
    origins: opts.origin,
    dirsInv: opts.dirInv,
    signs: opts.sign,
    near: opts.near,
    far: opts.far,
  })) {
    return;
  }

  if (opts.node.object !== undefined) {
    opts.onIntersection(opts.node.object);
    return;
  }

  collectRayIntersections<N, L>({ ...opts, node: opts.node.left });
  collectRayIntersections<N, L>({ ...opts, node: opts.node.right });
};

interface FrustumCullOpts<N, L> {
  node: BVHNode<N, L>;
  frustum: Frustum;
  onIntersection: OnFrustumIntersectionCallback<N, L>;
}

const showAllDescendants = function <N, L>(opts: FrustumCullOpts<N, L>): void {
  if (opts.node.object !== undefined) {
    opts.onIntersection(opts.node, opts.frustum, 0);
    return;
  }
  showAllDescendants<N, L>({ ...opts, node: opts.node.left });
  showAllDescendants<N, L>({ ...opts, node: opts.node.right });
};

const frustumCullNode = function <N, L>(node: BVHNode<N, L>, mask: number, opts: FrustumCullOpts<N, L>): void {
  if (node.object !== undefined) {
    if (opts.frustum.isIntersected(node.box, mask)) {
      opts.onIntersection(node, opts.frustum, mask);
    }
    return;
  }

  let currentMask = opts.frustum.intersectsBoxMask(node.box, mask);

  if (currentMask < 0) {
    return;
  }

  if (currentMask === 0) {
    showAllDescendants<N, L>({ ...opts, node: node.left });
    showAllDescendants<N, L>({ ...opts, node: node.right });
    return;
  }

  frustumCullNode(node.left, currentMask, opts);
  frustumCullNode(node.right, currentMask, opts);
};

const getLODLevel = function (nodeBox: FloatArray, cameraPosition: FloatArray, levels: FloatArray): number {
  const { min, max } = minMaxDistanceSqPointToBox(nodeBox, cameraPosition);

  for (let i = levels.length - 1; i > 0; i--) {
    if (max >= levels[i]) {
      return min >= levels[i] ? i : null;
    }
  }

  return 0;
};

interface LODCullOpts<N, L> {
  node: BVHNode<N, L>;
  mask: number;
  level: number | null;
  frustum: Frustum;
  cameraPosition: FloatArray;
  levels: FloatArray;
  onIntersection: OnFrustumIntersectionLODCallback<N, L>;
}

const showAllDescendantsLOD = function <N, L>(opts: LODCullOpts<N, L>): void {
  const currentLevel = opts.level
    ?? getLODLevel(opts.node.box, opts.cameraPosition, opts.levels);

  if (opts.node.object !== undefined) {
    opts.onIntersection(opts.node, currentLevel, opts.frustum, 0);
    return;
  }
  showAllDescendantsLOD<N, L>({
    ...opts,
    node: opts.node.left,
    level: currentLevel,
  });
  showAllDescendantsLOD<N, L>({
    ...opts,
    node: opts.node.right,
    level: currentLevel,
  });
};

const frustumCullLODNode = function <N, L>(opts: LODCullOpts<N, L>): void {
  const nodeBox = opts.node.box;
  const currentLevel = opts.level
    ?? getLODLevel(nodeBox, opts.cameraPosition, opts.levels);

  if (opts.node.object !== undefined) {
    if (opts.frustum.isIntersected(nodeBox, opts.mask)) {
      opts.onIntersection(opts.node, currentLevel, opts.frustum, opts.mask);
    }
    return;
  }

  let currentMask = opts.frustum.intersectsBoxMask(nodeBox, opts.mask);

  if (currentMask < 0) {
    return;
  }

  if (currentMask === 0) {
    showAllDescendantsLOD<N, L>({
      ...opts,
      node: opts.node.left,
      level: currentLevel,
    });
    showAllDescendantsLOD<N, L>({
      ...opts,
      node: opts.node.right,
      level: currentLevel,
    });
    return;
  }

  frustumCullLODNode<N, L>({
    ...opts,
    node: opts.node.left,
    mask: currentMask,
    level: currentLevel,
  });
  frustumCullLODNode<N, L>({
    ...opts,
    node: opts.node.right,
    mask: currentMask,
    level: currentLevel,
  });
};

interface ClosestPointOpts<N, L> {
  node: BVHNode<N, L>;
  point: FloatArray;
  bestDist: number;
  onClosestDistance: OnClosestDistanceCallback<L> | undefined;
  updateBest: (v: number) => void;
}

const findClosestPoint = function <N, L>(opts: ClosestPointOpts<N, L>): void {
  let best = opts.bestDist;

  if (opts.node.object !== undefined) {
    if (opts.onClosestDistance) {
      const distance = opts.onClosestDistance(opts.node.object)
        ?? minDistanceSqPointToBox(opts.node.box, opts.point);
      if (distance < best) {
        best = distance;
        opts.updateBest(best);
      }
    } else {
      best = minDistanceSqPointToBox(opts.node.box, opts.point);
      opts.updateBest(best);
    }
    return;
  }

  const leftDistance = minDistanceSqPointToBox(opts.node.left.box, opts.point);
  const rightDistance = minDistanceSqPointToBox(opts.node.right.box, opts.point);

  if (leftDistance < rightDistance) {
    if (leftDistance < best) {
      findClosestPoint<N, L>({ ...opts, node: opts.node.left, bestDist: best });
    }
    if (rightDistance < best) {
      findClosestPoint<N, L>({ ...opts, node: opts.node.right, bestDist: best });
    }
  } else if (rightDistance < best) {
    findClosestPoint<N, L>({ ...opts, node: opts.node.right, bestDist: best });
    if (leftDistance < best) {
      findClosestPoint<N, L>({ ...opts, node: opts.node.left, bestDist: best });
    }
  }
};

/* ---- main class ---- */

export class BVH<N, L> {
  public builder: IBVHBuilder<N, L>;
  public frustum: Frustum;
  protected dirInv: FloatArray;
  protected sign = new Uint8Array(DIR_INV_COMPONENTS);

  public get root(): BVHNode<N, L> | null {
    return this.builder.root;
  }

  constructor(
    builder: IBVHBuilder<N, L>,
    coordinateSystem: CoordinateSystem = WebGLCoordinateSystem,
  ) {
    this.builder = builder;
    const highPrecision = builder.highPrecision;
    this.frustum = new Frustum(highPrecision, coordinateSystem);
    this.dirInv = highPrecision
      ? new Float64Array(DIR_INV_COMPONENTS)
      : new Float32Array(DIR_INV_COMPONENTS);
  }

  public createFromArray(
    objects: L[], boxes: FloatArray[],
    onLeafCreation?: OnLeafCreationCallback<N, L>, margin?: number,
  ): void {
    if (objects?.length > 0) {
      this.builder.createFromArray(objects, boxes, onLeafCreation, margin);
    }
  }

  public insert(object: L, box: FloatArray, margin: number): BVHNode<N, L> {
    return this.builder.insert(object, box, margin);
  }

  public insertRange(
    objects: L[], boxes: FloatArray[],
    margins?: number | FloatArray | number[],
    onLeafCreation?: OnLeafCreationCallback<N, L>,
  ): void {
    if (objects?.length > 0) {
      this.builder.insertRange(objects, boxes, margins, onLeafCreation);
    }
  }

  public move(node: BVHNode<N, L>, margin: number): void {
    this.builder.move(node, margin);
  }

  public delete(node: BVHNode<N, L>): BVHNode<N, L> | null {
    return this.builder.delete(node);
  }

  public clear(): void {
    this.builder.clear();
  }

  public traverse(callback: OnTraverseCallback<N, L>): void {
    if (this.root === null) {
      return;
    }
    traverseNode(this.root, 0, callback);
  }

  public intersectsRay(
    dir: FloatArray, origin: FloatArray,
    onIntersection: OnIntersectionCallback<L>,
    near = 0, far = Infinity,
  ): boolean {
    if (this.root === null) {
      return false;
    }

    const dirInv = this.dirInv;
    const sign = this.sign;

    dirInv[0] = 1 / dir[0];
    dirInv[1] = 1 / dir[1];
    dirInv[2] = 1 / dir[2];
    sign[0] = dirInv[0] < 0 ? 1 : 0;
    sign[1] = dirInv[1] < 0 ? 1 : 0;
    sign[2] = dirInv[2] < 0 ? 1 : 0;

    return checkRayIntersection({
      node: this.root, origin, dirInv, sign, near, far, onIntersection,
    });
  }

  public intersectsBox(box: FloatArray, onIntersection: OnIntersectionCallback<L>): boolean {
    if (this.root === null) {
      return false;
    }
    return checkBoxIntersection({ node: this.root, box, onIntersection });
  }

  public intersectsSphere(
    center: FloatArray, radius: number,
    onIntersection: OnIntersectionCallback<L>,
  ): boolean {
    if (this.root === null) {
      return false;
    }
    return checkSphereIntersection({
      node: this.root, center, radius, onIntersection,
    });
  }

  public rayIntersections(
    dir: FloatArray, origin: FloatArray,
    onIntersection: OnIntersectionRayCallback<L>,
    near = 0, far = Infinity,
  ): void {
    if (this.root === null) {
      return;
    }

    const dirInv = this.dirInv;
    const sign = this.sign;

    dirInv[0] = 1 / dir[0];
    dirInv[1] = 1 / dir[1];
    dirInv[2] = 1 / dir[2];
    sign[0] = dirInv[0] < 0 ? 1 : 0;
    sign[1] = dirInv[1] < 0 ? 1 : 0;
    sign[2] = dirInv[2] < 0 ? 1 : 0;

    collectRayIntersections({
      node: this.root, origin, dirInv, sign, near, far, onIntersection,
    });
  }

  public frustumCulling(
    projectionMatrix: FloatArray | number[],
    onIntersection: OnFrustumIntersectionCallback<N, L>,
  ): void {
    if (this.root === null) {
      return;
    }

    const frustum = this.frustum.setFromProjectionMatrix(projectionMatrix);
    frustumCullNode(this.root, ALL_PLANES_MASK, { frustum, onIntersection, node: this.root });
  }

  public frustumCullingLOD(
    projectionMatrix: FloatArray | number[],
    cameraPosition: FloatArray, levels: FloatArray,
    onIntersection: OnFrustumIntersectionLODCallback<N, L>,
  ): void {
    if (this.root === null) {
      return;
    }

    const frustum = this.frustum.setFromProjectionMatrix(projectionMatrix);
    frustumCullLODNode({
      node: this.root,
      mask: ALL_PLANES_MASK,
      level: null,
      frustum,
      cameraPosition,
      levels,
      onIntersection,
    });
  }

  public closestPointToPoint(
    point: FloatArray,
    onClosestDistance?: OnClosestDistanceCallback<L>,
  ): number {
    if (this.root === null) {
      return undefined;
    }

    let bestDistance = Infinity;
    findClosestPoint({
      node: this.root,
      point,
      bestDist: bestDistance,
      onClosestDistance,
      updateBest: (updated) => {
        bestDistance = updated;
      },
    });

    return Math.sqrt(bestDistance);
  }
}
