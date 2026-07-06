/**
 * @module heat
 *
 * **热力组件 (Heat Components)**
 *
 * Heat-map and thermal visualisation components:
 * - {@link HeatMesh} — a semi-transparent heat sphere mesh
 * - {@link HeatMap} — a canvas-based heatmap texture generator
 *
 * @example
 * ```ts
 * import { HeatMesh, HeatMap } from '@cyc/3d-components/heat';
 *
 * // Simple heat sphere
 * const heat = new HeatMesh({ count: 64, radius: 3, intensity: 0.7 });
 * scene.add(heat);
 *
 * // Canvas heatmap texture
 * const heatMap = new HeatMap({ width: 512, height: 512, radius: 50 });
 * heatMap.setData({
 *   max: 100,
 *   data: [
 *     { x: 100, y: 100, value: 80 },
 *     { x: 300, y: 200, value: 50 },
 *   ],
 * });
 * const material = new THREE.MeshBasicMaterial({ map: heatMap.texture, transparent: true });
 * ```
 */
export { HeatMesh } from './HeatMesh';
export type { HeatMeshOptions } from './HeatMesh';

export { HeatMap } from './HeatMap';
export type { HeatMapOptions, HeatMapPoint, HeatMapData, HeatMapGradient } from './HeatMap';
