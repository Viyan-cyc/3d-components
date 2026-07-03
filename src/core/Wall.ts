
import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';
import type { GroupComponentOptions, IDisposable } from '../types';

/** 2D point used internally. */
type V2 = THREE.Vector2;
/** A 3D coordinate tuple, e.g. `[x, y, z]`. */
export type Vec3Tuple = [number, number, number];

const EPS = 1e-6;

/**
 * 单个墙洞（窗户 / 门）的配置。
 *
 * 墙洞画在墙的**立面**上，沿墙体厚度方向**贯通**（通过 CSG 实体布尔减运算挖出）。
 * 每个墙洞归属于某一段墙体（`segment`），并用该段的局部 2D 坐标描述轮廓。
 */
export interface WallHole {
  /** 所属墙段的索引。段 `i` 对应路径 `path[i] → path[i+1]`。 */
  segment: number;

  /**
   * 墙洞轮廓，该段的局部 2D 坐标 `[x, y]`，首尾自动闭合：
   *  - `x` = 沿该段直墙段的距离（从段起点计量，`0 … 段直墙长度`）
   *  - `y` = 高度（`0 … height`，`0` 为墙底）
   *
   * 例如一扇窗：`[[1.2, 0.9], [2.0, 0.9], [2.0, 1.6], [1.2, 1.6]]`。
   */
  path: [number, number][];

  /** 开口轮廓拐角的圆角半径。 @default 0 */
  radius?: number;

  /** 圆角分段数（越大越圆滑）。 @default 8 */
  radiusSegments?: number;
}

/** 单面墙的配置。 */
export interface WallData {
  /** 墙体中心线路径，XZ 平面坐标 `[x, y, z]`（y 被忽略，墙体从 y=0 向上生长）。 */
  path: Vec3Tuple[];
  /** 墙体厚度（向路径两侧各加厚 `width / 2`）。 */
  width: number;
  /** 墙体高度（沿 Y 轴挤出）。 */
  height: number;
  /**
   * 拐角圆角半径。可为：
   *  - 统一数值：所有拐角使用同一半径；
   *  - 数组：按 `path` 顶点索引逐个指定，**每个拐角独立调弧度**（元素 `0` = 该拐角直角）。
   *
   * 小于墙体半厚（`width / 2`）的半径会自动按直角处理（内侧无法圆角）。
   * @default 0
   */
  radius?: number | number[];
  /** 圆角分段数（越大越圆滑）。 @default 8 */
  radiusSegments?: number;
  /** 墙体首尾是否闭合（闭合时形成环形墙体）。 @default false */
  close?: boolean;
  /**
   * 墙面贴图的 UV 映射方式（参考 {@link Path} 的 `uvMode`）。
   *
   * 默认 `ExtrudeGeometry` 的 UV 来自墙体俯视轮廓的 2D 形状坐标，与墙面毫无关系——
   * 贴上去的纹理（砖墙 / 窗户）会被任意拉伸错位。本组件会重算 UV，让纹理沿墙长、墙高铺贴：
   *  - `'repeat'`（默认）= 按物理尺寸平铺：`u = 沿墙弧长(米)`、`v = 墙高(米)`。
   *    一个 UV 单位 = 1 米，配合 `THREE.RepeatWrapping` 与 `texture.repeat` 即可重复贴图
   *    （如整面砖墙、一排等距窗户）。
   *  - `'stretch'` = 一张贴图铺满整面墙：`u` 归一化到 `[0,1]`（沿整段墙长）、`v = y / height`。
   *
   * 墙洞（窗 / 门）由 CSG 挖出，其表面 UV 由布尔运算插值继承，贴图会在开口周围连续过渡。
   * @default 'repeat'
   */
  uvMode?: 'repeat' | 'stretch';
  /** 墙洞（窗户 / 门）列表，按 `segment` 归属到对应墙段，贯通墙体厚度。 */
  hole?: WallHole[];
}

/** Options for constructing a {@link Wall}. */
export interface WallOptions extends GroupComponentOptions {
  /** 一组墙体数据，每个元素绘制一面墙。 */
  walls: WallData[];
  /** 共享材质。所有墙体复用。不传则使用默认 `MeshStandardMaterial`（`dispose()` 时一并释放）。 */
  material?: THREE.Material;
}

// ===================== internal 2D helpers =====================

function dedupe(input: V2[]): V2[] {
  const out: V2[] = [];
  for (const p of input) {
    const last = out[out.length - 1];
    if (!last || last.distanceTo(p) > EPS) out.push(p);
  }
  return out;
}

/** Resolve a per-vertex radius from either a scalar or an array (missing → 0). */
function radiusAt(radius: number | number[], i: number): number {
  return Array.isArray(radius) ? radius[i] ?? 0 : radius;
}

/** Rounded corner arc between two segments (or null if straight / degenerate). */
interface Corner {
  t1: V2;
  t2: V2;
  center: V2;
  rEff: number;
  a1: number;
  delta: number;
}

function computeCorner(prev: V2, cur: V2, next: V2, r: number): Corner | null {
  const d1x = cur.x - prev.x;
  const d1y = cur.y - prev.y;
  const d2x = next.x - cur.x;
  const d2y = next.y - cur.y;
  const len1 = Math.hypot(d1x, d1y);
  const len2 = Math.hypot(d2x, d2y);
  if (len1 <= EPS || len2 <= EPS) return null;
  const u1x = d1x / len1;
  const u1y = d1y / len1;
  const u2x = d2x / len2;
  const u2y = d2y / len2;
  const dot = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
  if (dot > 0.999999) return null;
  const cross = u1x * u2y - u1y * u2x;
  const turnSign = cross >= 0 ? 1 : -1;
  const alpha = Math.acos(dot);
  let t = r * Math.tan(alpha / 2);
  const maxT = Math.min(len1, len2) * 0.5;
  if (t > maxT) t = maxT;
  if (t <= EPS) return null;
  const rEff = t / Math.tan(alpha / 2);
  const t1 = new THREE.Vector2(cur.x - u1x * t, cur.y - u1y * t);
  const t2 = new THREE.Vector2(cur.x + u2x * t, cur.y + u2y * t);
  const cx = t1.x - u1y * turnSign * rEff;
  const cy = t1.y + u1x * turnSign * rEff;
  return { t1, t2, center: new THREE.Vector2(cx, cy), rEff, a1: Math.atan2(t1.y - cy, t1.x - cx), delta: turnSign * alpha };
}

/** A straight run between (possibly rounded) corners. */
interface Run {
  start: V2; // world XZ
  end: V2; // world XZ
  len: number;
}

/** Decompose a world-XZ path into straight runs (for hole placement). */
function decomposePath(input: V2[], radius: number | number[], close: boolean): Run[] {
  const pts = dedupe(input);
  const n = pts.length;
  if (n < 2) return [];
  const nSeg = close ? n : n - 1;
  const cornerAt: (Corner | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const internal = close ? n >= 3 : i >= 1 && i <= n - 2;
    if (!internal) continue;
    cornerAt[i] = computeCorner(pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n], radiusAt(radius, i));
  }
  const runs: Run[] = [];
  for (let i = 0; i < nSeg; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const startC = cornerAt[i];
    const endC = cornerAt[(i + 1) % n];
    const start = startC ? startC.t2.clone() : a.clone();
    const end = endC ? endC.t1.clone() : b.clone();
    runs.push({ start, end, len: start.distanceTo(end) });
  }
  return runs;
}

/** Round the corners of a polyline into a dense point list (centerline / hole outline). */
function filletPolyline(input: V2[], radius: number | number[], segments: number, close: boolean): V2[] {
  const pts = dedupe(input);
  const n = pts.length;
  if (n < 2) return pts.map((p) => p.clone());
  const seg = Math.max(1, Math.floor(segments));
  const out: V2[] = [];
  const handle = (i: number, prev: V2, cur: V2, next: V2) => {
    const c = computeCorner(prev, cur, next, Math.max(0, radiusAt(radius, i)));
    if (!c) {
      out.push(cur.clone());
      return;
    }
    out.push(c.t1);
    for (let k = 1; k < seg; k++) {
      const a = c.a1 + (c.delta * k) / seg;
      out.push(new THREE.Vector2(c.center.x + c.rEff * Math.cos(a), c.center.y + c.rEff * Math.sin(a)));
    }
    out.push(c.t2);
  };
  if (close && n >= 3) {
    for (let i = 0; i < n; i++) handle(i, pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n]);
  } else {
    out.push(pts[0].clone());
    for (let i = 1; i < n - 1; i++) handle(i, pts[i - 1], pts[i], pts[i + 1]);
    out.push(pts[n - 1].clone());
  }
  return out;
}

function signedArea(poly: V2[]): number {
  let a = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
function ensureCCW(poly: V2[]): void {
  if (signedArea(poly) < 0) poly.reverse();
}
function ensureCW(poly: V2[]): void {
  if (signedArea(poly) > 0) poly.reverse();
}
function traceContour(path: THREE.Path | THREE.Shape, poly: V2[]): void {
  if (poly.length === 0) return;
  path.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) path.lineTo(poly[i].x, poly[i].y);
  path.closePath();
}

/** Convert a path point into 2D shape space (x, -z) so extrude + rotateX lands in the XZ plane. */
function toShape2D(p: Vec3Tuple): V2 {
  return new THREE.Vector2(p[0], -p[2]);
}

/**
 * 重算墙体 UV，让纹理沿墙长（u = 圆角中心线弧长）向上铺贴（v = 世界高度），
 * 与 {@link Path} 的 `'repeat'` / `'stretch'` 两种 uv 模式一致。
 *
 * 默认 `ExtrudeGeometry` 的 UV 来自俯视轮廓的 2D 形状坐标，与墙面没有对应关系，
 * 贴图会被任意拉伸。把每个顶点投影到中心线、取其弧长作为 u，能得到稳定可预期的映射：
 *  - `'repeat'`：`u` = 沿墙距离（米）、`v` = 墙高（米），用 `texture.repeat` + `RepeatWrapping` 平铺；
 *  - `'stretch'`：`u`、`v` 归一化到 `[0,1]`，一张贴图铺满整面墙。
 *
 * `samples` 为圆角中心线（shape space `(x, -z)`）；该空间下距离与世界 XZ 距离一致（纯反射）。
 * three-bvh-csg 的 Evaluator 默认会插值 `uv` 属性，因此 CSG 挖出的墙洞会继承这些 UV，
 * 贴图在开口周围连续过渡。
 */
function applyWallUV(
  geo: THREE.BufferGeometry,
  samples: V2[],
  height: number,
  uvMode: 'repeat' | 'stretch',
  closed: boolean,
): void {
  const posAttr = geo.getAttribute('position');
  const uvAttr = geo.getAttribute('uv');
  if (!posAttr || !uvAttr) return;

  const m = samples.length;
  if (m < 2) return;

  // 各段长度 + 累积弧长（闭合时含末段→首段的回环段）。
  const segLen = new Float64Array(m);
  for (let i = 0; i < m - 1; i++) segLen[i] = samples[i].distanceTo(samples[i + 1]);
  if (closed) segLen[m - 1] = samples[m - 1].distanceTo(samples[0]);
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + segLen[i - 1];
  const totalLen = closed ? cum[m - 1] + segLen[m - 1] : cum[m - 1];

  const uScale = uvMode === 'stretch' ? totalLen || 1 : 1; // repeat → 原始米数
  const vScale = uvMode === 'stretch' ? height || 1 : 1;

  const segCount = closed ? m : m - 1;
  const count = posAttr.count;
  for (let i = 0; i < count; i++) {
    // 世界顶点 (x, y, z) → 中心线 shape space (x, -z)。
    const qx = posAttr.getX(i);
    const qy = -posAttr.getZ(i);

    // 投影到最近的中心线段 → 弧长参数。
    let bestDist = Infinity;
    let bestArc = 0;
    for (let s = 0; s < segCount; s++) {
      const a = samples[s];
      const b = samples[(s + 1) % m];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 > EPS ? ((qx - a.x) * dx + (qy - a.y) * dy) / len2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const dd = (px - qx) * (px - qx) + (py - qy) * (py - qy);
      if (dd < bestDist) {
        bestDist = dd;
        bestArc = cum[s] + t * segLen[s];
      }
    }

    const u = bestArc / uScale;
    const vWorld = posAttr.getY(i);
    const v = uvMode === 'stretch' ? vWorld / vScale : vWorld;
    uvAttr.setXY(i, u, v);
  }
  uvAttr.needsUpdate = true;
}

/**
 * Build the wall BODY as a single water-tight extruded footprint: the rounded thick-stroke
 * outline of the centerline (closed ⇒ outer rail + inner rail hole; open ⇒ single outline),
 * extruded upward by `height`. Smooth rounded corners, crisp edges, no seams.
 */
function buildBodyGeometry(data: WallData, radius: number | number[], radiusSegments: number, close: boolean): THREE.BufferGeometry | null {
  const halfWidth = data.width / 2;
  const centerline = data.path.map(toShape2D);
  const samples = filletPolyline(centerline, radius, radiusSegments, close);
  if (samples.length < 2) return null;

  // Offset rails (±halfWidth) along each sample's normal.
  const m = samples.length;
  const left: V2[] = [];
  const right: V2[] = [];
  for (let i = 0; i < m; i++) {
    let tx: number;
    let ty: number;
    if (close) {
      const p0 = samples[(i - 1 + m) % m];
      const p2 = samples[(i + 1) % m];
      tx = p2.x - p0.x;
      ty = p2.y - p0.y;
    } else {
      const a = samples[Math.max(0, i - 1)];
      const b = samples[Math.min(m - 1, i + 1)];
      tx = b.x - a.x;
      ty = b.y - a.y;
    }
    const tl = Math.hypot(tx, ty) || 1;
    const nx = -ty / tl;
    const ny = tx / tl;
    left.push(new THREE.Vector2(samples[i].x + nx * halfWidth, samples[i].y + ny * halfWidth));
    right.push(new THREE.Vector2(samples[i].x - nx * halfWidth, samples[i].y - ny * halfWidth));
  }

  const shape = new THREE.Shape();
  if (close && m >= 3) {
    // Annulus footprint: bigger rail = outer contour, smaller = inner hole.
    const outer = Math.abs(signedArea(left)) >= Math.abs(signedArea(right)) ? left : right;
    const inner = outer === left ? right : left;
    ensureCCW(outer);
    ensureCW(inner);
    traceContour(shape, outer);
    if (inner.length >= 3) {
      const ip = new THREE.Path();
      traceContour(ip, inner);
      shape.holes.push(ip);
    }
  } else {
    const outline: V2[] = [...left, ...right.reverse()];
    ensureCCW(outline);
    traceContour(shape, outline);
  }

  const geo = new THREE.ExtrudeGeometry(shape, { depth: data.height, bevelEnabled: false, steps: 1 });
  geo.rotateX(-Math.PI / 2); // shape space (x, -z, height) → world (x, height, z)
  // 用沿墙长 / 墙高的 UV 覆盖 ExtrudeGeometry 默认的俯视轮廓 UV（墙洞经 CSG 插值继承）。
  applyWallUV(geo, samples, data.height, data.uvMode ?? 'repeat', close);
  return geo;
}

/**
 * Build one hole as a water-tight extruded prism in WORLD space, positioned/oriented on its
 * segment's face and oversized across so it cuts clean through the wall thickness.
 */
function buildHoleGeometry(h: WallHole, runs: Run[], width: number): THREE.BufferGeometry | null {
  if (h.segment < 0 || h.segment >= runs.length) return null;
  if (!Array.isArray(h.path) || h.path.length < 3) return null;
  const run = runs[h.segment];
  if (run.len <= EPS) return null;

  const seg = h.radiusSegments ?? 8;
  const raw = h.path.map((p) => new THREE.Vector2(p[0], p[1]));
  const rounded = filletPolyline(raw, h.radius ?? 0, seg, true);
  if (rounded.length < 3) return null;

  const shape = new THREE.Shape();
  traceContour(shape, rounded);

  // Oversized across so the prism pokes through both wall surfaces → clean boolean cut.
  const acrossDepth = width + 1;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: acrossDepth, bevelEnabled: false, steps: 1 });

  // Orient: shape.x → along run, shape.y → up, shape.z → across; origin at run.start, centered across.
  const dx = (run.end.x - run.start.x) / run.len;
  const dy = (run.end.y - run.start.y) / run.len;
  const ax = -dy;
  const ay = dx;
  const mat = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(dx, 0, dy),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(ax, 0, ay),
  );
  mat.setPosition(new THREE.Vector3(run.start.x - (ax * acrossDepth) / 2, 0, run.start.y - (ay * acrossDepth) / 2));
  geo.applyMatrix4(mat);
  return geo;
}

/** Build one wall's final geometry: body minus all holes (CSG). */
function buildWallGeometry(data: WallData, evaluator: Evaluator): THREE.BufferGeometry | null {
  if (!Array.isArray(data.path) || data.path.length < 2 || data.width <= 0 || data.height <= 0) return null;
  const close = data.close === true && data.path.length >= 3;
  const radiusSegments = data.radiusSegments ?? 8;
  // Resolve per-vertex radii (scalar broadcasts to all; array is indexed by path vertex),
  // snapping any radius ≤ halfWidth to 0 (sharp): a smaller radius makes the inner offset
  // rail self-intersect (negative inner radius) and corrupts the top-face triangulation,
  // and it can't be rounded on the inside anyway.
  const halfWidth = data.width / 2;
  const radiusInput = data.radius ?? 0;
  const radii: number[] = data.path.map((_, i) => {
    const r = radiusAt(radiusInput, i);
    return r > halfWidth ? r : 0;
  });

  const body = buildBodyGeometry(data, radii, radiusSegments, close);
  if (!body) return null;

  const holes = Array.isArray(data.hole) ? data.hole : [];
  if (holes.length === 0) return body;

  // Straight runs (world XZ) for hole placement.
  const runs = decomposePath(
    data.path.map((p) => new THREE.Vector2(p[0], p[2])),
    radii,
    close,
  );

  let current = new Brush(body);
  current.updateMatrixWorld();
  for (const h of holes) {
    const hg = buildHoleGeometry(h, runs, data.width);
    if (!hg) continue;
    const hb = new Brush(hg);
    hb.updateMatrixWorld();
    current = evaluator.evaluate(current, hb, SUBTRACTION);
  }
  return current.geometry;
}

// ===================== Wall component =====================

/**
 * Wall — 墙体绘制组件。
 *
 * 每面墙先生成一个水密、带圆角的「厚路径挤出」实体（无缝、无割裂感），再用 CSG
 * （three-bvh-csg）从其上减去每个墙洞（窗 / 门）的棱柱——因此墙洞是真正的实体布尔开口，
 * 边缘干净、与墙体连续。
 *
 * **特性:**
 * - 继承 `THREE.Group`，可直接加入任意 Three.js 场景
 * - 墙体路径定义在 XZ 平面（y 被忽略），从 `y = 0` 向上生长至 `y = height`
 * - 每个拐角按 `radius` / `radiusSegments` 倒圆角；`close = true` 时形成环形墙体
 * - 支持每段独立的墙洞（{@link WallHole}，窗 / 门），按段局部坐标描述并贯通墙体厚度
 * - UV 沿墙长（u）/ 墙高（v）重算，支持 `uvMode: 'repeat' | 'stretch'`，便于整面贴图（砖墙 / 窗户）；
 *   墙洞经 CSG 挖出后贴图在开口周围连续过渡
 * - 所有墙体共享同一材质；未传入材质时使用默认 `MeshStandardMaterial`
 * - 实现 {@link IDisposable} —— `dispose()` 释放全部几何体（自建材质一并释放）
 *
 * @example
 * ```ts
 * import { Wall } from '@cyc/3d-components/core';
 *
 * const wall = new Wall({
 *   walls: [
 *     {
 *       path: [[0, 0, 0], [6, 0, 0], [6, 0, 5], [0, 0, 5]],
 *       width: 0.25,
 *       height: 3,
 *       radius: 1,
 *       close: true,
 *       hole: [
 *         // 第 0 段（[0,0,0]→[6,0,0]）上的一扇门：沿墙 2~4m、高 0~2.1m
 *         { segment: 0, path: [[2, 0], [4, 0], [4, 2.1], [2, 2.1]] },
 *       ],
 *     },
 *   ],
 * });
 * scene.add(wall);
 * ```
 *
 * @extends THREE.Group
 *
 * Implements {@link IDisposable}.
 */
export class Wall extends THREE.Group implements IDisposable {
  private readonly material: THREE.Material;
  private readonly ownsMaterial: boolean;
  private readonly evaluator: Evaluator;

  constructor(options: WallOptions) {
    super();

    if (options.name) this.name = options.name;
    if (options.visible !== undefined) this.visible = options.visible;
    if (options.userData) this.userData = { ...options.userData };

    this.ownsMaterial = !options.material;
    this.material =
      options.material ??
      new THREE.MeshStandardMaterial({
        color: 0xb0b0b0,
        roughness: 0.9,
        metalness: 0.0,
        side: THREE.FrontSide,
      });

    this.evaluator = new Evaluator();
    this.evaluator.useGroups = false;

    const walls = Array.isArray(options.walls) ? options.walls : [];
    for (const data of walls) {
      const geometry = buildWallGeometry(data, this.evaluator);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.add(mesh);
    }

    if (options.children) {
      for (const child of options.children) this.add(child);
    }
  }

  /** 释放所有墙体几何体；若材质由本组件创建则一并释放。 */
  dispose(): void {
    this.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry?.dispose();
    });
    this.clear();
    if (this.ownsMaterial) {
      this.material.dispose();
    }
  }
}
