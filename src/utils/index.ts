/**
 * @module utils
 *
 * **工具类 (Utility Functions)**
 *
 * A collection of math, color, and geometry helpers designed for 3D development.
 * All functions are accessible via the `Util` namespace or as individual named imports
 * for tree-shaking.
 *
 * ### Usage
 *
 * **Namespace style (recommended for discoverability):**
 * ```ts
 * import { Util } from '@cyc/3d-components/utils';
 * // or
 * import { Util } from '@cyc/3d-components';
 *
 * Util.clamp(5, 0, 10);
 * Util.hexToRgb('#ff0000');
 * Util.createSphere(5, 64);
 * ```
 *
 * **Tree-shaking style (smaller bundle):**
 * ```ts
 * import { clamp, lerp, hexToRgb } from '@cyc/3d-components/utils';
 *
 * clamp(5, 0, 10);
 * hexToRgb('#ff0000');
 * ```
 *
 * ### Categories
 * - **Math**: {@link clamp}, {@link lerp}, {@link mapRange}, {@link degToRad},
 *   {@link radToDeg}, {@link randomRange}, {@link randomInt}, {@link distance},
 *   {@link smoothstep}
 * - **Color**: {@link hexToRgb}, {@link rgbToHex}, {@link hslToRgb}, {@link blendColors}
 * - **Geometry**: {@link createGrid}, {@link createCircle}, {@link createSphere},
 *   {@link createSpiral}
 */

import * as colorUtils from './color';
import * as mathUtils from './math';
import * as geometryUtils from './geometry';

/**
 * Util namespace — all utility functions in one object.
 *
 * Contains every exported function from the `math`, `color`, and `geometry`
 * sub-modules. Use this for convenient discovery and ergonomic calling:
 *
 * ```ts
 * import { Util } from '@cyc/3d-components/utils';
 * Util.clamp(value, 0, 1);
 * Util.createSphere(radius, count);
 * ```
 *
 * @see For individual imports, see the sub-module exports.
 */
export const Util = {
  ...mathUtils,
  ...colorUtils,
  ...geometryUtils,
} as const;

// Re-export individual functions for tree-shaking
export * from './math';
export * from './color';
export * from './geometry';

// Font / SDF utilities
export { DynamicFont } from './dynamicFont';
export type { DynamicFontOptions, FontData, FontChar } from './dynamicFont';
export { DistanceTransform } from './distanceTransform';
