/**
 * @packageDocumentation
 *
 * # @a3d/a3d-components
 *
 * A 3D component library built on **Three.js** and **GSAP**.
 *
 * ## Features
 * - **General components** (`/core`) — Group-based composites extending `THREE.Group`
 * - **Heat components** (`/heat`) — Heat-map visualisation meshes extending `THREE.Mesh`
 * - **Material components** (`/material`) — Pre-configured PBR materials extending `THREE.MeshStandardMaterial`
 * - **Utility namespace** (`/utils`) — Math, color, and geometry helpers via `Util.xxx()`
 * - **Asset cache** (`/loader`) — On-demand model & texture loading with in-memory cache
 *
 * ## Peer Dependencies
 * This library requires you to install `three` and `gsap` in your project:
 * ```bash
 * npm install three gsap
 * ```
 * The library uses **your** installed versions — it does not bundle them.
 *
 * ## Quick Start
 * ```ts
 * // Full import
 * import { HeatMap, Util } from '@a3d/a3d-components';
 *
 * // On-demand import (tree-shaking friendly)
 * import { Grid } from '@a3d/a3d-components/core';
 * import { HeatMap } from '@a3d/a3d-components/heat';
 * import { MeshReflectorMaterial } from '@a3d/a3d-components/material';
 * import { Util } from '@a3d/a3d-components/utils';
 * ```
 */

// Full bundle entry — re-exports everything
export * from './core';
export * from './heat';
export * from './material';
export * from './helper';
export { Util } from './utils';
export * from './graph';
export * from './controls';
export * from './camera';
export * from './interactive';
export * from './animation';
export * from './loader';

// Re-export types for convenience
export type * from './types';
