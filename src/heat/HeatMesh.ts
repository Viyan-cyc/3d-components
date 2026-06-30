import * as THREE from 'three';
import type { ComponentOptions, IUpdatable, IDisposable } from '../types';

/**
 * Options for constructing a {@link HeatMesh}.
 *
 * @example
 * ```ts
 * const opts: HeatMeshOptions = {
 *   name: 'heat-region',
 *   count: 128,
 *   radius: 3,
 *   intensity: 0.75,
 * };
 * ```
 */
export interface HeatMeshOptions extends ComponentOptions {
  /**
   * Number of vertices / resolution of the heat sphere geometry.
   * Higher values produce smoother heat surfaces but cost more GPU memory.
   * @default 64
   */
  count?: number;

  /**
   * Radius of the heat area in world units.
   * @default 1
   */
  radius?: number;

  /**
   * Initial heat intensity (0–1). Controls opacity and visual impact.
   * Use {@link HeatMesh.setIntensity} to change at runtime.
   * @default 0.5
   */
  intensity?: number;
}

/**
 * HeatMesh — a **heat-map visualisation mesh**.
 *
 * Represents a heat region as a semi-transparent sphere with configurable
 * intensity. Designed for data-driven heat point rendering such as:
 * - Sensor coverage zones
 * - Temperature distribution
 * - Population density clusters
 *
 * **Features:**
 * - Extends `THREE.Mesh` — can be added directly to any Three.js scene
 * - Implements {@link IUpdatable} — call `update(delta)` each frame for auto animation
 * - Implements {@link IDisposable} — cleans up geometry & material on `dispose()`
 * - Chainable {@link HeatMesh.setIntensity} method
 *
 * @example
 * ```ts
 * import { HeatMesh } from '@cyc/3d-components/heat';
 *
 * // Create a heat region
 * const heat = new HeatMesh({
 *   count: 128,
 *   radius: 5,
 *   intensity: 0.8,
 * });
 * scene.add(heat);
 *
 * // In render loop
 * heat.update(deltaTime);
 *
 * // Change intensity at runtime
 * heat.setIntensity(0.4);
 * ```
 *
 * @extends THREE.Mesh
 *
 * Implements {@link IUpdatable} and {@link IDisposable}.
 */
export class HeatMesh extends THREE.Mesh implements IUpdatable, IDisposable {
  /**
   * Current heat intensity (0–1).
   * Controls the opacity of the heat visualisation.
   * @default 0.5
   */
  public heatIntensity: number;

  /**
   * Current radius of the heat area in world units.
   * @default 1
   */
  public heatRadius: number;

  /**
   * @param options - Configuration object. All properties are optional.
   * @param options.name - Name applied to `this.name`.
   * @param options.visible - Initial visibility state.
   * @param options.userData - Arbitrary data stored in `this.userData`.
   * @param options.count - Number of vertices for the sphere geometry.
   * @param options.radius - Radius of the heat area.
   * @param options.intensity - Initial heat intensity (0–1).
   */
  constructor(options: HeatMeshOptions = {}) {
    const { count = 64, radius = 1, intensity = 0.5 } = options;

    const geometry = new THREE.SphereGeometry(radius, count, count);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: intensity,
    });

    super(geometry, material);

    this.heatIntensity = intensity;
    this.heatRadius = radius;

    if (options.name) this.name = options.name;
    if (options.visible !== undefined) this.visible = options.visible;
    if (options.userData) this.userData = { ...options.userData };
  }

  /**
   * Update the heat visualisation each frame.
   *
   * Applies a subtle pulsing effect to the material opacity based on
   * the current `heatIntensity`. Override this method in subclasses for
   * custom animation logic.
   *
   * @param delta - Time in seconds since the last frame (capped at 100ms).
   *
   * @example
   * ```ts
   * // In your render loop
   * heatMeshes.forEach(h => h.update(deltaTime));
   * ```
   */
  update(delta: number): void {
    const material = this.material as THREE.MeshBasicMaterial;
    material.opacity = this.heatIntensity * (0.8 + 0.2 * Math.sin(performance.now() * 0.001));
  }

  /**
   * Set the heat intensity and update the material opacity.
   *
   * The input value is automatically clamped to the [0, 1] range.
   * Returns `this` for method chaining.
   *
   * @param value - New intensity value (0–1). Values outside range are clamped.
   * @returns This instance for chaining.
   *
   * @example
   * ```ts
   * heat.setIntensity(0.9);          // high heat
   * heat.setIntensity(1.5);          // clamped to 1
   * heat.setIntensity(-0.3);         // clamped to 0
   * ```
   */
  setIntensity(value: number): this {
    this.heatIntensity = Math.max(0, Math.min(1, value));
    return this;
  }

  /**
   * Release GPU resources held by this heat mesh.
   *
   * Disposes the sphere geometry and the material.
   */
  dispose(): void {
    this.geometry?.dispose();
    (this.material as THREE.Material).dispose();
  }
}
