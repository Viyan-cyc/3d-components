/**
 * @packageDocumentation
 *
 * 动画模块类型定义
 *
 * 本模块定义了动画库的所有公开接口和类型别名。
 * 不包含任何运行时代码。
 */

import type * as THREE from 'three';

// ─── 基础类型 ───────────────────────────────────────────

/**
 * 动画目标：单个 Object3D 或 Object3D 数组。
 *
 * @example
 * ```ts
 * animate(mesh, { to: { position: { x: 2 } } });
 * animate([mesh1, mesh2], { to: { position: { x: 2 } } });
 * ```
 */
export type AnimationTarget = THREE.Object3D | THREE.Object3D[];

/**
 * 动画播放状态。
 *
 * - `'idle'`      — 已创建但尚未播放
 * - `'playing'`   — 正在播放中
 * - `'paused'`    — 已暂停
 * - `'stopped'`   — 已停止（回到起始位置）
 * - `'completed'` — 播放完成
 * - `'destroyed'` — 已销毁，不可再使用
 */
export type AnimationState = 'idle' | 'playing' | 'paused' | 'stopped' | 'completed' | 'destroyed';

/**
 * 缓动输入类型：友好名称字符串或自定义函数。
 *
 * 内置名称如 `'linear'`、`'easeOut'`、`'easeInOutCubic'` 等；
 * 自定义函数签名为 `(t: number) => number`，其中 t 的范围为 [0, 1]。
 *
 * @example
 * ```ts
 * // 使用内置名称
 * animate(mesh, { to: { position: { x: 2 } }, ease: 'easeOut' });
 *
 * // 使用自定义函数
 * animate(mesh, { to: { position: { x: 2 } }, ease: (t) => t * t });
 * ```
 */
export type EasingInput = string | ((t: number) => number);

// ─── 属性目标 ───────────────────────────────────────────

/**
 * Vec3 部分对象，用于描述 position/rotation/scale 的目标值。
 *
 * 所有字段均为可选——只写需要动画的轴即可。
 */
export interface Vec3Like {
  x?: number;
  y?: number;
  z?: number;
}

/**
 * 属性目标值描述。
 *
 * 支持三种键：
 * 1. Three.js 标准变换属性：`position`、`rotation`、`scale`（值为 {@link Vec3Like}）
 * 2. 材质属性简写：如 `'material.color'`、`'material.opacity'`
 * 3. 任意点路径：如 `'material.uniforms.uProgress.value'`
 *
 * @example
 * ```ts
 * {
 *   position: { x: 2, y: 1 },
 *   'material.color': '#ff0000',
 *   'material.opacity': 0.5,
 *   'material.uniforms.uProgress.value': 1,
 * }
 * ```
 */
export interface PropertyTarget {
  /** 位置目标（局部坐标） */
  position?: Vec3Like;
  /** 旋转目标（欧拉角，弧度制） */
  rotation?: Vec3Like;
  /** 缩放目标 */
  scale?: Vec3Like;
  /** 任意点路径属性，如 'material.color'、'material.opacity' 等 */
  [key: string]: unknown;
}

// ─── 动画配置 ───────────────────────────────────────────

/**
 * 用户可见的动画配置。
 *
 * 所有字段均可选，未设置的字段从全局默认配置继承。
 *
 * @example
 * ```ts
 * animate(mesh, {
 *   to: { position: { x: 2 } },
 *   duration: 1,
 *   ease: 'easeOut',
 *   onComplete: () => console.log('完成'),
 * }).play();
 * ```
 */
export interface AnimationConfig {
  /**
   * 属性目标值。
   * 省略 `from` 时，从当前值动画到 `to` 指定的值。
   */
  to?: PropertyTarget;

  /**
   * 属性起始值。
   * 设置后动画从 `from` 指定的值开始，动画到当前值或 `to` 指定的值。
   */
  from?: PropertyTarget;

  /**
   * 动画时长（秒）。
   * @default 1
   */
  duration?: number;

  /**
   * 延迟启动时间（秒）。
   * @default 0
   */
  delay?: number;

  /**
   * 缓动函数：内置名称或自定义函数。
   * @default 'easeInOut'
   */
  ease?: EasingInput;

  /**
   * 重复次数（0 = 播放一次，1 = 再重复一次即总共两次，以此类推）。
   * @default 0
   */
  repeat?: number;

  /**
   * 是否往复播放（前进→后退→前进→…）。
   * 需配合 `repeat` 使用。
   * @default false
   */
  yoyo?: boolean;

  // ─── 生命周期回调 ──────────────────────────────

  /** 动画开始播放时触发 */
  onStart?: () => void;

  /** 每一帧更新时触发，入参为当前进度 (0-1) */
  onUpdate?: (progress: number) => void;

  /** 暂停时触发 */
  onPause?: () => void;

  /** 动画播放完成时触发 */
  onComplete?: () => void;

  /** 被动停止时触发（调用 `stop()`），入参为停止时的进度 (0-1) */
  onStop?: (progress: number) => void;

  /** 跳转进度时触发，入参为目标进度 (0-1) */
  onSeek?: (progress: number) => void;
}

/**
 * 全局默认配置（{@link AnimationConfig} 的子集，不含回调和 `to`/`from`）。
 *
 * 通过 {@link setDefaultConfig} 修改，通过 {@link getDefaultConfig} 读取。
 */
export interface AnimationDefaults {
  /** 动画时长（秒） */
  duration: number;
  /** 延迟启动时间（秒） */
  delay: number;
  /** 缓动函数 */
  ease: EasingInput;
  /** 重复次数 */
  repeat: number;
  /** 是否往复播放 */
  yoyo: boolean;
}

// ─── 控制器接口 ─────────────────────────────────────────

/**
 * 动画控制器：`animate()` 的返回对象。
 *
 * 支持链式调用编排动画步骤，以及命令式播放控制。
 * 所有链式方法（`.to()`、`.parallel()`、`play()` 等）返回 `this` 以便链式调用。
 *
 * @example
 * ```ts
 * const anim = animate(mesh)
 *   .to({ position: { x: 2 } }, { duration: 0.5 })
 *   .parallel([
 *     (g) => g.to({ rotation: { y: Math.PI } }, { duration: 0.5 }),
 *     (g) => g.to({ 'material.color': '#ff0000' }, { duration: 0.5 }),
 *   ])
 *   .to({ scale: { x: 2 } }, { duration: 0.3 });
 *
 * anim.play();
 * anim.pause();
 * anim.seek(0.5);
 * anim.resume();
 * ```
 */
export interface AnimationController {
  /**
   * 添加一个串行动画步骤。
   *
   * 多次调用 `.to()` 时，步骤按顺序执行（前一步完成后执行下一步）。
   * 返回 `this` 以便链式调用。
   *
   * @param properties - 目标属性值
   * @param config - 本步骤的覆盖配置（未设置的字段从实例/全局默认继承）
   */
  to(properties: PropertyTarget, config?: Partial<AnimationConfig>): this;

  /**
   * 添加一个并行步骤组。
   *
   * 组内所有子步骤同时开始播放。
   * 返回 `this` 以便链式调用。
   *
   * @param groups - 并行子步骤回调数组，每个回调接收一个 {@link AnimationStepBuilder}
   *
   * @example
   * ```ts
   * animate(mesh)
   *   .parallel([
   *     (g) => g.to({ position: { x: 2 } }, { duration: 0.5 }),
   *     (g) => g.to({ rotation: { y: Math.PI } }, { duration: 0.5 }),
   *   ])
   *   .play();
   * ```
   */
  parallel(groups: ((group: AnimationStepBuilder) => void)[]): this;

  // ─── 播放控制 ──────────────────────────────────

  /** 开始播放。首次调用会构建内部 Timeline。 */
  play(): this;

  /** 暂停播放。 */
  pause(): this;

  /** 从暂停处继续播放。 */
  resume(): this;

  /** 停止播放并回到起始位置。 */
  stop(): this;

  /** 重置到初始状态重新播放。 */
  restart(): this;

  /**
   * 跳转到指定进度。
   * @param progress - 目标进度 (0-1)
   */
  seek(progress: number): this;

  // ─── 状态查询 ──────────────────────────────────

  /** 获取当前播放进度 (0-1)。 */
  getProgress(): number;

  /** 获取当前播放状态。 */
  getState(): AnimationState;

  /** 获取动画总时长（秒）。 */
  getDuration(): number;

  // ─── 生命周期 ──────────────────────────────────

  /**
   * 销毁动画实例，释放所有内部资源。
   *
   * 销毁后调用任何方法都会抛出错误。
   */
  destroy(): void;
}

/**
 * `.parallel()` 回调中的步骤构建器。
 *
 * 仅支持 `.to()` 方法，不支持嵌套 `.parallel()`。
 * 返回 `this` 以便链式调用。
 *
 * @example
 * ```ts
 * animate(mesh)
 *   .parallel([
 *     (g) => g
 *       .to({ position: { x: 2 } }, { duration: 0.5 })
 *       .to({ position: { y: 1 } }, { duration: 0.3 }),
 *     (g) => g.to({ rotation: { y: Math.PI } }, { duration: 0.8 }),
 *   ])
 *   .play();
 * ```
 */
export interface AnimationStepBuilder {
  /**
   * 添加一个动画子步骤。
   * 在 `.parallel()` 回调内，多个 `.to()` 调用会按顺序执行。
   */
  to(properties: PropertyTarget, config?: Partial<AnimationConfig>): AnimationStepBuilder;
}

// ─── 内部类型（不对外导出） ───────────────────────────────

/**
 * 内部合并后的完整动画配置。
 * 所有数值字段都有确定值（从默认配置填充）。
 */
export interface InternalAnimationConfig {
  to?: PropertyTarget;
  from?: PropertyTarget;
  duration: number;
  delay: number;
  ease: EasingInput;
  repeat: number;
  yoyo: boolean;
  onStart?: () => void;
  onUpdate?: (progress: number) => void;
  onPause?: () => void;
  onComplete?: () => void;
  onStop?: (progress: number) => void;
  onSeek?: (progress: number) => void;
}

/** 串行步骤 */
export interface SerialStep {
  type: 'serial';
  to?: PropertyTarget;
  from?: PropertyTarget;
  config: InternalAnimationConfig;
}

/** 并行步骤组 */
export interface ParallelStep {
  type: 'parallel';
  groups: SerialStep[][];
}

/** 动画步骤（串行或并行） */
export type AnimationStep = SerialStep | ParallelStep;
