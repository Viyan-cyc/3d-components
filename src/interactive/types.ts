
import type * as THREE from 'three';

// ─── Event Types ──────────────────────────────────────────────

/**
 * All pointer event types supported by {@link InteractiveManager}.
 *
 * Event model:
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
 * * "Bubbles" means the event is dispatched on each intersection
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
 * When the ray hits a child mesh,
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

  /** Index into the geometry's index buffer (THREE.Intersection.index). Used in composite hover key. */
  index?: number;

  /** Instance ID (for InstancedMesh), if available. Used in composite hover key. */
  instanceId?: number | null;

  /** UV coordinates at intersection, if available. */
  uv?: THREE.Vector2;
}

// ─── Intersection Event ───────────────────────────────────────

/**
 * Event object delivered to handlers.
 *
 * Carries full raycast context plus propagation control.
 * `stopPropagation()` breaks the flat intersection iteration
 * (stopped mechanism).
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

  /** Index into the geometry's index buffer (THREE.Intersection.index). */
  index?: number;

  /** Instance ID (for InstancedMesh), if available. */
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

  /** Call to stop the flat intersection iteration. */
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

  /** ✅ 冒泡 — 左键单击（down→up 距离≤阈值，且在 initialHits 中） */
  onClick?: (event: IntersectionEvent) => void;

  /** ✅ 冒泡 — 左键双击（替代第二次 click 触发） */
  onDoubleClick?: (event: IntersectionEvent) => void;

  /** ✅ 冒泡 — 任意鼠标键按下 */
  onPointerDown?: (event: IntersectionEvent) => void;

  /** ✅ 冒泡 — 任意鼠标键抬起 */
  onPointerUp?: (event: IntersectionEvent) => void;

  /** ✅ 冒泡 — 指针在已悬停对象上移动 */
  onPointerMove?: (event: IntersectionEvent) => void;

  /** ✅ 冒泡 — 指针进入对象（与 enter 同时触发，在 move 的 handleIntersects 回调中派发） */
  onPointerOver?: (event: IntersectionEvent) => void;

  /** ❌ 不冒泡 — 指针离开对象（与 leave 同时触发，由 cancelPointer 直接 per-object 派发） */
  onPointerOut?: (event: IntersectionEvent) => void;

  /** ✅ 冒泡 — 指针进入对象（与 over 同时触发，在 move 的 handleIntersects 回调中派发） */
  onPointerEnter?: (event: IntersectionEvent) => void;

  /** ❌ 不冒泡 — 指针离开对象（与 out 同时触发，由 cancelPointer 直接 per-object 派发） */
  onPointerLeave?: (event: IntersectionEvent) => void;

  /** ❌ 不冒泡 — 指针取消（触发 cancelPointer 清除所有悬停） */
  onPointerCancel?: (event: IntersectionEvent) => void;

  /** ❌ 不冒泡 — 指针捕获丢失（由 DOM 事件触发） */
  onLostPointerCapture?: (event: IntersectionEvent) => void;

  /** ✅ 冒泡 — 鼠标滚轮 */
  onWheel?: (event: IntersectionEvent) => void;

  /** ✅ 冒泡 — 右键菜单 */
  onContextMenu?: (event: IntersectionEvent) => void;

  /** ❌ 不冒泡 — 点击空白区域（直接 per-object 派发） */
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
 * Data stored per captured object.
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
