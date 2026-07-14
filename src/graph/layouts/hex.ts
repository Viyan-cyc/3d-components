/**
 * @module graph/layouts/hex
 *
 * 六边形蜂巢布局 —— 纯函数，零 Three.js 运行时依赖。
 *
 * 轴向坐标 `(q, r)` 从中心向外**逐环螺旋**铺开（第 k 环 `6k` 格，保证蜂巢紧凑无空洞），
 * 再按 {@link HexLayoutConfig.orientation}（平顶/尖顶）换算为 2D 世界坐标，
 * 经 {@link HexLayoutConfig.plane} 映射到三维平面，并在被忽略轴上以
 * `depthOffset + layerIndex * layerSpacing` 分层（多层堆叠）。
 *
 * 三种模式（按优先级，与 `circular` 对齐）：
 * 1. **分组分层**（`groupBy` 命中）：按节点字段分桶，每组一个深度层，组内各铺一张蜂巢。
 * 2. **多层堆叠**（`groupBy` 缺省且 `layers > 1`）：按 index 轮询分入 `layers` 层。
 * 3. **单层蜂巢**（其余）：全部节点铺成一张蜂巢。
 *
 * 算法移植自 RedBlobGames《Hexagonal Grids》：
 * - ring/spiral：`cube_ring` 的轴向版（起点 = 中心 + radius·dir[4]，绕 6 边各走 radius 步）；
 * - hex-to-pixel：pointy/flat 两套换算公式。
 *
 * 注：轴向邻居方向 `{(+1,0),(+1,-1),(0,-1),(-1,0),(-1,+1),(0,+1)}` 与 orientation 无关，
 * orientation 仅决定 `(q,r)→世界坐标` 的换算 —— 同一组轴向坐标，平顶/尖顶只是整体旋转 30°。
 */

import type { NodeData, NodeId, NodePos3D } from '../types';
import type { HexLayoutConfig } from './types';
import { mapToPlane2D, resolveDepth, resolvePlane } from './util';

/** 轴向坐标六邻居方向（RedBlob 标准；orientation 无关，仅像素换算分平顶/尖顶）。 */
const AXIAL_DIRS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
] as const;

/** `Math.sqrt(3)`，hex-to-pixel 换算的常量。 */
const SQRT3 = Math.sqrt(3);

/**
 * 生成第 `radius` 环的轴向坐标序列（不含中心）。RedBlob `cube_ring` 的轴向版。
 *
 * 起点 = 中心 + `radius · AXIAL_DIRS[4]`（= `(-radius, +radius)`），随后绕 6 条边各走 `radius` 步。
 *
 * @param radius - 环序号（≥1）。
 * @returns 该环所有格子的轴向坐标（共 `6·radius` 个）。
 */
function axialRing(radius: number): Array<{ q: number; r: number }> {
  if (radius <= 0) return [];
  const out: Array<{ q: number; r: number }> = [];
  // 起点：中心 + radius * dirs[4]（dirs[4] = (-1, +1)）。
  let q = -radius;
  let r = radius;
  for (let side = 0; side < 6; side++) {
    const d = AXIAL_DIRS[side];
    for (let step = 0; step < radius; step++) {
      out.push({ q, r });
      q += d.q;
      r += d.r;
    }
  }
  return out;
}

/**
 * 轴向坐标 `(q, r)` → 2D 世界坐标，按 orientation 选用 RedBlob hex-to-pixel 公式。
 *
 * - pointy-top：`x = size·(√3·q + √3/2·r)`，`y = size·(3/2·r)`；
 * - flat-top ：`x = size·(3/2·q)`，`y = size·(√3/2·q + √3·r)`。
 *
 * @returns `{ x2, y2 }`（再统一经 `mapToPlane2D` 映射三维）。
 */
function hexToPixel(
  q: number,
  r: number,
  size: number,
  orientation: 'flat' | 'pointy',
): { x2: number; y2: number } {
  if (orientation === 'pointy') {
    return {
      x2: size * (SQRT3 * q + (SQRT3 / 2) * r),
      y2: size * (3 / 2) * r,
    };
  }
  // flat-top
  return {
    x2: size * (3 / 2) * q,
    y2: size * ((SQRT3 / 2) * q + SQRT3 * r),
  };
}

/**
 * 把一组节点铺成**一张蜂巢切片**（单层），从中心向外逐环螺旋填充。
 *
 * @param group - 本层节点列表。
 * @param size - 六边形外接圆半径。
 * @param orientation - 平顶/尖顶。
 * @param layerIndex - 本层在被忽略轴上的层级索引。
 * @param cfg - 配置（取 plane 与分层参数）。
 */
function honeycombLayer(
  group: NodeData[],
  size: number,
  orientation: 'flat' | 'pointy',
  layerIndex: number,
  cfg: HexLayoutConfig,
): NodePos3D[] {
  const n = group.length;
  if (n === 0) return [];
  const plane = resolvePlane(cfg);
  const depth = resolveDepth(cfg, layerIndex);

  // 预生成足够覆盖本组节点数的轴向坐标：中心 (0,0) 起逐环扩展。
  // 前 k 环总格数 = 1 + 3·k·(k+1)；环数需求上限很低（n=1000 → k≈17）。
  const coords: Array<{ q: number; r: number }> = [{ q: 0, r: 0 }];
  let ring = 1;
  while (coords.length < n) {
    const layer = axialRing(ring);
    for (let i = 0; i < layer.length; i++) coords.push(layer[i]);
    ring++;
  }

  const out: NodePos3D[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const { q, r } = coords[i];
    const { x2, y2 } = hexToPixel(q, r, size, orientation);
    const p = mapToPlane2D(x2, y2, plane, depth);
    out[i] = { id: group[i].id, ...p };
  }
  return out;
}

/**
 * 六边形蜂巢布局。
 *
 * @param nodes - 节点列表（不被修改）。
 * @param config - 见 {@link HexLayoutConfig}。
 * @returns 每个节点的完整三维坐标（恒为有限值 —— 仅含乘加运算）。
 *
 * @example
 * ```ts
 * import { Layouts } from '@cyc/3d-components/graph';
 * // 单层平顶蜂巢
 * Layouts.hex(nodes, { radius: 1.2, plane: 'xz' });
 * // 三层堆叠
 * Layouts.hex(nodes, { radius: 1.2, layers: 3, layerSpacing: 2.4 });
 * ```
 */
export function hex(nodes: NodeData[], config?: HexLayoutConfig): NodePos3D[] {
  const cfg = config ?? {};
  const size = cfg.radius ?? 1;
  const orientation = cfg.orientation ?? 'flat';
  const groupBy = cfg.groupBy;
  const layers = Math.max(1, cfg.layers ?? 1);

  // 1) 分组分层：groupBy 命中时，按字段值去重分桶（保留首次出现顺序），每组一个深度层。
  if (groupBy) {
    const groupOrder: NodeId[] = [];
    const buckets = new Map<unknown, NodeData[]>();
    for (const nd of nodes) {
      const key = (nd as Record<string, unknown>)[groupBy];
      if (!buckets.has(key)) {
        buckets.set(key, []);
        groupOrder.push(key as NodeId);
      }
      buckets.get(key)!.push(nd);
    }
    const result: NodePos3D[] = [];
    groupOrder.forEach((key, layerIndex) => {
      result.push(...honeycombLayer(buckets.get(key)!, size, orientation, layerIndex, cfg));
    });
    return result;
  }

  // 2) 多层堆叠：groupBy 缺省且 layers>1 —— 按 index 轮询均分到各层，每层一张蜂巢。
  if (layers > 1) {
    const perLayerBuckets: NodeData[][] = Array.from({ length: layers }, () => []);
    for (let i = 0; i < nodes.length; i++) {
      perLayerBuckets[i % layers].push(nodes[i]);
    }
    const result: NodePos3D[] = [];
    for (let layer = 0; layer < layers; layer++) {
      const group = perLayerBuckets[layer];
      if (group.length === 0) continue;
      result.push(...honeycombLayer(group, size, orientation, layer, cfg));
    }
    return result;
  }

  // 3) 单层蜂巢：最常见。
  return honeycombLayer(nodes, size, orientation, 0, cfg);
}
