import * as THREE from 'three';
import { FatLine } from './FatLine';
import { PivotHandle } from './PivotHandle';
import type { HandleConfig, PointerSample, AxisIndex } from './context';

/**
 * 把 `offset` 分解到 `e1`/`e2` 二维基底上的系数 `[x, y]`（满足 `x*e1 + y*e2 ≈ offset`）。
 *
 * 通过选取绝对值最大的分量作主轴求解，避免基底退化时除零。移植自 drei PlaneSlider。
 */
const decomposeIntoBasis = (e1: THREE.Vector3, e2: THREE.Vector3, offset: THREE.Vector3): [number, number] => {
	const i1 =
		Math.abs(e1.x) >= Math.abs(e1.y) && Math.abs(e1.x) >= Math.abs(e1.z)
			? 0
			: Math.abs(e1.y) >= Math.abs(e1.x) && Math.abs(e1.y) >= Math.abs(e1.z)
				? 1
				: 2;
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
		const { fixed, scale, lineWidth, opacity, depthTest, renderOrder } = this.config;
		const pos1 = fixed ? 1 / 7 : scale / 7;
		const length = fixed ? 0.225 : scale * 0.225;

		// 与 drei 一致：注释锚点在原点
		this.createAnnotation([0, 0, 0]);

		// 实心填充平面（可见 + 命中区），位于 [pos1*1.7, pos1*1.7]，尺寸 length×length
		const center = pos1 * 1.7;
		const base = center - length / 2;
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

		// 可见方框轮廓（与填充平面同区域）
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

		this.coloredMaterials.push(fillMat, this.line.material);
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
		this.clickInfo = { clickPoint, e1, e2, plane };
		this.offsetX0 = this.config.translation.current[(this.axis + 1) % 3];
		this.offsetY0 = this.config.translation.current[(this.axis + 2) % 3];
		this.setAnnotationText(
			`${this.config.translation.current[(this.axis + 1) % 3].toFixed(2)}, ${this.config.translation.current[(this.axis + 2) % 3].toFixed(2)}`,
		);
		this.config.onDragStart({ component: 'Slider', axis: this.axis, origin, directions: [e1, e2, normal] });
	}

	onPointerMove(sample: PointerSample): void {
		if (!this.clickInfo) return;
		const { clickPoint, e1, e2, plane } = this.clickInfo;
		const [minX, maxX] = this.config.translationLimits?.[(this.axis + 1) % 3] ?? [undefined, undefined];
		const [minY, maxY] = this.config.translationLimits?.[(this.axis + 2) % 3] ?? [undefined, undefined];

		ray.copy(sample.ray);
		ray.intersectPlane(plane, intersection);
		ray.direction.negate();
		ray.intersectPlane(plane, intersection);
		intersection.sub(clickPoint);
		let [offsetX, offsetY] = decomposeIntoBasis(e1, e2, intersection);
		if (minX !== undefined) offsetX = Math.max(offsetX, minX - this.offsetX0);
		if (maxX !== undefined) offsetX = Math.min(offsetX, maxX - this.offsetX0);
		if (minY !== undefined) offsetY = Math.max(offsetY, minY - this.offsetY0);
		if (maxY !== undefined) offsetY = Math.min(offsetY, maxY - this.offsetY0);

		this.config.translation.current[(this.axis + 1) % 3] = this.offsetX0 + offsetX;
		this.config.translation.current[(this.axis + 2) % 3] = this.offsetY0 + offsetY;
		this.setAnnotationText(
			`${this.config.translation.current[(this.axis + 1) % 3].toFixed(2)}, ${this.config.translation.current[(this.axis + 2) % 3].toFixed(2)}`,
		);

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
}
