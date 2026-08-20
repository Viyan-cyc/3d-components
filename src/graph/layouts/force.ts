/**
 * @module graph/layouts/force
 *
 * 3D 力导向布局 —— 纯函数，零 Three.js 运行时依赖。
 *
 * 库仑斥力 + 弹簧吸引 + 中心引力 + alpha 冷却 + 速度阻尼，
 * 同步迭代 `iterations` 步后返回静止态坐标。因统一签名 `(nodes, config) => NodePos3D[]`
 * 不收边，连接结构经 {@link ForceLayoutConfig.edges} 传入（`Graph3D.applyLayout` 自动注入）。
 *
 * 算法稳定性守卫（纯函数必须恒返回有限坐标）：
 * - 节点对距离平方夹 `≥ EPS_D2`（防库仑奇点 → Infinity → NaN）；
 * - 每步位置夹 `± CLAMP`；非有限值重置 0 并清速度。
 *
 * 性能（Step 5）：默认斥力为精确成对 `O(n²)`；`ForceLayoutConfig.barnesHut: true`（仅
 * `dimensions: 3`）时改用 Barnes-Hut 八叉树近似 `O(n log n)`，适合大图（>500 节点）。
 * `n > NODE_WARN` 且未开 Barnes-Hut 时自动减半 `iterations` 并 `console.warn`；
 * 渲染侧大规模路径（`InstancedMesh2`）见组件文档「大规模」章节。
 */

import type { NodeData, NodeId, NodePos3D } from '../types';
import { mapToPlane2D, resolvePlane } from './util';
import type { ForceLayoutConfig } from './types';
import { barnesHutRepulsion } from './barnesHut';

/** 库仑斥力距离平方下限（防奇点）。约 0.01²。 */
const EPS_D2 = 1e-4;

/** 位置分量绝对值上限（防发散）。 */
const CLAMP = 1e4;

/** 触发「迭代减半 + 警告」的节点数阈值。 */
const NODE_WARN = 600;

/** alpha 冷却下限。 */
const ALPHA_MIN = 0.001;

/** 三维模式维度值。 */
const DIM_3D = 3;

/** 默认弹簧刚度。 */
const DEFAULT_LINK_STRENGTH = 0.3;

/** 默认斥力强度。 */
const DEFAULT_CHARGE = 30;

/** 默认中心引力强度。 */
const DEFAULT_CENTER_STRENGTH = 0.02;

/** 默认速度阻尼。 */
const DEFAULT_VELOCITY_DECAY = 0.6;

/** 默认开角阈值。 */
const DEFAULT_THETA = 0.9;

/** 默认迭代步数。 */
const DEFAULT_ITERATIONS = 300;

/** 微小确定性偏移量（防重合/零方向）。 */
const MICRO_OFFSET = 1e-3;

/** 力缓冲数据结构（减少参数数量）。 */
interface ForceBuffers {
  fx: Float64Array;
  fy: Float64Array;
  fz: Float64Array;
}

/** 位置缓冲数据结构。 */
interface PositionBuffers {
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
}

/** 速度缓冲数据结构。 */
interface VelocityBuffers {
  vx: Float64Array;
  vy: Float64Array;
  vz: Float64Array;
}

/** 解析后的配置（所有缺省值已填充）。 */
interface ResolvedConfig {
  dims: 2 | typeof DIM_3D;
  linkDistance: number;
  linkStrength: number;
  charge: number;
  centerStrength: number;
  decay: number;
  retain: number;
  center: [number, number, number];
  useBH: boolean;
  theta: number;
  iterations: number;
  edges: Array<{ source: NodeId; target: NodeId }>;
}

/** 重合偏移结果。 */
interface OverlapOffset {
  dx: number;
  dy: number;
  dz: number;
  d2: number;
}

/** 一对节点间的力参数。 */
interface PairForceParams {
  dx: number;
  dy: number;
  dz: number;
  d2: number;
  charge: number;
}

/**
 * 解析重合/极近距离：给微小确定性偏移，避免 0 方向。
 */
const resolveOverlap = function (i: number, j: number, dims: 2 | typeof DIM_3D): OverlapOffset {
  const dx = (i - j) * MICRO_OFFSET + MICRO_OFFSET;
  const dy = MICRO_OFFSET;
  const dz = dims === DIM_3D ? MICRO_OFFSET : 0;
  let d2 = dx * dx + dy * dy + dz * dz;
  if (d2 < EPS_D2) {
    d2 = EPS_D2;
  }
  return {
    dx, dy, dz, d2,
  };
};

/**
 * 施加一对节点间的库仑斥力。
 */
const applyPairwiseForce = function (
  params: PairForceParams,
  i: number, j: number,
  fb: ForceBuffers,
): void {
  const {
    dx, dy, dz, d2, charge,
  } = params;
  const dist = Math.sqrt(d2);
  const f = charge / d2;
  const ux = (dx / dist) * f;
  const uy = (dy / dist) * f;
  const uz = (dz / dist) * f;
  fb.fx[j] += ux;
  fb.fy[j] += uy;
  fb.fz[j] += uz;
  fb.fx[i] -= ux;
  fb.fy[i] -= uy;
  fb.fz[i] -= uz;
};

/**
 * 施加一条边的弹簧力。
 */
const applySpringForce = function (
  pos: PositionBuffers,
  rc: ResolvedConfig,
  si: number, ti: number,
  fb: ForceBuffers,
): void {
  const { px, py, pz } = pos;
  const dx = px[ti] - px[si];
  const dy = py[ti] - py[si];
  const dz = rc.dims === DIM_3D ? pz[ti] - pz[si] : 0;
  let d2 = dx * dx + dy * dy + dz * dz;
  if (d2 < EPS_D2) {
    d2 = EPS_D2;
  }
  const dist = Math.sqrt(d2);
  const f = (rc.linkStrength * (dist - rc.linkDistance)) / dist;
  const ux = dx * f;
  const uy = dy * f;
  const uz = dz * f;
  fb.fx[si] += ux;
  fb.fy[si] += uy;
  fb.fz[si] += uz;
  fb.fx[ti] -= ux;
  fb.fy[ti] -= uy;
  fb.fz[ti] -= uz;
};

/**
 * 计算精确成对库仑斥力（O(n²)）。
 */
const computeExactRepulsion = function (
  pos: PositionBuffers,
  n: number,
  rc: ResolvedConfig,
  fb: ForceBuffers,
): void {
  const { px, py, pz } = pos;
  for (let i = 0; i < n; i++) {
    const xi = px[i];
    const yi = py[i];
    const zi = pz[i];
    for (let j = i + 1; j < n; j++) {
      let dx = px[j] - xi;
      let dy = py[j] - yi;
      let dz = rc.dims === DIM_3D ? pz[j] - zi : 0;
      let d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < EPS_D2) {
        const offset = resolveOverlap(i, j, rc.dims);
        dx = offset.dx;
        dy = offset.dy;
        dz = offset.dz;
        d2 = offset.d2;
      }
      applyPairwiseForce({
        dx, dy, dz, d2, charge: rc.charge,
      }, i, j, fb);
    }
  }
};

/**
 * 计算弹簧吸引（边，胡克）：拉向静止长度 linkDistance。
 */
const computeAttraction = function (
  pos: PositionBuffers,
  rc: ResolvedConfig,
  idIndex: Map<NodeId, number>,
  fb: ForceBuffers,
): void {
  for (const edge of rc.edges) {
    const si = idIndex.get(edge.source);
    const ti = idIndex.get(edge.target);
    if (si !== undefined && ti !== undefined && si !== ti) {
      applySpringForce(pos, rc, si, ti, fb);
    }
  }
};

/**
 * 计算中心引力：把全体节点拉向 center。
 */
const computeGravity = function (
  pos: PositionBuffers,
  n: number,
  rc: ResolvedConfig,
  fb: ForceBuffers,
): void {
  const { px, py, pz } = pos;
  for (let i = 0; i < n; i++) {
    fb.fx[i] += rc.centerStrength * (rc.center[0] - px[i]);
    fb.fy[i] += rc.centerStrength * (rc.center[1] - py[i]);
    if (rc.dims === DIM_3D) {
      fb.fz[i] += rc.centerStrength * (rc.center[2] - pz[i]);
    }
  }
};

/**
 * 夹紧一个位置分量到 ±CLAMP，非有限值归零并清速度。
 */
const clampPosition = function (val: number, vel: Float64Array, i: number): number {
  if (Number.isFinite(val) === false) {
    vel[i] = 0;
    return 0;
  }
  if (val > CLAMP) {
    return CLAMP;
  }
  if (val < -CLAMP) {
    return -CLAMP;
  }
  return val;
};

/** 积分参数。 */
interface IntegrateParams {
  pos: PositionBuffers;
  vel: VelocityBuffers;
  fb: ForceBuffers;
  n: number;
  alpha: number;
  retain: number;
}

/**
 * 积分（alpha 作加速度，施加于速度，不直接乘位置）+ 守卫。
 */
const integrate = function (p: IntegrateParams): void {
  for (let i = 0; i < p.n; i++) {
    p.vel.vx[i] = p.vel.vx[i] * p.retain + p.fb.fx[i] * p.alpha;
    p.vel.vy[i] = p.vel.vy[i] * p.retain + p.fb.fy[i] * p.alpha;
    p.vel.vz[i] = p.vel.vz[i] * p.retain + p.fb.fz[i] * p.alpha;
    p.pos.px[i] = clampPosition(p.pos.px[i] + p.vel.vx[i], p.vel.vx, i);
    p.pos.py[i] = clampPosition(p.pos.py[i] + p.vel.vy[i], p.vel.vy, i);
    p.pos.pz[i] = clampPosition(p.pos.pz[i] + p.vel.vz[i], p.vel.vz, i);
  }
};

/**
 * 保证有限值：非有限 → 0。
 */
const finiteOrZero = function (v: number): number {
  return Number.isFinite(v) ? v : 0;
};

/**
 * 把最终坐标转为 NodePos3D 数组。
 */
const buildResult = function (
  nodes: NodeData[],
  pos: PositionBuffers,
  rc: ResolvedConfig,
  cfg: ForceLayoutConfig,
): NodePos3D[] {
  const n = nodes.length;
  const plane = resolvePlane(cfg);
  const result: NodePos3D[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = finiteOrZero(pos.px[i]);
    const y = finiteOrZero(pos.py[i]);
    const z = finiteOrZero(pos.pz[i]);
    if (rc.dims === 2) {
      const mapped = mapToPlane2D(x, y, plane, cfg.depthOffset ?? 0);
      result[i] = { id: nodes[i].id, ...mapped };
    } else {
      result[i] = {
        id: nodes[i].id, x, y, z,
      };
    }
  }
  return result;
};

/**
 * 解析配置缺省值。
 */
const resolveConfig = function (cfg: ForceLayoutConfig, n: number): ResolvedConfig {
  const dims: 2 | typeof DIM_3D = cfg.dimensions ?? DIM_3D;
  const linkDistance = cfg.linkDistance ?? 1;
  const linkStrength = cfg.linkStrength ?? DEFAULT_LINK_STRENGTH;
  // 正值 = 斥力
  const charge = cfg.chargeStrength ?? DEFAULT_CHARGE;
  const centerStrength = cfg.centerStrength ?? DEFAULT_CENTER_STRENGTH;
  const decay = cfg.velocityDecay ?? DEFAULT_VELOCITY_DECAY;
  const center = cfg.center ?? [0, 0, 0];
  // 速度保留率
  const retain = 1 - decay;
  const useBH = cfg.barnesHut === true && dims === DIM_3D;
  const theta = cfg.theta ?? DEFAULT_THETA;
  const edges = cfg.edges ?? [];

  let iterations = cfg.iterations ?? DEFAULT_ITERATIONS;
  if (n > NODE_WARN && useBH === false) {
    iterations = Math.max(1, Math.floor(iterations / 2));

    console.warn(`[graph/force] 节点数 ${n} > ${NODE_WARN}，斥力 O(n²)；` +
        `已自动将 iterations 减半为 ${iterations}。` +
        '建议开启 barnesHut:true（八叉树 O(n log n)）加速；' +
        '渲染侧大规模建议 InstancedMesh2 路径。');
  }

  return {
    dims,
    linkDistance,
    linkStrength,
    charge,
    centerStrength,
    decay,
    retain,
    center,
    useBH,
    theta,
    iterations,
    edges,
  };
};

/**
 * 初始化坐标：有显式坐标则暖启动，否则在 center 附近随机散布。
 */
const initPositions = function (
  nodes: NodeData[],
  rc: ResolvedConfig,
): PositionBuffers {
  const n = nodes.length;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const nd = nodes[i];
    px[i] = nd.x === undefined
      ? rc.center[0] + (Math.random() * 2 - 1) * rc.linkDistance
      : nd.x;
    py[i] = nd.y === undefined
      ? rc.center[1] + (Math.random() * 2 - 1) * rc.linkDistance
      : nd.y;
    if (rc.dims === DIM_3D) {
      pz[i] = nd.z === undefined
        ? rc.center[2] + (Math.random() * 2 - 1) * rc.linkDistance
        : nd.z;
    } else {
      pz[i] = 0;
    }
  }
  return { px, py, pz };
};

/** 运行一步迭代的参数。 */
interface IterationParams {
  pos: PositionBuffers;
  vel: VelocityBuffers;
  fb: ForceBuffers;
  n: number;
  rc: ResolvedConfig;
  idIndex: Map<NodeId, number>;
  alpha: number;
}

/**
 * 运行一步力导向迭代：斥力 + 引力 + 中心引力 + 积分。
 */
const runOneIteration = function (p: IterationParams): void {
  // 清零累积力。
  p.fb.fx.fill(0);
  p.fb.fy.fill(0);
  p.fb.fz.fill(0);

  // 1) 库仑斥力。
  if (p.rc.useBH) {
    barnesHutRepulsion({
      px: p.pos.px,
      py: p.pos.py,
      pz: p.pos.pz,
      n: p.n,
      charge: p.rc.charge,
      theta: p.rc.theta,
      fx: p.fb.fx,
      fy: p.fb.fy,
      fz: p.fb.fz,
    });
  } else {
    computeExactRepulsion(p.pos, p.n, p.rc, p.fb);
  }

  // 2) 弹簧吸引（边）。
  computeAttraction(p.pos, p.rc, p.idIndex, p.fb);

  // 3) 中心引力。
  computeGravity(p.pos, p.n, p.rc, p.fb);

  // 4) 积分 + 守卫。
  integrate({
    pos: p.pos, vel: p.vel, fb: p.fb, n: p.n, alpha: p.alpha, retain: p.rc.retain,
  });
};

/**
 * 3D 力导向布局。
 *
 * @param nodes - 节点列表（不被修改）。
 * @param config - 见 {@link ForceLayoutConfig}。
 * @returns 每个节点的完整三维坐标（恒为有限值）。
 *
 * @example
 * ```ts
 * import { Layouts } from '@a3d/a3d-components/graph';
 * // 3D 力导向（默认）
 * Layouts.force(nodes, { edges, iterations: 300 });
 * // 平面力导向（xy 计算后映射到 xz 平面）
 * Layouts.force(nodes, { edges, dimensions: 2, plane: 'xz' });
 * ```
 */
export const force = function (nodes: NodeData[], config?: ForceLayoutConfig): NodePos3D[] {
  const n = nodes.length;
  if (n === 0) {
    return [];
  }

  const cfg = config ?? {};
  const rc = resolveConfig(cfg, n);

  // id → 索引（解析边端点）。
  const idIndex = new Map<NodeId, number>();
  for (let i = 0; i < n; i++) {
    idIndex.set(nodes[i].id, i);
  }

  const pos = initPositions(nodes, rc);
  const vel: VelocityBuffers = {
    vx: new Float64Array(n),
    vy: new Float64Array(n),
    vz: new Float64Array(n),
  };
  const fb: ForceBuffers = {
    fx: new Float64Array(n),
    fy: new Float64Array(n),
    fz: new Float64Array(n),
  };

  const alphaDecay = 1 - ALPHA_MIN ** (1 / rc.iterations);
  let alpha = 1;

  for (let iter = 0; iter < rc.iterations; iter++) {
    alpha *= 1 - alphaDecay;
    runOneIteration({
      pos, vel, fb, n, rc, idIndex, alpha,
    });
  }

  return buildResult(nodes, pos, rc, cfg);
};
