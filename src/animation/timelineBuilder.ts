/**
 * Timeline 构建器
 *
 * 将内部的 AnimationStep[] 转换为 GSAP Timeline。
 * 这是 GSAP 封装的核心——用户永远不会直接接触此模块。
 *
 * @module animation/timelineBuilder
 */

import { gsap } from 'gsap';
import * as THREE from 'three';
import type { AnimationStep, SerialStep, InternalAnimationConfig } from './types';
import { resolveEase } from './easing';
import { flattenProperties, createWriteBackCallback } from './propertyResolver';

// ─── 生命周期回调集 ─────────────────────────────────────

export interface LifecycleCallbacks {
  onStart?: () => void;
  onUpdate?: (progress: number) => void;
  onPause?: () => void;
  onComplete?: () => void;
  onStop?: () => void;
  onSeek?: (progress: number) => void;
}

// ─── 构建单个步骤的 tween ───────────────────────────────

/**
 * 为一个串行步骤+单个目标创建 GSAP tween vars。
 *
 * 在属性动画模式下，代理对象中会注入一个 <code>__progress</code> 字段，
 * 从 0 动画到 1，用于驱动用户的 onUpdate(progress) 回调。
 *
 * @param target - Three.js 目标对象
 * @param step - 串行步骤
 * @returns GSAP 可用的 { proxy, vars, fromVars } 或 null（无可动画属性时）
 */
function buildTweenVars(
  target: THREE.Object3D,
  step: SerialStep,
): { proxy: Record<string, unknown>; vars: gsap.TweenVars; fromVars: gsap.TweenVars | null } | null {
  const { to, from, config } = step;

  // 纯 onUpdate 模式：无 to/from，仅进度驱动
  if (!to && !from) {
    if (!config.onUpdate) return null;
    const proxy = { t: 0 };
    const vars: gsap.TweenVars = {
      t: 1,
      duration: config.duration,
      delay: config.delay,
      ease: resolveEase(config.ease),
      repeat: config.repeat,
      yoyo: config.yoyo || undefined,
      onUpdate: () => {
        config.onUpdate?.(proxy.t);
      },
    };
    return { proxy, vars, fromVars: null };
  }

  // 属性动画模式
  const resolved = flattenProperties(target, to, from);
  if (Object.keys(resolved.toVars).length === 0) return null;

  const writeBack = createWriteBackCallback(resolved.proxy, resolved.writers);

  // 注入 __progress 字段：从 0 到 1，用于追踪当前步骤进度
  resolved.proxy['__progress'] = 0;
  resolved.toVars['__progress'] = 1;
  if (resolved.fromVars) {
    resolved.fromVars['__progress'] = 0;
  }

  // 合并 writeBack + 用户回调
  const hasUserOnUpdate = !!config.onUpdate;
  const hasUserOnStart = !!config.onStart;
  const hasUserOnComplete = !!config.onComplete;

  const vars: gsap.TweenVars = {
    ...resolved.toVars,
    duration: config.duration,
    delay: config.delay,
    ease: resolveEase(config.ease),
    repeat: config.repeat,
    yoyo: config.yoyo || undefined,
    onUpdate: hasUserOnUpdate
      ? () => {
          writeBack();
          config.onUpdate?.(resolved.proxy['__progress'] as number);
        }
      : writeBack,
    onStart: hasUserOnStart
      ? () => config.onStart?.()
      : undefined,
    onComplete: hasUserOnComplete
      ? () => config.onComplete?.()
      : undefined,
  };

  // 清理 undefined 字段，避免 GSAP 解析异常
  if (vars.onStart === undefined) delete vars.onStart;
  if (vars.onComplete === undefined) delete vars.onComplete;

  return { proxy: resolved.proxy, vars, fromVars: resolved.fromVars };
}

// ─── 添加串行步骤到 Timeline ────────────────────────────

/**
 * 将一个串行步骤添加到 Timeline。
 *
 * @param tl - GSAP Timeline
 * @param step - 串行步骤
 * @param targets - 目标对象数组
 * @param position - Timeline 位置（不传则追加到末尾）
 */
function addSerialStep(
  tl: gsap.core.Timeline,
  step: SerialStep,
  targets: THREE.Object3D[],
  position?: number,
): void {
  // 为纯 onUpdate 模式（无目标属性），创建单个代理 tween
  if (!step.to && !step.from && step.config.onUpdate) {
    const proxy = { t: 0 };
    const vars: gsap.TweenVars = {
      t: 1,
      duration: step.config.duration,
      delay: step.config.delay,
      ease: resolveEase(step.config.ease),
      repeat: step.config.repeat,
      yoyo: step.config.yoyo || undefined,
      onUpdate: () => step.config.onUpdate?.(proxy.t),
      onStart: step.config.onStart ? () => step.config.onStart?.() : undefined,
      onComplete: step.config.onComplete ? () => step.config.onComplete?.() : undefined,
    };
    if (vars.onStart === undefined) delete vars.onStart;
    if (vars.onComplete === undefined) delete vars.onComplete;
    tl.to(proxy, vars, position);
    return;
  }

  // 单目标 or 多目标
  for (let i = 0; i < targets.length; i++) {
    const result = buildTweenVars(targets[i], step);
    if (!result) continue;

    if (result.fromVars) {
      tl.fromTo(result.proxy, result.fromVars, result.vars, position ?? (i > 0 ? '<' : undefined));
    } else {
      tl.to(result.proxy, result.vars, position ?? (i > 0 ? '<' : undefined));
    }
  }
}

// ─── 将一组串行步骤添加到子 Timeline ────────────────────

/**
 * 将一组串行步骤添加到一个子 Timeline 中。
 *
 * 子 Timeline 内部按顺序追加（串行），
 * 之后整个子 Timeline 作为一个单元插入主 Timeline。
 *
 * @param steps - 串行步骤列表
 * @param targets - 目标对象数组
 * @returns GSAP 子 Timeline
 */
function buildGroupTimeline(
  steps: SerialStep[],
  targets: THREE.Object3D[],
): gsap.core.Timeline {
  const childTl = gsap.timeline();
  for (const subStep of steps) {
    addSerialStep(childTl, subStep, targets);
  }
  return childTl;
}

// ─── 主构建函数 ─────────────────────────────────────────

/**
 * 将 AnimationStep[] 构建为 GSAP Timeline。
 *
 * 遍历步骤列表：
 * - 串行步骤：追加到 Timeline 末尾（不指定 position）
 * - 并行步骤：记录当前 Timeline 时长，在该位置添加所有子步骤
 *
 * @param steps - 动画步骤列表
 * @param targets - 目标对象数组
 * @param callbacks - 生命周期回调（附加到 Timeline 级别）
 * @param instanceConfig - 实例级配置（用于纯 onUpdate 等场景）
 * @returns GSAP Timeline（已暂停，由调用方控制播放）
 *
 * @internal
 */
export function buildTimeline(
  steps: AnimationStep[],
  targets: THREE.Object3D[],
  callbacks?: LifecycleCallbacks,
  instanceConfig?: InternalAnimationConfig,
): gsap.core.Timeline {
  const tl = gsap.timeline({
    paused: true,
    onStart: () => {
      callbacks?.onStart?.();
    },
    onUpdate: () => {
      const progress = tl.progress();
      callbacks?.onUpdate?.(progress);
    },
    onPause: () => {
      callbacks?.onPause?.();
    },
    onComplete: () => {
      callbacks?.onComplete?.();
    },
  });

  // 如果没有步骤但有实例配置（纯 onUpdate 模式）
  if (steps.length === 0 && instanceConfig?.onUpdate) {
    const proxy = { t: 0 };
    tl.to(proxy, {
      t: 1,
      duration: instanceConfig.duration,
      delay: instanceConfig.delay,
      ease: resolveEase(instanceConfig.ease),
      repeat: instanceConfig.repeat,
      yoyo: instanceConfig.yoyo || undefined,
      onUpdate: () => {
        instanceConfig.onUpdate?.(proxy.t);
      },
    });
    return tl;
  }

  // 遍历所有步骤，构建 Timeline
  for (const step of steps) {
    if (step.type === 'serial') {
      addSerialStep(tl, step, targets);
    } else {
      // 并行步骤：每个 group 创建自己的子 Timeline（内部串行），
      // 然后将所有子 Timeline 统一加到主 Timeline 的 insertPoint（并行）
      const insertPoint = tl.duration();
      for (const group of step.groups) {
        const childTl = buildGroupTimeline(group, targets);
        tl.add(childTl, insertPoint);
      }
    }
  }

  return tl;
}
