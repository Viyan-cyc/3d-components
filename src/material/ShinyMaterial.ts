import * as THREE from 'three';

/**
 * Options for constructing a {@link ShinyMaterial}.
 *
 * All properties are optional and default to a polished PBR look.
 *
 * @example
 * ```ts
 * const opts: ShinyMaterialOptions = {
 *   color: 0x3366ff,
 *   metalness: 0.3,
 *   roughness: 0.15,
 * };
 * ```
 */
export interface ShinyMaterialOptions {
  /**
   * Base color of the material.
   * Accepts any value that `THREE.Color.set()` understands
   * (hex number, CSS string, `THREE.Color` instance).
   * @default 0xffffff (white)
   */
  color?: THREE.ColorRepresentation;

  /**
   * How metallic the surface appears (0–1).
   * - `0` = dielectric (plastic, wood)
   * - `1` = fully metallic (steel, gold)
   * @default 0.1
   */
  metalness?: number;

  /**
   * How rough the surface micro-facets are (0–1).
   * - `0` = perfectly smooth mirror
   * - `1` = completely diffuse (matte)
   * @default 0.2
   */
  roughness?: number;

  /**
   * Emissive (self-illumination) color.
   * Light emitted by the material independent of scene lighting.
   * @default 0x000000 (no emission)
   */
  emissive?: THREE.ColorRepresentation;

  /**
   * Intensity of the emissive effect.
   * Multiplies the emissive color.
   * @default 0
   */
  emissiveIntensity?: number;
}

/**
 * ShinyMaterial — a **pre-configured PBR material** with a polished appearance.
 *
 * Wraps `THREE.MeshStandardMaterial` with sensible defaults for a shiny,
 * reflective look suitable for product visualisation, glossy UI elements,
 * and high-quality rendering.
 *
 * **Features:**
 * - Extends `THREE.MeshStandardMaterial` — compatible with all Three.js PBR pipelines
 * - Chainable `.setColor()` and `.setShininess()` methods
 * - Automatically sets `needsUpdate = true` after property changes
 *
 * @example
 * ```ts
 * import { ShinyMaterial } from '@cyc/3d-components/material';
 *
 * // Create a shiny blue material
 * const mat = new ShinyMaterial({ color: 0x3366ff, metalness: 0.3 });
 * const mesh = new THREE.Mesh(geometry, mat);
 *
 * // Adjust at runtime with chainable methods
 * mat.setColor(0xff6633).setShininess(0.5, 0.1);
 * ```
 *
 * @extends THREE.MeshStandardMaterial
 */
export class ShinyMaterial extends THREE.MeshStandardMaterial {
  /**
   * @param options - Configuration object. All properties are optional.
   * @param options.color - Base color (hex, CSS string, or THREE.Color).
   * @param options.metalness - Metalness factor (0–1).
   * @param options.roughness - Roughness factor (0–1).
   * @param options.emissive - Emissive color.
   * @param options.emissiveIntensity - Emissive intensity multiplier.
   */
  constructor(options: ShinyMaterialOptions = {}) {
    super({
      color: options.color ?? 0xffffff,
      metalness: options.metalness ?? 0.1,
      roughness: options.roughness ?? 0.2,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 0,
    });
  }

  /**
   * Adjust both metalness and roughness in a single call.
   *
   * Automatically sets `needsUpdate = true` so the changes take effect
   * in the next render.
   *
   * @param metalness - New metalness value (0–1).
   * @param roughness - New roughness value (0–1).
   * @returns This instance for chaining.
   *
   * @example
   * ```ts
   * // Make it more metallic and smoother
   * mat.setShininess(0.8, 0.05);
   *
   * // Make it more like plastic
   * mat.setShininess(0, 0.6);
   * ```
   */
  setShininess(metalness: number, roughness: number): this {
    this.metalness = metalness;
    this.roughness = roughness;
    this.needsUpdate = true;
    return this;
  }

  /**
   * Set the base color of the material.
   *
   * Accepts any value that `THREE.Color.set()` understands.
   * Automatically sets `needsUpdate = true`.
   *
   * @param color - New color value (hex number, CSS string, or THREE.Color instance).
   * @returns This instance for chaining.
   *
   * @example
   * ```ts
   * mat.setColor(0xff0000);        // hex
   * mat.setColor('#00ff00');       // CSS string
   * mat.setColor('rgb(0,0,255)');  // CSS rgb()
   * ```
   */
  setColor(color: THREE.ColorRepresentation): this {
    this.color.set(color);
    this.needsUpdate = true;
    return this;
  }
}
