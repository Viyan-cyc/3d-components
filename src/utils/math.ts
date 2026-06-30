import type { Vec3 } from '../types';

/**
 * Clamp a number to the inclusive [min, max] range.
 *
 * @param value - The number to clamp.
 * @param min - Minimum allowed value (inclusive).
 * @param max - Maximum allowed value (inclusive).
 * @returns The clamped value.
 *
 * @example
 * ```ts
 * Util.clamp(5, 0, 10);   // → 5
 * Util.clamp(-1, 0, 10);  // → 0
 * Util.clamp(99, 0, 10);  // → 10
 * ```
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linearly interpolate between two values by a factor `t`.
 *
 * When `t = 0`, returns `a`. When `t = 1`, returns `b`.
 * Values of `t` outside [0, 1] extrapolate.
 *
 * @param a - Start value.
 * @param b - End value.
 * @param t - Interpolation factor (0 → `a`, 1 → `b`).
 * @returns The interpolated value.
 *
 * @example
 * ```ts
 * Util.lerp(0, 100, 0.5);   // → 50
 * Util.lerp(10, 20, 0.25);  // → 12.5
 * ```
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Map a value from one numeric range to another.
 *
 * Linearly transforms `value` from the input range [inMin, inMax]
 * to the output range [outMin, outMax]. Does NOT clamp the result.
 *
 * @param value - The number to remap.
 * @param inMin - Lower bound of the input range.
 * @param inMax - Upper bound of the input range.
 * @param outMin - Lower bound of the output range.
 * @param outMax - Upper bound of the output range.
 * @returns The remapped value.
 *
 * @example
 * ```ts
 * Util.mapRange(0.5, 0, 1, 0, 100);  // → 50
 * Util.mapRange(0, -1, 1, 0, 360);   // → 180
 * ```
 */
export function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/**
 * Convert an angle from degrees to radians.
 *
 * @param degrees - Angle in degrees.
 * @returns Angle in radians.
 *
 * @example
 * ```ts
 * Util.degToRad(180);  // → 3.141592... (π)
 * Util.degToRad(90);   // → 1.570796... (π/2)
 * ```
 */
export function degToRad(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Convert an angle from radians to degrees.
 *
 * @param radians - Angle in radians.
 * @returns Angle in degrees.
 *
 * @example
 * ```ts
 * Util.radToDeg(Math.PI);     // → 180
 * Util.radToDeg(Math.PI / 2); // → 90
 * ```
 */
export function radToDeg(radians: number): number {
  return radians * (180 / Math.PI);
}

/**
 * Return a random floating-point number in [min, max).
 *
 * @param min - Minimum value (inclusive).
 * @param max - Maximum value (exclusive).
 * @returns A random float in the range.
 *
 * @example
 * ```ts
 * Util.randomRange(0, 10);    // → e.g. 7.382...
 * Util.randomRange(-5, 5);    // → e.g. -2.114...
 * ```
 */
export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Return a random integer in the inclusive [min, max] range.
 *
 * @param min - Minimum value (inclusive).
 * @param max - Maximum value (inclusive).
 * @returns A random integer.
 *
 * @example
 * ```ts
 * Util.randomInt(1, 6);  // → 1, 2, 3, 4, 5, or 6 (like a die roll)
 * Util.randomInt(0, 2);  // → 0, 1, or 2
 * ```
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(randomRange(min, max + 1));
}

/**
 * Calculate the Euclidean distance between two 3D points.
 *
 * @param a - First point.
 * @param b - Second point.
 * @returns The straight-line distance in 3D space.
 *
 * @example
 * ```ts
 * const a = { x: 0, y: 0, z: 0 };
 * const b = { x: 3, y: 4, z: 0 };
 * Util.distance(a, b);  // → 5
 * ```
 */
export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Smooth Hermite interpolation between two edges.
 *
 * Returns 0 when `x ≤ edge0`, 1 when `x ≥ edge1`, and smoothly
 * interpolates between them using a cubic Hermite curve.
 * Commonly used for anti-aliased edges in shaders and smooth
 * transitions.
 *
 * @param edge0 - Lower edge of the transition.
 * @param edge1 - Upper edge of the transition.
 * @param x - Input value.
 * @returns Smoothly interpolated value in [0, 1].
 *
 * @example
 * ```ts
 * Util.smoothstep(0, 1, 0.3);   // → ~0.216
 * Util.smoothstep(0, 1, 0.5);   // → 0.5
 * Util.smoothstep(0, 1, 0.8);   // → ~0.896
 * Util.smoothstep(0, 1, -0.5);  // → 0 (clamped)
 * Util.smoothstep(0, 1, 1.5);   // → 1 (clamped)
 * ```
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
