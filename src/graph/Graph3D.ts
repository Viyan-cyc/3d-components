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
 * - 第二步：节点/边多形态、`PickController` 交互、自定义反馈回调。
 * - 第三步：`setLayout()` 接入布局算法并刷新坐标。
 */

import * as THREE from 'three';
import { BaseGroup } from '../core/BaseGroup';
import type { BaseGroupOptions } from '../core/BaseGroup';
import { prepare, type GraphIndex } from './adapter';
import { Edge3D } from './elements/Edge3D';
import { Node3D } from './elements/Node3D';
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
   * 边材质**模板**（`LineBasicMaterial`）。每条边构造时 `clone()` 一份独立实例，
   * 故各边状态变更互不影响；不传则用内置默认值作模板。模板本身不被释放。
   */
  edgeMaterial?: THREE.LineBasicMaterial;
  /**
   * 占位环形散布的半径（仅当节点无显式坐标时使用）。
   * @default 3
   */
  initialRadius?: number;
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
  /** 边材质模板（各边 clone 自它）。 */
  private readonly edgeMaterial?: THREE.LineBasicMaterial;
  /** 占位环形散布半径。 */
  private readonly initialRadius: number;

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
    this.edgeMaterial = options.edgeMaterial;
    this.initialRadius = options.initialRadius ?? 3;

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
      });
      node.setPosition(positions.get(nodeData.id)!);
      this.nodes.set(nodeData.id, node);
      this.nodeOrder.push(nodeData.id);
      this.add(node);
    }

    // 4. 生成边
    for (const edgeData of norm.edges) {
      const srcPos = positions.get(edgeData.source);
      const tgtPos = positions.get(edgeData.target);
      if (!srcPos || !tgtPos) continue;
      const edge = new Edge3D({
        id: edgeData.id,
        source: srcPos,
        target: tgtPos,
        material: this.edgeMaterial,
      });
      this.edges.push(edge);
      this.add(edge);
    }
  }

  /**
   * 计算节点初始坐标：优先用 `data.x/y/z`，未指定的节点在原点环形散布。
   *
   * 注：此为占位布局，第三步接入正式布局算法后可被 `setLayout()` 覆盖。
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
    this.nodeOrder.length = 0;
  }
}
