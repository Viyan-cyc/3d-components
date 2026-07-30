/**
 * @module heat
 *
 * **热力组件 (Heat Components)**
 *
 * Heat-map and thermal visualisation components:
 * - {@link HeatMap} — a canvas-based heatmap texture generator
 *
 * @example
 * ```ts
 * import { HeatMap } from '@a3d/a3d-components/heat';
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

export { HeatMap } from './HeatMap';
export type { HeatMapOptions, HeatMapPoint, HeatMapData, HeatMapGradient } from './HeatMap';
