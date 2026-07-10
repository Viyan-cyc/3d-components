/**
 * @packageDocumentation
 *
 * # graph
 *
 * 基于**图数据结构**（节点 Node + 边 Edge）的 3D 可视化组件，
 * 设计理念参考 AntV G6，渲染引擎基于 Three.js，支持三维空间下的布局与交互。
 *
 * ## 分层
 * - **Data 层**：{@link NodeData} / {@link EdgeData} / {@link GraphData} / {@link NodePos3D}。
 * - **Adapter 层**：`validate` / `normalize` / `buildIndex` / `prepare`。
 * - **Layout 层**：`layouts/` 纯函数（第一步仅类型骨架）。
 * - **Element 层**：{@link Node3D}（球体节点）/ {@link Edge3D}（直线边）。
 * - **Graph 层**：{@link Graph3D} 主组件（`extends BaseGroup`）。
 *
 * ## 快速开始
 * ```ts
 * import { Graph3D } from '@cyc/3d-components/graph';
 *
 * const graph = new Graph3D();
 * graph.setData({
 *   nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
 *   edges: [
 *     { source: 'n1', target: 'n2' },
 *     { source: 'n2', target: 'n3' },
 *   ],
 * });
 * scene.add(graph);
 *
 * // 渲染循环中每帧调用：
 * graph.update(delta);
 * ```
 *
 * ## 布局规范
 * 所有布局算法输出 {@link NodePos3D}（含完整 x/y/z），签名
 * `(nodes, config) => NodePos3D[]`。2D 布局通过 `plane: 'xy'|'xz'` 映射到三维平面，
 * 外加 `depthOffset`/`layerSpacing` 在被忽略轴上分层。
 */

// 主组件
export { Graph3D } from './Graph3D';
export type { Graph3DOptions } from './Graph3D';

// 数据类型
export type {
  NodeId,
  NodePos3D,
  NodeData,
  EdgeData,
  GraphData,
} from './types';

// 数据适配层
export { validate, normalize, buildIndex, prepare } from './adapter';
export type { ValidationResult, GraphIndex } from './adapter';

// 元素
export { Node3D } from './elements/Node3D';
export type { Node3DOptions } from './elements/Node3D';
export { Edge3D } from './elements/Edge3D';
export type { Edge3DOptions } from './elements/Edge3D';

// 布局（类型骨架）
export * from './layouts';
