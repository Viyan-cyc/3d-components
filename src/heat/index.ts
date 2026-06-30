/**
 * @module heat
 *
 * **热力组件 (Heat Components)**
 *
 * Heat-map and thermal visualisation meshes. Designed for data-driven
 * heat point rendering with configurable intensity and radius.
 *
 * @example
 * ```ts
 * import { HeatMesh } from '@cyc/3d-components/heat';
 *
 * const heat = new HeatMesh({ count: 64, radius: 3, intensity: 0.7 });
 * scene.add(heat);
 * ```
 */
export { HeatMesh } from './HeatMesh';
export type { HeatMeshOptions } from './HeatMesh';
