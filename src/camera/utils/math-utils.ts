/**
 * @module camera/utils/math-utils
 * @internal
 *
 * Pure math helpers used by {@link CameraControls}.
 * Duplicated from `src/utils/` to keep the `camera` entry self-contained.
 */

import * as THREE from 'three';
import type { Ref } from '../types';

const EPSILON = 1e-5;

/** Degrees → radians conversion factor. */
export const DEG2RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Scalar helpers
// ---------------------------------------------------------------------------

/** Clamp `value` to the closed range [`min`, `max`]. */
export function clamp( value: number, min: number, max: number ): number {

	return Math.max( min, Math.min( max, value ) );

}

/** `true` when `|number|` is below `error` (default 1e-5). */
export function approxZero( number: number, error: number = EPSILON ): boolean {

	return Math.abs( number ) < error;

}

/** `true` when `a` and `b` are within `error` of each other. */
export function approxEquals( a: number, b: number, error: number = EPSILON ): boolean {

	return approxZero( a - b, error );

}

/** Round `value` to the nearest multiple of `step`. */
export function roundToStep( value: number, step: number ): number {

	return Math.round( value / step ) * step;

}

/** Convert `Infinity` → `Number.MAX_VALUE` (JSON-safe). */
export function infinityToMaxNumber( value: number ): number {

	if ( isFinite( value ) ) return value;
	return value < 0 ? - Number.MAX_VALUE : Number.MAX_VALUE;

}

/** Convert `±Number.MAX_VALUE` → `Infinity` (reverse of {@link infinityToMaxNumber}). */
export function maxNumberToInfinity( value: number ): number {

	if ( Math.abs( value ) < Number.MAX_VALUE ) return value;
	return value * Infinity;

}

// ---------------------------------------------------------------------------
// SmoothDamp — critically-damped spring interpolation
// ---------------------------------------------------------------------------

/**
 * Scalar smooth-damp (Game Programming Gems 4, Ch.1.10).
 *
 * Identical algorithm to Unity's `Mathf.SmoothDamp`.
 * Frame-rate independent, overshoot-free, velocity-tracked.
 *
 * @param current          Current value.
 * @param target           Target value.
 * @param currentVelocity  `{ value }` ref — velocity is both read and written.
 * @param smoothTime       Approximate time to reach the target (seconds).
 * @param maxSpeed         Maximum speed (default `Infinity`).
 * @param deltaTime        Frame delta in seconds.
 * @returns                The new interpolated value.
 */
export function smoothDamp(
	current: number,
	target: number,
	currentVelocity: Ref,
	smoothTime: number,
	maxSpeed: number = Infinity,
	deltaTime: number,
): number {

	smoothTime = Math.max( 0.0001, smoothTime );
	const omega = 2 / smoothTime;

	const x = omega * deltaTime;
	const exp = 1 / ( 1 + x + 0.48 * x * x + 0.235 * x * x * x );
	let change = current - target;
	const originalTo = target;

	// Clamp maximum speed
	const maxChange = maxSpeed * smoothTime;
	change = clamp( change, - maxChange, maxChange );
	target = current - change;

	const temp = ( currentVelocity.value + omega * change ) * deltaTime;
	currentVelocity.value = ( currentVelocity.value - omega * temp ) * exp;
	let output = target + ( change + temp ) * exp;

	// Prevent overshooting
	if ( originalTo - current > 0.0 === output > originalTo ) {

		output = originalTo;
		currentVelocity.value = ( output - originalTo ) / deltaTime;

	}

	return output;

}

/**
 * Vector3 smooth-damp (per-component, allocation-free).
 *
 * @param current          Current position (mutated in-place with result).
 * @param target           Target position.
 * @param currentVelocity  Velocity vector (mutated in-place).
 * @param smoothTime       Approximate time to reach the target (seconds).
 * @param maxSpeed         Maximum speed (default `Infinity`).
 * @param deltaTime        Frame delta in seconds.
 * @param out              Output vector (may be same as `current`).
 * @returns                The `out` vector.
 */
export function smoothDampVec3(
	current: THREE.Vector3,
	target: THREE.Vector3,
	currentVelocity: THREE.Vector3,
	smoothTime: number,
	maxSpeed: number = Infinity,
	deltaTime: number,
	out: THREE.Vector3,
): THREE.Vector3 {

	smoothTime = Math.max( 0.0001, smoothTime );
	const omega = 2 / smoothTime;

	const x = omega * deltaTime;
	const exp = 1 / ( 1 + x + 0.48 * x * x + 0.235 * x * x * x );

	let targetX = target.x;
	let targetY = target.y;
	let targetZ = target.z;

	let changeX = current.x - targetX;
	let changeY = current.y - targetY;
	let changeZ = current.z - targetZ;

	const originalToX = targetX;
	const originalToY = targetY;
	const originalToZ = targetZ;

	// Clamp maximum speed
	const maxChange = maxSpeed * smoothTime;
	const maxChangeSq = maxChange * maxChange;
	const magnitudeSq = changeX * changeX + changeY * changeY + changeZ * changeZ;

	if ( magnitudeSq > maxChangeSq ) {

		const magnitude = Math.sqrt( magnitudeSq );
		changeX = changeX / magnitude * maxChange;
		changeY = changeY / magnitude * maxChange;
		changeZ = changeZ / magnitude * maxChange;

	}

	targetX = current.x - changeX;
	targetY = current.y - changeY;
	targetZ = current.z - changeZ;

	const tempX = ( currentVelocity.x + omega * changeX ) * deltaTime;
	const tempY = ( currentVelocity.y + omega * changeY ) * deltaTime;
	const tempZ = ( currentVelocity.z + omega * changeZ ) * deltaTime;

	currentVelocity.x = ( currentVelocity.x - omega * tempX ) * exp;
	currentVelocity.y = ( currentVelocity.y - omega * tempY ) * exp;
	currentVelocity.z = ( currentVelocity.z - omega * tempZ ) * exp;

	out.x = targetX + ( changeX + tempX ) * exp;
	out.y = targetY + ( changeY + tempY ) * exp;
	out.z = targetZ + ( changeZ + tempZ ) * exp;

	// Prevent overshooting
	const origMinusCurrentX = originalToX - current.x;
	const origMinusCurrentY = originalToY - current.y;
	const origMinusCurrentZ = originalToZ - current.z;
	const outMinusOrigX = out.x - originalToX;
	const outMinusOrigY = out.y - originalToY;
	const outMinusOrigZ = out.z - originalToZ;

	if ( origMinusCurrentX * outMinusOrigX + origMinusCurrentY * outMinusOrigY + origMinusCurrentZ * outMinusOrigZ > 0 ) {

		out.x = originalToX;
		out.y = originalToY;
		out.z = originalToZ;

		currentVelocity.x = ( out.x - originalToX ) / deltaTime;
		currentVelocity.y = ( out.y - originalToY ) / deltaTime;
		currentVelocity.z = ( out.z - originalToZ ) / deltaTime;

	}

	return out;

}

// ---------------------------------------------------------------------------
// Camera type guards
// ---------------------------------------------------------------------------

/** `true` when `camera` is a `THREE.PerspectiveCamera`. */
export function isPerspectiveCamera( camera: THREE.Camera ): camera is THREE.PerspectiveCamera {

	return ( camera as THREE.PerspectiveCamera ).isPerspectiveCamera;

}

/** `true` when `camera` is a `THREE.OrthographicCamera`. */
export function isOrthographicCamera( camera: THREE.Camera ): camera is THREE.OrthographicCamera {

	return ( camera as THREE.OrthographicCamera ).isOrthographicCamera;

}
