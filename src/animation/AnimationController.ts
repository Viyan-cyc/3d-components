/**
 * 动画控制器
 *
 * `animate()` 返回的核心类。管理动画步骤、GSAP Timeline 实例
 * 和播放状态，提供链式编排和命令式控制 API。
 *
 * @module animation/AnimationController
 */

import type {
  AnimationConfig,
  AnimationController as IAnimationController,
  AnimationState,
  AnimationStep,
  AnimationStepBuilder as IAnimationStepBuilder,
  InternalAnimationConfig,
  PropertyTarget,
  SerialStep,
} from './types';
import * as THREE from 'three';
import { mergeWithDefaults } from './defaults';
import { buildTimeline, type LifecycleCallbacks } from './timelineBuilder';

// ─── StepBuilder 内部实现 ────────────────────────────────

/**
 * .parallel() 回调中的步骤构建器实现。
 *
 * 收集回调中调用的所有 .to() 步骤，
 * 供 AnimationControllerImpl 读取。
 */
class StepBuilderImpl implements IAnimationStepBuilder {
  readonly steps: SerialStep[] = [];

  to(properties: PropertyTarget, config?: Partial<AnimationConfig>): StepBuilderImpl {
    const mergedConfig = mergeWithDefaults(config);
    mergedConfig.to = properties;
    this.steps.push({
      type: 'serial',
      to: properties,
      config: mergedConfig,
    });
    return this;
  }
}

// ─── AnimationController 实现 ────────────────────────────

/**
 * 动画控制器实现类。
 *
 * 实现了 {@link AnimationController} 接口的所有方法。
 * 用户通过 `animate()` 获取此类的实例，无需直接构造。
 *
 * @internal
 */
export class AnimationControllerImpl implements IAnimationController {
  /** 动画目标对象数组 */
  private _targets: THREE.Object3D[];
  /** 动画步骤列表 */
  private _steps: AnimationStep[] = [];
  /** 实例级配置（从 animate() 传入的配置合并默认值后） */
  private _config: InternalAnimationConfig;
  /** GSAP Timeline 实例（首次 play() 时创建） */
  private _timeline: gsap.core.Timeline | null = null;
  /** 当前播放状态 */
  private _state: AnimationState = 'idle';
  /** 是否已构建 Timeline（构建后不再接受新的 .to()/.parallel()） */
  private _built = false;

  // ─── 生命周期回调 ──────────────────────────────

  private _onStart?: () => void;
  private _onUpdate?: (progress: number) => void;
  private _onPause?: () => void;
  private _onComplete?: () => void;
  private _onStop?: (progress: number) => void;
  private _onSeek?: (progress: number) => void;

  constructor(targets: THREE.Object3D[], config: InternalAnimationConfig) {
    this._targets = targets;
    this._config = config;

    // 存储实例级生命周期回调
    this._onStart = config.onStart;
    this._onUpdate = config.onUpdate;
    this._onPause = config.onPause;
    this._onComplete = config.onComplete;
    this._onStop = config.onStop;
    this._onSeek = config.onSeek;
  }

  // ─── 链式编排 ──────────────────────────────────

  to(properties: PropertyTarget, config?: Partial<AnimationConfig>): this {
    this.assertNotDestroyed();
    if (this._built) {
      console.warn('[animation] Timeline 已构建，无法再添加步骤');
      return this;
    }

    const mergedConfig = mergeWithDefaults({ ...config, to: properties });
    this._steps.push({
      type: 'serial',
      to: properties,
      from: config?.from,
      config: mergedConfig,
    });

    return this;
  }

  parallel(groups: ((group: IAnimationStepBuilder) => void)[]): this {
    this.assertNotDestroyed();
    if (this._built) {
      console.warn('[animation] Timeline 已构建，无法再添加步骤');
      return this;
    }

    const parallelGroups: SerialStep[][] = [];

    for (const callback of groups) {
      const builder = new StepBuilderImpl();
      callback(builder);
      if (builder.steps.length > 0) {
        parallelGroups.push(builder.steps);
      }
    }

    if (parallelGroups.length > 0) {
      this._steps.push({
        type: 'parallel',
        groups: parallelGroups,
      });
    }

    return this;
  }

  // ─── 播放控制 ──────────────────────────────────

  play(): this {
    this.assertNotDestroyed();

    // 如果 Timeline 不存在，构建它
    if (!this._timeline) {
      this._buildTimeline();
    }

    if (this._state === 'stopped') {
      this._timeline!.restart();
    } else {
      this._timeline!.play();
    }

    this._state = 'playing';
    return this;
  }

  pause(): this {
    this.assertNotDestroyed();
    if (!this._timeline) return this;

    this._timeline.pause();
    this._state = 'paused';
    this._onPause?.();
    return this;
  }

  resume(): this {
    this.assertNotDestroyed();
    if (!this._timeline) return this;

    this._timeline.resume();
    this._state = 'playing';
    return this;
  }

  stop(): this {
    this.assertNotDestroyed();
    if (!this._timeline) {
      this._state = 'stopped';
      this._onStop?.(0);
      return this;
    }

    const progress = this._timeline.progress();
    this._timeline.pause();
    this._timeline.progress(0, true); // suppressEvents
    this._state = 'stopped';
    this._onStop?.(progress);
    return this;
  }

  restart(): this {
    this.assertNotDestroyed();
    if (!this._timeline) {
      return this.play();
    }

    this._timeline.restart();
    this._state = 'playing';
    return this;
  }

  seek(progress: number): this {
    this.assertNotDestroyed();
    if (!this._timeline) return this;

    const clamped = Math.max(0, Math.min(1, progress));
    this._timeline.progress(clamped);
    this._onSeek?.(clamped);
    return this;
  }

  // ─── 状态查询 ──────────────────────────────────

  getProgress(): number {
    this.assertNotDestroyed();
    if (!this._timeline) return 0;
    return this._timeline.progress();
  }

  getState(): AnimationState {
    return this._state;
  }

  getDuration(): number {
    this.assertNotDestroyed();
    if (!this._timeline) return 0;
    return this._timeline.duration();
  }

  // ─── 生命周期 ──────────────────────────────────

  destroy(): void {
    if (this._state === 'destroyed') return;

    // 杀死 GSAP Timeline（同时杀死所有子 tween）
    if (this._timeline) {
      this._timeline.kill();
      this._timeline = null;
    }

    // 清空步骤数据（释放捕获目标引用的闭包）
    this._steps = [];

    // 清空目标引用
    this._targets = [] as THREE.Object3D[];

    // 清空回调引用（打破循环引用）
    this._onStart = undefined;
    this._onUpdate = undefined;
    this._onPause = undefined;
    this._onComplete = undefined;
    this._onStop = undefined;
    this._onSeek = undefined;

    this._state = 'destroyed';
  }

  // ─── 内部方法 ──────────────────────────────────

  /**
   * 获取实例级配置（供 animate.ts 使用）
   */
  getConfig(): InternalAnimationConfig {
    return this._config;
  }

  /**
   * 获取步骤列表（供 animate.ts 使用）
   */
  getSteps(): AnimationStep[] {
    return this._steps;
  }

  /**
   * 构建 GSAP Timeline。
   *
   * 首次调用 play() 时触发。构建后 _built 标记为 true，
   * 后续 .to()/.parallel() 调用将被忽略。
   */
  private _buildTimeline(): void {
    const callbacks: LifecycleCallbacks = {
      onStart: this._onStart,
      onUpdate: this._onUpdate,
      onComplete: () => {
        this._state = 'completed';
        this._onComplete?.();
      },
      onPause: this._onPause,
    };

    this._timeline = buildTimeline(
      this._steps,
      this._targets,
      callbacks,
      this._config,
    );

    this._built = true;
  }

  /**
   * 断言实例未被销毁。
   *
   * @throws 实例已销毁时抛出错误
   */
  private assertNotDestroyed(): void {
    if (this._state === 'destroyed') {
      throw new Error('动画实例已销毁，无法调用任何方法。请使用 animate() 创建新的动画。');
    }
  }
}
