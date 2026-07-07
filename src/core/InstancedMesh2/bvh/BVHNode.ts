// @ts-nocheck
/**
 * @internal BVH internal types - inlined from bvh.js to avoid external dependency.
 */

/** Float array type used by BVH nodes and utilities. */
export type FloatArray = Float32Array | Float64Array;
/** Float array constructor type. */
export type FloatArrayType = typeof Float32Array | typeof Float64Array;

/**
 * BVH node type.
 * Leaf nodes have `object` defined and `left`/`right` are null.
 * Internal nodes have `left`/`right` defined and `object` is undefined.
 * Box layout: `[minX, maxX, minY, maxY, minZ, maxZ]` (interleaved min/max).
 */
export type BVHNode<NodeData, LeafData> = {
    box: FloatArray;
    parent: BVHNode<NodeData, LeafData> | null;
    left: BVHNode<NodeData, LeafData> | null;
    right: BVHNode<NodeData, LeafData> | null;
    object?: LeafData;
} & NodeData;
