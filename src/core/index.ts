/**
 * @module core
 *
 * **通用组件 (General Components)**
 *
 * Foundation classes for building 3D group-based composites.
 * All components in this module extend {@link https://threejs.org/docs/#api/en/core/Object3D | THREE.Object3D} subclasses.
 *
 * @example
 * ```ts
 * import { BaseGroup } from '@cyc/3d-components/core';
 *
 * class MyWidget extends BaseGroup {
 *   constructor() {
 *     super({ name: 'my-widget', scale: 2 });
 *   }
 * }
 * ```
 */
export { BaseGroup } from './BaseGroup';
export type { BaseGroupOptions } from './BaseGroup';

export { Wall } from './Wall';
export type { WallOptions, WallData, WallHole, Vec3Tuple } from './Wall';

export { Grid } from './Grid';
export type { GridOptions, GridPlane } from './Grid';
export { Path } from './Path';
export type { PathOptions, PathData, PathMode } from './Path';

export { Outlines } from './Outlines';
export type { OutlinesOptions } from './Outlines';

export { Wireframe } from './Wireframe';
export type { WireframeOptions } from './Wireframe';
