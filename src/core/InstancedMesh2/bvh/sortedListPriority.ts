/**
 * @internal Priority-sorted list for branch-and-bound BVH sibling search.
 * Only maintains the last ~6 elements to keep operations fast.
 */

import type { BVHNode } from './BVHNode';

const SORTED_WINDOW_SIZE = 6;
const MAX_INDEX_OFFSET = 7;

type ItemListType<N, L> = { node: BVHNode<N, L>; inheritedCost: number };

export class SortedListPriority<N = Record<string, never>, L = Record<string, never>> {
  public array: ItemListType<N, L>[] = [];

  public clear(): void {
    this.array = [];
  }

  public push(item: ItemListType<N, L>): void {
    const array = this.array;
    const cost = item.inheritedCost;
    const end = array.length > SORTED_WINDOW_SIZE
      ? array.length - SORTED_WINDOW_SIZE
      : 0;
    let i: number;

    for (i = array.length - 1; i >= end; i--) {
      if (cost <= array[i].inheritedCost) {
        break;
      }
    }

    if (i > array.length - MAX_INDEX_OFFSET) {
      array.splice(i + 1, 0, item);
    }
  }

  public pop(): ItemListType<N, L> {
    return this.array.pop();
  }
}
