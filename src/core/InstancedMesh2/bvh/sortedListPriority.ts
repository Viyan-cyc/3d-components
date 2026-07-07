// @ts-nocheck
/**
 * @internal Priority-sorted list for branch-and-bound BVH sibling search.
 * Only maintains the last ~6 elements to keep operations fast.
 */

type ItemListType = { node: any; inheritedCost: number };

export class SortedListPriority {
    public array: ItemListType[] = [];

    public clear(): void {
        this.array = [];
    }

    public push(node: ItemListType): void {
        const array = this.array;
        const cost = node.inheritedCost;
        const end = array.length > 6 ? array.length - 6 : 0;
        let i: number;

        for (i = array.length - 1; i >= end; i--) {
            if (cost <= array[i].inheritedCost) break;
        }

        if (i > array.length - 7) array.splice(i + 1, 0, node);
    }

    public pop(): ItemListType {
        return this.array.pop();
    }
}
