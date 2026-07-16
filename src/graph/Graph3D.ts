/**
 * @module graph/Graph3D
 *
 * Graph3D —— 3D 图可视化主组件。
 *
 * 继承 {@link BaseGroup}（`THREE.Group` + `IUpdatable` + `IDisposable`），
 * 编排 Data / Layout / Element / Interaction 四层（第一步仅含 Data + Element 骨架）。
 *
 * 设计理念参考 AntV G6：图数据结构（Node/Edge）+ 元素 + 布局 + 交互分层解耦，
 * 渲染引擎基于 Three.js。
 *
 * **第一步能力：**
 * - `setData(data)`：校验/归一化数据，生成球体节点 + 直线段边。
 * - 初始坐标：采用节点 `data.x/y/z`；未指定则在原点环形散布（占位布局，
 *   第三步将被正式布局算法替换）。
 * - `getNodes()` / `getEdges()`：访问元素实例，便于外部追加交互。
 * - `update(delta)`：转发给子元素（Html 标签等需每帧更新的载体）。
 * - `dispose()`：释放全部子元素资源。
 *
 * 后续步骤增量扩展：
 * - 第二步：节点/边多形态、`PickController` 交互、自定义反馈回调。✅
 * - 第三步：`applyLayout()` 接入布局算法（环形 3D 化、3D 力导向）并刷新坐标。✅
 * - 第四步：扩展布局（六边形蜂巢、网格）。✅
 * - 第五步：**统一声明式布局 API**（`Graph3DOptions.layout` / `setLayout` / `getLayout`，
 *   `setData` 自动编排）+ Barnes-Hut 大图加速 + TypeDoc 文档。✅
 */

import * as THREE from 'three';
import gsap from 'gsap';
import { BaseGroup } from '../core/BaseGroup';
import type { BaseGroupOptions } from '../core/BaseGroup';
import { prepare, type GraphIndex } from './adapter';
import { Edge3D } from './elements/Edge3D';
import { Node3D } from './elements/Node3D';
import { resolveLayoutPreset } from './layouts';
import type { BaseLayoutConfig, LayoutFn, LayoutPreset } from './layouts/types';
import type { GraphData, NodeData, NodeId, NodePos3D } from './types';

/**
 * {@link Graph3D} 构造参数。
 *
 * @example
 * ```ts
 * const graph = new Graph3D({
 *   data: { nodes: [...], edges: [...] },
 *   nodeSize: 0.4,
 *   nodeMaterial: new THREE.MeshStandardMaterial({ color: 0x4a90e2 }),
 * });
 * scene.add(graph);
 * ```
 */
export interface Graph3DOptions extends BaseGroupOptions {
  /**
   * 初始图数据。若提供，构造后立即 {@link Graph3D.setData}。
   */
  data?: GraphData;
  /**
   * 节点默认尺寸（球体半径）。当节点自身未指定 `size` 时使用。
   * @default 0.3
   */
  nodeSize?: number;
  /**
   * 节点材质**模板**。每个节点构造时 `clone()` 一份独立实例，故各节点状态变更
   * （改色/高亮等）互不影响；不传则用内置默认 `MeshStandardMaterial` 作模板。
   * 第三步起推荐传入 `ShinyMaterial` 作模板。模板本身不被 `dispose()` 释放。
   */
  nodeMaterial?: THREE.MeshStandardMaterial;
  /**
   * 节点几何体**工厂**（可选）。传入则每个节点用其返回值替代默认球体，
   * 可实现自定义节点形状（如六边形瓦片）。工厂接收节点尺寸 `size`，须返回
   * **新建**的 `BufferGeometry`（节点自行释放）。`setData` 重建后仍应用 ——
   * 即「重新生成」数据后形状不丢。运行时用 {@link Graph3D.setNodeGeometry} 切换。
   */
  nodeGeometry?: (size: number) => THREE.BufferGeometry;
  /**
   * 边材质**模板**（`LineBasicMaterial`）。每条边构造时 `clone()` 一份独立实例，
   * 故各边状态变更互不影响；不传则用内置默认值作模板。模板本身不被释放。
   */
  edgeMaterial?: THREE.LineBasicMaterial;
  /**
   * 边形态。
   * - `'line'`（默认）：`LineSegments` 直线段。
   * - `'path'`：复用 `core/Path` 的圆管（可选箭头）。
   *
   * 注：单条边可在 `EdgeData.type` 上覆盖此全局默认（见 {@link Graph3D.setData}）。
   * @default 'line'
   */
  edgeType?: 'line' | 'path';
  /**
   * `'path'` 形态边的管道半径。 @default 0.05
   */
  edgePathRadius?: number;
  /**
   * `'path'` 形态边是否在末端生成箭头（有向边）。 @default false
   */
  edgeArrow?: boolean;
  /**
   * 占位环形散布的半径（仅当节点无显式坐标时使用）。
   * @default 3
   */
  initialRadius?: number;
  /**
   * 声明式布局预设（Step 5）。若提供，每次 {@link Graph3D.setData} 后自动应用该布局
   * （无需手动 `applyLayout`），构造时也会立即应用一次。
   *
   * 与命令式 {@link Graph3D.applyLayout} 的区别：`layout` 被**记忆**，`setData` 重建后自动重应用；
   * `applyLayout` 是一次性、不记忆。运行时可用 {@link Graph3D.setLayout} 切换预设，
   * 用 {@link Graph3D.getLayout} 读取当前预设。
   *
   * @example
   * ```ts
   * const graph = new Graph3D({ layout: { type: 'force', config: { iterations: 300 } } });
   * // setData 后自动跑力导向，无需再 applyLayout
   * ```
   */
  layout?: LayoutPreset;
}

/**
 * {@link Graph3D.applyLayout} / {@link Graph3D.applyPositions} 的过渡选项。
 */
export interface LayoutApplyOptions {
  /**
   * 是否启用 gsap 过渡动画。关闭则瞬移到目标坐标。
   * @default false
   */
  animate?: boolean;
  /**
   * 动画时长（秒）。
   * @default 0.6
   */
  duration?: number;
  /**
   * 动画/置位完成回调。
   */
  onComplete?: () => void;
}

/**
 * Graph3D —— 3D 图可视化主组件。
 *
 * @example
 * ```ts
 * import { Graph3D } from '@cyc/3d-components/graph';
 *
 * const graph = new Graph3D();
 * graph.setData({
 *   nodes: [{ id: 'n1' }, { id: 'n2' }],
 *   edges: [{ source: 'n1', target: 'n2' }],
 * });
 * scene.add(graph);
 * ```
 *
 * @extends BaseGroup
 */
export class Graph3D extends BaseGroup {
  /** 节点元素列表（id → Node3D）。 */
  private readonly nodes = new Map<NodeId, Node3D>();
  /** 边元素列表。 */
  private readonly edges: Edge3D[] = [];
  /** 边 id → Edge3D（便捷回查，供交互层 getEdge 用）。 */
  private readonly edgeById = new Map<NodeId, Edge3D>();
  /** 节点 id 顺序（与构造顺序一致，供环形散布等遍历）。 */
  private readonly nodeOrder: NodeId[] = [];
  /** 当前规范化后的图数据。 */
  private graphData: GraphData | null = null;
  /** 数据索引（邻接表等）。 */
  private graphIndex: GraphIndex | null = null;

  /** 节点默认尺寸。 */
  private readonly nodeSize: number;
  /** 节点材质模板（各节点 clone 自它）。 */
  private readonly nodeMaterial?: THREE.MeshStandardMaterial;
  /** 节点几何工厂（可选；各节点构造/重建时调用）。运行时 setNodeGeometry 可改。 */
  private nodeGeometry?: (size: number) => THREE.BufferGeometry;
  /** 边材质模板（各边 clone 自它）。 */
  private readonly edgeMaterial?: THREE.LineBasicMaterial;
  /** 占位环形散布半径。 */
  private readonly initialRadius: number;
  /** 边形态默认（可被单边 EdgeData.type 覆盖）。 */
  private readonly edgeType: 'line' | 'path';
  /** 'path' 形态管道半径。 */
  private readonly edgePathRadius: number;
  /** 'path' 形态是否带箭头。 */
  private readonly edgeArrow: boolean;
  /** 当前布局过渡动画的进度代理 `{ t: 0→1 }`；无动画时为 null。 */
  private layoutProxy: { t: number } | null = null;
  /**
   * 当前声明的布局预设（Step 5）。`setData` 后自动重应用；`setLayout` 写入。
   * `null` 表示未声明布局（用占位环形散布）。
   */
  private layoutPreset: LayoutPreset | null = null;

  /**
   * @param options - 配置对象，见 {@link Graph3DOptions}。
   */
  constructor(options: Graph3DOptions = {}) {
    super({
      name: options.name ?? 'graph3d',
      visible: options.visible,
      userData: options.userData,
      children: options.children,
      scale: options.scale,
    });

    this.nodeSize = options.nodeSize ?? 0.3;
    this.nodeMaterial = options.nodeMaterial;
    this.nodeGeometry = options.nodeGeometry;
    this.edgeMaterial = options.edgeMaterial;
    this.initialRadius = options.initialRadius ?? 3;
    this.edgeType = options.edgeType ?? 'line';
    this.edgePathRadius = options.edgePathRadius ?? 0.05;
    this.edgeArrow = options.edgeArrow ?? false;
    this.layoutPreset = options.layout ?? null;

    if (options.data) {
      this.setData(options.data);
    }
  }

  /**
   * 载入并渲染图数据。
   *
   * 流程：`prepare`（校验 + 归一化 + 建索引）→ 释放旧元素 → 生成节点
   * （初始坐标取 `data.x/y/z`，否则环形散布）→ 生成边 → add 到自身。
   *
   * @param data - 图数据。
   * @throws 校验失败时抛出（见 {@link prepare}）。
   */
  setData(data: GraphData): void {
    // 0. 终止进行中的布局过渡动画，避免 onUpdate 操作即将被 clearElements 释放的元素。
    this.killLayoutTween();

    // 1. 校验 + 归一化 + 建索引
    const { data: norm, index } = prepare(data);
    this.graphData = norm;
    this.graphIndex = index;

    // 2. 清空旧元素
    this.clearElements();

    // 3. 生成节点（含初始坐标）
    const positions = this.computeInitialPositions(norm.nodes);
    for (const nodeData of norm.nodes) {
      const node = new Node3D({
        data: nodeData,
        defaultSize: this.nodeSize,
        material: this.nodeMaterial,
        geometryFactory: this.nodeGeometry,
      });
      node.setPosition(positions.get(nodeData.id)!);
      this.nodes.set(nodeData.id, node);
      this.nodeOrder.push(nodeData.id);
      this.add(node);
    }

    // 4. 生成边（type 取单边 EdgeData.type，缺省回退全局 edgeType）
    for (const edgeData of norm.edges) {
      const srcPos = positions.get(edgeData.source);
      const tgtPos = positions.get(edgeData.target);
      if (!srcPos || !tgtPos) continue;
      const edgeType = edgeData.type ?? this.edgeType;
      const edge = new Edge3D({
        id: edgeData.id,
        source: srcPos,
        target: tgtPos,
        type: edgeType,
        pathRadius: this.edgePathRadius,
        arrow: this.edgeArrow,
        material: this.edgeMaterial,
      });
      this.edges.push(edge);
      this.edgeById.set(edge.edgeId, edge);
      this.add(edge);
    }

    // 5. 自动编排声明的布局（Step 5）：若声明了 layoutPreset，生成完元素后立即应用，
    //    使 setData 后即呈现正式布局（无需调用者手动 applyLayout）。
    if (this.layoutPreset) {
      this.applyLayoutPreset(this.layoutPreset, false);
    }
  }

  /**
   * 计算节点初始坐标：优先用 `data.x/y/z`，未指定的节点在原点环形散布。
   *
   * 注：此为占位布局，第三步起可被 {@link Graph3D.applyLayout} 覆盖。
   *
   * @param nodes - 节点数据列表。
   * @returns id → 三维坐标。
   */
  private computeInitialPositions(nodes: NodeData[]): Map<NodeId, NodePos3D> {
    const positions = new Map<NodeId, NodePos3D>();
    const auto = nodes.filter((n) => n.x === undefined && n.y === undefined && n.z === undefined);
    const n = auto.length;
    for (let i = 0; i < n; i++) {
      const theta = (i / Math.max(n, 1)) * Math.PI * 2;
      positions.set(auto[i].id, {
        id: auto[i].id,
        x: Math.cos(theta) * this.initialRadius,
        y: 0,
        z: Math.sin(theta) * this.initialRadius,
      });
    }
    // 有显式坐标的节点
    for (const node of nodes) {
      if (positions.has(node.id)) continue;
      positions.set(node.id, {
        id: node.id,
        x: node.x ?? 0,
        y: node.y ?? 0,
        z: node.z ?? 0,
      });
    }
    return positions;
  }

  /**
   * 应用一次布局算法，刷新全部节点坐标与边端点（可选 gsap 过渡动画）。
   *
   * **一次性应用**（非持久化）：不记忆布局配置；`setData` 重建后需重新调用。
   * 声明式持久化见 Step 5 的 {@link Graph3D.setLayout} / {@link Graph3DOptions.layout} ——
   * `setData` 后自动重应用，无需手动 `applyLayout`。
   *
   * **自动注入边**：若 `config` 未显式提供 `edges`，会用当前 `graphData.edges` 填充
   * （克隆 config，不改调用者对象；调用者显式 `edges` 优先），故 `graph.applyLayout(force)`
   * 无需手动传边即可跑力导向。
   *
   * 不会触碰选中/悬停状态（PickController 以 id 管理状态，坐标变化不影响选中）。
   *
   * @typeParam C - 布局配置类型（由 `layout` 函数推断，保调用点类型推断）。
   * @param layout - 布局函数（如 `Layouts.circular` / `Layouts.force`）。
   * @param config - 布局配置。
   * @param options - 过渡选项。
   *
   * @example
   * ```ts
   * import { Graph3D, Layouts } from '@cyc/3d-components/graph';
   * // 环形（地面 xz 平面）
   * graph.applyLayout(Layouts.circular, { radius: 4, plane: 'xz' });
   * // 3D 力导向（带过渡动画）
   * graph.applyLayout(Layouts.force, { iterations: 300 }, { animate: true, duration: 0.8 });
   * ```
   */
  applyLayout<C extends BaseLayoutConfig>(
    layout: LayoutFn<C>,
    config?: C,
    options?: LayoutApplyOptions,
  ): void {
    if (!this.graphData || this.nodes.size === 0) return;
    // 克隆 config 并自动注入当前图的边（调用者显式 edges 优先）。
    const explicitEdges = (
      config as { edges?: Array<{ source: NodeId; target: NodeId }> } | undefined
    )?.edges;
    const edges =
      explicitEdges ??
      this.graphData.edges.map((e) => ({ source: e.source, target: e.target }));
    const cfg = { ...config, edges } as unknown as C;
    const positions = layout(this.graphData.nodes, cfg);
    this.applyPositions(positions, options);
  }

  /**
   * 直接应用一组三维坐标到节点，并刷新边端点（可选过渡动画）。
   *
   * 与 {@link Graph3D.applyLayout} 的区别：跳过布局计算，直接置位 ——
   * 适用于外部/自定义算法产出的坐标。坐标按 **id** 匹配节点（非 index，因部分布局会重排）；
   * 未命中的节点保持原位。
   *
   * @param positions - 目标坐标数组。
   * @param options - 过渡选项（见 {@link LayoutApplyOptions}）。
   */
  applyPositions(positions: NodePos3D[], options?: LayoutApplyOptions): void {
    if (this.nodes.size === 0) return;
    const target = new Map<NodeId, NodePos3D>();
    for (const p of positions) target.set(p.id, p);

    // 非动画：直接置位 + 全量同步边（含 path 重建）。
    if (!options?.animate) {
      for (const node of this.nodes.values()) {
        const t = target.get(node.nodeId);
        if (t) node.setPosition(t);
      }
      this.syncEdges(true);
      options?.onComplete?.();
      return;
    }

    // 动画：gsap 代理 t:0→1，逐帧 lerp 起止位 + 同步 line 边（path 边节流到完成帧）。
    this.killLayoutTween();
    const startMap = new Map<NodeId, THREE.Vector3>();
    const targetMap = new Map<NodeId, THREE.Vector3>();
    for (const node of this.nodes.values()) {
      startMap.set(node.nodeId, node.position.clone());
      const t = target.get(node.nodeId);
      if (t) targetMap.set(node.nodeId, new THREE.Vector3(t.x, t.y, t.z));
    }
    const scratch = new THREE.Vector3();
    this.layoutProxy = { t: 0 };
    const proxy = this.layoutProxy;
    const duration = options?.duration ?? 0.6;
    gsap.to(proxy, {
      t: 1,
      duration,
      ease: 'power2.inOut',
      onUpdate: () => {
        for (const node of this.nodes.values()) {
          const src = startMap.get(node.nodeId);
          const tgt = targetMap.get(node.nodeId);
          if (!src || !tgt) continue;
          scratch.lerpVectors(src, tgt, proxy.t);
          node.setPosition(scratch);
        }
        this.syncEdges(false);
      },
      onComplete: () => {
        this.syncEdges(true);
        if (this.layoutProxy === proxy) this.layoutProxy = null;
        options?.onComplete?.();
      },
    });
  }

  /**
   * 切换声明的布局预设（Step 5），并立即应用一次。
   *
   * 与 {@link Graph3D.applyLayout} 的区别：`setLayout` **记忆**该预设，后续 {@link setData}
   * 会自动重应用；`applyLayout` 是一次性。`preset` 传 `null` 清除当前布局（退回占位散布）。
   *
   * @param preset - 声明式布局预设（`null` 清除）。
   * @param options - 过渡选项（缺省启用 `animate: true, duration: 0.7`）。
   *
   * @example
   * ```ts
   * graph.setLayout({ type: 'hex', config: { radius: 1.3, layers: 3 } });
   * // 后续 setData 会自动重应用此蜂巢布局。
   * ```
   */
  setLayout(preset: LayoutPreset | null, options?: LayoutApplyOptions): void {
    this.layoutPreset = preset;
    if (preset && this.nodes.size > 0) {
      this.applyLayoutPreset(preset, true, options);
    }
  }

  /**
   * 读取当前声明的布局预设（Step 5）。未声明返回 `null`。
   */
  getLayout(): LayoutPreset | null {
    return this.layoutPreset;
  }

  /**
   * 运行时切换节点几何工厂，并就地重建所有现存节点的几何（坐标/材质不变）。
   *
   * 传 `null` 回退默认球体。工厂会被**记忆**：后续 `setData` 重建的节点同样套用
   * （故「重新生成」数据后自定义形状不丢）。旧几何体由各节点自行释放。
   *
   * @param factory - 几何工厂（接收节点尺寸），或 `null` 回退球体。
   */
  setNodeGeometry(factory: ((size: number) => THREE.BufferGeometry) | null): void {
    this.nodeGeometry = factory ?? undefined;
    for (const node of this.nodes.values()) {
      node.setGeometryFactory(factory);
    }
  }

  /**
   * 应用一个布局预设（内部）：解析预设 → `applyLayout`。
   *
   * @param preset - 声明式布局预设。
   * @param animate - 是否启用过渡动画（`setData` 自动编排时不动画，瞬移到正式布局；
   * `setLayout` 主动切换时动画）。
   * @param options - 调用者显式过渡选项（覆盖默认）。
   */
  private applyLayoutPreset(
    preset: LayoutPreset,
    animate: boolean,
    options?: LayoutApplyOptions,
  ): void {
    const resolved = resolveLayoutPreset(preset);
    if (!resolved) return;
    const opts: LayoutApplyOptions = options ?? {
      animate,
      duration: animate ? 0.7 : 0,
    };
    this.applyLayout(resolved.layout as LayoutFn<BaseLayoutConfig>, resolved.config, opts);
  }

  /**
   * 取所有节点元素实例。
   * @returns Node3D 数组（按构造顺序）。
   */
  getNodes(): Node3D[] {
    return this.nodeOrder.map((id) => this.nodes.get(id)!).filter(Boolean);
  }

  /**
   * 按 id 取节点元素实例。
   * @param id - 节点 id。
   */
  getNode(id: NodeId): Node3D | undefined {
    return this.nodes.get(id);
  }

  /**
   * 取所有边元素实例。
   */
  getEdges(): Edge3D[] {
    return this.edges.slice();
  }

  /**
   * 按边 id 取边元素实例。
   * @param id - 边 id（未提供时适配层自动生成 `${source}->${target}`）。
   */
  getEdge(id: NodeId): Edge3D | undefined {
    return this.edgeById.get(id);
  }

  /**
   * 取当前规范化后的图数据（含补全字段）。`setData` 前为 `null`。
   */
  getData(): GraphData | null {
    return this.graphData;
  }

  /**
   * 取数据索引（邻接表等）。`setData` 前为 `null`。
   */
  getIndex(): GraphIndex | null {
    return this.graphIndex;
  }

  /**
   * 每帧由渲染循环调用（需在 `startLoop` 的 `tick` 中调用 `graph.update(dt)`）。
   * 转发给子元素（如后续的 Html 标签需每帧投影）。
   *
   * @param delta - 距上一帧的秒数（已封顶 100ms）。
   */
  update(delta: number): void {
    for (const node of this.nodes.values()) {
      node.update(delta);
    }
    for (const edge of this.edges) {
      edge.update(delta);
    }
  }

  /**
   * 释放全部节点/边元素资源，并清空内部索引。
   * 覆盖 {@link BaseGroup.dispose}，先释放子元素再走父类清理。
   */
  dispose(): void {
    this.killLayoutTween();
    this.clearElements();
    this.graphData = null;
    this.graphIndex = null;
    super.dispose();
  }

  /**
   * 释放并清空当前所有节点/边元素（不释放共享材质，共享材质由外部所有者管理）。
   */
  private clearElements(): void {
    for (const node of this.nodes.values()) {
      node.dispose();
      this.remove(node);
    }
    this.nodes.clear();

    for (const edge of this.edges) {
      edge.dispose();
      this.remove(edge);
    }
    this.edges.length = 0;
    this.edgeById.clear();
    this.nodeOrder.length = 0;
  }

  /**
   * 把所有边的端点刷新为当前节点坐标。布局变化或动画每帧调用。
   *
   * - `'line'` 边：每次调用都原地写顶点（近零成本），动画每帧同步。
   * - `'path'` 边：仅当 `updatePath` 为真时重建 Tube 几何 —— 动画进行中传 `false`
   *   跳过（避免每帧重建 `TubeGeometry` 的 GC 压力），完成帧传 `true` 终态对齐。
   *
   * @param updatePath - 是否重建 path 形态边几何。
   */
  private syncEdges(updatePath: boolean): void {
    for (const edge of this.edges) {
      if (edge.type === 'path' && !updatePath) continue;
      const s = this.nodes.get(edge.sourceId);
      const t = this.nodes.get(edge.targetId);
      if (!s || !t) continue;
      edge.updateEnds(
        { id: edge.sourceId, x: s.position.x, y: s.position.y, z: s.position.z },
        { id: edge.targetId, x: t.position.x, y: t.position.y, z: t.position.z },
      );
    }
  }

  /**
   * 杀死进行中的布局过渡动画（若有）。
   *
   * 在 {@link setData}（`clearElements` 前）与 {@link dispose}（`super.dispose` 前）调用，
   * 避免动画 `onUpdate` 操作已释放的节点/边几何导致运行时错误。
   */
  private killLayoutTween(): void {
    if (this.layoutProxy) {
      gsap.killTweensOf(this.layoutProxy);
      this.layoutProxy = null;
    }
  }
}
