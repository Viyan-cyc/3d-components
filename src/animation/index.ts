/**
 * @packageDocumentation
 *
 * 动画模块 — 基于 GSAP 封装的通用动画库
 *
 * 提供 Three.js 对象的动画控制能力，完全隐藏 GSAP 的内部概念。
 * 用户无需了解 Timeline、tween、GSAP 缓动字符串等，只需通过直观的 API 完成动画编排与控制。
 *
 * ## 核心特性
 * - **直观 API**：`animate()` + 链式 `.to()` / `.parallel()` + 命令式 `.play()` / `.pause()` 等
 * - **GSAP 完全隐藏**：用户代码中不会出现任何 GSAP 导入或 API 调用
 * - **属性支持**：Three.js 标准变换 + 材质属性 + 任意点路径
 * - **编排能力**：串行、并行、混合嵌套
 * - **缓动系统**：20+ 内置预设 + 自定义函数 + 全局注册
 * - **完整控制**：play / pause / resume / stop / restart / seek / getProgress / getState / destroy
 *
 * ## 快速开始
 * ```ts
 * import { animate } from '@cyc/3d-components/animation';
 *
 * // 简单动画
 * animate(mesh, { to: { position: { x: 2 } }, duration: 1 }).play();
 *
 * // 链式串行
 * animate(mesh)
 *   .to({ position: { x: 2 } }, { duration: 0.5 })
 *   .to({ scale: { x: 2 } }, { duration: 0.3 })
 *   .play();
 *
 * // 并行 + 串行混合
 * animate(mesh)
 *   .to({ position: { x: 2 } }, { duration: 0.5 })
 *   .parallel([
 *     (g) => g.to({ rotation: { y: Math.PI } }, { duration: 0.5 }),
 *     (g) => g.to({ 'material.color': '#ff0000' }, { duration: 0.5 }),
 *   ])
 *   .play();
 * ```
 *
 * ## Peer Dependencies
 * 本模块需要项目中安装 `three` 和 `gsap`：
 * ```bash
 * npm install three gsap
 * ```
 */

// 公开 API
export { animate } from './animate';
export { registerEasing } from './easing';
export { setDefaultConfig, getDefaultConfig } from './defaults';

// 公开类型
export type {
  AnimationTarget,
  AnimationState,
  EasingInput,
  Vec3Like,
  PropertyTarget,
  AnimationConfig,
  AnimationDefaults,
  AnimationController,
  AnimationStepBuilder,
} from './types';
