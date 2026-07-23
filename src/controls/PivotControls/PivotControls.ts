import * as THREE from 'three';
import type { ComponentOptions, IUpdatable, IDisposable } from '../../types';
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { OnDragStartProps, HandleConfig, LimitsTuple, AxisIndex } from './context';
import { calculateScaleFactor } from './calculateScaleFactor';
import { AxisArrow } from './AxisArrow';
import { PlaneSlider } from './PlaneSlider';
import { AxisRotator } from './AxisRotator';
import { ScalingSphere } from './ScalingSphere';
import type { PivotHandle } from './PivotHandle';

const xDir = /* @__PURE__ */ new THREE.Vector3(1, 0, 0);
const yDir = /* @__PURE__ */ new THREE.Vector3(0, 1, 0);
const zDir = /* @__PURE__ */ new THREE.Vector3(0, 0, 1);

// anchor / 包围盒计算用的临时量（一次性、非重入）
const bb = /* @__PURE__ */ new THREE.Box3();
const bbObj = /* @__PURE__ */ new THREE.Box3();
const vCenter = /* @__PURE__ */ new THREE.Vector3();
const vSize = /* @__PURE__ */ new THREE.Vector3();
const vAnchorOffset = /* @__PURE__ */ new THREE.Vector3();
const mLanchor = /* @__PURE__ */ new THREE.Matrix4();
const mPInvAnchor = /* @__PURE__ */ new THREE.Matrix4();

/** 相机控制器最小结构（如 OrbitControls，仅需 `enabled` 可读写）。 */
export interface PivotControlsLike {
	enabled?: boolean;
}

/**
 * PivotControls 构造选项。
 *
 * 移植自 [drei PivotControls](https://github.com/pmndrs/drei/blob/master/src/web/pivotControls/PivotControls.tsx)，
 * 改写为原生 Three.js 的 `THREE.Group` 子类（无 React）。把组件 `scene.add(pivot)` 后，
 * 把要被操控的内容 `pivot.add(content)`，并在每帧渲染循环里调用 `pivot.update(delta)`。
 */
export interface PivotControlsOptions extends ComponentOptions {
	// ---- 渲染 / 相机（必填）----
	/** 观察相机（`fixed` 模式与缩放计算依赖）。 */
	camera: THREE.Camera;
	/** 渲染器（提供 canvas + 视口尺寸；指针监听挂在其 `domElement` 上）。 */
	renderer: THREE.WebGLRenderer;
	/** 相机控制器（OrbitControls 等）；拖拽期间会被临时禁用以抑制轨道。 */
	controls?: PivotControlsLike;

	// ---- 行为 ----
	/** 是否启用交互（false 时 gizmo 仅显示、不响应拖拽）。 @default true */
	enabled?: boolean;
	/** 拖拽后是否自动把局部变换应用到本组（false 时只通过 onDrag 回调输出矩阵）。 @default true */
	autoTransform?: boolean;
	/** 各轴是否参与（X/Y/Z）。 @default [true, true, true] */
	activeAxes?: [boolean, boolean, boolean];
	/** 关闭某类操控件。 */
	disableAxes?: boolean;
	disableSliders?: boolean;
	disableRotations?: boolean;
	disableScaling?: boolean;

	// ---- 定位 ----
	/** gizmo 相对原点的额外平移（不受 anchor 影响，二者叠加）。 @default [0,0,0] */
	offset?: [number, number, number];
	/** gizmo 起始旋转（Euler，XYZ 顺序）。 @default [0,0,0] */
	rotation?: [number, number, number];
	/** 受控起始矩阵（受控模式：每帧以该矩阵覆盖本组矩阵；拖拽不会持久）。 */
	matrix?: THREE.Matrix4;
	/** 包围盒锚点 —— 每个分量为 -1 / 0 / +1，把 gizmo 定位到内容包围盒的角 / 边 / 中心。 */
	anchor?: [number, number, number];

	// ---- 外观 ----
	/** gizmo 整体缩放（世界单位；`fixed` 时为像素）。 @default 1 */
	scale?: number;
	/** 可见线条宽度（像素）。 @default 4 */
	lineWidth?: number;
	/** 为 true 时 gizmo 保持固定屏幕像素尺寸（`scale` 语义变为像素）。 @default false */
	fixed?: boolean;
	/** gizmo 是否可见。 @default true */
	visible?: boolean;
	/** 三轴颜色 `[X, Y, Z]`。 @default ['#ff2060','#20df80','#2080ff'] */
	axisColors?: [THREE.ColorRepresentation, THREE.ColorRepresentation, THREE.ColorRepresentation];
	/** 悬停高亮色。 @default '#ffff40' */
	hoveredColor?: THREE.ColorRepresentation;
	/** 整体不透明度。 @default 1 */
	opacity?: number;
	/** 是否做深度测试（false 则 gizmo 穿透显示）。 @default true */
	depthTest?: boolean;
	/** 渲染顺序。 @default 500 */
	renderOrder?: number;
	/** 附着到命中 mesh 的自定义 userData。 */
	userData?: Record<string, unknown>;

	// ---- 限制 ----
	translationLimits?: LimitsTuple;
	rotationLimits?: LimitsTuple;
	scaleLimits?: LimitsTuple;

	// ---- 注释 ----
	/** 拖拽时显示数值徽标。 @default false */
	annotations?: boolean;
	/** 徽标 div 的额外 CSS 类名。 */
	annotationsClass?: string;

	// ---- 子节点 ----
	/** 受控内容（自动 `this.add`）。也可构造后用 `pivot.add(content)`。 */
	children?: THREE.Object3D[];

	// ---- 事件 ----
	onDragStart?: (props: OnDragStartProps) => void;
	/** 拖拽中：`(local, deltaLocal, world, deltaWorld)`。 */
	onDrag?: (local: THREE.Matrix4, deltaLocal: THREE.Matrix4, world: THREE.Matrix4, deltaWorld: THREE.Matrix4) => void;
	onDragEnd?: () => void;
}

/**
 * PivotControls —— 统一变换操控 Gizmo（平移 / 旋转 / 缩放一体）。
 *
 * 参考 [drei PivotControls](https://github.com/pmndrs/drei/blob/master/src/web/pivotControls/PivotControls.tsx)
 * 的原生 Three.js 实现。与 {@link https://threejs.org/docs/#examples/en/controls/TransformControls | TransformControls}
 * 「一次只显示一种模式」不同，PivotControls 在一个 gizmo 上**同时**呈现：
 * - 三根**轴箭头**（AxisArrow，单轴平移）
 * - 三个**平面滑块**（PlaneSlider，双轴平移）
 * - 三段**旋转弧**（AxisRotator，绕轴旋转）
 * - 三个**缩放球**（ScalingSphere，单轴缩放）
 *
 * ## 用法
 * ```ts
 * const pivot = new PivotControls({ camera, renderer, controls: orbit });
 * scene.add(pivot);
 * pivot.add(model);              // 受控内容
 *
 * function frame() {
 *   const dt = clock.getDelta();
 *   orbit.update();
 *   pivot.update(dt);            // 每帧调用（同步 fixed 缩放 / 刷新线条分辨率）
 *   renderer.render(scene, camera);
 *   requestAnimationFrame(frame);
 * }
 * ```
 *
 * @remarks
 * - 本类 `matrixAutoUpdate = false`，变换矩阵以 `matrix` 为准（拖拽时由 `autoTransform` 写入）。
 * - 内容请通过 `pivot.add()` 或 `children` 选项添加到本组（会随 pivot 变换）。
 * - 拖拽期间会临时把 `controls.enabled` 置 false；松手还原。
 */
export class PivotControls extends THREE.Group implements IUpdatable, IDisposable {
	// ---- 外部依赖 ----
	private readonly camera: THREE.Camera;
	private readonly renderer: THREE.WebGLRenderer;
	private readonly controls: PivotControlsLike | undefined;
	private readonly domElement: HTMLElement;

	// ---- 配置（已归一化）----
	private readonly _scale: number;
	private readonly _fixed: boolean;
	private readonly _autoTransform: boolean;
	private readonly _externalMatrix: THREE.Matrix4 | undefined;
	private readonly _anchor: [number, number, number] | undefined;
	private readonly _offset: [number, number, number];

	private _enabled: boolean;
	private _visible: boolean;

	private readonly _onDragStartCb?: (props: OnDragStartProps) => void;
	private readonly _onDragCb?: (l: THREE.Matrix4, dl: THREE.Matrix4, w: THREE.Matrix4, dw: THREE.Matrix4) => void;
	private readonly _onDragEndCb?: () => void;

	// ---- 子结构 ----
	/** gizmo 组（offset/anchor 定位 + 每帧缩放补偿），挂在本组下。 */
	private readonly gizmoGroup: THREE.Group;
	private readonly handles: PivotHandle[] = [];
	/** 全部可拾取命中对象（扁平）。 */
	private readonly pickables: THREE.Object3D[] = [];
	private readonly lineMaterials: LineMaterial[] = [];

	// ---- 共享状态 ----
	private readonly translation = { current: [0, 0, 0] as [number, number, number] };

	// ---- 拖拽矩阵（实例级，避免跨实例共享）----
	private readonly _mL0 = new THREE.Matrix4();
	private readonly _mW0 = new THREE.Matrix4();
	private readonly _mP = new THREE.Matrix4();
	private readonly _mPInv = new THREE.Matrix4();
	private readonly _mW = new THREE.Matrix4();
	private readonly _mL = new THREE.Matrix4();
	private readonly _mL0Inv = new THREE.Matrix4();
	private readonly _mdL = new THREE.Matrix4();
	private readonly _identity = new THREE.Matrix4();

	// ---- update() 临时量 ----
	private readonly _mG = new THREE.Matrix4();
	private readonly _cameraScale = new THREE.Vector3(1, 1, 1);
	private readonly _gizmoScale = new THREE.Vector3();
	private readonly _vScale = new THREE.Vector3();
	private readonly _tmpVec = new THREE.Vector3();

	// ---- 指针 / 射线 ----
	private readonly _raycaster = new THREE.Raycaster();
	private readonly _ndc = new THREE.Vector2();
	private _activeHandle: PivotHandle | null = null;
	private _hoveredHandle: PivotHandle | null = null;
	private _pointerId: number | null = null;
	private _controlsWasEnabled = true;

	/** 共享配置（传给各操控件）。 */
	private readonly _config: HandleConfig;

	constructor(options: PivotControlsOptions) {
		super();

		this.camera = options.camera;
		this.renderer = options.renderer;
		this.controls = options.controls;
		this.domElement = options.renderer.domElement;

		this._scale = options.scale ?? 1;
		this._fixed = options.fixed ?? false;
		this._autoTransform = options.autoTransform ?? true;
		this._externalMatrix = options.matrix;
		this._anchor = options.anchor;
		this._offset = options.offset ?? [0, 0, 0];
		this._enabled = options.enabled ?? true;
		this._visible = options.visible ?? true;

		this._onDragStartCb = options.onDragStart;
		this._onDragCb = options.onDrag;
		this._onDragEndCb = options.onDragEnd;

		if (options.name) this.name = options.name;
		if (options.userData) this.userData = { ...options.userData };

		// 本组以 matrix 为准（受控 / autoTransform 写入）
		this.matrixAutoUpdate = false;
		if (options.matrix) this.matrix.copy(options.matrix);
		else this.matrix.identity();

		// 归一化颜色
		const axisColors: [THREE.Color, THREE.Color, THREE.Color] = options.axisColors
			? (options.axisColors.map((c) => new THREE.Color(c)) as [THREE.Color, THREE.Color, THREE.Color])
			: [new THREE.Color('#ff2060'), new THREE.Color('#20df80'), new THREE.Color('#2080ff')];
		const hoveredColor = new THREE.Color(options.hoveredColor ?? '#ffff40');

		// gizmo 组
		this.gizmoGroup = new THREE.Group();
		this.gizmoGroup.visible = this._visible;
		this.gizmoGroup.position.set(this._offset[0], this._offset[1], this._offset[2]);
		this.gizmoGroup.rotation.set(options.rotation?.[0] ?? 0, options.rotation?.[1] ?? 0, options.rotation?.[2] ?? 0);
		this.add(this.gizmoGroup);

		// 共享配置
		this._config = {
			scale: this._scale,
			lineWidth: options.lineWidth ?? 4,
			fixed: this._fixed,
			axisColors,
			hoveredColor,
			opacity: options.opacity ?? 1,
			depthTest: options.depthTest ?? true,
			renderOrder: options.renderOrder ?? 500,
			userData: options.userData,
			annotations: options.annotations ?? false,
			annotationsClass: options.annotationsClass,
			translation: this.translation,
			translationLimits: options.translationLimits,
			rotationLimits: options.rotationLimits,
			scaleLimits: options.scaleLimits,
			camera: this.camera,
			getViewportSize: () => ({ width: this.domElement.clientWidth, height: this.domElement.clientHeight }),
			onDragStart: this._onDragStart,
			onDrag: this._onDrag,
			onDragEnd: this._onDragEnd,
			registerLineMaterial: (m) => this.lineMaterials.push(m),
		};

		// 构建操控件
		this._buildHandles(options);

		// 受控内容
		if (options.children) for (const c of options.children) this.add(c);

		// 包围盒锚点定位
		if (this._anchor) this.recomputeAnchor();

		// 指针监听（捕获阶段，尽早拦截）
		this.domElement.addEventListener('pointerdown', this._onPointerDown, true);
		this.domElement.addEventListener('pointermove', this._onPointerMove);
		this.domElement.addEventListener('pointerup', this._onPointerUp);
		this.domElement.addEventListener('pointercancel', this._onPointerUp);
	}

	// ===================== 操控件构建 =====================

	private _buildHandles(options: PivotControlsOptions): void {
		const cfg = this._config;
		const active = options.activeAxes ?? [true, true, true];
		const add = (h: PivotHandle): void => {
			this.handles.push(h);
			this.gizmoGroup.add(h);
			for (const p of h.getPickables()) this.pickables.push(p);
		};

		if (!options.disableAxes) {
			if (active[0]) add(new AxisArrow(cfg, 0, xDir));
			if (active[1]) add(new AxisArrow(cfg, 1, yDir));
			if (active[2]) add(new AxisArrow(cfg, 2, zDir));
		}
		if (!options.disableSliders) {
			if (active[0] && active[1]) add(new PlaneSlider(cfg, 2, xDir, yDir));
			if (active[0] && active[2]) add(new PlaneSlider(cfg, 1, zDir, xDir));
			if (active[2] && active[1]) add(new PlaneSlider(cfg, 0, yDir, zDir));
		}
		if (!options.disableRotations) {
			if (active[0] && active[1]) add(new AxisRotator(cfg, 2, xDir, yDir));
			if (active[0] && active[2]) add(new AxisRotator(cfg, 1, zDir, xDir));
			if (active[2] && active[1]) add(new AxisRotator(cfg, 0, yDir, zDir));
		}
		if (!options.disableScaling) {
			if (active[0]) add(new ScalingSphere(cfg, 0, xDir));
			if (active[1]) add(new ScalingSphere(cfg, 1, yDir));
			if (active[2]) add(new ScalingSphere(cfg, 2, zDir));
		}
	}

	/** gizmo 组（offset / 操控件挂载点）。 */
	get gizmo(): THREE.Group {
		return this.gizmoGroup;
	}

	// ===================== 拖拽回调（世界增量 → 局部）=====================

	private readonly _onDragStart = (props: OnDragStartProps): void => {
		this._mL0.copy(this.matrix);
		this._mW0.copy(this.matrixWorld);
		this._onDragStartCb?.(props);
	};

	private readonly _onDrag = (mdW: THREE.Matrix4): void => {
		// 父级世界矩阵（本组所在坐标系）
		const parent = this.parent;
		this._mP.copy(parent ? parent.matrixWorld : this._identity);
		this._mPInv.copy(this._mP).invert();

		// 应用世界增量
		this._mW.copy(this._mW0).premultiply(mdW);
		this._mL.copy(this._mW).premultiply(this._mPInv);
		this._mL0Inv.copy(this._mL0).invert();
		this._mdL.copy(this._mL).multiply(this._mL0Inv);

		if (this._autoTransform) this.matrix.copy(this._mL);

		this._onDragCb?.(this._mL, this._mdL, this._mW, mdW);
	};

	private readonly _onDragEnd = (): void => {
		this._onDragEndCb?.();
	};

	// ===================== 包围盒锚点 =====================

	/** 仅遍历本组的「内容」子树（跳过 gizmo 组及其后代）。 */
	private _traverseContent(root: THREE.Object3D, cb: (o: THREE.Object3D) => void): void {
		for (const child of root.children) {
			if (child === this.gizmoGroup) continue;
			cb(child);
			this._traverseContent(child, cb);
		}
	}

	/**
	 * 重算 `anchor` 定位：遍历内容包围盒，把 gizmo 摆到锚点（角 / 边 / 中心）。
	 *
	 * 动态 `add` 内容后调用一次即可。
	 */
	recomputeAnchor(): void {
		if (!this._anchor) return;
		this.updateWorldMatrix(true, true);

		mPInvAnchor.copy(this.matrixWorld).invert();
		bb.makeEmpty();
		this._traverseContent(this, (obj) => {
			const mesh = obj as THREE.Mesh;
			if (!mesh.geometry) return;
			if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
			mLanchor.copy(mesh.matrixWorld).premultiply(mPInvAnchor);
			bbObj.copy(mesh.geometry.boundingBox!).applyMatrix4(mLanchor);
			bb.union(bbObj);
		});
		if (bb.isEmpty()) return;

		vCenter.copy(bb.max).add(bb.min).multiplyScalar(0.5);
		vSize.copy(bb.max).sub(bb.min).multiplyScalar(0.5);
		vAnchorOffset.copy(vSize).multiply(new THREE.Vector3(this._anchor[0], this._anchor[1], this._anchor[2])).add(vCenter);
		this.gizmoGroup.position.set(
			this._offset[0] + vAnchorOffset.x,
			this._offset[1] + vAnchorOffset.y,
			this._offset[2] + vAnchorOffset.z,
		);
	}

	// ===================== 每帧更新 =====================

	/**
	 * 每帧调用：刷新世界矩阵、`fixed` 模式的恒定像素缩放、FatLine 分辨率、注释徽标位置。
	 *
	 * 必须在你的渲染循环里调用（先于 `renderer.render`）。
	 */
	update(delta = 0): void {
		if (this._fixed) {
			const sf = calculateScaleFactor(
				this.gizmoGroup.getWorldPosition(this._tmpVec),
				this._scale,
				this.camera,
				{ width: this.domElement.clientWidth, height: this.domElement.clientHeight },
			);
			this._cameraScale.setScalar(sf);
		}

		// 受控模式：每帧以外部矩阵覆盖本组矩阵
		if (this._externalMatrix) this.matrix.copy(this._externalMatrix);

		this.updateWorldMatrix(true, true);

		// gizmo 缩放补偿：让 gizmo 在世界空间恒定为 cameraScale（固定像素或单位尺寸）
		this._mG.makeRotationFromEuler(this.gizmoGroup.rotation)
			.setPosition(this.gizmoGroup.position)
			.premultiply(this.matrixWorld);
		this._gizmoScale.setFromMatrixScale(this._mG);
		this._vScale.copy(this._cameraScale).divide(this._gizmoScale);
		if (
			Math.abs(this.gizmoGroup.scale.x - this._vScale.x) > 1e-4 ||
			Math.abs(this.gizmoGroup.scale.y - this._vScale.y) > 1e-4 ||
			Math.abs(this.gizmoGroup.scale.z - this._vScale.z) > 1e-4
		) {
			this.gizmoGroup.scale.copy(this._vScale);
		}

		// FatLine 分辨率（按画布像素尺寸）
		const w = this.renderer.domElement.clientWidth;
		const h = this.renderer.domElement.clientHeight;
		for (const m of this.lineMaterials) m.resolution.set(w, h);

		// 注释徽标屏幕定位
		for (const handle of this.handles) handle.update(delta, this.camera, this.renderer);
	}

	// ===================== 指针 / 射线 =====================

	private _setNdcFromEvent(e: PointerEvent): void {
		const rect = this.domElement.getBoundingClientRect();
		this._ndc.set(
			((e.clientX - rect.left) / rect.width) * 2 - 1,
			-(((e.clientY - rect.top) / rect.height) * 2 - 1),
		);
	}

	/** 射线命中 -> 操控件 + 命中点。 */
	private _pick(): { handle: PivotHandle; point: THREE.Vector3 } | null {
		this._raycaster.setFromCamera(this._ndc, this.camera);
		const hits = this._raycaster.intersectObjects(this.pickables, false);
		if (!hits.length) return null;
		const obj = hits[0];
		const handle = obj.object.userData.pivotHandle as PivotHandle | undefined;
		if (!handle) return null;
		return { handle, point: obj.point };
	}

	private _setHovered(handle: PivotHandle | null): void {
		if (handle === this._hoveredHandle) return;
		this._hoveredHandle?.setHover(false);
		this._hoveredHandle = handle;
		handle?.setHover(true);
	}

	private readonly _onPointerDown = (e: PointerEvent): void => {
		if (!this._enabled || !this._visible) return;
		this._setNdcFromEvent(e);
		const pick = this._pick();
		if (!pick) return;

		e.preventDefault();
		e.stopPropagation();

		this._activeHandle = pick.handle;
		this._pointerId = e.pointerId;
		try {
			this.domElement.setPointerCapture(e.pointerId);
		} catch {
			/* 某些环境不支持 pointer capture，忽略 */
		}

		// 临时禁用相机控制器，抑制轨道拖拽
		const controls = this.controls;
		if (controls && 'enabled' in controls) {
			this._controlsWasEnabled = controls.enabled !== false;
			controls.enabled = false;
		}

		this._raycaster.setFromCamera(this._ndc, this.camera);
		pick.handle.onPointerDown({
			point: pick.point,
			ray: this._raycaster.ray,
			shiftKey: e.shiftKey,
		});
	};

	private readonly _onPointerMove = (e: PointerEvent): void => {
		if (!this._enabled || !this._visible) return;
		this._setNdcFromEvent(e);
		this._raycaster.setFromCamera(this._ndc, this.camera);

		if (this._activeHandle) {
			this._activeHandle.onPointerMove({ point: this._tmpVec.set(0, 0, 0), ray: this._raycaster.ray, shiftKey: e.shiftKey });
		} else {
			const pick = this._pick();
			this._setHovered(pick ? pick.handle : null);
		}
	};

	private readonly _onPointerUp = (e: PointerEvent): void => {
		const handle = this._activeHandle;
		if (!handle) return;
		handle.onPointerUp();

		if (this._pointerId !== null) {
			try {
				this.domElement.releasePointerCapture(this._pointerId);
			} catch {
				/* ignore */
			}
			this._pointerId = null;
		}

		const controls = this.controls;
		if (controls && 'enabled' in controls && this._controlsWasEnabled) {
			controls.enabled = true;
		}
		this._activeHandle = null;
	};

	// ===================== 开关 / 清理 =====================

	/** 启用 / 禁用交互。 */
	setEnabled(enabled: boolean): this {
		this._enabled = enabled;
		return this;
	}

	/** 显示 / 隐藏 gizmo。 */
	setVisible(visible: boolean): this {
		this._visible = visible;
		this.gizmoGroup.visible = visible;
		return this;
	}

	dispose(): void {
		this.domElement.removeEventListener('pointerdown', this._onPointerDown, true);
		this.domElement.removeEventListener('pointermove', this._onPointerMove);
		this.domElement.removeEventListener('pointerup', this._onPointerUp);
		this.domElement.removeEventListener('pointercancel', this._onPointerUp);

		for (const handle of this.handles) {
			this.gizmoGroup.remove(handle);
			handle.dispose();
		}
		this.handles.length = 0;
		this.pickables.length = 0;
		this.lineMaterials.length = 0;
		this._activeHandle = null;
		this._hoveredHandle = null;
	}
}
