/**
 * @module camera/types
 *
 * Public types, enums, and interfaces for the {@link CameraControls} component.
 */

import type * as THREE from 'three';
import type { ComponentOptions } from '../types';

// ─── Velocity reference ─────────────────────────────────────────────────────

/**
 * Mutable reference used by {@link smoothDamp} to track velocity across frames.
 * @internal
 */
export interface Ref {
	value: number;
}

// ─── MOUSE_BUTTON enum ──────────────────────────────────────────────────────

/**
 * Mouse button bitmask values (matches `MouseEvent.buttons` semantics).
 *
 * | Flag    | Value |
 * |---------|-------|
 * | `LEFT`  | `1`   |
 * | `RIGHT` | `2`   |
 * | `MIDDLE`| `4`   |
 */
export const MOUSE_BUTTON = {
	LEFT: 1,
	RIGHT: 2,
	MIDDLE: 4,
} as const;

/** Union of {@link MOUSE_BUTTON} values. */
export type MOUSE_BUTTON = ( typeof MOUSE_BUTTON )[ keyof typeof MOUSE_BUTTON ];

// ─── ACTION bitmask enum ────────────────────────────────────────────────────

/**
 * Bitmask values identifying the current user interaction.
 *
 * Mouse actions occupy bits 0–5, touch actions bits 6–19.
 * Combined touch actions (e.g. `TOUCH_DOLLY_TRUCK`) are **single** bitmask
 * values, not bitwise ORs — they represent a simultaneous gesture.
 */
export const ACTION = Object.freeze( {
	NONE:                   0b0,
	ROTATE:                 0b1,
	TRUCK:                  0b10,
	SCREEN_PAN:             0b100,
	OFFSET:                 0b1000,
	DOLLY:                  0b10000,
	ZOOM:                   0b100000,
	TOUCH_ROTATE:           0b1000000,
	TOUCH_TRUCK:            0b10000000,
	TOUCH_SCREEN_PAN:       0b100000000,
	TOUCH_OFFSET:           0b1000000000,
	TOUCH_DOLLY:            0b10000000000,
	TOUCH_ZOOM:             0b100000000000,
	TOUCH_DOLLY_TRUCK:      0b1000000000000,
	TOUCH_DOLLY_SCREEN_PAN: 0b10000000000000,
	TOUCH_DOLLY_OFFSET:     0b100000000000000,
	TOUCH_DOLLY_ROTATE:     0b1000000000000000,
	TOUCH_ZOOM_TRUCK:       0b10000000000000000,
	TOUCH_ZOOM_OFFSET:      0b100000000000000000,
	TOUCH_ZOOM_SCREEN_PAN:  0b1000000000000000000,
	TOUCH_ZOOM_ROTATE:      0b10000000000000000000,
} as const );

/** Bitmask union of all {@link ACTION} values. */
export type ACTION = number;

// ─── DOLLY_DIRECTION enum ───────────────────────────────────────────────────

/**
 * Direction of the last dolly operation.
 *
 * | Value   | Meaning       |
 * |---------|---------------|
 * | `NONE`  | No dolly      |
 * | `IN`    | Dolly inward  |
 * | `OUT`   | Dolly outward |
 */
export const DOLLY_DIRECTION = {
	NONE: 0,
	IN: 1,
	OUT: - 1,
} as const;

/** Union of {@link DOLLY_DIRECTION} values. */
export type DOLLY_DIRECTION = ( typeof DOLLY_DIRECTION )[ keyof typeof DOLLY_DIRECTION ];

// ─── Action type narrowing ──────────────────────────────────────────────────

/** Valid {@link ACTION} values for mouse button assignments. */
type mouseButtonAction =
	| typeof ACTION.ROTATE
	| typeof ACTION.TRUCK
	| typeof ACTION.SCREEN_PAN
	| typeof ACTION.OFFSET
	| typeof ACTION.DOLLY
	| typeof ACTION.ZOOM
	| typeof ACTION.NONE;

/** Valid {@link ACTION} values for mouse wheel assignment. */
type mouseWheelAction = mouseButtonAction;

/** Valid {@link ACTION} values for single-touch assignment. */
type singleTouchAction =
	| typeof ACTION.TOUCH_ROTATE
	| typeof ACTION.TOUCH_TRUCK
	| typeof ACTION.TOUCH_SCREEN_PAN
	| typeof ACTION.TOUCH_OFFSET
	| typeof ACTION.DOLLY
	| typeof ACTION.ZOOM
	| typeof ACTION.NONE;

/** Valid {@link ACTION} values for multi-touch assignment. */
type multiTouchAction =
	| typeof ACTION.TOUCH_DOLLY_ROTATE
	| typeof ACTION.TOUCH_DOLLY_TRUCK
	| typeof ACTION.TOUCH_DOLLY_OFFSET
	| typeof ACTION.TOUCH_ZOOM_ROTATE
	| typeof ACTION.TOUCH_ZOOM_TRUCK
	| typeof ACTION.TOUCH_ZOOM_OFFSET
	| typeof ACTION.TOUCH_DOLLY
	| typeof ACTION.TOUCH_ZOOM
	| typeof ACTION.TOUCH_ROTATE
	| typeof ACTION.TOUCH_TRUCK
	| typeof ACTION.TOUCH_SCREEN_PAN
	| typeof ACTION.TOUCH_OFFSET
	| typeof ACTION.NONE;

// ─── Pointer input ──────────────────────────────────────────────────────────

/** Internal representation of an active pointer. */
export interface PointerInput {
	pointerId: number;
	clientX: number;
	clientY: number;
	deltaX: number;
	deltaY: number;
	mouseButton: MOUSE_BUTTON | null;
}

// ─── Mouse / Touch configuration ────────────────────────────────────────────

/**
 * Mouse button → action mapping.
 *
 * | Property  | Default (Perspective) | Default (Orthographic) |
 * |-----------|-----------------------|------------------------|
 * | `left`    | `ROTATE`              | `ROTATE`               |
 * | `middle`  | `DOLLY`               | `DOLLY`                |
 * | `right`   | `TRUCK`               | `TRUCK`                |
 * | `wheel`   | `DOLLY`               | `ZOOM`                 |
 */
export interface MouseButtons {
	left: mouseButtonAction;
	middle: mouseButtonAction;
	right: mouseButtonAction;
	wheel: mouseWheelAction;
}

/**
 * Touch gesture → action mapping.
 *
 * | Property  | Default (Perspective) | Default (Orthographic) |
 * |-----------|-----------------------|------------------------|
 * | `one`     | `TOUCH_ROTATE`        | `TOUCH_ROTATE`         |
 * | `two`     | `TOUCH_DOLLY_TRUCK`   | `TOUCH_ZOOM_TRUCK`     |
 * | `three`   | `TOUCH_TRUCK`         | `TOUCH_TRUCK`          |
 */
export interface Touches {
	one: singleTouchAction;
	two: multiTouchAction;
	three: multiTouchAction;
}

// ─── FitToOptions ───────────────────────────────────────────────────────────

/** Options for {@link CameraControls.fitToBox}. */
export interface FitToOptions {
	/** `true` to fill the entire screen (cover), `false` to fit within (contain). @default false */
	cover: boolean;
	/** Left padding in world units. @default 0 */
	paddingLeft: number;
	/** Right padding in world units. @default 0 */
	paddingRight: number;
	/** Bottom padding in world units. @default 0 */
	paddingBottom: number;
	/** Top padding in world units. @default 0 */
	paddingTop: number;
}

// ─── Events ─────────────────────────────────────────────────────────────────

/** Typed event map for {@link CameraControls}. */
export interface CameraControlsEventMap {
	update: { type: 'update' };
	wake: { type: 'wake' };
	rest: { type: 'rest' };
	sleep: { type: 'sleep' };
	transitionstart: { type: 'transitionstart' };
	controlstart: { type: 'controlstart' };
	control: { type: 'control' };
	controlend: { type: 'controlend' };
}

/** Event type keys. */
export type CameraControlsEventType = keyof CameraControlsEventMap;

/** Base event shape dispatched by {@link CameraControls}. */
export interface CameraControlsEvent {
	type: CameraControlsEventType;
	target: unknown;
}

// ─── LerpState ──────────────────────────────────────────────────────────────

/**
 * State descriptor used by {@link CameraControls.lerp}.
 *
 * A lerp state is either **spherical** (orbit angles + radius) or
 * **positional** (absolute camera position), plus a target point.
 */
export type CameraControlsLerpState = {
	target: [ number, number, number ];
} & ( {
	spherical: Parameters<THREE.Spherical[ 'set' ]>;
} | {
	position: [ number, number, number ];
} );

// ─── Constructor options ────────────────────────────────────────────────────

/**
 * Options for constructing a {@link CameraControls} instance.
 *
 * @example
 * ```ts
 * const controls = new CameraControls({
 *   camera,
 *   domElement: renderer.domElement,
 *   smoothTime: 0.3,
 *   dollySpeed: 1.5,
 * });
 * ```
 */
export interface CameraControlsOptions extends ComponentOptions {
	/** The camera to control. Supports `PerspectiveCamera` and `OrthographicCamera`. */
	camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;

	/** The DOM element to attach pointer events to (usually `renderer.domElement`). */
	domElement?: HTMLElement;

	// ── Angle limits ──────────────────────────────────────────────────────

	/** Minimum polar (vertical) angle in radians. @default 0 */
	minPolarAngle?: number;

	/** Maximum polar (vertical) angle in radians. @default Math.PI */
	maxPolarAngle?: number;

	/** Minimum azimuth (horizontal) angle in radians. @default -Infinity */
	minAzimuthAngle?: number;

	/** Maximum azimuth (horizontal) angle in radians. @default Infinity */
	maxAzimuthAngle?: number;

	// ── Distance / zoom limits ────────────────────────────────────────────

	/** Minimum distance from target (perspective). @default Number.EPSILON */
	minDistance?: number;

	/** Maximum distance from target (perspective). @default Infinity */
	maxDistance?: number;

	/** Allow dolly past the target point. @default false */
	infinityDolly?: boolean;

	/** Minimum zoom factor (orthographic). @default 0.01 */
	minZoom?: number;

	/** Maximum zoom factor (orthographic). @default Infinity */
	maxZoom?: number;

	// ── Smooth / speed ────────────────────────────────────────────────────

	/** Smooth time for programmatic transitions (seconds). @default 0.25 */
	smoothTime?: number;

	/** Smooth time while the user is dragging (seconds). @default 0.125 */
	draggingSmoothTime?: number;

	/** Maximum interpolation speed. @default Infinity */
	maxSpeed?: number;

	/** Horizontal rotation speed multiplier. @default 1.0 */
	azimuthRotateSpeed?: number;

	/** Vertical rotation speed multiplier. @default 1.0 */
	polarRotateSpeed?: number;

	/** Mouse-wheel dolly speed multiplier. @default 1.0 */
	dollySpeed?: number;

	/** Invert drag direction when dollying / zooming. @default false */
	dollyDragInverted?: boolean;

	/** Truck / pedestal drag speed multiplier. @default 2.0 */
	truckSpeed?: number;

	// ── Behavior flags ────────────────────────────────────────────────────

	/** Whether the controls are enabled. @default true */
	enabled?: boolean;

	/** Dolly toward the mouse cursor instead of screen center. @default false */
	dollyToCursor?: boolean;

	/** Drag translates the focal offset instead of trucking. @default false */
	dragToOffset?: boolean;

	/** Friction factor at boundary edges (0 = hard clamp, 1 = no friction). @default 0 */
	boundaryFriction?: number;

	/** Threshold for considering the camera at rest. @default 0.01 */
	restThreshold?: number;

	/** When true, constrains the camera position (not just target) within boundary. @default false */
	boundaryEnclosesCamera?: boolean;

	// ── Input mapping ─────────────────────────────────────────────────────

	/** Mouse button → action mapping. */
	mouseButtons?: MouseButtons;

	/** Touch gesture → action mapping. */
	touches?: Touches;

	// ── Boundary / viewport / collision ───────────────────────────────────

	/** Boundary box constraining the camera target or position. */
	boundary?: THREE.Box3;

	/** Viewport scissor region for rendering into a sub-region. */
	viewport?: { x: number; y: number; width: number; height: number };

	/** Meshes that the camera cannot pass through. */
	colliderMeshes?: THREE.Object3D[];

	// ── Event callbacks ───────────────────────────────────────────────────

	/** Fired every frame the camera updates. */
	onUpdate?: () => void;

	/** Fired when the camera starts moving. */
	onWake?: () => void;

	/** Fired when camera movement drops below `restThreshold`. */
	onRest?: () => void;

	/** Fired when the camera stops moving. */
	onSleep?: () => void;

	/** Fired when any transition begins. */
	onTransitionStart?: () => void;

	/** Fired when the user starts dragging. */
	onControlStart?: () => void;

	/** Fired while the user is dragging. */
	onControl?: () => void;

	/** Fired when the user stops dragging. */
	onControlEnd?: () => void;
}
