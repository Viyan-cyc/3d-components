import * as THREE from 'three';
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

/** Options for constructing a {@link Path}. */
export interface PathOptions extends GroupComponentOptions {
  /** 一组路径数据，每个元素生成一条管道或平面带。 */
  paths: PathData[];
  /** 共享材质。所有路径复用。不传则使用默认 `MeshStandardMaterial`（`dispose()` 时一并释放）。 */
  material?: THREE.Material;
}

// ===================== frames (移植自 t3d CurvePath3.computeFrames) =====================

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

/**
 * Scales a vector along the given direction by the given scale factor.
 * 等价于 t3d `Vector3.scaleAlong`（three.js 的 Vector3 无此方法）。
 * 算法：把 v 投影到 dir 上，把该投影的长度从 (v·dir) 替换为 scale。
 */
function scaleAlong(v: THREE.Vector3, direction: THREE.Vector3, scale: number): THREE.Vector3 {
  const proj = direction.clone().multiplyScalar(v.dot(direction));
  return v.sub(proj).addScaledVector(proj, scale);
}

/**
 * 用「直线段 + 二次贝塞尔圆角」构造一条 three.js CurvePath。
 * 移植自 t3d `CurvePath.setBeveledCurves`（bevelRadius=0 或点数≤2 时退化为纯折线）。
 */
function setBeveledCurves(
  curvePath: THREE.CurvePath<THREE.Vector3>,
  input: THREE.Vector3[],
  bevelRadius: number,
  close: boolean,
): void {
  const points = input;
  if (points.length < 2) return;

  // 退化为纯折线。
  if (bevelRadius === 0 || points.length === 2) {
    setPolylines(curvePath, points, close);
    return;
  }

  const lastIndex = points.length - 1;
  // 闭合且首尾不重合时，补一条末→首的段。
  const segments = close && !points[0].equals(points[lastIndex]) ? points.length : lastIndex;

  const p0 = points[0].clone();
  const lastDir = new THREE.Vector3();
  const nextDir = new THREE.Vector3();

  for (let i = 0; i < segments; i++) {
    const p1 = points[(i + 1) % (lastIndex + 1)];
    const p2 = points[(i + 2) % (lastIndex + 1)];

    // 开放路径的最后一段是直线。
    if (i === segments - 1 && !close) {
      const lineCurve = new THREE.LineCurve3(p0.clone(), p1.clone());
      curvePath.curves.push(lineCurve);
      p0.copy(p1);
      break;
    }

    lastDir.subVectors(p1, p0);
    nextDir.subVectors(p2, p1);

    const lastDirLength = lastDir.length();
    const nextDirLength = nextDir.length();

    // 圆角起点距离：首段取半，避免起点的圆角吃掉整段。
    const v0Dist = Math.min((i === 0 ? lastDirLength / 2 : lastDirLength) * 0.999999, bevelRadius);
    const v2Dist = Math.min((nextDirLength / 2) * 0.999999, bevelRadius);

    lastDir.normalize();
    nextDir.normalize();

    const lineEnd = p1.clone().sub(lastDir.clone().multiplyScalar(v0Dist));
    const lineCurve = new THREE.LineCurve3(p0.clone(), lineEnd);
    curvePath.curves.push(lineCurve);

    const bezV2 = p1.clone().add(nextDir.clone().multiplyScalar(v2Dist));
    const bezierCurve = new THREE.QuadraticBezierCurve3(lineEnd.clone(), p1.clone(), bezV2);
    curvePath.curves.push(bezierCurve);

    p0.copy(bezV2);
  }

  // 闭合时把首段起点修正到末段终点（让接缝连续）。
  if (close) (curvePath.curves[0] as THREE.LineCurve3).v1.copy(p0);
}

/** 用纯直线段构造折线 CurvePath。移植自 t3d `CurvePath.setPolylines`。 */
function setPolylines(curvePath: THREE.CurvePath<THREE.Vector3>, points: THREE.Vector3[], close: boolean): void {
  if (points.length < 2) return;
  const lastIndex = points.length - 1;
  const segments = close && !points[0].equals(points[lastIndex]) ? points.length : lastIndex;
  for (let i = 0; i < segments; i++) {
    const v1 = points[i].clone();
    const v2 = (i === lastIndex ? points[0] : points[i + 1]).clone();
    curvePath.curves.push(new THREE.LineCurve3(v1, v2));
  }
}

/**
 * 沿 CurvePath 采样并计算 Frenet 标架（tangent / normal / binormal / bisector），
 * 以及每个采样点的 widthScale（拐角椭圆拉伸系数）与 sharp（是否锐角拐角）。
 * 移植自 t3d `CurvePath3.computeFrames`。
 */
function computeFrames(
  curvePath: THREE.CurvePath<THREE.Vector3>,
  options: { up?: THREE.Vector3; divisions?: number; frenet?: boolean; fixLine?: boolean; close?: boolean },
): Frames {
  const up = options.up ?? null;
  const divisions = options.divisions ?? 12;
  const frenet = options.frenet ?? true;
  const fixLine = options.fixLine ?? true;
  const close = options.close ?? false;

  const points: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];
  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  const bisectors: THREE.Vector3[] = [];
  const lengths: number[] = [];
  const widthScales: number[] = [];
  const sharps: boolean[] = [];
  const tangentTypes: number[] = [];

  // ---- 采样 ----
  let tangentType = 0;
  for (let i = 0; i < curvePath.curves.length; i++) {
    const curve = curvePath.curves[i];
    const isLine = curve instanceof THREE.LineCurve3;
    const resolution = isLine ? 1 : divisions;
    const pts = curve.getPoints(resolution);
    const isLast = i === curvePath.curves.length - 1;

    if (fixLine && isLine && !isLast) {
      const nextCurve = curvePath.curves[i + 1];
      const isNextLine = nextCurve instanceof THREE.LineCurve3;
      if (!isNextLine) tangentType = 1;
    }

    for (let j = 0, l = isLast ? pts.length : pts.length - 1; j < l; j++) {
      points.push(pts[j]);
      tangentTypes.push(tangentType);
      if (tangentType === 1) tangentType++;
      else if (tangentType === 2) tangentType = 0;
    }
  }

  // ---- 首点 ----
  tangents[0] = new THREE.Vector3();
  normals[0] = new THREE.Vector3();
  binormals[0] = new THREE.Vector3();
  bisectors[0] = new THREE.Vector3();

  tangents[0].subVectors(points[1], points[0]).normalize();

  if (up) {
    normals[0].copy(up);
  } else {
    // 选一个与首切线垂直、且在最小组件方向上的初始法向。
    let min = Number.MAX_VALUE;
    const tx = Math.abs(tangents[0].x);
    const ty = Math.abs(tangents[0].y);
    const tz = Math.abs(tangents[0].z);
    if (tx < min) { min = tx; normals[0].set(1, 0, 0); }
    if (ty < min) { min = ty; normals[0].set(0, 1, 0); }
    if (tz < min) { min = tz; normals[0].set(0, 0, 1); }
  }

  binormals[0].crossVectors(tangents[0], normals[0]).normalize();
  normals[0].crossVectors(binormals[0], tangents[0]).normalize();
  bisectors[0].copy(binormals[0]);

  lengths[0] = 0;
  widthScales[0] = 1;
  sharps[0] = false;

  // ---- 中间点 ----
  const lastDir = new THREE.Vector3();
  const nextDir = new THREE.Vector3();
  const _mat = new THREE.Matrix4();

  for (let i = 1; i < points.length - 1; i++) {
    const tangent = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const binormal = new THREE.Vector3();
    const bisector = new THREE.Vector3();

    lastDir.subVectors(points[i], points[i - 1]);
    nextDir.subVectors(points[i + 1], points[i]);

    const lastLength = lastDir.length();
    lastDir.normalize();
    nextDir.normalize();

    bisector.subVectors(nextDir, lastDir).normalize();

    const tt = tangentTypes[i];
    if (tt === 1) tangent.copy(nextDir);
    else if (tt === 2) tangent.copy(lastDir);
    else tangent.addVectors(lastDir, nextDir).normalize();

    if (frenet) {
      normal.copy(normals[i - 1]);
      const vec = binormal.crossVectors(tangents[i - 1], tangent);
      if (vec.length() > Number.EPSILON) {
        vec.normalize();
        const theta = Math.acos(THREE.MathUtils.clamp(tangents[i - 1].dot(tangent), -1, 1));
        normal.applyMatrix4(_mat.makeRotationAxis(vec, theta));
      }
      binormal.crossVectors(tangent, normal).normalize();
    } else {
      normal.copy(up ?? normals[i - 1]);
      if (tangent.dot(normal) === 1) binormal.crossVectors(nextDir, normal).normalize();
      else binormal.crossVectors(tangent, normal).normalize();
      normal.crossVectors(binormal, tangent).normalize();
    }

    tangents[i] = tangent;
    normals[i] = normal;
    binormals[i] = binormal;
    bisectors[i] = bisector;

    const cos = lastDir.dot(nextDir);
    lengths[i] = lengths[i - 1] + lastLength;
    widthScales[i] = Math.min(1 / Math.sqrt((1 + cos) / 2), 1.415) || 1;
    sharps[i] = Math.abs(cos - 1) > 0.05;
  }

  // ---- 末点 ----
  const lastIndex = points.length - 1;
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const bisector = new THREE.Vector3();

  tangent.subVectors(points[lastIndex], points[lastIndex - 1]);
  const dist = tangent.length();

  if (close) tangent.copy(tangents[0]);
  else tangent.normalize();

  normal.copy(normals[lastIndex - 1]);
  const vec = binormal.crossVectors(tangents[lastIndex - 1], tangent);
  if (vec.length() > Number.EPSILON) {
    vec.normalize();
    const theta = Math.acos(THREE.MathUtils.clamp(tangents[lastIndex - 1].dot(tangent), -1, 1));
    normal.applyMatrix4(_mat.makeRotationAxis(vec, theta));
  }
  binormal.crossVectors(tangent, normal).normalize();
  bisector.copy(binormal);

  tangents[lastIndex] = tangent;
  normals[lastIndex] = normal;
  binormals[lastIndex] = binormal;
  bisectors[lastIndex] = bisector;

  lengths[lastIndex] = lengths[lastIndex - 1] + dist;
  widthScales[lastIndex] = 1;
  sharps[lastIndex] = false;

  // 闭合时把首点标架同步成末点标架。
  if (close) {
    tangents[0].copy(tangent);
    normals[0].copy(normal);
    binormals[0].copy(binormal);
    bisectors[0].copy(bisector);
  }

  return { points, tangents, normals, binormals, bisectors, lengths, widthScales, sharps, tangentTypes };
}

// ===================== TubeBuilder (移植自 t3d TubeBuilder.getGeometryData) =====================

interface TubeOptions {
  radius: number;
  radialSegments: number;
  startRad: number;
  generateStartCap: boolean;
  generateEndCap: boolean;
  uvMode: 'repeat' | 'stretch';
}

/**
 * 用标架扫掠出圆形管道几何体。锐角拐角处沿 bisector 把截面做椭圆拉伸（避免撕裂）。
 * 移植自 t3d `TubeBuilder.getGeometryData`。
 */
function buildTubeGeometry(frames: Frames, opts: TubeOptions): THREE.BufferGeometry {
  const radius = opts.radius;
  const radialSegments = Math.max(2, opts.radialSegments);
  const startRad = opts.startRad;
  const generateStartCap = opts.generateStartCap;
  const generateEndCap = opts.generateEndCap;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const frameLength = frames.points.length;
  const lastIndex = frameLength - 1;

  const circum = radius * 2 * Math.PI;
  const totalLength = frames.lengths[lastIndex];
  // repeat: u 按物理长度平铺（配合 RepeatWrapping 重复贴图）；
  // stretch: u 归一化到 [0,1]，一张贴图从头铺到尾。
  const uScale = opts.uvMode === 'stretch' ? totalLength : circum;

  const quaternion = new THREE.Quaternion();
  const segmentVector = new THREE.Vector3();
  const normalVector = new THREE.Vector3();
  const offsetVector = new THREE.Vector3();

  let verticesCount = 0;

  for (let i = 0; i < frameLength; i++) {
    const uvDist = frames.lengths[i] / uScale;
    const sharp = frames.sharps[i];
    const widthScale = frames.widthScales[i];

    for (let r = 0; r <= radialSegments; r++) {
      let _r = r;
      if (_r === radialSegments) _r = 0;

      segmentVector.copy(frames.normals[i]);
      quaternion.setFromAxisAngle(frames.tangents[i], startRad + (Math.PI * 2 * _r) / radialSegments);
      segmentVector.applyQuaternion(quaternion).normalize();

      if (sharp) {
        // 锐角拐角处截面变椭圆：沿 bisector 方向按 widthScale 拉伸。
        scaleAlong(offsetVector.copy(segmentVector), frames.bisectors[i], widthScale).multiplyScalar(radius).add(frames.points[i]);
        scaleAlong(normalVector.copy(segmentVector), frames.bisectors[i], 1 / widthScale).normalize();
      } else {
        offsetVector.copy(segmentVector).multiplyScalar(radius * widthScale).add(frames.points[i]);
        normalVector.copy(segmentVector);
      }

      positions.push(offsetVector.x, offsetVector.y, offsetVector.z);
      normals.push(normalVector.x, normalVector.y, normalVector.z);
      uvs.push(uvDist, r / radialSegments);

      verticesCount++;
    }

    if (i > 0) {
      const begin1 = verticesCount - (radialSegments + 1) * 2;
      const begin2 = verticesCount - (radialSegments + 1);
      for (let k = 0; k < radialSegments; k++) {
        indices.push(
          begin2 + k, begin1 + k, begin1 + k + 1,
          begin2 + k, begin1 + k + 1, begin2 + k + 1,
        );
      }
    }
  }

  // 终点封盖。
  if (radialSegments >= 3 && generateEndCap) {
    normalVector.copy(frames.tangents[lastIndex]).normalize();
    for (let r = verticesCount - radialSegments, l = verticesCount; r < l; r++) {
      positions.push(positions[r * 3], positions[r * 3 + 1], positions[r * 3 + 2]);
      uvs.push(uvs[r * 2], uvs[r * 2 + 1]);
      normals.push(normalVector.x, normalVector.y, normalVector.z);
      verticesCount++;
    }
    const index = verticesCount - radialSegments;
    for (let i = 0; i < radialSegments - 2; i++) {
      indices.push(index, index + i + 1, index + i + 2);
    }
  }

  // 起点封盖。
  if (radialSegments >= 3 && generateStartCap) {
    normalVector.copy(frames.tangents[0]).normalize();
    for (let r = 0; r < radialSegments; r++) {
      positions.push(positions[r * 3], positions[r * 3 + 1], positions[r * 3 + 2]);
      normals.push(-normalVector.x, -normalVector.y, -normalVector.z);
      uvs.push(uvs[r * 2], uvs[r * 2 + 1]);
      verticesCount++;
    }
    const index = verticesCount - radialSegments;
    for (let i = 0; i < radialSegments - 2; i++) {
      indices.push(index, index + i + 2, index + i + 1);
    }
  }

  return toGeometry(positions, normals, uvs, indices);
}

// ===================== RouteBuilder (移植自 t3d RouteBuilder.getGeometryData) =====================

interface PlaneOptions {
  width: number;
  side: 'both' | 'left' | 'right';
  sharp: boolean;
  arrow: boolean;
  uvMode: 'repeat' | 'stretch';
}

/**
 * 用标架扫掠出扁平带状面几何体。锐角拐角处插入几何修补避免撕裂，可选末端箭头。
 * 移植自 t3d `RouteBuilder.getGeometryData`。
 */
function buildPlaneGeometry(frames: Frames, opts: PlaneOptions): THREE.BufferGeometry {
  const width = opts.width;
  const side = opts.side;
  const sharp = opts.sharp;
  const arrow = opts.arrow;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const frameLength = frames.points.length;
  const lastIndex = frameLength - 1;

  const halfWidth = width / 2;
  const sideWidth = side !== 'both' ? width / 2 : width;
  const totalLength = frames.lengths[lastIndex];
  // repeat: u 按物理长度平铺（u = arclength / sideWidth）；
  // stretch: u 归一化到 [0,1]，一张贴图从头铺到尾（u = arclength / totalLength）。
  const uScale = opts.uvMode === 'stretch' ? totalLength : sideWidth;

  // 锐角段 UV 偏移量（与 u 同一坐标系）。
  const sharpUvOffset = halfWidth / uScale;

  const leftOffset = new THREE.Vector3();
  const rightOffset = new THREE.Vector3();
  const tempPoint1 = new THREE.Vector3();
  const tempPoint2 = new THREE.Vector3();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();

  let verticesCount = 0;

  for (let i = 0; i < frameLength; i++) {
    const uvDist = frames.lengths[i] / uScale;

    if (side !== 'left') {
      right.copy(frames.binormals[i]).multiplyScalar(halfWidth * frames.widthScales[i]);
    } else {
      right.set(0, 0, 0);
    }
    if (side !== 'right') {
      left.copy(frames.binormals[i]).multiplyScalar(-halfWidth * frames.widthScales[i]);
    } else {
      left.set(0, 0, 0);
    }

    const normal = frames.normals[i];

    right.add(frames.points[i]);
    left.add(frames.points[i]);

    if (sharp && frames.sharps[i]) {
      // 锐角拐角修补：取前一帧已写入的左右点，算偏移，补 6 顶点双四边形。
      rightOffset.fromArray(positions, positions.length - 3).sub(right);
      leftOffset.fromArray(positions, positions.length - 6).sub(left);

      const rightDist = rightOffset.length();
      const leftDist = leftOffset.length();
      const sideOffset = leftDist - rightDist;

      let longerOffset: THREE.Vector3;
      let longEdge: THREE.Vector3;
      if (sideOffset > 0) { longerOffset = leftOffset; longEdge = left; }
      else { longerOffset = rightOffset; longEdge = right; }

      tempPoint1.copy(longerOffset).normalize().multiplyScalar(Math.abs(sideOffset)).add(longEdge);

      const cos = tempPoint2.copy(longEdge).sub(tempPoint1).normalize().dot(frames.tangents[i]);
      const len = tempPoint2.copy(longEdge).sub(tempPoint1).length();
      const d = cos * len * 2;

      tempPoint2.copy(frames.tangents[i]).normalize().multiplyScalar(d).add(tempPoint1);

      if (sideOffset > 0) {
        positions.push(
          tempPoint1.x, tempPoint1.y, tempPoint1.z,
          right.x, right.y, right.z,
          left.x, left.y, left.z,
          right.x, right.y, right.z,
          tempPoint2.x, tempPoint2.y, tempPoint2.z,
          right.x, right.y, right.z,
        );
        verticesCount += 6;
        indices.push(
          verticesCount - 6, verticesCount - 8, verticesCount - 7,
          verticesCount - 6, verticesCount - 7, verticesCount - 5,
          verticesCount - 4, verticesCount - 6, verticesCount - 5,
          verticesCount - 2, verticesCount - 4, verticesCount - 1,
        );
      } else {
        positions.push(
          left.x, left.y, left.z,
          tempPoint1.x, tempPoint1.y, tempPoint1.z,
          left.x, left.y, left.z,
          right.x, right.y, right.z,
          left.x, left.y, left.z,
          tempPoint2.x, tempPoint2.y, tempPoint2.z,
        );
        verticesCount += 6;
        indices.push(
          verticesCount - 6, verticesCount - 8, verticesCount - 7,
          verticesCount - 6, verticesCount - 7, verticesCount - 5,
          verticesCount - 6, verticesCount - 5, verticesCount - 3,
          verticesCount - 2, verticesCount - 3, verticesCount - 1,
        );
      }

      for (let k = 0; k < 6; k++) normals.push(normal.x, normal.y, normal.z);
      uvs.push(
        uvDist - sharpUvOffset, 0,
        uvDist - sharpUvOffset, 1,
        uvDist, 0,
        uvDist, 1,
        uvDist + sharpUvOffset, 0,
        uvDist + sharpUvOffset, 1,
      );
    } else {
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
      normals.push(normal.x, normal.y, normal.z, normal.x, normal.y, normal.z);
      uvs.push(uvDist, 0, uvDist, 1);
      verticesCount += 2;
      if (i > 0) {
        indices.push(
          verticesCount - 2, verticesCount - 4, verticesCount - 3,
          verticesCount - 2, verticesCount - 3, verticesCount - 1,
        );
      }
    }
  }

  // 末端箭头。
  if (arrow) {
    const uvDist = frames.lengths[lastIndex] / uScale;
    // 箭头尖点在 u 方向的外推量：repeat 用 1.5（repeat 单位），stretch 换算到归一化。
    const arrowU = opts.uvMode === 'stretch' ? 1.5 * width / totalLength : 1.5;
    const normal = frames.normals[lastIndex];

    if (side !== 'left') right.copy(frames.binormals[lastIndex]).multiplyScalar(halfWidth * 2);
    else right.set(0, 0, 0);
    if (side !== 'right') left.copy(frames.binormals[lastIndex]).multiplyScalar(-halfWidth * 2);
    else left.set(0, 0, 0);

    const tip = tempPoint1.copy(frames.tangents[lastIndex]).normalize().multiplyScalar(halfWidth * 3);

    right.add(frames.points[lastIndex]);
    left.add(frames.points[lastIndex]);
    tip.add(frames.points[lastIndex]);

    positions.push(left.x, left.y, left.z, right.x, right.y, right.z, tip.x, tip.y, tip.z);
    for (let k = 0; k < 3; k++) normals.push(normal.x, normal.y, normal.z);
    uvs.push(
      uvDist, side !== 'both' ? (side !== 'right' ? -2 : 0) : -0.5,
      uvDist, side !== 'both' ? (side !== 'left' ? 2 : 0) : 1.5,
      uvDist + arrowU, side !== 'both' ? 0 : 0.5,
    );
    verticesCount += 3;
    indices.push(verticesCount - 1, verticesCount - 3, verticesCount - 2);
  }

  return toGeometry(positions, normals, uvs, indices);
}

// ===================== geometry assembly =====================

/** 把扁平的 positions/normals/uvs/indices 数组组装成 three.js BufferGeometry。 */
function toGeometry(positions: number[], normals: number[], uvs: number[], indices: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(new THREE.BufferAttribute(
    positions.length / 3 > 65536 ? new Uint32Array(indices) : new Uint16Array(indices),
    1,
  ));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * 编排单条路径的几何体生成：去重 → 构造 CurvePath → 倒圆角 → 计算标架 →
 * 按 mode 调管道/平面带构建器。输入非法时返回 null。
 */
function buildPathGeometry(data: PathData): THREE.BufferGeometry | null {
  if (!Array.isArray(data.path) || data.path.length < 2) return null;

  const mode = data.mode ?? 'tube';
  const bevelRadius = data.bevelRadius ?? 0;
  const close = data.close === true && data.path.length >= 3;
  const divisions = data.divisions ?? 12;

  // 去重（避免零长段破坏标架）。
  const pts: THREE.Vector3[] = [];
  for (const p of data.path) {
    const v = new THREE.Vector3(p[0], p[1], p[2]);
    const last = pts[pts.length - 1];
    if (!last || last.distanceTo(v) > 1e-6) pts.push(v);
  }
  if (pts.length < 2) return null;

  const curvePath = new THREE.CurvePath<THREE.Vector3>();
  setBeveledCurves(curvePath, pts, bevelRadius, close);

  const uvMode = data.uvMode ?? 'repeat';
  const up = data.up ? new THREE.Vector3(data.up[0], data.up[1], data.up[2]) : undefined;
  const frames = computeFrames(curvePath, { up, divisions, close });

  if (mode === 'tube') {
    if ((data.radius ?? 0.1) <= 0) return null;
    return buildTubeGeometry(frames, {
      radius: data.radius ?? 0.1,
      radialSegments: data.radialSegments ?? 8,
      startRad: data.startRad ?? 0,
      generateStartCap: data.generateStartCap ?? false,
      generateEndCap: data.generateEndCap ?? false,
      uvMode,
    });
  }

  if ((data.width ?? 0.1) <= 0) return null;
  return buildPlaneGeometry(frames, {
    width: data.width ?? 0.1,
    side: data.side ?? 'both',
    sharp: data.sharp ?? false,
    arrow: data.arrow ?? false,
    uvMode,
  });
}

// ===================== Path component =====================

/**
 * Path — 路径绘制组件。
 *
 * 把一组 3D 顶点先经 `setBeveledCurves`（直线段 + 二次贝塞尔圆角）构造成曲线，
 * 再经 `computeFrames`（Frenet 标架）采样，最后扫掠成**管道**或**扁平带**两种几何体。
 * 算法整体移植自 t3d.js 的 `CurvePath3` / `TubeBuilder` / `RouteBuilder`，翻译成 three.js 语言。
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
 * import { Path } from '@cyc/3d-components/core';
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

  constructor(options: PathOptions) {
    super();

    if (options.name) this.name = options.name;
    if (options.visible !== undefined) this.visible = options.visible;
    if (options.userData) this.userData = { ...options.userData };

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
    for (const data of paths) {
      const geometry = buildPathGeometry(data);
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

  /** 释放所有路径几何体；若材质由本组件创建则一并释放。 */
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
