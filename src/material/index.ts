/**
 * @module material
 *
 * **材质组件 (Material Components)**
 *
 * Pre-configured Three.js materials with chainable convenience methods.
 * Wraps standard PBR materials for quick prototyping and production use.
 *
 * @example
 * ```ts
 * import { ShinyMaterial } from '@cyc/3d-components/material';
 *
 * const mat = new ShinyMaterial({ color: 0x3366ff, metalness: 0.3 });
 * mesh.material = mat;
 * mat.setColor(0xff6633).setShininess(0.5, 0.1);
 * ```
 */
export { ShinyMaterial } from './ShinyMaterial';
export type { ShinyMaterialOptions } from './ShinyMaterial';
