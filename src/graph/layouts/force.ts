/**
 * @module graph/layouts/force
 *
 * 3D 力导向布局 —— 纯函数，零 Three.js 运行时依赖。
 *
 * 移植自 **d3-force** 思路（库仑斥力 + 弹簧吸引 + 中心引力 + alpha 冷却 + 速度阻尼），
 * 同步迭代 `iterations` 步后返回静止态坐标。因统一签名 `(nodes, config) => NodePos3D[]`
 * 不收边，连接结构经 {@link ForceLayoutConfig.edges} 传入（`Graph3D.applyLayout` 自动注入）。
 *
 * 算法稳定性守卫（纯函数必须恒返回有限坐标）：
 * - 节点对距离平方夹 `≥ EPS_D2`（防库仑奇点 → Infinity → NaN）；
 * - 每步位置夹 `± CLAMP`；非有限值重置 0 并清速度。
 *
 * 性能（Step 5）：默认斥力为精确成对 `O(n²)`；`ForceLayoutConfig.barnesHut: true`（仅
 * `dimensions: 3`）时改用 Barnes-Hut 八叉树近似 `O(n log n)`，适合大图（&gt;500 节点）。
 * `n > NODE_WARN` 且未开 Barnes-Hut 时自动减半 `iterations` 并 `console.warn`；
 * 渲染侧大规模路径（`InstancedMesh2`）见组件文档「大规模」章节。
 */

import type { NodeData, NodeId, NodePos3D } from '../types';
import type { ForceLayoutConfig } from './types';
import { barnesHutRepulsion } from './barnesHut';
import { mapToPlane2D, resolvePlane } from './util';

/** 库仑斥力距离平方下限（防奇点）。约 0.01²。 */
const EPS_D2 = 1e-4;
/** 位置分量绝对值上限（防发散）。 */
const CLAMP = 1e4;
/** 触发「迭代减半 + 警告」的节点数阈值。 */
const NODE_WARN = 600;
/** alpha 冷却下限（与 d3-force 默认一致）。 */
const ALPHA_MIN = 0.001;

/**
 * 3D 力导向布局。
 *
 * @param nodes - 节点列表（不被修改）。
 * @param config - 见 {@link ForceLayoutConfig}。
 * @returns 每个节点的完整三维坐标（恒为有限值）。
 *
 * @example
 * ```ts
 * import { Layouts } from '@cyc/3d-components/graph';
 * // 3D 力导向（默认）
 * Layouts.force(nodes, { edges, iterations: 300 });
 * // 平面力导向（xy 计算后映射到 xz 平面）
 * Layouts.force(nodes, { edges, dimensions: 2, plane: 'xz' });
 * ```
 */
export function force(nodes: NodeData[], config?: ForceLayoutConfig): NodePos3D[] {
  const n = nodes.length;
  if (n === 0) return [];

  const cfg = config ?? {};
  const dims: 2 | 3 = cfg.dimensions ?? 3;
  const linkDistance = cfg.linkDistance ?? 1;
  const linkStrength = cfg.linkStrength ?? 0.3;
  const charge = cfg.chargeStrength ?? 30; // 正值 = 斥力
  const centerStrength = cfg.centerStrength ?? 0.02;
  const decay = cfg.velocityDecay ?? 0.6;
  const center = cfg.center ?? [0, 0, 0];
  const retain = 1 - decay; // 速度保留率
  // Barnes-Hut 仅在 3D 模式生效（平面点云八叉树退化低效，2D 回退精确成对）。
  const useBH = cfg.barnesHut === true && dims === 3;
  const theta = cfg.theta ?? 0.9;

  // 大规模保护：未开 Barnes-Hut 时自动减半迭代，避免主线程长阻塞。
  let iterations = cfg.iterations ?? 300;
  if (n > NODE_WARN && !useBH) {
    iterations = Math.max(1, Math.floor(iterations / 2));
    console.warn(
      `[graph/force] 节点数 ${n} > ${NODE_WARN}，斥力 O(n²)；已自动将 iterations 减半为 ${iterations}。` +
        `建议开启 barnesHut:true（八叉树 O(n log n)）加速；渲染侧大规模建议 InstancedMesh2 路径。`,
    );
  }
  // alpha 冷却计划：alphaDecay 使 alpha 在 iterations 步内从 1 衰减到 ALPHA_MIN。
  const alphaDecay = 1 - ALPHA_MIN ** (1 / iterations);
  let alpha = 1;

  // id → 索引（解析边端点）。
  const idIndex = new Map<NodeId, number>();
  for (let i = 0; i < n; i++) idIndex.set(nodes[i].id, i);

  // 初始化坐标：有显式坐标则暖启动，否则在 center 附近 ±linkDistance 随机散布。
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const nd = nodes[i];
    px[i] = nd.x !== undefined ? nd.x : center[0] + (Math.random() * 2 - 1) * linkDistance;
    py[i] = nd.y !== undefined ? nd.y : center[1] + (Math.random() * 2 - 1) * linkDistance;
    // 3D 模式 z 随机；2D 模式 z 固定 0（平面内计算）。
    pz[i] = dims === 3 ? (nd.z !== undefined ? nd.z : center[2] + (Math.random() * 2 - 1) * linkDistance) : 0;
  }
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const vz = new Float64Array(n);

  // 每步累积力（复用缓冲，减少分配）。
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const fz = new Float64Array(n);

  const edges = cfg.edges ?? [];

  for (let iter = 0; iter < iterations; iter++) {
    alpha *= 1 - alphaDecay;

    // 清零累积力。
    fx.fill(0);
    fy.fill(0);
    fz.fill(0);

    // 1) 库仑斥力。开启 Barnes-Hut 时用八叉树近似（O(n log n)），否则精确成对（O(n²)）。
    if (useBH) {
      barnesHutRepulsion(px, py, pz, n, charge, theta, fx, fy, fz);
    } else {
      // 精确成对（节点对）。正向：彼此推开。
      for (let i = 0; i < n; i++) {
        const xi = px[i];
        const yi = py[i];
        const zi = pz[i];
        for (let j = i + 1; j < n; j++) {
          let dx = px[j] - xi;
          let dy = py[j] - yi;
          let dz = dims === 3 ? pz[j] - zi : 0;
          let d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < EPS_D2) {
            // 重合/极近：给一个微小确定性偏移，避免 0 方向。
            dx = (i - j) * 1e-3 + 1e-3;
            dy = 1e-3;
            dz = dims === 3 ? 1e-3 : 0;
            d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < EPS_D2) d2 = EPS_D2;
          }
          const dist = Math.sqrt(d2);
          // 力大小 = charge / d2；方向单位向量 = (dx,dy,dz)/dist。
          const f = charge / d2;
          const ux = (dx / dist) * f;
          const uy = (dy / dist) * f;
          const uz = (dz / dist) * f;
          // j 被推向 +u（远离 i），i 被推向 -u。
          fx[j] += ux;
          fy[j] += uy;
          fz[j] += uz;
          fx[i] -= ux;
          fy[i] -= uy;
          fz[i] -= uz;
        }
      }
    }

    // 2) 弹簧吸引（边，胡克）：拉向静止长度 linkDistance。
    for (let e = 0; e < edges.length; e++) {
      const si = idIndex.get(edges[e].source);
      const ti = idIndex.get(edges[e].target);
      if (si === undefined || ti === undefined || si === ti) continue;
      const dx = px[ti] - px[si];
      const dy = py[ti] - py[si];
      const dz = dims === 3 ? pz[ti] - pz[si] : 0;
      let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < EPS_D2) d2 = EPS_D2;
      const dist = Math.sqrt(d2);
      // diff/dist 为单位方向；f = linkStrength * (dist - linkDistance) / dist。
      const f = (linkStrength * (dist - linkDistance)) / dist;
      const ux = dx * f;
      const uy = dy * f;
      const uz = dz * f;
      // s 被拉向 t（+u），t 被拉向 s（-u）。
      fx[si] += ux;
      fy[si] += uy;
      fz[si] += uz;
      fx[ti] -= ux;
      fy[ti] -= uy;
      fz[ti] -= uz;
    }

    // 3) 中心引力：把全体节点拉向 center。
    for (let i = 0; i < n; i++) {
      fx[i] += centerStrength * (center[0] - px[i]);
      fy[i] += centerStrength * (center[1] - py[i]);
      if (dims === 3) fz[i] += centerStrength * (center[2] - pz[i]);
    }

    // 4) 积分（alpha 作加速度，施加于速度，不直接乘位置）+ 守卫。
    for (let i = 0; i < n; i++) {
      vx[i] = vx[i] * retain + fx[i] * alpha;
      vy[i] = vy[i] * retain + fy[i] * alpha;
      vz[i] = vz[i] * retain + fz[i] * alpha;
      let nx = px[i] + vx[i];
      let ny = py[i] + vy[i];
      let nz = pz[i] + vz[i];
      // 位置夹紧。
      if (nx > CLAMP) nx = CLAMP;
      else if (nx < -CLAMP) nx = -CLAMP;
      if (ny > CLAMP) ny = CLAMP;
      else if (ny < -CLAMP) ny = -CLAMP;
      if (nz > CLAMP) nz = CLAMP;
      else if (nz < -CLAMP) nz = -CLAMP;
      // 非有限值兜底：归零并清速度。
      if (!Number.isFinite(nx)) {
        nx = 0;
        vx[i] = 0;
      }
      if (!Number.isFinite(ny)) {
        ny = 0;
        vy[i] = 0;
      }
      if (!Number.isFinite(nz)) {
        nz = 0;
        vz[i] = 0;
      }
      px[i] = nx;
      py[i] = ny;
      pz[i] = nz;
    }
  }

  // 输出 NodePos3D。dim=3 直接取；dim=2 经 plane 映射。
  const plane = resolvePlane(cfg);
  const result: NodePos3D[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let x = px[i];
    let y = py[i];
    let z = pz[i];
    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(y)) y = 0;
    if (!Number.isFinite(z)) z = 0;
    if (dims === 2) {
      const mapped = mapToPlane2D(x, y, plane, cfg.depthOffset ?? 0);
      result[i] = { id: nodes[i].id, x: mapped.x, y: mapped.y, z: mapped.z };
    } else {
      result[i] = { id: nodes[i].id, x, y, z };
    }
  }
  return result;
}
