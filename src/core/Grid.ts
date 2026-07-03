import * as THREE from 'three';
import gsap from 'gsap';
import type { ComponentOptions, IDisposable } from '../types';

/** 网格所在平面。`'xz'` 为水平地面（默认），`'xy'` 为面向 +Z 的立面（如 2D 坐标墙）。 */
export type GridPlane = 'xz' | 'xy';

/**
 * Options for constructing a {@link Grid}.
 *
 * @example
 * ```ts
 * const opts: GridOptions = {
 *   primaryScale: 5,
 *   secondaryScale: 1,
 *   showAxis: true,
 *   plane: 'xz',
 * };
 * ```
 */
export interface GridOptions extends ComponentOptions {
  /**
   * 主网格（粗线）间距缩放，单位与世界单位一致。
   * 每隔该距离绘制一条粗线。 @default 5
   */
  primaryScale?: number;

  /**
   * 次级网格（细线）间距缩放。
   * 叠加在主网格之上，形成逐级细分的效果。 @default 1
   */
  secondaryScale?: number;

  /**
   * 是否显示坐标轴高亮（X 轴 + Z/Y 轴）。
   * 轴线颜色由 {@link GridOptions.xAxisColor} / {@link GridOptions.zAxisColor} 决定，
   * 粗细固定（约 1px 抗锯齿线）。关闭后仅显示普通网格。 @default true
   */
  showAxis?: boolean;

  /**
   * 主网格淡出系数，乘到主网格线条 alpha 上。 @default 0.7
   */
  primaryFade?: number;

  /**
   * 次级网格淡出系数，乘到次级网格线条 alpha 上。 @default 0.4
   */
  secondaryFade?: number;

  /**
   * 是否启用基于相机距离的线性淡出（远处网格逐渐消失）。
   * 通过编译宏 `USE_LINEARFADE` 控制，运行时切换会重新编译着色器。 @default true
   */
  linearFade?: boolean;

  /**
   * 线性淡出起始距离（世界单位）。小于该距离不淡出。 @default 30
   */
  fadeStart?: number;

  /**
   * 线性淡出结束距离（世界单位）。大于该距离完全透明。 @default 100
   */
  fadeEnd?: number;

  /**
   * 网格平面。
   * - `'xz'`：水平地面（世界 Y=0 平面），适合作为场景地面参考网
   * - `'xy'`：面向 +Z 的立面（世界 Z=0 平面），适合作为 2D 坐标墙
   * @default 'xz'
   */
  plane?: GridPlane;

  /**
   * 网格线颜色（直接决定最终线色，颜色越深线越暗）。
   * 接受 hex、CSS 字符串或 `THREE.Color`。 @default 0x333333 (深灰)
   */
  color?: THREE.ColorRepresentation;

  /**
   * X 轴高亮颜色。 @default 0xff0000 (红)
   */
  xAxisColor?: THREE.ColorRepresentation;

  /**
   * Z 轴（地面模式 XZ）/ Y 轴（立面模式 XY）高亮颜色。 @default 0x0000ff (蓝)
   */
  zAxisColor?: THREE.ColorRepresentation;
}

// ===================== shaders（移植自 t3d.js InfiniteGridShader）=====================
// 原理：用一个覆盖整屏的四边形（裁剪空间 [-1,1]），在顶点着色器把四边形四个角
// 反投影到世界空间的近裁剪面 / 远裁剪面，得到穿过相机的世界射线；片元着色器在射线上
// 求与网格平面（y=0 或 z=0）的交点，再用 fwidth 抗锯齿绘制无限网格。

const vertexShader = /* glsl */ `
  // P(V*M) 的逆矩阵，由 CPU 端在 onBeforeRender 中按当前相机计算后传入。
  uniform mat4 u_PvmInverse;

  varying vec3 vNearPoint;
  varying vec3 vFarPoint;

  // 将裁剪空间点反投影到世界空间（near=-1 / far=1）。
  vec3 unprojectPoint(float x, float y, float z) {
    vec4 p = u_PvmInverse * vec4(x, y, z, 1.0);
    return p.xyz / p.w;
  }

  void main() {
    vNearPoint = unprojectPoint(position.x, position.y, -1.0);
    vFarPoint = unprojectPoint(position.x, position.y, 1.0);

    // 四边形顶点本身就是裁剪空间坐标，直接输出。
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  // 注意：Three.js 的 ShaderMaterial 片元着色器前缀只声明了 viewMatrix / cameraPosition，
  // 不会自动注入 projectionMatrix / modelMatrix（这两个仅在顶点着色器中声明）。
  // 因此网格矩阵必须自行声明并在 CPU 端（onBeforeRender）按当前相机更新。
  uniform mat4 u_ProjectionViewModel; // P·V·M
  uniform mat4 u_ViewModel;           // V·M

  uniform vec3 u_GridColor;   // 网格线颜色
  uniform vec3 u_XAxisColor;  // X 轴颜色
  uniform vec3 u_ZAxisColor;  // Z 轴（地面）/ Y 轴（立面）颜色
  uniform bool u_ShowAxis;    // 是否显示坐标轴高亮

  uniform float flipProgress;
  uniform float primaryScale;
  uniform float secondaryScale;
  uniform float primaryFade;
  uniform float secondaryFade;
  uniform float start;
  uniform float end;

  varying vec3 vNearPoint;
  varying vec3 vFarPoint;

  vec4 grid(vec3 fragPos3D, float scale, float alpha) {
    // flipProgress: 0 => 使用 XZ 平面坐标, 1 => 使用 XY 平面坐标
    vec2 coord = mix(fragPos3D.xz, fragPos3D.xy, flipProgress) / scale;
    vec2 derivative = fwidth(coord);
    vec2 gridLine = abs(fract(coord - 0.5) - 0.5) / derivative;
    float line = min(gridLine.x, gridLine.y);
    float minimumz = min(derivative.y, 1.0);
    float minimumx = min(derivative.x, 1.0);

    // 基础网格线：直接用网格颜色（颜色越深线越暗）。
    float lineAlpha = 1.0 - min(line, 1.0);
    vec3 col = u_GridColor;

    // 坐标轴高亮（u_ShowAxis 关闭时跳过）。轴线宽度固定（约 1px 抗锯齿线），
    // 颜色由 u_XAxisColor / u_ZAxisColor 决定。
    if (u_ShowAxis) {
      // Z 轴（XZ 模式）/ Y 轴（XY 模式）：沿 X 方向的那条轴
      if (fragPos3D.x >= -minimumx && fragPos3D.x <= minimumx) {
        col = u_ZAxisColor;
      }
      // X 轴；与上一条轴相交处以 X 轴颜色为准
      float xy = mix(fragPos3D.z, fragPos3D.y, flipProgress);
      if (xy >= -minimumz && xy <= minimumz) {
        col = u_XAxisColor;
      }
    }

    return vec4(col, lineAlpha * alpha);
  }

  // 由世界坐标换算写入深度缓冲，使网格能被场景中的物体正确遮挡。
  float computeDepth(vec3 pos) {
    vec4 clip = u_ProjectionViewModel * vec4(pos, 1.0);
    return (clip.z / clip.w) * 0.5 + 0.5;
  }

  float computeLinearDepth(vec3 pos) {
    vec4 viewPos = u_ViewModel * vec4(pos, 1.0);
    float viewDepth = abs(viewPos.z) / viewPos.w;
    return max(0.0, viewDepth - start) / (end - start);
  }

  void main() {
    float ty = -vNearPoint.y / (vFarPoint.y - vNearPoint.y);
    float tz = -vNearPoint.z / (vFarPoint.z - vNearPoint.z);
    float t = mix(ty, tz, flipProgress);
    vec3 fragPos3D = vNearPoint + t * (vFarPoint - vNearPoint);

    gl_FragDepth = computeDepth(fragPos3D);

    // 主、次两层网格叠加；交点在相机后方（t <= 0）时丢弃，避免在视野上方画出网格。
    gl_FragColor = (grid(fragPos3D, primaryScale, primaryFade) + grid(fragPos3D, secondaryScale, secondaryFade)) * float(t > 0.0);

    #ifdef USE_LINEARFADE
      float linearDepth = computeLinearDepth(fragPos3D);
      gl_FragColor.a *= max(0.0, 1.0 - linearDepth);
    #endif
  }
`;

/** 临时矩阵，避免每帧分配。 */
const _pvm = new THREE.Matrix4();
const _vm = new THREE.Matrix4();

/**
 * Grid —— 无限参考网格组件。
 *
 * 基于屏幕空间四边形 + 着色器实现的**无限网格**（移植自 t3d.js 的 `InfiniteGridShader`）。
 * 通过把整屏四边形反投影成世界射线，再与网格平面求交，在着色器中绘制**无边界**的网格，
 * 因此无论相机如何移动 / 拉远，网格始终铺满屏幕、永远画不到头。
 *
 * **特性:**
 * - 继承 `THREE.Mesh`，可直接加入任意 Three.js 场景
 * - 写入 `gl_FragDepth`，网格能被场景中的物体正确遮挡（与地面交互自然）
 * - 主 / 次双层网格（粗线 + 细线），可独立配置间距与不透明度
 * - 网格线、X 轴、Z/Y 轴颜色均可自定义（默认 X 轴红、Z/Y 轴蓝），坐标轴可用 `showAxis` 开关
 * - 可选基于相机距离的**线性淡出**，远处网格自然消失
 * - 支持水平地面（XZ）与垂直立面（XY）两种平面，可 GSAP 平滑切换
 * - 实现 {@link IDisposable} —— `dispose()` 释放 geometry / material
 *
 * **注意:** 反投影矩阵依赖相机，组件在 `onBeforeRender` 中按当前渲染相机自动更新，
 * 无需手动调用任何更新方法。
 *
 * @example
 * ```ts
 * import { Grid } from '@cyc/3d-components/core';
 *
 * // 作为无限地面参考网
 * const grid = new Grid({ primaryScale: 5, secondaryScale: 1 });
 * scene.add(grid);
 *
 * // 运行时调整样式
 * grid.setShowAxis(false).setLinearFade(true).setFade(20, 80);
 *
 * // 平滑切换到 2D 立面网格
 * grid.setPlane('xy');
 * ```
 *
 * @extends THREE.Mesh
 *
 * Implements {@link IDisposable}.
 */
export class Grid extends THREE.Mesh implements IDisposable {
  private _plane: GridPlane;

  /**
   * @param options - 配置对象，所有属性均为可选。
   */
  constructor(options: GridOptions = {}) {
    const {
      primaryScale = 5,
      secondaryScale = 1,
      showAxis = true,
      primaryFade = 0.7,
      secondaryFade = 0.4,
      fadeStart = 30,
      fadeEnd = 100,
      linearFade = true,
      plane = 'xz',
      color = 0x333333,
      xAxisColor = 0xff0000,
      zAxisColor = 0x0000ff,
    } = options;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        u_PvmInverse: { value: new THREE.Matrix4() },
        u_ProjectionViewModel: { value: new THREE.Matrix4() },
        u_ViewModel: { value: new THREE.Matrix4() },
        u_GridColor: { value: new THREE.Color(color) },
        u_XAxisColor: { value: new THREE.Color(xAxisColor) },
        u_ZAxisColor: { value: new THREE.Color(zAxisColor) },
        u_ShowAxis: { value: showAxis },
        flipProgress: { value: plane === 'xy' ? 1 : 0 },
        primaryScale: { value: primaryScale },
        secondaryScale: { value: secondaryScale },
        primaryFade: { value: primaryFade },
        secondaryFade: { value: secondaryFade },
        start: { value: fadeStart },
        end: { value: fadeEnd },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      defines: linearFade ? { USE_LINEARFADE: '' } : {},
    });

    // 覆盖整屏的四边形（裁剪空间 [-1,1]）。
    const geometry = new THREE.PlaneGeometry(2, 2);

    super(geometry, material);

    this._plane = plane;
    this.frustumCulled = false; // 始终全屏，避免被视锥剔除

    if (options.name) this.name = options.name;
    if (options.visible !== undefined) this.visible = options.visible;
    if (options.userData) this.userData = { ...options.userData };
  }

  /** 强类型访问内部 ShaderMaterial。 */
  private get mat(): THREE.ShaderMaterial {
    return this.material as THREE.ShaderMaterial;
  }

  /**
   * 渲染前由 Three.js 自动调用，按当前相机刷新反投影矩阵。
   *
   * 无需手动调用。如果你想用自定义渲染流程，可在渲染该网格前设置
   * `mat.uniforms.u_PvmInverse.value` 为 `inverse(P * V * M)`。
   */
  onBeforeRender(_renderer: THREE.WebGLRenderer, _scene: THREE.Scene, camera: THREE.Camera): void {
    const u = this.mat.uniforms;
    const P = camera.projectionMatrix;
    const V = camera.matrixWorldInverse;
    const M = this.matrixWorld;

    // P·V·M —— 供片元着色器换算深度；其逆供顶点着色器反投影。
    _pvm.copy(P).multiply(V).multiply(M);
    (u.u_ProjectionViewModel.value as THREE.Matrix4).copy(_pvm);
    (u.u_PvmInverse.value as THREE.Matrix4).copy(_pvm).invert();

    // V·M —— 供片元着色器换算线性深度。
    _vm.copy(V).multiply(M);
    (u.u_ViewModel.value as THREE.Matrix4).copy(_vm);
  }

  /** 当前网格平面（`'xz'` 或 `'xy'`）。 */
  get plane(): GridPlane {
    return this._plane;
  }

  /**
   * 设置网格平面。
   * - `'xz'`：水平地面（flipProgress = 0）
   * - `'xy'`：垂直立面（flipProgress = 1）
   *
   * @param plane - 目标平面。
   * @param animate - 是否用 GSAP 平滑过渡（约 0.6s 缓动）。 @default true
   * @returns this，支持链式调用。
   */
  setPlane(plane: GridPlane, animate = true): this {
    this._plane = plane;
    const target = plane === 'xy' ? 1 : 0;
    const u = this.mat.uniforms.flipProgress;
    if (animate) {
      gsap.killTweensOf(u);
      gsap.to(u, { value: target, duration: 0.6, ease: 'power2.inOut' });
    } else {
      gsap.killTweensOf(u);
      u.value = target;
    }
    return this;
  }

  /**
   * 设置主网格（粗线）间距缩放。
   * @param scale - 间距（世界单位）。
   * @returns this，支持链式调用。
   */
  setPrimaryScale(scale: number): this {
    this.mat.uniforms.primaryScale.value = scale;
    return this;
  }

  /**
   * 设置次级网格（细线）间距缩放。
   * @param scale - 间距（世界单位）。
   * @returns this，支持链式调用。
   */
  setSecondaryScale(scale: number): this {
    this.mat.uniforms.secondaryScale.value = scale;
    return this;
  }

  /**
   * 设置是否显示坐标轴高亮（X 轴 + Z/Y 轴）。
   * @param show - `true` 显示轴线，`false` 仅显示普通网格。
   * @returns this，支持链式调用。
   */
  setShowAxis(show: boolean): this {
    this.mat.uniforms.u_ShowAxis.value = show;
    return this;
  }

  /**
   * 设置网格线颜色。接受 hex、CSS 字符串或 `THREE.Color` 实例。
   * @param color - 新颜色。
   * @returns this，支持链式调用。
   */
  setColor(color: THREE.ColorRepresentation): this {
    (this.mat.uniforms.u_GridColor.value as THREE.Color).set(color);
    return this;
  }

  /**
   * 设置 X 轴高亮颜色。
   * @param color - 新颜色。
   * @returns this，支持链式调用。
   */
  setXAxisColor(color: THREE.ColorRepresentation): this {
    (this.mat.uniforms.u_XAxisColor.value as THREE.Color).set(color);
    return this;
  }

  /**
   * 设置 Z 轴（地面模式）/ Y 轴（立面模式）高亮颜色。
   * @param color - 新颜色。
   * @returns this，支持链式调用。
   */
  setZAxisColor(color: THREE.ColorRepresentation): this {
    (this.mat.uniforms.u_ZAxisColor.value as THREE.Color).set(color);
    return this;
  }

  /**
   * 设置线性淡出的起止距离。
   * @param start - 起始距离（不淡出）。
   * @param end - 结束距离（完全透明）。
   * @returns this，支持链式调用。
   */
  setFade(start: number, end: number): this {
    this.mat.uniforms.start.value = start;
    this.mat.uniforms.end.value = end;
    return this;
  }

  /**
   * 开启 / 关闭基于相机距离的线性淡出。
   *
   * 通过编译宏 `USE_LINEARFADE` 控制，切换时会重新编译着色器（一次性开销）。
   *
   * @param enabled - 是否启用。
   * @returns this，支持链式调用。
   */
  setLinearFade(enabled: boolean): this {
    if (enabled) {
      this.mat.defines.USE_LINEARFADE = '';
    } else {
      delete this.mat.defines.USE_LINEARFADE;
    }
    this.mat.needsUpdate = true;
    return this;
  }

  /**
   * 释放网格占用的 GPU 资源（geometry 与 material），并终止进行中的 GSAP 补间。
   */
  dispose(): void {
    gsap.killTweensOf(this.mat.uniforms.flipProgress);
    this.geometry?.dispose();
    this.mat.dispose();
  }
}
