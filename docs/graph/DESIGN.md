# 3D Graph 组件 · 完整方案文档

> 本文档作为"持久化方案文档"，新会话可将其作为初始 prompt 以恢复上下文。
> 更新约定：每步完成后或决策变更时，更新本文档对应章节并标注日期。
>
> **当前进度（2026-07-14）：Step 1–5 全部完成。** 五步路线图交付完毕。

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
| **Step 2** | 边多形态（line/path 复用 core/Path，可带箭头）、`PickController` 交互（节点优先拾取；节点+边均可 hover/select；单选互斥/多选累加；邻接边只提亮、非邻接不变；点击空白清除+`clearSelection()`；内置反馈+事件回调）、多形态与交互 demo | ✅ 完成 |
| Step 3 | 核心布局：环形布局 3D 化（xy/xz 平面 + depthOffset）、3D 力导向；坐标输出验证 | ✅ 完成 |
| Step 4 | 扩展布局：六边形蜂巢（多层堆叠）、网格布局（行/列/层/间距）；封装 utils 暴露 + 调用示例 | ✅ 完成 |
| **Step 5** | 统一配置 API、文档与示例、性能优化（>1000 节点）、整体联调 | ✅ 完成 |

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

## 3.1 Step 2 已实现内容（文件清单）

| 文件 | 内容 |
|---|---|
| `src/graph/elements/Edge3D.ts` | 边补 `'path'` 形态：复用 `core/Path`（`mode:'tube'` 圆管，可选末端箭头）。`type:'line'\|'path'` 分支构造/`updateEnds`/`dispose`/`getMaterial`。`'path'` 形态内部 mesh 带 `userData.edgeId` 供拾取回查。 |
| `src/graph/interaction/types.ts` | 交互事件契约：`GraphEvent` / `GraphEventType`（hover/unhover/click/select/unselect）/ `GraphPickKind` / `GraphEventHandler` |
| `src/graph/interaction/PickController.ts` | 交互控制器：Raycaster 拾取 + `userData` 回查（**节点优先于边**）；hover/select 状态机（节点+边均可）；内置反馈（节点悬停放大+发光、选中常亮；边悬停/选中提亮为强调色，`path` 加 emissive；邻接边**只提亮、非邻接不变**）采用重算模型避免缓存污染；`single`/`multiple` 选中模式（互斥/累加 toggle）；`onHover/onSelect` 事件回调；click vs OrbitControls 拖拽位移阈值区分；点击空白/地面自动 `clearSelection()`；`setEnabled/setHighlightOn*/setNeighborHighlight/setSelectionMode` 运行时开关；`dispose` 移除监听并还原反馈 |
| `src/graph/interaction/index.ts` | 交互层 barrel |
| `src/graph/Graph3D.ts` | `Graph3DOptions` 增 `edgeType/edgePathRadius/edgeArrow`（单边可被 `EdgeData.type` 覆盖）；新增 `getEdge(id)`；`edgeById` 索引随 `setData`/`clearElements` 维护 |
| `src/graph/index.ts` | 导出 `PickController` + 交互事件类型 + `EdgeType` |
| `docs/components/graph/demo.ts` | demo 升第二步：边形态切换（line/path带箭头/混合）、`PickController` 接入、选中模式（单选/多选）单选切换、内置反馈开关、hover/select 状态条 |
| `docs/components/graph/index.html` | 文案升第二步、参数表补 `edgeType/pathRadius/arrow`、新增 PickController 用法 |

### 关键 API（Step 2 新增）

```ts
// Graph3D 边形态
const graph = new Graph3D({ edgeType?: 'line'|'path', edgePathRadius?: 0.05, edgeArrow?: false });
graph.getEdge(id): Edge3D | undefined;

// Edge3D 多形态
new Edge3D({ type?: 'line'|'path', pathRadius?, arrow?, material? });
edge.updateEnds(src, tgt);   // 'line' 原地写顶点；'path' 重建 Path 几何
edge.getMaterial(): LineBasicMaterial | MeshStandardMaterial;

// 交互
import { PickController, type GraphEvent } from '@cyc/3d-components/graph';
const pick = new PickController({
  domElement, graph, camera,
  selectionMode?: 'single' | 'multiple',   // @default 'single'
  onHover?: (e: GraphEvent) => void,       // hover / unhover（节点与边）
  onSelect?: (e: GraphEvent) => void,      // click / select / unselect（节点与边）
  highlightOnHover?: true, highlightOnSelect?: true, neighborHighlight?: true,
});
pick.update(delta);
pick.clearSelection();                       // 开发者主动清空选中（点空白也会触发）
pick.getSelectedNodes(): NodeId[];          // 当前选中节点
pick.getSelectedEdges(): NodeId[];          // 当前选中边
pick.setSelectionMode('multiple');           // 运行时切换互斥/累加
pick.dispose();
```

### 验证方式（Step 2 完成判定）

1. `npx tsc --noEmit` 通过；`npm run build` 产出含 `PickController`/`GraphEvent` 导出的 `.d.ts`。
2. `npm run docs:serve` 打开 `#graph`：边形态可在 line/path(带箭头)/混合间切换且重建无残留；节点优先于边拾取；节点悬停放大发光、边悬停提亮；节点/边均可选中（节点常亮、边常亮+emissive）；单选互斥/多选累加可切换；选中节点**只提亮邻接边**（非邻接边不变）；点击空白/地面清除选中；OrbitControls 拖拽不误触发 click；关闭内置反馈复选框后视觉无变化但状态条仍随 `onHover/onSelect` 更新。
3. 反复 hover/click/重建，DevTools Memory 中 geometry/material 计数不持续增长。

### Step 2 决策备注（2026-07-10，2026-07-13 更新）

- **节点 `sprite`/`html` 形态本次未做**：经确认暂缓。`Node3D.label` 槽位保留，后续步骤以 `core/Html`（DOM 标签投影）或 `core/BitmapText`（SDF 文字）填充；`Graph3D.update(delta)` 签名本次未改（Html 未接入，无需透传 camera/renderer）。
- **边形态选 `core/Path` 圆管 + 末端箭头**，未引入 `three/examples/jsm/lines/Line2`（fat line）；如需可控线宽，后续可按需扩 `'fatline'` 形态。
- **拾取优先级（2026-07-13）**：`pick()` 三轮——① raycaster 找节点（mesh 面拾取）；② raycaster 找 path 形态边（Mesh 面拾取）；③ line 形态边用**屏幕像素距离**判定（鼠标到边两端线段的最近屏幕距离 < `LINE_PICK_PIXELS=6px`）。避免近处边遮挡背后节点（「移到 node 上变 hover edge」）。
- **直线边拾取热区（2026-07-13）**：Three.js 的 `raycaster.params.Line.threshold` 默认 1（world unit），远相机下覆盖屏幕过大、离线很远也误命中。故将 raycaster 的 line threshold 设 0（禁用其宽热区），line 形态边改用屏幕像素距离（6px）自拾取 —— 热区在任意相机距离下紧贴线本身。path 形态是 Mesh，走面拾取不受影响。
- **选中模式（2026-07-13）**：`single`（互斥，选中新元素取消旧的，节点/边互斥）/ `multiple`（纯累加 toggle，点击追加、再点已选取消）。运行时可 `setSelectionMode` 切换。节点与边均可被选中，分 `selectedNodes`/`selectedEdges` 两集合管理。
- **边反馈（2026-07-13）**：边 hover/select 提亮为强调橙（不透明）；`'path'` 形态（MeshStandardMaterial）额外加 emissive 区分选中/悬停强度。`'line'` 形态（LineBasicMaterial 无 emissive）仅靠 color+opacity。
- **邻接边策略（2026-07-13）**：选中**节点**时，**只提亮其邻接边**（强调橙、不透明、无 emissive），**非邻接边保持默认原状不变**（不 dim、不删除）。边自身 hover/select 优先级高于邻接高亮。
- **交互反馈**：内置反馈 + 事件回调并存；反馈用「重算」模型（按 {边自身 hover/select > 邻接高亮 > 默认} 优先级重算受影响元素视觉），避免缓存还原叠加污染。

---

## 3.2 Step 3 已实现内容（文件清单）

| 文件 | 内容 |
|---|---|
| `src/graph/layouts/util.ts` | 内部纯函数：`mapToPlane2D(x2,y2,plane,depth)`（2D→三维平面映射：`'xy'→(x,y,depth)`、`'xz'→(x,depth,y)`）、`resolvePlane`、`resolveDepth`。零 three 依赖，仅本地使用 |
| `src/graph/layouts/types.ts` | 新增 `CircularLayoutConfig`（`radius/startAngle/endAngle/rings/radiusStep/groupBy`）、`ForceLayoutConfig`（`dimensions/iterations/linkDistance/linkStrength/chargeStrength/centerStrength/center/velocityDecay/edges`） |
| `src/graph/layouts/circular.ts` | `circular: LayoutFn<CircularLayoutConfig>` 纯函数：三模式——`groupBy` 分组分层（每组一个深度层）/ `rings>1` 同心多环（按 index 轮询）/ 单圈单层。2D 圆周经 `plane` 映射 |
| `src/graph/layouts/force.ts` | `force: LayoutFn<ForceLayoutConfig>` 纯函数：d3-force 思路三维力导向（库仑斥力 + 弹簧 + 中心引力 + alpha 冷却 + velocityDecay 阻尼）；稳定性守卫（`dist²≥1e-4` 防奇点、位置夹 `±1e4`、`Number.isFinite` 兜底）；`n>600` 自动减半 `iterations` + warn |
| `src/graph/layouts/index.ts` | barrel 导出 `circular`/`force` + 配置类型 + `Layouts` 命名空间（`{circular, force}`，对齐 `utils` 的 `Util` 模式） |
| `src/graph/Graph3D.ts` | 新增 `applyLayout<C>(layout, config?, options?)`（克隆 config、自动注入 `edges`、泛型推断）、`applyPositions(positions, options?)`（按 id 应用）、`syncEdges(updatePath)`（line 每帧 / path 节流）、`killLayoutTween()`；`setData`/`dispose` 中 kill 动画；导出 `LayoutApplyOptions` |
| `src/graph/index.ts` | 新增导出 `LayoutApplyOptions` |
| `docs/components/graph/demo.ts` | demo 升第三步：布局下拉（占位/环形 xz/xy/同心多环/分组分层/力导向 3D/2D）、同心环数滑杆、过渡动画开关、坐标读数条（坐标输出验证）、`Layouts.force` 纯函数独立性自检（控制台） |
| `docs/components/graph/index.html` | 文案升第三步、新增「布局 · Layouts」章节与参数表、示例补 `applyLayout` |

### 关键 API（Step 3 新增）

```ts
import { Graph3D, Layouts } from '@cyc/3d-components/graph';

// 布局纯函数（可独立调用，零 three 依赖）
Layouts.circular(nodes, { radius: 4, plane: 'xz' });
Layouts.force(nodes, { edges, dimensions: 3, iterations: 300 });

// 主组件应用布局（可选 gsap 过渡动画）—— 力导向自动注入当前图边
graph.applyLayout(Layouts.force, { iterations: 300 }, { animate: true, duration: 0.8 });
graph.applyLayout(Layouts.circular, { radius: 3, groupBy: 'group', layerSpacing: 1.5 });

// 外部/自定义坐标直接置位
graph.applyPositions(customPositions, { animate: true, onComplete: () => {} });
```

### 验证方式（Step 3 完成判定）

1. `npx tsc --noEmit` 通过；`npm run build` 产出含 `Layouts` / `circular` / `force` / `CircularLayoutConfig` / `ForceLayoutConfig` / `applyLayout` / `applyPositions` / `LayoutApplyOptions` 导出的 `.d.ts`。
2. `npm run docs:serve` 打开 `#graph`：布局下拉切换 → 节点经 gsap 平滑过渡到环形（xy 立面 vs xz 地面视觉不同）/同心多环/分组分层/3D 力导向团块；边端点跟随更新；坐标读数条显示有限数值（无 `NaN`/`Infinity`）；**动画中点「重新生成」无控制台报错**；布局后 hover/select/邻接高亮仍正常。
3. 纯函数独立性自检：demo 中直接 `Layouts.force(nodes, { edges, iterations: 300 })`（绕过 `Graph3D`）断言全部输出 `Number.isFinite`（控制台输出 ✓，落实 §1.1「可独立调用」）。
4. 反复 applyLayout + 重建，DevTools Memory 几何/材质计数不增长（gsap tween 在 `setData`/`dispose` 前 kill；`'path'` 边动画中节流重建）。

### Step 3 决策备注（2026-07-13）

- **力导向需边，但签名不变**：统一签名 `(nodes, config) => NodePos3D[]` 不增参数，边经 `ForceLayoutConfig.edges` 传入；`Graph3D.applyLayout` 自动从 `graphData.edges` 注入（克隆 config，不改调用者对象；调用者显式 edges 优先），故 `graph.applyLayout(Layouts.force)` 即可跑。`edges` 缺省时退化为纯斥力 + 向心（仍返回有限坐标）。
- **力导向稳定性守卫**：纯函数必须恒返回有限坐标 —— 库仑斥力 `dist²` 夹 `≥1e-4` 防奇点 → 否则 `Infinity` → `NaN`；每步位置夹 `±1e4`；`Number.isFinite` 否则重置 0 并清速度。冷却 `alphaDecay = 1 - 0.001**(1/iterations)`；`velocityDecay` 默认 0.6（比 d3 默认 0.4 更阻尼，因结果常作 gsap 静止态，收敛稳定性优先）。`n>600` 自动减半 `iterations` + `console.warn`（O(n²) 斥力；Barnes-Hut 留 Step 5）。
- **环形分组分层落地「按分组给不同 y/z」**：`groupBy` 命中时读 `node[groupBy]` 分桶，每组一个深度层 `depthOffset + groupIndex*layerSpacing`（组内绕 `radius` 或 `radius+groupIndex*radiusStep` 成锥/螺旋）；`groupBy` 缺省时 `rings>1` 走同心多环（按 index 轮询，每环 depth 叠加 `i*layerSpacing`）；`rings===1` 单圈单层。
- **方法命名 `applyLayout` vs `setLayout`**：Step 3 用 `applyLayout`（一次性应用，含可选 gsap 过渡）。持久化、`setData` 自动编排的 `setLayout` / `Graph3DOptions.layout` 留 Step 5，避免语义混淆与 Step 5 被迫重命名。
- **布局动画生命周期**：gsap 代理 `{t:0→1}`（对齐 `core/Grid.ts` 的 `killTweensOf` 模式），`onUpdate` 逐节点 lerp 起止位 + `syncEdges(false)`（`'line'` 边每帧原地写顶点；`'path'` 边节流——动画中不重建 Tube，完成帧 `syncEdges(true)` 终态对齐，避免 60fps×N 次 `TubeGeometry` 分配/释放）。**关键风险修复**：`setData`（`clearElements` 前）与 `dispose`（`super.dispose` 前）均 `killLayoutTween()`，避免动画 `onUpdate` 操作已释放几何导致运行时错误（demo「重新生成」即在动画中触发 `setData`）。
- **布局层保持纯净/独立**：`circular.ts`/`force.ts` 仅 `import type` 自 `../types`、`./types`，不引入 `src/utils`、不引入 three；`clamp`/`lerp`/`distSq` 内联（force 斥力热循环用平方距离避免 `Math.sqrt`）。可在组件外部独立单测/调用。
- **PickController 与布局共存**：拾取/选中以 id 管理，`applyLayout` 只改 `position` 不动 `scale`/`emissive`，故选中/悬停态在布局后保持；动画中拾取读实时 `position`，节点飞行中仍可命中。

---

## 3.3 Step 4 已实现内容（文件清单）

| 文件 | 内容 |
|---|---|
| `src/graph/layouts/types.ts` | 新增 `HexLayoutConfig`（`radius`/`orientation`(`'flat'\|'pointy'`)/`layers`/`groupBy`）、`GridLayoutConfig`（`cols`/`rows`/`levels`/`spacingX`/`spacingY`/`spacingZ`） |
| `src/graph/layouts/hex.ts` | `hex: LayoutFn<HexLayoutConfig>` 纯函数：轴向坐标 `(q,r)` 从中心逐环螺旋铺开（移植 RedBlobGames `cube_ring` 轴向版 + hex-to-pixel 公式），按 `orientation` 换算后经 `plane` 映射三维；三模式（`groupBy` 分组分层 / `layers>1` 多层堆叠 / 单层），与 `circular` 结构对齐 |
| `src/graph/layouts/grid.ts` | `grid: LayoutFn<GridLayoutConfig>` 纯函数：行/列/层三维网格 `col→x`、`row→z`、`level→y`，居中于原点；`rows`/`cols`/`levels` 缺省自动推算（`cols=ceil(√(n/levels))`、`rows=ceil(n/(cols·levels))`）。本质 3D（`plane`/`depthOffset`/`layerSpacing` 为 no-op） |
| `src/graph/layouts/index.ts` | barrel 增导出 `hex`/`grid` + 配置类型；`Layouts` 命名空间增 `{ hex, grid }` |
| `docs/components/graph/demo.ts` | demo 升第四步：布局下拉增「六边形蜂巢 / 蜂巢多层堆叠 / 网格地面 / 三维网格(levels)」、新增「层数」滑杆（蜂巢 layers 与网格 levels 共用）、`pureFunctionCheck` 泛化为 `checkLayout(fn, cfg, label)` 对 hex/grid 亦做纯函数独立性自检 |
| `docs/components/graph/index.html` | 文案升第四步、布局参数表补 `hex`/`grid` 行、示例补 `Layouts.hex`/`Layouts.grid`（applyLayout + 独立调用） |

### 关键 API（Step 4 新增）

```ts
import { Graph3D, Layouts } from '@cyc/3d-components/graph';

// 布局纯函数（可独立调用，零 three 依赖）
Layouts.hex(nodes, { radius: 1.3, plane: 'xz' });                 // 单层平顶蜂巢
Layouts.hex(nodes, { radius: 1.3, layers: 3, layerSpacing: 2.4 }); // 多层堆叠
Layouts.hex(nodes, { radius: 1.3, orientation: 'pointy' });        // 尖顶
Layouts.grid(nodes, { spacingX: 1.2, spacingZ: 1.2 });             // 地面网格（自动推算行列）
Layouts.grid(nodes, { levels: 3, spacingX: 1.2, spacingY: 2.4, spacingZ: 1.2 }); // 三维网格

// 经主组件应用（可选 gsap 过渡动画）
graph.applyLayout(Layouts.hex, { radius: 1.3, plane: 'xz' });
graph.applyLayout(Layouts.grid, { levels: 3, spacingY: 2.4 });
```

### 验证方式（Step 4 完成判定）

1. `npx tsc --noEmit` 通过；`npm run build` 产出含 `Layouts`（含 `hex`/`grid`）/`hex`/`grid`/`HexLayoutConfig`/`GridLayoutConfig` 导出的 `.d.ts`。
2. `npm run docs:serve` 打开 `#graph`：布局下拉切换到「六边形蜂巢」→ 节点经 gsap 平滑过渡铺成**紧凑蜂巢**（中心 + 逐环，无空洞）；「蜂巢多层堆叠」→ 按「层数」滑杆在 y 轴叠出多层蜂巢切片；「网格地面」→ 规则行列网格（单层 y=0）；「三维网格」→ 按「层数」滑杆堆叠多层。边端点跟随更新；坐标读数条显示有限数值（无 `NaN`/`Infinity`）。
3. 纯函数独立性自检：切换到蜂巢/网格时控制台输出 `Layouts.hex`/`Layouts.grid 纯函数自检：✓ 全部有限`（绕过 `Graph3D` 直接调用）。
4. 切换布局后 hover/select/邻接高亮仍正常；动画中点「重新生成」无控制台报错；反复切换 + 重建，DevTools Memory 几何/材质计数不增长。

### Step 4 决策备注（2026-07-13）

- **蜂巢用轴向螺旋而非矩形分桶**：从中心 `(0,0)` 起逐环扩展（第 k 环 `6k` 格，总 `1+3k(k+1)`），保证任意节点数下蜂巢**紧凑无空洞**、视觉对称；矩形分桶会在边界留下参差。环生成移植 RedBlobGames `cube_ring` 的轴向版（起点 = 中心 + `radius·dir[4]`，绕 6 边各走 `radius` 步）。
- **`orientation` 只切像素换算、不切轴向方向**：轴向邻居方向 `{(+1,0),(+1,-1),(0,-1),(-1,0),(-1,+1),(0,+1)}` 与 orientation 无关 —— 同一组轴向坐标，平顶（`x=1.5·q`、`y=√3/2·q+√3·r`）与尖顶（`x=√3·q+√3/2·r`、`y=1.5·r`）只差整体旋转 30°，故螺旋逻辑无需分支。默认 `'flat'`（自然蜂巢形态）。
- **蜂巢分层与 circular 对齐**：`groupBy` 命中 → 每组一个深度层（组内各铺一张蜂巢）；否则 `layers>1` 按 index 轮询分入多层，每层一张蜂巢切片，在被忽略轴以 `layerSpacing` 分层。故蜂巢本质为「2D 切片 + 深度分层」，复用 `mapToPlane2D`/`resolveDepth`。
- **网格本质 3D、不走 plane 映射**：DESIGN 明定「直接输出三维网格坐标」，故 `col→x`、`row→z`、`level→y` 直给，`plane`/`depthOffset`/`layerSpacing` 为 no-op（与 `force dimensions:3` 一致）；间距交由 `spacingX/Y/Z` 精细控制。居中偏移使网格几何中心落在原点（各方向首末关于 0 对称）。
- **网格行列自动推算**：`cols` 缺省取 `ceil(√(n/levels))`（每层接近正方形），`rows` 缺省取 `ceil(n/(cols·levels))`；节点超出容量时 `level` 继续递增向上溢出，坐标仍有限。用户可显式给 `cols`/`rows`/`levels` 精确控制。
- **`checkLayout` 泛化**：原 `pureFunctionCheck` 仅 force；Step 4 泛化为 `checkLayout<C>(fn, cfg, label)` —— 自动注入当前图边（force 用、hex/grid 忽略），对任意布局断言「全部输出有限」，落实「可独立调用」对扩展布局同样成立。
- **封装 utils 暴露**：`hex`/`grid` 与 `circular`/`force` 并列进 `Layouts` 命名空间 + 命名导出 + 配置类型，调用示例见 demo 与 `index.html`（applyLayout 应用 + 绕过组件独立调用两条路径）。

---

## 3.4 Step 5 已实现内容（文件清单）

| 文件 | 内容 |
|---|---|
| `src/graph/layouts/barnesHut.ts` | 内部 Barnes-Hut 3D 八叉树（octree）：`barnesHutRepulsion(px,py,pz,n,charge,theta,fx,fy,fz)` —— 包围立方体建根、逐点 `insert`（空叶放入 / 单质点叶细分 / 深度封顶转聚合叶）、`repulsionFrom` 开角遍历（`size²<θ²·d²` 聚合为质心处 `count` 质点）。零 three 依赖、不导出 barrel |
| `src/graph/layouts/force.ts` | 斥力分支：`barnesHut:true`（仅 `dimensions:3`）走八叉树近似，否则精确成对；未开 BH 且 `n>600` 仍减半迭代 + warn（建议改开 BH） |
| `src/graph/layouts/types.ts` | `ForceLayoutConfig` 增 `barnesHut`/`theta`；新增判别联合 `LayoutPreset`（`{type, config?}`，type∈circular/force/hex/grid）+ `LayoutType` |
| `src/graph/layouts/index.ts` | 新增 `resolveLayoutPreset(preset)`（预设 → `{layout, config}`）+ 内部 `LAYOUT_REGISTRY`；barrel 导出 `LayoutType`/`LayoutPreset`/`resolveLayoutPreset` |
| `src/graph/Graph3D.ts` | `Graph3DOptions.layout?: LayoutPreset`；`setLayout(preset, options?)` 记忆预设并应用、`getLayout()` 读取；`setData` 末尾自动 `applyLayoutPreset`（瞬移到正式布局）；`applyLayoutPreset` 内部经 `resolveLayoutPreset` 转交 `applyLayout` |
| `src/graph/index.ts` | 经 `export * from './layouts'` 透出 `LayoutType`/`LayoutPreset`/`resolveLayoutPreset` |
| `docs/components/graph/demo.ts` | demo 升第五步：布局切换改走 `setLayout(preset)`（声明式、被记忆）；`rebuild` 不再手动重应用（依赖 `setData` 自动编排）；新增 Barnes-Hut 复选框 + 力导向耗时读数条；节点数上限 60→2000；`presetFor(kind)` 统一构造预设 |
| `docs/components/graph/index.html` | 文案升第五步（最终步）；参数表增 `layout`、方法表增 `setLayout`/`getLayout`；布局表 force 行补 `barnesHut`/`theta`；新增「声明式布局 · LayoutPreset」章节；示例改声明式构造 + Barnes-Hut |
| TypeDoc | `typedoc.json` 已配 `entryPoints: src/index.ts`（expand）—— `npm run docs` 自动覆盖 graph 模块全部 API（Graph3D/PickController/Layouts/类型） |

### 关键 API（Step 5 新增）

```ts
import { Graph3D, type LayoutPreset } from '@cyc/3d-components/graph';

// 声明式：构造时指定，setData 自动应用并记忆
const graph = new Graph3D({
  layout: { type: 'force', config: { iterations: 300, barnesHut: true } }, // 大图加速
});
graph.setData(data); // 自动跑力导向，无需 applyLayout

// 运行时切换（被记忆，后续 setData 自动重应用）
graph.setLayout({ type: 'hex', config: { radius: 1.3, layers: 3 } });
graph.setLayout(null); // 清除（退回占位散布）
graph.getLayout();     // 读当前预设

// Barnes-Hut（纯函数独立调用，零 three 依赖）
Layouts.force(nodes, { edges, iterations: 300, barnesHut: true, theta: 0.9 });
```

### 验证方式（Step 5 完成判定）

1. `npx tsc --noEmit` 通过；`npm run build` 产出含 `setLayout`/`getLayout`/`LayoutPreset`/`LayoutType`/`resolveLayoutPreset`/`barnesHut`/`theta` 导出的 `.d.ts`。
2. `npm run docs` 生成 `docs/api/`，graph 模块（Graph3D / PickController / Layouts / 各配置类型）完整出现。
3. `npm run docs:serve` 打开 `#graph`：布局下拉切换任意布局 → 经 `setLayout` 声明式应用、被记忆；点「重新生成」后**自动重应用**当前布局（无需手动 apply，Step 5 核心）；勾「Barnes-Hut」后力导向切到大节点数（最高 2000），「力导向计算耗时」条显示开/关耗时差；坐标读数条全部有限（无 `NaN`/`Infinity`）。
4. 纯函数 + Barnes-Hut 自检：`θ=0.1` 时 BH 与精确逐节点位移**完全一致**（max 相对误差 0，验证八叉树 θ→0 收敛到精确）；`θ=0.9` 时近似粗糙但全有限、同量级不发散；`n=2000` BH 全有限。scaling 实测：n=3200 BH 比精确快 ~2.4×（`O(n log n)` 渐近正确）。
5. 切换布局 / 重建 / 动画中重建 / 大图无控制台报错；DevTools Memory 几何/材质计数不增长（gsap tween 在 setData/dispose 前 kill）。

### Step 5 决策备注（2026-07-14）

- **性能优化范围**：经确认采「统一配置 + Barnes-Hut + 文档」方案 —— 自包含算法提速（force 斥力 `O(n²)→O(n log n)`），保留每元素 clone 材质渲染（&lt;500 节点首选）。**InstancedMesh2 渲染路径暂缓**（重做元素层、与每元素材质并行），作「预留切换点」文档化于本节末。Barnes-Hut 不碰渲染层，零回归风险。
- **Barnes-Hut 实现**：自建八叉树（Barnes & Hut 1986 思路），不引包。`barnesHutRepulsion` 与 force.ts 的精确成对分支**同接口**（写同一 `fx/fy/fz` 缓冲），故 force 内仅一处 `if (useBH)` 分支切换，零侵入。**仅 `dimensions:3` 生效** —— 平面点云八叉树退化为低效（2D 回退精确成对）。
- **八叉树正确性验证方法**：力导向对微力敏感、多次迭代后收敛到**不同有效平衡态**（BH 近似引入的微力差被混沌放大），故不能用「迭代后位移和」判近似质量。正确判据是「**单步、θ→0 时 BH 与精确逐节点位移一致**」：实测 `θ=0.1` 对 4 点 max 相对误差 = 0（完全一致），证明八叉树聚合/开角逻辑正确。`θ=0.9` 是精度/速度权衡默认（d3-force 亦常用 0.9 附近）。
- **声明式 vs 命令式并存**：`setLayout`/`Graph3DOptions.layout`（声明式、记忆、setData 自动编排）与 `applyLayout`（命令式、一次性、不记忆）**互补不替换**。声明式适合「布局随数据变化自动重排」（如实时更新图）；命令式适合「一次性手动驱动」（如动画演示切换）。`setLayout(null)` 清除记忆退回占位。
- **`setData` 自动编排的动画语义**：构造时/`setLayout` 主动切换 → 带 gsap 过渡动画；`setData` 内部自动重应用 → **瞬移**（`animate:false`）—— 因 setData 已清空重建元素，从占位环形 lerp 到正式布局的「飞行」无意义且易与重建竞态。这与 Step 3「动画中 setData 需 killLayoutTween」一致。
- **`LayoutPreset` 判别联合**：`type` 字段决定 `config` 具体类型（TS 判别联合），调用点 `setLayout({ type: 'hex', config: {...} })` 即获 hex 配置的类型补全/校验，避免传错配置。`resolveLayoutPreset` 内部按 `type` 查 `LAYOUT_REGISTRY` 取函数，外部调用者无需关心函数引用。
- **TypeDoc 零额外配置**：`typedoc.json` 的 `entryPoints: src/index.ts` + `entryPointStrategy: expand` 已覆盖 `export * from './graph'`，故 graph 全部 API 自动入档；本步仅需确认 JSDoc 详尽（`@example`/`@default`/`@param` 已在 Step 1-4 落实）。
- **大规模渲染预留切换点（未做）**：当前每节点 clone 独立 `MeshStandardMaterial`（&lt;500 首选）。&gt;1000 节点的渲染侧扩展路径（预留，未实现）：① `InstancedMesh2` + per-instance color（GPU 合并 draw call，BVH 射线拾取，需重做 Node3D 元素层）；② frustum/occlusion culling（`InstancedMesh2` 已内置）。布局侧 Barnes-Hut 已就绪，渲染侧留待真实大规模需求触发。

---

## 4. 后续演进预案（Step 5 之后）

- **节点 label**：`Node3D.label` 槽位以 `core/Html`（2D 投影 / CSS3D transform）或 `core/BitmapText`（SDF，CJK 支持）填充；接入 Html 后 `Graph3D.update(delta, camera?, renderer?)` 需透传 camera/renderer 给 Html 的每帧投影。
- **树/层次布局**：自研 Compact Box / Dendrogram（参考 @antv/hierarchy 思路，不引包），支持 2D 平面映射与 3D 分层（层级在 Y 轴不同高度，同层在 XZ 展开）。签名沿用 `(nodes, config) => NodePos3D[]`，并入 `Layouts` 命名空间。
- **大规模渲染**：见 Step 5 决策备注「预留切换点」—— `InstancedMesh2` + per-instance color 路径，&gt;1000 节点真实需求触发时实现。
- **力导向增量/异步**：当前 force 是同步阻塞迭代；超大图可考虑 Web Worker 异步或增量迭代（每帧若干步，配合 `applyPositions` 渐进）。
- **Barnes-Hut 2D**：当前仅 3D；若 2D 力导向大图需求出现，可加四叉树（quadtree）版本。

---

## 5. 持久化与会话恢复约定

1. 本方案文档为 `docs/graph/DESIGN.md`。
2. 记忆系统已写入 `project-graph3d.md` 指针（`MEMORY.md` 已登记）。
3. 新会话恢复方式：把本文件内容作为初始 prompt 粘贴，并说明"本次做第 N 步"；先确认理解已有结论，再推进，不重复讨论已定决策。
4. 上下文接近上限时主动提醒，并整理"已确认结论摘要"供保存。
