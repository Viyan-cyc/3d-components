/**
 * @packageDocumentation
 *
 * # interactive
 *
 * Centralized raycaster-based interaction system, faithfully adapted from
 * react-three-fiber's `createEvents` event model.
 *
 * ## Architecture (R3F-faithful)
 *
 * - **Flat intersection list**: Each raw ray hit expands to one `Intersection`
 *   per registered ancestor. All events dispatch by iterating this flat list.
 * - **stopPropagation**: Breaks the flat iteration (NOT parent-chain bubbling).
 * - **Hover tracking**: Keyed by composite ID (`eventObject/faceIndex/instanceId`).
 *   `over`+`enter` fire together on new hover; `out`+`leave` fire together via cancelPointer.
 * - **Click validation**: Only fires on `initialHits` (objects hit during pointerDown).
 * - **Pointer capture**: `setPointerCapture`/`releasePointerCapture` on the event target.
 *
 * ## Quick Start
 * ```ts
 * import { InteractiveManager } from '@cyc/3d-components/interactive';
 *
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

export { InteractiveManager } from './InteractiveManager';
export type {
  InteractiveManagerOptions,
  ControlsLike,
  EventHandlers,
  Intersection,
  IntersectionEvent,
  PointerEventType,
  ComputeNDCFn,
  FilterIntersectionsFn,
  PointerCaptureTarget,
} from './types';
