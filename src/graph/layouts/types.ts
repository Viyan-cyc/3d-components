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

import type { NodeData, NodeId, NodePos3D } from '../types';

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

/**
 * 环形布局配置（Step 3）。
 *
 * 2D 圆周 `(x, y) = (R·cosθ, R·sinθ)` 经 {@link BaseLayoutConfig.plane} 映射到三维平面，
 * 在被忽略轴上以 {@link BaseLayoutConfig.depthOffset} + `layerIndex * layerSpacing` 分层。
 *
 * 支持三种用法（按优先级）：
 * 1. **按分组分层**（`groupBy` 命中）：读 `node[groupBy]` 分桶，**每组 = 一个深度层**
 *    （`depthOffset + groupIndex * layerSpacing`），组内绕 `radius`（或 `radius + groupIndex * radiusStep`
 *    成锥/螺旋）散布 —— 落地 DESIGN.md「`depthOffset` 可按分组给不同 y/z」。
 * 2. **同心多环**（`groupBy` 缺省且 `rings > 1`）：按 index 轮询分入 `rings` 环，
 *    每环平面内 `radius + i * radiusStep`，且每环在被忽略轴叠加 `i * layerSpacing`。
 * 3. **单圈单层**（`groupBy` 缺省且 `rings === 1`）：最常见，全部节点绕一圈，depth = `depthOffset`。
 *
 * @example
 * ```ts
 * import { Layouts } from '@cyc/3d-components/graph';
 *
 * // 地面（xz 平面）单圈
 * Layouts.circular(nodes, { radius: 4, plane: 'xz' });
 *
 * // 按节点 group 字段分层：每层一圈、层间间隔 1.2
 * Layouts.circular(nodes, { radius: 3, groupBy: 'group', layerSpacing: 1.2 });
 * ```
 */
export interface CircularLayoutConfig extends BaseLayoutConfig {
  /**
   * 圆环半径（基础值）。
   * @default 3
   */
  radius?: number;
  /**
   * 起始角度（弧度）。
   * @default 0
   */
  startAngle?: number;
  /**
   * 结束角度（弧度）。默认 `2π`（整圆）；改小可画弧。
   * @default Math.PI * 2
   */
  endAngle?: number;
  /**
   * 同心环数量（仅 `groupBy` 缺省时生效）。节点按 index 轮询均分到各环。
   * @default 1
   */
  rings?: number;
  /**
   * 相邻同心环的半径步进（仅 `rings > 1` 或 `groupBy` 分层时生效）。
   * @default 1
   */
  radiusStep?: number;
  /**
   * 分层字段名。命中时按 `node[groupBy]` 的取值去重分桶，**每组一个深度层**
   * （用 `depthOffset + groupIndex * layerSpacing`）。借 {@link NodeData} 的
   * `[key: string]: unknown` 索引签名读取。
   */
  groupBy?: string;
}

/**
 * 力导向布局配置（Step 3）。
 *
 * 移植自 **d3-force** 思路（库仑斥力 + 弹簧吸引 + 中心引力 + alpha 冷却 + 速度阻尼），
 * 直接迭代输出三维 {@link NodePos3D}。同步运行 `iterations` 步后返回静止态。
 *
 * 因统一签名 `(nodes, config) => NodePos3D[]` 不收边，**连接结构经
 * {@link ForceLayoutConfig.edges} 传入**；`Graph3D.applyLayout` 会自动注入当前图边。
 *
 * @example
 * ```ts
 * import { Layouts } from '@cyc/3d-components/graph';
 *
 * // 3D 力导向（默认）
 * Layouts.force(nodes, { edges, iterations: 300 });
 *
 * // 平面力导向（xy 平面，再映射到 xz）
 * Layouts.force(nodes, { edges, dimensions: 2, plane: 'xz' });
 * ```
 */
export interface ForceLayoutConfig extends BaseLayoutConfig {
  /**
   * 维度。`3`（默认）= 三维力导向，**此时 `plane`/`depthOffset`/`layerSpacing` 均为 no-op**
   * （无被忽略轴）；`2` = 在 xy 平面计算后经 {@link BaseLayoutConfig.plane} 映射到三维。
   * @default 3
   */
  dimensions?: 2 | 3;
  /**
   * 迭代步数。越多越收敛；节点很多（>600）时布局函数会自动减半并 `console.warn`。
   * @default 300
   */
  iterations?: number;
  /**
   * 弹簧（边）静止长度。
   * @default 1
   */
  linkDistance?: number;
  /**
   * 弹簧刚度（每步施加比例）。
   * @default 0.3
   */
  linkStrength?: number;
  /**
   * 节点间库仑斥力强度。**正值 = 斥力**（节点互相推开）。
   * @default 30
   */
  chargeStrength?: number;
  /**
   * 中心引力强度（把全体节点拉向 {@link ForceLayoutConfig.center}）。
   * @default 0.02
   */
  centerStrength?: number;
  /**
   * 中心坐标 `[x, y, z]`。
   * @default [0, 0, 0]
   */
  center?: [number, number, number];
  /**
   * 速度阻尼（每步速度乘以 `1 - velocityDecay`）。默认 `0.6` 比 d3-force 的 `0.4` 更阻尼，
   * 因本布局结果常作为 gsap 过渡的**静止态**，收敛稳定性优先于「活跃感」。
   * @default 0.6
   */
  velocityDecay?: number;
  /**
   * 连接结构（无向）。**力导向的吸引项依赖它**；缺省/空时退化为纯斥力 + 向心
   * （节点会被推开但仍聚拢在中心，仍返回有限坐标）。`Graph3D.applyLayout` 会自动注入。
   */
  edges?: Array<{ source: NodeId; target: NodeId }>;
  /**
   * 是否启用 **Barnes-Hut 近似**计算斥力（3D 八叉树，`O(n log n)`，Step 5）。
   *
   * 默认关闭：对中小图（&lt;500）给出**精确**的成对斥力结果。开启后以八叉树聚合远场节点、
   * 近似计算 —— 大图（&gt;500）显著更快，结果略有近似误差（对布局视觉效果通常无感）。
   *
   * 仅对 `dimensions: 3` 生效；`dimensions: 2` 时回退精确成对（平面点云八叉树退化为低效）。
   * @default false
   */
  barnesHut?: boolean;
  /**
   * Barnes-Hut **开角阈值** θ。子树尺寸 `s` 与距离 `d` 之比 `s/d < θ` 时聚合近似；
   * 越小越精确（更接近 `O(n²)`）也越慢，越大越快越粗糙。
   * @default 0.9
   */
  theta?: number;
}

/**
 * 六边形蜂巢布局配置（Step 4）。
 *
 * 轴向坐标 `(q, r)` 从中心向外**逐环螺旋**铺开（第 k 环 `6k` 格），保证蜂巢紧凑无空洞；
 * 再按 {@link HexLayoutConfig.orientation}（平顶/尖顶）换算为 2D 世界坐标，经
 * {@link BaseLayoutConfig.plane} 映射到三维。
 *
 * 本质为 2D 布局（一张蜂巢切片），多层堆叠经 {@link BaseLayoutConfig.layerSpacing} 在被忽略轴上分层
 * （与 {@link CircularLayoutConfig} 的分层用法一致）。三种用法（按优先级）：
 * 1. **按分组分层**（`groupBy` 命中）：读 `node[groupBy]` 分桶，**每组 = 一个深度层**
 *    （`depthOffset + groupIndex * layerSpacing`），组内各自铺一张蜂巢。
 * 2. **多层堆叠**（`groupBy` 缺省且 `layers > 1`）：按 index 轮询均分到 `layers` 层，每层一张蜂巢。
 * 3. **单层蜂巢**（其余）：全部节点铺成一张蜂巢。
 *
 * 算法移植自 RedBlobGames《Hexagonal Grids》的 ring/spiral 与 hex-to-pixel 公式。
 *
 * @example
 * ```ts
 * import { Layouts } from '@cyc/3d-components/graph';
 *
 * // 单层平顶蜂巢（地面 xz）
 * Layouts.hex(nodes, { radius: 1.2, plane: 'xz' });
 *
 * // 三层堆叠（层间距 2.4）
 * Layouts.hex(nodes, { radius: 1.2, layers: 3, layerSpacing: 2.4 });
 *
 * // 尖顶朝向
 * Layouts.hex(nodes, { radius: 1.2, orientation: 'pointy' });
 * ```
 */
export interface HexLayoutConfig extends BaseLayoutConfig {
  /**
   * 六边形外接圆半径（中心 → 顶点）。决定蜂巢整体尺度与相邻中心距（平顶相邻中心距 `1.5·radius`）。
   * @default 1
   */
  radius?: number;
  /**
   * 六边形朝向。
   * - `'flat'`（默认）：平顶 —— 顶点朝左右，自然蜂巢形态。
   * - `'pointy'`：尖顶 —— 顶点朝上下。
   *
   * 仅影响 `(q, r) → 世界坐标` 的换算公式，不影响轴向坐标分配。
   * @default 'flat'
   */
  orientation?: 'flat' | 'pointy';
  /**
   * 堆叠层数（仅 `groupBy` 缺省时生效）。节点按 index 轮询均分到各层，每层一张蜂巢切片，
   * 在被忽略轴上以 `layerSpacing` 为步长分层。
   * @default 1
   */
  layers?: number;
  /**
   * 分层字段名。命中时按 `node[groupBy]` 的取值去重分桶，**每组一个深度层**
   * （用 `depthOffset + groupIndex * layerSpacing`），组内各自铺一张蜂巢。
   * 借 {@link NodeData} 的 `[key: string]: unknown` 索引签名读取。
   */
  groupBy?: string;
}

/**
 * 网格布局配置（Step 4）。
 *
 * 行 / 列 / 层三维网格，**直接输出三维坐标**：`col → x`、`row → z`、`level → y`，整体居中于原点。
 * 本质为 3D 布局（无被忽略轴），故 {@link BaseLayoutConfig.plane} / `depthOffset` / `layerSpacing`
 * 均为 **no-op**（与 {@link ForceLayoutConfig} 的 `dimensions: 3` 一致）；间距改由
 * `spacingX` / `spacingY` / `spacingZ` 精细控制。
 *
 * `rows` / `cols` / `levels` 任一缺省时自动推算（尽量铺满规则网格）：`cols` 缺省取
 * `ceil(sqrt(n / levels))`，`rows` 缺省取 `ceil(n / (cols · levels))`。节点超出
 * `rows·cols·levels` 容量时向上溢出（`level` 继续递增，坐标仍有限）。
 *
 * @example
 * ```ts
 * import { Layouts } from '@cyc/3d-components/graph';
 *
 * // 地面平铺网格（自动推算行列）
 * Layouts.grid(nodes, { spacingX: 1.2, spacingZ: 1.2 });
 *
 * // 三维网格（3 层堆叠）
 * Layouts.grid(nodes, { levels: 3, spacingX: 1.2, spacingY: 2.4, spacingZ: 1.2 });
 *
 * // 显式 4 列
 * Layouts.grid(nodes, { cols: 4, spacingX: 1.2, spacingZ: 1.2 });
 * ```
 */
export interface GridLayoutConfig extends BaseLayoutConfig {
  /**
   * 列数（每行节点数）。缺省按 `ceil(sqrt(n / levels))` 推算。
   */
  cols?: number;
  /**
   * 行数（每层行数）。缺省按 `ceil(n / (cols · levels))` 推算。
   */
  rows?: number;
  /**
   * 层数（垂直堆叠层数）。
   * @default 1
   */
  levels?: number;
  /**
   * X 方向间距（列间距，对应 `col → x`）。
   * @default 1
   */
  spacingX?: number;
  /**
   * Y 方向间距（层间距，垂直方向，对应 `level → y`）。
   * @default 1
   */
  spacingY?: number;
  /**
   * Z 方向间距（行间距，对应 `row → z`）。
   * @default 1
   */
  spacingZ?: number;
}

/**
 * 内置布局类型名（对应 {@link Layouts} 命名空间的键）。
 *
 * 用于 {@link LayoutPreset} 的判别字段，使布局可**声明式**指定。
 */
export type LayoutType = 'circular' | 'force' | 'hex' | 'grid';

/**
 * 声明式布局预设 —— `type` + 对应配置（Step 5）。
 *
 * 判别联合（discriminated union）：`type` 决定 `config` 的具体类型，调用点即获类型安全。
 * 用于 {@link Graph3DOptions.layout} / {@link Graph3D.setLayout}，使布局可声明式指定，
 * 并在 `setData` 时**自动重新编排**（无需每次手动 `applyLayout`）。
 *
 * @example
 * ```ts
 * import { Graph3D, type LayoutPreset } from '@cyc/3d-components/graph';
 *
 * // 构造时声明初始布局
 * const layout: LayoutPreset = { type: 'force', config: { iterations: 300 } };
 * const graph = new Graph3D({ layout });
 *
 * // 运行时切换（会被记住，setData 时自动重应用）
 * graph.setLayout({ type: 'hex', config: { radius: 1.3, layers: 3 } });
 * ```
 */
export type LayoutPreset =
  | { type: 'circular'; config?: CircularLayoutConfig }
  | { type: 'force'; config?: ForceLayoutConfig }
  | { type: 'hex'; config?: HexLayoutConfig }
  | { type: 'grid'; config?: GridLayoutConfig };
