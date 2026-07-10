/**
 * @packageDocumentation
 *
 * # @cyc/3d-components
 *
 * A 3D component library built on **Three.js** and **GSAP**.
 *
 * ## Features
 * - **General components** (`/core`) — Group-based composites extending `THREE.Group`
 * - **Heat components** (`/heat`) — Heat-map visualisation meshes extending `THREE.Mesh`
 * - **Material components** (`/material`) — Pre-configured PBR materials extending `THREE.MeshStandardMaterial`
 * - **Utility namespace** (`/utils`) — Math, color, and geometry helpers via `Util.xxx()`
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
 * import { BaseGroup, HeatMesh, ShinyMaterial, Util } from '@cyc/3d-components';
 *
 * // On-demand import (tree-shaking friendly)
 * import { BaseGroup } from '@cyc/3d-components/core';
 * import { HeatMesh } from '@cyc/3d-components/heat';
 * import { ShinyMaterial } from '@cyc/3d-components/material';
 * import { Util } from '@cyc/3d-components/utils';
 * ```
 */

// Full bundle entry — re-exports everything
export * from './core';
export * from './heat';
export * from './material';
export { Util } from './utils';
export * from './graph';

// Re-export types for convenience
export type * from './types';
