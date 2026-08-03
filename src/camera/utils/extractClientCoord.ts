/**
 * @module camera/utils/extractClientCoord
 * @internal
 *
 * Extract averaged client coordinates from an array of active pointers.
 */

import type * as THREE from 'three';
import type { PointerInput } from '../types';

/**
 * Compute the centroid of all pointers and write it to `out`.
 *
 * @param pointers  Active pointer list.
 * @param out       Receiving `Vector2` (x → clientX, y → clientY).
 */
export const extractClientCoordFromEvent = (
  pointers: PointerInput[],
  out: THREE.Vector2,
): void => {

  out.set(0, 0);

  for (const pointer of pointers) {

    out.x += pointer.clientX;
    out.y += pointer.clientY;

  }

  out.x /= pointers.length;
  out.y /= pointers.length;

};
