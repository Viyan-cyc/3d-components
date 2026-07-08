import * as THREE from 'three';
import type { ComponentOptions, IDisposable } from '../types';

/**
 * Options for constructing a {@link Sky}.
 *
 * @example
 * ```ts
 * const opts: SkyOptions = {
 *   size: 500,
 *   topColor: 0x109df4,
 *   bottomColor: 0xf5f5f5,
 *   offset: 0,
 *   exponent: 0.6,
 * };
 * ```
 */
export interface SkyOptions extends ComponentOptions {
  /**
   * 天空球半径（世界单位）。
   * 应足够大以包围整个场景，但不要超出相机远裁剪面。 @default 1000
   */
  size?: number;

  /**
   * 天顶颜色（球体最高处的颜色）。
   * 接受 hex、CSS 字符串或 `THREE.Color`。 @default 0x109df4 (天蓝)
   */
  topColor?: THREE.ColorRepresentation;

  /**
   * 地平线 / 底部颜色。
   * 接受 hex、CSS 字符串或 `THREE.Color`。 @default 0xf5f5f5 (浅灰白)
   */
  bottomColor?: THREE.ColorRepresentation;

  /**
   * 世界坐标偏移量，用于调整渐变中心高度。
   * 增大该值使渐变整体上移，地平线附近颜色更偏 bottomColor。 @default 0
   */
  offset?: number;

  /**
   * 渐变指数，控制从地平线到天顶的颜色过渡曲线。
   * 值越大过渡越陡峭（天顶色区域更集中），值越小过渡越平缓。 @default 0.6
   */
  exponent?: number;
}

// ===================== shaders =====================
// 原理：使用一个内翻（BackSide）的球体，顶点着色器计算世界坐标，
// 片元着色器根据归一化后的 Y 分量做幂次渐变，从 bottomColor 过渡到 topColor。

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 bottomColor;
  uniform float offset;
  uniform float exponent;

  varying vec3 vWorldPosition;

  void main() {
    float h = normalize(vWorldPosition + offset).y;
    gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
  }
`;

/**
 * Sky —— 天空穹顶组件。
 *
 * 基于内翻球体（`BackSide`）+ 着色器实现的**天空穹顶**，通过从地平线到天顶的
 * 幂次渐变模拟天空大气效果。球体始终从内部可见，相机应位于球体内部。
 *
 * **特性:**
 * - 继承 `THREE.Mesh`，可直接加入任意 Three.js 场景
 * - 使用 `THREE.BackSide` 渲染，球体从内部可见
 * - 天顶 / 地平线颜色可独立配置，支持运行时动态切换
 * - 渐变指数与偏移量可调，灵活控制渐变曲线
 * - 实现 {@link IDisposable} —— `dispose()` 释放 geometry / material
 *
 * **注意:** 球体半径应大于场景范围但小于相机远裁剪面，否则天空可能被裁剪。
 * 建议将相机远裁剪面设为略大于天空球半径。
 *
 * @example
 * ```ts
 * import { Sky } from '@cyc/3d-components/core';
 *
 * // 天空穹顶
 * const sky = new Sky({
 *   size: 500,
 *   topColor: 0x109df4,
 *   bottomColor: 0xf5f5f5,
 *   offset: 0,
 *   exponent: 0.6,
 * });
 * scene.add(sky);
 *
 * // 运行时调整颜色
 * sky.setTopColor(0x1a8af4).setBottomColor(0xe0e0e0);
 * ```
 *
 * @extends THREE.Mesh
 *
 * Implements {@link IDisposable}.
 */
export class Sky extends THREE.Mesh implements IDisposable {
  /**
   * @param options - 配置对象，所有属性均为可选。
   */
  constructor(options: SkyOptions = {}) {
    const {
      size = 1000,
      topColor = 0x109df4,
      bottomColor = 0xf5f5f5,
      offset = 0,
      exponent = 0.6,
    } = options;

    const geometry = new THREE.SphereGeometry(size, 32, 15);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(topColor) },
        bottomColor: { value: new THREE.Color(bottomColor) },
        offset: { value: offset },
        exponent: { value: exponent },
      },
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
    });

    super(geometry, material);

    if (options.name) this.name = options.name;
    if (options.visible !== undefined) this.visible = options.visible;
    if (options.userData) this.userData = { ...options.userData };
  }

  /** 强类型访问内部 ShaderMaterial。 */
  private get mat(): THREE.ShaderMaterial {
    return this.material as THREE.ShaderMaterial;
  }

  /**
   * 设置天顶颜色渐变。
   * @param top - 天顶颜色。
   * @param bottom - 地平线 / 底部颜色。
   * @returns this，支持链式调用。
   */
  setColors(top: THREE.ColorRepresentation, bottom: THREE.ColorRepresentation): this {
    (this.mat.uniforms.topColor.value as THREE.Color).set(top);
    (this.mat.uniforms.bottomColor.value as THREE.Color).set(bottom);
    return this;
  }

  /**
   * 设置天顶颜色。
   * @param color - 新颜色。接受 hex、CSS 字符串或 `THREE.Color`。
   * @returns this，支持链式调用。
   */
  setTopColor(color: THREE.ColorRepresentation): this {
    (this.mat.uniforms.topColor.value as THREE.Color).set(color);
    return this;
  }

  /**
   * 设置地平线 / 底部颜色。
   * @param color - 新颜色。接受 hex、CSS 字符串或 `THREE.Color`。
   * @returns this，支持链式调用。
   */
  setBottomColor(color: THREE.ColorRepresentation): this {
    (this.mat.uniforms.bottomColor.value as THREE.Color).set(color);
    return this;
  }

  /**
   * 设置世界坐标偏移量。
   * 增大该值使渐变整体上移，地平线附近颜色更偏 bottomColor。
   * @param value - 偏移量。
   * @returns this，支持链式调用。
   */
  setOffset(value: number): this {
    this.mat.uniforms.offset.value = value;
    return this;
  }

  /**
   * 设置渐变指数。
   * 值越大过渡越陡峭（天顶色区域更集中），值越小过渡越平缓。
   * @param value - 指数值。
   * @returns this，支持链式调用。
   */
  setExponent(value: number): this {
    this.mat.uniforms.exponent.value = value;
    return this;
  }

  /**
   * 释放天空穹顶占用的 GPU 资源（geometry 与 material）。
   */
  dispose(): void {
    this.geometry?.dispose();
    this.mat.dispose();
  }
}
