import * as THREE from 'three';
import { FatLine } from './FatLine';
import { PivotHandle } from './PivotHandle';
import type { HandleConfig, PointerSample, AxisIndex } from './context';

const clickDir = /* @__PURE__ */ new THREE.Vector3();
const intersectionDir = /* @__PURE__ */ new THREE.Vector3();

const toDegrees = (radians: number): number => (radians * 180) / Math.PI;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** 计算从 `clickPoint` 到 `intersectionPoint`（相对 `origin`）在 `e1`/`e2` 基底下的夹角增量。 */
const calculateAngle = (
	clickPoint: THREE.Vector3,
	intersectionPoint: THREE.Vector3,
	origin: THREE.Vector3,
	e1: THREE.Vector3,
	e2: THREE.Vector3,
): number => {
	clickDir.copy(clickPoint).sub(origin);
	intersectionDir.copy(intersectionPoint).sub(origin);
	const dote1e1 = e1.dot(e1);
	const dote2e2 = e2.dot(e2);
	const uClick = clickDir.dot(e1) / dote1e1;
	const vClick = clickDir.dot(e2) / dote2e2;
	const uIntersection = intersectionDir.dot(e1) / dote1e1;
	const vIntersection = intersectionDir.dot(e2) / dote2e2;
	const angleClick = Math.atan2(vClick, uClick);
	const angleIntersection = Math.atan2(vIntersection, uIntersection);
	return angleIntersection - angleClick;
};

const fmod = (num: number, denom: number): number => {
	let k = Math.floor(num / denom);
	k = k < 0 ? k + 1 : k;
	return num - k * denom;
};

/** 把角度归一化到 `[0, 2π)`。 */
const minimizeAngle = (angle: number): number => {
	let result = fmod(angle, 2 * Math.PI);
	if (Math.abs(result) < 1e-6) return 0.0;
	if (result < 0.0) result += 2 * Math.PI;
	return result;
};

const rotMatrix = /* @__PURE__ */ new THREE.Matrix4();
const posNew = /* @__PURE__ */ new THREE.Vector3();
const ray = /* @__PURE__ */ new THREE.Ray();
const intersection = /* @__PURE__ */ new THREE.Vector3();

/**
 * AxisRotator —— 绕平面法线轴的旋转弧。
 *
 * 在 `dir1`×`dir2` 平面内绕 `origin` 拖拽产生旋转增量（绕 `normal` 轴）。
 * `axis` 为旋转法线轴索引；可见部分为四分之一圆弧（FatLine），另有一段不可见 Torus 作命中区。
 */
export class AxisRotator extends PivotHandle {
	private angle = 0;
	private angle0 = 0;
	private clickInfo: {
		clickPoint: THREE.Vector3;
		origin: THREE.Vector3;
		e1: THREE.Vector3;
		e2: THREE.Vector3;
		normal: THREE.Vector3;
		plane: THREE.Plane;
	} | null = null;
	// 在 _build() 中赋值，用 `declare` 避免类字段定义语义覆盖。
	private declare line: FatLine;

	constructor(config: HandleConfig, axis: AxisIndex, dir1: THREE.Vector3, dir2: THREE.Vector3) {
		const d1 = dir1.clone().normalize();
		const d2 = dir2.clone().normalize();
		const matrixL = new THREE.Matrix4().makeBasis(d1, d2, new THREE.Vector3().crossVectors(d1, d2));
		super(config, axis, matrixL);
	}

	protected _build(): void {
		const { fixed, scale, lineWidth, opacity, depthTest, renderOrder } = this.config;
		const r = fixed ? 0.65 : scale * 0.65;
		const tube = fixed ? (lineWidth / scale) * 1.6 : scale / 14;

		// 注释：弧的角点（与 drei 一致）
		this.createAnnotation([r, r, 0]);

		// 不可见命中环（管径放大以便拾取）
		const hitTube = Math.max(tube, scale * 0.1);
		const hitGeo = new THREE.TorusGeometry(r, hitTube, 8, 24, Math.PI / 2);
		const hitMesh = new THREE.Mesh(
			hitGeo,
			new THREE.MeshBasicMaterial({ transparent: true, opacity, depthTest, visible: false, side: THREE.DoubleSide }),
		);
		hitMesh.renderOrder = renderOrder;
		this.addPickable(hitMesh);

		// 可见四分之一圆弧
		const segments = 32;
		const points: THREE.Vector3[] = [];
		for (let j = 0; j <= segments; j++) {
			const a = (j * (Math.PI / 2)) / segments;
			points.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
		}
		this.line = new FatLine({
			points,
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
		this.clickInfo = { clickPoint, origin, e1, e2, normal, plane };
		this.setAnnotationText(`${toDegrees(this.angle).toFixed(0)}º`);
		this.config.onDragStart({ component: 'Rotator', axis: this.axis, origin, directions: [e1, e2, normal] });
	}

	onPointerMove(sample: PointerSample): void {
		if (!this.clickInfo) return;
		const { clickPoint, origin, e1, e2, normal, plane } = this.clickInfo;
		const [min, max] = this.config.rotationLimits?.[this.axis] ?? [undefined, undefined];

		ray.copy(sample.ray);
		ray.intersectPlane(plane, intersection);
		ray.direction.negate();
		ray.intersectPlane(plane, intersection);
		let deltaAngle = calculateAngle(clickPoint, intersection, origin, e1, e2);
		let degrees = toDegrees(deltaAngle);

		if (sample.shiftKey) {
			degrees = Math.round(degrees / 10) * 10;
			deltaAngle = toRadians(degrees);
		}

		if (min !== undefined && max !== undefined && max - min < 2 * Math.PI) {
			deltaAngle = minimizeAngle(deltaAngle);
			deltaAngle = deltaAngle > Math.PI ? deltaAngle - 2 * Math.PI : deltaAngle;
			deltaAngle = THREE.MathUtils.clamp(deltaAngle, min - this.angle0, max - this.angle0);
			this.angle = this.angle0 + deltaAngle;
		} else {
			this.angle = minimizeAngle(this.angle0 + deltaAngle);
			this.angle = this.angle > Math.PI ? this.angle - 2 * Math.PI : this.angle;
		}

		this.setAnnotationText(`${toDegrees(this.angle).toFixed(0)}º`);
		rotMatrix.makeRotationAxis(normal, deltaAngle);
		posNew.copy(origin).applyMatrix4(rotMatrix).sub(origin).negate();
		rotMatrix.setPosition(posNew);
		this.config.onDrag(rotMatrix);
	}

	onPointerUp(): void {
		this.angle0 = this.angle;
		this.clickInfo = null;
		this.config.onDragEnd();
		super.onPointerUp();
	}
}
