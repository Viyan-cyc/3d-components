
import * as THREE from 'three';
import type { AxisIndex, HandleConfig, PointerSample } from './context';
import { PivotHandle } from './PivotHandle';
import { calculateScaleFactor } from './calculateScaleFactor';

/** 球体半径系数（fixed 模式下 lineWidth / scale 的乘数）。 */
const RADIUS_WIDTH_FACTOR = 1.8;

/** 球体半径除数（非 fixed 模式下 scale 的除数）。 */
const RADIUS_SCALE_DIVISOR = 22.5;

/** 球体沿轴位置（fixed 模式）。 */
const SPHERE_POS_FIXED = 1.2;

/** 球体沿轴位置系数（非 fixed 模式下 scale 的乘数）。 */
const SPHERE_POS_FACTOR = 1.2;

/** 球体几何分段数。 */
const SPHERE_SEGMENTS = 16;

/** 缩放最小值下限（避免变换退化）。 */
const MIN_SCALE_EPSILON = 1e-5;

/** 缩放偏移指数系数。 */
const SCALE_EXPONENT_FACTOR = 0.2;

/** Shift 吸附精度。 */
const SNAP_PRECISION = 10;

const vec1 = /* @__PURE__ */ new THREE.Vector3();
const vec2 = /* @__PURE__ */ new THREE.Vector3();
const originTmp = /* @__PURE__ */ new THREE.Vector3();

/** 与 AxisArrow 同 —— 求射线沿 `normal` 方向的有符号拖拽偏移。 */
const calculateOffset = (
  clickPoint: THREE.Vector3,
  normal: THREE.Vector3,
  rayStart: THREE.Vector3,
  rayDir: THREE.Vector3,
): number => {
  const e1 = normal.dot(normal);
  const e2 = normal.dot(clickPoint) - normal.dot(rayStart);
  const e3 = normal.dot(rayDir);

  if (e3 === 0) {
    return -e2 / e1;
  }

  vec1.copy(rayDir).multiplyScalar(e1 / e3).sub(normal);
  vec2.copy(rayDir).multiplyScalar(e2 / e3).add(rayStart).sub(clickPoint);

  const offset = -vec1.dot(vec2) / vec1.dot(vec1);
  return offset;
};

const upV = /* @__PURE__ */ new THREE.Vector3(0, 1, 0);
const scaleV = /* @__PURE__ */ new THREE.Vector3();
const scaleMatrix = /* @__PURE__ */ new THREE.Matrix4();
const rotMatrix = /* @__PURE__ */ new THREE.Matrix4();

/**
 * ScalingSphere —— 单轴缩放球。
 *
 * 沿 `direction` 方向拖拽，产生仅在该轴上缩放的世界增量矩阵（`scaleMatrix = mPLG · S · mPLG⁻¹`，
 * 使缩放在 gizmo 父级坐标系下作用于指定轴）。球体既是可见件也是命中件。
 *
 * 与 AxisArrow 不同：缩放矩阵以 **gizmo 组**（不含 `matrixL`）的世界矩阵为参考系，
 * 故这里读取 `this.parent.matrixWorld`（即 gizmoGroup）而非 `objGroup.matrixWorld`。
 */
export class ScalingSphere extends PivotHandle {
  private readonly direction: THREE.Vector3;
  private scale0 = 1;
  private scaleCur = 1;
  private clickInfo: {
    clickPoint: THREE.Vector3;
    dir: THREE.Vector3;
    mPLG: THREE.Matrix4;
    mPLGInv: THREE.Matrix4;
    offsetMultiplier: number;
  } | null = null;

  // 注：这两个字段在 _build()（由基类构造函数在 super() 期间调用）中赋值。
  // 用 `declare` 避免类字段定义语义（useDefineForClassFields）在 super() 返回后
  // 把它们重置为 undefined，覆盖 _build 的赋值。
  private declare spherePos: number;
  private declare mesh: THREE.Mesh;

  constructor(config: HandleConfig, axis: AxisIndex, direction: THREE.Vector3) {
    const quaternion = new THREE.Quaternion().setFromUnitVectors(upV, direction.clone().normalize());
    const matrixL = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
    super(config, axis, matrixL);
    this.direction = direction.clone().normalize();
  }

  protected _build(): void {
    const {
      fixed, scale, lineWidth, opacity, depthTest, renderOrder,
    } = this.config;
    const radius = fixed ? (lineWidth / scale) * RADIUS_WIDTH_FACTOR : scale / RADIUS_SCALE_DIVISOR;
    this.spherePos = fixed ? SPHERE_POS_FIXED : SPHERE_POS_FACTOR * scale;

    this.createAnnotation([0, this.spherePos / 2, 0]);

    const geo = new THREE.SphereGeometry(radius, SPHERE_SEGMENTS, SPHERE_SEGMENTS);
    const mat = new THREE.MeshBasicMaterial({
      transparent: opacity < 1,
      opacity,
      depthTest,
      color: this.currentColor.clone(),
    });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -10;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(0, this.spherePos, 0);
    this.mesh.renderOrder = renderOrder;
    this.addPickable(this.mesh);

    this.coloredMaterials.push(mat);
  }

  protected _applyColor(): void {
    this.coloredMaterials.forEach((m) => m.color.copy(this.currentColor));
  }

  onPointerDown(sample: PointerSample): void {
    const gizmo = this.parent as THREE.Object3D;
    rotMatrix.extractRotation(gizmo.matrixWorld);
    const clickPoint = sample.point.clone();
    const origin = originTmp.setFromMatrixPosition(gizmo.matrixWorld).clone();
    const dir = this.direction.clone().applyMatrix4(rotMatrix).normalize();
    const mPLG = gizmo.matrixWorld.clone();
    const mPLGInv = mPLG.clone().invert();
    const offsetMultiplier = this.config.fixed
      ? 1 / calculateScaleFactor(
        gizmo.getWorldPosition(vec1), this.config.scale,
        this.config.camera, this.config.getViewportSize(),
      )
      : 1;
    this.clickInfo = {
      clickPoint, dir, mPLG, mPLGInv, offsetMultiplier,
    };
    this.setAnnotationText(`${this.scaleCur.toFixed(2)}`);
    this.config.onDragStart({
      component: 'Sphere', axis: this.axis, origin, directions: [dir],
    });
  }

  onPointerMove(sample: PointerSample): void {
    if (!this.clickInfo) {
      return;
    }
    const {
      clickPoint, dir, mPLG, mPLGInv, offsetMultiplier,
    } = this.clickInfo;
    // 总是限制最小值，避免缩放到极小导致变换退化
    const min = this.config.scaleLimits?.[this.axis]?.[0] ?? MIN_SCALE_EPSILON;
    const max = this.config.scaleLimits?.[this.axis]?.[1];

    const offsetW = calculateOffset(clickPoint, dir, sample.ray.origin, sample.ray.direction);
    const offsetL = offsetW * offsetMultiplier;
    const offsetH = this.config.fixed ? offsetL : offsetL / this.config.scale;
    let upscale = Math.pow(2, offsetH * SCALE_EXPONENT_FACTOR);

    if (sample.shiftKey) {
      upscale = Math.round(upscale * SNAP_PRECISION) / SNAP_PRECISION;
    }

    upscale = Math.max(upscale, min / this.scale0);
    if (max !== undefined) {
      upscale = Math.min(upscale, max / this.scale0);
    }
    this.scaleCur = this.scale0 * upscale;
    this.mesh.position.set(0, this.spherePos + offsetL, 0);
    this.setAnnotationText(`${this.scaleCur.toFixed(2)}`);

    scaleV.set(1, 1, 1).setComponent(this.axis, upscale);
    scaleMatrix.makeScale(scaleV.x, scaleV.y, scaleV.z).premultiply(mPLG).multiply(mPLGInv);
    this.config.onDrag(scaleMatrix);
  }

  onPointerUp(): void {
    this.scale0 = this.scaleCur;
    this.clickInfo = null;
    this.mesh.position.set(0, this.spherePos, 0);
    this.config.onDragEnd();
    super.onPointerUp();
  }
}
