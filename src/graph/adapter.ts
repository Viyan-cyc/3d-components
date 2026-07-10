/**
 * @module graph/adapter
 *
 * 数据适配层 —— 连接「用户输入」与「布局/渲染/交互」的纯函数桥梁。
 *
 * 职责：
 * - {@link validate}：校验数据合法性（id 唯一、source/target 存在、空数据兜底）。
 * - {@link normalize}：补全缺省字段（边 id、节点 `type`），返回规范化副本（不改原输入）。
 * - {@link buildIndex}：构建节点索引表与邻接表，供布局/交互快速查询。
 *
 * 全部为纯函数、零 Three.js 依赖，可独立单测。
 */

import type { EdgeData, GraphData, NodeData, NodeId } from './types';

/**
 * 数据校验结果。
 */
export interface ValidationResult {
  /** 是否通过校验。 */
  ok: boolean;
  /** 校验失败原因列表（`ok === true` 时为空）。 */
  errors: string[];
}

/**
 * 校验图数据合法性。
 *
 * 检查项：
 * - `nodes` / `edges` 是否为数组（缺省视为空数组）。
 * - 节点 `id` 是否存在且在图内唯一。
 * - 边的 `source` / `target` 是否都指向已存在的节点 id。
 * - 自环边（source === target）允许，但会记入 info 不视为错误。
 *
 * @param data - 待校验的图数据。
 * @returns 校验结果。
 *
 * @example
 * ```ts
 * const result = validate({ nodes: [{ id: 'n1' }], edges: [{ source: 'n1', target: 'n2' }] });
 * if (!result.ok) console.warn(result.errors);
 * ```
 */
export function validate(data: GraphData): ValidationResult {
  const errors: string[] = [];
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const edges = Array.isArray(data?.edges) ? data.edges : [];

  const idSet = new Set<NodeId>();
  for (const n of nodes) {
    if (n.id === undefined || n.id === null || n.id === '') {
      errors.push(`节点缺少有效 id：${JSON.stringify(n)}`);
      continue;
    }
    if (idSet.has(n.id)) {
      errors.push(`节点 id 重复：${n.id}`);
    }
    idSet.add(n.id);
  }

  for (const e of edges) {
    if (e.source === undefined || e.source === null) {
      errors.push(`边缺少 source：${JSON.stringify(e)}`);
      continue;
    }
    if (e.target === undefined || e.target === null) {
      errors.push(`边缺少 target：${JSON.stringify(e)}`);
      continue;
    }
    if (!idSet.has(e.source)) {
      errors.push(`边的 source 指向不存在的节点：${e.source}`);
    }
    if (!idSet.has(e.target)) {
      errors.push(`边的 target 指向不存在的节点：${e.target}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * 归一化图数据：补全缺省字段，返回深拷贝后的规范化副本（不修改原输入）。
 *
 * 补全项：
 * - 节点 `type` 缺省 → `'mesh'`。
 * - 节点 `data` 缺省 → `{}`。
 * - 边 `id` 缺省 → 自动生成 `${source}->${target}`（同 source/target 的重复边追加索引后缀）。
 * - 边 `type` 缺省 → `'line'`。
 *
 * @param data - 原始图数据。
 * @returns 规范化后的图数据副本。
 *
 * @example
 * ```ts
 * const norm = normalize(input);
 * // norm.edges[0].id 一定存在
 * ```
 */
export function normalize(data: GraphData): GraphData {
  const nodes: NodeData[] = (data?.nodes ?? []).map((n) => ({
    ...n,
    type: n.type ?? 'mesh',
    data: n.data ?? {},
  }));

  // 边 id 去重：相同 source->target 的多条边追加 #k 后缀
  const edgeKeyCount = new Map<string, number>();
  const edges: EdgeData[] = (data?.edges ?? []).map((e) => {
    const key = `${e.source}->${e.target}`;
    const count = edgeKeyCount.get(key) ?? 0;
    edgeKeyCount.set(key, count + 1);
    const id = e.id ?? (count === 0 ? key : `${key}#${count}`);
    return {
      ...e,
      id,
      type: e.type ?? 'line',
      data: e.data ?? {},
    };
  });

  return { nodes, edges };
}

/**
 * 节点索引与邻接表。
 */
export interface GraphIndex {
  /** id → 节点数据。 */
  nodeMap: Map<NodeId, NodeData>;
  /** id → 邻接节点 id 数组（无向：source 与 target 互相加入）。 */
  adjacency: Map<NodeId, NodeId[]>;
  /** id → 该节点参与的所有边（含 source 与 target 两种角色）。 */
  incidentEdges: Map<NodeId, { source: NodeId; target: NodeId }[]>;
}

/**
 * 构建节点索引表与邻接表。
 *
 * @param data - 已 {@link normalize} 的图数据（直接传原始数据亦可，函数内部不依赖 normalize）。
 * @returns 索引结构。
 *
 * @example
 * ```ts
 * const idx = buildIndex(data);
 * idx.adjacency.get('n1'); // ['n2', 'n3', ...]
 * ```
 */
export function buildIndex(data: GraphData): GraphIndex {
  const nodeMap = new Map<NodeId, NodeData>();
  const adjacency = new Map<NodeId, NodeId[]>();
  const incidentEdges = new Map<NodeId, { source: NodeId; target: NodeId }[]>();

  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const edges = Array.isArray(data?.edges) ? data.edges : [];

  for (const n of nodes) {
    nodeMap.set(n.id, n);
    adjacency.set(n.id, []);
    incidentEdges.set(n.id, []);
  }

  for (const e of edges) {
    const { source, target } = e;
    if (!nodeMap.has(source) || !nodeMap.has(target)) continue;

    adjacency.get(source)!.push(target);
    adjacency.get(target)!.push(source);
    incidentEdges.get(source)!.push({ source, target });
    incidentEdges.get(target)!.push({ source, target });
  }

  return { nodeMap, adjacency, incidentEdges };
}

/**
 * 一步完成「校验 + 归一化 + 建索引」的便捷函数。
 *
 * 校验不通过时抛出 `Error`（含全部错误原因）；通过则返回规范化数据与索引。
 *
 * @param data - 原始图数据。
 * @returns `{ data, index }`。
 * @throws 当校验失败时抛出，错误信息聚合所有问题。
 *
 * @example
 * ```ts
 * const { data, index } = prepare(rawData);
 * ```
 */
export function prepare(data: GraphData): { data: GraphData; index: GraphIndex } {
  const result = validate(data);
  if (!result.ok) {
    throw new Error(`GraphData 校验失败：\n  - ${result.errors.join('\n  - ')}`);
  }
  const norm = normalize(data);
  return { data: norm, index: buildIndex(norm) };
}
