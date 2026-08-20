
import * as THREE from 'three';
import type {
  ComputeNDCFn,
  ControlsLike,
  EventHandlers,
  FilterIntersectionsFn,
  InteractiveManagerOptions,
  Intersection,
  IntersectionEvent,
  PointerCaptureTarget,
} from './types';
import {
  type RegistrationEntry,
  computeNDC,
  hasPointerHandlers,
  makeIntersectionId,
} from './utils';
import type { IDisposable } from '../types';

/** Pixel distance threshold for click-vs-drag discrimination. */
const CLICK_THRESHOLD = 2;

/** Maximum time (ms) between two clicks for a doubleclick. */
const DOUBLE_CLICK_TIME_MS = 300;

/** Pointer capture API surface exposed on IntersectionEvent target/currentTarget. */
type PointerCaptureApi = {
  hasPointerCapture: (id: number) => boolean;
  setPointerCapture: (id: number) => void;
  releasePointerCapture: (id: number) => void;
};

/**
 * Centralized raycaster-based interaction system.
 *
 * ## Architecture
 *
 * 1. **Intersection expansion**: Each raw Three.js hit is expanded into
 *    multiple `Intersection` entries — one per registered ancestor. A hit
 *    on a child mesh produces entries for both the child AND its registered
 *    parent(s), all in a flat sorted list.
 *
 * 2. **Flat iteration (not DOM-style bubbling)**: Events are dispatched by
 *    iterating the flat intersection list. `stopPropagation()` breaks the
 *    loop — it does NOT walk the parent chain.
 *
 * 3. **Hover tracking**: Keyed by `eventObject.uuid` (the registered object),
 *    so moving between child meshes of the same registered object does not
 *    fire `out`/`over`. `over`+`enter` fire together on new hover;
 *    `out`+`leave` fire together via `cancelPointer`.
 *
 * 4. **Click validation**: Only fires on `initialHits` (objects hit during
 *    pointerDown). `pointerMissed` fires on non-hit registered objects.
 *
 * @example
 * ```ts
 * const manager = new InteractiveManager({
 *   camera,
 *   domElement: renderer.domElement,
 *   scene,
 *   controls: orbitControls,
 * });
 *
 * manager.add(myMesh, {
 *   onClick: (e) => console.log('clicked!', e.eventObject),
 *   onPointerOver: (e) => { e.eventObject.material.emissive.setHex(0x333333); },
 *   onPointerOut: (e) => { e.eventObject.material.emissive.setHex(0x000000); },
 * });
 *
 * manager.dispose();
 * ```
 */
export class InteractiveManager implements IDisposable {

  // ─── Config (immutable) ────────────────────────────────────

  /** 可变：数据驱动场景会在 applySceneData 里替换相机（透视↔正交），经 setCamera() 同步，否则 raycast 用旧相机。 */
  private _camera: THREE.Camera;
  private readonly _domElement: HTMLElement;
  private readonly _scene: THREE.Object3D | undefined;
  private readonly _controls: ControlsLike | undefined;
  private readonly _clickThreshold: number;
  private readonly _doubleClickTimeThreshold: number;
  private readonly _recursive: boolean;
  private readonly _computeNDC: ComputeNDCFn | undefined;
  private readonly _filterIntersections: FilterIntersectionsFn | undefined;

  // ─── Raycaster state ───────────────────────────────────────

  private readonly _raycaster = new THREE.Raycaster();
  private readonly _ndc = new THREE.Vector2();

  // ─── Registry ──────────────────────────────────────────────

  /** Object3D → subscriber entries (one per `id`). Multiple subscribers can attach to the same object. */
  private readonly _registry = new Map<THREE.Object3D, RegistrationEntry[]>();

  /** Ordered list of registered objects (for intersectObjects when no scene). Each object appears once. */
  private readonly _interaction: THREE.Object3D[] = [];

  // ─── Hover state ───────────────────────────────────────────

  /** eventObject.uuid → { intersection, stopped }（按注册对象去重：同一注册对象的子 mesh 间移动不触发 out/over）  */
  private readonly _hovered = new Map<string, { intersection: Intersection; stopped: boolean }>();

  // ─── Pointer capture ───────────────────────────────────────

  /** pointerId → Map<Object3D, PointerCaptureTarget>  */
  private readonly _capturedMap = new Map<number, Map<THREE.Object3D, PointerCaptureTarget>>();

  // ─── Click validation ──────────────────────────────────────

  private _initialClick: [number, number] = [0, 0];
  private _initialHits: THREE.Object3D[] = [];

  /** Per-object double-click tracking: eventObject → last click timestamp. */
  private readonly _lastClickTimes = new Map<THREE.Object3D, number>();

  // ─── Controls suppression ──────────────────────────────────

  private _controlsWasEnabled = true;

  // ─── Enabled state ─────────────────────────────────────────

  private _enabled = true;

  // ─── Last move event (for update() hover refresh) ──────────

  private _lastPointerMoveEvent: PointerEvent | null = null;

  // ─── Bound DOM handlers ────────────────────────────────────

  private readonly _onPointerDown: (e: PointerEvent) => void;
  private readonly _onPointerMove: (e: PointerEvent) => void;
  private readonly _onPointerUp: (e: PointerEvent) => void;
  private readonly _onPointerLeave: (e: PointerEvent) => void;
  private readonly _onPointerCancel: (e: PointerEvent) => void;
  private readonly _onWheel: (e: WheelEvent) => void;
  private readonly _onContextMenu: (e: PointerEvent) => void;

  // ─── Constructor ───────────────────────────────────────────

  constructor(options: InteractiveManagerOptions) {
    this._camera = options.camera;
    this._domElement = options.domElement;
    this._scene = options.scene;
    this._controls = options.controls;
    this._clickThreshold = options.clickThreshold ?? CLICK_THRESHOLD;
    this._doubleClickTimeThreshold =
      options.doubleClickTimeThreshold ?? DOUBLE_CLICK_TIME_MS;
    this._recursive = options.recursive ?? true;
    this._computeNDC = options.computeNDC;
    this._filterIntersections = options.filterIntersections;

    // Bind handlers so we can remove them later
    this._onPointerDown = (e: PointerEvent) => this._handlePointerDown(e);
    this._onPointerMove = (e: PointerEvent) => this._handlePointerMove(e);
    this._onPointerUp = (e: PointerEvent) => this._handlePointerUp(e);
    this._onPointerLeave = () => this._cancelPointer([]);
    this._onPointerCancel = () => this._cancelPointer([]);
    this._onWheel = (e: WheelEvent) => this._handleWheel(e);
    this._onContextMenu = (e: PointerEvent) => this._handleContextMenu(e);

    // Attach DOM listeners
    this._domElement.addEventListener('pointerdown', this._onPointerDown);
    this._domElement.addEventListener('pointermove', this._onPointerMove);
    this._domElement.addEventListener('pointerup', this._onPointerUp);
    this._domElement.addEventListener('pointerleave', this._onPointerLeave);
    this._domElement.addEventListener('pointercancel', this._onPointerCancel);
    this._domElement.addEventListener('wheel', this._onWheel, { passive: false });
    this._domElement.addEventListener('contextmenu', this._onContextMenu);
  }

  // ─── Public API ────────────────────────────────────────────

  /**
   * 更新射线投射所用相机。
   *
   * 数据驱动场景在 applySceneData 阶段会新建相机并替换 app.camera（透视↔正交切换），
   * InteractiveManager 构造时捕获的相机引用会失效，导致 setFromCamera 仍用旧相机、
   * 射线与画面错位。相机被替换后调用本方法同步即可。
   */
  setCamera(camera: THREE.Camera): void {
    this._camera = camera;
  }

  /**
   * Register an Object3D with event handlers.
   *
   * Subscriber model:
   * - With `id`: appends a subscriber entry. Same `id` replaces; different `id`s coexist.
   *   Lets independent subsystems (selection, cards, declared interactions) attach
   *   handlers to the same object without overwriting each other.
   * - Without `id`: anonymous — replaces ALL existing entries for that object (legacy semantics).
   *
   * The object is added to the interaction list exactly once regardless of subscriber count.
   */
  add(object: THREE.Object3D, handlers: EventHandlers, id?: string): void {
    const entry: RegistrationEntry = {
      id,
      object,
      handlers,
      eventCount: this._countHandlers(handlers),
    };

    const existing = this._registry.get(object);
    if (!existing) {
      this._registry.set(object, [entry]);
      this._interaction.push(object);
      return;
    }

    if (id === undefined) {
      // Anonymous add: replace all entries (legacy overwrite semantics)
      this._registry.set(object, [entry]);
      return;
    }

    // Named subscriber: replace same-id entry, append otherwise
    const idx = existing.findIndex((e) => e.id === id);
    if (idx === -1) {
      existing.push(entry);
    } else {
      existing[idx] = entry;
    }
  }

  /**
   * Unregister handlers from an Object3D.
   *
   * - With `id`: removes only that subscriber's entry. Other subscribers remain.
   *   If the last entry is removed, the object is detached from the interaction list.
   * - Without `id`: removes ALL entries for that object (legacy semantics).
   *
   * If the object is currently hovered, fires `onPointerOut` / `onPointerLeave`
   * on the removed entries before removing them.
   */
  remove(object: THREE.Object3D, id?: string): void {
    const entries = this._registry.get(object);
    if (!entries || entries.length === 0) {
      return;
    }

    const removed = id === undefined
      ? entries
      : entries.filter((e) => e.id === id);

    if (removed.length === 0) {
      return;
    }

    // Clear hover entries for this eventObject, firing out/leave on removed subscribers
    for (const [hoverId, hoverEntry] of this._hovered) {
      if (hoverEntry.intersection.eventObject === object) {
        const ev = this._makeEventFromHover(hoverEntry.intersection, [], new PointerEvent('pointerout'));
        for (const e of removed) {
          e.handlers.onPointerOut?.(ev);
          e.handlers.onPointerLeave?.(ev);
        }
        this._hovered.delete(hoverId);
      }
    }

    // Release any captures held by removed subscribers
    for (const [pointerId, captures] of this._capturedMap) {
      if (captures.has(object)) {
        this._releaseInternalPointerCapture(object, captures, pointerId);
      }
    }

    if (id === undefined) {
      this._registry.delete(object);
    } else {
      const next = entries.filter((e) => e.id !== id);
      if (next.length === 0) {
        this._registry.delete(object);
      } else {
        this._registry.set(object, next);
      }
    }

    // Drop from interaction list only if fully unregistered
    if (!this._registry.has(object)) {
      const idx = this._interaction.indexOf(object);
      if (idx !== -1) {
        this._interaction.splice(idx, 1);
      }
    }
  }

  /**
   * Force a hover re-evaluation.
   *
   * Useful after camera animation where objects under the cursor may
   * have changed without a `pointermove` event.
   */
  update(_delta?: number): void { // eslint-disable-line @typescript-eslint/no-unused-vars
    if (this._lastPointerMoveEvent) {
      this._handlePointerMove(this._lastPointerMoveEvent);
    }
  }

  /**
   * Enable or disable the manager.
   */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }

  /**
   * Release all resources and remove DOM listeners.
   */
  dispose(): void {
    // Clear hover state
    this._cancelPointer([]);

    // Remove DOM listeners
    this._domElement.removeEventListener('pointerdown', this._onPointerDown);
    this._domElement.removeEventListener('pointermove', this._onPointerMove);
    this._domElement.removeEventListener('pointerup', this._onPointerUp);
    this._domElement.removeEventListener('pointerleave', this._onPointerLeave);
    this._domElement.removeEventListener('pointercancel', this._onPointerCancel);
    this._domElement.removeEventListener('wheel', this._onWheel);
    this._domElement.removeEventListener('contextmenu', this._onContextMenu);

    // Clear internal state
    this._registry.clear();
    this._interaction.length = 0;
    this._capturedMap.clear();
    this._initialClick = [0, 0];
    this._initialHits = [];
    this._lastClickTimes.clear();
    this._lastPointerMoveEvent = null;
  }

  // ─── Intersection Pipeline ───────────────

  /**
   * Perform raycast and return raw Three.js intersections.
   */
  private _raycastObjects(eventObjects: THREE.Object3D[]): THREE.Intersection[] {
    if (this._scene) {
      return this._raycaster.intersectObject(this._scene, true);
    }
    return eventObjects
      .flatMap((obj) => this._raycaster.intersectObject(obj, this._recursive))
      .sort((a, b) => a.distance - b.distance);
  }

  /**
   * Deduplicate raw hits by object uuid / index / instanceId.
   */
  private _dedupRawHits(rawHits: THREE.Intersection[], duplicates: Set<string>): THREE.Intersection[] {
    return rawHits.filter((item) => {
      const id = `${item.object.uuid}/${item.index ?? ''}${item.instanceId ?? ''}`;
      if (duplicates.has(id)) {
        return false;
      }
      duplicates.add(id);
      return true;
    });
  }

  /**
   * Expand raw hits into Intersection entries by walking the
   * parent chain to find registered ancestors.
   */
  private _expandToRegisteredAncestors(rawHits: THREE.Intersection[]): Intersection[] {
    const intersections: Intersection[] = [];
    for (const hit of rawHits) {
      let eventObject: THREE.Object3D | null = hit.object;
      while (eventObject) {
        const entries = this._registry.get(eventObject);
        if (entries && entries.some((e) => e.eventCount > 0)) {
          intersections.push({
            object: hit.object,
            eventObject,
            distance: hit.distance,
            point: hit.point.clone(),
            face: hit.face,
            index: hit.index ?? undefined,
            instanceId: hit.instanceId ?? undefined,
            uv: hit.uv ?? undefined,
          });
        }
        eventObject = eventObject.parent;
      }
    }
    return intersections;
  }

  /**
   * Inject pointer captures into the intersection list.
   */
  private _injectPointerCaptures(
    event: PointerEvent | WheelEvent,
    intersections: Intersection[],
    duplicates: Set<string>,
  ): void {
    if (!('pointerId' in event)) {
      return;
    }
    const capturedForPointer = this._capturedMap.get((event).pointerId);
    if (!capturedForPointer) {
      return;
    }
    for (const captureData of capturedForPointer.values()) {
      const capId = makeIntersectionId(captureData.intersection);
      if (!duplicates.has(capId)) {
        intersections.push(captureData.intersection);
        duplicates.add(capId);
      }
    }
  }

  /**
   * Perform raycast → dedup → filter → expand to registered ancestors
   * → inject captures.
   */
  private _intersect(
    event: PointerEvent | WheelEvent,
    filter?: (objects: THREE.Object3D[]) => THREE.Object3D[],
  ): Intersection[] {
    const rect = this._domElement.getBoundingClientRect();
    if (this._computeNDC) {
      this._computeNDC(event, rect, this._ndc);
    } else {
      computeNDC(event, rect, this._ndc);
    }
    this._raycaster.setFromCamera(this._ndc, this._camera);

    const eventObjects = filter ? filter(this._interaction) : this._interaction;
    const duplicates = new Set<string>();
    let rawHits = this._raycastObjects(eventObjects);

    rawHits = this._dedupRawHits(rawHits, duplicates);

    if (this._filterIntersections) {
      rawHits = this._filterIntersections(rawHits);
    }

    const intersections = this._expandToRegisteredAncestors(rawHits);
    this._injectPointerCaptures(event, intersections, duplicates);

    return intersections;
  }

  // ─── handleIntersects ─────────────

  /** Capture API surface exposed on IntersectionEvent.target. */
  private _buildCaptureTarget(hit: Intersection): PointerCaptureApi {
    const hasPointerCapture = (id: number): boolean =>
      this._capturedMap.get(id)?.has(hit.eventObject) ?? false;

    const setPointerCapture = (id: number): void => {
      const captureData: PointerCaptureTarget = {
        intersection: hit,
        target: this._domElement,
      };
      if (this._capturedMap.has(id)) {
        this._capturedMap.get(id)!.set(hit.eventObject, captureData);
      } else {
        this._capturedMap.set(id, new Map([[hit.eventObject, captureData]]));
      }
      try {
        this._domElement.setPointerCapture(id);
      } catch { /* ignore */ }
    };

    const releasePointerCapture = (id: number): void => {
      const captures = this._capturedMap.get(id);
      if (captures) {
        this._releaseInternalPointerCapture(hit.eventObject, captures, id);
      }
    };

    return { hasPointerCapture, setPointerCapture, releasePointerCapture };
  }

  /** Build the stopPropagation closure for an intersection event. */
  private _makeStopPropagation(
    hit: Intersection,
    intersections: Intersection[],
    event: PointerEvent | WheelEvent,
    ctx: { stopped: boolean },
    raycastEvent: IntersectionEvent,
  ): () => void {
    return () => {
      const capturesForPointer =
        'pointerId' in event && this._capturedMap.get((event).pointerId);
      if (!capturesForPointer || capturesForPointer.has(hit.eventObject)) {
        ctx.stopped = true;
        raycastEvent.stopped = true;
        if (
          this._hovered.size &&
          Array.from(this._hovered.values())
            .find((i) => i.intersection.eventObject === hit.eventObject)
        ) {
          const higher = intersections.slice(0, intersections.indexOf(hit));
          this._cancelPointer([...higher, hit]);
        }
      }
    };
  }

  /** Build an IntersectionEvent for a given hit and dispatch context. */
  private _buildIntersectionEvent(
    hit: Intersection,
    intersections: Intersection[],
    event: PointerEvent | WheelEvent,
    delta: number,
    ctx: { stopped: boolean; captureTarget: PointerCaptureApi },
  ): IntersectionEvent {
    const pointer = this._ndc.clone();
    const unprojectedPoint = new THREE.Vector3(pointer.x, pointer.y, 0)
      .unproject(this._camera);

    const raycastEvent: IntersectionEvent = {
      object: hit.object,
      eventObject: hit.eventObject,
      distance: hit.distance,
      point: hit.point,
      face: hit.face,
      index: hit.index,
      instanceId: hit.instanceId,
      uv: hit.uv,
      intersections,
      stopped: ctx.stopped,
      delta,
      unprojectedPoint,
      ray: this._raycaster.ray,
      camera: this._camera,
      pointer,
      nativeEvent: event,
      stopPropagation: () => {},
      target: ctx.captureTarget,
      currentTarget: ctx.captureTarget,
    };
    raycastEvent.stopPropagation = this._makeStopPropagation(hit, intersections, event, ctx, raycastEvent);

    return raycastEvent;
  }

  /**
   * Walk the flat intersection list, calling the callback for each.
   * `stopPropagation()` sets `localState.stopped = true` and breaks the loop.
   */
  private _handleIntersects(
    intersections: Intersection[],
    event: PointerEvent | WheelEvent,
    delta: number,
    callback: (ev: IntersectionEvent) => boolean | void,
  ): Intersection[] {
    if (intersections.length === 0) {
      return intersections;
    }

    const localState = { stopped: false };
    // 按注册对象（eventObject）去重：同一注册对象在一次事件中只 dispatch 首次命中点，
    // 避免 group 多 mesh 命中时 onClick 等事件触发 N 次。
    const dispatched = new Set<THREE.Object3D>();

    for (const hit of intersections) {
      if (dispatched.has(hit.eventObject)) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const entries = this._registry.get(hit.eventObject);
      if (!entries || !entries.some((e) => e.eventCount > 0)) {
        // eslint-disable-next-line no-continue
        continue;
      }
      dispatched.add(hit.eventObject);

      const captureTarget = this._buildCaptureTarget(hit);
      const ctx = { stopped: localState.stopped, captureTarget };
      const raycastEvent = this._buildIntersectionEvent(hit, intersections, event, delta, ctx);

      const ret = callback(raycastEvent);

      // handler 返回 true（或 stopPropagation 标记）则停止冒泡：不再 dispatch 更远命中点 / 其他注册对象
      if (localState.stopped === true || ret === true) {
        break;
      }
    }

    return intersections;
  }

  // ─── cancelPointer ───────────────────

  /**
   * Fire `onPointerOut` + `onPointerLeave` on all hovered objects
   * that are NOT in the provided intersection list.
   *
   *
   */
  private _cancelPointer(intersections: Intersection[]): void {
    for (const [id, hoverEntry] of this._hovered) {
      const hoveredObj = hoverEntry.intersection;
      // Check if this hovered object is still under the cursor
      // 按注册对象（eventObject）比较：同一注册对象的任意子 mesh 仍在命中里 → 仍悬停，
      // 不触发 out；所有子 mesh 都离开才 out。避免 group 内部 mesh 切换抖动。
      const stillHovered = intersections.find((hit) => hit.eventObject === hoveredObj.eventObject);

      if (!stillHovered) {
        const entries = this._registry.get(hoveredObj.eventObject);
        if (entries) {
          const data = this._makeEventFromHover(hoveredObj, intersections, new PointerEvent('pointerout'));
          for (const e of entries) {
            if (e.eventCount) {
              e.handlers.onPointerOut?.(data);
              e.handlers.onPointerLeave?.(data);
            }
          }
        }
        this._hovered.delete(id);
      }
    }
  }

  // ─── pointerMissed ───────────────────

  /**
   * Fire `onPointerMissed` on the specified objects.
   *
   */
  private _pointerMissed(event: PointerEvent, objects: THREE.Object3D[]): void {
    for (const obj of objects) {
      const entries = this._registry.get(obj);
      const missed = entries?.filter((e) => e.handlers.onPointerMissed) ?? [];
      if (missed.length > 0) {
        const ev: IntersectionEvent = {
          object: obj,
          eventObject: obj,
          distance: Infinity,
          point: new THREE.Vector3(),
          ray: this._raycaster.ray,
          camera: this._camera,
          pointer: this._ndc.clone(),
          intersections: [],
          delta: 0,
          nativeEvent: event,
          stopped: false,
          stopPropagation() {
            this.stopped = true;
          },
          unprojectedPoint: new THREE.Vector3(),
          target: {
            hasPointerCapture: () => false,
            setPointerCapture: () => {},
            releasePointerCapture: () => {},
          },
          currentTarget: {
            hasPointerCapture: () => false,
            setPointerCapture: () => {},
            releasePointerCapture: () => {},
          },
        };
        for (const e of missed) {
          e.handlers.onPointerMissed?.(ev);
        }
      }
    }
  }

  // ─── DOM Event Handlers ────────────────────────────────────

  /**
   * Dispatch hover tracking and pointermove for a single intersection.
   */
  private _dispatchPointerMove(data: IntersectionEvent): boolean {
    const entries = this._registry.get(data.eventObject);
    if (!entries) {
      return false;
    }
    const active = entries.filter((e) => e.eventCount > 0);
    if (active.length === 0) {
      return false;
    }

    let shouldStop = false;
    const hasHover = active.some((e) => hasPointerHandlers(e));
    if (hasHover) {
      const id = data.eventObject.uuid;
      const hoveredItem = this._hovered.get(id);
      if (!hoveredItem) {
        this._hovered.set(id, {
          intersection: {
            object: data.object,
            eventObject: data.eventObject,
            distance: data.distance,
            point: data.point.clone(),
            face: data.face,
            index: data.index,
            instanceId: data.instanceId,
            uv: data.uv,
          },
          stopped: false,
        });
        for (const e of active) {
          if (e.handlers.onPointerOver?.(data) === true) {
            shouldStop = true;
          }
          if (e.handlers.onPointerEnter?.(data) === true) {
            shouldStop = true;
          }
        }
      } else if (hoveredItem.stopped) {
        data.stopPropagation();
      }
    }

    for (const e of active) {
      if (e.handlers.onPointerMove?.(data) === true) {
        shouldStop = true;
      }
    }

    return shouldStop;
  }

  private _handlePointerMove(e: PointerEvent): void {
    if (!this._enabled) {
      return;
    }
    this._lastPointerMoveEvent = e;

    // Skip raycast entirely when no registered object has any hover handler.
    // In scene mode the per-object filterFn below has no effect (the whole tree
    // is raycast regardless), so this short-circuit is what keeps pointermove
    // cost-free when no hover interactions are declared.
    if (!this._hasAnyHoverHandler()) {
      if (this._hovered.size > 0) {
        this._cancelPointer([]);
      }
      return;
    }

    const filterFn = this._scene ? undefined : (objects: THREE.Object3D[]): THREE.Object3D[] =>
      objects.filter((obj) => {
        const entries = this._registry.get(obj);
        return Boolean(entries) && entries.some((en) => hasPointerHandlers(en));
      });

    const hits = this._intersect(e, filterFn);
    this._cancelPointer(hits);

    this._handleIntersects(hits, e, 0, (data) => this._dispatchPointerMove(data));
  }

  /**
   * Whether any registered subscriber (across all objects) has a hover handler.
   * Used to short-circuit pointermove raycasting when hover is unused.
   */
  private _hasAnyHoverHandler(): boolean {
    for (const entries of this._registry.values()) {
      for (const entry of entries) {
        if (hasPointerHandlers(entry)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Whether any registered subscriber declares an `onWheel` handler.
   * Used to short-circuit wheel raycasting when wheel is unused.
   */
  private _hasAnyWheelHandler(): boolean {
    for (const entries of this._registry.values()) {
      for (const entry of entries) {
        if (entry.handlers.onWheel) {
          return true;
        }
      }
    }
    return false;
  }

  private _handlePointerDown(e: PointerEvent): void {
    if (!this._enabled) {
      return;
    }

    const hits = this._intersect(e);

    // Save initial click coordinates and hit list
    this._initialClick = [e.offsetX, e.offsetY];
    this._initialHits = hits.map((hit) => hit.eventObject);

    // Suppress camera controls if we hit something
    if (hits.length > 0) {
      if (this._controls && 'enabled' in this._controls) {
        this._controlsWasEnabled = this._controls.enabled !== false;
        this._controls.enabled = false;
      }
    }

    this._handleIntersects(hits, e, 0, (data: IntersectionEvent): boolean => {
      const entries = this._registry.get(data.eventObject);
      if (!entries) {
        return false;
      }
      let shouldStop = false;
      for (const en of entries) {
        if (en.eventCount) {
          if (en.handlers.onPointerDown?.(data) === true) {
            shouldStop = true;
          }
        }
      }
      return shouldStop;
    });

    // If nothing hit, fire pointerMissed on all registered objects
    if (hits.length === 0) {
      this._pointerMissed(e, this._interaction);
    }
  }

  /**
   * Dispatch pointerup and click/double-click for a single intersection.
   */
  private _dispatchPointerUp(
    data: IntersectionEvent,
    isLeftButton: boolean,
    delta: number,
  ): boolean {
    const entries = this._registry.get(data.eventObject);
    if (!entries) {
      return false;
    }
    const active = entries.filter((e) => e.eventCount > 0);
    if (active.length === 0) {
      return false;
    }

    // Click / double-click detection is per-eventObject (shared across subscribers),
    // so a single click triggers onClick on every subscriber, not onClick + onDoubleClick.
    const inInitial = isLeftButton && delta <= this._clickThreshold && this._initialHits.includes(data.eventObject);
    let isClick = false;
    let isDoubleClick = false;
    if (inInitial) {
      const now = Date.now();
      const lastTime = this._lastClickTimes.get(data.eventObject) ?? 0;
      if (now - lastTime <= this._doubleClickTimeThreshold && lastTime > 0) {
        isDoubleClick = true;
        this._lastClickTimes.delete(data.eventObject);
      } else {
        isClick = true;
        this._lastClickTimes.set(data.eventObject, now);
      }
    }

    let shouldStop = false;
    for (const e of active) {
      const handlers = e.handlers;
      if (handlers.onPointerUp?.(data) === true) {
        shouldStop = true;
      }
      if (isClick) {
        if (handlers.onClick?.(data) === true) {
          shouldStop = true;
        }
      }
      if (isDoubleClick) {
        if (handlers.onDoubleClick?.(data) === true) {
          shouldStop = true;
        }
      }
    }

    return shouldStop;
  }

  /**
   * Fire pointerMissed for non-initial-hit objects during click.
   */
  private _fireClickMissed(e: PointerEvent, hits: Intersection[], delta: number): void {
    if (e.button !== 0 || delta > this._clickThreshold) {
      return;
    }
    if (hits.length === 0) {
      this._pointerMissed(e, this._interaction);
    } else {
      this._pointerMissed(
        e,
        this._interaction.filter((obj) => !this._initialHits.includes(obj)),
      );
    }
  }

  private _handlePointerUp(e: PointerEvent): void {
    if (!this._enabled) {
      return;
    }

    const isLeftButton = e.button === 0;
    const dx = e.offsetX - this._initialClick[0];
    const dy = e.offsetY - this._initialClick[1];
    const delta = Math.round(Math.hypot(dx, dy));

    const hits = this._intersect(e);

    this._handleIntersects(hits, e, delta, (data) =>
      this._dispatchPointerUp(data, isLeftButton, delta));

    this._fireClickMissed(e, hits, delta);

    if ('pointerId' in e) {
      const pointerId = (e).pointerId;
      const capturedSet = this._capturedMap.get(pointerId);
      if (capturedSet) {
        this._capturedMap.delete(pointerId);
      }
    }

    if (this._controls && 'enabled' in this._controls && this._controlsWasEnabled) {
      this._controls.enabled = true;
    }

    this._initialClick = [0, 0];
    this._initialHits = [];
  }

  private _handleWheel(e: WheelEvent): void {
    if (!this._enabled) {
      return;
    }

    // Skip raycast when no subscriber declares onWheel.
    // scene mode raycasts the whole tree per wheel tick; without this guard,
    // scroll-to-zoom would pay a full-tree raycast even when wheel is unused.
    if (!this._hasAnyWheelHandler()) {
      return;
    }

    const hits = this._intersect(e);

    this._handleIntersects(hits, e, 0, (data: IntersectionEvent): boolean => {
      const entries = this._registry.get(data.eventObject);
      if (!entries) {
        return false;
      }
      let shouldStop = false;
      for (const en of entries) {
        if (en.eventCount) {
          if (en.handlers.onWheel?.(data) === true) {
            shouldStop = true;
          }
        }
      }
      return shouldStop;
    });
  }

  private _handleContextMenu(e: PointerEvent): void {
    if (!this._enabled) {
      return;
    }

    const dx = e.offsetX - this._initialClick[0];
    const dy = e.offsetY - this._initialClick[1];
    const delta = Math.round(Math.hypot(dx, dy));

    const hits = this._intersect(e);

    this._handleIntersects(hits, e, delta, (data: IntersectionEvent): boolean => {
      const entries = this._registry.get(data.eventObject);
      if (!entries) {
        return false;
      }

      // Only fire contextMenu on initialHits
      if (!this._initialHits.includes(data.eventObject)) {
        return false;
      }
      // Fire pointerMissed on non-initial-hit objects
      this._pointerMissed(
        e,
        this._interaction.filter((obj) => !this._initialHits.includes(obj)),
      );
      let shouldStop = false;
      for (const en of entries) {
        if (en.eventCount) {
          if (en.handlers.onContextMenu?.(data) === true) {
            shouldStop = true;
          }
        }
      }
      return shouldStop;
    });
  }

  // ─── Internal Helpers ──────────────────────────────────────

  /**
   * Release a single pointer capture entry
   */
  private _releaseInternalPointerCapture(
    obj: THREE.Object3D,
    captures: Map<THREE.Object3D, PointerCaptureTarget>,
    pointerId: number,
  ): void {
    const captureData = captures.get(obj);
    if (captureData) {
      captures.delete(obj);
      if (captures.size === 0) {
        this._capturedMap.delete(pointerId);
        try {
          this._domElement.releasePointerCapture(pointerId);
        } catch { /* ignore */ }
      }
    }
  }

  /**
   * Count non-undefined handlers for eventCount
   */
  private _countHandlers(handlers: EventHandlers): number {
    let count = 0;
    for (const key of Object.keys(handlers) as (keyof EventHandlers)[]) {
      if (handlers[key] !== undefined) {
        count++;
      }
    }
    return count;
  }

  /**
   * Build an IntersectionEvent from a hovered Intersection record,
   * used by cancelPointer when firing out/leave.
   */
  private _makeEventFromHover(
    hovered: Intersection,
    intersections: Intersection[],
    nativeEvent: PointerEvent,
  ): IntersectionEvent {
    const pointer = this._ndc.clone();
    const unprojectedPoint = new THREE.Vector3(pointer.x, pointer.y, 0).unproject(this._camera);
    return {
      object: hovered.object,
      eventObject: hovered.eventObject,
      distance: hovered.distance,
      point: hovered.point,
      face: hovered.face,
      index: hovered.index,
      instanceId: hovered.instanceId,
      uv: hovered.uv,
      intersections,
      stopped: false,
      delta: 0,
      unprojectedPoint,
      ray: this._raycaster.ray,
      camera: this._camera,
      pointer,
      nativeEvent,
      stopPropagation() {
        this.stopped = true;
      },
      target: {
        hasPointerCapture: () => false,
        setPointerCapture: () => {},
        releasePointerCapture: () => {},
      },
      currentTarget: {
        hasPointerCapture: () => false,
        setPointerCapture: () => {},
        releasePointerCapture: () => {},
      },
    };
  }
}
