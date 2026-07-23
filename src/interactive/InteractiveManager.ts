import * as THREE from 'three';
import type { IDisposable } from '../types';
import {
  type Intersection,
  type IntersectionEvent,
  type EventHandlers,
  type ControlsLike,
  type InteractiveManagerOptions,
  type ComputeNDCFn,
  type FilterIntersectionsFn,
  type PointerEventType,
  type PointerCaptureTarget,
} from './types';
import {
  type RegistrationEntry,
  computeNDC,
  makeIntersectionId,
  hasPointerHandlers,
  handlerKey,
} from './utils';

/**
 * Centralized raycaster-based interaction system, faithfully adapted from
 * react-three-fiber's event model (`createEvents`).
 *
 * ## Architecture (R3F-faithful)
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
 * 3. **Hover tracking**: Keyed by composite ID (`eventObject.uuid/faceIndex/instanceId`),
 *    not just Object3D. `over`+`enter` fire together on new hover;
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

  private readonly _camera: THREE.Camera;
  private readonly _domElement: HTMLElement;
  private readonly _scene: THREE.Object3D | undefined;
  private readonly _controls: ControlsLike | undefined;
  private readonly _clickThreshold: number;
  private readonly _clickTimeThreshold: number;
  private readonly _doubleClickTimeThreshold: number;
  private readonly _recursive: boolean;
  private readonly _computeNDC: ComputeNDCFn | undefined;
  private readonly _filterIntersections: FilterIntersectionsFn | undefined;

  // ─── Raycaster state ───────────────────────────────────────

  private readonly _raycaster = new THREE.Raycaster();
  private readonly _ndc = new THREE.Vector2();

  // ─── Registry ──────────────────────────────────────────────

  /** Object3D → { handlers, eventCount } */
  private readonly _registry = new Map<THREE.Object3D, RegistrationEntry>();

  /** Ordered list of registered objects (for intersectObjects when no scene). */
  private readonly _interaction: THREE.Object3D[] = [];

  // ─── Hover state ───────────────────────────────────────────

  /** composite-id → { intersection, stopped } (R3F's internal.hovered) */
  private readonly _hovered = new Map<string, { intersection: Intersection; stopped: boolean }>();

  // ─── Pointer capture ───────────────────────────────────────

  /** pointerId → Map<Object3D, PointerCaptureTarget> (R3F's capturedMap) */
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
    this._clickThreshold = options.clickThreshold ?? 2;
    this._clickTimeThreshold = options.clickTimeThreshold ?? 300;
    this._doubleClickTimeThreshold = options.doubleClickTimeThreshold ?? 300;
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
   * Register an Object3D with event handlers.
   *
   * If the object is already registered, its handlers are replaced.
   */
  add(object: THREE.Object3D, handlers: EventHandlers): void {
    if (this._registry.has(object)) {
      this._registry.get(object)!.handlers = handlers;
      this._registry.get(object)!.eventCount = this._countHandlers(handlers);
      return;
    }
    this._registry.set(object, {
      object,
      handlers,
      eventCount: this._countHandlers(handlers),
    });
    this._interaction.push(object);
  }

  /**
   * Unregister an Object3D, removing all its handlers.
   *
   * If the object is currently hovered, fires `onPointerOut` / `onPointerLeave`
   * before removing it.
   */
  remove(object: THREE.Object3D): void {
    const entry = this._registry.get(object);
    if (!entry) return;

    // Clear hover entries for this eventObject
    for (const [id, hoverEntry] of this._hovered) {
      if (hoverEntry.intersection.eventObject === object) {
        const ev = this._makeEventFromHover(hoverEntry.intersection, [], new PointerEvent('pointerout'));
        entry.handlers.onPointerOut?.(ev);
        entry.handlers.onPointerLeave?.(ev);
        this._hovered.delete(id);
      }
    }

    // Release any captures
    for (const [pointerId, captures] of this._capturedMap) {
      if (captures.has(object)) {
        this._releaseInternalPointerCapture(object, captures, pointerId);
      }
    }

    this._registry.delete(object);
    const idx = this._interaction.indexOf(object);
    if (idx !== -1) this._interaction.splice(idx, 1);
  }

  /**
   * Force a hover re-evaluation.
   *
   * Useful after camera animation where objects under the cursor may
   * have changed without a `pointermove` event.
   */
  update(_delta?: number): void {
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

  // ─── Intersection Pipeline (R3F's intersect) ───────────────

  /**
   * Perform raycast → dedup → filter → expand to registered ancestors
   * → inject captures.
   *
   * This mirrors R3F's `intersect()` function.
   */
  private _intersect(
    event: PointerEvent | WheelEvent,
    filter?: (objects: THREE.Object3D[]) => THREE.Object3D[],
  ): Intersection[] {
    // 1. NDC conversion
    const rect = this._domElement.getBoundingClientRect();
    if (this._computeNDC) {
      this._computeNDC(event, rect, this._ndc);
    } else {
      computeNDC(event, rect, this._ndc);
    }
    this._raycaster.setFromCamera(this._ndc, this._camera);

    // 2. Determine which objects to raycast
    const eventObjects = filter ? filter(this._interaction) : this._interaction;

    // 3. Raycast each object individually (R3F does this per-object, not scene-wide)
    const duplicates = new Set<string>();
    let rawHits: THREE.Intersection[];

    if (this._scene) {
      // Scene mode: one raycast, then filter to registered objects
      rawHits = this._raycaster.intersectObject(this._scene, true);
    } else {
      // Per-object raycast (R3F pattern)
      rawHits = eventObjects
        .flatMap((obj) => this._raycaster.intersectObject(obj, this._recursive))
        .sort((a, b) => a.distance - b.distance);
    }

    // 4. Dedup by makeId-style key
    rawHits = rawHits.filter((item) => {
      const id = item.object.uuid + '/' + (item.faceIndex ?? '') + (item.instanceId ?? '');
      if (duplicates.has(id)) return false;
      duplicates.add(id);
      return true;
    });

    // 5. Custom filter on raw Three.js intersections (before ancestor expansion)
    if (this._filterIntersections) {
      rawHits = this._filterIntersections(rawHits);
    }

    // 6. Expand: bubble up to find registered ancestors (R3F's ancestor walk)
    const intersections: Intersection[] = [];
    for (const hit of rawHits) {
      let eventObject: THREE.Object3D | null = hit.object;
      while (eventObject) {
        const entry = this._registry.get(eventObject);
        if (entry && entry.eventCount > 0) {
          intersections.push({
            object: hit.object,
            eventObject,
            distance: hit.distance,
            point: hit.point.clone(),
            face: hit.face,
            faceIndex: hit.faceIndex ?? undefined,
            instanceId: hit.instanceId ?? undefined,
            uv: hit.uv ?? undefined,
          });
        }
        eventObject = eventObject.parent;
      }
    }

    // 7. Inject pointer captures (R3F's capturedMap injection)
    if ('pointerId' in event) {
      const capturedForPointer = this._capturedMap.get((event as PointerEvent).pointerId);
      if (capturedForPointer) {
        for (const captureData of capturedForPointer.values()) {
          const capId = makeIntersectionId(captureData.intersection);
          if (!duplicates.has(capId)) {
            intersections.push(captureData.intersection);
            duplicates.add(capId);
          }
        }
      }
    }

    return intersections;
  }

  // ─── handleIntersects (R3F's handleIntersects) ─────────────

  /**
   * Walk the flat intersection list, calling the callback for each.
   * `stopPropagation()` sets `localState.stopped = true` and breaks the loop.
   *
   * This mirrors R3F's `handleIntersects()`.
   */
  private _handleIntersects(
    intersections: Intersection[],
    event: PointerEvent | WheelEvent,
    delta: number,
    callback: (ev: IntersectionEvent) => void,
  ): Intersection[] {
    if (intersections.length === 0) return intersections;

    const localState = { stopped: false };

    for (const hit of intersections) {
      const entry = this._registry.get(hit.eventObject);
      if (!entry || !entry.eventCount) continue;

      const pointer = this._ndc.clone();
      const unprojectedPoint = new THREE.Vector3(pointer.x, pointer.y, 0).unproject(this._camera);

      // Pointer capture API on this eventObject
      const hasPointerCapture = (id: number): boolean => {
        return this._capturedMap.get(id)?.has(hit.eventObject) ?? false;
      };

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
        try { this._domElement.setPointerCapture(id); } catch { /* ignore */ }
      };

      const releasePointerCapture = (id: number): void => {
        const captures = this._capturedMap.get(id);
        if (captures) {
          this._releaseInternalPointerCapture(hit.eventObject, captures, id);
        }
      };

      const captureTarget = { hasPointerCapture, setPointerCapture, releasePointerCapture };

      const raycastEvent: IntersectionEvent = {
        object: hit.object,
        eventObject: hit.eventObject,
        distance: hit.distance,
        point: hit.point,
        face: hit.face,
        faceIndex: hit.faceIndex,
        instanceId: hit.instanceId,
        uv: hit.uv,
        intersections,
        stopped: localState.stopped,
        delta,
        unprojectedPoint,
        ray: this._raycaster.ray,
        camera: this._camera,
        pointer,
        nativeEvent: event as PointerEvent,
        stopPropagation: () => {
          // R3F: only allow stopPropagation if pointer is not captured,
          // or if this eventObject is capturing the pointer
          const capturesForPointer =
            'pointerId' in event && this._capturedMap.get((event as PointerEvent).pointerId);
          if (
            !capturesForPointer ||
            capturesForPointer.has(hit.eventObject)
          ) {
            raycastEvent.stopped = localState.stopped = true;
            // R3F: if this object is currently hovered, flush higher-up objects
            if (
              this._hovered.size &&
              Array.from(this._hovered.values()).find(
                (i) => i.intersection.eventObject === hit.eventObject,
              )
            ) {
              const higher = intersections.slice(0, intersections.indexOf(hit));
              this._cancelPointer([...higher, hit]);
            }
          }
        },
        target: captureTarget,
        currentTarget: captureTarget,
      };

      callback(raycastEvent);

      // R3F: if propagation was stopped, break the loop
      if (localState.stopped === true) break;
    }

    return intersections;
  }

  // ─── cancelPointer (R3F's cancelPointer) ───────────────────

  /**
   * Fire `onPointerOut` + `onPointerLeave` on all hovered objects
   * that are NOT in the provided intersection list.
   *
   * This mirrors R3F's `cancelPointer()`.
   */
  private _cancelPointer(intersections: Intersection[]): void {
    for (const [id, hoverEntry] of this._hovered) {
      const hoveredObj = hoverEntry.intersection;
      // Check if this hovered object is still under the cursor
      const stillHovered = intersections.find(
        (hit) =>
          hit.object === hoveredObj.object &&
          (hit.faceIndex ?? '') === (hoveredObj.faceIndex ?? '') &&
          (hit.instanceId ?? '') === (hoveredObj.instanceId ?? ''),
      );

      if (!stillHovered) {
        const entry = this._registry.get(hoveredObj.eventObject);
        if (entry && entry.eventCount) {
          const data = this._makeEventFromHover(hoveredObj, intersections, new PointerEvent('pointerout'));
          entry.handlers.onPointerOut?.(data);
          entry.handlers.onPointerLeave?.(data);
        }
        this._hovered.delete(id);
      }
    }
  }

  // ─── pointerMissed (R3F's pointerMissed) ───────────────────

  /**
   * Fire `onPointerMissed` on the specified objects.
   * Mirrors R3F's `pointerMissed()`.
   */
  private _pointerMissed(event: PointerEvent, objects: THREE.Object3D[]): void {
    for (const obj of objects) {
      const entry = this._registry.get(obj);
      if (entry?.handlers.onPointerMissed) {
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
          stopPropagation() { this.stopped = true; },
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
        entry.handlers.onPointerMissed(ev);
      }
    }
  }

  // ─── DOM Event Handlers ────────────────────────────────────

  private _handlePointerMove(e: PointerEvent): void {
    if (!this._enabled) return;
    this._lastPointerMoveEvent = e;

    // R3F: filter to only objects with pointer move/over/out/leave handlers
    const filterFn = (objects: THREE.Object3D[]): THREE.Object3D[] =>
      objects.filter((obj) => {
        const entry = this._registry.get(obj);
        return entry && hasPointerHandlers(entry);
      });

    const hits = this._intersect(e, filterFn);

    // R3F: cancelPointer BEFORE dispatching new over/enter
    this._cancelPointer(hits);

    this._handleIntersects(hits, e, 0, (data: IntersectionEvent) => {
      const entry = this._registry.get(data.eventObject);
      if (!entry || !entry.eventCount) return;
      const handlers = entry.handlers;

      // Hover tracking: over + enter
      if (
        handlers.onPointerOver ||
        handlers.onPointerEnter ||
        handlers.onPointerOut ||
        handlers.onPointerLeave
      ) {
        const id = makeIntersectionId(data as unknown as Intersection);
        const hoveredItem = this._hovered.get(id);
        if (!hoveredItem) {
          // New hover: record and fire over + enter
          this._hovered.set(id, {
            intersection: {
              object: data.object,
              eventObject: data.eventObject,
              distance: data.distance,
              point: data.point.clone(),
              face: data.face,
              faceIndex: data.faceIndex,
              instanceId: data.instanceId,
              uv: data.uv,
            },
            stopped: false,
          });
          handlers.onPointerOver?.(data);
          handlers.onPointerEnter?.(data);
        } else if (hoveredItem.stopped) {
          // Previously stopped: propagate the stop
          data.stopPropagation();
        }
      }

      // Always fire pointermove
      handlers.onPointerMove?.(data);
    });
  }

  private _handlePointerDown(e: PointerEvent): void {
    if (!this._enabled) return;

    const hits = this._intersect(e);

    // R3F: save initial click coordinates and hit list
    this._initialClick = [e.offsetX, e.offsetY];
    this._initialHits = hits.map((hit) => hit.eventObject);

    // Suppress camera controls if we hit something
    if (hits.length > 0) {
      if (this._controls && 'enabled' in this._controls) {
        this._controlsWasEnabled = this._controls.enabled !== false;
        this._controls.enabled = false;
      }
    }

    this._handleIntersects(hits, e, 0, (data: IntersectionEvent) => {
      const entry = this._registry.get(data.eventObject);
      if (!entry || !entry.eventCount) return;
      entry.handlers.onPointerDown?.(data);
    });

    // If nothing hit, fire pointerMissed on all registered objects
    if (hits.length === 0) {
      this._pointerMissed(e, this._interaction);
    }
  }

  private _handlePointerUp(e: PointerEvent): void {
    if (!this._enabled) return;

    const isLeftButton = e.button === 0;

    // R3F: calculate delta from initial click
    const dx = e.offsetX - this._initialClick[0];
    const dy = e.offsetY - this._initialClick[1];
    const delta = Math.round(Math.hypot(dx, dy));

    const hits = this._intersect(e);

    this._handleIntersects(hits, e, delta, (data: IntersectionEvent) => {
      const entry = this._registry.get(data.eventObject);
      if (!entry || !entry.eventCount) return;
      const handlers = entry.handlers;

      // Fire pointerup
      handlers.onPointerUp?.(data);

      // Click validation (left button only, same as R3F)
      if (isLeftButton && delta <= this._clickThreshold) {
        // R3F: only fire click on objects that were in initialHits
        if (this._initialHits.includes(data.eventObject)) {
          const now = Date.now();
          const lastTime = this._lastClickTimes.get(data.eventObject) ?? 0;
          if (now - lastTime <= this._doubleClickTimeThreshold && lastTime > 0) {
            handlers.onDoubleClick?.(data);
            this._lastClickTimes.delete(data.eventObject);
          } else {
            handlers.onClick?.(data);
            this._lastClickTimes.set(data.eventObject, now);
          }
        }
      }
    });

    // R3F: pointerMissed on non-initial-hit objects during click
    if (isLeftButton && delta <= this._clickThreshold) {
      if (hits.length === 0) {
        this._pointerMissed(e, this._interaction);
      } else {
        // Fire missed on objects NOT in initialHits
        this._pointerMissed(
          e,
          this._interaction.filter((obj) => !this._initialHits.includes(obj)),
        );
      }
    }

    // R3F-style capture cleanup: just delete the capturedMap entry
    // (onLostPointerCapture is handled by DOM event)
    if ('pointerId' in e) {
      const pointerId = (e as PointerEvent).pointerId;
      const capturedSet = this._capturedMap.get(pointerId);
      if (capturedSet) {
        this._capturedMap.delete(pointerId);
      }
    }

    // Restore camera controls
    if (this._controls && 'enabled' in this._controls && this._controlsWasEnabled) {
      this._controls.enabled = true;
    }

    this._initialClick = [0, 0];
    this._initialHits = [];
  }

  private _handleWheel(e: WheelEvent): void {
    if (!this._enabled) return;

    const hits = this._intersect(e);

    this._handleIntersects(hits, e, 0, (data: IntersectionEvent) => {
      const entry = this._registry.get(data.eventObject);
      if (!entry || !entry.eventCount) return;
      entry.handlers.onWheel?.(data);
    });
  }

  private _handleContextMenu(e: PointerEvent): void {
    if (!this._enabled) return;

    const isClickEvent = true;
    const dx = e.offsetX - this._initialClick[0];
    const dy = e.offsetY - this._initialClick[1];
    const delta = Math.round(Math.hypot(dx, dy));

    const hits = this._intersect(e);

    this._handleIntersects(hits, e, delta, (data: IntersectionEvent) => {
      const entry = this._registry.get(data.eventObject);
      if (!entry || !entry.eventCount) return;
      const handlers = entry.handlers;

      // R3F: only fire contextMenu on initialHits
      if (this._initialHits.includes(data.eventObject)) {
        // Fire pointerMissed on non-initial-hit objects
        this._pointerMissed(
          e,
          this._interaction.filter((obj) => !this._initialHits.includes(obj)),
        );
        handlers.onContextMenu?.(data);
      }
    });
  }

  // ─── Internal Helpers ──────────────────────────────────────

  /**
   * Release a single pointer capture entry (R3F's releaseInternalPointerCapture).
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
        try { this._domElement.releasePointerCapture(pointerId); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Count non-undefined handlers for eventCount (R3F's eventCount).
   */
  private _countHandlers(handlers: EventHandlers): number {
    let count = 0;
    for (const key of Object.keys(handlers) as (keyof EventHandlers)[]) {
      if (handlers[key] !== undefined) count++;
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
      faceIndex: hovered.faceIndex,
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
      stopPropagation() { this.stopped = true; },
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
