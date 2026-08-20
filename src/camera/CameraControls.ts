/**
 * @module camera/CameraControls
 *
 * Orbit-style camera controller with smooth transitions.
 *
 * Rewritten to match `@a3d/a3d-components` conventions
 * (options-object constructor, `import * as THREE`, typed events, JSDoc, etc.).
 */

import * as THREE from 'three';
import type { IDisposable, IUpdatable } from '../types';
import { EventDispatcher } from './EventDispatcher';
import {
  ACTION,
  type CameraControlsEventMap,
  type CameraControlsEventType,
  type CameraControlsLerpState,
  type CameraControlsOptions,
  DOLLY_DIRECTION,
  type FitToOptions,
  MOUSE_BUTTON,
  type MouseButtons,
  type PointerInput,
  type Ref,
  type Touches,
} from './types';
import { PI_2, PI_HALF } from './utils/constants';
import { extractClientCoordFromEvent } from './utils/extractClientCoord';
import {
  DEG2RAD,
  approxEquals,
  approxZero,
  clamp,
  infinityToMaxNumber,
  isOrthographicCamera,
  isPerspectiveCamera,
  maxNumberToInfinity,
  roundToStep,
  smoothDamp,
  smoothDampVec3,
} from './utils/math-utils';
import {
  approxEquals3,
  getDefaultTwoTouchAction,
  getDefaultWheelAction,
  getMouseButton,
  getTouchAction,
  hasDollyAction,
  hasOffsetAction,
  hasRotateAction,
  hasScreenPanAction,
  hasTouchDollyAction,
  hasTouchDollyOrZoomAction,
  hasTruckAction,
  hasTruckOnlyAction,
  hasZoomAction,
  isPointerInInteractiveArea,
  shouldResolveImmediately,
} from './utils/camera-helpers';

// ─── Module-level constants ─────────────────────────────────────────────────

const TOUCH_DOLLY_DIVISOR = 8;
const TOUCH_DOLLY_FACTOR = 1 / TOUCH_DOLLY_DIVISOR;
const isMac = /Mac/.test(globalThis?.navigator?.platform);

/** Default minimum zoom factor for orthographic cameras. */
const DEFAULT_MIN_ZOOM = 0.01;

/** Default smooth time for programmatic transitions (seconds). */
const DEFAULT_SMOOTH_TIME = 0.25;

/** Default smooth time while dragging (seconds). */
const DEFAULT_DRAGGING_SMOOTH_TIME = 0.125;

/** Default rest threshold for detecting camera rest. */
const DEFAULT_REST_THRESHOLD = 0.01;

/** Scroll delta divisor for Mac platforms. */
const MAC_SCROLL_FACTOR = - 1;

/** Scroll delta divisor for non-Mac platforms. */
const NON_MAC_SCROLL_FACTOR = - 3;

/** Fine scroll multiplier. */
const FINE_SCROLL_DIVISOR = 10;

/** Scroll timestamp threshold in milliseconds. */
const SCROLL_TIMESTAMP_THRESHOLD = 1000;

/** Half factor used in centroid calculations. */
const CENTROID_HALF = 0.5;

/** Dolly scale base for exponential dolly. */
const DOLLY_SCALE_BASE = 0.95;

/** Near-plane corner count for collision detection. */
const NEAR_PLANE_CORNER_COUNT = 4;

/** Y-axis normalization factor for converting screen coords to NDC. */
const Y_NDC_FLIP = -2;

// ─── Reusable temp objects (single-instance safe — synchronous use only) ────
/* eslint-disable @typescript-eslint/naming-convention */
const _origin = Object.freeze(new THREE.Vector3(0, 0, 0));
const _axisY = Object.freeze(new THREE.Vector3(0, 1, 0));
const _axisZ = Object.freeze(new THREE.Vector3(0, 0, 1));
const _v2 = new THREE.Vector2();
const _v3A = new THREE.Vector3();
const _v3B = new THREE.Vector3();
const _v3C = new THREE.Vector3();
const _cameraDirection = new THREE.Vector3();
const _xColumn = new THREE.Vector3();
const _yColumn = new THREE.Vector3();
const _zColumn = new THREE.Vector3();
const _deltaTarget = new THREE.Vector3();
const _deltaOffset = new THREE.Vector3();
const _sphericalA = new THREE.Spherical();
const _sphericalB = new THREE.Spherical();
const _box3A = new THREE.Box3();
const _box3B = new THREE.Box3();
const _sphere = new THREE.Sphere();
const _quaternionA = new THREE.Quaternion();
const _quaternionB = new THREE.Quaternion();
const _rotationMatrix = new THREE.Matrix4();
const _raycaster = new THREE.Raycaster();
/* eslint-enable @typescript-eslint/naming-convention */

/** Input bundle for {@link CameraControls._applyWheelControlMode}. */
interface WheelControlInput {
  controlMode: ACTION;
  deltaX: number;
  deltaY: number;
  delta: number;
  x: number;
  y: number;
}

/** Per-frame delta bundle for {@link CameraControls._dispatchUpdateEvents}. */
interface UpdateDeltas {
  deltaTheta: number;
  deltaPhi: number;
  deltaRadius: number;
  deltaTarget: THREE.Vector3;
  deltaOffset: THREE.Vector3;
  deltaZoom: number;
}

/** Bundled DOM event handlers passed to {@link CameraControls._initListenerManagement}. */
interface EventHandlerBundle {
  onPointerDown: (event: PointerEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
  onMouseWheel: (event: WheelEvent) => void;
  onContextMenu: (event: Event) => void;
  onPointerLockChange: () => void;
  onPointerLockError: () => void;
}

// ─── CameraControls ─────────────────────────────────────────────────────────

/**
 * Orbit-style camera controller with smooth transitions.
 *
 * Supports `PerspectiveCamera` and `OrthographicCamera` with orbit rotation,
 * dolly/zoom, truck/pan, boundary constraints, collision detection,
 * and configurable mouse/touch input mapping.
 *
 * @example
 * ```ts
 * const controls = new CameraControls({
 *   camera,
 *   domElement: renderer.domElement,
 *   smoothTime: 0.3,
 * });
 *
 * // Programmatic rotation
 * await controls.rotateTo( Math.PI / 4, Math.PI / 3, true );
 *
 * // Per-frame update
 * controls.update( delta );
 * ```
 */
export class CameraControls implements IUpdatable, IDisposable {

  // ─── Static ──────────────────────────────────────────────────────────

  /**
   * Convenience accessor for the {@link ACTION} enum.
   *
   * @example
   * ```ts
   * controls.mouseButtons.left = CameraControls.ACTION.TRUCK;
   * ```
   * @category Statics
   */

  static get ACTION(): typeof ACTION {

    return ACTION;

  }

  /**
   * Create a bounding sphere from an `Object3D`.
   *
   * @param object  The object to compute the sphere for.
   * @param out     Optional receiving `Sphere`.
   * @returns       The bounding sphere.
   */
  static createBoundingSphere(object: THREE.Object3D, out: THREE.Sphere = new THREE.Sphere()): THREE.Sphere {

    const aabb = _box3A.setFromObject(object);
    if (aabb.isEmpty()) {

      out.set(_origin, 0);
      return out;

    }
    return aabb.getBoundingSphere(out);

  }

  // ─── Public properties ───────────────────────────────────────────────

  /** Minimum polar (vertical) angle in radians. @default 0 */
  minPolarAngle = 0;

  /** Maximum polar (vertical) angle in radians. @default Math.PI */
  maxPolarAngle = Math.PI;

  /** Minimum azimuth (horizontal) angle in radians. @default -Infinity */
  minAzimuthAngle = - Infinity;

  /** Maximum azimuth (horizontal) angle in radians. @default Infinity */
  maxAzimuthAngle = Infinity;

  /** Minimum dolly distance. @default Number.EPSILON */
  minDistance = Number.EPSILON;

  /** Maximum dolly distance. @default Infinity */
  maxDistance = Infinity;

  /**
   * `true` to push the target when dolly hits min/max distance.
   * @default false
   */
  infinityDolly = false;

  /** Minimum zoom factor (orthographic). @default 0.01 */
  minZoom = DEFAULT_MIN_ZOOM;

  /** Maximum zoom factor (orthographic). @default Infinity */
  maxZoom = Infinity;

  /** Smooth time for programmatic transitions (seconds). @default 0.25 */
  smoothTime = DEFAULT_SMOOTH_TIME;

  /** Smooth time while dragging (seconds). @default 0.125 */
  draggingSmoothTime = DEFAULT_DRAGGING_SMOOTH_TIME;

  /** Maximum transition speed. @default Infinity */
  maxSpeed = Infinity;

  /** Azimuth rotation speed multiplier. @default 1.0 */
  azimuthRotateSpeed = 1.0;

  /** Polar rotation speed multiplier. @default 1.0 */
  polarRotateSpeed = 1.0;

  /** Mouse-wheel dolly speed multiplier. @default 1.0 */
  dollySpeed = 1.0;

  /** Invert drag direction when dollying / zooming. @default false */
  dollyDragInverted = false;

  /** Truck / pedestal drag speed multiplier. @default 2.0 */
  truckSpeed = 2.0;

  /** Dolly toward the mouse cursor position. @default false */
  dollyToCursor = false;

  /** Drag translates the focal offset instead of trucking. @default false */
  dragToOffset = false;

  /** Boundary friction ratio (0 = hard clamp, 1 = no friction). @default 0 */
  boundaryFriction = 0.0;

  /** Movement threshold for `rest` event. @default 0.01 */
  restThreshold = DEFAULT_REST_THRESHOLD;

  /** Meshes for collision detection — camera won't pass through these. */
  colliderMeshes: THREE.Object3D[] = [];

  /** Mouse button → action mapping. */
  mouseButtons!: MouseButtons;

  /** Touch gesture → action mapping. */
  touches!: Touches;

  /**
   * Force-cancel user dragging.
   * @category Methods
   */
  cancel: () => void = () => {};

  /** Lock the pointer (experimental). @category Methods */
  lockPointer: () => void = () => {};

  /** Unlock the pointer (experimental). @category Methods */
  unlockPointer: () => void = () => {};

  /** Whether camera position should be enclosed in the boundary. @default false */
  boundaryEnclosesCamera = false;

  // ─── Internal state ──────────────────────────────────────────────────

  private _camera!: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private _yAxisUpSpace!: THREE.Quaternion;
  private _yAxisUpSpaceInverse!: THREE.Quaternion;
  private _state: ACTION = ACTION.NONE;
  private _enabled = true;
  private _domElement?: HTMLElement;
  private _viewport: THREE.Vector4 | null = null;

  // Dual-buffer: current / end values
  private _target!: THREE.Vector3;
  private _targetEnd!: THREE.Vector3;
  private _focalOffset!: THREE.Vector3;
  private _focalOffsetEnd!: THREE.Vector3;
  private _spherical!: THREE.Spherical;
  private _sphericalEnd!: THREE.Spherical;
  private _lastDistance!: number;
  private _zoom!: number;
  private _zoomEnd!: number;
  private _lastZoom!: number;

  // Reset snapshot
  private _cameraUp0!: THREE.Vector3;
  private _target0!: THREE.Vector3;
  private _position0!: THREE.Vector3;
  private _zoom0!: number;
  private _focalOffset0!: THREE.Vector3;

  // Dolly-to-cursor
  private _dollyControlCoord!: THREE.Vector2;
  private _changedDolly = 0;
  private _changedZoom = 0;

  // Collision near-plane corners
  private _nearPlaneCorners!: [ THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3 ];

  private _hasRested = true;

  // Boundary
  private _boundary!: THREE.Box3;
  private _boundaryEnclosesCamera = false;

  private _needsUpdate = true;
  private _updatedLastTime = false;
  private _elementRect = new DOMRect();

  // Dragging
  private _isDragging = false;
  private _dragNeedsUpdate = true;
  private _activePointers: PointerInput[] = [];
  private _lockedPointer: PointerInput | null = null;
  private _interactiveArea = new DOMRect(0, 0, 1, 1);

  // User-control tracking (chooses smoothTime vs draggingSmoothTime)
  private _isUserControllingRotate = false;
  private _isUserControllingDolly = false;
  private _isUserControllingTruck = false;
  private _isUserControllingOffset = false;
  private _isUserControllingZoom = false;
  private _lastDollyDirection: DOLLY_DIRECTION = DOLLY_DIRECTION.NONE;

  // Velocities for smoothDamp
  private _thetaVelocity: Ref = { value: 0 };
  private _phiVelocity: Ref = { value: 0 };
  private _radiusVelocity: Ref = { value: 0 };
  private _targetVelocity = new THREE.Vector3();
  private _focalOffsetVelocity = new THREE.Vector3();
  private _zoomVelocity: Ref = { value: 0 };

  // Event dispatcher (composition)
  private _dispatcher = new EventDispatcher();

  // ─── Constructor ─────────────────────────────────────────────────────

  /**
   * Create a new CameraControls instance.
   *
   * @param options  Constructor options (see {@link CameraControlsOptions}).
   */
  constructor(options: CameraControlsOptions) {

    const {
      camera,
      domElement,
      boundary,
      viewport,
      enabled,
    } = options;

    this._initCoreState(camera);
    this._initDefaultMappings(camera);
    this._applyOptionOverrides(options);
    this._initEventCallbacks(options);
    this._initBoundaryAndViewport(boundary, viewport);

    this._initEventHandlers();

    // Connect & initial update
    if (enabled !== undefined) {
      this._enabled = enabled;
    }

    if (domElement) {
      this.connect(domElement);
    }
    this.update(0);

  }

  // ─── Constructor helpers ─────────────────────────────────────────────

  /** @internal Create and wire up all DOM event handlers. */
  private _initEventHandlers(): void {

    // Pointer event handlers — drag state stored as instance fields
    this._dragStartPosition = new THREE.Vector2();
    this._lastDragPosition = new THREE.Vector2();
    this._dollyStart = new THREE.Vector2();

    const onPointerDown = this._createOnPointerDown();
    const onPointerMove = this._createOnPointerMove();
    const onPointerUp = this._createOnPointerUp();

    // Store refs so other handlers can add/remove these listeners
    this._onPointerMove = onPointerMove;
    this._onPointerUp = onPointerUp;

    const onMouseWheel = this._createOnMouseWheel();
    const onContextMenu = this._createOnContextMenu(onPointerMove, onPointerUp);

    const startDragging = this._createStartDragging();
    const dragging = this._createDragging();
    const endDragging = this._createEndDragging();

    // Wire up startDragging / dragging / endDragging
    this._startDragging = startDragging;
    this._dragging = dragging;
    this._endDragging = endDragging;

    // Pointer lock
    this.lockPointer = this._createLockPointer(onPointerMove, onPointerUp, startDragging);
    this.unlockPointer = this._createUnlockPointer();

    const onPointerLockChange = (): void => {

      const isPointerLockActive = this._domElement &&
        this._domElement.ownerDocument.pointerLockElement === this._domElement;
      if (! isPointerLockActive) {
        this.unlockPointer();
      }

    };

    const onPointerLockError = (): void => {

      this.unlockPointer();

    };

    // Store refs so lock/unlock handlers can add/remove these listeners
    this._onPointerLockChange = onPointerLockChange;
    this._onPointerLockError = onPointerLockError;

    this._initListenerManagement({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onMouseWheel,
      onContextMenu,
      onPointerLockChange,
      onPointerLockError,
    });

  }

  /** @internal Define add/remove/cancel listener closures bound to the given handlers. */
  private _initListenerManagement(handlers: EventHandlerBundle): void {

    const {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onMouseWheel,
      onContextMenu,
      onPointerLockChange,
      onPointerLockError,
    } = handlers;

    // Event listener management
    this._addAllEventListeners = (domEl: HTMLElement): void => {

      this._domElement = domEl;
      this._domElement.style.touchAction = 'none';
      this._domElement.style.userSelect = 'none';

      this._domElement.style.webkitUserSelect = 'none';

      this._domElement.addEventListener('pointerdown', onPointerDown);
      this._domElement.addEventListener('pointercancel', onPointerUp);
      this._domElement.addEventListener('wheel', onMouseWheel);
      this._domElement.addEventListener('contextmenu', onContextMenu);

    };

    this._removeAllEventListeners = (): void => {

      if (! this._domElement) {
        return;
      }

      this._domElement.style.touchAction = '';
      this._domElement.style.userSelect = '';

      this._domElement.style.webkitUserSelect = '';

      this._domElement.removeEventListener('pointerdown', onPointerDown);
      this._domElement.removeEventListener('pointercancel', onPointerUp);
      this._domElement.removeEventListener('wheel', onMouseWheel);
      this._domElement.removeEventListener('contextmenu', onContextMenu);
      this._domElement.ownerDocument.removeEventListener('pointermove', onPointerMove);
      this._domElement.ownerDocument.removeEventListener('pointerup', onPointerUp);
      this._domElement.ownerDocument.removeEventListener('pointerlockchange', onPointerLockChange);
      this._domElement.ownerDocument.removeEventListener('pointerlockerror', onPointerLockError);

    };

    this.cancel = (): void => {

      if (this._state === ACTION.NONE) {
        return;
      }
      this._state = ACTION.NONE;
      this._activePointers.length = 0;
      this._endDragging();

    };

  }

  /** @internal Initialize core camera and orbit state. */
  private _initCoreState(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {

    this._camera = camera;
    this._yAxisUpSpace = new THREE.Quaternion().setFromUnitVectors(camera.up, _axisY);
    this._yAxisUpSpaceInverse = this._yAxisUpSpace.clone().invert();
    this._state = ACTION.NONE;

    this._target = new THREE.Vector3();
    this._targetEnd = this._target.clone();

    this._focalOffset = new THREE.Vector3();
    this._focalOffsetEnd = this._focalOffset.clone();

    this._spherical = new THREE.Spherical()
      .setFromVector3(_v3A.copy(this._camera.position)
        .sub(this._target)
        .applyQuaternion(this._yAxisUpSpace));
    this._sphericalEnd = this._spherical.clone();
    this._lastDistance = this._spherical.radius;

    this._zoom = this._camera.zoom;
    this._zoomEnd = this._zoom;
    this._lastZoom = this._zoom;

    this._nearPlaneCorners = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
    ];
    this._updateNearPlaneCorners();

    this._boundary = new THREE.Box3(
      new THREE.Vector3(- Infinity, - Infinity, - Infinity),
      new THREE.Vector3(Infinity, Infinity, Infinity),
    );

    this._cameraUp0 = this._camera.up.clone();
    this._target0 = this._target.clone();
    this._position0 = this._camera.position.clone();
    this._zoom0 = this._zoom;
    this._focalOffset0 = this._focalOffset.clone();

    this._dollyControlCoord = new THREE.Vector2();

  }

  /** @internal Initialize default mouse/touch mappings. */
  private _initDefaultMappings(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): void {

    this.mouseButtons = {
      left: ACTION.ROTATE,
      middle: ACTION.DOLLY,
      right: ACTION.TRUCK,
      wheel: getDefaultWheelAction(camera),
    };

    this.touches = {
      one: ACTION.TOUCH_ROTATE,
      two: getDefaultTwoTouchAction(camera),
      three: ACTION.TOUCH_TRUCK,
    };

  }

  /** @internal Apply optional overrides from constructor options. */

  private _applyOptionOverrides(options: CameraControlsOptions): void {

    const overrides: [ keyof CameraControlsOptions, unknown ][] = [
      ['minPolarAngle', options.minPolarAngle],
      ['maxPolarAngle', options.maxPolarAngle],
      ['minAzimuthAngle', options.minAzimuthAngle],
      ['maxAzimuthAngle', options.maxAzimuthAngle],
      ['minDistance', options.minDistance],
      ['maxDistance', options.maxDistance],
      ['infinityDolly', options.infinityDolly],
      ['minZoom', options.minZoom],
      ['maxZoom', options.maxZoom],
      ['smoothTime', options.smoothTime],
      ['draggingSmoothTime', options.draggingSmoothTime],
      ['maxSpeed', options.maxSpeed],
      ['azimuthRotateSpeed', options.azimuthRotateSpeed],
      ['polarRotateSpeed', options.polarRotateSpeed],
      ['dollySpeed', options.dollySpeed],
      ['dollyDragInverted', options.dollyDragInverted],
      ['truckSpeed', options.truckSpeed],
      ['dollyToCursor', options.dollyToCursor],
      ['dragToOffset', options.dragToOffset],
      ['boundaryFriction', options.boundaryFriction],
      ['restThreshold', options.restThreshold],
    ];

    for (const [key, value] of overrides) {

      if (value !== undefined) {
        (this as Record<string, unknown>)[key as string] = value;
      }

    }

    if (options.boundaryEnclosesCamera !== undefined) {
      this._boundaryEnclosesCamera = options.boundaryEnclosesCamera;
    }
    if (options.mouseButtons) {
      this.mouseButtons = options.mouseButtons;
    }
    if (options.touches) {
      this.touches = options.touches;
    }
    if (options.colliderMeshes) {
      this.colliderMeshes = options.colliderMeshes;
    }

  }

  /** @internal Register event callback shortcuts. */
  private _initEventCallbacks(options: CameraControlsOptions): void {

    const eventMap: [ string, (() => void) | undefined ][] = [
      ['update', options.onUpdate],
      ['wake', options.onWake],
      ['rest', options.onRest],
      ['sleep', options.onSleep],
      ['transitionstart', options.onTransitionStart],
      ['controlstart', options.onControlStart],
      ['control', options.onControl],
      ['controlend', options.onControlEnd],
    ];

    for (const [type, callback] of eventMap) {

      if (callback) {
        this.addEventListener(
          type as CameraControlsEventType,
          callback,
        );
      }

    }

  }

  /** @internal Initialize boundary and viewport. */
  private _initBoundaryAndViewport(
    boundary?: THREE.Box3,
    viewport?: { x: number; y: number; width: number; height: number },
  ): void {

    if (boundary) {
      this.setBoundary(boundary);
    }
    if (viewport) {
      this.setViewport(viewport);
    }

  }

  // ─── Pointer event handler factories ─────────────────────────────────

  /** @internal */
  private _createOnPointerDown(): (event: PointerEvent) => void {

    return (event: PointerEvent): void => {

      if (! this._enabled || ! this._domElement) {
        return;
      }

      if (! isPointerInInteractiveArea(event, this._interactiveArea, this._domElement)) {
        return;
      }

      const mouseButton = getMouseButton(event);

      if (mouseButton !== null) {

        const zombiePointer = this._findPointerByMouseButton(mouseButton);
        if (zombiePointer) {
          this._disposePointer(zombiePointer);
        }

      }

      if ((event.buttons & MOUSE_BUTTON.LEFT) === MOUSE_BUTTON.LEFT && this._lockedPointer) {
        return;
      }

      const pointer: PointerInput = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        deltaX: 0,
        deltaY: 0,
        mouseButton,
      };
      this._activePointers.push(pointer);

      this._domElement.ownerDocument.removeEventListener('pointermove', this._onPointerMove);
      this._domElement.ownerDocument.removeEventListener('pointerup', this._onPointerUp);

      this._domElement.ownerDocument.addEventListener('pointermove', this._onPointerMove);
      this._domElement.ownerDocument.addEventListener('pointerup', this._onPointerUp);

      this._isDragging = true;
      this._startDragging(event);

    };

  }

  /** @internal */
  private _createOnPointerMove(): (event: PointerEvent) => void {

    return (event: PointerEvent): void => {

      if (event.cancelable) {
        event.preventDefault();
      }

      const pointerId = event.pointerId;
      const pointer = this._lockedPointer || this._findPointerById(pointerId);
      if (! pointer) {
        return;
      }

      pointer.clientX = event.clientX;
      pointer.clientY = event.clientY;
      pointer.deltaX = event.movementX;
      pointer.deltaY = event.movementY;

      this._state = 0;

      if (event.pointerType === 'touch') {

        this._state = getTouchAction(this.touches, this._activePointers.length);

      } else {

        if (
          (! this._isDragging && this._lockedPointer) ||
          (this._isDragging && (event.buttons & MOUSE_BUTTON.LEFT) === MOUSE_BUTTON.LEFT)
        ) {

          this._state = this._state | this.mouseButtons.left;

        }

        if (this._isDragging && (event.buttons & MOUSE_BUTTON.MIDDLE) === MOUSE_BUTTON.MIDDLE) {

          this._state = this._state | this.mouseButtons.middle;

        }

        if (this._isDragging && (event.buttons & MOUSE_BUTTON.RIGHT) === MOUSE_BUTTON.RIGHT) {

          this._state = this._state | this.mouseButtons.right;

        }

      }

      this._dragging();

    };

  }

  /** @internal */
  private _createOnPointerUp(): (event: PointerEvent) => void {

    return (event: PointerEvent): void => {

      const pointer = this._findPointerById(event.pointerId);
      if (pointer && pointer === this._lockedPointer) {
        return;
      }

      if (pointer) {
        this._disposePointer(pointer);
      }

      if (event.pointerType === 'touch') {

        this._state = getTouchAction(this.touches, this._activePointers.length);

      } else {

        this._state = ACTION.NONE;

      }

      this._endDragging();

    };

  }

  /** @internal */

  private _createOnMouseWheel(): (event: WheelEvent) => void {

    return (event: WheelEvent): void => {

      if (! this._domElement) {
        return;
      }
      if (! this._enabled || this.mouseButtons.wheel === ACTION.NONE) {
        return;
      }

      if (! isPointerInInteractiveArea(event, this._interactiveArea, this._domElement)) {
        return;
      }

      event.preventDefault();

      if (
        this.dollyToCursor ||
        this.mouseButtons.wheel === ACTION.ROTATE ||
        this.mouseButtons.wheel === ACTION.TRUCK
      ) {

        const now = performance.now();
        if (this._lastScrollTimeStamp - now < SCROLL_TIMESTAMP_THRESHOLD) {
          this._getClientRect(this._elementRect);
        }
        this._lastScrollTimeStamp = now;

      }

      const deltaYFactor = isMac ? MAC_SCROLL_FACTOR : NON_MAC_SCROLL_FACTOR;
      const delta = (event.deltaMode === 1 && ! event.ctrlKey)
        ? event.deltaY / deltaYFactor
        : event.deltaY / (deltaYFactor * FINE_SCROLL_DIVISOR);
      const x = this.dollyToCursor
        ? (event.clientX - this._elementRect.x) / this._elementRect.width * 2 - 1
        : 0;
      const y = this.dollyToCursor
        ? (event.clientY - this._elementRect.y) / this._elementRect.height * Y_NDC_FLIP + 1
        : 0;

      const controlMode = event.ctrlKey ? this.touches.two : this.mouseButtons.wheel;
      this._applyWheelControlMode({
        controlMode,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        delta,
        x,
        y,
      });

      this._dispatcher.dispatchEvent({ type: 'control' });

    };

  }

  /** @internal Apply wheel/touch control mode action. */
  private _applyWheelControlMode(input: WheelControlInput): void {

    const {
      controlMode,
      deltaX,
      deltaY,
      delta,
      x,
      y,
    } = input;

    switch (controlMode) {

      case ACTION.ROTATE: {
        this._rotateInternal(deltaX, deltaY);
        this._isUserControllingRotate = true;
        break;
      }
      case ACTION.TRUCK: {
        this._truckInternal(deltaX, deltaY, false, false);
        this._isUserControllingTruck = true;
        break;
      }
      case ACTION.SCREEN_PAN: {
        this._truckInternal(deltaX, deltaY, false, true);
        this._isUserControllingTruck = true;
        break;
      }
      case ACTION.OFFSET: {
        this._truckInternal(deltaX, deltaY, true, false);
        this._isUserControllingOffset = true;
        break;
      }
      case ACTION.DOLLY:
      case ACTION.TOUCH_DOLLY:
      case ACTION.TOUCH_DOLLY_ROTATE:
      case ACTION.TOUCH_DOLLY_TRUCK:
      case ACTION.TOUCH_DOLLY_OFFSET: {
        this._dollyInternal(- delta, x, y);
        this._isUserControllingDolly = true;
        break;
      }
      case ACTION.ZOOM:
      case ACTION.TOUCH_ZOOM:
      case ACTION.TOUCH_ZOOM_ROTATE:
      case ACTION.TOUCH_ZOOM_TRUCK:
      case ACTION.TOUCH_ZOOM_OFFSET: {
        this._zoomInternal(- delta, x, y);
        this._isUserControllingZoom = true;
        break;
      }
      default:
        break;

    }

  }

  /** @internal */
  private _createOnContextMenu(
    onPointerMove: (event: PointerEvent) => void,
    onPointerUp: (event: PointerEvent) => void,
  ): (event: Event) => void {

    return (event: Event): void => {

      if (! this._domElement || ! this._enabled) {
        return;
      }

      if (this.mouseButtons.right === CameraControls.ACTION.NONE) {

        const pointerId = event instanceof PointerEvent ? event.pointerId : 0;
        const pointer = this._findPointerById(pointerId);
        if (pointer) {
          this._disposePointer(pointer);
        }

        this._domElement.ownerDocument.removeEventListener('pointermove', onPointerMove);
        this._domElement.ownerDocument.removeEventListener('pointerup', onPointerUp);
        return;

      }

      event.preventDefault();

    };

  }

  // ─── Drag lifecycle factories ────────────────────────────────────────

  /** @internal */

  private _createStartDragging(): (event?: PointerEvent) => void {

    return (event?: PointerEvent): void => {

      if (! this._enabled) {
        return;
      }

      extractClientCoordFromEvent(this._activePointers, _v2);
      this._getClientRect(this._elementRect);
      this._dragStartPosition.copy(_v2);
      this._lastDragPosition.copy(_v2);

      const isMultiTouch = this._activePointers.length >= 2;
      if (isMultiTouch) {

        const dx = _v2.x - this._activePointers[ 1 ].clientX;
        const dy = _v2.y - this._activePointers[ 1 ].clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        this._dollyStart.set(0, distance);

        const x = (this._activePointers[ 0 ].clientX + this._activePointers[ 1 ].clientX) * CENTROID_HALF;
        const y = (this._activePointers[ 0 ].clientY + this._activePointers[ 1 ].clientY) * CENTROID_HALF;
        this._lastDragPosition.set(x, y);

      }

      this._state = 0;

      if (! event) {

        if (this._lockedPointer) {
          this._state = this._state | this.mouseButtons.left;
        }

      } else if ('pointerType' in event && event.pointerType === 'touch') {

        this._state = getTouchAction(this.touches, this._activePointers.length);

      } else {

        if (! this._lockedPointer && (event.buttons & MOUSE_BUTTON.LEFT) === MOUSE_BUTTON.LEFT) {
          this._state = this._state | this.mouseButtons.left;
        }
        if ((event.buttons & MOUSE_BUTTON.MIDDLE) === MOUSE_BUTTON.MIDDLE) {
          this._state = this._state | this.mouseButtons.middle;
        }
        if ((event.buttons & MOUSE_BUTTON.RIGHT) === MOUSE_BUTTON.RIGHT) {
          this._state = this._state | this.mouseButtons.right;
        }

      }

      this._stopCurrentMovements();
      this._dispatcher.dispatchEvent({ type: 'controlstart' });

    };

  }

  /** @internal Stop current movements based on active action state. */
  private _stopCurrentMovements(): void {

    if (hasRotateAction(this._state)) {
      this._sphericalEnd.theta = this._spherical.theta;
      this._sphericalEnd.phi = this._spherical.phi;
      this._thetaVelocity.value = 0;
      this._phiVelocity.value = 0;
    }

    if (hasTruckAction(this._state)) {
      this._targetEnd.copy(this._target);
      this._targetVelocity.set(0, 0, 0);
    }

    if (hasDollyAction(this._state)) {
      this._sphericalEnd.radius = this._spherical.radius;
      this._radiusVelocity.value = 0;
    }

    if (hasZoomAction(this._state)) {
      this._zoomEnd = this._zoom;
      this._zoomVelocity.value = 0;
    }

    if (hasOffsetAction(this._state)) {
      this._focalOffsetEnd.copy(this._focalOffset);
      this._focalOffsetVelocity.set(0, 0, 0);
    }

  }

  /** @internal */

  private _createDragging(): () => void {

    return (): void => {

      if (! this._enabled || ! this._dragNeedsUpdate) {
        return;
      }
      this._dragNeedsUpdate = false;

      extractClientCoordFromEvent(this._activePointers, _v2);

      const isPointerLockActive = this._domElement &&
        this._domElement.ownerDocument.pointerLockElement === this._domElement;
      const lockedPointer = isPointerLockActive
        ? this._lockedPointer || this._activePointers[ 0 ]
        : null;
      const deltaX = lockedPointer ? - lockedPointer.deltaX : this._lastDragPosition.x - _v2.x;
      const deltaY = lockedPointer ? - lockedPointer.deltaY : this._lastDragPosition.y - _v2.y;

      this._lastDragPosition.copy(_v2);

      if (hasRotateAction(this._state)) {
        this._rotateInternal(deltaX, deltaY);
        this._isUserControllingRotate = true;
      }

      this._applyMouseDollyZoom(deltaY);
      this._applyTouchDollyZoom();

      if (hasTruckOnlyAction(this._state)) {
        this._truckInternal(deltaX, deltaY, false, false);
        this._isUserControllingTruck = true;
      }

      if (hasScreenPanAction(this._state)) {
        this._truckInternal(deltaX, deltaY, false, true);
        this._isUserControllingTruck = true;
      }

      if (hasOffsetAction(this._state)) {
        this._truckInternal(deltaX, deltaY, true, false);
        this._isUserControllingOffset = true;
      }

      this._dispatcher.dispatchEvent({ type: 'control' });

    };

  }

  /** @internal Apply mouse dolly/zoom drag. */
  private _applyMouseDollyZoom(deltaY: number): void {

    if (
      (this._state & ACTION.DOLLY) !== ACTION.DOLLY &&
      (this._state & ACTION.ZOOM) !== ACTION.ZOOM
    ) {
      return;
    }

    const dollyX = this.dollyToCursor
      ? (this._dragStartPosition.x - this._elementRect.x) / this._elementRect.width * 2 - 1
      : 0;
    const dollyY = this.dollyToCursor
      ? (this._dragStartPosition.y - this._elementRect.y) / this._elementRect.height * Y_NDC_FLIP + 1
      : 0;
    const dollyDirection = this.dollyDragInverted ? - 1 : 1;

    if ((this._state & ACTION.DOLLY) === ACTION.DOLLY) {

      this._dollyInternal(dollyDirection * deltaY * TOUCH_DOLLY_FACTOR, dollyX, dollyY);
      this._isUserControllingDolly = true;

    } else {

      this._zoomInternal(dollyDirection * deltaY * TOUCH_DOLLY_FACTOR, dollyX, dollyY);
      this._isUserControllingZoom = true;

    }

  }

  /** @internal Apply touch dolly/zoom drag. */
  private _applyTouchDollyZoom(): void {

    if (! hasTouchDollyOrZoomAction(this._state)) {
      return;
    }

    const dx = _v2.x - this._activePointers[ 1 ].clientX;
    const dy = _v2.y - this._activePointers[ 1 ].clientY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const dollyDelta = this._dollyStart.y - distance;
    this._dollyStart.set(0, distance);

    const dollyX = this.dollyToCursor
      ? (this._lastDragPosition.x - this._elementRect.x) / this._elementRect.width * 2 - 1
      : 0;
    const dollyY = this.dollyToCursor
      ? (this._lastDragPosition.y - this._elementRect.y) / this._elementRect.height * Y_NDC_FLIP + 1
      : 0;

    if (hasTouchDollyAction(this._state)) {

      this._dollyInternal(dollyDelta * TOUCH_DOLLY_FACTOR, dollyX, dollyY);
      this._isUserControllingDolly = true;

    } else {

      this._zoomInternal(dollyDelta * TOUCH_DOLLY_FACTOR, dollyX, dollyY);
      this._isUserControllingZoom = true;

    }

  }

  /** @internal */
  private _createEndDragging(): () => void {

    return (): void => {

      extractClientCoordFromEvent(this._activePointers, _v2);
      this._lastDragPosition.copy(_v2);
      this._dragNeedsUpdate = false;

      if (
        this._activePointers.length === 0 ||
        (this._activePointers.length === 1 && this._activePointers[ 0 ] === this._lockedPointer)
      ) {

        this._isDragging = false;

      }

      if (this._activePointers.length === 0 && this._domElement) {

        this._domElement.ownerDocument.removeEventListener('pointermove', this._onPointerMove);
        this._domElement.ownerDocument.removeEventListener('pointerup', this._onPointerUp);
        this._dispatcher.dispatchEvent({ type: 'controlend' });

      }

    };

  }

  // ─── Pointer lock factories ──────────────────────────────────────────

  /** @internal */
  private _createLockPointer(
    onPointerMove: (event: PointerEvent) => void,
    onPointerUp: (event: PointerEvent) => void,
    startDragging: (event?: PointerEvent) => void,
  ): () => void {

    return (): void => {

      if (! this._enabled || ! this._domElement) {
        return;
      }
      this.cancel();

      this._lockedPointer = {
        pointerId: - 1,
        clientX: 0,
        clientY: 0,
        deltaX: 0,
        deltaY: 0,
        mouseButton: null,
      };
      this._activePointers.push(this._lockedPointer);

      this._domElement.ownerDocument.removeEventListener('pointermove', onPointerMove);
      this._domElement.ownerDocument.removeEventListener('pointerup', onPointerUp);

      this._domElement.requestPointerLock();
      this._domElement.ownerDocument.addEventListener('pointerlockchange', this._onPointerLockChange);
      this._domElement.ownerDocument.addEventListener('pointerlockerror', this._onPointerLockError);

      this._domElement.ownerDocument.addEventListener('pointermove', onPointerMove);
      this._domElement.ownerDocument.addEventListener('pointerup', onPointerUp);

      startDragging();

    };

  }

  /** @internal */
  private _createUnlockPointer(): () => void {

    return (): void => {

      if (this._lockedPointer !== null) {

        this._disposePointer(this._lockedPointer);
        this._lockedPointer = null;

      }

      this._domElement?.ownerDocument.exitPointerLock();
      this._domElement?.ownerDocument.removeEventListener('pointerlockchange', this._onPointerLockChange);
      this._domElement?.ownerDocument.removeEventListener('pointerlockerror', this._onPointerLockError);
      this.cancel();

    };

  }

  // ─── Getters / Setters ───────────────────────────────────────────────

  /** The camera being controlled. @category Properties */
  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {

    return this._camera;

  }

  set camera(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera) {

    this._camera = camera;
    this.updateCameraUp();
    this._camera.updateProjectionMatrix();
    this._updateNearPlaneCorners();
    this._needsUpdate = true;

  }

  /** Whether controls respond to input. @category Properties */
  get enabled(): boolean {

    return this._enabled;

  }

  set enabled(value: boolean) {

    this._enabled = value;

    if (! this._domElement) {
      return;
    }
    if (value) {

      this._domElement.style.touchAction = 'none';
      this._domElement.style.userSelect = 'none';

      this._domElement.style.webkitUserSelect = 'none';

    } else {

      this.cancel();
      this._domElement.style.touchAction = '';
      this._domElement.style.userSelect = '';

      this._domElement.style.webkitUserSelect = '';

    }

  }

  /** Whether controls are actively updating. @category Properties */
  get active(): boolean {

    return ! this._hasRested;

  }

  /** Current user action bitmask. @category Properties */
  get currentAction(): ACTION {

    return this._state;

  }

  /** Current dolly distance. @category Properties */
  get distance(): number {

    return this._spherical.radius;

  }

  set distance(distance: number) {

    if (this._spherical.radius === distance && this._sphericalEnd.radius === distance) {
      return;
    }
    this._spherical.radius = distance;
    this._sphericalEnd.radius = distance;
    this._needsUpdate = true;

  }

  /** Current azimuth angle (radians). @category Properties */
  get azimuthAngle(): number {

    return this._spherical.theta;

  }

  set azimuthAngle(azimuthAngle: number) {

    if (this._spherical.theta === azimuthAngle && this._sphericalEnd.theta === azimuthAngle) {
      return;
    }
    this._spherical.theta = azimuthAngle;
    this._sphericalEnd.theta = azimuthAngle;
    this._needsUpdate = true;

  }

  /** Current polar angle (radians). @category Properties */
  get polarAngle(): number {

    return this._spherical.phi;

  }

  set polarAngle(polarAngle: number) {

    if (this._spherical.phi === polarAngle && this._sphericalEnd.phi === polarAngle) {
      return;
    }
    this._spherical.phi = polarAngle;
    this._sphericalEnd.phi = polarAngle;
    this._needsUpdate = true;

  }

  /**
   * Get the interactive drag area.
   * @category Properties
   */
  get interactiveArea(): DOMRect {

    return this._interactiveArea;

  }

  /**
   * Set the interactive drag area within the domElement.
   * Values are normalized 0-1.
   * @category Properties
   */
  set interactiveArea(interactiveArea: DOMRect | { x: number; y: number; width: number; height: number }) {

    this._interactiveArea.width = clamp(interactiveArea.width, 0, 1);
    this._interactiveArea.height = clamp(interactiveArea.height, 0, 1);
    this._interactiveArea.x = clamp(interactiveArea.x, 0, 1 - this._interactiveArea.width);
    this._interactiveArea.y = clamp(interactiveArea.y, 0, 1 - this._interactiveArea.height);

  }

  // ─── Event delegation ────────────────────────────────────────────────

  /**
   * Add a typed event listener.
   *
   * | Event               | Timing |
   * |---------------------|--------|
   * | `'controlstart'`    | User starts dragging |
   * | `'control'`         | User is dragging |
   * | `'controlend'`      | User stops dragging |
   * | `'transitionstart'` | Any transition starts |
   * | `'update'`          | Camera position updated |
   * | `'wake'`            | Camera starts moving |
   * | `'rest'`            | Movement below `restThreshold` |
   * | `'sleep'`           | Camera stops moving |
   *
   * @category Methods
   */
  addEventListener<K extends CameraControlsEventType>(
    type: K,
    listener: (event: CameraControlsEventMap[ K ]) => void,
  ): void {

    this._dispatcher.addEventListener(type, listener);

  }

  /**
   * Remove a typed event listener.
   * @category Methods
   */
  removeEventListener<K extends CameraControlsEventType>(
    type: K,
    listener: (event: CameraControlsEventMap[ K ]) => void,
  ): void {

    this._dispatcher.removeEventListener(type, listener);

  }

  // ─── Rotation methods ────────────────────────────────────────────────

  /**
   * Rotate by delta angles (radians).
   * @category Methods
   */
  rotate(azimuthAngle: number, polarAngle: number, enableTransition: boolean = false): Promise<void> {

    return this.rotateTo(
      this._sphericalEnd.theta + azimuthAngle,
      this._sphericalEnd.phi + polarAngle,
      enableTransition,
    );

  }

  /**
   * Rotate to absolute azimuth angle (radians).
   * @category Methods
   */
  rotateAzimuthTo(azimuthAngle: number, enableTransition: boolean = false): Promise<void> {

    return this.rotateTo(azimuthAngle, this._sphericalEnd.phi, enableTransition);

  }

  /**
   * Rotate to absolute polar angle (radians).
   * @category Methods
   */
  rotatePolarTo(polarAngle: number, enableTransition: boolean = false): Promise<void> {

    return this.rotateTo(this._sphericalEnd.theta, polarAngle, enableTransition);

  }

  /**
   * Rotate to absolute azimuth and polar angles (radians).
   * @category Methods
   */
  rotateTo(azimuthAngle: number, polarAngle: number, enableTransition: boolean = false): Promise<void> {

    this._isUserControllingRotate = false;

    const theta = clamp(azimuthAngle, this.minAzimuthAngle, this.maxAzimuthAngle);
    const phi = clamp(polarAngle, this.minPolarAngle, this.maxPolarAngle);

    this._sphericalEnd.theta = theta;
    this._sphericalEnd.phi = phi;
    this._sphericalEnd.makeSafe();

    this._needsUpdate = true;

    if (! enableTransition) {

      this._spherical.theta = this._sphericalEnd.theta;
      this._spherical.phi = this._sphericalEnd.phi;

    }

    const resolveImmediately = shouldResolveImmediately(enableTransition, [
      approxEquals(this._spherical.theta, this._sphericalEnd.theta, this.restThreshold),
      approxEquals(this._spherical.phi, this._sphericalEnd.phi, this.restThreshold),
    ]);
    return this._createOnRestPromise(resolveImmediately);

  }

  // ─── Dolly / Zoom ───────────────────────────────────────────────────

  /**
   * Dolly by a distance delta. PerspectiveCamera only.
   * @category Methods
   */
  dolly(distance: number, enableTransition: boolean = false): Promise<void> {

    return this.dollyTo(this._sphericalEnd.radius - distance, enableTransition);

  }

  /**
   * Dolly to absolute distance. PerspectiveCamera only.
   * @category Methods
   */
  dollyTo(distance: number, enableTransition: boolean = false): Promise<void> {

    this._isUserControllingDolly = false;
    this._lastDollyDirection = DOLLY_DIRECTION.NONE;
    this._changedDolly = 0;
    return this._dollyToNoClamp(
      clamp(distance, this.minDistance, this.maxDistance),
      enableTransition,
    );

  }

  /** @internal Dolly without clamping to min/max distance. */
  private _dollyToNoClamp(distance: number, enableTransition: boolean = false): Promise<void> {

    const lastRadius = this._sphericalEnd.radius;
    const hasCollider = this.colliderMeshes.length >= 1;

    if (hasCollider) {

      const maxDistanceByCollisionTest = this._collisionTest();
      const isCollided = approxEquals(maxDistanceByCollisionTest, this._spherical.radius);
      const isDollyIn = lastRadius > distance;

      if (! isDollyIn && isCollided) {
        return Promise.resolve();
      }
      this._sphericalEnd.radius = Math.min(distance, maxDistanceByCollisionTest);

    } else {

      this._sphericalEnd.radius = distance;

    }

    this._needsUpdate = true;

    if (! enableTransition) {

      this._spherical.radius = this._sphericalEnd.radius;

    }

    const resolveImmediately = shouldResolveImmediately(enableTransition, [
      approxEquals(this._spherical.radius, this._sphericalEnd.radius, this.restThreshold),
    ]);
    return this._createOnRestPromise(resolveImmediately);

  }

  /**
   * Dolly in without changing distance — moves the target instead.
   * @category Methods
   */
  dollyInFixed(distance: number, enableTransition: boolean = false): Promise<void> {

    this._targetEnd.add(this._getCameraDirection(_cameraDirection).multiplyScalar(distance));

    if (! enableTransition) {

      this._target.copy(this._targetEnd);

    }

    const resolveImmediately = shouldResolveImmediately(enableTransition, [
      approxEquals3(this._target, this._targetEnd, this.restThreshold),
    ]);
    return this._createOnRestPromise(resolveImmediately);

  }

  /**
   * Zoom by a delta. OrthographicCamera only.
   * @category Methods
   */
  zoom(zoomStep: number, enableTransition: boolean = false): Promise<void> {

    return this.zoomTo(this._zoomEnd + zoomStep, enableTransition);

  }

  /**
   * Zoom to an absolute value.
   * @category Methods
   */
  zoomTo(zoom: number, enableTransition: boolean = false): Promise<void> {

    this._isUserControllingZoom = false;
    this._zoomEnd = clamp(zoom, this.minZoom, this.maxZoom);
    this._needsUpdate = true;

    if (! enableTransition) {

      this._zoom = this._zoomEnd;

    }

    const resolveImmediately = shouldResolveImmediately(enableTransition, [
      approxEquals(this._zoom, this._zoomEnd, this.restThreshold),
    ]);
    this._changedZoom = 0;
    return this._createOnRestPromise(resolveImmediately);

  }

  // ─── Movement ────────────────────────────────────────────────────────

  /**
   * Truck / pedestal parallel to the screen plane.
   * @category Methods
   */
  truck(x: number, y: number, enableTransition: boolean = false): Promise<void> {

    this._camera.updateMatrix();

    _xColumn.setFromMatrixColumn(this._camera.matrix, 0);
    _yColumn.setFromMatrixColumn(this._camera.matrix, 1);
    _xColumn.multiplyScalar(x);
    _yColumn.multiplyScalar(- y);

    const offset = _v3A.copy(_xColumn).add(_yColumn);
    const to = _v3B.copy(this._targetEnd).add(offset);
    return this.moveTo(to.x, to.y, to.z, enableTransition);

  }

  /**
   * Move forward / backward along the camera's view direction.
   * @category Methods
   */
  forward(distance: number, enableTransition: boolean = false): Promise<void> {

    _v3A.setFromMatrixColumn(this._camera.matrix, 0);
    _v3A.crossVectors(this._camera.up, _v3A);
    _v3A.multiplyScalar(distance);

    const to = _v3B.copy(this._targetEnd).add(_v3A);
    return this.moveTo(to.x, to.y, to.z, enableTransition);

  }

  /**
   * Move up / down along the camera's up vector.
   * @category Methods
   */
  elevate(height: number, enableTransition: boolean = false): Promise<void> {

    _v3A.copy(this._camera.up).multiplyScalar(height);
    return this.moveTo(
      this._targetEnd.x + _v3A.x,
      this._targetEnd.y + _v3A.y,
      this._targetEnd.z + _v3A.z,
      enableTransition,
    );

  }

  /**
   * Move the orbit target to a new position.
   * @category Methods
   */
  moveTo(x: number, y: number, z: number, enableTransition: boolean = false): Promise<void> {

    this._isUserControllingTruck = false;

    const offset = _v3A.set(x, y, z).sub(this._targetEnd);
    this._encloseToBoundary(this._targetEnd, offset, this.boundaryFriction);

    this._needsUpdate = true;

    if (! enableTransition) {

      this._target.copy(this._targetEnd);

    }

    const resolveImmediately = shouldResolveImmediately(enableTransition, [
      approxEquals3(this._target, this._targetEnd, this.restThreshold),
    ]);
    return this._createOnRestPromise(resolveImmediately);

  }

  /**
   * Look in the direction of a given world point.
   * @category Methods
   */
  lookInDirectionOf(x: number, y: number, z: number, enableTransition: boolean = false): Promise<void> {

    const point = _v3A.set(x, y, z);
    const direction = point.sub(this._targetEnd).normalize();
    const position = direction.multiplyScalar(- this._sphericalEnd.radius).add(this._targetEnd);
    return this.setPosition(position.x, position.y, position.z, enableTransition);

  }

  // ─── LookAt / Position / Target ──────────────────────────────────────

  /**
   * Set camera position and look-at target simultaneously.
   * @category Methods
   */
  // eslint-disable-next-line max-params -- mirrors camera-controls API: position xyz + target xyz + enableTransition
  setLookAt(
    positionX: number, positionY: number, positionZ: number,
    targetX: number, targetY: number, targetZ: number,
    enableTransition: boolean = false,
  ): Promise<void> {

    this._isUserControllingRotate = false;
    this._isUserControllingDolly = false;
    this._isUserControllingTruck = false;
    this._lastDollyDirection = DOLLY_DIRECTION.NONE;
    this._changedDolly = 0;

    const target = _v3B.set(targetX, targetY, targetZ);
    const position = _v3A.set(positionX, positionY, positionZ);

    this._targetEnd.copy(target);
    position.sub(target);

    if (approxZero(position.x)) {
      position.x = 0;
    }
    if (approxZero(position.y)) {
      position.y = 0;
    }
    if (approxZero(position.z)) {
      position.z = 0;
    }

    this._sphericalEnd.setFromVector3(position.applyQuaternion(this._yAxisUpSpace));

    this._needsUpdate = true;

    if (! enableTransition) {

      this._target.copy(this._targetEnd);
      this._spherical.copy(this._sphericalEnd);

    }

    const resolveImmediately = shouldResolveImmediately(enableTransition, [
      approxEquals3(this._target, this._targetEnd, this.restThreshold),
      approxEquals(this._spherical.theta, this._sphericalEnd.theta, this.restThreshold),
      approxEquals(this._spherical.phi, this._sphericalEnd.phi, this.restThreshold),
      approxEquals(this._spherical.radius, this._sphericalEnd.radius, this.restThreshold),
    ]);
    return this._createOnRestPromise(resolveImmediately);

  }

  /**
   * Interpolate between two camera states.
   * @category Methods
   */

  lerp(
    stateA: CameraControlsLerpState,
    stateB: CameraControlsLerpState,
    t: number,
    enableTransition: boolean = false,
  ): Promise<void> {

    this._isUserControllingRotate = false;
    this._isUserControllingDolly = false;
    this._isUserControllingTruck = false;
    this._lastDollyDirection = DOLLY_DIRECTION.NONE;
    this._changedDolly = 0;

    const targetA = _v3A.set(...stateA.target);
    if ('spherical' in stateA) {

      _sphericalA.set(...stateA.spherical);

    } else {

      const positionA = _v3B.set(...stateA.position);
      _sphericalA.setFromVector3(positionA.sub(targetA).applyQuaternion(this._yAxisUpSpace));

    }

    const targetB = _v3C.set(...stateB.target);
    if ('spherical' in stateB) {

      _sphericalB.set(...stateB.spherical);

    } else {

      const positionB = _v3B.set(...stateB.position);
      _sphericalB.setFromVector3(positionB.sub(targetB).applyQuaternion(this._yAxisUpSpace));

    }

    this._targetEnd.copy(targetA.lerp(targetB, t));

    const deltaTheta = _sphericalB.theta - _sphericalA.theta;
    const deltaPhi = _sphericalB.phi - _sphericalA.phi;
    const deltaRadius = _sphericalB.radius - _sphericalA.radius;

    this._sphericalEnd.set(
      _sphericalA.radius + deltaRadius * t,
      _sphericalA.phi + deltaPhi * t,
      _sphericalA.theta + deltaTheta * t,
    );

    this._needsUpdate = true;

    if (! enableTransition) {

      this._target.copy(this._targetEnd);
      this._spherical.copy(this._sphericalEnd);

    }

    const resolveImmediately = shouldResolveImmediately(enableTransition, [
      approxEquals3(this._target, this._targetEnd, this.restThreshold),
      approxEquals(this._spherical.theta, this._sphericalEnd.theta, this.restThreshold),
      approxEquals(this._spherical.phi, this._sphericalEnd.phi, this.restThreshold),
      approxEquals(this._spherical.radius, this._sphericalEnd.radius, this.restThreshold),
    ]);
    return this._createOnRestPromise(resolveImmediately);

  }

  /**
   * Interpolate between two look-at states (convenience wrapper around {@link lerp}).
   * @category Methods
   */
  // eslint-disable-next-line max-params
  lerpLookAt(
    positionAX: number, positionAY: number, positionAZ: number,
    targetAX: number, targetAY: number, targetAZ: number,
    positionBX: number, positionBY: number, positionBZ: number,
    targetBX: number, targetBY: number, targetBZ: number,
    t: number,
    enableTransition: boolean = false,
  ): Promise<void> {

    return this.lerp(
      { position: [positionAX, positionAY, positionAZ], target: [targetAX, targetAY, targetAZ] },
      { position: [positionBX, positionBY, positionBZ], target: [targetBX, targetBY, targetBZ] },
      t,
      enableTransition,
    );

  }

  /**
   * Set camera position without changing the target.
   * @category Methods
   */
  setPosition(
    positionX: number, positionY: number, positionZ: number,
    enableTransition: boolean = false,
  ): Promise<void> {

    return this.setLookAt(
      positionX, positionY, positionZ,
      this._targetEnd.x, this._targetEnd.y, this._targetEnd.z,
      enableTransition,
    );

  }

  /**
   * Set the orbit target without changing the camera position.
   * @category Methods
   */
  setTarget(targetX: number, targetY: number, targetZ: number, enableTransition: boolean = false): Promise<void> {

    const pos = this.getPosition(_v3A);
    const promise = this.setLookAt(
      pos.x, pos.y, pos.z,
      targetX, targetY, targetZ,
      enableTransition,
    );

    this._sphericalEnd.phi = clamp(this._sphericalEnd.phi, this.minPolarAngle, this.maxPolarAngle);
    return promise;

  }

  /**
   * Set the screen-parallel focal offset.
   * @category Methods
   */
  setFocalOffset(x: number, y: number, z: number, enableTransition: boolean = false): Promise<void> {

    this._isUserControllingOffset = false;
    this._focalOffsetEnd.set(x, y, z);
    this._needsUpdate = true;

    if (! enableTransition) {
      this._focalOffset.copy(this._focalOffsetEnd);
    }

    const resolveImmediately = shouldResolveImmediately(enableTransition, [
      approxEquals3(this._focalOffset, this._focalOffsetEnd, this.restThreshold),
    ]);
    return this._createOnRestPromise(resolveImmediately);

  }

  /**
   * Set orbit point without moving the camera.
   * **SHOULD NOT** be called during animations.
   * @category Methods
   */
  setOrbitPoint(targetX: number, targetY: number, targetZ: number): void {

    this._camera.updateMatrixWorld();
    _xColumn.setFromMatrixColumn(this._camera.matrixWorldInverse, 0);
    _yColumn.setFromMatrixColumn(this._camera.matrixWorldInverse, 1);
    _zColumn.setFromMatrixColumn(this._camera.matrixWorldInverse, 2);

    const position = _v3A.set(targetX, targetY, targetZ);
    const distance = position.distanceTo(this._camera.position);
    const cameraToPoint = position.sub(this._camera.position);
    _xColumn.multiplyScalar(cameraToPoint.x);
    _yColumn.multiplyScalar(cameraToPoint.y);
    _zColumn.multiplyScalar(cameraToPoint.z);

    _v3A.copy(_xColumn).add(_yColumn).add(_zColumn);
    _v3A.z = _v3A.z + distance;

    this.dollyTo(distance, false);
    this.setFocalOffset(- _v3A.x, _v3A.y, - _v3A.z, false);
    this.moveTo(targetX, targetY, targetZ, false);

  }

  // ─── Fit ─────────────────────────────────────────────────────────────

  /**
   * Frame a box or object in the viewport.
   * @category Methods
   */

  fitToBox(
    box3OrObject: THREE.Box3 | THREE.Object3D,
    enableTransition: boolean,
    {
      cover = false,
      paddingLeft = 0,
      paddingRight = 0,
      paddingBottom = 0,
      paddingTop = 0,
    }: Partial<FitToOptions> = {},
  ): Promise<void[]> {

    const promises: Promise<void>[] = [];
    const aabb = (box3OrObject as THREE.Box3).isBox3
      ? _box3A.copy(box3OrObject as THREE.Box3)
      : _box3A.setFromObject(box3OrObject as THREE.Object3D);

    if (aabb.isEmpty()) {

      console.warn('camera-controls: fitToBox() cannot be used with an empty box. Aborting');
      return Promise.resolve([]);

    }

    const theta = roundToStep(this._sphericalEnd.theta, PI_HALF);
    const phi = roundToStep(this._sphericalEnd.phi, PI_HALF);

    promises.push(this.rotateTo(theta, phi, enableTransition));

    const normal = _v3A.setFromSpherical(this._sphericalEnd).normalize();
    const rotation = _quaternionA.setFromUnitVectors(normal, _axisZ);
    const viewFromPolar = approxEquals(Math.abs(normal.y), 1);
    if (viewFromPolar) {

      rotation.multiply(_quaternionB.setFromAxisAngle(_axisY, theta));

    }

    rotation.multiply(this._yAxisUpSpaceInverse);

    const bb = _box3B.makeEmpty();

    this._expandBoundingBoxWithCorners(bb, aabb, rotation);

    bb.min.x -= paddingLeft;
    bb.min.y -= paddingBottom;
    bb.max.x += paddingRight;
    bb.max.y += paddingTop;

    rotation.setFromUnitVectors(_axisZ, normal);
    if (viewFromPolar) {
      rotation.premultiply(_quaternionB.invert());
    }
    rotation.premultiply(this._yAxisUpSpace);

    const bbSize = bb.getSize(_v3A);
    const center = bb.getCenter(_v3B).applyQuaternion(rotation);

    if (isPerspectiveCamera(this._camera)) {

      const distance = this.getDistanceToFitBox(bbSize.x, bbSize.y, bbSize.z, cover);
      promises.push(this.moveTo(center.x, center.y, center.z, enableTransition));
      promises.push(this.dollyTo(distance, enableTransition));
      promises.push(this.setFocalOffset(0, 0, 0, enableTransition));

    } else if (isOrthographicCamera(this._camera)) {

      const camera = this._camera;
      const width = camera.right - camera.left;
      const height = camera.top - camera.bottom;
      const zoom = cover
        ? Math.max(width / bbSize.x, height / bbSize.y)
        : Math.min(width / bbSize.x, height / bbSize.y);
      promises.push(this.moveTo(center.x, center.y, center.z, enableTransition));
      promises.push(this.zoomTo(zoom, enableTransition));
      promises.push(this.setFocalOffset(0, 0, 0, enableTransition));

    }

    return Promise.all(promises);

  }

  /** @internal Expand bounding box with all rotated AABB corners. */
  private _expandBoundingBoxWithCorners(
    bb: THREE.Box3,
    aabb: THREE.Box3,
    rotation: THREE.Quaternion,
  ): void {

    const corners = [
      aabb.min.clone(),
      aabb.min.clone().setX(aabb.max.x),
      aabb.min.clone().setY(aabb.max.y),
      aabb.max.clone().setZ(aabb.min.z),
      aabb.min.clone().setZ(aabb.max.z),
      aabb.max.clone().setY(aabb.min.y),
      aabb.max.clone(),
      aabb.max.clone().setX(aabb.min.x),
    ];

    for (const corner of corners) {

      _v3B.copy(corner).applyQuaternion(rotation);
      bb.expandByPoint(_v3B);

    }

  }

  /**
   * Frame a sphere or object in the viewport.
   * @category Methods
   */
  fitToSphere(sphereOrMesh: THREE.Sphere | THREE.Object3D, enableTransition: boolean): Promise<void[]> {

    const promises: Promise<void>[] = [];
    const isObject3D = 'isObject3D' in sphereOrMesh;
    const boundingSphere = isObject3D
      ? CameraControls.createBoundingSphere(sphereOrMesh, _sphere)
      : _sphere.copy(sphereOrMesh);

    promises.push(this.moveTo(
      boundingSphere.center.x,
      boundingSphere.center.y,
      boundingSphere.center.z,
      enableTransition,
    ));

    if (isPerspectiveCamera(this._camera)) {

      const distanceToFit = this.getDistanceToFitSphere(boundingSphere.radius);
      promises.push(this.dollyTo(distanceToFit, enableTransition));

    } else if (isOrthographicCamera(this._camera)) {

      const width = this._camera.right - this._camera.left;
      const height = this._camera.top - this._camera.bottom;
      const diameter = 2 * boundingSphere.radius;
      const zoom = Math.min(width / diameter, height / diameter);
      promises.push(this.zoomTo(zoom, enableTransition));

    }

    promises.push(this.setFocalOffset(0, 0, 0, enableTransition));
    return Promise.all(promises);

  }

  // ─── Query methods ───────────────────────────────────────────────────

  /**
   * Get the orbit target position.
   * @param out              Receiving vector.
   * @param receiveEndValue  `true` for transition-end value. @default true
   * @category Methods
   */
  getTarget(out: THREE.Vector3, receiveEndValue: boolean = true): THREE.Vector3 {

    const result = out && out.isVector3 ? out : new THREE.Vector3();
    return result.copy(receiveEndValue ? this._targetEnd : this._target);

  }

  /**
   * Get the camera position.
   * @param out              Receiving vector.
   * @param receiveEndValue  `true` for transition-end value. @default true
   * @category Methods
   */
  getPosition(out: THREE.Vector3, receiveEndValue: boolean = true): THREE.Vector3 {

    const result = out && out.isVector3 ? out : new THREE.Vector3();
    return result.setFromSpherical(receiveEndValue ? this._sphericalEnd : this._spherical)
      .applyQuaternion(this._yAxisUpSpaceInverse)
      .add(receiveEndValue ? this._targetEnd : this._target);

  }

  /**
   * Get the spherical coordinates.
   * @param out              Receiving spherical.
   * @param receiveEndValue  `true` for transition-end value. @default true
   * @category Methods
   */
  getSpherical(out: THREE.Spherical, receiveEndValue: boolean = true): THREE.Spherical {

    const result = out || new THREE.Spherical();
    return result.copy(receiveEndValue ? this._sphericalEnd : this._spherical);

  }

  /**
   * Get the focal offset.
   * @param out              Receiving vector.
   * @param receiveEndValue  `true` for transition-end value. @default true
   * @category Methods
   */
  getFocalOffset(out: THREE.Vector3, receiveEndValue: boolean = true): THREE.Vector3 {

    const result = out && out.isVector3 ? out : new THREE.Vector3();
    return result.copy(receiveEndValue ? this._focalOffsetEnd : this._focalOffset);

  }

  /**
   * Calculate distance to fit a box.
   * @category Methods
   */
  getDistanceToFitBox(width: number, height: number, depth: number, cover: boolean = false): number {

    if (! isPerspectiveCamera(this._camera)) {

      console.warn('getDistanceToFitBox() is not supported by OrthographicCamera.');
      return this._spherical.radius;

    }

    const boundingRectAspect = width / height;
    const fov = this._camera.getEffectiveFOV() * DEG2RAD;
    const aspect = this._camera.aspect;

    const heightToFit = (cover ? boundingRectAspect > aspect : boundingRectAspect < aspect)
      ? height
      : width / aspect;
    return heightToFit * CENTROID_HALF / Math.tan(fov * CENTROID_HALF) + depth * CENTROID_HALF;

  }

  /**
   * Calculate distance to fit a sphere.
   * @category Methods
   */
  getDistanceToFitSphere(radius: number): number {

    if (! isPerspectiveCamera(this._camera)) {

      console.warn('getDistanceToFitSphere() is not supported by OrthographicCamera.');
      return this._spherical.radius;

    }

    const vFOV = this._camera.getEffectiveFOV() * DEG2RAD;
    const hFOV = Math.atan(Math.tan(vFOV * CENTROID_HALF) * this._camera.aspect) * 2;
    const fov = 1 < this._camera.aspect ? vFOV : hFOV;
    return radius / Math.sin(fov * CENTROID_HALF);

  }

  // ─── Boundary / Viewport ─────────────────────────────────────────────

  /**
   * Set the boundary box constraining the target / camera position.
   * @category Methods
   */
  setBoundary(box3?: THREE.Box3): void {

    if (! box3) {

      this._boundary.min.set(- Infinity, - Infinity, - Infinity);
      this._boundary.max.set(Infinity, Infinity, Infinity);
      this._needsUpdate = true;
      return;

    }

    this._boundary.copy(box3);
    this._boundary.clampPoint(this._targetEnd, this._targetEnd);
    this._needsUpdate = true;

  }

  /**
   * Set (or clear) the viewport scissor region.
   * @category Methods
   */
  setViewport(
    viewportOrX: THREE.Vector4 | { x: number; y: number; width: number; height: number } | number | null,
    y?: number,
    width?: number,
    height?: number,
  ): void {

    if (viewportOrX === null) {

      this._viewport = null;
      return;

    }

    this._viewport = this._viewport || new THREE.Vector4();

    if (typeof viewportOrX === 'number') {

      this._viewport.set(viewportOrX, y ?? 0, width ?? 1, height ?? 1);

    } else if (viewportOrX instanceof THREE.Vector4) {

      this._viewport.copy(viewportOrX);

    } else {

      this._viewport.set(viewportOrX.x, viewportOrX.y, viewportOrX.width, viewportOrX.height);

    }

  }

  // ─── State management ────────────────────────────────────────────────

  /**
   * Normalize azimuth angle to [-π, π]. Chainable (returns `this`).
   * @category Methods
   */
  normalizeRotations(): this {

    this._sphericalEnd.theta = ((this._sphericalEnd.theta % PI_2) + PI_2) % PI_2;
    if (this._sphericalEnd.theta > Math.PI) {
      this._sphericalEnd.theta -= PI_2;
    }
    this._spherical.theta += PI_2 * Math.round((this._sphericalEnd.theta - this._spherical.theta) / PI_2);
    return this;

  }

  /**
   * Save current state for later {@link reset}.
   * @category Methods
   */
  saveState(): void {

    this._cameraUp0.copy(this._camera.up);
    this.getTarget(this._target0);
    this.getPosition(this._position0);
    this._zoom0 = this._zoom;
    this._focalOffset0.copy(this._focalOffset);

  }

  /**
   * Reset to saved (or initial) state.
   * @category Methods
   */
  reset(enableTransition: boolean = false): Promise<void[]> {

    if (
      ! approxEquals(this._camera.up.x, this._cameraUp0.x) ||
      ! approxEquals(this._camera.up.y, this._cameraUp0.y) ||
      ! approxEquals(this._camera.up.z, this._cameraUp0.z)
    ) {

      this._camera.up.copy(this._cameraUp0);
      const position = this.getPosition(_v3A);
      this.updateCameraUp();
      this.setPosition(position.x, position.y, position.z);

    }

    const promises = [
      this.setLookAt(
        this._position0.x, this._position0.y, this._position0.z,
        this._target0.x, this._target0.y, this._target0.z,
        enableTransition,
      ),
      this.setFocalOffset(
        this._focalOffset0.x,
        this._focalOffset0.y,
        this._focalOffset0.z,
        enableTransition,
      ),
      this.zoomTo(this._zoom0, enableTransition),
    ];

    return Promise.all(promises);

  }

  /**
   * Stop all ongoing transitions immediately.
   * @category Methods
   */
  stop(): void {

    this._focalOffset.copy(this._focalOffsetEnd);
    this._target.copy(this._targetEnd);
    this._spherical.copy(this._sphericalEnd);
    this._zoom = this._zoomEnd;

  }

  // ─── Camera Up ───────────────────────────────────────────────────────

  /**
   * Re-sync internal up-space quaternions with the current `camera.up`.
   * Call after changing `camera.up`.
   * @category Methods
   */
  updateCameraUp(): void {

    this._yAxisUpSpace.setFromUnitVectors(this._camera.up, _axisY);
    this._yAxisUpSpaceInverse.copy(this._yAxisUpSpace).invert();

  }

  /**
   * Apply the current camera-up direction and re-initialize the orbit system.
   * @category Methods
   */
  applyCameraUp(): void {

    const cameraDirection = _v3A.subVectors(this._target, this._camera.position).normalize();
    const side = _v3B.crossVectors(cameraDirection, this._camera.up);
    this._camera.up.crossVectors(side, cameraDirection).normalize();
    this._camera.updateMatrixWorld();

    const position = this.getPosition(_v3A);
    this.updateCameraUp();
    this.setPosition(position.x, position.y, position.z);

  }

  // ─── Per-frame update ────────────────────────────────────────────────

  /**
   * Per-frame update. Call every frame with the delta time.
   *
   * @param delta  Time in seconds since the last frame.
   * @returns      `true` if the camera is still moving.
   * @category Methods
   */
  // eslint-disable-next-line max-lines-per-function
  update(delta: number): boolean {

    const deltaTheta = this._sphericalEnd.theta - this._spherical.theta;
    const deltaPhi = this._sphericalEnd.phi - this._spherical.phi;
    const deltaRadius = this._sphericalEnd.radius - this._spherical.radius;
    const deltaTarget = _deltaTarget.subVectors(this._targetEnd, this._target);
    const deltaOffset = _deltaOffset.subVectors(this._focalOffsetEnd, this._focalOffset);
    const deltaZoom = this._zoomEnd - this._zoom;

    // Update theta
    if (approxZero(deltaTheta)) {

      this._thetaVelocity.value = 0;
      this._spherical.theta = this._sphericalEnd.theta;

    } else {

      const st = this._isUserControllingRotate ? this.draggingSmoothTime : this.smoothTime;
      this._spherical.theta = smoothDamp(
        this._spherical.theta, this._sphericalEnd.theta,
        this._thetaVelocity, { smoothTime: st, maxSpeed: Infinity, deltaTime: delta },
      );
      this._needsUpdate = true;

    }

    // Update phi
    if (approxZero(deltaPhi)) {

      this._phiVelocity.value = 0;
      this._spherical.phi = this._sphericalEnd.phi;

    } else {

      const st = this._isUserControllingRotate ? this.draggingSmoothTime : this.smoothTime;
      this._spherical.phi = smoothDamp(
        this._spherical.phi, this._sphericalEnd.phi,
        this._phiVelocity, { smoothTime: st, maxSpeed: Infinity, deltaTime: delta },
      );
      this._needsUpdate = true;

    }

    // Update distance
    if (approxZero(deltaRadius)) {

      this._radiusVelocity.value = 0;
      this._spherical.radius = this._sphericalEnd.radius;

    } else {

      const st = this._isUserControllingDolly ? this.draggingSmoothTime : this.smoothTime;
      this._spherical.radius = smoothDamp(
        this._spherical.radius, this._sphericalEnd.radius,
        this._radiusVelocity, { smoothTime: st, maxSpeed: this.maxSpeed, deltaTime: delta },
      );
      this._needsUpdate = true;

    }

    // Update target position
    if (approxZero(deltaTarget.x) && approxZero(deltaTarget.y) && approxZero(deltaTarget.z)) {

      this._targetVelocity.set(0, 0, 0);
      this._target.copy(this._targetEnd);

    } else {

      const st = this._isUserControllingTruck ? this.draggingSmoothTime : this.smoothTime;
      smoothDampVec3(
        this._target, this._targetEnd, this._targetVelocity,
        { smoothTime: st, maxSpeed: this.maxSpeed, deltaTime: delta }, this._target,
      );
      this._needsUpdate = true;

    }

    // Update focal offset
    if (approxZero(deltaOffset.x) && approxZero(deltaOffset.y) && approxZero(deltaOffset.z)) {

      this._focalOffsetVelocity.set(0, 0, 0);
      this._focalOffset.copy(this._focalOffsetEnd);

    } else {

      const st = this._isUserControllingOffset ? this.draggingSmoothTime : this.smoothTime;
      smoothDampVec3(
        this._focalOffset, this._focalOffsetEnd,
        this._focalOffsetVelocity,
        { smoothTime: st, maxSpeed: this.maxSpeed, deltaTime: delta }, this._focalOffset,
      );
      this._needsUpdate = true;

    }

    // Update zoom
    if (approxZero(deltaZoom)) {

      this._zoomVelocity.value = 0;
      this._zoom = this._zoomEnd;

    } else {

      const st = this._isUserControllingZoom ? this.draggingSmoothTime : this.smoothTime;
      this._zoom = smoothDamp(
        this._zoom, this._zoomEnd,
        this._zoomVelocity, { smoothTime: st, maxSpeed: Infinity, deltaTime: delta },
      );

    }

    this._updateDollyToCursor(delta);
    this._applyCameraTransform(delta);

    // Event dispatch
    const updated = this._needsUpdate;
    this._dispatchUpdateEvents(updated, {
      deltaTheta,
      deltaPhi,
      deltaRadius,
      deltaTarget,
      deltaOffset,
      deltaZoom,
    });

    this._lastDistance = this._spherical.radius;
    this._lastZoom = this._zoom;
    this._updatedLastTime = updated;
    this._needsUpdate = false;

    return updated;

  }

  /** @internal Update dolly-to-cursor logic for both camera types. */
  private _updateDollyToCursor(delta: number): void {

    if (! this.dollyToCursor) {
      return;
    }

    if (isPerspectiveCamera(this._camera) && this._changedDolly !== 0) {
      this._updatePerspectiveDollyToCursor();
    } else if (isOrthographicCamera(this._camera) && this._changedZoom !== 0) {
      this._updateOrthographicDollyToCursor(delta);
    }

  }

  /** @internal Perspective camera dolly-to-cursor update. */

  private _updatePerspectiveDollyToCursor(): void {

    const dollyControlAmount = this._spherical.radius - this._lastDistance;
    const camera = this._camera as THREE.PerspectiveCamera;
    const camDir = this._getCameraDirection(_cameraDirection);
    const planeX = _v3A.copy(camDir).cross(camera.up).normalize();
    if (planeX.lengthSq() === 0) {
      planeX.x = 1.0;
    }
    const planeY = _v3B.crossVectors(planeX, camDir);
    const worldToScreen = this._sphericalEnd.radius *
      Math.tan(camera.getEffectiveFOV() * DEG2RAD * CENTROID_HALF);
    const prevRadius = this._sphericalEnd.radius - dollyControlAmount;
    const lerpRatio = (prevRadius - this._sphericalEnd.radius) / this._sphericalEnd.radius;
    const cursor = _v3C.copy(this._targetEnd)
      .add(planeX.multiplyScalar(this._dollyControlCoord.x * worldToScreen * camera.aspect))
      .add(planeY.multiplyScalar(this._dollyControlCoord.y * worldToScreen));
    const newTargetEnd = _v3A.copy(this._targetEnd).lerp(cursor, lerpRatio);

    const isMin = this._lastDollyDirection === DOLLY_DIRECTION.IN &&
      this._spherical.radius <= this.minDistance;
    const isMax = this._lastDollyDirection === DOLLY_DIRECTION.OUT &&
      this.maxDistance <= this._spherical.radius;

    if (this.infinityDolly && (isMin || isMax)) {

      this._sphericalEnd.radius -= dollyControlAmount;
      this._spherical.radius -= dollyControlAmount;
      const dollyAmount = _v3B.copy(camDir).multiplyScalar(- dollyControlAmount);
      newTargetEnd.add(dollyAmount);

    }

    this._boundary.clampPoint(newTargetEnd, newTargetEnd);
    const targetEndDiff = _v3B.subVectors(newTargetEnd, this._targetEnd);
    this._targetEnd.copy(newTargetEnd);
    this._target.add(targetEndDiff);

    this._changedDolly -= dollyControlAmount;
    if (approxZero(this._changedDolly)) {
      this._changedDolly = 0;
    }

  }

  /** @internal Orthographic camera dolly-to-cursor update. */

  private _updateOrthographicDollyToCursor(delta: number): void {

    const dollyControlAmount = this._zoom - this._lastZoom;
    const camera = this._camera;
    const worldCursorPosition = _v3A.set(
      this._dollyControlCoord.x,
      this._dollyControlCoord.y,
      (camera.near + camera.far) / (camera.near - camera.far),
    ).unproject(camera);
    const quaternion = _v3B.set(0, 0, - 1).applyQuaternion(camera.quaternion);
    const cursor = _v3C.copy(worldCursorPosition)
      .add(quaternion.multiplyScalar(- worldCursorPosition.dot(camera.up)));
    const prevZoom = this._zoom - dollyControlAmount;
    const lerpRatio = - (prevZoom - this._zoom) / this._zoom;

    const camDir = this._getCameraDirection(_cameraDirection);
    const prevPlaneConstant = this._targetEnd.dot(camDir);

    const newTargetEnd = _v3A.copy(this._targetEnd).lerp(cursor, lerpRatio);
    const newPlaneConstant = newTargetEnd.dot(camDir);

    const pullBack = camDir.multiplyScalar(newPlaneConstant - prevPlaneConstant);
    newTargetEnd.sub(pullBack);

    this._boundary.clampPoint(newTargetEnd, newTargetEnd);
    const targetEndDiff = _v3B.subVectors(newTargetEnd, this._targetEnd);
    this._targetEnd.copy(newTargetEnd);
    this._target.add(targetEndDiff);

    this._changedZoom -= dollyControlAmount;
    if (approxZero(this._changedZoom)) {
      this._changedZoom = 0;
    }

    void delta;

  }

  /** @internal Apply final camera transform after smoothDamp. */
  private _applyCameraTransform(delta: number): void {

    // Apply zoom to camera
    if (this._camera.zoom !== this._zoom) {

      this._camera.zoom = this._zoom;
      this._camera.updateProjectionMatrix();
      this._updateNearPlaneCorners();
      this._needsUpdate = true;

    }

    this._dragNeedsUpdate = true;

    // Collision detection
    const maxDistance = this._collisionTest();
    this._spherical.radius = Math.min(this._spherical.radius, maxDistance);

    // Decompose spherical to camera position
    this._spherical.makeSafe();
    this._camera.position.setFromSpherical(this._spherical)
      .applyQuaternion(this._yAxisUpSpaceInverse)
      .add(this._target);

    _v3A.copy(this._target);
    if (this._camera.parent) {

      this._camera.parent.localToWorld(_v3A);

    }

    this._camera.lookAt(_v3A);

    // Apply focal offset
    this._applyFocalOffset();

    // Boundary enclosure
    if (this._boundaryEnclosesCamera) {

      this._encloseToBoundary(
        this._camera.position.copy(this._target),
        _v3A.setFromSpherical(this._spherical).applyQuaternion(this._yAxisUpSpaceInverse),
        1.0,
      );

    }

    void delta;

  }

  /** @internal Apply focal offset to camera position. */
  private _applyFocalOffset(): void {

    const affectOffset =
      ! approxZero(this._focalOffset.x) ||
      ! approxZero(this._focalOffset.y) ||
      ! approxZero(this._focalOffset.z);
    if (! affectOffset) {
      return;
    }

    this._camera.matrix.compose(this._camera.position, this._camera.quaternion, this._camera.scale);
    _xColumn.setFromMatrixColumn(this._camera.matrix, 0);
    _yColumn.setFromMatrixColumn(this._camera.matrix, 1);
    _zColumn.setFromMatrixColumn(this._camera.matrix, 2);
    _xColumn.multiplyScalar(this._focalOffset.x);
    _yColumn.multiplyScalar(- this._focalOffset.y);
    _zColumn.multiplyScalar(this._focalOffset.z);

    _v3A.copy(_xColumn).add(_yColumn).add(_zColumn);
    this._camera.position.add(_v3A);
    this._camera.updateMatrixWorld();

  }

  /** @internal Dispatch update/wake/rest/sleep events. */
  private _dispatchUpdateEvents(updated: boolean, deltas: UpdateDeltas): void {

    const {
      deltaTheta,
      deltaPhi,
      deltaRadius,
      deltaTarget,
      deltaOffset,
      deltaZoom,
    } = deltas;

    if (updated && ! this._updatedLastTime) {

      this._hasRested = false;
      this._dispatcher.dispatchEvent({ type: 'wake' });
      this._dispatcher.dispatchEvent({ type: 'update' });

    } else if (updated) {

      this._dispatcher.dispatchEvent({ type: 'update' });

      if (
        approxZero(deltaTheta, this.restThreshold) &&
        approxZero(deltaPhi, this.restThreshold) &&
        approxZero(deltaRadius, this.restThreshold) &&
        approxZero(deltaTarget.x, this.restThreshold) &&
        approxZero(deltaTarget.y, this.restThreshold) &&
        approxZero(deltaTarget.z, this.restThreshold) &&
        approxZero(deltaOffset.x, this.restThreshold) &&
        approxZero(deltaOffset.y, this.restThreshold) &&
        approxZero(deltaOffset.z, this.restThreshold) &&
        approxZero(deltaZoom, this.restThreshold) &&
        ! this._hasRested
      ) {

        this._hasRested = true;
        this._dispatcher.dispatchEvent({ type: 'rest' });

      }

    } else if (! updated && this._updatedLastTime) {

      this._dispatcher.dispatchEvent({ type: 'sleep' });

    }

  }

  // ─── Connection ──────────────────────────────────────────────────────

  /**
   * Attach pointer events to a DOM element.
   * @category Methods
   */
  connect(domElement: HTMLElement): void {

    if (this._domElement) {

      console.warn('CameraControls is already connected.');
      return;

    }

    this._addAllEventListeners(domElement);
    this._getClientRect(this._elementRect);

  }

  /**
   * Detach pointer events.
   * @category Methods
   */
  disconnect(): void {

    this.cancel();
    this._removeAllEventListeners();

    if (this._domElement) {

      this._domElement = undefined;

    }

  }

  // ─── Serialization ───────────────────────────────────────────────────

  /**
   * Serialize the controller state to a JSON string.
   * @category Methods
   */
  toJSON(): string {

    return JSON.stringify({
      enabled: this._enabled,
      minDistance: this.minDistance,
      maxDistance: infinityToMaxNumber(this.maxDistance),
      minZoom: this.minZoom,
      maxZoom: infinityToMaxNumber(this.maxZoom),
      minPolarAngle: this.minPolarAngle,
      maxPolarAngle: infinityToMaxNumber(this.maxPolarAngle),
      minAzimuthAngle: infinityToMaxNumber(this.minAzimuthAngle),
      maxAzimuthAngle: infinityToMaxNumber(this.maxAzimuthAngle),
      smoothTime: this.smoothTime,
      draggingSmoothTime: this.draggingSmoothTime,
      dollySpeed: this.dollySpeed,
      truckSpeed: this.truckSpeed,
      dollyToCursor: this.dollyToCursor,
      target: this._targetEnd.toArray(),
      position: _v3A.setFromSpherical(this._sphericalEnd).add(this._targetEnd).toArray(),
      zoom: this._zoomEnd,
      focalOffset: this._focalOffsetEnd.toArray(),
      target0: this._target0.toArray(),
      position0: this._position0.toArray(),
      zoom0: this._zoom0,
      focalOffset0: this._focalOffset0.toArray(),
    });

  }

  /**
   * Restore the controller state from a JSON string.
   * @category Methods
   */
  fromJSON(json: string, enableTransition: boolean = false): void {

    const obj = JSON.parse(json);

    this.enabled = obj.enabled;
    this.minDistance = obj.minDistance;
    this.maxDistance = maxNumberToInfinity(obj.maxDistance);
    this.minZoom = obj.minZoom;
    this.maxZoom = maxNumberToInfinity(obj.maxZoom);
    this.minPolarAngle = obj.minPolarAngle;
    this.maxPolarAngle = maxNumberToInfinity(obj.maxPolarAngle);
    this.minAzimuthAngle = maxNumberToInfinity(obj.minAzimuthAngle);
    this.maxAzimuthAngle = maxNumberToInfinity(obj.maxAzimuthAngle);
    this.smoothTime = obj.smoothTime;
    this.draggingSmoothTime = obj.draggingSmoothTime;
    this.dollySpeed = obj.dollySpeed;
    this.truckSpeed = obj.truckSpeed;
    this.dollyToCursor = obj.dollyToCursor;

    this._target0.fromArray(obj.target0);
    this._position0.fromArray(obj.position0);
    this._zoom0 = obj.zoom0;
    this._focalOffset0.fromArray(obj.focalOffset0);

    this.moveTo(obj.target[ 0 ], obj.target[ 1 ], obj.target[ 2 ], enableTransition);
    _sphericalA.setFromVector3(_v3A.fromArray(obj.position).sub(this._targetEnd).applyQuaternion(this._yAxisUpSpace));
    this.rotateTo(_sphericalA.theta, _sphericalA.phi, enableTransition);
    this.dollyTo(_sphericalA.radius, enableTransition);
    this.zoomTo(obj.zoom, enableTransition);
    this.setFocalOffset(
      obj.focalOffset[ 0 ], obj.focalOffset[ 1 ], obj.focalOffset[ 2 ],
      enableTransition,
    );

    this._needsUpdate = true;

  }

  // ─── Dispose ─────────────────────────────────────────────────────────

  /**
   * Release all resources and remove all event listeners.
   * @category Methods
   */
  dispose(): void {

    this._dispatcher.removeAllEventListeners();
    this.disconnect();

  }

  // ─── Internal methods ────────────────────────────────────────────────

  private _getTargetDirection(out: THREE.Vector3): THREE.Vector3 {

    return out.setFromSpherical(this._spherical)
      .divideScalar(this._spherical.radius)
      .applyQuaternion(this._yAxisUpSpaceInverse);

  }

  private _getCameraDirection(out: THREE.Vector3): THREE.Vector3 {

    return this._getTargetDirection(out).negate();

  }

  private _findPointerById(pointerId: number): PointerInput | undefined {

    return this._activePointers.find((p) => p.pointerId === pointerId);

  }

  private _findPointerByMouseButton(mouseButton: MOUSE_BUTTON): PointerInput | undefined {

    return this._activePointers.find((p) => p.mouseButton === mouseButton);

  }

  private _disposePointer(pointer: PointerInput): void {

    this._activePointers.splice(this._activePointers.indexOf(pointer), 1);

  }

  private _encloseToBoundary(position: THREE.Vector3, offset: THREE.Vector3, friction: number): THREE.Vector3 {

    const offsetLength2 = offset.lengthSq();
    if (offsetLength2 === 0.0) {
      return position;
    }

    const newTarget = _v3B.copy(offset).add(position);
    const clampedTarget = this._boundary.clampPoint(newTarget, _v3C);
    const deltaClampedTarget = clampedTarget.sub(newTarget);
    const deltaClampedTargetLength2 = deltaClampedTarget.lengthSq();

    if (deltaClampedTargetLength2 === 0.0) {

      return position.add(offset);

    } else if (deltaClampedTargetLength2 === offsetLength2) {

      return position;

    } else if (friction === 0.0) {

      return position.add(offset).add(deltaClampedTarget);

    }

    const offsetFactor = 1.0 + friction * deltaClampedTargetLength2 / offset.dot(deltaClampedTarget);
    return position
      .add(_v3B.copy(offset).multiplyScalar(offsetFactor))
      .add(deltaClampedTarget.multiplyScalar(1.0 - friction));

  }

  private _updateNearPlaneCorners(): void {

    if (isPerspectiveCamera(this._camera)) {

      const camera = this._camera;
      const near = camera.near;
      const fov = camera.getEffectiveFOV() * DEG2RAD;
      const heightHalf = Math.tan(fov * CENTROID_HALF) * near;
      const widthHalf = heightHalf * camera.aspect;
      this._nearPlaneCorners[ 0 ].set(- widthHalf, Number(heightHalf), 0);
      this._nearPlaneCorners[ 1 ].set(Number(widthHalf), Number(heightHalf), 0);
      this._nearPlaneCorners[ 2 ].set(Number(widthHalf), - Number(heightHalf), 0);
      this._nearPlaneCorners[ 3 ].set(- Number(widthHalf), - Number(heightHalf), 0);

    } else if (isOrthographicCamera(this._camera)) {

      const camera = this._camera;
      const zoomInv = 1 / camera.zoom;
      const left = camera.left * zoomInv;
      const right = camera.right * zoomInv;
      const top = camera.top * zoomInv;
      const bottom = camera.bottom * zoomInv;

      this._nearPlaneCorners[ 0 ].set(left, top, 0);
      this._nearPlaneCorners[ 1 ].set(right, top, 0);
      this._nearPlaneCorners[ 2 ].set(right, bottom, 0);
      this._nearPlaneCorners[ 3 ].set(left, bottom, 0);

    }

  }

  private _rotateInternal = (deltaX: number, deltaY: number): void => {

    const rectH = this._elementRect.height || 1;
    const theta = PI_2 * this.azimuthRotateSpeed * deltaX / rectH;
    const phi = PI_2 * this.polarRotateSpeed * deltaY / rectH;
    this.rotate(theta, phi, true);

  };

  private _truckInternal = (
    deltaX: number, deltaY: number,
    dragToOffset: boolean, screenSpacePanning: boolean,
  ): void => {

    const rectW = this._elementRect.width || 1;
    const rectH = this._elementRect.height || 1;

    let truckX: number;
    let pedestalY: number;

    if (isPerspectiveCamera(this._camera)) {

      const offset = _v3A.copy(this._camera.position).sub(this._target);
      const fov = this._camera.getEffectiveFOV() * DEG2RAD;
      const targetDistance = offset.length() * Math.tan(fov * CENTROID_HALF);

      truckX = this.truckSpeed * deltaX * targetDistance / rectH;
      pedestalY = this.truckSpeed * deltaY * targetDistance / rectH;

    } else if (isOrthographicCamera(this._camera)) {

      const camera = this._camera;
      truckX = this.truckSpeed * deltaX * (camera.right - camera.left) / camera.zoom / rectW;
      pedestalY = this.truckSpeed * deltaY * (camera.top - camera.bottom) / camera.zoom / rectH;

    } else {

      return;

    }

    if (screenSpacePanning) {

      if (dragToOffset) {
        this.setFocalOffset(this._focalOffsetEnd.x + truckX, this._focalOffsetEnd.y, this._focalOffsetEnd.z, true);
      } else {
        this.truck(truckX, 0, true);
      }
      this.forward(- pedestalY, true);

    } else {

      if (dragToOffset) {
        this.setFocalOffset(
          this._focalOffsetEnd.x + truckX,
          this._focalOffsetEnd.y + pedestalY,
          this._focalOffsetEnd.z,
          true,
        );
      } else {
        this.truck(truckX, pedestalY, true);
      }

    }

  };

  private _dollyInternal = (delta: number, x: number, y: number): void => {

    const dollyScale = Math.pow(DOLLY_SCALE_BASE, - delta * this.dollySpeed);
    const lastDistance = this._sphericalEnd.radius;
    const distance = this._sphericalEnd.radius * dollyScale;
    const clampedDistance = clamp(distance, this.minDistance, this.maxDistance);
    const overflowedDistance = clampedDistance - distance;

    if (this.infinityDolly && this.dollyToCursor) {

      this._dollyToNoClamp(distance, true);

    } else if (this.infinityDolly && ! this.dollyToCursor) {

      this.dollyInFixed(overflowedDistance, true);
      this._dollyToNoClamp(clampedDistance, true);

    } else {

      this._dollyToNoClamp(clampedDistance, true);

    }

    if (this.dollyToCursor) {

      this._changedDolly += (this.infinityDolly ? distance : clampedDistance) - lastDistance;
      this._dollyControlCoord.set(x, y);

    }

    this._lastDollyDirection = Math.sign(- delta) as DOLLY_DIRECTION;

  };

  private _zoomInternal = (delta: number, x: number, y: number): void => {

    const zoomScale = Math.pow(DOLLY_SCALE_BASE, delta * this.dollySpeed);
    const lastZoom = this._zoom;
    const zoom = this._zoom * zoomScale;

    this.zoomTo(zoom, true);

    if (this.dollyToCursor) {

      this._changedZoom += zoom - lastZoom;
      this._dollyControlCoord.set(x, y);

    }

  };

  private _collisionTest(): number {

    let distance = Infinity;
    const hasCollider = this.colliderMeshes.length >= 1;
    if (! hasCollider) {
      return distance;
    }

    if (! isPerspectiveCamera(this._camera)) {

      console.warn('_collisionTest() is not supported by OrthographicCamera.');
      return distance;

    }

    const rayDirection = this._getTargetDirection(_cameraDirection);
    _rotationMatrix.lookAt(_origin, rayDirection, this._camera.up);

    for (let i = 0; i < NEAR_PLANE_CORNER_COUNT; i ++) {

      const nearPlaneCorner = _v3B.copy(this._nearPlaneCorners[ i ]);
      nearPlaneCorner.applyMatrix4(_rotationMatrix);

      const origin = _v3C.addVectors(this._target, nearPlaneCorner);
      _raycaster.set(origin, rayDirection);
      const intersects = _raycaster.intersectObjects(this.colliderMeshes, true);

      if (intersects.length > 0 && intersects[ 0 ].distance < distance) {

        distance = intersects[ 0 ].distance;

      }

    }

    return Math.max(distance, this.minDistance);

  }

  private _getClientRect(out: DOMRect): DOMRect {

    if (this._viewport) {

      const domElement = this._domElement;
      if (! domElement) {
        return out;
      }

      const rect = domElement.getBoundingClientRect();
      out.x = rect.x + this._viewport.x * rect.width;
      out.y = rect.y + this._viewport.y * rect.height;
      out.width = this._viewport.z * rect.width;
      out.height = this._viewport.w * rect.height;
      return out;

    }

    if (this._domElement) {

      const rect = this._domElement.getBoundingClientRect();
      out.x = rect.x;
      out.y = rect.y;
      out.width = rect.width;
      out.height = rect.height;

    }

    return out;

  }

  private _createOnRestPromise(resolveImmediately: boolean): Promise<void> {

    if (resolveImmediately) {

      this._hasRested = true;
      this._dispatcher.dispatchEvent({ type: 'rest' });
      this._dispatcher.dispatchEvent({ type: 'sleep' });
      return Promise.resolve();

    }

    this._hasRested = false;

    return new Promise((resolve) => {

      const onRest = (): void => {

        this.removeEventListener('rest', onRest);
        resolve();

      };

      this.addEventListener('rest', onRest);

    });

  }

  // EventDispatcher mixin methods — assigned in constructor
  private _addAllEventListeners!: (domElement: HTMLElement) => void;
  private _removeAllEventListeners!: () => void;

  // Drag lifecycle callbacks — assigned in constructor
  private _startDragging!: (event?: PointerEvent) => void;
  private _dragging!: () => void;
  private _endDragging!: () => void;

  // Drag state vectors — assigned in constructor
  private _dragStartPosition!: THREE.Vector2;
  private _lastDragPosition!: THREE.Vector2;
  private _dollyStart!: THREE.Vector2;

  // Pointer event handler refs — used for add/remove listener pairing
  private _onPointerMove?: (event: PointerEvent) => void;
  private _onPointerUp?: (event: PointerEvent) => void;
  private _onPointerLockChange?: () => void;
  private _onPointerLockError?: () => void;

  // Scroll timestamp
  private _lastScrollTimeStamp = - 1;

}
