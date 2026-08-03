
import * as THREE from 'three';
import {
  EPS,
  type V2,
  type Vec3Tuple,
  dedupe,
  ensureCCW,
  filletPolyline,
  radiusAtWithDefault,
  toShape2D,
  traceContour,
} from '../utils/filletUtils';
import type { GroupComponentOptions, IDisposable } from '../types';

// Re-export Vec3Tuple for convenience
export type { Vec3Tuple };

// ===================== constants =====================

const MIN_PATH_POINTS = 3;
const DEFAULT_RADIUS_SEGMENTS = 8;
const TOP_CAP_TOLERANCE = 0.001;

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

// ===================== UV recalculation helpers =====================

/** Build a lookup table marking which vertices belong to cap groups. */
const buildCapVertexLookup = (
  geo: THREE.BufferGeometry,
  count: number,
): Uint8Array => {
  const isCapVertex = new Uint8Array(count);
  const groups = geo.groups;
  const indexAttr = geo.getIndex();

  for (const group of groups) {
    if (group.materialIndex !== 0) {
      continue; // eslint-disable-line no-continue
    }
    // 封盖 group — 标记其索引范围内的顶点
    const end = group.start + group.count;
    if (indexAttr) {
      // group 使用索引，需要通过 index buffer 映射到顶点
      for (let i = group.start; i < end; i++) {
        const vi = indexAttr.getX(i);
        isCapVertex[vi] = 1;
      }
    } else {
      // 无索引缓冲（非索引几何体）
      for (let i = group.start; i < end; i++) {
        isCapVertex[i] = 1;
      }
    }
  }
  return isCapVertex;
};

/** Compute segment lengths and cumulative arc lengths for closed samples. */
const computeArcLengths = (samples: V2[]) => {
  const m = samples.length;
  const segLen = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    segLen[i] = samples[i].distanceTo(samples[(i + 1) % m]);
  }
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) {
    cum[i] = cum[i - 1] + segLen[i - 1];
  }
  const totalLen = cum[m - 1] + segLen[m - 1];
  return { segLen, cum, totalLen };
};

/** Compute the world-space bounding box of samples in XZ plane. */
const computeXZBounds = (samples: V2[]) => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of samples) {
    // samples 在 shape space (x, -z)；世界 XZ 对应 (s.x, _, -s.y)
    const wx = s.x;
    const wz = -s.y;
    if (wx < minX) {
      minX = wx;
    }
    if (wx > maxX) {
      maxX = wx;
    }
    if (wz < minZ) {
      minZ = wz;
    }
    if (wz > maxZ) {
      maxZ = wz;
    }
  }
  return {
    minX, maxX, minZ, maxZ,
  };
};

/** Project a world point onto the closest sample segment and return its arc length. */
const projectToArcLength = (
  qx: number,
  qy: number,
  samples: V2[],
  segLen: Float64Array,
  cum: Float64Array,
): number => {
  const m = samples.length;
  let bestDist = Infinity;
  let bestArc = 0;
  for (let s = 0; s < m; s++) {
    const a = samples[s];
    const b = samples[(s + 1) % m];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > EPS ? ((qx - a.x) * dx + (qy - a.y) * dy) / len2 : 0;
    if (t < 0) {
      t = 0;
    } else if (t > 1) {
      t = 1;
    }
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const dd = (px - qx) * (px - qx) + (py - qy) * (py - qy);
    if (dd < bestDist) {
      bestDist = dd;
      bestArc = cum[s] + t * segLen[s];
    }
  }
  return bestArc;
};

/** Parameters for setting cap UV. */
interface CapUVParams {
  minX: number;
  maxZ: number;
  minZ: number;
  uScaleTop: number;
  vScaleTop: number;
  height: number;
}

/** Set UV for a cap (top/bottom face) vertex using planar projection. */
const setCapUV = (
  uvAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
  pos: { x: number; y: number; z: number },
  params: CapUVParams,
): void => {
  const u = (pos.x - params.minX) / params.uScaleTop;
  // 顶面（wy ≈ height）从上方俯视时 Z 轴方向与底面仰视相反，需翻转 v
  const isTopCap = Math.abs(pos.y - params.height) < TOP_CAP_TOLERANCE;
  // 顶面：翻转 Z 方向，使俯视纹理与底面一致
  // 底面：正常方向
  const v = isTopCap
    ? (params.maxZ - pos.z) / params.vScaleTop
    : (pos.z - params.minZ) / params.vScaleTop;
  uvAttr.setXY(index, u, v);
};

/** Parameters for setting side UV. */
interface SideUVParams {
  samples: V2[];
  segLen: Float64Array;
  cum: Float64Array;
  uScale: number;
  vScale: number;
}

/** Set UV for a side vertex using arc-length projection. */
const setSideUV = (
  uvAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
  pos: { x: number; y: number; z: number },
  params: SideUVParams,
): void => {
  const qx = pos.x;
  // 世界 (x, z) → shape space (x, -z)
  const qy = -pos.z;
  const bestArc = projectToArcLength(qx, qy, params.samples, params.segLen, params.cum);
  const u = bestArc / params.uScale;
  const v = pos.y / params.vScale;
  uvAttr.setXY(index, u, v);
};

/** Compute UV scale factors based on mode and geometry bounds. */
const computeUVScales = (
  uvMode: 'repeat' | 'stretch',
  totalLen: number,
  height: number,
  rangeX: number,
  rangeZ: number,
) => {
  const uScale = uvMode === 'stretch' ? totalLen : 1;
  const vScale = uvMode === 'stretch' ? height || 1 : 1;
  const uScaleTop = uvMode === 'stretch' ? rangeX : 1;
  const vScaleTop = uvMode === 'stretch' ? rangeZ : 1;
  return {
    uScale, vScale, uScaleTop, vScaleTop,
  };
};

/** Apply UV to all vertices based on cap/side classification. */
const applyUVToVertices = (
  posAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  uvAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  isCapVertex: Uint8Array,
  capParams: CapUVParams,
  sideParams: SideUVParams,
): void => {
  const count = posAttr.count;
  for (let i = 0; i < count; i++) {
    const pos = {
      x: posAttr.getX(i),
      y: posAttr.getY(i),
      z: posAttr.getZ(i),
    };
    if (isCapVertex[i]) {
      setCapUV(uvAttr, i, pos, capParams);
    } else {
      setSideUV(uvAttr, i, pos, sideParams);
    }
  }
};

/**
 * 重算异形面 UV，让纹理沿轮廓弧长（u）和高度/平面（v）铺贴。
 *
 * 侧面：`u = 沿轮廓弧长 / uScale`、`v = 世界高度 / vScale`，
 * 与 {@link Wall} / {@link Path} 的 `'repeat'` / `'stretch'` 模式一致。
 *
 * 顶/底面：使用平面投影 UV（`u = x 范围`、`v = z 范围`），
 * 适合地板/台面等需要按平面铺贴的场景。
 *
 * 使用 ExtrudeGeometry 的 group 信息区分封盖（group 0）和侧面（group 1），
 * 避免侧面边缘顶点（y=0 或 y=height）被误判为封盖。
 */
const applyShapeUV = (
  geo: THREE.BufferGeometry,
  samples: V2[],
  height: number,
  uvMode: 'repeat' | 'stretch',
): void => {
  const posAttr = geo.getAttribute('position');
  const uvAttr = geo.getAttribute('uv');
  if (!posAttr || !uvAttr) {
    return;
  }
  if (samples.length < MIN_PATH_POINTS) {
    return;
  }

  const isCapVertex = buildCapVertexLookup(geo, posAttr.count);
  const { segLen, cum, totalLen } = computeArcLengths(samples);
  const {
    minX, maxX, minZ, maxZ,
  } = computeXZBounds(samples);
  const rangeX = maxX - minX || 1;
  const rangeZ = maxZ - minZ || 1;
  const scales = computeUVScales(uvMode, totalLen, height, rangeX, rangeZ);

  const capParams: CapUVParams = {
    minX,
    maxZ,
    minZ,
    uScaleTop: scales.uScaleTop,
    vScaleTop: scales.vScaleTop,
    height,
  };
  const sideParams: SideUVParams = {
    samples,
    segLen,
    cum,
    uScale: scales.uScale,
    vScale: scales.vScale,
  };

  applyUVToVertices(posAttr, uvAttr, isCapVertex, capParams, sideParams);
  uvAttr.needsUpdate = true;
};

// ===================== geometry builder =====================

/** Validate that shape data has sufficient path points and positive height. */
const isShapeDataValid = (data: ShapeData): boolean => (
  Array.isArray(data.path) && data.path.length >= MIN_PATH_POINTS && data.height > 0
);

/** Build the 2D shape from path data with deduplication and filleting. */
const buildFilletSamples = (
  data: ShapeData,
  radiusSegments: number,
) => {
  const radiusInput = data.radius ?? 0;
  // 逐顶点解析半径（有单独设置用单独的，没有用全局值）
  // radiusAtWithDefault: 数组中 undefined → 回退到标量值（即全局 radius）；标量直接返回
  const globalR = typeof radiusInput === 'number' ? radiusInput : 0;
  const radii = data.path.map((_, i) => radiusAtWithDefault(radiusInput, globalR, i));

  const outline2D = data.path.map(toShape2D);
  const deduped = dedupe(outline2D);
  if (deduped.length < MIN_PATH_POINTS) {
    return null;
  }

  // 圆角（Shape 总是闭合）
  const samples = filletPolyline(deduped, radii, radiusSegments, true);
  if (samples.length < MIN_PATH_POINTS) {
    return null;
  }

  // 确保逆时针（ExtrudeGeometry 要求外轮廓 CCW）
  ensureCCW(samples);
  return { samples, radii };
};

/**
 * 构建单个异形面的挤出几何体：
 * 1. XZ 路径 → 2D shape space
 * 2. 去重 + 圆角
 * 3. THREE.Shape + ExtrudeGeometry
 * 4. 旋转到世界空间
 * 5. 重算 UV
 */
const buildShapeGeometry = (data: ShapeData): THREE.BufferGeometry | null => {
  if (!isShapeDataValid(data)) {
    return null;
  }

  const radiusSegments = data.radiusSegments ?? DEFAULT_RADIUS_SEGMENTS;
  const result = buildFilletSamples(data, radiusSegments);
  if (!result) {
    return null;
  }

  const { samples } = result;

  // 构建 THREE.Shape
  const shape = new THREE.Shape();
  traceContour(shape, samples);

  // 挤出
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: data.height,
    bevelEnabled: false,
    steps: 1,
  });
  // shape space (x, -z, height) → world (x, height, z)
  geo.rotateX(-Math.PI / 2);

  // 重算 UV
  applyShapeUV(geo, samples, data.height, data.uvMode ?? 'repeat');

  return geo;
};

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
 * import { Shape } from '@a3d/a3d-components/core';
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

    if (options.name) {
      this.name = options.name;
    }
    if (options.visible !== undefined) {
      this.visible = options.visible;
    }
    if (options.userData) {
      this.userData = { ...options.userData };
    }

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
      if (!geometry) {
        continue; // eslint-disable-line no-continue
      }
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.add(mesh);
    }

    if (options.children) {
      for (const child of options.children) {
        this.add(child);
      }
    }
  }

  /** 释放所有异形面几何体；若材质由本组件创建则一并释放。 */
  dispose(): void {
    this.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
      }
    });
    this.clear();
    if (this.ownsMaterial) {
      this.material.dispose();
    }
  }
}
