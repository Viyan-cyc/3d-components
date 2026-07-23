import type * as THREE from 'three';
import type { Intersection, EventHandlers } from './types';

// ─── Registration Entry (internal) ────────────────────────────

/**
 * Internal bookkeeping entry for a registered Object3D.
 * @internal
 */
export interface RegistrationEntry {
  object: THREE.Object3D;
  handlers: EventHandlers;
  /** Number of event handlers registered (for eventCount check like R3F). */
  eventCount: number;
}

// ─── computeNDC ───────────────────────────────────────────────

/**
 * Default NDC conversion from a pointer event.
 *
 * Maps `clientX`/`clientY` through the element's bounding rect
 * to Normalized Device Coordinates (−1 to +1) expected by
 * `Raycaster.setFromCamera`.
 */
export function computeNDC(
  event: PointerEvent | WheelEvent,
  rect: DOMRect,
  target: THREE.Vector2,
): THREE.Vector2 {
  target.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  target.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  return target;
}

// ─── makeIntersectionId ───────────────────────────────────────

/**
 * Create a unique ID for an intersection, mirroring R3F's `makeId`.
 *
 * This is the composite key used for hover tracking. Two intersections
 * are considered the same "hover target" if they share the same
 * eventObject, index, and instanceId.
 *
 * @param intersection - The intersection to identify.
 * @returns A string key unique to this (eventObject, index, instanceId) triple.
 */
export function makeIntersectionId(intersection: Intersection): string {
  return (
    intersection.eventObject.uuid +
    '/' +
    (intersection.faceIndex ?? '') +
    (intersection.instanceId ?? '')
  );
}

// ─── hasPointerHandlers ───────────────────────────────────────

/**
 * Check if a registration entry has any pointer-move/over/out/leave
 * handlers. Used to filter objects for move-event raycasting
 * (R3F's `filterPointerEvents`).
 */
export function hasPointerHandlers(entry: RegistrationEntry): boolean {
  const h = entry.handlers;
  return !!(
    h.onPointerMove ||
    h.onPointerOver ||
    h.onPointerEnter ||
    h.onPointerOut ||
    h.onPointerLeave
  );
}

// ─── handlerKey ───────────────────────────────────────────────

/**
 * Map a {@link PointerEventType} string to the corresponding
 * {@link EventHandlers} callback key.
 */
export function handlerKey(type: PointerEventType): keyof EventHandlers {
  const COMPOUND: Record<string, string> = {
    pointerdown: 'onPointerDown',
    pointerup: 'onPointerUp',
    pointermove: 'onPointerMove',
    pointerover: 'onPointerOver',
    pointerout: 'onPointerOut',
    pointerenter: 'onPointerEnter',
    pointerleave: 'onPointerLeave',
    contextmenu: 'onContextMenu',
    doubleclick: 'onDoubleClick',
    pointermissed: 'onPointerMissed',
    pointercancel: 'onPointerCancel',
    lostpointercapture: 'onLostPointerCapture',
  };
  if (type in COMPOUND) return COMPOUND[type] as keyof EventHandlers;
  return ('on' + type.charAt(0).toUpperCase() + type.slice(1)) as keyof EventHandlers;
}

type PointerEventType = import('./types').PointerEventType;
