import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

export interface FatLineOptions {
	/** 线点序列（按顺序连接）。 */
	points: THREE.Vector3[];
	/** 屏幕空间线宽（像素，`worldUnits=false` 时）。 */
	lineWidth: number;
	/** 颜色。 */
	color: THREE.ColorRepresentation;
	/** 透明度。 */
	opacity?: number;
	/** 是否做深度测试。 */
	depthTest?: boolean;
	/** 渲染顺序。 */
	renderOrder?: number;
	/** 多边形偏移（避免与操控件 mesh 互相 z-fighting）。 */
	polygonOffset?: boolean;
	polygonOffsetFactor?: number;
	/** 是否透明。 */
	transparent?: boolean;
}

/**
 * FatLine —— 可控线宽的线段（基于 three 的 Line2 / LineMaterial）。
 *
 * PivotControls 的可见操控件（箭头轴、平面外框、旋转弧）用它绘制；
 * `LineMaterial.resolution` 由 PivotControls 每帧统一刷新为画布像素尺寸。
 *
 * 对应 drei 的 `Line` 组件（仅取渲染部分，不含事件 / dashed）。
 */
export class FatLine extends Line2 {
	/** 暴露给 PivotControls 刷新分辨率。 */
	declare material: LineMaterial;

	constructor(options: FatLineOptions) {
		const geometry = new LineGeometry();
		geometry.setPositions(FatLine.toFlat(options.points));

		const material = new LineMaterial({
			color: new THREE.Color(options.color),
			linewidth: options.lineWidth,
			transparent: options.transparent ?? (options.opacity !== undefined && options.opacity < 1),
			opacity: options.opacity ?? 1,
			depthTest: options.depthTest ?? true,
			// linewidth 以像素计（非世界单位）
			worldUnits: false,
			// 初始给一个占位分辨率，PivotControls.update 会按画布尺寸刷新
			resolution: new THREE.Vector2(1024, 1024),
		});
		if (options.polygonOffset) {
			material.polygonOffset = true;
			material.polygonOffsetFactor = options.polygonOffsetFactor ?? -10;
			material.polygonOffsetUnits = 1;
		}
		material.toneMapped = false;

		super(geometry, material);
		this.computeLineDistances();
		if (options.renderOrder !== undefined) this.renderOrder = options.renderOrder;
		this.raycast = () => {
			/* FatLine 不参与射线拾取 —— 拾取由各操控件自带的不可见 mesh 负责 */
		};
	}

	/** 设置线宽（像素）。 */
	setLineWidth(w: number): void {
		this.material.linewidth = w;
	}

	/** 设置颜色。 */
	setColor(color: THREE.ColorRepresentation): void {
		this.material.color.set(color);
	}

	/** 把 Vector3 序列展平为 LineGeometry.setPositions 需要的扁平数组。 */
	private static toFlat(points: THREE.Vector3[]): number[] {
		const flat = new Array(points.length * 3);
		for (let i = 0; i < points.length; i++) {
			const p = points[i];
			flat[i * 3] = p.x;
			flat[i * 3 + 1] = p.y;
			flat[i * 3 + 2] = p.z;
		}
		return flat;
	}

	dispose(): void {
		this.geometry.dispose();
		this.material.dispose();
	}
}
