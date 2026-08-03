/**
 * @module camera/utils/camera-helpers
 * @internal
 *
 * Pure helper functions for {@link CameraControls}: input mapping, action-bit
 * checks, and resolve-immediately predicates. Extracted from CameraControls to
 * keep the controller focused on state and lifecycle. None of these touch `this`.
 */

import type * as THREE from 'three';
import {
  ACTION,
  MOUSE_BUTTON,
  type MouseButtons,
  type Touches,
} from '../types';
import {
  approxEquals,
  isOrthographicCamera,
  isPerspectiveCamera,
} from './math-utils';

/** Maximum touch pointers to map to actions. */
const MAX_TOUCH_ACTION_COUNT = 3;

/**
 * Build a "resolve immediately" flag from transition and threshold checks.
 *
 * @internal
 */
export const shouldResolveImmediately = (
  enableTransition: boolean,
  checks: boolean[],
): boolean => {

  if (! enableTransition) {
    return true;
  }
  return checks.every(Boolean);

};

/**
 * `true` when `a` and `b` are within `threshold` on all three axes.
 *
 * @internal
 */
export const approxEquals3 = (
  a: THREE.Vector3,
  b: THREE.Vector3,
  threshold: number,
): boolean =>
  approxEquals(a.x, b.x, threshold) &&
  approxEquals(a.y, b.y, threshold) &&
  approxEquals(a.z, b.z, threshold);

/**
 * Get touch action by pointer count.
 *
 * @internal
 */
export const getTouchAction = (
  touches: Touches,
  pointerCount: number,
): ACTION => {

  switch (pointerCount) {

    case 1: return touches.one;
    case 2: return touches.two;
    case MAX_TOUCH_ACTION_COUNT: return touches.three;
    default: return ACTION.NONE;

  }

};

/**
 * Determine mouse button from event.
 *
 * @internal
 */
export const getMouseButton = (event: PointerEvent): MOUSE_BUTTON | null => {

  if (event.pointerType !== 'mouse') {
    return null;
  }
  if ((event.buttons & MOUSE_BUTTON.LEFT) === MOUSE_BUTTON.LEFT) {
    return MOUSE_BUTTON.LEFT;
  }
  if ((event.buttons & MOUSE_BUTTON.MIDDLE) === MOUSE_BUTTON.MIDDLE) {
    return MOUSE_BUTTON.MIDDLE;
  }
  if ((event.buttons & MOUSE_BUTTON.RIGHT) === MOUSE_BUTTON.RIGHT) {
    return MOUSE_BUTTON.RIGHT;
  }
  return null;

};

/**
 * Determine default wheel action based on camera type.
 *
 * @internal
 */
export const getDefaultWheelAction = (camera: THREE.Camera): MouseButtons['wheel'] => {

  if (isPerspectiveCamera(camera)) {
    return ACTION.DOLLY;
  }
  if (isOrthographicCamera(camera)) {
    return ACTION.ZOOM;
  }
  return ACTION.NONE;

};

/**
 * Determine default two-touch action based on camera type.
 *
 * @internal
 */
export const getDefaultTwoTouchAction = (camera: THREE.Camera): Touches['two'] => {

  if (isPerspectiveCamera(camera)) {
    return ACTION.TOUCH_DOLLY_TRUCK;
  }
  if (isOrthographicCamera(camera)) {
    return ACTION.TOUCH_ZOOM_TRUCK;
  }
  return ACTION.NONE;

};

/**
 * Check if pointer is within interactive area.
 *
 * @internal
 */
export const isPointerInInteractiveArea = (
  event: { clientX: number; clientY: number },
  interactiveArea: DOMRect,
  domElement: HTMLElement,
): boolean => {

  if (
    interactiveArea.left !== 0 ||
    interactiveArea.top !== 0 ||
    interactiveArea.width !== 1 ||
    interactiveArea.height !== 1
  ) {

    const elRect = domElement.getBoundingClientRect();
    const left = event.clientX / elRect.width;
    const top = event.clientY / elRect.height;

    if (
      left < interactiveArea.left ||
      left > interactiveArea.right ||
      top < interactiveArea.top ||
      top > interactiveArea.bottom
    ) {
      return false;
    }

  }

  return true;

};

/**
 * Check if the current action includes rotation.
 *
 * @internal
 */
export const hasRotateAction = (state: ACTION): boolean =>
  (state & ACTION.ROTATE) === ACTION.ROTATE ||
  (state & ACTION.TOUCH_ROTATE) === ACTION.TOUCH_ROTATE ||
  (state & ACTION.TOUCH_DOLLY_ROTATE) === ACTION.TOUCH_DOLLY_ROTATE ||
  (state & ACTION.TOUCH_ZOOM_ROTATE) === ACTION.TOUCH_ZOOM_ROTATE;

/**
 * Check if the current action includes truck/pan.
 *
 * @internal
 */
export const hasTruckAction = (state: ACTION): boolean =>
  (state & ACTION.TRUCK) === ACTION.TRUCK ||
  (state & ACTION.SCREEN_PAN) === ACTION.SCREEN_PAN ||
  (state & ACTION.TOUCH_TRUCK) === ACTION.TOUCH_TRUCK ||
  (state & ACTION.TOUCH_SCREEN_PAN) === ACTION.TOUCH_SCREEN_PAN ||
  (state & ACTION.TOUCH_DOLLY_TRUCK) === ACTION.TOUCH_DOLLY_TRUCK ||
  (state & ACTION.TOUCH_DOLLY_SCREEN_PAN) === ACTION.TOUCH_DOLLY_SCREEN_PAN ||
  (state & ACTION.TOUCH_ZOOM_TRUCK) === ACTION.TOUCH_ZOOM_TRUCK ||
  (state & ACTION.TOUCH_ZOOM_SCREEN_PAN) === ACTION.TOUCH_ZOOM_SCREEN_PAN;

/**
 * Check if the current action includes dolly.
 *
 * @internal
 */
export const hasDollyAction = (state: ACTION): boolean =>
  (state & ACTION.DOLLY) === ACTION.DOLLY ||
  (state & ACTION.TOUCH_DOLLY) === ACTION.TOUCH_DOLLY ||
  (state & ACTION.TOUCH_DOLLY_TRUCK) === ACTION.TOUCH_DOLLY_TRUCK ||
  (state & ACTION.TOUCH_DOLLY_SCREEN_PAN) === ACTION.TOUCH_DOLLY_SCREEN_PAN ||
  (state & ACTION.TOUCH_DOLLY_OFFSET) === ACTION.TOUCH_DOLLY_OFFSET ||
  (state & ACTION.TOUCH_DOLLY_ROTATE) === ACTION.TOUCH_DOLLY_ROTATE;

/**
 * Check if the current action includes zoom.
 *
 * @internal
 */
export const hasZoomAction = (state: ACTION): boolean =>
  (state & ACTION.ZOOM) === ACTION.ZOOM ||
  (state & ACTION.TOUCH_ZOOM) === ACTION.TOUCH_ZOOM ||
  (state & ACTION.TOUCH_ZOOM_TRUCK) === ACTION.TOUCH_ZOOM_TRUCK ||
  (state & ACTION.TOUCH_ZOOM_SCREEN_PAN) === ACTION.TOUCH_ZOOM_SCREEN_PAN ||
  (state & ACTION.TOUCH_ZOOM_OFFSET) === ACTION.TOUCH_ZOOM_OFFSET ||
  (state & ACTION.TOUCH_ZOOM_ROTATE) === ACTION.TOUCH_ZOOM_ROTATE;

/**
 * Check if the current action includes offset.
 *
 * @internal
 */
export const hasOffsetAction = (state: ACTION): boolean =>
  (state & ACTION.OFFSET) === ACTION.OFFSET ||
  (state & ACTION.TOUCH_OFFSET) === ACTION.TOUCH_OFFSET ||
  (state & ACTION.TOUCH_DOLLY_OFFSET) === ACTION.TOUCH_DOLLY_OFFSET ||
  (state & ACTION.TOUCH_ZOOM_OFFSET) === ACTION.TOUCH_ZOOM_OFFSET;

/**
 * Check if the current action includes touch dolly or touch zoom.
 *
 * @internal
 */
export const hasTouchDollyOrZoomAction = (state: ACTION): boolean =>
  (state & ACTION.TOUCH_DOLLY) === ACTION.TOUCH_DOLLY ||
  (state & ACTION.TOUCH_ZOOM) === ACTION.TOUCH_ZOOM ||
  (state & ACTION.TOUCH_DOLLY_TRUCK) === ACTION.TOUCH_DOLLY_TRUCK ||
  (state & ACTION.TOUCH_ZOOM_TRUCK) === ACTION.TOUCH_ZOOM_TRUCK ||
  (state & ACTION.TOUCH_DOLLY_SCREEN_PAN) === ACTION.TOUCH_DOLLY_SCREEN_PAN ||
  (state & ACTION.TOUCH_ZOOM_SCREEN_PAN) === ACTION.TOUCH_ZOOM_SCREEN_PAN ||
  (state & ACTION.TOUCH_DOLLY_OFFSET) === ACTION.TOUCH_DOLLY_OFFSET ||
  (state & ACTION.TOUCH_ZOOM_OFFSET) === ACTION.TOUCH_ZOOM_OFFSET ||
  (state & ACTION.TOUCH_DOLLY_ROTATE) === ACTION.TOUCH_DOLLY_ROTATE ||
  (state & ACTION.TOUCH_ZOOM_ROTATE) === ACTION.TOUCH_ZOOM_ROTATE;

/**
 * Check if the current action includes truck only (not screen pan).
 *
 * @internal
 */
export const hasTruckOnlyAction = (state: ACTION): boolean =>
  (state & ACTION.TRUCK) === ACTION.TRUCK ||
  (state & ACTION.TOUCH_TRUCK) === ACTION.TOUCH_TRUCK ||
  (state & ACTION.TOUCH_DOLLY_TRUCK) === ACTION.TOUCH_DOLLY_TRUCK ||
  (state & ACTION.TOUCH_ZOOM_TRUCK) === ACTION.TOUCH_ZOOM_TRUCK;

/**
 * Check if the current action includes screen pan.
 *
 * @internal
 */
export const hasScreenPanAction = (state: ACTION): boolean =>
  (state & ACTION.SCREEN_PAN) === ACTION.SCREEN_PAN ||
  (state & ACTION.TOUCH_SCREEN_PAN) === ACTION.TOUCH_SCREEN_PAN ||
  (state & ACTION.TOUCH_DOLLY_SCREEN_PAN) === ACTION.TOUCH_DOLLY_SCREEN_PAN ||
  (state & ACTION.TOUCH_ZOOM_SCREEN_PAN) === ACTION.TOUCH_ZOOM_SCREEN_PAN;

/**
 * Check if the current action has touch dolly (not zoom).
 *
 * @internal
 */
export const hasTouchDollyAction = (state: ACTION): boolean =>
  (state & ACTION.TOUCH_DOLLY) === ACTION.TOUCH_DOLLY ||
  (state & ACTION.TOUCH_DOLLY_ROTATE) === ACTION.TOUCH_DOLLY_ROTATE ||
  (state & ACTION.TOUCH_DOLLY_TRUCK) === ACTION.TOUCH_DOLLY_TRUCK ||
  (state & ACTION.TOUCH_DOLLY_SCREEN_PAN) === ACTION.TOUCH_DOLLY_SCREEN_PAN ||
  (state & ACTION.TOUCH_DOLLY_OFFSET) === ACTION.TOUCH_DOLLY_OFFSET;
