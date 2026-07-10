# 3D Graph 组件 · 完整方案文档

> 本文档作为"持久化方案文档"，新会话可将其作为初始 prompt 以恢复上下文。
> 更新约定：每步完成后或决策变更时，更新本文档对应章节并标注日期。
>
> **当前进度（2026-07-10）：Step 1 已完成。** 后续步骤为蓝图，待推进。

---

## 0. 项目背景与上下文

在 `@cyc/3d-components`（位于 `d:\cyc\project\octo\3d-components1`）组件库中，新增一个 **3D 图可视化组件**：基于图数据结构（Node/Edge），充分参考 AntV G6 的设计理念，渲染引擎基于 Three.js，支持三维空间下的布局与交互。

**项目基线：**
- npm 库 `@cyc/3d-components`，TypeScript strict，Vite 6 library mode，peerDeps: `three@^0.185`、`gsap`、`three-bvh-csg`、`three-mesh-bvh`。
- 现有子模块：`core / heat / material / utils`，每个模块 barrel 导出（`Options 接口 + 类`），通过 `@cyc/3d-components/<sub>` 按需引入。**现已新增 `graph` 子模块。**
- `verbatimModuleSyntax` + `isolatedModules`：类型导出必须用 `export type`，不能混用值导入。
- 路径别名 `@/* → src/*`。
- 代码惯例：组件继承 `THREE.Object3D` 子类；实现 `IUpdatable.update(delta)` + `IDisposable.dispose()`；声明式构造（单 `Options` 对象）；JSDoc 详尽（`@example`/`@default`/`@param`）；shader 内联 `/* glsl */\`...\``；算法移植来源标注注释。

**可复用现成积木（按 Graph 四要素映射）：**

| Graph 要素 | 复用积木 | 路径 |
|---|---|---|
| 节点标签（CSS2D/3D/Sprite） | `Html`（2D 投影 + CSS3D transform + sprite billboard + 射线遮挡） | `src/core/Html.ts` |
| 节点文字 | `BitmapText`（SDF，CJK 支持） | `src/core/BitmapText.ts` |
| 边（管道/带/箭头） | `Path`（`mode:'tube'` 圆管 / `mode:'plane'` 扁平带+箭头） | `src/core/Path.ts` |
| 节点描边/线框 | `Outlines`（法线外扩）/ `Wireframe`（重心坐标） | `src/core/Outlines.ts`、`src/core/Wireframe.ts` |
| 大量节点（>1000） | `InstancedMesh2`（BVH 射线、视锥剔除、LOD） | `src/core/InstancedMesh2/` |
| 节点材质 | `ShinyMaterial`（预配 PBR） | `src/material/ShinyMaterial.ts` |
| 参考网格 | `Grid`（无限着色器网格） | `src/core/Grid.ts` |
| 组件基类 | `BaseGroup`（IUpdatable + IDisposable + 声明式构造） | `src/core/BaseGroup.ts` |
| 工具函数 | `Util`（clamp/lerp/distance/smoothstep/createSphere/createSpiral） | `src/utils/index.ts` |
| 场景搭建（仅 demo） | `createScene/createGround/startLoop/addSimpleOrbit` | `docs/shared/scene-setup.ts` |

**项目内缺失、需自建：** 图布局算法、Node/Edge/Graph 数据模型、通用拾取/悬停/点击交互事件系统、通用过渡动画系统。（Step 1 已建数据模型与适配层。）

**注意：** 项目内 **无 Line2 封装**，也未引入 `three/examples/jsm/lines/*`。第一步的边用 `THREE.LineSegments`/`LineBasicMaterial`（第二步可按需引入 `Line2` fat line）。

---

## 1. 核心架构蓝图（五步总览）

### 1.1 分层解耦

```
┌─────────────────────────────────────────────────┐
│  Data 层    types.ts        NodeData/EdgeData/GraphData + NodePos3D
│             adapter.ts      validate/normalize/buildIndex/prepare
├─────────────────────────────────────────────────┤
│  Layout 层  layouts/*.ts    纯函数 (nodes, config) => NodePos3D[]
│             layouts/types.ts  BaseLayoutConfig / LayoutFn
├─────────────────────────────────────────────────┤
│  Element 层 elements/Node3D.ts   节点视觉（Mesh/Sprite/Html 组合）
│             elements/Edge3D.ts   边视觉（Line/Path 组合）
├─────────────────────────────────────────────────┤
│  Interaction 层 interaction/PickController.ts  Raycaster 拾取 + 事件分发  ⏳ Step 2
├─────────────────────────────────────────────────┤
│  Graph 层   Graph3D.ts      extends BaseGroup，编排上述各层
│             index.ts        barrel + ./graph 包导出
└─────────────────────────────────────────────────┘
```

四层依赖单向向下：Graph → Interaction/Element → Layout → Data。Layout 层是纯函数，零 Three.js 运行时依赖（仅类型导入），可独立单测、可在组件外部调用。

### 1.2 五步路线图

| 步骤 | 交付内容 | 状态 |
|---|---|---|
| **Step 1** | 项目结构、核心数据类型（Node/Edge/Graph）、标准 3D 坐标接口、数据适配层、`Graph3D` 骨架 + 基础场景（球体节点 + 线段边）、demo | ✅ 完成 |
| Step 2 | 节点多形态（Mesh/Sprite/Html）、边多形态（Line2/Path）、悬停点击交互、自定义交互反馈 demo | ⏳ |
| Step 3 | 核心布局：环形布局 3D 化（xy/xz 平面 + depthOffset）、3D 力导向；坐标输出验证 | ⏳ |
| Step 4 | 扩展布局：六边形蜂巢（多层堆叠）、网格布局（行/列/层/间距）；封装 utils 暴露 + 调用示例 | ⏳ |
| Step 5 | 统一配置 API、文档与示例、性能优化（>1000 节点）、整体联调 | ⏳ |

### 1.3 关键技术决策（已确认）

- **模块定位**：新增 `src/graph/` 子模块 + `./graph` 包导出，与 `core/heat/material/utils` 并列。Graph 组件内部复用 `core` 的 `Html/Path`。
- **树/层次布局**：自研轻量 TS 实现（Compact Box / Dendrogram），**不引入** `@antv/hierarchy`（项目零 @antv 依赖，保持纯净）。
- **布局统一输出规范**：所有布局函数签名 `(nodes, config) => NodePos3D[]`，其中 `NodePos3D = { id: string|number; x: number; y: number; z: number }`。2D 布局通过 `plane: 'xy'|'xz'` 映射到三维平面，外加 `depthOffset`/`layerSpacing` 在被忽略轴上分层。
- **方案文档持久化**：本文件即为仓库内方案文档；记忆系统 `project-graph3d.md` 已登记指针。
- **材质粒度（2026-07-10 决策）**：**每元素 clone 独立材质**。`Graph3DOptions.nodeMaterial` / `edgeMaterial` 作为**材质模板（prototype）**传入，每个 `Node3D` / `Edge3D` 构造时 `material.clone()` 出独立实例，故各节点/边状态变更（改色/高亮）互不影响。`ownsMaterial` 字段已移除（clone 出的实例始终由元素自行释放）；`Node3D.getMaterial()` / `Edge3D.getMaterial()` 暴露独立实例供交互层直接改属性。权衡：1000 节点会产 1000 个材质对象、draw call 难合并——中小规模图（<500）首选此方案；大规模场景将来走 `InstancedMesh2` + per-instance color 路径（Step 5 预留切换点）。

---

## 2. 核心数据类型设计（Step 1 已实现）

实现位置：`src/graph/types.ts`。

```ts
export type NodeId = string | number;

/** 标准三维坐标 —— 所有布局算法的统一输出单位 */
export interface NodePos3D { id: NodeId; x: number; y: number; z: number; }

export interface NodeData {
  id: NodeId;
  x?: number; y?: number; z?: number;   // 可选显式坐标（绕过布局）
  size?: number;                          // 未指定则由渲染层 boundingBox 自动计算
  type?: 'mesh' | 'sprite' | 'html';     // @default 'mesh'
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EdgeData {
  source: NodeId; target: NodeId;
  id?: NodeId;                            // 未提供则自动生成 `${source}->${target}`
  type?: 'line' | 'path';                 // @default 'line'
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GraphData { nodes: NodeData[]; edges: EdgeData[]; }
```

布局接口骨架（`src/graph/layouts/types.ts`）：

```ts
export interface BaseLayoutConfig {
  plane?: 'xy' | 'xz';        // @default 'xz'
  depthOffset?: number;       // @default 0
  layerSpacing?: number;      // @default 0
}
export type LayoutFn<C extends BaseLayoutConfig = BaseLayoutConfig> =
  (nodes: NodeData[], config?: C) => NodePos3D[];
```

---

## 3. Step 1 已实现内容（文件清单）

| 文件 | 内容 |
|---|---|
| `src/graph/types.ts` | 数据类型 + NodePos3D |
| `src/graph/layouts/types.ts` | 布局接口骨架（BaseLayoutConfig / LayoutFn） |
| `src/graph/layouts/index.ts` | 布局 barrel（第一步仅类型） |
| `src/graph/adapter.ts` | 数据适配层：`validate` / `normalize` / `buildIndex` / `prepare`（纯函数、零 three 依赖） |
| `src/graph/elements/Node3D.ts` | 球体节点 `extends BaseGroup`，`setPosition/getSize/setSize/getMaterial`，每节点 clone 独立材质，`userData.nodeId` 供拾取回查，预留 `label` 槽位 |
| `src/graph/elements/Edge3D.ts` | `THREE.LineSegments` 直线边 `extends BaseGroup`，`updateEnds(src,tgt)`/`getMaterial()`，每边 clone 独立材质 |
| `src/graph/elements/index.ts` | 元素 barrel |
| `src/graph/Graph3D.ts` | 主组件：`setData/getNodes/getNode/getEdges/getData/getIndex/update/dispose` |
| `src/graph/index.ts` | graph 模块 barrel |
| `src/index.ts` | 新增 `export * from './graph'` |
| `vite.config.ts` | `build.lib.entry` 新增 `graph` 入口 |
| `package.json` | `exports` 新增 `"./graph"` 子路径映射 |
| `docs/components/graph/index.html` + `demo.ts` | demo：随机图生成 + 重建 + 「随机高亮」演示独立材质，OrbitControls 漫游 |
| `docs/index.html` | 侧边栏新增「图组件」分组与 Graph3D 导航项 |
| `docs/graph/DESIGN.md` | 本方案文档 |

### 关键 API

```ts
// Graph3D 主组件
const graph = new Graph3D({ nodeSize?: 0.3, nodeMaterial?, edgeMaterial?, initialRadius?: 3, data? });
graph.setData(data: GraphData): void;       // 校验+归一化+建索引+生成元素
graph.getNodes(): Node3D[];                  graph.getNode(id): Node3D | undefined;
graph.getEdges(): Edge3D[];                  graph.getData(): GraphData | null;  graph.getIndex(): GraphIndex | null;
graph.update(delta): void;                   graph.dispose(): void;

// 数据适配（可在组件外部独立使用）
import { validate, normalize, buildIndex, prepare } from '@cyc/3d-components/graph';
```

### 验证方式（Step 1 完成判定）

1. `npx tsc --noEmit` 通过；`npm run build` 产出 `dist/es/graph.js` + `dist/cjs/graph.cjs` + `.d.ts`。
2. 从 `@cyc/3d-components/graph` 与 `@cyc/3d-components` 两个路径都能 `import { Graph3D, type GraphData, type NodePos3D }`。
3. `npm run docs:serve` 打开文档站 `#graph`：浅灰底 + 球体节点 + 线段边，OrbitControls 可旋转缩放；点「重新生成」按钮后节点/边正确重建无残留。
4. 反复重建数据，DevTools Memory 中 geometry/material 计数不持续增长。

---

## 4. 后续步骤技术预案

- **Step 2 交互**：`PickController` 持有 `THREE.Raycaster`，pointer 事件拾取 `Node3D`/`Edge3D`（通过 `userData.nodeId`/`edgeId` 回查）；事件类型 `GraphEvent = { type: 'hover'|'click'|'select'|'unselect'; id: NodeId; ... }`；用户注册 `onHover/onSelect` 回调做任意视觉变化（变色/缩放/动画/信息面板）。节点补 `Sprite`/`Html` 形态；边补 `Line2`/`Path`（管道）形态。
- **Step 3 布局**：
  - 环形布局 3D 化：2D 圆周 `(x,y) = (R·cosθ, R·sinθ)`，按 `plane` 映射为 `(x,y,0)` 或 `(x,0,z)`，`depthOffset` 可按分组给不同 y/z。
  - 3D 力导向：三维 Repulsion（库仑）/ Attraction（弹簧）/ Centering 迭代，直接输出 `NodePos3D`。可用 `InstancedMesh2` 应对 >1000 节点。
  - 树/层次布局：自研 Compact Box / Dendrogram（参考 @antv/hierarchy 思路，不引包），支持 2D 平面映射与 3D 分层（层级在 Y 轴不同高度，同层在 XZ 展开）。
- **Step 4 扩展布局**：
  - 六边形蜂巢：轴向坐标 `(q,r)` → 3D `(x,0,z)`，`layerSpacing` 堆叠多层。
  - 网格布局：`rows/cols/levels + spacingX/Y/Z`，直接输出三维网格坐标。
  - 全部封装进 `src/graph/layouts/index.ts` 作为 `Layouts` 命名空间工具暴露，可在组件外部独立调用。
- **Step 5 集成**：统一 `Graph3DOptions.layout` 配置项（`type` + 配置对象），`setData` 时自动编排；补 TypeDoc；性能压测。

---

## 5. 持久化与会话恢复约定

1. 本方案文档为 `docs/graph/DESIGN.md`。
2. 记忆系统已写入 `project-graph3d.md` 指针（`MEMORY.md` 已登记）。
3. 新会话恢复方式：把本文件内容作为初始 prompt 粘贴，并说明"本次做第 N 步"；先确认理解已有结论，再推进，不重复讨论已定决策。
4. 上下文接近上限时主动提醒，并整理"已确认结论摘要"供保存。
