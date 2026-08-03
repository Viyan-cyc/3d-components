
import * as THREE from 'three';
import type { AxisIndex, HandleConfig, PointerSample } from './context';
import { FatLine } from './FatLine';
import { PivotHandle } from './PivotHandle';

/** 平面滑块位置除数（fixed 模式下 1/N，非 fixed 模式下 scale/N）。 */
const POS_DIVISOR = 7;

/** 平面滑块长度系数（fixed 模式，非 fixed 模式下 scale 的乘数）。 */
const LENGTH_FACTOR = 0.225;

/** 平面中心偏移乘数。 */
const CENTER_MULTIPLIER = 1.7;

/** 轴模运算的除数（三轴循环）。 */
const AXIS_MODULO = 3;

/** 找到向量中绝对值最大的分量索引。 */
const findMaxComponentIndex = (v: THREE.Vector3): number => {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ax >= ay && ax >= az) {
    return 0;
  }
  if (ay >= ax && ay >= az) {
    return 1;
  }
  return 2;
};

/**
 * 把 `offset` 分解到 `e1`/`e2` 二维基底上的系数 `[x, y]`（满足 `x*e1 + y*e2 ≈ offset`）。
 *
 * 通过选取绝对值最大的分量作主轴求解，避免基底退化时除零。
 */
const decomposeIntoBasis = (e1: THREE.Vector3, e2: THREE.Vector3, offset: THREE.Vector3): [number, number] => {
  const i1 = findMaxComponentIndex(e1);
  const order = [0, 1, 2].sort((a, b) => Math.abs(e2.getComponent(b)) - Math.abs(e2.getComponent(a)));
  const i2 = i1 === order[0] ? order[1] : order[0];
  const a1 = e1.getComponent(i1);
  const a2 = e1.getComponent(i2);
  const b1 = e2.getComponent(i1);
  const b2 = e2.getComponent(i2);
  const c1 = offset.getComponent(i1);
  const c2 = offset.getComponent(i2);

  const y = (c2 - (c1 * a2) / a1) / (b2 - (b1 * a2) / a1);
  const x = (c1 - y * b1) / a1;
  return [x, y];
};

const ray = /* @__PURE__ */ new THREE.Ray();
const intersection = /* @__PURE__ */ new THREE.Vector3();
const offsetMatrix = /* @__PURE__ */ new THREE.Matrix4();

/**
 * PlaneSlider —— 双轴平面平移滑块。
 *
 * 在 `dir1`×`dir2` 平面内拖拽，产生该平面内的世界平移增量矩阵。
 * `axis` 为平面法线轴索引；可见部分为一个 L 形方框（FatLine），另有一块不可见 Plane 作命中区。
 */
export class PlaneSlider extends PivotHandle {
  private clickInfo: {
    clickPoint: THREE.Vector3;
    e1: THREE.Vector3;
    e2: THREE.Vector3;
    plane: THREE.Plane;
  } | null = null;

  private offsetX0 = 0;
  private offsetY0 = 0;
  // 在 _build() 中赋值，用 `declare` 避免类字段定义语义覆盖。
  private declare line: FatLine;

  constructor(config: HandleConfig, axis: AxisIndex, dir1: THREE.Vector3, dir2: THREE.Vector3) {
    const d1 = dir1.clone().normalize();
    const d2 = dir2.clone().normalize();
    const matrixL = new THREE.Matrix4().makeBasis(d1, d2, new THREE.Vector3().crossVectors(d1, d2));
    super(config, axis, matrixL);
  }

  protected _build(): void {
    const {
      fixed, scale, lineWidth, opacity, depthTest, renderOrder,
    } = this.config;
    const pos1 = fixed ? 1 / POS_DIVISOR : scale / POS_DIVISOR;
    const length = fixed ? LENGTH_FACTOR : scale * LENGTH_FACTOR;

    this.createAnnotation([0, 0, 0]);
    this.buildFillPlane(pos1, length, opacity, depthTest, renderOrder);
    this.buildOutline({
      pos1, length, lineWidth, opacity, depthTest, renderOrder,
    });
  }

  /** 构建实心填充平面（可见 + 命中区）。 */
  private buildFillPlane(
    pos1: number, length: number,
    opacity: number, depthTest: boolean, renderOrder: number,
  ): void {
    const center = pos1 * CENTER_MULTIPLIER;
    const fillGeo = new THREE.PlaneGeometry(length, length);
    const fillMat = new THREE.MeshBasicMaterial({
      transparent: opacity < 1,
      opacity,
      depthTest,
      color: this.currentColor.clone(),
      side: THREE.DoubleSide,
    });
    fillMat.polygonOffset = true;
    fillMat.polygonOffsetFactor = -10;
    const fillMesh = new THREE.Mesh(fillGeo, fillMat);
    fillMesh.position.set(center, center, 0);
    fillMesh.renderOrder = renderOrder;
    this.addPickable(fillMesh);
    this.coloredMaterials.push(fillMat);
  }

  /** 构建可见方框轮廓。 */
  private buildOutline(params: {
    pos1: number; length: number; lineWidth: number;
    opacity: number; depthTest: boolean; renderOrder: number;
  }): void {
    const {
      pos1, length, lineWidth, opacity, depthTest, renderOrder,
    } = params;
    const center = pos1 * CENTER_MULTIPLIER;
    const base = center - length / 2;
    this.line = new FatLine({
      points: [
        new THREE.Vector3(base, base, 0),
        new THREE.Vector3(base, base + length, 0),
        new THREE.Vector3(base + length, base + length, 0),
        new THREE.Vector3(base + length, base, 0),
        new THREE.Vector3(base, base, 0),
      ],
      lineWidth,
      color: this.currentColor.getHex(),
      opacity,
      depthTest,
      renderOrder,
      polygonOffset: true,
      polygonOffsetFactor: -10,
    });
    this.objGroup.add(this.line);

    this.coloredMaterials.push(this.line.material);
    this.config.registerLineMaterial(this.line.material);
  }

  protected _applyColor(): void {
    this.coloredMaterials.forEach((m) => m.color.copy(this.currentColor));
  }

  onPointerDown(sample: PointerSample): void {
    const clickPoint = sample.point.clone();
    const origin = new THREE.Vector3().setFromMatrixPosition(this.objGroup.matrixWorld);
    const e1 = new THREE.Vector3().setFromMatrixColumn(this.objGroup.matrixWorld, 0).normalize();
    const e2 = new THREE.Vector3().setFromMatrixColumn(this.objGroup.matrixWorld, 1).normalize();
    const normal = new THREE.Vector3().setFromMatrixColumn(this.objGroup.matrixWorld, 2).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
    this.clickInfo = {
      clickPoint, e1, e2, plane,
    };
    const axisX = (this.axis + 1) % AXIS_MODULO;
    const axisY = (this.axis + 2) % AXIS_MODULO;
    this.offsetX0 = this.config.translation.current[axisX];
    this.offsetY0 = this.config.translation.current[axisY];
    const text = this.formatTranslationText(axisX, axisY);
    this.setAnnotationText(text);
    this.config.onDragStart({
      component: 'Slider', axis: this.axis, origin, directions: [e1, e2, normal],
    });
  }

  onPointerMove(sample: PointerSample): void {
    if (!this.clickInfo) {
      return;
    }
    const {
      clickPoint, e1, e2, plane,
    } = this.clickInfo;
    const axisX = (this.axis + 1) % AXIS_MODULO;
    const axisY = (this.axis + 2) % AXIS_MODULO;
    const [minX, maxX] = this.config.translationLimits?.[axisX] ?? [undefined, undefined];
    const [minY, maxY] = this.config.translationLimits?.[axisY] ?? [undefined, undefined];

    ray.copy(sample.ray);
    ray.intersectPlane(plane, intersection);
    ray.direction.negate();
    ray.intersectPlane(plane, intersection);
    intersection.sub(clickPoint);
    let [offsetX, offsetY] = decomposeIntoBasis(e1, e2, intersection);
    if (minX !== undefined) {
      offsetX = Math.max(offsetX, minX - this.offsetX0);
    }
    if (maxX !== undefined) {
      offsetX = Math.min(offsetX, maxX - this.offsetX0);
    }
    if (minY !== undefined) {
      offsetY = Math.max(offsetY, minY - this.offsetY0);
    }
    if (maxY !== undefined) {
      offsetY = Math.min(offsetY, maxY - this.offsetY0);
    }

    this.config.translation.current[axisX] = this.offsetX0 + offsetX;
    this.config.translation.current[axisY] = this.offsetY0 + offsetY;
    this.setAnnotationText(this.formatTranslationText(axisX, axisY));

    offsetMatrix.makeTranslation(
      offsetX * e1.x + offsetY * e2.x,
      offsetX * e1.y + offsetY * e2.y,
      offsetX * e1.z + offsetY * e2.z,
    );
    this.config.onDrag(offsetMatrix);
  }

  onPointerUp(): void {
    this.clickInfo = null;
    this.config.onDragEnd();
    super.onPointerUp();
  }

  /** 格式化平移注释文字。 */
  private formatTranslationText(axisX: number, axisY: number): string {
    const xVal = this.config.translation.current[axisX].toFixed(2);
    const yVal = this.config.translation.current[axisY].toFixed(2);
    return `${xVal}, ${yVal}`;
  }
}
