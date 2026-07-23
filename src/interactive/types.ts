import type * as THREE from 'three';

// ─── Event Types ──────────────────────────────────────────────

/**
 * All pointer event types supported by {@link InteractiveManager}.
 *
 * Follows R3F's event model:
 *
 * | Type            | Source               | Bubbles | DOM equivalent  |
 * |-----------------|----------------------|---------|-----------------|
 * | `click`         | down→up on same obj  | Yes*    | `click`         |
 * | `doubleclick`   | two rapid clicks     | Yes*    | `dblclick`      |
 * | `pointerdown`   | DOM `pointerdown`    | Yes*    | `pointerdown`   |
 * | `pointerup`     | DOM `pointerup`      | Yes*    | `pointerup`     |
 * | `pointermove`   | DOM `pointermove`    | Yes*    | `pointermove`   |
 * | `pointerover`   | hover enter (synth)  | Yes*    | `mouseover`     |
 * | `pointerout`    | hover leave (synth)  | —       | `mouseout`      |
 * | `pointerenter`  | hover enter (synth)  | —       | `mouseenter`    |
 * | `pointerleave`  | hover leave (synth)  | —       | `mouseleave`    |
 * | `pointercancel` | pointer cancelled    | —       | `pointercancel` |
 * | `lostpointercapture` | lost capture    | —       | `lostpointercapture` |
 * | `wheel`         | DOM `wheel`          | Yes*    | `wheel`         |
 * | `contextmenu`   | DOM `contextmenu`    | Yes*    | `contextmenu`   |
 * | `pointermissed` | click on void        | —       | —               |
 *
 * * "Bubbles" in R3F means the event is dispatched on each intersection
 *   in the flat sorted list; `stopPropagation()` breaks the iteration.
 *   This is NOT DOM-style parent-chain bubbling.
 */
export type PointerEventType =
  | 'click'
  | 'doubleclick'
  | 'pointerdown'
  | 'pointerup'
  | 'pointermove'
  | 'pointerover'
  | 'pointerout'
  | 'pointerenter'
  | 'pointerleave'
  | 'pointercancel'
  | 'lostpointercapture'
  | 'wheel'
  | 'contextmenu'
  | 'pointermissed';

// ─── Intersection ─────────────────────────────────────────────

/**
 * A single raycast intersection resolved to a registered Object3D.
 *
 * Mirrors R3F's `Intersection`: when the ray hits a child mesh,
 * `object` is the actual hit mesh and `eventObject` is the
 * **registered** ancestor that owns the handler.
 *
 * Each raw Three.js hit may produce multiple `Intersection` entries
 * (one per registered ancestor) — they are all added to the flat
 * intersections list and processed sequentially.
 */
export interface Intersection {
  /** The actual Three.js object that the ray intersected. */
  object: THREE.Object3D;
  /** The registered Object3D that owns the handler (may be an ancestor of `object`). */
  eventObject: THREE.Object3D;
  /** Distance from camera to intersection point. */
  distance: number;
  /** Intersection point in world space. */
  point: THREE.Vector3;
  /** Face at intersection, if available. */
  face?: THREE.Face | null;
  /** Face index, if available. */
  faceIndex?: number;
  /** Instance ID (for InstancedMesh), if available. */
  instanceId?: number | null;
  /** UV coordinates at intersection, if available. */
  uv?: THREE.Vector2;
}

// ─── Intersection Event ───────────────────────────────────────

/**
 * Event object delivered to handlers, adapted from R3F's `IntersectionEvent`.
 *
 * Carries full raycast context plus propagation control.
 * `stopPropagation()` breaks the flat intersection iteration
 * (same as R3F's `localState.stopped` mechanism).
 */
export interface IntersectionEvent {
  /** The actual Three.js object that the ray intersected. */
  object: THREE.Object3D;
  /** The registered Object3D that this handler is bound to. */
  eventObject: THREE.Object3D;
  /** Distance from camera to intersection point. */
  distance: number;
  /** Intersection point in world space. */
  point: THREE.Vector3;
  /** Face at intersection, if available. */
  face?: THREE.Face | null;
  /** Face index, if available. */
  faceIndex?: number;
  /** Instance ID, if available. */
  instanceId?: number | null;
  /** UV coordinates at intersection, if available. */
  uv?: THREE.Vector2;
  /** The ray used for intersection (world space). */
  ray: THREE.Ray;
  /** The camera used for raycasting. */
  camera: THREE.Camera;
  /** Normalized pointer position in NDC (−1 to +1). */
  pointer: THREE.Vector2;
  /** All intersections from this raycast (sorted by distance). */
  intersections: Intersection[];
  /** Delta from pointerdown position in CSS pixels. Available on click/up events. */
  delta: number;
  /** The native DOM PointerEvent / WheelEvent that triggered this. */
  nativeEvent: PointerEvent | WheelEvent;
  /** Call to stop the flat intersection iteration (R3F-style propagation). */
  stopPropagation: () => void;
  /** Whether propagation has been stopped. */
  stopped: boolean;
  /** Unprojected point: pointer NDC unprojected onto the camera plane. */
  unprojectedPoint: THREE.Vector3;
  /** Pointer capture API on the event target. */
  target: {
    hasPointerCapture: (id: number) => boolean;
    setPointerCapture: (id: number) => void;
    releasePointerCapture: (id: number) => void;
  };
  /** Same as target (for currentTarget semantics). */
  currentTarget: {
    hasPointerCapture: (id: number) => boolean;
    setPointerCapture: (id: number) => void;
    releasePointerCapture: (id: number) => void;
  };
}

// ─── Event Handlers ───────────────────────────────────────────

/**
 * Map of event type to handler callback.
 *
 * Provide this when calling {@link InteractiveManager.add}.
 * Only non-undefined entries are listened for.
 *
 * @example
 * ```ts
 * manager.add(mesh, {
 *   onClick: (e) => console.log('clicked', e.eventObject),
 *   onPointerOver: (e) => { mesh.material.emissive.setHex(0x333333); },
 *   onPointerOut: (e) => { mesh.material.emissive.setHex(0x000000); },
 * });
 * ```
 */
export interface EventHandlers {
  onClick?: (event: IntersectionEvent) => void;
  onDoubleClick?: (event: IntersectionEvent) => void;
  onPointerDown?: (event: IntersectionEvent) => void;
  onPointerUp?: (event: IntersectionEvent) => void;
  onPointerMove?: (event: IntersectionEvent) => void;
  /** Fired when pointer enters (synthetic, dispatched with enter during move). */
  onPointerOver?: (event: IntersectionEvent) => void;
  /** Fired when pointer leaves (synthetic, dispatched with leave by cancelPointer). */
  onPointerOut?: (event: IntersectionEvent) => void;
  /** Fired when pointer enters (synthetic, dispatched with over during move). */
  onPointerEnter?: (event: IntersectionEvent) => void;
  /** Fired when pointer leaves (synthetic, dispatched with out by cancelPointer). */
  onPointerLeave?: (event: IntersectionEvent) => void;
  /** Non-bubbling. Pointer event was cancelled. */
  onPointerCancel?: (event: IntersectionEvent) => void;
  /** Non-bubbling. Pointer capture was lost. */
  onLostPointerCapture?: (event: IntersectionEvent) => void;
  onWheel?: (event: IntersectionEvent) => void;
  onContextMenu?: (event: IntersectionEvent) => void;
  /** Fires when a click occurs but this registered object was not hit. */
  onPointerMissed?: (event: IntersectionEvent) => void;
}

// ─── Controls Interface ───────────────────────────────────────

/**
 * Minimal camera-controller interface needed to suppress during drag.
 *
 * Compatible with `OrbitControls` and other Three.js controls.
 */
export interface ControlsLike {
  enabled?: boolean;
}

// ─── Pointer Capture Target ───────────────────────────────────

/**
 * Data stored per captured object, mirrors R3F's `PointerCaptureTarget`.
 */
export interface PointerCaptureTarget {
  intersection: Intersection;
  target: Element;
}

// ─── Options ──────────────────────────────────────────────────

/**
 * Custom NDC computation hook.
 *
 * Override to support scissor regions (e.g. GizmoHelper overlay)
 * or off-screen canvases.
 */
export type ComputeNDCFn = (
  event: PointerEvent | WheelEvent,
  rect: DOMRect,
  target: THREE.Vector2,
) => THREE.Vector2;

/**
 * Custom intersection filter hook.
 *
 * Called after raycasting, before dispatch. Return a filtered/sorted
 * array of raw Three.js intersections.
 */
export type FilterIntersectionsFn = (
  intersections: THREE.Intersection[],
) => THREE.Intersection[];

/**
 * Options for constructing an {@link InteractiveManager}.
 */
export interface InteractiveManagerOptions {
  /** The camera used for raycasting. Updated externally (e.g. by OrbitControls). */
  camera: THREE.Camera;

  /** The canvas element (or `renderer.domElement`) to attach DOM listeners to. */
  domElement: HTMLElement;

  /**
   * The scene or root object to raycast into.
   *
   * - **Provided**: one `intersectObject(scene, true)` call raycasts the entire
   *   tree; hits are resolved to registered objects via parent-chain walking.
   * - **Omitted**: `intersectObjects(registered, recursive)` only hits
   *   registered objects.
   */
  scene?: THREE.Object3D;

  /**
   * Camera controller to temporarily disable during pointer-down drag.
   */
  controls?: ControlsLike;

  /**
   * Pixel distance threshold for click-vs-drag discrimination.
   * @default 2
   */
  clickThreshold?: number;

  /**
   * Maximum time in ms between pointerdown and pointerup to count as a click.
   * @default 300
   */
  clickTimeThreshold?: number;

  /**
   * Maximum time in ms between two clicks for a doubleclick.
   * @default 300
   */
  doubleClickTimeThreshold?: number;

  /**
   * Whether to raycast recursively into children of registered objects.
   *
   * Only applies when `scene` is **not** provided.
   * @default true
   */
  recursive?: boolean;

  /**
   * Custom raycast coordinate normalization hook.
   */
  computeNDC?: ComputeNDCFn;

  /**
   * Custom intersection filter on raw Three.js intersections
   * (before expanding to registered ancestors).
   */
  filterIntersections?: FilterIntersectionsFn;
}
