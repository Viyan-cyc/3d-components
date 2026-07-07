// @ts-nocheck
/**
 * @internal Render item for depth sorting of instances.
 */
export type InstancedRenderItem = { index: number; depth: number; depthSort: number };

/**
 * @internal Manages a pool-allocated list of render items for sorting.
 */
export class InstancedRenderList {
    public array: InstancedRenderItem[] = [];
    protected pool: InstancedRenderItem[] = [];

    /** Adds a new render item to the list. */
    public push(depth: number, index: number): void {
        const pool = this.pool;
        const list = this.array;
        const count = list.length;

        if (count >= pool.length) {
            pool.push({ depth: null, index: null, depthSort: null });
        }

        const item = pool[count];
        item.depth = depth;
        item.index = index;

        list.push(item);
    }

    /** Resets the render list by clearing the array. */
    public reset(): void {
        this.array.length = 0;
    }
}
