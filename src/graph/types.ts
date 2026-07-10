/**
 * @module graph
 *
 * **图组件 (Graph Component)**
 *
 * 基于 **图数据结构**（节点 Node + 边 Edge）的 3D 可视化组件，
 * 设计理念参考 AntV G6，渲染引擎基于 Three.js，支持三维空间下的布局与交互。
 *
 * 数据层（本文件）定义节点/边/图的输入数据模型与**标准三维坐标接口**。
 * 所有布局算法的输出统一为 {@link NodePos3D}（包含完整 x/y/z）。
 */

/**
 * 节点或边的唯一标识。兼容字符串与数字 id。
 *
 * @example
 * ```ts
 * const id: NodeId = 'node-1';
 * const numericId: NodeId = 42;
 * ```
 */
export type NodeId = string | number;

/**
 * 标准三维坐标 —— **所有布局算法的统一输出单位**。
 *
 * 每个布局算法最终必须为每个节点生成完整的 3D 坐标数据，
 * 即包含 `x`、`y`、`z` 三个维度的数值。不接受「2D 坐标 + 额外分层字段」的混合格式。
 *
 * @example
 * ```ts
 * const pos: NodePos3D = { id: 'n1', x: 1.5, y: 0, z: -2.3 };
 * ```
 */
export interface NodePos3D {
  /** 节点 id，对应输入数据的 {@link NodeData.id}。 */
  id: NodeId;
  /** X 坐标。 */
  x: number;
  /** Y 坐标（通常为垂直/高度方向）。 */
  y: number;
  /** Z 坐标（通常为深度方向）。 */
  z: number;
}

/**
 * 用户输入的节点数据。
 *
 * `id` 必填且需在图内唯一；其余字段可选。任意自定义业务数据可通过 `data` 携带，
 * 也可作为平铺字段直接挂在节点上（通过索引签名 `[key: string]: unknown`）。
 *
 * @example
 * ```ts
 * const node: NodeData = {
 *   id: 'n1',
 *   size: 0.5,
 *   type: 'mesh',
 *   data: { label: '服务器 A', weight: 12 },
 * };
 * ```
 */
export interface NodeData {
  /** **必填**。节点唯一标识。 */
  id: NodeId;

  /**
   * 可选显式坐标。若提供，渲染/布局层可直接采用以绕过布局算法计算。
   * 未提供则由布局算法给出（第一步默认在原点环形散布）。
   */
  x?: number;
  /** 见 {@link NodeData.x}。 */
  y?: number;
  /** 见 {@link NodeData.x}。 */
  z?: number;

  /**
   * 节点尺寸。若未指定，渲染层通过计算其包围盒（boundingBox）
   * 或包围球（boundingSphere）自动得出。
   */
  size?: number;

  /**
   * 节点视觉类型提示。决定渲染层使用何种 Three.js 对象承载节点。
   * 第一步仅实现 `'mesh'`；后续步骤补全 `'sprite'` 与 `'html'`。
   * @default 'mesh'
   */
  type?: 'mesh' | 'sprite' | 'html';

  /**
   * 任意自定义业务数据。不参与布局/渲染逻辑，仅供交互回调读取。
   */
  data?: Record<string, unknown>;

  /** 允许平铺任意自定义字段。 */
  [key: string]: unknown;
}

/**
 * 用户输入的边数据。
 *
 * `source` 与 `target` 必填，指向已存在的节点 id。`id` 可选，
 * 未提供时适配层会自动按 `source->target` 生成。
 *
 * @example
 * ```ts
 * const edge: EdgeData = { source: 'n1', target: 'n2', type: 'line' };
 * ```
 */
export interface EdgeData {
  /** **必填**。起点节点 id。 */
  source: NodeId;
  /** **必填**。终点节点 id。 */
  target: NodeId;

  /**
   * 边 id。可选，未提供时由适配层自动生成（格式 `${source}->${target}`）。
   */
  id?: NodeId;

  /**
   * 边形态类型。决定渲染层使用何种几何承载边。
   * 第一步仅实现 `'line'`（直线段）；后续步骤补 `'path'`（管道/带状，复用 `core/Path`）。
   * @default 'line'
   */
  type?: 'line' | 'path';

  /** 任意自定义业务数据。 */
  data?: Record<string, unknown>;

  /** 允许平铺任意自定义字段。 */
  [key: string]: unknown;
}

/**
 * 完整图数据 —— {@link Graph3D} 的输入。
 *
 * @example
 * ```ts
 * const graphData: GraphData = {
 *   nodes: [{ id: 'n1' }, { id: 'n2' }],
 *   edges: [{ source: 'n1', target: 'n2' }],
 * };
 * ```
 */
export interface GraphData {
  /** 节点数组。 */
  nodes: NodeData[];
  /** 边数组。 */
  edges: EdgeData[];
}
