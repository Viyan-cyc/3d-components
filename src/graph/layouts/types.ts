/**
 * @module graph/layouts/types
 *
 * 布局配置与函数的统一类型契约。
 *
 * **核心输出规范：** 所有布局算法的最终输出，必须为每个节点生成完整的 3D 坐标数据
 * （{@link NodePos3D}，含 x/y/z）。函数签名统一为 `(nodes, config) => NodePos3D[]`。
 *
 * Layout 层是**纯函数**，零 Three.js 运行时依赖（仅类型导入），可独立单测、
 * 亦可在组件外部作为工具函数独立调用。
 *
 * 本文件在第一步仅建立骨架；具体布局算法（环形 3D 化、3D 力导向、
 * 六边形蜂巢、网格布局等）在后续步骤填充。
 */

import type { NodeData, NodePos3D } from '../types';

/**
 * 所有布局配置的公共基类。
 *
 * 适用于「本质为 2D」的布局（力导向平面模式、环形、树平面模式等），
 * 用于把 2D 计算结果映射到三维空间的一个平面。
 *
 * @example
 * ```ts
 * const cfg: BaseLayoutConfig = { plane: 'xz', depthOffset: 1.5, layerSpacing: 0.8 };
 * ```
 */
export interface BaseLayoutConfig {
  /**
   * 2D 布局结果映射到三维空间的哪个平面。
   * - `'xy'` → 布局计算出的 `(x, y)` 映射为三维坐标 `(x, y, 0)`。
   * - `'xz'` → 布局计算出的 `(x, y)` 映射为三维坐标 `(x, 0, z)`。
   *
   * @default 'xz'
   */
  plane?: 'xy' | 'xz';

  /**
   * 垂直方向（即被 `plane` 忽略的那个轴）的整体偏移。
   * - `plane: 'xy'` 时影响 `z`；
   * - `plane: 'xz'` 时影响 `y`。
   *
   * 用于把整层布局沿垂直方向平移，增加立体层次感。
   * @default 0
   */
  depthOffset?: number;

  /**
   * 不同层级 / 分组之间的垂直间距。
   * 布局算法可按节点的层级或分组，在垂直方向上以 `layerSpacing` 为步长叠加偏移。
   * @default 0
   */
  layerSpacing?: number;
}

/**
 * 布局函数的统一签名。
 *
 * 接收节点数组与配置参数，返回每个节点的完整三维坐标。
 * **纯函数**：不修改输入 `nodes`，输出为新数组。
 *
 * @typeParam C - 布局配置类型，须继承 {@link BaseLayoutConfig}。
 *
 * @example
 * ```ts
 * import type { LayoutFn } from '@cyc/3d-components/graph';
 *
 * const circular: LayoutFn<CircularLayoutConfig> = (nodes, config) => {
 *   // ... 计算 ...
 *   return nodes.map((n, i) => ({ id: n.id, x: ..., y: ..., z: ... }));
 * };
 * ```
 */
export type LayoutFn<C extends BaseLayoutConfig = BaseLayoutConfig> = (
  nodes: NodeData[],
  config?: C,
) => NodePos3D[];
