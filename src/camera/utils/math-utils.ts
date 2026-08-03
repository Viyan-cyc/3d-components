/**
 * @module camera/utils/math-utils
 * @internal
 *
 * Pure math helpers used by {@link CameraControls}.
 * Duplicated from `src/utils/` to keep the `camera` entry self-contained.
 */

import type * as THREE from 'three';
import type { Ref } from '../types';

const EPSILON = 1e-5;

/** Degrees → radians conversion factor. */
const DEGREES_IN_CIRCLE = 180;
export const DEG2RAD = Math.PI / DEGREES_IN_CIRCLE;

/** Minimum smooth time to avoid division by zero (seconds). */
const MIN_SMOOTH_TIME = 0.0001;

/** SmoothDamp polynomial coefficient for x² term. */
const SMOOTH_COEFF_A = 0.48;

/** SmoothDamp polynomial coefficient for x³ term. */
const SMOOTH_COEFF_B = 0.235;

// ---------------------------------------------------------------------------
// Scalar helpers
// ---------------------------------------------------------------------------

/** Clamp `value` to the closed range [`min`, `max`]. */
export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** `true` when `|number|` is below `error` (default 1e-5). */
export const approxZero = (number: number, error: number = EPSILON): boolean =>
  Math.abs(number) < error;

/** `true` when `a` and `b` are within `error` of each other. */
export const approxEquals = (a: number, b: number, error: number = EPSILON): boolean =>
  approxZero(a - b, error);

/** Round `value` to the nearest multiple of `step`. */
export const roundToStep = (value: number, step: number): number =>
  Math.round(value / step) * step;

/** Convert `Infinity` → `Number.MAX_VALUE` (JSON-safe). */
export const infinityToMaxNumber = (value: number): number => {

  if (isFinite(value)) {
    return value;
  }
  return value < 0 ? - Number.MAX_VALUE : Number.MAX_VALUE;

};

/** Convert `±Number.MAX_VALUE` → `Infinity` (reverse of {@link infinityToMaxNumber}). */
export const maxNumberToInfinity = (value: number): number => {

  if (Math.abs(value) < Number.MAX_VALUE) {
    return value;
  }
  return value * Infinity;

};

// ---------------------------------------------------------------------------
// SmoothDamp — critically-damped spring interpolation
// ---------------------------------------------------------------------------

/**
 * Compute the smooth-damp exponential decay factor.
 *
 * @internal
 */
const smoothDampExp = (omega: number, deltaTime: number): number => {

  const x = omega * deltaTime;
  return 1 / (1 + x + SMOOTH_COEFF_A * x * x + SMOOTH_COEFF_B * x * x * x);

};

/** Config bundle shared by {@link smoothDamp} and {@link smoothDampVec3}. */
export interface SmoothDampConfig {

  /** Approximate time to reach the target (seconds). */
  smoothTime: number;

  /** Maximum speed. */
  maxSpeed: number;

  /** Frame delta in seconds. */
  deltaTime: number;

}

/**
 * Scalar smooth-damp (Game Programming Gems 4, Ch.1.10).
 *
 * Identical algorithm to Unity's `Mathf.SmoothDamp`.
 * Frame-rate independent, overshoot-free, velocity-tracked.
 *
 * @param current          Current value.
 * @param target           Target value.
 * @param currentVelocity  `{ value }` ref — velocity is both read and written.
 * @param config           Smooth-damp timing config ({@link SmoothDampConfig}).
 * @returns                The new interpolated value.
 */
export const smoothDamp = (
  current: number,
  target: number,
  currentVelocity: Ref,
  config: SmoothDampConfig,
): number => {

  const { smoothTime, maxSpeed, deltaTime } = config;
  const clampedSmoothTime = Math.max(MIN_SMOOTH_TIME, smoothTime);
  const omega = 2 / clampedSmoothTime;

  const exp = smoothDampExp(omega, deltaTime);
  let change = current - target;
  const originalTo = target;

  // Clamp maximum speed
  const maxChange = maxSpeed * clampedSmoothTime;
  change = clamp(change, - maxChange, maxChange);
  const adjustedTarget = current - change;

  const temp = (currentVelocity.value + omega * change) * deltaTime;
  currentVelocity.value = (currentVelocity.value - omega * temp) * exp;
  let output = adjustedTarget + (change + temp) * exp;

  // Prevent overshooting
  if ((originalTo - current > 0.0) === (output > originalTo)) {

    output = originalTo;
    currentVelocity.value = (output - originalTo) / deltaTime;

  }

  return output;

};

/**
 * Apply vector magnitude clamping for smoothDampVec3.
 *
 * @internal
 */
const clampVec3Change = (
  changeX: number, changeY: number, changeZ: number,
  maxChange: number,
): [number, number, number] => {

  const maxChangeSq = maxChange * maxChange;
  const magnitudeSq = changeX * changeX + changeY * changeY + changeZ * changeZ;

  if (magnitudeSq > maxChangeSq) {

    const magnitude = Math.sqrt(magnitudeSq);
    return [
      changeX / magnitude * maxChange,
      changeY / magnitude * maxChange,
      changeZ / magnitude * maxChange,
    ];

  }

  return [changeX, changeY, changeZ];

};

/**
 * Vector3 smooth-damp (per-component, allocation-free).
 *
 * @param current          Current position (mutated in-place with result).
 * @param target           Target position.
 * @param currentVelocity  Velocity vector (mutated in-place).
 * @param config           Smooth-damp timing config ({@link SmoothDampConfig}).
 * @param out              Output vector (may be same as `current`).
 * @returns                The `out` vector.
 */
export const smoothDampVec3 = (
  current: THREE.Vector3,
  target: THREE.Vector3,
  currentVelocity: THREE.Vector3,
  config: SmoothDampConfig,
  out: THREE.Vector3,
): THREE.Vector3 => {

  const { smoothTime, maxSpeed, deltaTime } = config;
  const clampedSmoothTime = Math.max(MIN_SMOOTH_TIME, smoothTime);
  const omega = 2 / clampedSmoothTime;
  const exp = smoothDampExp(omega, deltaTime);
  const maxChange = maxSpeed * clampedSmoothTime;

  const originalToX = target.x;
  const originalToY = target.y;
  const originalToZ = target.z;

  let changeX = current.x - target.x;
  let changeY = current.y - target.y;
  let changeZ = current.z - target.z;

  [changeX, changeY, changeZ] = clampVec3Change(changeX, changeY, changeZ, maxChange);

  const targetX = current.x - changeX;
  const targetY = current.y - changeY;
  const targetZ = current.z - changeZ;

  // Per-axis smooth-damp interpolation
  const tempX = (currentVelocity.x + omega * changeX) * deltaTime;
  const tempY = (currentVelocity.y + omega * changeY) * deltaTime;
  const tempZ = (currentVelocity.z + omega * changeZ) * deltaTime;

  currentVelocity.x = (currentVelocity.x - omega * tempX) * exp;
  currentVelocity.y = (currentVelocity.y - omega * tempY) * exp;
  currentVelocity.z = (currentVelocity.z - omega * tempZ) * exp;

  out.x = targetX + (changeX + tempX) * exp;
  out.y = targetY + (changeY + tempY) * exp;
  out.z = targetZ + (changeZ + tempZ) * exp;

  // Prevent overshooting: if the output passed the original target, snap back.
  const dotProduct =
    (originalToX - current.x) * (out.x - originalToX) +
    (originalToY - current.y) * (out.y - originalToY) +
    (originalToZ - current.z) * (out.z - originalToZ);

  if (dotProduct > 0) {

    out.x = originalToX;
    out.y = originalToY;
    out.z = originalToZ;

    currentVelocity.x = (out.x - originalToX) / deltaTime;
    currentVelocity.y = (out.y - originalToY) / deltaTime;
    currentVelocity.z = (out.z - originalToZ) / deltaTime;

  }

  return out;

};

// ---------------------------------------------------------------------------
// Camera type guards
// ---------------------------------------------------------------------------

/** `true` when `camera` is a `THREE.PerspectiveCamera`. */
export const isPerspectiveCamera = (camera: THREE.Camera): camera is THREE.PerspectiveCamera =>
  (camera as THREE.PerspectiveCamera).isPerspectiveCamera;

/** `true` when `camera` is a `THREE.OrthographicCamera`. */
export const isOrthographicCamera = (camera: THREE.Camera): camera is THREE.OrthographicCamera =>
  (camera as THREE.OrthographicCamera).isOrthographicCamera;
