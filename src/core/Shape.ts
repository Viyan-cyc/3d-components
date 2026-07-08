import * as THREE from 'three';
import type { GroupComponentOptions, IDisposable } from '../types';
import {
  type Vec3Tuple,
  type V2,
  EPS,
  dedupe,
  radiusAtWithDefault,
  filletPolyline,
  ensureCCW,
  traceContour,
  toShape2D,
} from '../utils/filletUtils';

// Re-export Vec3Tuple for convenience
export type { Vec3Tuple };

// ===================== types =====================

/** 单个异形面的配置。 */
export interface ShapeData {
  /** XZ 平面轮廓点 `[x, y, z]`（y 被忽略），首尾自动闭合。至少 3 个点。 */
  path: Vec3Tuple[];
  /** 挤出高度（沿 Y 轴）。 */
  height: number;
  /**
   * 拐角圆角半径。可为：
   *  - 统一数值：所有拐角使用同一半径（全局值）；
   *  - 数组：按 `path` 顶点索引逐个指定，**有值用该值，`undefined` 回退到全局 `radius`**。
   *
   * 例如 `radius: [0.5, undefined, 1]` 表示第 0 个拐角 0.5、第 1 个用全局值、第 2 个 1。
   * @default 0
   */
  radius?: number | (number | undefined)[];
  /** 圆角分段数（越大越圆滑）。 @default 8 */
  radiusSegments?: number;
  /**
   * 贴图沿轮廓方向的映射方式（参考 {@link Path} 的 `uvMode`）：
   *  - `'repeat'`（默认）= 按物理长度平铺：侧面 `u = 沿轮廓弧长(米)`、`v = 高度(米)`；
   *    顶/底面 `u = x(米)`、`v = z(米)`。配合 `THREE.RepeatWrapping` 可重复贴图。
   *  - `'stretch'` = 一张贴图铺满：侧面 `u` 归一化到 `[0,1]`、`v` 归一化到 `[0,1]`；
   *    顶/底面 `u/v` 也归一化到 `[0,1]`。
   * @default 'repeat'
   */
  uvMode?: 'repeat' | 'stretch';
}

/** Options for constructing a {@link Shape}. */
export interface ShapeOptions extends GroupComponentOptions {
  /** 一组异形面数据，每个元素生成一个挤出几何体。 */
  shapes: ShapeData[];
  /** 共享材质。所有异形面复用。不传则使用默认 `MeshStandardMaterial`（`dispose()` 时一并释放）。 */
  material?: THREE.Material;
}

// ===================== UV recalculation =====================

/**
 * 重算异形面 UV，让纹理沿轮廓弧长（u）和高度/平面（v）铺贴。
 *
 * 侧面：`u = 沿轮廓弧长 / uScale`、`v = 世界高度 / vScale`，
 * 与 {@link Wall} / {@link Path} 的 `'repeat'` / `'stretch'` 模式一致。
 *
 * 顶/底面：使用平面投影 UV（`u = x 范围`、`v = z 范围`），
 * 适合地板/台面等需要按平面铺贴的场景。
 */
function applyShapeUV(
  geo: THREE.BufferGeometry,
  samples: V2[],
  height: number,
  uvMode: 'repeat' | 'stretch',
): void {
  const posAttr = geo.getAttribute('position');
  const uvAttr = geo.getAttribute('uv');
  if (!posAttr || !uvAttr) return;

  const m = samples.length;
  if (m < 3) return;

  // ---- 侧面弧长参数（与 Wall 一致） ----
  const segLen = new Float64Array(m);
  for (let i = 0; i < m; i++) segLen[i] = samples[i].distanceTo(samples[(i + 1) % m]);
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + segLen[i - 1];
  const totalLen = cum[m - 1] + segLen[m - 1]; // 总是闭合

  // ---- 顶/底面包围盒（平面投影 UV） ----
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const s of samples) {
    // samples 在 shape space (x, -z)；世界 XZ 对应 (s.x, _, -s.y)
    const wx = s.x;
    const wz = -s.y;
    if (wx < minX) minX = wx;
    if (wx > maxX) maxX = wx;
    if (wz < minZ) minZ = wz;
    if (wz > maxZ) maxZ = wz;
  }
  const rangeX = maxX - minX || 1;
  const rangeZ = maxZ - minZ || 1;

  const uScale = uvMode === 'stretch' ? totalLen : 1; // repeat → 原始米数
  const vScale = uvMode === 'stretch' ? height || 1 : 1;
  const uScaleTop = uvMode === 'stretch' ? rangeX : 1;
  const vScaleTop = uvMode === 'stretch' ? rangeZ : 1;

  const count = posAttr.count;
  for (let i = 0; i < count; i++) {
    const wx = posAttr.getX(i);
    const wy = posAttr.getY(i);
    const wz = posAttr.getZ(i);

    // 判断顶面/底面 vs 侧面：ExtrudeGeometry 的封盖顶点 y 精确在 0 或 height
    const isTop = Math.abs(wy - height) < 0.001;
    const isBottom = Math.abs(wy) < 0.001;

    if (isTop || isBottom) {
      // 顶/底面：平面投影 UV
      const u = (wx - minX) / uScaleTop;
      const v = (wz - minZ) / vScaleTop;
      uvAttr.setXY(i, u, v);
    } else {
      // 侧面：弧长投影 UV（与 Wall 一致）
      const qx = wx;
      const qy = -wz; // 世界 (x, z) → shape space (x, -z)

      let bestDist = Infinity;
      let bestArc = 0;
      for (let s = 0; s < m; s++) {
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
      const v = wy / vScale;
      uvAttr.setXY(i, u, v);
    }
  }
  uvAttr.needsUpdate = true;
}

// ===================== geometry builder =====================

/**
 * 构建单个异形面的挤出几何体：
 * 1. XZ 路径 → 2D shape space
 * 2. 去重 + 圆角
 * 3. THREE.Shape + ExtrudeGeometry
 * 4. 旋转到世界空间
 * 5. 重算 UV
 */
function buildShapeGeometry(data: ShapeData): THREE.BufferGeometry | null {
  if (!Array.isArray(data.path) || data.path.length < 3 || data.height <= 0) return null;

  const radiusSegments = data.radiusSegments ?? 8;
  const radiusInput = data.radius ?? 0;

  // 逐顶点解析半径（有单独设置用单独的，没有用全局值）
  // radiusAtWithDefault: 数组中 undefined → 回退到标量值（即全局 radius）；标量直接返回
  const globalR = typeof radiusInput === 'number' ? radiusInput : 0;
  const radii: number[] = data.path.map((_, i) => radiusAtWithDefault(radiusInput, globalR, i));

  // 转换到 2D shape space
  const outline2D = data.path.map(toShape2D);
  const deduped = dedupe(outline2D);
  if (deduped.length < 3) return null;

  // 圆角（Shape 总是闭合）
  const samples = filletPolyline(deduped, radii, radiusSegments, true);
  if (samples.length < 3) return null;

  // 确保逆时针（ExtrudeGeometry 要求外轮廓 CCW）
  ensureCCW(samples);

  // 构建 THREE.Shape
  const shape = new THREE.Shape();
  traceContour(shape, samples);

  // 挤出
  const geo = new THREE.ExtrudeGeometry(shape, { depth: data.height, bevelEnabled: false, steps: 1 });
  geo.rotateX(-Math.PI / 2); // shape space (x, -z, height) → world (x, height, z)

  // 重算 UV
  applyShapeUV(geo, samples, data.height, data.uvMode ?? 'repeat');

  return geo;
}

// ===================== Shape component =====================

/**
 * Shape — 异形面绘制组件。
 *
 * 接收 XZ 平面上的轮廓点，挤出指定高度，生成带圆角的实心几何体。
 * 与 {@link Wall} 类似（都是 XZ 路径 + Y 挤出），但 Shape 是**实心填充区域**
 * （无 width 偏移、无孔洞），Wall 是厚路径描边。
 *
 * **特性:**
 * - 继承 `THREE.Group`，可直接加入任意 Three.js 场景
 * - 轮廓路径定义在 XZ 平面（y 被忽略），从 `y = 0` 向上挤出至 `y = height`
 * - 轮廓**总是闭合**（首尾自动相连形成封闭区域）
 * - 每个拐角按 `radius` 倒圆角；数组形式可逐顶点指定，`undefined` 回退到全局值
 * - UV 沿轮廓弧长（u）/ 高度（v）重算，支持 `uvMode: 'repeat' | 'stretch'`
 * - 所有异形面共享同一材质；未传入材质时使用默认 `MeshStandardMaterial`
 * - 实现 {@link IDisposable} —— `dispose()` 释放全部几何体（自建材质一并释放）
 *
 * @example
 * ```ts
 * import { Shape } from '@cyc/3d-components/core';
 *
 * // L 形异形台面
 * const shape = new Shape({
 *   shapes: [{
 *     path: [[0,0,0], [4,0,0], [4,0,2], [2,0,2], [2,0,5], [0,0,5]],
 *     height: 0.6,
 *     radius: 0.3,
 *     radiusSegments: 12,
 *     uvMode: 'repeat',
 *   }],
 * });
 * scene.add(shape);
 *
 * // 混合圆角：第 0、3 个拐角 0.5，其余用全局值 0.2
 * const shape2 = new Shape({
 *   shapes: [{
 *     path: [[0,0,0], [3,0,0], [3,0,3], [0,0,3]],
 *     height: 0.4,
 *     radius: [0.5, undefined, undefined, 0.5],  // 第 1、2 个用全局 0.2
 *     radiusSegments: 12,
 *   }],
 * });
 * scene.add(shape2);
 * ```
 *
 * @extends THREE.Group
 *
 * Implements {@link IDisposable}.
 */
export class Shape extends THREE.Group implements IDisposable {
  private readonly material: THREE.Material;
  private readonly ownsMaterial: boolean;

  constructor(options: ShapeOptions) {
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

    const shapes = Array.isArray(options.shapes) ? options.shapes : [];
    for (const data of shapes) {
      const geometry = buildShapeGeometry(data);
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

  /** 释放所有异形面几何体；若材质由本组件创建则一并释放。 */
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
