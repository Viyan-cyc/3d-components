/**
 * @internal Hybrid BVH builder - inlined from bvh.js.
 * Combines top-down bulk construction with incremental insertion (SAH-based).
 */

import type { BVHNode, FloatArray, FloatArrayType } from './BVHNode';
import {
  areaBox, areaFromTwoBoxes, expandBoxByMargin, getLongestAxis,
  isBoxInsideBox, isExpanded, unionBox, unionBoxChanged,
} from './boxUtils';
import { SortedListPriority } from './sortedListPriority';

export type OnLeafCreationCallback<N, L> = (node: BVHNode<N, L>) => void;

export interface IBVHBuilder<N, L> {
  root: BVHNode<N, L> | null;
  createFromArray(
    objects: L[], boxes: FloatArray[],
    onLeafCreation?: OnLeafCreationCallback<N, L>, margin?: number,
  ): void;
  insert(object: L, box: FloatArray, margin: number): BVHNode<N, L>;
  insertRange(
    objects: L[], boxes: FloatArray[],
    margins?: number | FloatArray | number[],
    onLeafCreation?: OnLeafCreationCallback<N, L>,
  ): void;
  move(node: BVHNode<N, L>, margin: number): void;
  delete(node: BVHNode<N, L>): BVHNode<N, L> | null;
  clear(): void;
  readonly highPrecision: boolean;
}

const BYTES_PER_ELEMENT_32 = 4;
const BOX_COMPONENTS = 6;
const CENTROID_COMPONENTS = 6;
const SPLIT_AXIS_MULTIPLIER = 2;
const HALF = 0.5;

/* ---- createFromArray helpers ---- */

interface BuildContext<N, L> {
  objects: L[];
  boxes: FloatArray[];
  onLeafCreation?: OnLeafCreationCallback<N, L>;
  margin: number;
  typeArray: FloatArrayType;
  centroid: FloatArray;
  axis: number;
  position: number;
}

const buildLeafNode = function <N, L>(
  ctx: BuildContext<N, L>,
  offset: number, parent: BVHNode<N, L> | null,
): BVHNode<N, L> {
  const box = ctx.boxes[offset];
  if (ctx.margin > 0) {
    expandBoxByMargin(box, ctx.margin);
  }
  const node = {
    box,
    object: ctx.objects[offset],
    parent,
  } as BVHNode<N, L>;
  node.left = null;
  node.right = null;
  if (ctx.onLeafCreation) {
    ctx.onLeafCreation(node);
  }
  return node;
};

const initBoxBounds = function (box: FloatArray): void {
  box[0] = Infinity; box[1] = -Infinity;
  box[2] = Infinity; box[3] = -Infinity;
  box[4] = Infinity; box[5] = -Infinity;
};

const updateBoxFromEntry = function (box: FloatArray, entry: FloatArray): void {
  if (box[0] > entry[0]) {
    box[0] = entry[0];
  }
  if (box[1] < entry[1]) {
    box[1] = entry[1];
  }
  if (box[2] > entry[2]) {
    box[2] = entry[2];
  }
  if (box[3] < entry[3]) {
    box[3] = entry[3];
  }
  if (box[4] > entry[4]) {
    box[4] = entry[4];
  }
  if (box[5] < entry[5]) {
    box[5] = entry[5];
  }
};

const updateCentroidFromEntry = function (centroid: FloatArray, entry: FloatArray): void {
  const xCenter = (entry[1] + entry[0]) * HALF;
  const yCenter = (entry[3] + entry[2]) * HALF;
  const zCenter = (entry[5] + entry[4]) * HALF;

  if (centroid[0] > xCenter) {
    centroid[0] = xCenter;
  }
  if (centroid[1] < xCenter) {
    centroid[1] = xCenter;
  }
  if (centroid[2] > yCenter) {
    centroid[2] = yCenter;
  }
  if (centroid[3] < yCenter) {
    centroid[3] = yCenter;
  }
  if (centroid[4] > zCenter) {
    centroid[4] = zCenter;
  }
  if (centroid[5] < zCenter) {
    centroid[5] = zCenter;
  }
};

const applyMargin = function (box: FloatArray, margin: number): void {
  box[0] -= margin; box[1] += margin;
  box[2] -= margin; box[3] += margin;
  box[4] -= margin; box[5] += margin;
};

const computeBoxCentroid = function <N, L>(
  ctx: BuildContext<N, L>,
  offset: number, count: number,
): FloatArray {
  // eslint-disable-next-line new-cap
  const box = new ctx.typeArray(BOX_COMPONENTS) as FloatArray;
  const end = offset + count;

  initBoxBounds(box);
  initBoxBounds(ctx.centroid);

  for (let i = offset; i < end; i++) {
    const boxToCheck = ctx.boxes[i];
    updateBoxFromEntry(box, boxToCheck);
    updateCentroidFromEntry(ctx.centroid, boxToCheck);
  }

  applyMargin(box, ctx.margin);

  return box;
};

const updateSplitData = function <N, L>(ctx: BuildContext<N, L>): void {
  ctx.axis = getLongestAxis(ctx.centroid) * SPLIT_AXIS_MULTIPLIER;
  ctx.position = (ctx.centroid[ctx.axis] + ctx.centroid[ctx.axis + 1]) * HALF;
};

const findSwapTarget = function <N, L>(
  ctx: BuildContext<N, L>,
  left: number, startRight: number,
): { newRight: number; found: boolean } {
  let right = startRight;
  while (true) {
    const boxRight = ctx.boxes[right];
    const midRight = (boxRight[ctx.axis + 1] + boxRight[ctx.axis]) * HALF;
    if (midRight < ctx.position) {
      const tempObject = ctx.objects[left];
      ctx.objects[left] = ctx.objects[right];
      ctx.objects[right] = tempObject;

      const tempBox = ctx.boxes[left];
      ctx.boxes[left] = ctx.boxes[right];
      ctx.boxes[right] = tempBox;

      return { newRight: right - 1, found: true };
    }
    right--;
    if (right <= left) {
      return { newRight: right, found: false };
    }
  }
};

const split = function <N, L>(
  ctx: BuildContext<N, L>,
  offset: number, count: number,
): number {
  let left = offset;
  let right = offset + count - 1;

  while (left <= right) {
    const boxLeft = ctx.boxes[left];
    const midLeft = (boxLeft[ctx.axis + 1] + boxLeft[ctx.axis]) * HALF;
    if (midLeft >= ctx.position) {
      const result = findSwapTarget(ctx, left, right);
      if (result.found) {
        right = result.newRight;
      } else {
        return left;
      }
    }
    left++;
  }
  return left;
};

const buildNode = function <N, L>(
  ctx: BuildContext<N, L>,
  offset: number, count: number,
  parent: BVHNode<N, L> | null,
): BVHNode<N, L> {
  if (count === 1) {
    return buildLeafNode(ctx, offset, parent);
  }

  const box = computeBoxCentroid(ctx, offset, count);
  updateSplitData(ctx);

  let leftEndOffset = split(ctx, offset, count);

  if (leftEndOffset === offset || leftEndOffset === offset + count) {
    leftEndOffset = offset + (count >> 1);
  }

  const node = {
    box,
    parent,
    left: null,
    right: null,
  } as BVHNode<N, L>;
  node.left = buildNode(ctx, offset, leftEndOffset - offset, node);
  node.right = buildNode(ctx, leftEndOffset, count - leftEndOffset + offset, node);
  return node;
};

/* ---- findBestSibling helpers ---- */

interface SiblingSearchState<N, L> {
  leafBox: FloatArray;
  bestNode: BVHNode<N, L>;
  bestCost: number;
  leafArea: number;
  sortedList: SortedListPriority<N, L>;
}

interface ChildCosts {
  costL: number;
  inheritedCostL: number;
  costR: number;
  inheritedCostR: number;
}

const evaluateChildCosts = function <N, L>(
  nodeL: BVHNode<N, L>, nodeR: BVHNode<N, L>,
  inheritedCost: number, leafBox: FloatArray,
): ChildCosts {
  const directCostL = areaFromTwoBoxes(leafBox, nodeL.box);
  const currentCostL = directCostL + inheritedCost;
  const inheritedCostL = currentCostL - areaBox(nodeL.box);

  const directCostR = areaFromTwoBoxes(leafBox, nodeR.box);
  const currentCostR = directCostR + inheritedCost;
  const inheritedCostR = currentCostR - areaBox(nodeR.box);

  return {
    costL: currentCostL,
    inheritedCostL,
    costR: currentCostR,
    inheritedCostR,
  };
};

interface EnqueueOpts<N, L> {
  state: SiblingSearchState<N, L>;
  node: BVHNode<N, L>;
  cost: number;
  inheritedCost: number;
}

const tryEnqueue = function <N, L>(opts: EnqueueOpts<N, L>): void {
  if (opts.state.leafArea + opts.inheritedCost >= opts.state.bestCost) {
    return;
  }
  if (opts.node.object === undefined) {
    opts.state.sortedList.push({
      node: opts.node,
      inheritedCost: opts.inheritedCost,
    });
  }
};

const updateBestAndEnqueue = function <N, L>(
  state: SiblingSearchState<N, L>,
  primary: EnqueueOpts<N, L>,
  secondary: EnqueueOpts<N, L>,
): void {
  if (state.bestCost > primary.cost) {
    state.bestNode = primary.node;
    state.bestCost = primary.cost;
  }
  tryEnqueue<N, L>({
    state, node: primary.node, cost: primary.cost, inheritedCost: primary.inheritedCost,
  });
  tryEnqueue<N, L>({
    state, node: secondary.node, cost: secondary.cost, inheritedCost: secondary.inheritedCost,
  });
};

type UpdateBestFn<N, L> = (
  state: SiblingSearchState<N, L>,
  nodeL: BVHNode<N, L>, costL: number,
  nodeR: BVHNode<N, L>, costR: number,
) => void;

const enqueueBothSides = function <N, L>(
  state: SiblingSearchState<N, L>,
  primary: BVHNode<N, L>, costs: ChildCosts,
  secondary: BVHNode<N, L>,
): void {
  const isPrimaryL = primary === primary.parent?.left;
  const primaryCost = isPrimaryL ? costs.costL : costs.costR;
  const primaryInh = isPrimaryL ? costs.inheritedCostL : costs.inheritedCostR;
  const secondaryCost = isPrimaryL ? costs.costR : costs.costL;
  const secondaryInh = isPrimaryL ? costs.inheritedCostR : costs.inheritedCostL;

  updateBestAndEnqueue(
    state,
    {
      state, node: primary, cost: primaryCost, inheritedCost: primaryInh,
    },
    {
      state, node: secondary, cost: secondaryCost, inheritedCost: secondaryInh,
    },
  );
};

const processNodeInSearch = function <N, L>(
  state: SiblingSearchState<N, L>,
  node: BVHNode<N, L>,
  inheritedCost: number,
  updateBest: UpdateBestFn<N, L>,
): void {
  if (state.leafArea + inheritedCost >= state.bestCost) {
    return;
  }

  const nodeL = node.left;
  const nodeR = node.right;
  const costs = evaluateChildCosts(nodeL, nodeR, inheritedCost, state.leafBox);

  updateBest(state, nodeL, costs.costL, nodeR, costs.costR);

  if (costs.inheritedCostR > costs.inheritedCostL) {
    enqueueBothSides(state, nodeL, costs, nodeR);
  } else {
    enqueueBothSides(state, nodeR, costs, nodeL);
  }
};

/* ---- refitAndRotate helpers ---- */

interface RotationResult<N, L> {
  nodeSwap1: BVHNode<N, L> | null;
  nodeSwap2: BVHNode<N, L> | null;
  bestCost: number;
}

const evaluateRightRotations = function <N, L>(left: BVHNode<N, L>, right: BVHNode<N, L>): RotationResult<N, L> {
  let nodeSwap1: BVHNode<N, L> | null = null;
  let nodeSwap2: BVHNode<N, L> | null = null;
  let bestCost = 0;

  if (right.object === undefined) {
    const RL = right.left;
    const RR = right.right;
    const rightArea = areaBox(right.box);
    const diffRR = rightArea - areaFromTwoBoxes(left.box, RL.box);
    const diffRL = rightArea - areaFromTwoBoxes(left.box, RR.box);

    if (diffRR > diffRL) {
      if (diffRR > 0) {
        nodeSwap1 = left; nodeSwap2 = RR; bestCost = diffRR;
      }
    } else if (diffRL > 0) {
      nodeSwap1 = left; nodeSwap2 = RL; bestCost = diffRL;
    }
  }

  return { nodeSwap1, nodeSwap2, bestCost };
};

const evaluateLeftRotations = function <N, L>(
  left: BVHNode<N, L>, right: BVHNode<N, L>,
  currentBest: number,
): RotationResult<N, L> {
  let nodeSwap1: BVHNode<N, L> | null = null;
  let nodeSwap2: BVHNode<N, L> | null = null;

  if (left.object === undefined) {
    const LL = left.left;
    const LR = left.right;
    const leftArea = areaBox(left.box);
    const diffLR = leftArea - areaFromTwoBoxes(right.box, LL.box);
    const diffLL = leftArea - areaFromTwoBoxes(right.box, LR.box);

    if (diffLR > diffLL) {
      if (diffLR > currentBest) {
        nodeSwap1 = right; nodeSwap2 = LR;
      }
    } else if (diffLL > currentBest) {
      nodeSwap1 = right; nodeSwap2 = LL;
    }
  }

  return { nodeSwap1, nodeSwap2, bestCost: currentBest };
};

/* ---- main class ---- */

export class HybridBuilder<N = Record<string, never>, L = Record<string, never>> implements IBVHBuilder<N, L> {
  public root: BVHNode<N, L> | null = null;
  public readonly highPrecision: boolean;
  protected sortedList = new SortedListPriority<N, L>();
  protected typeArray: FloatArrayType;
  protected count = 0;

  constructor(highPrecision = false) {
    this.highPrecision = highPrecision;
    this.typeArray = highPrecision ? Float64Array : Float32Array;
  }

  public createFromArray(
    objects: L[], boxes: FloatArray[],
    onLeafCreation?: OnLeafCreationCallback<N, L>, margin = 0,
  ): void {
    const maxCount = boxes.length;
    const typeArray = this.typeArray;

    if (typeArray !== (boxes[0].BYTES_PER_ELEMENT === BYTES_PER_ELEMENT_32 ? Float32Array : Float64Array)) {

      console.warn('Different precision.');
    }
    // eslint-disable-next-line new-cap
    const centroid = new typeArray(CENTROID_COMPONENTS) as FloatArray;

    const ctx: BuildContext<N, L> = {
      objects,
      boxes,
      onLeafCreation,
      margin,
      typeArray,
      centroid,
      axis: 0,
      position: 0,
    };

    this.root = buildNode(ctx, 0, maxCount, null);
  }

  public insert(object: L, box: FloatArray, margin: number): BVHNode<N, L> {
    if (margin > 0) {
      expandBoxByMargin(box, margin);
    }
    const leaf = this.createLeafNode(object, box);

    if (this.root === null) {
      this.root = leaf;
    } else {
      this.insertLeaf(leaf);
    }

    this.count++;
    return leaf;
  }

  public insertRange(
    objects: L[], boxes: FloatArray[],
    margins?: number | FloatArray | number[],
    onLeafCreation?: OnLeafCreationCallback<N, L>,
  ): void {
    const count = objects.length;
    const margin = typeof margins === 'number' ? margins : 0;

    for (let i = 0; i < count; i++) {
      const m = Array.isArray(margins) ? margins[i] : margin;
      const node = this.insert(objects[i], boxes[i], m);
      if (onLeafCreation) {
        onLeafCreation(node);
      }
    }
  }

  public move(node: BVHNode<N, L>, margin: number): void {
    if (!node.parent || isBoxInsideBox(node.box, node.parent.box)) {
      if (margin > 0) {
        expandBoxByMargin(node.box, margin);
      }
      return;
    }

    if (margin > 0) {
      expandBoxByMargin(node.box, margin);
    }

    const deletedNode = this.delete(node);
    if (deletedNode) {
      this.insertLeaf(node, deletedNode);
    }
    this.count++;
  }

  public delete(node: BVHNode<N, L>): BVHNode<N, L> | null {
    const parent = node.parent;

    if (parent === null) {
      this.root = null;
      return null;
    }

    const parent2 = parent.parent;
    const oppositeLeaf = parent.left === node ? parent.right : parent.left;

    oppositeLeaf.parent = parent2;
    node.parent = null;

    if (parent2 === null) {
      this.root = oppositeLeaf;
      return parent;
    }

    if (parent2.left === parent) {
      parent2.left = oppositeLeaf;
    } else {
      parent2.right = oppositeLeaf;
    }

    this.refit(parent2);
    this.count--;

    return parent;
  }

  public clear(): void {
    this.root = null;
  }

  protected insertLeaf(leaf: BVHNode<N, L>, newParent?: BVHNode<N, L>): void {
    const sibling = this.findBestSibling(leaf.box);
    const oldParent = sibling.parent;

    const effectiveParent = newParent === undefined
      ? this.createInternalNode(oldParent, sibling, leaf)
      : this.setupExistingParent(newParent, oldParent, sibling, leaf);

    sibling.parent = effectiveParent;
    leaf.parent = effectiveParent;

    if (oldParent === null) {
      this.root = effectiveParent;
    } else if (oldParent.left === sibling) {
      oldParent.left = effectiveParent;
    } else {
      oldParent.right = effectiveParent;
    }

    this.refitAndRotate(leaf, sibling);
  }

  protected createLeafNode(object: L, box: FloatArray): BVHNode<N, L> {
    const node = {
      box,
      object,
      parent: null,
      left: null,
      right: null,
    } as BVHNode<N, L>;
    return node;
  }

  protected createInternalNode(
    parent: BVHNode<N, L> | null,
    sibling: BVHNode<N, L>, leaf: BVHNode<N, L>,
  ): BVHNode<N, L> {
    // eslint-disable-next-line new-cap
    const box = new this.typeArray(BOX_COMPONENTS) as FloatArray;
    const node = {
      parent,
      left: sibling,
      right: leaf,
      box,
    } as BVHNode<N, L>;
    return node;
  }

  protected findBestSibling(leafBox: FloatArray): BVHNode<N, L> | null {
    const root = this.root;
    const leafArea = areaBox(leafBox);
    const initialCost = areaFromTwoBoxes(leafBox, root.box);

    if (root.object !== undefined) {
      return root;
    }

    const sortedList = this.sortedList;
    sortedList.clear();

    const state: SiblingSearchState<N, L> = {
      leafBox,
      bestNode: root,
      bestCost: initialCost,
      leafArea,
      sortedList,
    };

    let nodeObj = {
      node: root,
      inheritedCost: initialCost - areaBox(root.box),
    };

    do {
      const { node, inheritedCost } = nodeObj;

      processNodeInSearch(state, node, inheritedCost, this.updateBestFromCosts.bind(this));
    } while ((nodeObj = sortedList.pop()));

    return state.bestNode;
  }

  protected refit(startNode: BVHNode<N, L>): void {
    let current = startNode;
    unionBox(current.left.box, current.right.box, current.box);
    current = current.parent!;

    while (current) {
      if (!unionBoxChanged(current.left.box, current.right.box, current.box)) {
        return;
      }
      current = current.parent!;
    }
  }

  protected refitAndRotate(leaf: BVHNode<N, L>, sibling: BVHNode<N, L>): void {
    const originalNodeBox = leaf.box;
    let current = leaf.parent;
    const currentBox = current.box;
    unionBox(originalNodeBox, sibling.box, currentBox);

    current = current.parent!;

    while (current) {
      const ancestorBox = current.box;

      if (!isExpanded(originalNodeBox, ancestorBox)) {
        return;
      }

      const left = current.left;
      const right = current.right;

      const rightResult = evaluateRightRotations(left, right);
      const leftResult = evaluateLeftRotations(left, right, rightResult.bestCost);

      const swap1 = leftResult.nodeSwap1 ?? rightResult.nodeSwap1;
      const swap2 = leftResult.nodeSwap2 ?? rightResult.nodeSwap2;

      if (swap1 !== null && swap2 !== null) {
        this.swapNodes(swap1, swap2);
      }

      current = current.parent!;
    }
  }

  protected swapNodes(nodeA: BVHNode<N, L>, nodeB: BVHNode<N, L>): void {
    const parentA = nodeA.parent;
    const parentB = nodeB.parent;
    const parentBox = parentB.box;

    if (parentA.left === nodeA) {
      parentA.left = nodeB;
    } else {
      parentA.right = nodeB;
    }

    if (parentB.left === nodeB) {
      parentB.left = nodeA;
    } else {
      parentB.right = nodeA;
    }

    nodeA.parent = parentB;
    nodeB.parent = parentA;

    unionBox(parentB.left.box, parentB.right.box, parentBox);
  }

  private setupExistingParent(
    newParent: BVHNode<N, L>,
    oldParent: BVHNode<N, L> | null,
    sibling: BVHNode<N, L>, leaf: BVHNode<N, L>,
  ): BVHNode<N, L> {
    newParent.parent = oldParent;
    newParent.left = sibling;
    newParent.right = leaf;
    return newParent;
  }

  private updateBestFromCosts(
    state: SiblingSearchState<N, L>,
    nodeL: BVHNode<N, L>, costL: number,
    nodeR: BVHNode<N, L>, costR: number,
  ): void {
    if (costL > costR) {
      if (state.bestCost > costR) {
        state.bestNode = nodeR;
        state.bestCost = costR;
      }
    } else if (state.bestCost > costL) {
      state.bestNode = nodeL;
      state.bestCost = costL;
    }
  }
}
