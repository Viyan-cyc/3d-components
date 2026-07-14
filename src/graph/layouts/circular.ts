/**
 * @module graph/layouts/circular
 *
 * 环形布局（3D 化）—— 纯函数，零 Three.js 运行时依赖。
 *
 * 2D 圆周 `(x, y) = (R·cosθ, R·sinθ)`，经 {@link CircularLayoutConfig.plane} 映射到三维平面，
 * 并在被忽略轴上以 `depthOffset + layerIndex * layerSpacing` 分层。
 *
 * 三种模式（按优先级）：
 * 1. **分组分层**（`groupBy` 命中）：按节点字段分桶，每组一个深度层。
 * 2. **同心多环**（`groupBy` 缺省且 `rings > 1`）：按 index 轮询分环。
 * 3. **单圈单层**（其余）：全部节点绕一圈。
 *
 * 算法本身朴素（无迭代），θ_i = startAngle + (i / count) * (endAngle - startAngle)。
 */

import type { NodeData, NodeId, NodePos3D } from '../types';
import type { CircularLayoutConfig } from './types';
import { mapToPlane2D, resolveDepth, resolvePlane } from './util';

/**
 * 把一组节点绕一圈，返回其 2D + 层索引结果（再统一映射到 3D）。
 *
 * @param group - 本层节点列表。
 * @param radius - 本层半径。
 * @param layerIndex - 本层在被忽略轴上的层级索引。
 * @param cfg - 配置（取 startAngle/endAngle/plane 与分层参数）。
 */
function ringPositions(
  group: NodeData[],
  radius: number,
  layerIndex: number,
  cfg: CircularLayoutConfig,
): NodePos3D[] {
  const start = cfg.startAngle ?? 0;
  const end = cfg.endAngle ?? Math.PI * 2;
  const span = end - start;
  const count = group.length;
  const plane = resolvePlane(cfg);
  const depth = resolveDepth(cfg, layerIndex);
  const out: NodePos3D[] = [];
  for (let i = 0; i < count; i++) {
    // 整圈均布用 i/count；单点退化保护用 max(count,1)。
    const theta = start + (count > 0 ? (i / count) * span : 0);
    const x2 = Math.cos(theta) * radius;
    const y2 = Math.sin(theta) * radius;
    const p = mapToPlane2D(x2, y2, plane, depth);
    out.push({ id: group[i].id, ...p });
  }
  return out;
}

/**
 * 环形布局（3D 化）。
 *
 * @param nodes - 节点列表（不被修改）。
 * @param config - 见 {@link CircularLayoutConfig}。
 * @returns 每个节点的完整三维坐标。
 *
 * @example
 * ```ts
 * import { Layouts } from '@cyc/3d-components/graph';
 * const pos = Layouts.circular(nodes, { radius: 4, plane: 'xz', rings: 3 });
 * ```
 */
export function circular(nodes: NodeData[], config?: CircularLayoutConfig): NodePos3D[] {
  const cfg = config ?? {};
  const radius = cfg.radius ?? 3;
  const radiusStep = cfg.radiusStep ?? 1;
  const groupBy = cfg.groupBy;
  const rings = Math.max(1, cfg.rings ?? 1);

  // 1) 分组分层：groupBy 命中时，按字段值去重分桶（保留首次出现顺序），每组一个深度层。
  if (groupBy) {
    const groupOrder: NodeId[] = [];
    const buckets = new Map<unknown, NodeData[]>();
    for (const n of nodes) {
      const key = (n as Record<string, unknown>)[groupBy];
      if (!buckets.has(key)) {
        buckets.set(key, []);
        groupOrder.push(key as NodeId);
      }
      buckets.get(key)!.push(n);
    }
    const result: NodePos3D[] = [];
    groupOrder.forEach((key, layerIndex) => {
      const r = radius + layerIndex * radiusStep;
      result.push(...ringPositions(buckets.get(key)!, r, layerIndex, cfg));
    });
    return result;
  }

  // 2) 同心多环：groupBy 缺省且 rings>1 —— 按 index 轮询均分到各环。
  if (rings > 1) {
    const perRingBuckets: NodeData[][] = Array.from({ length: rings }, () => []);
    for (let i = 0; i < nodes.length; i++) {
      perRingBuckets[i % rings].push(nodes[i]);
    }
    const result: NodePos3D[] = [];
    for (let ring = 0; ring < rings; ring++) {
      const group = perRingBuckets[ring];
      if (group.length === 0) continue;
      const r = radius + ring * radiusStep;
      result.push(...ringPositions(group, r, ring, cfg));
    }
    return result;
  }

  // 3) 单圈单层：最常见。
  return ringPositions(nodes, radius, 0, cfg);
}
