
import * as THREE from 'three';
import { animate, type AnimationController } from '../animation';
import type { GroupComponentOptions, IDisposable } from '../types';

/** A 3D coordinate tuple, e.g. `[x, y, z]`. */
export type Vec3Tuple = [number, number, number];

// ===================== types =====================

/** 'tube' = 圆管扫掠；'plane' = 扁平带状面。 */
export type PathMode = 'tube' | 'plane';

/** 单条路径的配置。 */
export interface PathData {

  /** 路径顶点（3D）。 */
  path: Vec3Tuple[];

  /** 生成模式：'tube' = 圆管，'plane' = 扁平带。 @default 'tube' */
  mode?: PathMode;

  /**
   * 拐角圆角半径（bevelRadius）。`> 0` 时拐角用二次贝塞尔曲线倒圆角；
   * `0` 时为纯折线（直角拐角）。
   * @default 0
   */
  bevelRadius?: number;

  /** 路径是否自动闭合（首尾相连成环）。 @default false */
  close?: boolean;

  /**
   * up 向量。决定标架的法向（进而决定平面带的朝向与管道截面的起始朝向）。
   * 不传则用 Frenet 自动选取（与 three.js TubeGeometry 行为一致）。
   */
  up?: Vec3Tuple;

  /** 非直线段的曲线采样分段数。 @default 12 */
  divisions?: number;

  /**
   * 贴图沿路径方向的映射方式：
   *  - 'repeat'（默认）= 按物理长度平铺，`u = arclength / 截面周长或带宽`，配合 `THREE.RepeatWrapping` 可重复贴图；
   *  - 'stretch' = 一张贴图从头铺到尾，`u` 归一化到 `[0, 1]`（整条路径只贴一次）。
   * @default 'repeat'
   */
  uvMode?: 'repeat' | 'stretch';

  // ---- tube 模式专用 ----
  /** 管道半径。 @default 0.1 */
  radius?: number;

  /** 圆周分段数（越大越圆滑）。 @default 8 */
  radialSegments?: number;

  /** 截面起始角偏移（弧度）。 @default 0 */
  startRad?: number;

  /** 是否生成起点封盖。 @default false */
  generateStartCap?: boolean;

  /** 是否生成终点封盖。 @default false */
  generateEndCap?: boolean;

  // ---- plane 模式专用 ----
  /** 带宽。 @default 0.1 */
  width?: number;

  /** 带相对中心线的偏侧：'both' 居中、'left' 仅一侧、'right' 仅另一侧。 @default 'both' */
  side?: 'both' | 'left' | 'right';

  /** 是否在锐角拐角做几何修补（避免带面撕裂）。 @default false */
  sharp?: boolean;

  /** 末端是否生成箭头。 @default false */
  arrow?: boolean;
}

/**
 * 流光效果配置。
 *
 * 作用于**整组 paths**：把各路径段按物理长度占比拼接成统一的全局 `[0,1]` 空间，
 * 一条带拖尾的高亮光带从第一个 path 流向最后一个 path。
 */
export interface FlowOptions {

  /** 是否开启流光。 @default false */
  enabled?: boolean;

  /** 流光颜色。 @default 0xffffff */
  color?: THREE.ColorRepresentation;

  /** 流动速度（全局圈/秒）。 @default 1 */
  speed?: number;

  /** 流动方向：`1` = 第一条 → 最后一条，`-1` = 反向。 @default 1 */
  direction?: 1 | -1;

  /** 光头亮带占流光总长度的比例（`0-1`，越大光头越宽、拖尾越短）。 @default 0.25 */
  width?: number;

  /** 流光总长度（归一化到全局 `[0,1]`）；光头与拖尾按 `width` 比例分配，长度变化时拖尾始终可见。 @default 0.4 */
  tailLength?: number;

  /** 流光强度（emissive 叠加倍率，可 >1 求 HDR 发光）。 @default 2 */
  intensity?: number;

  /** 全局流光个数（沿整组 paths 等间距分布）。 @default 1 */
  repeat?: number;
}

/** Options for constructing a {@link Path}. */
export interface PathOptions extends GroupComponentOptions {

  /** 一组路径数据，每个元素生成一条管道或平面带。 */
  paths: PathData[];

  /** 共享材质。所有路径复用。不传则使用默认 `MeshStandardMaterial`（`dispose()` 时一并释放）。 */
  material?: THREE.Material;

  /**
   * 流光效果配置。开启后流光贯穿整组 paths（从第一条流向最后一条）。
   * 流光材质由本组件 clone 生成并独立释放，不影响传入的 `material`。 @default 不开启
   */
  flow?: FlowOptions;
}

// ===================== frames =====================

interface Frames {
  points: THREE.Vector3[];
  tangents: THREE.Vector3[];
  normals: THREE.Vector3[];
  binormals: THREE.Vector3[];
  bisectors: THREE.Vector3[];
  lengths: number[];
  widthScales: number[];
  sharps: boolean[];
  tangentTypes: number[];
}

interface TubeOptions {
  radius: number;
  radialSegments: number;
  startRad: number;
  generateStartCap: boolean;
  generateEndCap: boolean;
  uvMode: 'repeat' | 'stretch';
}

interface PlaneOptions {
  width: number;
  side: 'both' | 'left' | 'right';
  sharp: boolean;
  arrow: boolean;
  uvMode: 'repeat' | 'stretch';
}

interface GeometryBuffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  count: number;
}

interface TubeBuildContext {
  buffers: GeometryBuffers;
  radius: number;
  radialSegments: number;
  startRad: number;
  uScale: number;
  segmentVector: THREE.Vector3;
  quaternion: THREE.Quaternion;
  normalVector: THREE.Vector3;
  offsetVector: THREE.Vector3;
}

interface PlaneBuildContext {
  buffers: GeometryBuffers;
  width: number;
  side: 'both' | 'left' | 'right';
  sharp: boolean;
  halfWidth: number;
  uScale: number;
  sharpUvOffset: number;
  uvMode: 'repeat' | 'stretch';
  left: THREE.Vector3;
  right: THREE.Vector3;
  leftOffset: THREE.Vector3;
  rightOffset: THREE.Vector3;
  tempPoint1: THREE.Vector3;
  tempPoint2: THREE.Vector3;
}

// ===================== constants =====================

// 圆角起/止点距离的钳制系数，避免圆角把整段吃成零长度。
const BEVEL_CLAMP = 0.999999;
// 非直线段默认采样分段数。
const DEFAULT_DIVISIONS = 12;
// 拐角椭圆拉伸系数上限（约 √2），避免锐角处宽度爆炸。
const MAX_WIDTH_SCALE = 1.415;
// 判定锐角拐角的余弦阈值（cos 与 1 的差大于此值即锐角）。
const SHARP_COS_THRESHOLD = 0.05;
// 每个顶点的 position/normal 分量数。
const POS_COMPONENTS = 3;
// 每个顶点的 uv 分量数。
const UV_COMPONENTS = 2;
// 生成封盖所需的最小圆周分段数。
const MIN_RADIAL_FOR_CAP = 3;
// 锐角拐角修补四边形组的顶点数。
const VERTS_PER_SHARP_PATCH = 6;
// 箭头三角形的顶点数。
const ARROW_VERTS = 3;
// 箭头尖点外推量为半宽的倍数。
const ARROW_TIP_MULT = 3;
// repeat 模式下箭头尖点在 u 方向的外推量（repeat 单位）。
const ARROW_U_REPEAT = 1.5;
// both 侧箭头左顶点 v。
const ARROW_UV_LEFT_BOTH = -0.5;
// both 侧箭头右顶点 v。
const ARROW_UV_RIGHT_BOTH = 1.5;
// both 侧箭头尖点 v。
const ARROW_UV_TIP_BOTH = 0.5;
// 单侧箭头左顶点 v（left 模式）。
const ARROW_UV_LEFT_SINGLE = -2;
// 单侧箭头右顶点 v（right 模式）。
const ARROW_UV_RIGHT_SINGLE = 2;
// 16 位索引能容纳的最大顶点数。
const INDEX_16BIT_MAX = 65536;
// 去重时判定两点重合的距离阈值。
const DEDUP_EPSILON = 1e-6;
// 默认管道半径。
const DEFAULT_RADIUS = 0.1;
// 默认带宽。
const DEFAULT_WIDTH = 0.1;
// 默认圆周分段数。
const DEFAULT_RADIAL_SEGMENTS = 8;
// 闭合路径所需的最少顶点数。
const MIN_CLOSE_POINTS = 3;
// 流光默认光头占比（占流光总长度的比例，0-1）。
const DEFAULT_FLOW_WIDTH = 0.25;
// 流光默认总长度（归一化到全局 [0,1]）。
const DEFAULT_FLOW_TAIL = 0.4;
// 流光默认强度。
const DEFAULT_FLOW_INTENSITY = 2;
// 流光默认速度（全局圈/秒）。
const DEFAULT_FLOW_SPEED = 1;
// 流光默认重复个数。
const DEFAULT_FLOW_REPEAT = 1;
// uv 归一化除零保护。
const FLOW_U_EPSILON = 1e-5;
// 单帧 dt 限幅（秒），避免标签页恢复后相位大跳。
const FLOW_DT_CLAMP = 0.1;

// ===================== curve helpers =====================

/**
 * Scales a vector along the given direction by the given scale factor.
 * 等价于 t3d `Vector3.scaleAlong`（three.js 的 Vector3 无此方法）。
 * 算法：把 v 投影到 dir 上，把该投影的长度从 (v·dir) 替换为 scale。
 */
const scaleAlong = (
  v: THREE.Vector3,
  direction: THREE.Vector3,
  scale: number,
): THREE.Vector3 => {
  const proj = direction.clone().multiplyScalar(v.dot(direction));
  return v.sub(proj).addScaledVector(proj, scale);
};

/** 用纯直线段构造折线 CurvePath。 */
const setPolylines = (
  curvePath: THREE.CurvePath<THREE.Vector3>,
  points: THREE.Vector3[],
  close: boolean,
): void => {
  if (points.length < 2) {
    return;
  }
  const lastIndex = points.length - 1;
  const segments = close && !points[0].equals(points[lastIndex]) ? points.length : lastIndex;
  for (let i = 0; i < segments; i++) {
    const v1 = points[i].clone();
    const next = i === lastIndex ? points[0] : points[i + 1];
    const v2 = next.clone();
    curvePath.curves.push(new THREE.LineCurve3(v1, v2));
  }
};

/** 构造单段「直线 + 二次贝塞尔圆角」曲线并追加到 curvePath，同时推进 p0。 */
const appendBevelCurve = (
  curvePath: THREE.CurvePath<THREE.Vector3>,
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  options: { isFirst: boolean; isLast: boolean; close: boolean; bevelRadius: number },
): void => {
  const {
    isFirst, isLast, close, bevelRadius,
  } = options;
  // 开放路径的最后一段是直线。
  if (isLast && !close) {
    curvePath.curves.push(new THREE.LineCurve3(p0.clone(), p1.clone()));
    p0.copy(p1);
    return;
  }
  const lastDir = new THREE.Vector3().subVectors(p1, p0);
  const nextDir = new THREE.Vector3().subVectors(p2, p1);
  const lastDirLength = lastDir.length();
  const nextDirLength = nextDir.length();
  // 圆角起点距离：首段取半，避免起点的圆角吃掉整段。
  const v0Base = isFirst ? lastDirLength / 2 : lastDirLength;
  const v0Dist = Math.min(v0Base * BEVEL_CLAMP, bevelRadius);
  const v2Dist = Math.min((nextDirLength / 2) * BEVEL_CLAMP, bevelRadius);
  lastDir.normalize();
  nextDir.normalize();
  const lineEnd = p1.clone().sub(lastDir.clone().multiplyScalar(v0Dist));
  curvePath.curves.push(new THREE.LineCurve3(p0.clone(), lineEnd));
  const bezV2 = p1.clone().add(nextDir.clone().multiplyScalar(v2Dist));
  curvePath.curves.push(new THREE.QuadraticBezierCurve3(lineEnd.clone(), p1.clone(), bezV2));
  p0.copy(bezV2);
};

/**
 * 用「直线段 + 二次贝塞尔圆角」构造一条 three.js CurvePath
 * （bevelRadius=0 或点数≤2 时退化为纯折线）。
 */
const setBeveledCurves = (
  curvePath: THREE.CurvePath<THREE.Vector3>,
  input: THREE.Vector3[],
  bevelRadius: number,
  close: boolean,
): void => {
  const points = input;
  if (points.length < 2) {
    return;
  }
  // 退化为纯折线。
  if (bevelRadius === 0 || points.length === 2) {
    setPolylines(curvePath, points, close);
    return;
  }
  const lastIndex = points.length - 1;
  // 闭合且首尾不重合时，补一条末→首的段。
  const segments = close && !points[0].equals(points[lastIndex]) ? points.length : lastIndex;
  const p0 = points[0].clone();
  for (let i = 0; i < segments; i++) {
    const p1 = points[(i + 1) % (lastIndex + 1)];
    const p2 = points[(i + 2) % (lastIndex + 1)];
    appendBevelCurve(curvePath, p0, p1, p2, {
      isFirst: i === 0,
      isLast: i === segments - 1,
      close,
      bevelRadius,
    });
  }
  // 闭合时把首段起点修正到末段终点（让接缝连续）。
  if (close) {
    (curvePath.curves[0] as THREE.LineCurve3).v1.copy(p0);
  }
};

// ===================== frame computation =====================

/** 选一个与首切线垂直、且在最小组件方向上的初始法向。 */
const pickInitialNormal = (tangent: THREE.Vector3): THREE.Vector3 => {
  const tx = Math.abs(tangent.x);
  const ty = Math.abs(tangent.y);
  const tz = Math.abs(tangent.z);
  if (tx <= ty && tx <= tz) {
    return new THREE.Vector3(1, 0, 0);
  }
  if (ty <= tx && ty <= tz) {
    return new THREE.Vector3(0, 1, 0);
  }
  return new THREE.Vector3(0, 0, 1);
};

/** 沿 CurvePath 采样，写入 points 与每个采样点的 tangentType。 */
const sampleCurvePoints = (
  curvePath: THREE.CurvePath<THREE.Vector3>,
  options: { divisions: number; fixLine: boolean },
  points: THREE.Vector3[],
  tangentTypes: number[],
): void => {
  let tangentType = 0;
  const curves = curvePath.curves;
  for (let i = 0; i < curves.length; i++) {
    const curve = curves[i];
    const isLine = curve instanceof THREE.LineCurve3;
    const resolution = isLine ? 1 : options.divisions;
    const pts = curve.getPoints(resolution);
    const isLast = i === curves.length - 1;
    if (options.fixLine && isLine && !isLast) {
      const nextCurve = curves[i + 1];
      const isNextLine = nextCurve instanceof THREE.LineCurve3;
      if (!isNextLine) {
        tangentType = 1;
      }
    }
    const slice = isLast ? pts : pts.slice(0, -1);
    for (const pt of slice) {
      points.push(pt);
      tangentTypes.push(tangentType);
      if (tangentType === 1) {
        tangentType++;
      } else if (tangentType === 2) {
        tangentType = 0;
      }
    }
  }
};

/** 计算首点标架（tangent / normal / binormal / bisector）。 */
const initFirstFrame = (frames: Frames, up: THREE.Vector3 | null): void => {
  frames.tangents[0] = new THREE.Vector3();
  frames.normals[0] = new THREE.Vector3();
  frames.binormals[0] = new THREE.Vector3();
  frames.bisectors[0] = new THREE.Vector3();
  frames.tangents[0].subVectors(frames.points[1], frames.points[0]).normalize();
  if (up) {
    frames.normals[0].copy(up);
  } else {
    frames.normals[0].copy(pickInitialNormal(frames.tangents[0]));
  }
  frames.binormals[0].crossVectors(frames.tangents[0], frames.normals[0]).normalize();
  frames.normals[0].crossVectors(frames.binormals[0], frames.tangents[0]).normalize();
  frames.bisectors[0].copy(frames.binormals[0]);
  frames.lengths[0] = 0;
  frames.widthScales[0] = 1;
  frames.sharps[0] = false;
};

/** 计算中间点切向（按 tangentType 选择 lastDir / nextDir / 平均）。 */
const computeMidTangent = (tt: number, lastDir: THREE.Vector3, nextDir: THREE.Vector3): THREE.Vector3 => {
  const tangent = new THREE.Vector3();
  if (tt === 1) {
    tangent.copy(nextDir);
  } else if (tt === 2) {
    tangent.copy(lastDir);
  } else {
    tangent.addVectors(lastDir, nextDir).normalize();
  }
  return tangent;
};

/** 计算中间点标架与 widthScale / sharp 标记。 */
const computeMiddleFrames = (frames: Frames, up: THREE.Vector3 | null, frenet: boolean): void => {
  const lastDir = new THREE.Vector3();
  const nextDir = new THREE.Vector3();
  const rotMatrix = new THREE.Matrix4();
  for (let i = 1; i < frames.points.length - 1; i++) {
    lastDir.subVectors(frames.points[i], frames.points[i - 1]);
    nextDir.subVectors(frames.points[i + 1], frames.points[i]);
    const lastLength = lastDir.length();
    lastDir.normalize();
    nextDir.normalize();
    const bisector = new THREE.Vector3().subVectors(nextDir, lastDir).normalize();
    const tangent = computeMidTangent(frames.tangentTypes[i], lastDir, nextDir);
    const normal = new THREE.Vector3();
    const binormal = new THREE.Vector3();
    if (frenet) {
      normal.copy(frames.normals[i - 1]);
      const vec = binormal.crossVectors(frames.tangents[i - 1], tangent);
      if (vec.length() > Number.EPSILON) {
        vec.normalize();
        const theta = Math.acos(THREE.MathUtils.clamp(frames.tangents[i - 1].dot(tangent), -1, 1));
        normal.applyMatrix4(rotMatrix.makeRotationAxis(vec, theta));
      }
      binormal.crossVectors(tangent, normal).normalize();
    } else {
      normal.copy(up ?? frames.normals[i - 1]);
      if (tangent.dot(normal) === 1) {
        binormal.crossVectors(nextDir, normal).normalize();
      } else {
        binormal.crossVectors(tangent, normal).normalize();
      }
      normal.crossVectors(binormal, tangent).normalize();
    }
    frames.tangents[i] = tangent;
    frames.normals[i] = normal;
    frames.binormals[i] = binormal;
    frames.bisectors[i] = bisector;
    const cos = lastDir.dot(nextDir);
    frames.lengths[i] = frames.lengths[i - 1] + lastLength;
    frames.widthScales[i] = Math.min(1 / Math.sqrt((1 + cos) / 2), MAX_WIDTH_SCALE) || 1;
    frames.sharps[i] = Math.abs(cos - 1) > SHARP_COS_THRESHOLD;
  }
};

/** 计算末点标架；闭合时同步首点标架。 */
const computeLastFrame = (frames: Frames, close: boolean): void => {
  const points = frames.points;
  const lastIndex = points.length - 1;
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const bisector = new THREE.Vector3();
  const rotMatrix = new THREE.Matrix4();
  tangent.subVectors(points[lastIndex], points[lastIndex - 1]);
  const dist = tangent.length();
  if (close) {
    tangent.copy(frames.tangents[0]);
  } else {
    tangent.normalize();
  }
  normal.copy(frames.normals[lastIndex - 1]);
  const vec = binormal.crossVectors(frames.tangents[lastIndex - 1], tangent);
  if (vec.length() > Number.EPSILON) {
    vec.normalize();
    const theta = Math.acos(THREE.MathUtils.clamp(frames.tangents[lastIndex - 1].dot(tangent), -1, 1));
    normal.applyMatrix4(rotMatrix.makeRotationAxis(vec, theta));
  }
  binormal.crossVectors(tangent, normal).normalize();
  bisector.copy(binormal);
  frames.tangents[lastIndex] = tangent;
  frames.normals[lastIndex] = normal;
  frames.binormals[lastIndex] = binormal;
  frames.bisectors[lastIndex] = bisector;
  frames.lengths[lastIndex] = frames.lengths[lastIndex - 1] + dist;
  frames.widthScales[lastIndex] = 1;
  frames.sharps[lastIndex] = false;
  // 闭合时把首点标架同步成末点标架。
  if (close) {
    frames.tangents[0].copy(tangent);
    frames.normals[0].copy(normal);
    frames.binormals[0].copy(binormal);
    frames.bisectors[0].copy(bisector);
  }
};

/**
 * 沿 CurvePath 采样并计算 Frenet 标架（tangent / normal / binormal / bisector），
 * 以及每个采样点的 widthScale（拐角椭圆拉伸系数）与 sharp（是否锐角拐角）。
 */
const computeFrames = (
  curvePath: THREE.CurvePath<THREE.Vector3>,
  options: { up?: THREE.Vector3; divisions?: number; frenet?: boolean; fixLine?: boolean; close?: boolean },
): Frames => {
  const up = options.up ?? null;
  const divisions = options.divisions ?? DEFAULT_DIVISIONS;
  const frenet = options.frenet ?? true;
  const fixLine = options.fixLine ?? true;
  const close = options.close ?? false;
  const frames: Frames = {
    points: [],
    tangents: [],
    normals: [],
    binormals: [],
    bisectors: [],
    lengths: [],
    widthScales: [],
    sharps: [],
    tangentTypes: [],
  };
  sampleCurvePoints(curvePath, { divisions, fixLine }, frames.points, frames.tangentTypes);
  initFirstFrame(frames, up);
  computeMiddleFrames(frames, up, frenet);
  computeLastFrame(frames, close);
  return frames;
};

// ===================== geometry assembly =====================

/** 把扁平的 positions/normals/uvs/indices 数组组装成 three.js BufferGeometry。 */
const toGeometry = (
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
): THREE.BufferGeometry => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), POS_COMPONENTS));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), POS_COMPONENTS));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), UV_COMPONENTS));
  const useUint32 = positions.length / POS_COMPONENTS > INDEX_16BIT_MAX;
  const indexArray = useUint32 ? new Uint32Array(indices) : new Uint16Array(indices);
  geo.setIndex(new THREE.BufferAttribute(indexArray, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
};

// ===================== TubeBuilder =====================

/** 写入一帧的圆周顶点（锐角拐角处沿 bisector 把截面做椭圆拉伸避免撕裂）。 */
const pushTubeRing = (ctx: TubeBuildContext, frames: Frames, i: number): void => {
  const {
    buffers, radius, radialSegments, startRad, uScale,
    segmentVector, quaternion, normalVector, offsetVector,
  } = ctx;
  const uvDist = frames.lengths[i] / uScale;
  const sharp = frames.sharps[i];
  const widthScale = frames.widthScales[i];
  for (let r = 0; r <= radialSegments; r++) {
    const rIdx = r === radialSegments ? 0 : r;
    segmentVector.copy(frames.normals[i]);
    const angle = startRad + (Math.PI * 2 * rIdx) / radialSegments;
    quaternion.setFromAxisAngle(frames.tangents[i], angle);
    segmentVector.applyQuaternion(quaternion).normalize();
    if (sharp) {
      scaleAlong(offsetVector.copy(segmentVector), frames.bisectors[i], widthScale)
        .multiplyScalar(radius)
        .add(frames.points[i]);
      scaleAlong(normalVector.copy(segmentVector), frames.bisectors[i], 1 / widthScale)
        .normalize();
    } else {
      offsetVector.copy(segmentVector).multiplyScalar(radius * widthScale).add(frames.points[i]);
      normalVector.copy(segmentVector);
    }
    buffers.positions.push(offsetVector.x, offsetVector.y, offsetVector.z);
    buffers.normals.push(normalVector.x, normalVector.y, normalVector.z);
    buffers.uvs.push(uvDist, r / radialSegments);
    buffers.count++;
  }
};

/** 在相邻两帧之间写入圆管侧面的三角形索引。 */
const appendTubeSideIndices = (ctx: TubeBuildContext): void => {
  const { buffers, radialSegments } = ctx;
  const begin1 = buffers.count - (radialSegments + 1) * 2;
  const begin2 = buffers.count - (radialSegments + 1);
  for (let k = 0; k < radialSegments; k++) {
    buffers.indices.push(
      begin2 + k,
      begin1 + k,
      begin1 + k + 1,
      begin2 + k,
      begin1 + k + 1,
      begin2 + k + 1,
    );
  }
};

/** 终点封盖。 */
const appendTubeEndCap = (ctx: TubeBuildContext, frames: Frames): void => {
  const { buffers, radialSegments, normalVector } = ctx;
  const lastIndex = frames.points.length - 1;
  normalVector.copy(frames.tangents[lastIndex]).normalize();
  const start = buffers.count - radialSegments;
  const limit = buffers.count;
  for (let r = start; r < limit; r++) {
    const idx = r * POS_COMPONENTS;
    buffers.positions.push(buffers.positions[idx], buffers.positions[idx + 1], buffers.positions[idx + 2]);
    buffers.uvs.push(buffers.uvs[r * UV_COMPONENTS], buffers.uvs[r * UV_COMPONENTS + 1]);
    buffers.normals.push(normalVector.x, normalVector.y, normalVector.z);
    buffers.count++;
  }
  const index = buffers.count - radialSegments;
  for (let i = 0; i < radialSegments - 2; i++) {
    buffers.indices.push(index, index + i + 1, index + i + 2);
  }
};

/** 起点封盖。 */
const appendTubeStartCap = (ctx: TubeBuildContext, frames: Frames): void => {
  const { buffers, radialSegments, normalVector } = ctx;
  normalVector.copy(frames.tangents[0]).normalize();
  for (let r = 0; r < radialSegments; r++) {
    const idx = r * POS_COMPONENTS;
    buffers.positions.push(buffers.positions[idx], buffers.positions[idx + 1], buffers.positions[idx + 2]);
    buffers.normals.push(-normalVector.x, -normalVector.y, -normalVector.z);
    buffers.uvs.push(buffers.uvs[r * UV_COMPONENTS], buffers.uvs[r * UV_COMPONENTS + 1]);
    buffers.count++;
  }
  const index = buffers.count - radialSegments;
  for (let i = 0; i < radialSegments - 2; i++) {
    buffers.indices.push(index, index + i + 2, index + i + 1);
  }
};

/** 用标架扫掠出圆形管道几何体。 */
const buildTubeGeometry = (frames: Frames, opts: TubeOptions): THREE.BufferGeometry => {
  const radialSegments = Math.max(2, opts.radialSegments);
  const circum = opts.radius * 2 * Math.PI;
  const totalLength = frames.lengths[frames.points.length - 1];
  // repeat: u 按物理长度平铺；stretch: u 归一化到 [0,1]。
  const uScale = opts.uvMode === 'stretch' ? totalLength : circum;
  const buffers: GeometryBuffers = {
    positions: [],
    normals: [],
    uvs: [],
    indices: [],
    count: 0,
  };
  const ctx: TubeBuildContext = {
    buffers,
    radius: opts.radius,
    radialSegments,
    startRad: opts.startRad,
    uScale,
    segmentVector: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    normalVector: new THREE.Vector3(),
    offsetVector: new THREE.Vector3(),
  };
  const frameLength = frames.points.length;
  for (let i = 0; i < frameLength; i++) {
    pushTubeRing(ctx, frames, i);
    if (i > 0) {
      appendTubeSideIndices(ctx);
    }
  }
  if (radialSegments >= MIN_RADIAL_FOR_CAP && opts.generateEndCap) {
    appendTubeEndCap(ctx, frames);
  }
  if (radialSegments >= MIN_RADIAL_FOR_CAP && opts.generateStartCap) {
    appendTubeStartCap(ctx, frames);
  }
  const tubeGeo = toGeometry(buffers.positions, buffers.normals, buffers.uvs, buffers.indices);
  tubeGeo.userData.flowTotalLength = totalLength;
  tubeGeo.userData.flowUMax = totalLength / uScale;
  return tubeGeo;
};

// ===================== PlaneBuilder =====================

/** 返回给定 side 下箭头三个顶点的 v 坐标。 */
const arrowUvForSide = (side: 'both' | 'left' | 'right'): { leftV: number; rightV: number; tipV: number } => {
  switch (side) {
    case 'both':
      return { leftV: ARROW_UV_LEFT_BOTH, rightV: ARROW_UV_RIGHT_BOTH, tipV: ARROW_UV_TIP_BOTH };
    case 'left':
      return { leftV: ARROW_UV_LEFT_SINGLE, rightV: 0, tipV: 0 };
    case 'right':
      return { leftV: 0, rightV: ARROW_UV_RIGHT_SINGLE, tipV: 0 };
    default:
      return { leftV: 0, rightV: 0, tipV: 0 };
  }
};

/** 写入锐角拐角修补的 6 顶点双四边形（按 sideOffset 正负分两种排布）。 */
const pushSharpPatchGeometry = (
  ctx: PlaneBuildContext,
  base: number,
  sideOffset: number,
  uvDist: number,
  normal: THREE.Vector3,
): void => {
  const {
    buffers, left, right, tempPoint1, tempPoint2, sharpUvOffset,
  } = ctx;
  if (sideOffset > 0) {
    buffers.positions.push(
      tempPoint1.x, tempPoint1.y, tempPoint1.z, right.x, right.y, right.z, left.x, left.y, left.z,
      right.x, right.y, right.z, tempPoint2.x, tempPoint2.y, tempPoint2.z, right.x, right.y, right.z,
    );
    buffers.count += VERTS_PER_SHARP_PATCH;
    buffers.indices.push(
      base, base - 2, base - 1, base, base - 1, base + 1, base + 2, base, base + 1,
      base + VERTS_PER_SHARP_PATCH - 2, base + 2, base + VERTS_PER_SHARP_PATCH - 1,
    );
  } else {
    buffers.positions.push(
      left.x, left.y, left.z, tempPoint1.x, tempPoint1.y, tempPoint1.z, left.x, left.y, left.z,
      right.x, right.y, right.z, left.x, left.y, left.z, tempPoint2.x, tempPoint2.y, tempPoint2.z,
    );
    buffers.count += VERTS_PER_SHARP_PATCH;
    buffers.indices.push(
      base, base - 2, base - 1, base, base - 1, base + 1, base, base + 1, base + VERTS_PER_SHARP_PATCH / 2,
      base + VERTS_PER_SHARP_PATCH - 2, base + VERTS_PER_SHARP_PATCH / 2, base + VERTS_PER_SHARP_PATCH - 1,
    );
  }
  for (let k = 0; k < VERTS_PER_SHARP_PATCH; k++) {
    buffers.normals.push(normal.x, normal.y, normal.z);
  }
  buffers.uvs.push(
    uvDist - sharpUvOffset, 0, uvDist - sharpUvOffset, 1, uvDist, 0,
    uvDist, 1, uvDist + sharpUvOffset, 0, uvDist + sharpUvOffset, 1,
  );
};

/** 取前一帧已写入的左右点算偏移，补锐角拐角修补几何体。 */
const appendSharpPatch = (
  ctx: PlaneBuildContext,
  frames: Frames,
  i: number,
  uvDist: number,
): void => {
  const {
    buffers, left, right, leftOffset, rightOffset, tempPoint1, tempPoint2,
  } = ctx;
  rightOffset.fromArray(buffers.positions, buffers.positions.length - POS_COMPONENTS).sub(right);
  leftOffset.fromArray(buffers.positions, buffers.positions.length - 2 * POS_COMPONENTS).sub(left);
  const rightDist = rightOffset.length();
  const leftDist = leftOffset.length();
  const sideOffset = leftDist - rightDist;
  let longerOffset: THREE.Vector3;
  let longEdge: THREE.Vector3;
  if (sideOffset > 0) {
    longerOffset = leftOffset;
    longEdge = left;
  } else {
    longerOffset = rightOffset;
    longEdge = right;
  }
  tempPoint1.copy(longerOffset).normalize().multiplyScalar(Math.abs(sideOffset)).add(longEdge);
  const cos = tempPoint2.copy(longEdge).sub(tempPoint1).normalize().dot(frames.tangents[i]);
  const len = tempPoint2.copy(longEdge).sub(tempPoint1).length();
  const d = cos * len * 2;
  tempPoint2.copy(frames.tangents[i]).normalize().multiplyScalar(d).add(tempPoint1);
  const base = buffers.count;
  const normal = frames.normals[i];
  pushSharpPatchGeometry(ctx, base, sideOffset, uvDist, normal);
};

/** 写入一帧的普通左右顶点 + 四边形（非锐角拐角时）。 */
const pushPlaneQuad = (
  ctx: PlaneBuildContext,
  i: number,
  uvDist: number,
  normal: THREE.Vector3,
): void => {
  const { buffers, left, right } = ctx;
  const base = buffers.count;
  buffers.positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
  buffers.normals.push(normal.x, normal.y, normal.z, normal.x, normal.y, normal.z);
  buffers.uvs.push(uvDist, 0, uvDist, 1);
  buffers.count += 2;
  if (i > 0) {
    buffers.indices.push(base, base - 2, base - 1, base, base - 1, base + 1);
  }
};

/** 写入一帧的左右边缘与对应几何体（锐角拐角走修补分支）。 */
const pushPlaneFrame = (ctx: PlaneBuildContext, frames: Frames, i: number): void => {
  const {
    side, sharp, halfWidth, uScale, left, right,
  } = ctx;
  const uvDist = frames.lengths[i] / uScale;
  if (side === 'left') {
    right.set(0, 0, 0);
  } else {
    right.copy(frames.binormals[i]).multiplyScalar(halfWidth * frames.widthScales[i]);
  }
  if (side === 'right') {
    left.set(0, 0, 0);
  } else {
    left.copy(frames.binormals[i]).multiplyScalar(-halfWidth * frames.widthScales[i]);
  }
  const normal = frames.normals[i];
  right.add(frames.points[i]);
  left.add(frames.points[i]);
  if (sharp && frames.sharps[i]) {
    appendSharpPatch(ctx, frames, i, uvDist);
  } else {
    pushPlaneQuad(ctx, i, uvDist, normal);
  }
};

/** 末端箭头。 */
const appendPlaneArrow = (ctx: PlaneBuildContext, frames: Frames): void => {
  const {
    buffers, side, halfWidth, width, uScale, uvMode, left, right, tempPoint1,
  } = ctx;
  const lastIndex = frames.points.length - 1;
  const uvDist = frames.lengths[lastIndex] / uScale;
  const totalLength = frames.lengths[lastIndex];
  // 箭头尖点在 u 方向的外推量：repeat 用 ARROW_U_REPEAT，stretch 换算到归一化。
  const arrowU = uvMode === 'stretch' ? (ARROW_U_REPEAT * width) / totalLength : ARROW_U_REPEAT;
  const normal = frames.normals[lastIndex];
  if (side === 'left') {
    right.set(0, 0, 0);
  } else {
    right.copy(frames.binormals[lastIndex]).multiplyScalar(halfWidth * 2);
  }
  if (side === 'right') {
    left.set(0, 0, 0);
  } else {
    left.copy(frames.binormals[lastIndex]).multiplyScalar(-halfWidth * 2);
  }
  const tip = tempPoint1.copy(frames.tangents[lastIndex]).normalize().multiplyScalar(halfWidth * ARROW_TIP_MULT);
  right.add(frames.points[lastIndex]);
  left.add(frames.points[lastIndex]);
  tip.add(frames.points[lastIndex]);
  const base = buffers.count;
  buffers.positions.push(left.x, left.y, left.z, right.x, right.y, right.z, tip.x, tip.y, tip.z);
  for (let k = 0; k < ARROW_VERTS; k++) {
    buffers.normals.push(normal.x, normal.y, normal.z);
  }
  const uv = arrowUvForSide(side);
  buffers.uvs.push(uvDist, uv.leftV, uvDist, uv.rightV, uvDist + arrowU, uv.tipV);
  buffers.count += ARROW_VERTS;
  buffers.indices.push(base + 2, base, base + 1);
};

/** 用标架扫掠出扁平带状面几何体。 */
const buildPlaneGeometry = (frames: Frames, opts: PlaneOptions): THREE.BufferGeometry => {
  const halfWidth = opts.width / 2;
  const sideWidth = opts.side === 'both' ? opts.width : opts.width / 2;
  const totalLength = frames.lengths[frames.points.length - 1];
  // repeat: u 按物理长度平铺；stretch: u 归一化到 [0,1]。
  const uScale = opts.uvMode === 'stretch' ? totalLength : sideWidth;
  const sharpUvOffset = halfWidth / uScale;
  const buffers: GeometryBuffers = {
    positions: [],
    normals: [],
    uvs: [],
    indices: [],
    count: 0,
  };
  const ctx: PlaneBuildContext = {
    buffers,
    width: opts.width,
    side: opts.side,
    sharp: opts.sharp,
    halfWidth,
    uScale,
    sharpUvOffset,
    uvMode: opts.uvMode,
    left: new THREE.Vector3(),
    right: new THREE.Vector3(),
    leftOffset: new THREE.Vector3(),
    rightOffset: new THREE.Vector3(),
    tempPoint1: new THREE.Vector3(),
    tempPoint2: new THREE.Vector3(),
  };
  const frameLength = frames.points.length;
  for (let i = 0; i < frameLength; i++) {
    pushPlaneFrame(ctx, frames, i);
  }
  if (opts.arrow) {
    appendPlaneArrow(ctx, frames);
  }
  const planeGeo = toGeometry(buffers.positions, buffers.normals, buffers.uvs, buffers.indices);
  planeGeo.userData.flowTotalLength = totalLength;
  planeGeo.userData.flowUMax = totalLength / uScale;
  return planeGeo;
};

// ===================== path orchestration =====================

/** 去重（避免零长段破坏标架）。 */
const dedupePoints = (path: Vec3Tuple[]): THREE.Vector3[] => {
  const pts: THREE.Vector3[] = [];
  for (const p of path) {
    const v = new THREE.Vector3(p[0], p[1], p[2]);
    const last = pts[pts.length - 1];
    if (!last || last.distanceTo(v) > DEDUP_EPSILON) {
      pts.push(v);
    }
  }
  return pts;
};

/** 按 tube 模式组装选项并构建管道几何体（半径非法时返回 null）。 */
const buildTubePath = (
  data: PathData,
  frames: Frames,
  uvMode: 'repeat' | 'stretch',
): THREE.BufferGeometry | null => {
  const radius = data.radius ?? DEFAULT_RADIUS;
  if (radius <= 0) {
    return null;
  }
  return buildTubeGeometry(frames, {
    radius,
    radialSegments: data.radialSegments ?? DEFAULT_RADIAL_SEGMENTS,
    startRad: data.startRad ?? 0,
    generateStartCap: data.generateStartCap ?? false,
    generateEndCap: data.generateEndCap ?? false,
    uvMode,
  });
};

/** 按 plane 模式组装选项并构建扁平带几何体（带宽非法时返回 null）。 */
const buildPlanePath = (
  data: PathData,
  frames: Frames,
  uvMode: 'repeat' | 'stretch',
): THREE.BufferGeometry | null => {
  const width = data.width ?? DEFAULT_WIDTH;
  if (width <= 0) {
    return null;
  }
  return buildPlaneGeometry(frames, {
    width,
    side: data.side ?? 'both',
    sharp: data.sharp ?? false,
    arrow: data.arrow ?? false,
    uvMode,
  });
};

/**
 * 编排单条路径的几何体生成：去重 → 构造 CurvePath → 倒圆角 → 计算标架 →
 * 按 mode 调管道/平面带构建器。输入非法时返回 null。
 */
const buildPathGeometry = (data: PathData): THREE.BufferGeometry | null => {
  if (!Array.isArray(data.path) || data.path.length < 2) {
    return null;
  }
  const mode = data.mode ?? 'tube';
  const bevelRadius = data.bevelRadius ?? 0;
  const close = data.close === true && data.path.length >= MIN_CLOSE_POINTS;
  const divisions = data.divisions ?? DEFAULT_DIVISIONS;
  const pts = dedupePoints(data.path);
  if (pts.length < 2) {
    return null;
  }
  const curvePath = new THREE.CurvePath<THREE.Vector3>();
  setBeveledCurves(curvePath, pts, bevelRadius, close);
  const uvMode = data.uvMode ?? 'repeat';
  const up = data.up ? new THREE.Vector3(data.up[0], data.up[1], data.up[2]) : undefined;
  const frames = computeFrames(curvePath, { up, divisions, close });
  if (mode === 'plane') {
    return buildPlanePath(data, frames, uvMode);
  }
  return buildTubePath(data, frames, uvMode);
};

// ===================== flow =====================

/** 流光顶点注入：声明并传递 uv varying（不依赖受 `USE_UV` 限制的 `vUv`）。 */
const flowVertex = /* glsl */ `
  varying vec2 vFlowUv;
`;

/** 流光片元声明：varying + uniforms（外观 uniforms 跨段共享，定位 uniforms 各段独立）。 */
const flowFragmentDecls = /* glsl */ `
  varying vec2 vFlowUv;
  uniform vec3 uFlowColor;
  uniform float uFlowOffset;
  uniform float uFlowRepeat;
  uniform float uFlowWidth;
  uniform float uFlowTailLength;
  uniform float uFlowIntensity;
  uniform float uFlowPathStart;
  uniform float uFlowPathSpan;
  uniform float uFlowUMax;
  uniform float uFlowDirection;
`;

/**
 * 流光片元逻辑：在全局 `[0,1]` 空间计算光头亮带 + 渐暗拖尾，
 * 叠加到 `totalEmissiveRadiance`（暗处可见，受 tonemapping/colorspace 处理）。
 */
const flowFragmentLogic = /* glsl */ `
  float uNorm = vFlowUv.x / max(uFlowUMax, ${FLOW_U_EPSILON});
  float globalPos = uFlowPathStart + uNorm * uFlowPathSpan;
  float p = fract(globalPos * uFlowRepeat);
  float head = fract(uFlowOffset);
  float dist = fract((head - p) * uFlowDirection);
  float headWidth = uFlowTailLength * uFlowWidth;
  float headBand = smoothstep(headWidth, 0.0, dist);
  float tail = smoothstep(uFlowTailLength, headWidth, dist);
  float flow = clamp(max(headBand, tail), 0.0, 1.0);
  totalEmissiveRadiance += uFlowColor * flow * uFlowIntensity;
`;

/** 创建流光共享 uniforms（外观参数，所有路径段引用同一份，改一处全同步）。 */
const createFlowSharedUniforms = (flow: FlowOptions): Record<string, THREE.IUniform> => {
  const width = THREE.MathUtils.clamp(
    flow.width ?? DEFAULT_FLOW_WIDTH,
    FLOW_U_EPSILON,
    1 - FLOW_U_EPSILON,
  );
  const tailLength = THREE.MathUtils.clamp(
    flow.tailLength ?? DEFAULT_FLOW_TAIL,
    FLOW_U_EPSILON,
    1,
  );
  return {
    uFlowColor: { value: new THREE.Color(flow.color ?? 0xffffff) },
    uFlowOffset: { value: 0 },
    uFlowRepeat: { value: Math.max(flow.repeat ?? DEFAULT_FLOW_REPEAT, 1) },
    uFlowWidth: { value: width },
    uFlowTailLength: { value: tailLength },
    uFlowIntensity: { value: flow.intensity ?? DEFAULT_FLOW_INTENSITY },
    uFlowDirection: { value: flow.direction ?? 1 },
  };
};

/** 创建单条路径的流光定位 uniforms（`pathStart`/`pathSpan`/`uMax` 各段独立）。 */
const createFlowPathUniforms = (
  pathStart: number,
  pathSpan: number,
  uMax: number,
): Record<string, THREE.IUniform> => ({
  uFlowPathStart: { value: pathStart },
  uFlowPathSpan: { value: pathSpan },
  uFlowUMax: { value: Math.max(uMax, FLOW_U_EPSILON) },
});

/**
 * 把流光逻辑注入到克隆材质（`onBeforeCompile`），叠加到 emissive。
 *
 * 镜像 `Wireframe` 的 `applyWireframeOverride` 模式：合并 uniforms、
 * 顶点 replace `void main()` 注入 `vFlowUv = uv`、片元 replace `void main()`
 * 注入声明、replace `#include <emissivemap_fragment>` 追加流光计算。
 * 不设 `transparent`（流光是加性发光，无 alpha）。
 */
const applyFlowOverride = (
  material: THREE.Material,
  sharedUniforms: Record<string, THREE.IUniform>,
  pathUniforms: Record<string, THREE.IUniform>,
): void => {
  material.onBeforeCompile = (shader) => {
    shader.uniforms = { ...shader.uniforms, ...sharedUniforms, ...pathUniforms };

    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `${flowVertex}\nvoid main() {\n  vFlowUv = uv;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `${flowFragmentDecls}\nvoid main() {`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>\n  ${flowFragmentLogic}`,
    );
  };
  material.needsUpdate = true;
};

// ===================== Path component =====================

/**
 * Path — 路径绘制组件。
 *
 * 把一组 3D 顶点先经 `setBeveledCurves`（直线段 + 二次贝塞尔圆角）构造成曲线，
 * 再经 `computeFrames`（Frenet 标架）采样，最后扫掠成**管道**或**扁平带**两种几何体。
 * 算法翻译成 three.js 语言。
 *
 * **特性:**
 * - 继承 `THREE.Group`，可直接加入任意 Three.js 场景
 * - `mode: 'tube'` 生成圆管（支持起终点封盖、锐角拐角椭圆拉伸避免撕裂）
 * - `mode: 'plane'` 生成扁平带（支持单/双偏侧、锐角几何修补、末端箭头）
 * - `bevelRadius > 0` 时拐角倒圆角；`up` 控制截面朝向（不传则 Frenet 自动）
 * - `close: true` 时路径自动闭合为环
 * - 所有路径共享同一材质；未传入材质时使用默认 `MeshStandardMaterial`
 * - 实现 {@link IDisposable} —— `dispose()` 释放全部几何体（自建材质一并释放）
 *
 * @example
 * ```ts
 * import { Path } from '@a3d/a3d-components/core';
 *
 * // 3D 折线 → 圆管（带封盖）
 * const tube = new Path({
 *   paths: [{
 *     path: [[0,0,0],[3,0,0],[3,3,0],[0,3,0]],
 *     mode: 'tube', bevelRadius: 0.5, radius: 0.15,
 *     generateStartCap: true, generateEndCap: true,
 *   }],
 * });
 * scene.add(tube);
 *
 * // 2D 折线 → 扁平带（锐角修补）
 * const route = new Path({
 *   paths: [{
 *     path: [[0,0,0],[3,0,0],[3,0,3],[0,0,3]],
 *     mode: 'plane', bevelRadius: 0, width: 0.5,
 *     side: 'both', sharp: true, up: [0,1,0],
 *   }],
 * });
 * scene.add(route);
 * ```
 *
 * @extends THREE.Group
 *
 * Implements {@link IDisposable}.
 */
export class Path extends THREE.Group implements IDisposable {
  private readonly material: THREE.Material;
  private readonly ownsMaterial: boolean;
  private flowSharedUniforms: Record<string, THREE.IUniform> | null = null;
  private readonly flowMaterials: THREE.Material[] = [];
  private flowController: AnimationController | null = null;
  private readonly flowClock = new THREE.Clock();
  private flowSpeed = DEFAULT_FLOW_SPEED;
  private flowDirection: 1 | -1 = 1;

  constructor(options: PathOptions) {
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
        roughness: 0.7,
        metalness: 0.0,
        side: THREE.DoubleSide,
      });
    const paths = Array.isArray(options.paths) ? options.paths : [];
    const pathMeshes: THREE.Mesh[] = [];
    for (const data of paths) {
      const geometry = buildPathGeometry(data);
      if (geometry) {
        const mesh = new THREE.Mesh(geometry, this.material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.add(mesh);
        pathMeshes.push(mesh);
      }
    }
    if (options.children) {
      for (const child of options.children) {
        this.add(child);
      }
    }
    if (options.flow?.enabled) {
      this.initFlow(pathMeshes, options.flow);
    }
  }

  /** 释放所有路径几何体与流光资源；若材质由本组件创建则一并释放。 */
  dispose(): void {
    this.disposeFlow();
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

  /**
   * 初始化流光：按各段物理长度占比拼接全局 `[0,1]` 空间，
   * 为每段克隆材质并注入流光，外观 uniforms 跨段共享。
   */
  private initFlow(meshes: THREE.Mesh[], flow: FlowOptions): void {
    if (meshes.length === 0) {
      return;
    }
    let totalLength = 0;
    for (const mesh of meshes) {
      totalLength += Number(mesh.geometry.userData.flowTotalLength) || 0;
    }
    if (totalLength <= 0) {
      return;
    }
    const sharedUniforms = createFlowSharedUniforms(flow);
    this.flowSharedUniforms = sharedUniforms;
    this.flowSpeed = flow.speed ?? DEFAULT_FLOW_SPEED;
    this.flowDirection = flow.direction ?? 1;
    let cumLength = 0;
    for (const mesh of meshes) {
      const len = Number(mesh.geometry.userData.flowTotalLength) || 0;
      const pathStart = cumLength / totalLength;
      const pathSpan = len / totalLength;
      cumLength += len;
      const uMax = Number(mesh.geometry.userData.flowUMax) || 0;
      this.applyFlowToMesh(mesh, sharedUniforms, pathStart, pathSpan, uMax);
    }
    this.startFlow();
  }

  /** 为单个 mesh 克隆材质、注入流光、替换 material 并登记。 */
  private applyFlowToMesh(
    mesh: THREE.Mesh,
    sharedUniforms: Record<string, THREE.IUniform>,
    pathStart: number,
    pathSpan: number,
    uMax: number,
  ): void {
    const pathUniforms = createFlowPathUniforms(pathStart, pathSpan, uMax);
    const flowMat = this.material.clone();
    applyFlowOverride(flowMat, sharedUniforms, pathUniforms);
    mesh.material = flowMat;
    this.flowMaterials.push(flowMat);
  }

  /** 每帧推进全局流光相位（wall-clock dt，对 `onUpdate` 双触发免疫）。 */
  private onFlowTick(): void {
    if (!this.flowSharedUniforms) {
      return;
    }
    let dt = this.flowClock.getDelta();
    if (dt > FLOW_DT_CLAMP) {
      dt = FLOW_DT_CLAMP;
    }
    this.flowSharedUniforms.uFlowOffset.value += dt * this.flowSpeed * this.flowDirection;
  }

  /** 开始/恢复流光动画。无流光路径时为空操作。 */
  startFlow(): this {
    if (!this.flowSharedUniforms) {
      return this;
    }
    let controller = this.flowController;
    if (!controller) {
      this.flowClock.getDelta();
      controller = animate(new THREE.Object3D(), {
        duration: 1,
        ease: 'linear',
        repeat: -1,
        onUpdate: () => this.onFlowTick(),
      });
      this.flowController = controller;
    }
    controller.play();
    return this;
  }

  /** 暂停流光动画。 */
  stopFlow(): this {
    this.flowController?.pause();
    return this;
  }

  /** 设置流光颜色。 */
  setFlowColor(color: THREE.ColorRepresentation): this {
    if (this.flowSharedUniforms) {
      (this.flowSharedUniforms.uFlowColor.value as THREE.Color).set(color);
    }
    return this;
  }

  /** 设置流动速度。 */
  setFlowSpeed(speed: number): this {
    this.flowSpeed = speed;
    return this;
  }

  /** 设置流动方向。 */
  setFlowDirection(direction: 1 | -1): this {
    this.flowDirection = direction;
    if (this.flowSharedUniforms) {
      this.flowSharedUniforms.uFlowDirection.value = direction;
    }
    return this;
  }

  /** 设置流光强度。 */
  setFlowIntensity(intensity: number): this {
    if (this.flowSharedUniforms) {
      this.flowSharedUniforms.uFlowIntensity.value = intensity;
    }
    return this;
  }

  /** 设置光头占比（`0-1`，占流光总长度的比例）。 */
  setFlowWidth(width: number): this {
    if (this.flowSharedUniforms) {
      this.flowSharedUniforms.uFlowWidth.value = THREE.MathUtils.clamp(
        width,
        FLOW_U_EPSILON,
        1 - FLOW_U_EPSILON,
      );
    }
    return this;
  }

  /** 设置流光总长度（归一化 `[0,1]`）；光头按 `width` 比例缩放，拖尾始终保留。 */
  setFlowTailLength(tailLength: number): this {
    if (this.flowSharedUniforms) {
      this.flowSharedUniforms.uFlowTailLength.value = THREE.MathUtils.clamp(
        tailLength,
        FLOW_U_EPSILON,
        1,
      );
    }
    return this;
  }

  /** 设置全局流光个数。 */
  setFlowRepeat(repeat: number): this {
    if (this.flowSharedUniforms) {
      this.flowSharedUniforms.uFlowRepeat.value = Math.max(repeat, 1);
    }
    return this;
  }

  /** 释放流光资源：先停动画，再释放克隆材质。 */
  private disposeFlow(): void {
    this.flowController?.destroy();
    this.flowController = null;
    for (const mat of this.flowMaterials) {
      mat.dispose();
    }
    this.flowMaterials.length = 0;
    this.flowSharedUniforms = null;
  }
}
