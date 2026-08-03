
import * as THREE from 'three';
import type { AxisIndex, HandleConfig, PointerSample } from './context';
import { FatLine } from './FatLine';
import { PivotHandle } from './PivotHandle';

/** 锥头宽度系数（fixed 模式下 lineWidth / scale 的乘数）。 */
const CONE_WIDTH_FACTOR = 1.6;

/** 锥头宽度除数（非 fixed 模式下 scale 的除数）。 */
const CONE_WIDTH_DIVISOR = 20;

/** 锥头长度（fixed 模式）。 */
const CONE_LENGTH_FIXED = 0.2;

/** 锥头长度除数（非 fixed 模式下 scale 的除数）。 */
const CONE_LENGTH_DIVISOR = 5;

/** 命中盒尺寸：锥头宽度放大系数。 */
const HIT_CONE_WIDTH_FACTOR = 2.8;

/** 命中盒尺寸：scale 放大系数。 */
const HIT_SCALE_FACTOR = 0.5;

/** 锥体几何分段数。 */
const CONE_SEGMENTS = 12;

const vec1 = /* @__PURE__ */ new THREE.Vector3();
const vec2 = /* @__PURE__ */ new THREE.Vector3();

/**
 * 计算射线在给定方向上的「拖拽偏移量」。
 *
 * `calculateOffset`：求射线与过 `clickPoint`、法线为 `normal`
 * 的平面交点沿 `normal` 方向的有符号距离。
 */
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
const offsetMatrix = /* @__PURE__ */ new THREE.Matrix4();
const rotMatrix = /* @__PURE__ */ new THREE.Matrix4();

/**
 * AxisArrow —— 单轴平移箭头。
 *
 * 沿 `direction` 方向拖拽，产生该方向的世界平移增量矩阵。
 * 由本地 `matrixL`（把 +Y 对齐到 `direction`）定位，可见部分为一根粗线（FatLine）+ 锥头，
 * 另有一根不可见圆柱体（覆盖全长）作为射线命中区。
 */
export class AxisArrow extends PivotHandle {
  private readonly direction: THREE.Vector3;
  private clickInfo: { clickPoint: THREE.Vector3; dir: THREE.Vector3 } | null = null;
  private offset0 = 0;
  // 注：以下字段在 _build()（由基类构造函数在 super() 期间调用）中赋值。
  // 用 `declare` 避免类字段定义语义在 super() 返回后把它们重置为 undefined。
  private declare cylinderLength: number;

  private declare line: FatLine;
  private declare cone: THREE.Mesh;

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
    const coneWidth = fixed ? (lineWidth / scale) * CONE_WIDTH_FACTOR : scale / CONE_WIDTH_DIVISOR;
    const coneLength = fixed ? CONE_LENGTH_FIXED : scale / CONE_LENGTH_DIVISOR;
    this.cylinderLength = fixed ? 1 - coneLength : scale - coneLength;

    this.createAnnotation([0, -coneLength, 0]);
    this.buildHitMesh({
      coneWidth, coneLength, opacity, depthTest, renderOrder, scale,
    });
    this.buildVisibleParts(coneWidth, coneLength, opacity, depthTest, renderOrder);
  }

  /** 构建不可见命中盒（覆盖轴身 + 锥头全长）。 */
  private buildHitMesh(params: {
    coneWidth: number; coneLength: number; opacity: number;
    depthTest: boolean; renderOrder: number; scale: number;
  }): void {
    const {
      coneWidth, coneLength, opacity, depthTest, renderOrder, scale,
    } = params;
    const hitSize = Math.max(coneWidth * HIT_CONE_WIDTH_FACTOR, scale * HIT_SCALE_FACTOR);
    const hitGeo = new THREE.BoxGeometry(hitSize, this.cylinderLength + coneLength, hitSize);
    const hitMesh = new THREE.Mesh(
      hitGeo,
      new THREE.MeshBasicMaterial({
        transparent: true, opacity, depthTest, visible: false,
      }),
    );
    hitMesh.position.set(0, (this.cylinderLength + coneLength) / 2, 0);
    hitMesh.renderOrder = renderOrder;
    this.addPickable(hitMesh);
  }

  /** 构建可见轴身（粗线）和锥头。 */
  private buildVisibleParts(
    coneWidth: number, coneLength: number,
    opacity: number, depthTest: boolean, renderOrder: number,
  ): void {
    this.line = new FatLine({
      points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, this.cylinderLength, 0)],
      lineWidth: this.config.lineWidth,
      color: this.currentColor.getHex(),
      opacity,
      depthTest,
      renderOrder,
      polygonOffset: true,
      polygonOffsetFactor: -10,
    });
    this.objGroup.add(this.line);

    const coneGeo = new THREE.ConeGeometry(coneWidth, coneLength, CONE_SEGMENTS);
    const coneMat = new THREE.MeshBasicMaterial({
      transparent: opacity < 1,
      opacity,
      depthTest,
      color: this.currentColor.clone(),
    });
    coneMat.polygonOffset = true;
    coneMat.polygonOffsetFactor = -10;
    this.cone = new THREE.Mesh(coneGeo, coneMat);
    this.cone.position.set(0, this.cylinderLength + coneLength / 2, 0);
    this.cone.renderOrder = renderOrder;
    this.objGroup.add(this.cone);

    this.coloredMaterials.push(this.line.material, coneMat);
    this.config.registerLineMaterial(this.line.material);
  }

  protected _applyColor(): void {
    const c = this.currentColor;
    this.coloredMaterials.forEach((m) => m.color.copy(c));
  }

  onPointerDown(sample: PointerSample): void {
    rotMatrix.extractRotation(this.matrixWorld);
    const clickPoint = sample.point.clone();
    const origin = new THREE.Vector3().setFromMatrixPosition(this.matrixWorld);
    const dir = this.direction.clone().applyMatrix4(rotMatrix).normalize();
    this.clickInfo = { clickPoint, dir };
    this.offset0 = this.config.translation.current[this.axis];
    this.setAnnotationText(`${this.config.translation.current[this.axis].toFixed(2)}`);
    this.config.onDragStart({
      component: 'Arrow', axis: this.axis, origin, directions: [dir],
    });
  }

  onPointerMove(sample: PointerSample): void {
    if (!this.clickInfo) {
      return;
    }
    const { clickPoint, dir } = this.clickInfo;
    const [min, max] = this.config.translationLimits?.[this.axis] ?? [undefined, undefined];

    let offset = calculateOffset(clickPoint, dir, sample.ray.origin, sample.ray.direction);
    if (min !== undefined) {
      offset = Math.max(offset, min - this.offset0);
    }
    if (max !== undefined) {
      offset = Math.min(offset, max - this.offset0);
    }
    this.config.translation.current[this.axis] = this.offset0 + offset;

    this.setAnnotationText(`${this.config.translation.current[this.axis].toFixed(2)}`);
    offsetMatrix.makeTranslation(dir.x * offset, dir.y * offset, dir.z * offset);
    this.config.onDrag(offsetMatrix);
  }

  onPointerUp(): void {
    this.clickInfo = null;
    this.config.onDragEnd();
    super.onPointerUp();
  }
}
