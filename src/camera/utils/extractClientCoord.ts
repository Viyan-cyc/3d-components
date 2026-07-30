/**
 * @module camera/utils/extractClientCoord
 * @internal
 *
 * Extract averaged client coordinates from an array of active pointers.
 */

import * as THREE from 'three';
import type { PointerInput } from '../types';

/**
 * Compute the centroid of all pointers and write it to `out`.
 *
 * @param pointers  Active pointer list.
 * @param out       Receiving `Vector2` (x → clientX, y → clientY).
 */
export function extractClientCoordFromEvent( pointers: PointerInput[], out: THREE.Vector2 ): void {

	out.set( 0, 0 );

	for ( let i = 0; i < pointers.length; i ++ ) {

		out.x += pointers[ i ].clientX;
		out.y += pointers[ i ].clientY;

	}

	out.x /= pointers.length;
	out.y /= pointers.length;

}
