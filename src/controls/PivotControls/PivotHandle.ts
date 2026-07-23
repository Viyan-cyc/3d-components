import * as THREE from 'three';
import type { HandleConfig, PointerSample, AxisIndex } from './context';

/** 注释徽标屏幕投影用的临时向量。 */
const _projV = /* @__PURE__ */ new THREE.Vector3();

/**
 * PivotHandle —— 四类操控件（AxisArrow / PlaneSlider / AxisRotator / ScalingSphere）的公共基类。
 *
 * 提供各操控件共有的脚手架：
 * - `objGroup`：按 `matrixL`（轴朝向）对齐的本地组，`matrixAutoUpdate=false`。
 * - 颜色高亮：悬停时切换为 `hoveredColor`，否则为 `axisColors[axis]`。
 * - 可拾取物注册：把命中 mesh 打上 `userData.pivotHandle` 反查标记。
 * - 注释（annotation）：拖拽时显示数值的 DOM 徽标（`annotations` 开启时），
 *   黑底白字（与 drei 一致）。由基类每帧把 `objGroup` 本地锚点投影到屏幕定位，
 *   不依赖 {@link Html} 组件（其会清空行内样式，无法保留徽标样式）。
 *
 * 子类负责 `_build()`（几何 + 命中 mesh）、`_applyColor()`、以及拖拽语义方法。
 */
export abstract class PivotHandle extends THREE.Group {
	declare readonly axis: AxisIndex;

	protected readonly config: HandleConfig;
	/** 对齐到该操控件本地坐标系的组（`matrixAutoUpdate=false`）。 */
	protected readonly objGroup: THREE.Group;
	/** 参与射线拾取的命中对象。 */
	protected readonly pickables: THREE.Object3D[] = [];
	/** 需要随悬停切换颜色的材质（其 `color` 字段为 THREE.Color）。 */
	protected readonly coloredMaterials: { color: THREE.Color }[] = [];

	protected hovered = false;

	/** 注释徽标 DOM（`annotations` 关闭时为 null）。 */
	protected annotationDiv: HTMLDivElement | null = null;
	/** 注释锚点（`objGroup` 本地坐标）。 */
	private annotationAnchor: THREE.Vector3 | null = null;
	/** 注释是否应显示（由 setAnnotationText 控制，受背面剔除影响）。 */
	private annotationVisible = false;

	constructor(config: HandleConfig, axis: AxisIndex, matrixL: THREE.Matrix4) {
		super();
		this.config = config;
		this.axis = axis;
		this.objGroup = new THREE.Group();
		this.objGroup.matrixAutoUpdate = false;
		this.objGroup.matrix.copy(matrixL);
		this.add(this.objGroup);

		this.renderOrder = config.renderOrder;
		this._build();
	}

	// ---------------- 子类实现 ----------------

	/** 构建可见几何 + 命中 mesh，并注册可拾取物 / 颜色材质。 */
	protected abstract _build(): void;
	/** 把当前颜色（含悬停态）应用到可见材质。 */
	protected abstract _applyColor(): void;

	/** pointerdown：记录起始状态、调用 onDragStart。 */
	abstract onPointerDown(sample: PointerSample): void;
	/** pointermove：计算增量世界矩阵并调用 onDrag。 */
	abstract onPointerMove(sample: PointerSample): void;

	// ---------------- 公共生命周期 ----------------

	/** 当前应使用的颜色（悬停 ? hoveredColor : axisColors[axis]）。 */
	protected get currentColor(): THREE.Color {
		return this.hovered ? this.config.hoveredColor : this.config.axisColors[this.axis];
	}

	/** 设置悬停态并刷新可见颜色。 */
	setHover(hovered: boolean): void {
		if (hovered === this.hovered) return;
		this.hovered = hovered;
		this._applyColor();
	}

	/** pointerup 默认实现：子类按需覆写（恢复累积量基点等）。 */
	onPointerUp(): void {
		this.setAnnotationText(null);
	}

	/** 返回参与射线拾取的对象列表。 */
	getPickables(): THREE.Object3D[] {
		return this.pickables;
	}

	/**
	 * 每帧调用：把注释徽标投影到屏幕并定位（annotations 开启时）。
	 *
	 * 锚点为 `objGroup` 本地坐标，经 `localToWorld` → `camera.project` → 屏幕像素。
	 * 在相机背面时隐藏。
	 */
	update(_delta: number, camera: THREE.Camera, renderer: THREE.WebGLRenderer): void {
		const div = this.annotationDiv;
		if (!div || !this.annotationAnchor) return;

		// 首次挂载到 body（position:fixed，相对视口定位，不受父级定位影响）
		if (!div.parentNode) document.body.appendChild(div);

		if (!this.annotationVisible) {
			div.style.display = 'none';
			return;
		}

		// objGroup 本地锚点 → 世界 → NDC
		_projV.copy(this.annotationAnchor);
		this.objGroup.localToWorld(_projV);
		_projV.project(camera);
		// NDC z > 1 表示在相机背后
		if (_projV.z > 1) {
			div.style.display = 'none';
			return;
		}

		const rect = renderer.domElement.getBoundingClientRect();
		const x = rect.left + (_projV.x * 0.5 + 0.5) * rect.width;
		const y = rect.top + (-_projV.y * 0.5 + 0.5) * rect.height;
		div.style.left = `${x}px`;
		div.style.top = `${y}px`;
		div.style.display = 'block';
	}

	// ---------------- 子类辅助 ----------------

	/** 把一个对象登记为可拾取（打上反查标记），并加入 objGroup。 */
	protected addPickable(obj: THREE.Object3D): void {
		obj.userData.pivotHandle = this;
		this.pickables.push(obj);
		this.objGroup.add(obj);
	}

	/**
	 * 创建注释徽标（黑底白字，与 drei 一致），锚点为 `objGroup` 本地坐标。
	 * 仅 `annotations` 开启时创建。
	 */
	protected createAnnotation(anchorLocal: [number, number, number]): void {
		if (!this.config.annotations) return;
		const div = document.createElement('div');
		Object.assign(div.style, {
			position: 'fixed',
			left: '0px',
			top: '0px',
			display: 'none',
			background: '#151520',
			color: 'white',
			padding: '6px 8px',
			borderRadius: '7px',
			whiteSpace: 'nowrap',
			fontFamily: 'monospace',
			fontSize: '12px',
			pointerEvents: 'none',
			transform: 'translate(-50%, -50%)',
			zIndex: '1000',
		} satisfies Partial<CSSStyleDeclaration>);
		if (this.config.annotationsClass) div.className = this.config.annotationsClass;

		this.annotationDiv = div;
		this.annotationAnchor = new THREE.Vector3(anchorLocal[0], anchorLocal[1], anchorLocal[2]);
	}

	/** 设置注释文字（null 隐藏；实际显示还受背面剔除影响，见 {@link update}）。 */
	protected setAnnotationText(text: string | null): void {
		if (!this.annotationDiv) return;
		this.annotationVisible = text !== null;
		if (text === null) {
			this.annotationDiv.style.display = 'none';
		} else {
			this.annotationDiv.innerText = text;
			// display 由 update() 投影后决定（已挂载则先显示，下帧再校正）
			if (this.annotationDiv.parentNode) this.annotationDiv.style.display = 'block';
		}
	}

	/** 释放本操控件的几何 / 材质 / 注释。 */
	dispose(): void {
		this.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (mesh.geometry) mesh.geometry.dispose();
			const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
			if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
			else if (mat) mat.dispose();
		});
		if (this.annotationDiv?.parentNode) this.annotationDiv.parentNode.removeChild(this.annotationDiv);
		this.annotationDiv = null;
		this.annotationAnchor = null;
		this.pickables.length = 0;
		this.coloredMaterials.length = 0;
	}
}
