/**
 * @module camera/EventDispatcher
 * @internal
 *
 * Lightweight, type-safe event dispatcher.
 *
 * Uses `CameraControlsEventMap` to constrain event names and listener
 * signatures at compile time — unlike `THREE.EventDispatcher` which
 * only uses `string`.
 */

import type { CameraControlsEventMap, CameraControlsEventType } from './types';

type Listener<T extends CameraControlsEventType> = (event: CameraControlsEventMap[ T ]) => void;

export class EventDispatcher {

  private _listeners: Partial<Record<CameraControlsEventType, Array<Listener<CameraControlsEventType>>>> = {};

  /**
   * Register `listener` for `type`.
   */
  addEventListener<T extends CameraControlsEventType>(type: T, listener: Listener<T>): void {

    const list = this._listeners[ type ];
    if (! list) {

      this._listeners[ type ] = [listener as Listener<CameraControlsEventType>];
      return;

    }

    if (list.indexOf(listener as Listener<CameraControlsEventType>) === - 1) {

      list.push(listener as Listener<CameraControlsEventType>);

    }

  }

  /**
   * Returns `true` if `listener` is registered for `type`.
   */
  hasEventListener<T extends CameraControlsEventType>(type: T, listener: Listener<T>): boolean {

    const list = this._listeners[ type ];
    return list !== undefined && list.indexOf(listener as Listener<CameraControlsEventType>) !== - 1;

  }

  /**
   * Remove `listener` for `type`.
   */
  removeEventListener<T extends CameraControlsEventType>(type: T, listener: Listener<T>): void {

    const list = this._listeners[ type ];
    if (list === undefined) {
      return;
    }

    const index = list.indexOf(listener as Listener<CameraControlsEventType>);
    if (index !== - 1) {
      list.splice(index, 1);
    }

  }

  /**
   * Remove all listeners, optionally filtered by `type`.
   */
  removeAllEventListeners(type?: CameraControlsEventType): void {

    if (! type) {

      this._listeners = {};
      return;

    }

    const list = this._listeners[ type ];
    if (list) {
      list.length = 0;
    }

  }

  /**
   * Dispatch an event to all registered listeners for `event.type`.
   */
  dispatchEvent<T extends CameraControlsEventType>(event: CameraControlsEventMap[ T ] & { type: T }): void {

    const list = this._listeners[ event.type ];
    if (! list) {
      return;
    }

    // Snapshot to avoid mutation during iteration
    const array = list.slice(0);
    for (let i = 0, l = array.length; i < l; i ++) {

      array[ i ].call(this, event);

    }

  }

}
