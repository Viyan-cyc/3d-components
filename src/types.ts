import type * as THREE from 'three';

/**
 * Common options passed to all component constructors.
 *
 * Every component in this library accepts a subset of these base options
 * plus domain-specific extensions.
 *
 * @example
 * ```ts
 * const options: ComponentOptions = {
 *   name: 'my-object',
 *   visible: true,
 *   userData: { foo: 'bar' },
 * };
 * ```
 */
export interface ComponentOptions {
  /**
   * Optional name applied to the `Object3D.name` property.
   * Useful for debugging and scene traversal.
   */
  name?: string;

  /**
   * Whether the component is visible on creation.
   * @default true (inherited from THREE.Object3D)
   */
  visible?: boolean;

  /**
   * Arbitrary user data attached to the object.
   * Stored in `Object3D.userData`.
   */
  userData?: Record<string, unknown>;
}

/**
 * Options for group-based components (extends {@link ComponentOptions}).
 *
 * Adds the ability to specify child objects that are automatically
 * added to the group during construction.
 */
export interface GroupComponentOptions extends ComponentOptions {
  /**
   * Children to add to the group on construction.
   * Each child is passed to `this.add(child)` in the constructor.
   */
  children?: THREE.Object3D[];
}

/**
 * Interface for components that support per-frame updates.
 *
 * Implement this interface (or extend a base class that does) to
 * receive a tick callback every frame from the render loop.
 *
 * @example
 * ```ts
 * class MyComponent extends THREE.Group implements IUpdatable {
 *   update(delta: number): void {
 *     this.rotation.y += delta * 0.5;
 *   }
 * }
 * ```
 */
export interface IUpdatable {
  /**
   * Called every frame by the render loop.
   *
   * @param delta - Time in seconds since the last frame (capped at 100ms to avoid spiral-of-death).
   */
  update(delta: number): void;
}

/**
 * Interface for components that support resource cleanup.
 *
 * Implement this interface (or extend a base class that does) to
 * allow deterministic disposal of GPU resources, event listeners,
 * and other long-lived allocations.
 *
 * @example
 * ```ts
 * const comp = new MyComponent();
 * scene.add(comp);
 * // ... later ...
 * comp.dispose();
 * scene.remove(comp);
 * ```
 */
export interface IDisposable {
  /**
   * Release all resources held by this component.
   *
   * This typically includes:
   * - Disposing geometries and materials
   * - Removing event listeners
   * - Stopping timers / animation loops
   */
  dispose(): void;
}

/**
 * Represents a position or vector in 3D space.
 *
 * @example
 * ```ts
 * const pos: Vec3 = { x: 1, y: 2, z: 3 };
 * ```
 */
export interface Vec3 {
  /** X coordinate */
  x: number;
  /** Y coordinate */
  y: number;
  /** Z coordinate */
  z: number;
}

/**
 * Represents an RGBA color with normalized channel values (0–1).
 *
 * @example
 * ```ts
 * const red: ColorRGBA = { r: 1, g: 0, b: 0, a: 1 };
 * ```
 */
export interface ColorRGBA {
  /** Red channel (0–1) */
  r: number;
  /** Green channel (0–1) */
  g: number;
  /** Blue channel (0–1) */
  b: number;
  /** Alpha channel (0–1). @default 1 */
  a?: number;
}
