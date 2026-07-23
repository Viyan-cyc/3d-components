import type * as THREE from 'three';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { ViewportSize } from './calculateScaleFactor';

/** 单个轴的 `[min, max]` 区间限制；任一端可为 `undefined` 表示不限制。 */
export type AxisLimit = [number | undefined, number | undefined];

/** 三轴区间限制元组（X / Y / Z）。 */
export type LimitsTuple = [AxisLimit, AxisLimit, AxisLimit];

/** 轴索引（0 = X, 1 = Y, 2 = Z）。 */
export type AxisIndex = 0 | 1 | 2;

/**
 * 拖拽开始时回调收到的上下文信息。
 *
 * 移植自 [drei pivotControls/context](https://github.com/pmndrs/drei/blob/master/src/web/pivotControls/context.ts)。
 */
export interface OnDragStartProps {
	/** 触发拖拽的操控件类型。 */
	component: 'Arrow' | 'Slider' | 'Rotator' | 'Sphere';
	/** 该操控件作用于的轴。 */
	axis: AxisIndex;
	/** 操控件在世界空间的原点（矩阵位置）。 */
	origin: THREE.Vector3;
	/** 拖拽方向基（Arrow/Sphere 为单方向；Slider/Rotator 为平面双方向 + 法线）。 */
	directions: THREE.Vector3[];
}

/**
 * 一次指针采样的输入（pointerdown / pointermove 共用）。
 *
 * 移植自 R3F 的 `ThreeEvent`：`point` 为射线命中点，`ray` 为当前相机射线，
 * `shiftKey` 用于旋转 / 缩放的吸附（按住 Shift 取整）。
 */
export interface PointerSample {
	/** 射线与操控件的命中交点（pointerdown 时使用）。 */
	point: THREE.Vector3;
	/** 当前相机射线（origin + direction）。 */
	ray: THREE.Ray;
	/** 是否按住 Shift（吸附取整）。 */
	shiftKey: boolean;
}

/**
 * 各操控件共享的配置（等价于 drei 的 React Context）。
 *
 * 由 {@link PivotControls} 构造后传给每个操控件实例。`translation.current` 为三轴共享的可变累积平移。
 */
export interface HandleConfig {
	// ---- 几何与外观 ----
	scale: number;
	lineWidth: number;
	fixed: boolean;
	/** 已归一化（THREE.Color）的三轴颜色。 */
	axisColors: [THREE.Color, THREE.Color, THREE.Color];
	hoveredColor: THREE.Color;
	opacity: number;
	depthTest: boolean;
	renderOrder: number;
	userData?: Record<string, unknown>;
	annotations: boolean;
	annotationsClass?: string;

	// ---- 共享状态 ----
	/** 三轴累积平移（Arrow / Slider 共享读写）。 */
	translation: { current: [number, number, number] };

	// ---- 限制 ----
	translationLimits?: LimitsTuple;
	rotationLimits?: LimitsTuple;
	scaleLimits?: LimitsTuple;

	// ---- 相机 / 视口（fixed 模式用） ----
	camera: THREE.Camera;
	getViewportSize: () => ViewportSize;

	// ---- 拖拽回调（操控件把世界空间增量矩阵交回 PivotControls） ----
	onDragStart: (props: OnDragStartProps) => void;
	onDrag: (matrixDeltaWorld: THREE.Matrix4) => void;
	onDragEnd: () => void;

	// ---- FatLine 分辨率注册（PivotControls 每帧统一刷新 LineMaterial.resolution） ----
	registerLineMaterial: (material: LineMaterial) => void;
}
