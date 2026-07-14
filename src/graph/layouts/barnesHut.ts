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
 * 算法参考 Barnes & Hut (1986) 与经典实现（如 barnes-hut.c / d3-force 的对应思路）。
 *
 * 仅内部使用：由 `force.ts` 在 `barnesHut: true`（且 `dimensions: 3`）时调用，
 * 把斥力累积写入它已分配的 `fx/fy/fz` 缓冲（与精确成对分支同一接口，便于替换）。
 */

/** 距离平方下限（与 force.ts 的 EPS_D2 一致，防奇点）。 */
const EPS_D2 = 1e-4;
/** 八叉树最大深度（防完全重合点无限细分；2^40 已远低于浮点分辨率）。 */
const MAX_DEPTH = 40;

/**
 * 八叉树节点。
 *
 * - 空节点：`count === 0`。
 * - 叶子节点（单质点）：`body >= 0`，`children === null`。
 * - 内部节点（已细分）：`body === -1`，`children` 为长度 8 的数组（空槽为 `null`）。
 * - 「聚合叶」（达到 {@link MAX_DEPTH} 仍重合）：`body === -2`，不再细分，仅聚合。
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
  /** 叶子：唯一质点下标（≥0）；内部：-1；聚合叶：-2。 */
  body: number;
  /** 8 个象限子节点（内部节点，空槽为 `null`）；叶子为 `null`。 */
  children: (OctreeNode | null)[] | null;
}

/** 新建空叶子节点（给定包围立方体）。 */
function makeNode(minX: number, minY: number, minZ: number, size: number): OctreeNode {
  return { minX, minY, minZ, size, count: 0, cx: 0, cy: 0, cz: 0, body: -1, children: null };
}

/** 计算点 `(px,py,pz)` 落在节点内的象限下标（0–7，按 xyz 三位编码）。 */
function octantOf(
  node: OctreeNode,
  px: number,
  py: number,
  pz: number,
): number {
  const hx = node.minX + node.size * 0.5;
  const hy = node.minY + node.size * 0.5;
  const hz = node.minZ + node.size * 0.5;
  return (px >= hx ? 1 : 0) | (py >= hy ? 2 : 0) | (pz >= hz ? 4 : 0);
}

/** 把质点 `(bx,by,bz)` 的质量并入节点聚合（增量更新质心与计数）。 */
function aggregate(node: OctreeNode, bx: number, by: number, bz: number): void {
  const n = node.count;
  node.cx = (node.cx * n + bx) / (n + 1);
  node.cy = (node.cy * n + by) / (n + 1);
  node.cz = (node.cz * n + bz) / (n + 1);
  node.count = n + 1;
}

/** 新建一个已放入单质点 `bodyIdx` 的叶子（其包围立方体由父节点象限导出）。 */
function makeLeafFrom(
  parent: OctreeNode,
  idx: number,
  bodyIdx: number,
  px: Float64Array,
  py: Float64Array,
  pz: Float64Array,
): OctreeNode {
  const half = parent.size * 0.5;
  const node = makeNode(
    parent.minX + (idx & 1 ? half : 0),
    parent.minY + (idx & 2 ? half : 0),
    parent.minZ + (idx & 4 ? half : 0),
    half,
  );
  node.body = bodyIdx;
  node.count = 1;
  node.cx = px[bodyIdx];
  node.cy = py[bodyIdx];
  node.cz = pz[bodyIdx];
  return node;
}

/**
 * 递归插入质点 `bodyIdx` 到子树 `node`。
 *
 * - 空叶 → 直接放入。
 * - 单质点叶 → 细分（除非已达 {@link MAX_DEPTH}，则转为聚合叶）：把原质点落下到对应象限子节点，
 *   再递归插入新质点。
 * - 内部节点 → 递归进入对应象限。
 * - 插入完成后增量更新本节点质心/计数。
 */
function insert(
  node: OctreeNode,
  bodyIdx: number,
  depth: number,
  px: Float64Array,
  py: Float64Array,
  pz: Float64Array,
): void {
  const bx = px[bodyIdx];
  const by = py[bodyIdx];
  const bz = pz[bodyIdx];

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
  if (node.body === -2) {
    aggregate(node, bx, by, bz);
    return;
  }

  // 单质点叶：需细分（或转聚合叶）。
  if (node.body >= 0) {
    if (depth >= MAX_DEPTH) {
      // 深度封顶：转为聚合叶，并入新质点（原质点的聚合已在 count=1/cx 里）。
      node.body = -2;
      aggregate(node, bx, by, bz);
      return;
    }
    // 细分：把已存在的那个质点落下到对应象限。
    const existing = node.body;
    node.body = -1;
    node.children = new Array<OctreeNode | null>(8).fill(null);
    const ei = octantOf(node, px[existing], py[existing], pz[existing]);
    node.children[ei] = makeLeafFrom(node, ei, existing, px, py, pz);
    // 注意：node 的聚合（count=1, 质心=existing）保持不变 —— existing 仍在子树内。
  }

  // 内部节点：递归进入新质点所在象限。
  const idx = octantOf(node, bx, by, bz);
  if (!node.children![idx]) node.children![idx] = makeNode(...childCorner(node, idx), node.size * 0.5);
  insert(node.children![idx]!, bodyIdx, depth + 1, px, py, pz);

  // 回溯：并入本层。
  aggregate(node, bx, by, bz);
}

/** 子节点 `(minX,minY,minZ)` 元组（spread 给 makeNode，避免重复对象分配）。 */
function childCorner(node: OctreeNode, idx: number): [number, number, number] {
  const half = node.size * 0.5;
  return [
    node.minX + (idx & 1 ? half : 0),
    node.minY + (idx & 2 ? half : 0),
    node.minZ + (idx & 4 ? half : 0),
  ];
}

/**
 * 计算质点 `bodyIdx` 受到的来自 `node` 子树的斥力（Barnes-Hut 遍历），累积写入 `fx/fy/fz`。
 *
 * 开角判据：`size/d < θ` ⟺ `size² < θ²·d²` → 把整棵子树当作质心处的 `count` 个质点近似。
 * 叶子（单质点或聚合叶）总是直接计算。跳过「自身」（叶子恰好是 bodyIdx）。
 */
function repulsionFrom(
  node: OctreeNode,
  bodyIdx: number,
  theta2: number,
  charge: number,
  px: Float64Array,
  py: Float64Array,
  pz: Float64Array,
  fx: Float64Array,
  fy: Float64Array,
  fz: Float64Array,
): void {
  if (node.count === 0) return;
  // 叶子恰好是自身：跳过。
  if (node.body === bodyIdx) return;

  const bx = px[bodyIdx];
  const by = py[bodyIdx];
  const bz = pz[bodyIdx];
  // 从受力质点指向子树质心的向量。
  let dx = node.cx - bx;
  let dy = node.cy - by;
  let dz = node.cz - bz;
  let d2 = dx * dx + dy * dy + dz * dz;
  if (d2 < EPS_D2) {
    // 与质心重合：给一个微小确定性偏移，避免 0 方向（与 force.ts 一致）。
    dx = 1e-3;
    dy = 1e-3;
    dz = 1e-3;
    d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < EPS_D2) d2 = EPS_D2;
  }

  // 叶子（body>=0 或聚合叶 body===-2）直接计算；内部节点满足开角判据则近似。
  const isLeaf = node.body >= 0 || node.body === -2;
  if (isLeaf || node.size * node.size < theta2 * d2) {
    const dist = Math.sqrt(d2);
    // 力大小 = charge · count / d²（count = 聚合质量）。
    const f = (charge * node.count) / d2;
    const inv = f / dist;
    // 受力方向：远离质心 = -(dx,dy,dz)/dist。
    fx[bodyIdx] -= dx * inv;
    fy[bodyIdx] -= dy * inv;
    fz[bodyIdx] -= dz * inv;
    return;
  }

  // 不满足开角判据：递归进入 8 个子节点。
  const children = node.children!;
  for (let i = 0; i < 8; i++) {
    const c = children[i];
    if (c) repulsionFrom(c, bodyIdx, theta2, charge, px, py, pz, fx, fy, fz);
  }
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
export function barnesHutRepulsion(
  px: Float64Array,
  py: Float64Array,
  pz: Float64Array,
  n: number,
  charge: number,
  theta: number,
  fx: Float64Array,
  fy: Float64Array,
  fz: Float64Array,
): void {
  if (n === 0) return;

  // 1) 计算包围立方体（取三轴最大跨度为边长，居中）。
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = px[i];
    const y = py[i];
    const z = pz[i];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  let size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!Number.isFinite(size) || size <= 0) size = 1;
  // 略微外扩，确保边界点严格落在立方体内（象限归属稳定）。
  const pad = size * 1e-4 + 1e-6;
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const half = size * 0.5 + pad;
  const root = makeNode(cx - half, cy - half, cz - half, half * 2);

  // 2) 逐点插入建树。
  for (let i = 0; i < n; i++) insert(root, i, 0, px, py, pz);

  // 3) 逐点遍历八叉树累积斥力。
  const theta2 = theta * theta;
  for (let i = 0; i < n; i++) repulsionFrom(root, i, theta2, charge, px, py, pz, fx, fy, fz);
}
