/**
 * @module graph/layouts
 *
 * 布局算法模块。
 *
 * **核心输出规范：** 所有布局算法统一签名 `(nodes, config) => NodePos3D[]`，
 * 输出包含完整 x/y/z 三维坐标。纯函数、零 Three.js 运行时依赖（仅 `import type`），
 * 可独立单测、亦可在组件外部作为工具函数独立调用。
 *
 * 已实现：
 * - **Step 3**：{@link circular}（环形 3D 化）、{@link force}（3D 力导向）。
 * - **Step 4**：{@link hex}（六边形蜂巢，轴向螺旋 + 多层堆叠）、{@link grid}（行/列/层三维网格）。
 *
 * 除命名导入外，亦可经 {@link Layouts} 命名空间统一访问（对齐 `utils` 模块的 `Util` 模式）。
 *
 * @example
 * ```ts
 * import { Layouts } from '@cyc/3d-components/graph';
 *
 * // 命名空间风格
 * Layouts.circular(nodes, { radius: 4 });
 * Layouts.force(nodes, { edges, dimensions: 3 });
 * Layouts.hex(nodes, { radius: 1.2, layers: 3, layerSpacing: 2.4 });
 * Layouts.grid(nodes, { levels: 3, spacingX: 1.2, spacingY: 2.4, spacingZ: 1.2 });
 *
 * // 命名导入风格（更利于 tree-shaking）
 * import { circular, hex } from '@cyc/3d-components/graph';
 * circular(nodes, { radius: 4 });
 * ```
 */

import { circular } from './circular';
import { force } from './force';
import { grid } from './grid';
import { hex } from './hex';
import type { BaseLayoutConfig, LayoutFn, LayoutPreset, LayoutType } from './types';

export { circular } from './circular';
export { force } from './force';
export { grid } from './grid';
export { hex } from './hex';

export type {
  BaseLayoutConfig,
  LayoutFn,
  CircularLayoutConfig,
  ForceLayoutConfig,
  HexLayoutConfig,
  GridLayoutConfig,
  LayoutType,
  LayoutPreset,
} from './types';

/**
 * 内置布局名 → 布局函数（Step 5）。供 {@link resolveLayoutPreset} 与 Graph3D 的
 * `setData` 自动编排使用，亦可被外部调用者按名取函数。
 */
const LAYOUT_REGISTRY: Record<LayoutType, LayoutFn> = {
  circular,
  force,
  hex,
  grid,
};

/**
 * 解析 {@link LayoutPreset} 为「布局函数 + 配置」二元组（Step 5）。
 *
 * `Graph3D.setData` 自动编排与 `setLayout` 内部调用此函数，把声明式预设翻译成
 * `applyLayout` 所需的 `(layout, config)` 入参。返回 `null` 表示未设置布局。
 *
 * @param preset - 声明式布局预设（可为 `undefined`）。
 * @returns `{ layout, config }` 或 `null`。
 */
export function resolveLayoutPreset(
  preset?: LayoutPreset | null,
): { layout: LayoutFn; config?: BaseLayoutConfig } | null {
  if (!preset) return null;
  const layout = LAYOUT_REGISTRY[preset.type];
  return { layout, config: preset.config };
}

/**
 * Layouts 命名空间 —— 汇总所有布局算法，便于发现式调用。
 *
 * 与命名导入等价；命名空间风格便于在 IDE 中列出可用布局。
 */
export const Layouts = {
  circular,
  force,
  grid,
  hex,
} as const;
