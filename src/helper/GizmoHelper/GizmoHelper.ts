import * as THREE from 'three';
import type { IUpdatable, IDisposable } from '../../types';

/**
 * Gizmo 在屏幕上的对齐位置（九宫格）。
 *
 * - `*-left` / `*-right` / `*-center` 控制水平方向
 * - `top-*` / `bottom-*` / `center-*` 控制垂直方向
 */
export type GizmoAlignment =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center'
  | 'center-left'
  | 'center-right'
  | 'center-center';

/**
 * GizmoHelper 接受的相机控制器结构类型。
 *
 * 兼容 Three.js 内置 `OrbitControls`（具备 `target` / `update` / `enabled`），
 * 也兼容任意遵循该形状的自定义控制器。所有字段均为可选。
 */
export interface GizmoControlsLike {
  /** 轨道中心点 —— gizmo 围绕该点旋转相机。 */
  target?: THREE.Vector3;
  /** 每个动画步调用，用于把控制器同步到新的相机位姿。 */
  update?(delta?: number): void;
  /** 为 false 时控制器忽略输入（gizmo 点击时临时禁用以抑制轨道拖拽）。 */
  enabled?: boolean;
}

/**
 * 可作为 GizmoHelper 内容的 3D 对象（如 {@link GizmoViewport}）。
 *
 * `pickables` 暴露出可被点击拾取的子对象，每个对象的
 * `userData.onPick` 回调会在被点击时触发（通常调用 `gizmo.tweenCamera`）。
 *
 * 可选实现 `update(delta)`：GizmoHelper 每帧镜像完相机朝向后调用它，
 * 内容可据此做逐帧效果（如按深度切换亮 / 暗色）。
 * 悬停的对象会被打上 `userData.gizmoHover = true` 标记（见 hover）。
 */
export interface GizmoContent extends THREE.Object3D {
  /** 可被射线拾取的子对象列表（轴头 / 立方体面等）。 */
  readonly pickables?: THREE.Object3D[];
  /** 可选逐帧回调（GizmoHelper.update 中、镜像相机朝向后调用）。 */
  update?(delta: number): void;
}

/**
 * Options for constructing a {@link GizmoHelper}.
 *
 * @example
 * ```ts
 * const opts: GizmoHelperOptions = {
 *   camera,
 *   renderer,
 *   controls: orbitControls,
 *   alignment: 'bottom-right',
 *   margin: [16, 16],
 *   size: 120,
 * };
 * ```
 */
export interface GizmoHelperOptions {
  /** 主场景相机：gizmo 镜像其朝向，点击轴时围绕目标点旋转它。 */
  camera: THREE.Camera;

  /** 用于绘制 gizmo 叠层的 WebGLRenderer。 */
  renderer: THREE.WebGLRenderer;

  /** 相机控制器（OrbitControls 等）。可选；省略时围绕原点旋转。 */
  controls?: GizmoControlsLike;

  /** gizmo 内容（{@link GizmoViewport} 等）。可在构造后用 {@link GizmoHelper.setContent} 设置。 */
  content?: GizmoContent;

  /** 屏幕九宫格对齐位置。 @default 'bottom-right' */
  alignment?: GizmoAlignment;

  /** 相对屏幕边缘的留白 `[水平, 垂直]`（CSS 像素）。 @default [16, 16] */
  margin?: [number, number];

  /** gizmo 叠层的方形边长（CSS 像素）。 @default 120 */
  size?: number;

  /** 是否整体禁用（不渲染、不响应点击、不做相机同步）。 @default false */
  disabled?: boolean;

  /** 自定义轨道目标点提供函数，优先级高于 `controls.target`。 */
  onTarget?: () => THREE.Vector3;

  /** 每个动画步的回调，替代 `controls.update`（二选一）。 */
  onUpdate?: () => void;
}

// ===================== internals =====================
// 旋转速率：弧度 / 秒（与 drei 一致，2π 即每秒一圈）。
const TURN_RATE = 2 * Math.PI;

/**
 * GizmoHelper —— 视口导航 Gizmo（Viewport Gizmo）容器。
 *
 * 参考 [drei GizmoHelper](https://github.com/pmndrs/drei/blob/master/src/core/GizmoHelper.tsx)
 * 的原生 Three.js 实现。在屏幕角落绘制一个独立的小视口，用一个正交相机渲染
 * 一个 gizmo（默认 {@link GizmoViewport} 三轴指示器）。该 gizmo 实时镜像主相机朝向，
 * 点击其上的轴头即可把主相机平滑旋转到对应的标准视角。
 *
 * **特性：**
 * - 自带独立虚拟场景 + 正交相机，通过 `scissor` / `viewport` 叠层绘制，不污染主场景。
 * - 每帧把内容根节点的四元数设为主相机世界矩阵的逆 —— gizmo 始终与主相机朝向同步。
 * - {@link GizmoHelper.tweenCamera} 用 `rotateTowards` 平滑动画相机到目标视角。
 * - 自带射线拾取：点击 gizmo 上的可拾取对象（如轴头）触发 `userData.onPick`。
 *
 * **注意 —— 渲染顺序：**
 * `renderOverlay()` 会把 gizmo 画到主画面之上，因此**必须在每帧主场景
 * `renderer.render(scene, camera)` 之后**调用。`update(delta)` 则负责同步与动画，
 * 可在主渲染之前或之后调用。
 *
 * **不加入主场景：** GizmoHelper 管理自己的虚拟场景，因此**不要** `scene.add(gizmo)`。
 * 只需创建它，并在渲染循环中调用 `update(delta)` 与 `renderOverlay()`。
 *
 * @example
 * ```ts
 * import { GizmoHelper, GizmoViewport } from '@cyc/3d-components/helper';
 *
 * const gizmo = new GizmoHelper({
 *   camera,
 *   renderer,
 *   controls: orbitControls,
 *   alignment: 'bottom-right',
 * });
 * gizmo.setContent(new GizmoViewport({
 *   onPick: (dir) => gizmo.tweenCamera(dir),
 * }));
 *
 * // 渲染循环（注意顺序）：
 * function frame() {
 *   const dt = clock.getDelta();
 *   controls.update();
 *   gizmo.update(dt);          // 同步 gizmo 朝向 + 动画相机
 *   renderer.render(scene, camera);
 *   gizmo.renderOverlay();     // 必须在主渲染之后
 *   requestAnimationFrame(frame);
 * }
 * ```
 *
 * Implements {@link IUpdatable} and {@link IDisposable}.
 */
export class GizmoHelper implements IUpdatable, IDisposable {
  /** 主场景相机。 */
  readonly camera: THREE.Camera;
  /** 用于绘制叠层的渲染器。 */
  readonly renderer: THREE.WebGLRenderer;
  /** 相机控制器（可能为空）。 */
  readonly controls?: GizmoControlsLike;

  private _alignment: GizmoAlignment;
  private _margin: [number, number];
  private _size: number;
  private _disabled: boolean;
  private readonly _onTarget?: () => THREE.Vector3;
  private readonly _onUpdate?: () => void;

  /** 独立虚拟场景，gizmo 内容渲染于此。 */
  readonly virtualScene: THREE.Scene;
  /** 正交相机，固定从 +Z 俯视原点。 */
  readonly virtualCamera: THREE.OrthographicCamera;

  private _content: GizmoContent | null = null;

  // ---- 动画状态（tweenCamera）----
  private _animating = false;
  private _radius = 1;
  private readonly _focusPoint = new THREE.Vector3();
  private readonly _defaultUp = new THREE.Vector3(0, 1, 0);

  // ---- 复用的临时对象（避免每帧分配）----
  private readonly _q1 = new THREE.Quaternion();
  private readonly _q2 = new THREE.Quaternion();
  private readonly _dummy = new THREE.Object3D();
  private readonly _target = new THREE.Vector3();
  private readonly _matrix = new THREE.Matrix4();
  private readonly _raycaster = new THREE.Raycaster();
  private readonly _ndc = new THREE.Vector2();
  private readonly _prevViewport = new THREE.Vector4();
  /** 当前悬停的可拾取对象（其 userData.gizmoHover = true）。 */
  private _hovered: THREE.Object3D | null = null;

  /**
   * @param options - 配置对象。`camera` 与 `renderer` 必填，其余可选。
   */
  constructor(options: GizmoHelperOptions) {
    this.camera = options.camera;
    this.renderer = options.renderer;
    this.controls = options.controls;
    this._onTarget = options.onTarget;
    this._onUpdate = options.onUpdate;

    this._alignment = options.alignment ?? 'bottom-right';
    this._margin = options.margin ?? [16, 16];
    this._size = options.size ?? 120;
    this._disabled = options.disabled ?? false;

    // 虚拟场景 + 正交相机（方形视锥，正对方形叠层区域）。
    const d = 1.4; // 半视锥尺寸，刚好框住单位 gizmo
    this.virtualScene = new THREE.Scene();
    this.virtualCamera = new THREE.OrthographicCamera(-d, d, d, -d, 0.1, 1000);
    this.virtualCamera.position.set(0, 0, 10);
    this.virtualCamera.lookAt(0, 0, 0);
    this.virtualCamera.updateProjectionMatrix();

    // 记录相机 up，OrbitControls 动画结束后需还原。
    this._defaultUp.copy(this.camera.up);

    if (options.content) this.setContent(options.content);

    // 拾取监听（捕获阶段，尽早拦截，避免同时触发轨道拖拽）。
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown, true);
    // 悬停高亮（非捕获，不干扰 OrbitControls 的拖拽）。
    this.renderer.domElement.addEventListener('pointermove', this._onPointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this._onPointerLeave);
  }

  /**
   * 设置 gizmo 内容（如 {@link GizmoViewport}）。
   * @param content - 实现了 {@link GizmoContent} 的对象。
   * @returns this，支持链式调用。
   */
  setContent(content: GizmoContent): this {
    if (this._content) this.virtualScene.remove(this._content);
    this._content = content;
    this.virtualScene.add(content);
    return this;
  }

  /** 当前内容（可能为空）。 */
  get content(): GizmoContent | null {
    return this._content;
  }

  /**
   * 设置屏幕对齐位置。
   * @returns this，支持链式调用。
   */
  setAlignment(alignment: GizmoAlignment): this {
    this._alignment = alignment;
    return this;
  }

  /**
   * 设置相对屏幕边缘的留白 `[水平, 垂直]`（CSS 像素）。
   * @returns this，支持链式调用。
   */
  setMargin(margin: [number, number]): this {
    this._margin = margin;
    return this;
  }

  /**
   * 设置 gizmo 叠层方形边长（CSS 像素）。
   * @returns this，支持链式调用。
   */
  setSize(size: number): this {
    this._size = size;
    return this;
  }

  /**
   * 启用 / 禁用整个 gizmo。
   * @returns this，支持链式调用。
   */
  setDisabled(disabled: boolean): this {
    this._disabled = disabled;
    return this;
  }

  /** 是否处于禁用状态。 */
  get disabled(): boolean {
    return this._disabled;
  }

  /**
   * 每帧调用：把 gizmo 朝向同步到主相机，并推进相机动画（若有）。
   *
   * 纯变换逻辑，不做任何绘制 —— 在渲染循环的任意位置调用均可。
   *
   * @param delta - 距上一帧的秒数（建议像其它组件一样封顶 0.1s）。
   */
  update(delta: number): void {
    if (this._disabled || !this._content) return;

    if (this._animating) this._stepAnimation(delta);

    // tween 刚改过相机位姿，先刷新 world 矩阵，确保镜像与当前帧一致。
    this.camera.updateMatrixWorld();

    // 镜像主相机朝向：内容根节点四元数 = 相机世界矩阵的逆。
    this._content.quaternion.setFromRotationMatrix(this._matrix.copy(this.camera.matrixWorld).invert());

    // 内容自带的逐帧逻辑（如 GizmoViewport 的深度着色 / hover 高亮）。
    // 在设置好四元数之后调用，使内容可基于当前朝向计算。
    if (typeof this._content.update === 'function') this._content.update(delta);
  }

  /**
   * 把 gizmo 绘制到屏幕角落的叠层区域。
   *
   * **必须**在每帧主场景 `renderer.render(scene, camera)` **之后**调用，
   * 否则主渲染会清掉 gizmo 画面。
   */
  renderOverlay(): void {
    if (this._disabled || !this._content) return;

    const gl = this.renderer;
    const { x, y, width, height } = this._computeRegion();

    // 注意：three 的 setViewport / setScissor 接收的是 **CSS 像素**，
    // 内部会乘以 pixelRatio 换算到设备像素。因此区域一律用 CSS 像素计算。
    const prevAutoClear = gl.autoClear;
    gl.getViewport(this._prevViewport); // 保存主场景视口，结束后还原
    gl.autoClear = false;
    gl.setScissorTest(true);
    gl.setViewport(x, y, width, height);
    gl.setScissor(x, y, width, height);
    // 仅清深度，使 gizmo 不被主场景深度遮挡；保留主场景颜色作为背景。
    gl.clearDepth();
    gl.render(this.virtualScene, this.virtualCamera);

    gl.setScissorTest(false);
    gl.setViewport(this._prevViewport.x, this._prevViewport.y, this._prevViewport.z, this._prevViewport.w);
    gl.autoClear = prevAutoClear;
  }

  /**
   * 平滑动画主相机，使其从 `direction` 方向看向目标点。
   *
   * 通常由 gizmo 内容的 `onPick` 回调调用（点击轴头 / 立方体面）。
   * 动画在每个 `update(delta)` 中以固定角速率推进，完成后还原 `camera.up`。
   *
   * @param direction - 目标方向（世界空间），如 `(1,0,0)` 表示移动到 +X 侧看向中心。
   * @returns this，支持链式调用。
   */
  tweenCamera(direction: THREE.Vector3): this {
    this._animating = true;

    // 目标点（轨道中心）
    if (this._onTarget) this._focusPoint.copy(this._onTarget());
    else if (this.controls?.target) this._focusPoint.copy(this.controls.target);
    else this._focusPoint.set(0, 0, 0);

    this._radius = this.camera.position.distanceTo(this._focusPoint) || 1;

    // 起点：当前相机朝向
    this._q1.copy(this.camera.quaternion);

    // 终点：朝向 `direction` 视角（朝向与平移无关，故以原点为参考计算即可）
    this._dummy.position.set(0, 0, 0);
    this._dummy.up.copy(this._defaultUp);
    this._target.copy(direction).multiplyScalar(this._radius);
    this._dummy.lookAt(this._target);
    this._q2.copy(this._dummy.quaternion);

    return this;
  }

  /** 推进相机动画一步。 */
  private _stepAnimation(delta: number): void {
    const camera = this.camera;

    if (this._q1.angleTo(this._q2) < 0.01) {
      this._animating = false;
      // OrbitControls 以 up 向量为轨道轴，动画结束后需还原
      camera.up.copy(this._defaultUp);
      return;
    }

    const step = delta * TURN_RATE;
    this._q1.rotateTowards(this._q2, step);

    // 沿单位球插值位置，并同步朝向与 up
    camera.position.set(0, 0, 1).applyQuaternion(this._q1).multiplyScalar(this._radius).add(this._focusPoint);
    camera.up.set(0, 1, 0).applyQuaternion(this._q1).normalize();
    camera.quaternion.copy(this._q1);

    if (this._onUpdate) this._onUpdate();
    else this.controls?.update?.(delta);
  }

  /**
   * 计算当前帧 gizmo 叠层的矩形区域，**单位为 CSS 像素**，原点在左下。
   * （与 three 的 setViewport / setScissor 单位一致。）
   */
  private _computeRegion(): { x: number; y: number; width: number; height: number } {
    const el = this.renderer.domElement;
    // clientWidth/Height 为 CSS 布局尺寸，与 setViewport 使用的坐标系一致。
    const dw = el.clientWidth || el.width;
    const dh = el.clientHeight || el.height;
    const s = this._size;
    const mx = this._margin[0];
    const my = this._margin[1];

    let x: number;
    let y: number;

    if (this._alignment.endsWith('center')) x = (dw - s) / 2;
    else if (this._alignment.endsWith('left')) x = mx;
    else x = dw - mx - s; // *-right

    if (this._alignment.startsWith('center')) y = (dh - s) / 2;
    else if (this._alignment.startsWith('bottom')) y = my;
    else y = dh - my - s; // top-*

    return { x, y, width: s, height: s };
  }

  /** 指针按下：若落在 gizmo 区域并命中可拾取对象，触发其 onPick。 */
  /**
   * 把指针事件映射到 gizmo 正交相机并射线拾取，返回命中的可拾取对象（或 null）。
   * 区域外或未命中返回 null。
   */
  private _pickAt(e: PointerEvent): THREE.Object3D | null {
    if (!this._content) return null;
    const pickables = this._content.pickables;
    if (!pickables || pickables.length === 0) return null;

    const rect = this.renderer.domElement.getBoundingClientRect();
    // 指针 → CSS 像素坐标（y 翻转为 WebGL 左下原点）
    const px = e.clientX - rect.left;
    const py = rect.height - (e.clientY - rect.top);

    const r = this._computeRegion();
    if (px < r.x || px > r.x + r.width || py < r.y || py > r.y + r.height) return null; // 区域外

    this._ndc.set(((px - r.x) / r.width) * 2 - 1, ((py - r.y) / r.height) * 2 - 1);
    this._raycaster.setFromCamera(this._ndc, this.virtualCamera);
    const hits = this._raycaster.intersectObjects(pickables, false);
    return hits.length ? hits[0].object : null;
  }

  /** 设置当前悬停对象（打上 userData.gizmoHover 标记，供内容逐帧高亮）。 */
  private _setHover(obj: THREE.Object3D | null): void {
    if (obj === this._hovered) return;
    if (this._hovered) this._hovered.userData.gizmoHover = false;
    this._hovered = obj;
    if (obj) obj.userData.gizmoHover = true;
  }

  /** 指针是否落在 gizmo 叠层区域内（用于 helper 整体悬停态）。 */
  private _isInRegion(e: PointerEvent): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = rect.height - (e.clientY - rect.top);
    const r = this._computeRegion();
    return px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
  }

  private _onPointerMove = (e: PointerEvent): void => {
    if (this._disabled || !this._content) return;
    const inRegion = this._isInRegion(e);
    // helper 整体悬停态（内容可据此显示底色等）
    this._content.userData.helperHover = inRegion;
    this._setHover(inRegion ? this._pickAt(e) : null);
  };

  private _onPointerLeave = (): void => {
    if (!this._content) return;
    this._content.userData.helperHover = false;
    this._setHover(null);
  };

  private _onPointerDown = (e: PointerEvent): void => {
    if (this._disabled || !this._content) return;
    const hit = this._pickAt(e);
    if (!hit) return;

    const onPick = hit.userData.onPick as (() => void) | undefined;
    if (!onPick) return;

    e.preventDefault();
    e.stopPropagation();

    // 临时禁用控制器，抑制这次手势的轨道拖拽
    const controls = this.controls;
    if (controls && 'enabled' in controls) {
      const wasEnabled = controls.enabled !== false;
      if (wasEnabled) controls.enabled = false;
      const restore = (): void => {
        if (wasEnabled) controls.enabled = true;
        window.removeEventListener('pointerup', restore);
      };
      window.addEventListener('pointerup', restore);
    }

    onPick();
  };

  /**
   * 释放资源：移除监听、释放内容与虚拟场景中的几何体 / 材质 / 纹理。
   */
  dispose(): void {
    this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown, true);
    this.renderer.domElement.removeEventListener('pointermove', this._onPointerMove);
    this.renderer.domElement.removeEventListener('pointerleave', this._onPointerLeave);
    this._animating = false;
    this._hovered = null;

    // 内容自带 dispose 则优先调用；否则遍历释放
    const content = this._content;
    if (content && hasDispose(content)) content.dispose();

    this.virtualScene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => disposeMaterial(m));
      else if (mat) disposeMaterial(mat);
    });
    this.virtualScene.clear();
    this._content = null;
  }
}

/** 释放单个材质及其贴图。 */
function disposeMaterial(mat: THREE.Material): void {
  const anyMat = mat as unknown as { map?: THREE.Texture };
  anyMat.map?.dispose();
  mat.dispose();
}

/** 判定对象是否具备 `dispose()` 方法。 */
function hasDispose(obj: unknown): obj is { dispose: () => void } {
  return typeof (obj as { dispose?: unknown }).dispose === 'function';
}
