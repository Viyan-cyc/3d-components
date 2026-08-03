/**
 * @module graph/layouts/barnesHut
 *
 * Barnes-Hut 3D 斥力近似（内部模块，零 Three.js 依赖，不导出至 barrel）。
 *
 * 将 `force` 布局的成对库仑斥力从 `O(n²)` 降到 `O(n log n)`：构建三维**八叉树**（octree），
 * 每个内部节点聚合其子树内所有质点的**质心与质量**（这里质量=质点数，每点 1）；
 * 计算某质点受力时，若子树足够「远」（开角判据 `s/d < θ`），就把整棵子树当作位于其质心的
 * 单个质点近似，否则递归进入子节点。
 *
 * Barnes-Hut 八叉树算法。
 *
 * 仅内部使用：由 `force.ts` 在 `barnesHut: true`（且 `dimensions: 3`）时调用，
 * 把斥力累积写入它已分配的 `fx/fy/fz` 缓冲（与精确成对分支同一接口，便于替换）。
 */

/** 距离平方下限（与 force.ts 的 EPS_D2 一致，防奇点）。 */
const EPS_D2 = 1e-4;

/** 八叉树最大深度（防完全重合点无限细分；2^40 已远低于浮点分辨率）。 */
const MAX_DEPTH = 40;

/** 八叉树象限数。 */
const OCTANT_COUNT = 8;

/** 包围盒半长系数。 */
const HALF = 0.5;

/** 象限 xyz 三位编码位掩码：x位=1, y位=2, z位=4。 */
const BIT_X = 1;
const BIT_Y = 2;
const BIT_Z = 4;

/** 内部节点 body 标记（已细分）。 */
const BODY_INTERNAL = -1;

/** 聚合叶 body 标记（深度封顶，不再细分）。 */
const BODY_AGGREGATE = -2;

/** 微小确定性偏移量（防重合/零方向，与 force.ts 一致）。 */
const MICRO_OFFSET = 1e-3;

/** 包围盒外扩比例系数。 */
const PAD_RATIO = 1e-4;

/** 包围盒外扩绝对量。 */
const PAD_ABS = 1e-6;

/**
 * 八叉树节点。
 *
 * - 空节点：`count === 0`。
 * - 叶子节点（单质点）：`body >= 0`，`children === null`。
 * - 内部节点（已细分）：`body === BODY_INTERNAL`，`children` 为长度 8 的数组（空槽为 `null`）。
 * - 「聚合叶」（达到 {@link MAX_DEPTH} 仍重合）：`body === BODY_AGGREGATE`，不再细分，仅聚合。
 *
 * `cx/cy/cz` 为子树质心（质量加权平均）；`count` 为子树质点数（=质量）。
 */
interface OctreeNode {

  /** 包围立方体最小角。 */
  minX: number;
  minY: number;
  minZ: number;

  /** 包围立方体边长。 */
  size: number;

  /** 子树质点数（= 质量）。 */
  count: number;

  /** 子树质心。 */
  cx: number;
  cy: number;
  cz: number;

  /** 叶子：唯一质点下标（≥0）；内部：BODY_INTERNAL；聚合叶：BODY_AGGREGATE。 */
  body: number;

  /** 8 个象限子节点（内部节点，空槽为 `null`）；叶子为 `null`。 */
  children: (OctreeNode | null)[] | null;
}

/** 质点坐标缓冲（减少函数参数数量）。 */
interface PositionsBuffer {
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
}

/** 力缓冲。 */
interface ForceBuffer {
  fx: Float64Array;
  fy: Float64Array;
  fz: Float64Array;
}

/** 斥力遍历参数。 */
interface RepulsionParams {
  node: OctreeNode;
  bodyIdx: number;
  theta2: number;
  charge: number;
  pos: PositionsBuffer;
  force: ForceBuffer;
}

/** 单次斥力施加参数。 */
interface RepulsionForceParams {
  bodyIdx: number;
  dx: number;
  dy: number;
  dz: number;
  d2: number;
  charge: number;
  count: number;
  force: ForceBuffer;
}

/** 新建空叶子节点（给定包围立方体）。 */
const makeNode = function (minX: number, minY: number, minZ: number, size: number): OctreeNode {
  return {
    minX,
    minY,
    minZ,
    size,
    count: 0,
    cx: 0,
    cy: 0,
    cz: 0,
    body: BODY_INTERNAL,
    children: null,
  };
};

/** 计算点 `(px,py,pz)` 落在节点内的象限下标（0–7，按 xyz 三位编码）。 */
const octantOf = function (node: OctreeNode, px: number, py: number, pz: number): number {
  const hx = node.minX + node.size * HALF;
  const hy = node.minY + node.size * HALF;
  const hz = node.minZ + node.size * HALF;
  return (px >= hx ? BIT_X : 0) | (py >= hy ? BIT_Y : 0) | (pz >= hz ? BIT_Z : 0);
};

/** 把质点 `(bx,by,bz)` 的质量并入节点聚合（增量更新质心与计数）。 */
const aggregate = function (node: OctreeNode, bx: number, by: number, bz: number): void {
  const n = node.count;
  node.cx = (node.cx * n + bx) / (n + 1);
  node.cy = (node.cy * n + by) / (n + 1);
  node.cz = (node.cz * n + bz) / (n + 1);
  node.count = n + 1;
};

/** 子节点 `(minX,minY,minZ)` 元组（spread 给 makeNode，避免重复对象分配）。 */
const childCorner = function (node: OctreeNode, idx: number): [number, number, number] {
  const half = node.size * HALF;
  return [
    node.minX + (idx & BIT_X ? half : 0),
    node.minY + (idx & BIT_Y ? half : 0),
    node.minZ + (idx & BIT_Z ? half : 0),
  ];
};

/** 新建一个已放入单质点 `bodyIdx` 的叶子（其包围立方体由父节点象限导出）。 */
const makeLeafFrom = function (
  parent: OctreeNode,
  idx: number,
  bodyIdx: number,
  positions: PositionsBuffer,
): OctreeNode {
  const half = parent.size * HALF;
  const node = makeNode(
    parent.minX + (idx & BIT_X ? half : 0),
    parent.minY + (idx & BIT_Y ? half : 0),
    parent.minZ + (idx & BIT_Z ? half : 0),
    half,
  );
  node.body = bodyIdx;
  node.count = 1;
  node.cx = positions.px[bodyIdx];
  node.cy = positions.py[bodyIdx];
  node.cz = positions.pz[bodyIdx];
  return node;
};

/**
 * 细分单质点叶节点：把已存在的质点落下到对应象限子节点。
 */
const subdivideLeaf = function (
  node: OctreeNode,
  buf: PositionsBuffer,
): void {
  const existing = node.body;
  node.body = BODY_INTERNAL;
  node.children = new Array<OctreeNode | null>(OCTANT_COUNT).fill(null);
  const ei = octantOf(node, buf.px[existing], buf.py[existing], buf.pz[existing]);
  node.children[ei] = makeLeafFrom(node, ei, existing, buf);
};

/**
 * 递归插入质点 `bodyIdx` 到子树 `node`。
 *
 * - 空叶 → 直接放入。
 * - 单质点叶 → 细分（除非已达 {@link MAX_DEPTH}，则转为聚合叶）。
 * - 内部节点 → 递归进入对应象限。
 * - 插入完成后增量更新本节点质心/计数。
 */
const insert = function (
  node: OctreeNode,
  bodyIdx: number,
  depth: number,
  buf: PositionsBuffer,
): void {
  const bx = buf.px[bodyIdx];
  const by = buf.py[bodyIdx];
  const bz = buf.pz[bodyIdx];

  // 空叶：放入。
  if (node.count === 0) {
    node.body = bodyIdx;
    node.count = 1;
    node.cx = bx;
    node.cy = by;
    node.cz = bz;
    return;
  }

  // 已是聚合叶（深度封顶）：仅并入质量，不再细分。
  if (node.body === BODY_AGGREGATE) {
    aggregate(node, bx, by, bz);
    return;
  }

  // 单质点叶：需细分（或转聚合叶）。
  if (node.body >= 0) {
    if (depth >= MAX_DEPTH) {
      // 深度封顶：转为聚合叶，并入新质点。
      node.body = BODY_AGGREGATE;
      aggregate(node, bx, by, bz);
      return;
    }
    // 细分：把已存在的那个质点落下到对应象限。
    subdivideLeaf(node, buf);
  }

  // 内部节点：递归进入新质点所在象限。
  const idx = octantOf(node, bx, by, bz);
  if (node.children![idx] === null) {
    node.children![idx] = makeNode(...childCorner(node, idx), node.size * HALF);
  }
  insert(node.children![idx], bodyIdx, depth + 1, buf);

  // 回溯：并入本层。
  aggregate(node, bx, by, bz);
};

/**
 * 处理重合/极近距离：给一个微小确定性偏移，避免 0 方向。
 */
const applyMicroOffset = function (bodyIdx: number): { dx: number; dy: number; dz: number; d2: number } {
  const dx = (bodyIdx % 2 === 0 ? 1 : -1) * MICRO_OFFSET + MICRO_OFFSET;
  const dy = MICRO_OFFSET;
  const dz = MICRO_OFFSET;
  const d2 = dx * dx + dy * dy + dz * dz;
  return {
    dx, dy, dz, d2: d2 < EPS_D2 ? EPS_D2 : d2,
  };
};

/**
 * 计算并施加单个斥力：力大小 = charge · count / d²。
 */
const applyRepulsionForce = function (p: RepulsionForceParams): void {
  const dist = Math.sqrt(p.d2);
  const f = (p.charge * p.count) / p.d2;
  const inv = f / dist;
  // 受力方向：远离质心 = -(dx,dy,dz)/dist。
  p.force.fx[p.bodyIdx] -= p.dx * inv;
  p.force.fy[p.bodyIdx] -= p.dy * inv;
  p.force.fz[p.bodyIdx] -= p.dz * inv;
};

/**
 * 计算质点 `bodyIdx` 受到的来自 `node` 子树的斥力（Barnes-Hut 遍历），累积写入 `fx/fy/fz`。
 *
 * 开角判据：`size/d < θ` ⟺ `size² < θ²·d²` → 把整棵子树当作质心处的 `count` 个质点近似。
 * 叶子（单质点或聚合叶）总是直接计算。跳过「自身」（叶子恰好是 bodyIdx）。
 */
const repulsionFrom = function (p: RepulsionParams): void {
  if (p.node.count === 0) {
    return;
  }
  // 叶子恰好是自身：跳过。
  if (p.node.body === p.bodyIdx) {
    return;
  }

  const bx = p.pos.px[p.bodyIdx];
  const by = p.pos.py[p.bodyIdx];
  const bz = p.pos.pz[p.bodyIdx];
  // 从受力质点指向子树质心的向量。
  let dx = p.node.cx - bx;
  let dy = p.node.cy - by;
  let dz = p.node.cz - bz;
  let d2 = dx * dx + dy * dy + dz * dz;
  if (d2 < EPS_D2) {
    const offset = applyMicroOffset(p.bodyIdx);
    dx = offset.dx;
    dy = offset.dy;
    dz = offset.dz;
    d2 = offset.d2;
  }

  // 叶子（body>=0 或聚合叶）直接计算；内部节点满足开角判据则近似。
  const isLeaf = p.node.body >= 0 || p.node.body === BODY_AGGREGATE;
  if (isLeaf || p.node.size * p.node.size < p.theta2 * d2) {
    applyRepulsionForce({
      bodyIdx: p.bodyIdx,
      dx,
      dy,
      dz,
      d2,
      charge: p.charge,
      count: p.node.count,
      force: p.force,
    });
    return;
  }

  // 不满足开角判据：递归进入 8 个子节点。
  const children = p.node.children!;
  for (let i = 0; i < OCTANT_COUNT; i++) {
    const c = children[i];
    if (c) {
      repulsionFrom({ ...p, node: c });
    }
  }
};

/** 八叉树构建参数。 */
interface BuildRootParams {
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  n: number;
}

/**
 * 计算包围立方体并构建根节点。
 */
const buildRoot = function (p: BuildRootParams): OctreeNode {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < p.n; i++) {
    const x = p.px[i];
    const y = p.py[i];
    const z = p.pz[i];
    if (x < minX) {
      minX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (z < minZ) {
      minZ = z;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y > maxY) {
      maxY = y;
    }
    if (z > maxZ) {
      maxZ = z;
    }
  }
  let size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (Number.isFinite(size) === false || size <= 0) {
    size = 1;
  }
  // 略微外扩，确保边界点严格落在立方体内（象限归属稳定）。
  const pad = size * PAD_RATIO + PAD_ABS;
  const cx = (minX + maxX) * HALF;
  const cy = (minY + maxY) * HALF;
  const cz = (minZ + maxZ) * HALF;
  const half = size * HALF + pad;
  return makeNode(cx - half, cy - half, cz - half, half * 2);
};

/** Barnes-Hut 函数的参数。 */
interface BarnesHutParams {
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  n: number;
  charge: number;
  theta: number;
  fx: Float64Array;
  fy: Float64Array;
  fz: Float64Array;
}

/**
 * 用 Barnes-Hut 八叉树近似计算全部成对斥力，累积写入 `fx/fy/fz`（不清零，调用者负责清零）。
 *
 * @param px/py/pz - 质点坐标（长度 `n`）。
 * @param n - 质点数。
 * @param charge - 斥力强度（正值=斥）。
 * @param theta - 开角阈值。
 * @param fx/fy/fz - 力累积缓冲（已由调用者分配并清零）。
 */
export const barnesHutRepulsion = function (p: BarnesHutParams): void {
  if (p.n === 0) {
    return;
  }

  const pos: PositionsBuffer = { px: p.px, py: p.py, pz: p.pz };
  const forceBuf: ForceBuffer = { fx: p.fx, fy: p.fy, fz: p.fz };

  // 1) 计算包围立方体并构建根节点。
  const root = buildRoot({
    px: p.px, py: p.py, pz: p.pz, n: p.n,
  });

  // 2) 逐点插入建树。
  for (let i = 0; i < p.n; i++) {
    insert(root, i, 0, pos);
  }

  // 3) 逐点遍历八叉树累积斥力。
  const theta2 = p.theta * p.theta;
  for (let i = 0; i < p.n; i++) {
    repulsionFrom({
      node: root,
      bodyIdx: i,
      theta2,
      charge: p.charge,
      pos,
      force: forceBuf,
    });
  }
};
