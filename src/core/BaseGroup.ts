import * as THREE from 'three';
import type { GroupComponentOptions, IUpdatable, IDisposable } from '../types';

/**
 * Options for constructing a {@link BaseGroup}.
 *
 * @example
 * ```ts
 * const opts: BaseGroupOptions = {
 *   name: 'my-group',
 *   scale: 1.5,
 *   children: [childMesh1, childMesh2],
 * };
 * ```
 */
export interface BaseGroupOptions extends GroupComponentOptions {
  /**
   * Uniform scale multiplier applied to the entire group on creation.
   * Calls `this.scale.setScalar(scale)` in the constructor.
   * @default 1
   */
  scale?: number;
}

/**
 * BaseGroup — a general-purpose **THREE.Group** wrapper.
 *
 * Serves as the foundation for group-based composite 3D components.
 * Extend this class to build your own reusable 3D objects that contain
 * multiple child meshes, lights, or other Object3Ds.
 *
 * **Features:**
 * - Accepts {@link BaseGroupOptions} for declarative construction
 * - Implements {@link IUpdatable} — override `update(delta)` for per-frame logic
 * - Implements {@link IDisposable} — calls `dispose()` on all child geometries & materials
 *
 * @example
 * ```ts
 * import { BaseGroup } from '@cyc/3d-components/core';
 *
 * class MyWidget extends BaseGroup {
 *   constructor() {
 *     super({ name: 'MyWidget', scale: 2 });
 *     const mesh = new THREE.Mesh(geometry, material);
 *     this.add(mesh);
 *   }
 *
 *   update(delta: number): void {
 *     this.rotation.y += delta * 0.5;
 *   }
 * }
 * ```
 *
 * @extends THREE.Group
 *
 * Implements {@link IUpdatable} and {@link IDisposable}.
 */
export class BaseGroup extends THREE.Group implements IUpdatable, IDisposable {
  /**
   * @param options - Configuration object. All properties are optional.
   * @param options.name - Name applied to `this.name`. Useful for scene traversal.
   * @param options.visible - Initial visibility state.
   * @param options.userData - Arbitrary data stored in `this.userData`.
   * @param options.scale - Uniform scale applied on creation via `setScalar()`.
   * @param options.children - Child Object3Ds to add to the group immediately.
   */
  constructor(options: BaseGroupOptions = {}) {
    super();

    if (options.name) this.name = options.name;
    if (options.visible !== undefined) this.visible = options.visible;
    if (options.userData) this.userData = { ...options.userData };
    if (options.scale !== undefined) {
      this.scale.setScalar(options.scale);
    }
    if (options.children) {
      for (const child of options.children) {
        this.add(child);
      }
    }
  }

  /**
   * Called every frame by the render loop.
   *
   * Override this method in subclasses to implement per-frame behavior
   * (animation, physics, LOD switching, etc.). The default implementation
   * is a no-op.
   *
   * @param delta - Time in seconds since the last frame (capped at 100ms).
   */
  update(delta: number): void {
    // no-op by default — override in subclasses
  }

  /**
   * Release all resources held by this group and its descendants.
   *
   * Traverses the entire subtree and disposes:
   * - Geometries on all `THREE.Mesh` children
   * - Materials on all `THREE.Mesh` children (handles both single materials and arrays)
   * Then clears all children from the group.
   *
   * **Important:** Override this method in subclasses if you hold additional
   * resources (custom buffers, event listeners, timers). Always call
   * `super.dispose()` as the **last** step in your override.
   *
   * @example
   * ```ts
   * class MyComponent extends BaseGroup {
   *   private timer: number;
   *
   *   dispose(): void {
   *     cancelAnimationFrame(this.timer);
   *     super.dispose(); // always call super last
   *   }
   * }
   * ```
   */
  dispose(): void {
    this.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });
    this.clear();
  }
}
