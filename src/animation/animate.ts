/**
 * animate() 工厂函数
 *
 * 动画库的主入口。创建动画控制器实例，支持单步动画和链式编排。
 *
 * @module animation/animate
 */

import type * as THREE from 'three';
import type {
  AnimationConfig, AnimationController, AnimationTarget, InternalAnimationConfig,
} from './types';
import { AnimationControllerImpl } from './AnimationController';
import { mergeWithDefaults } from './defaults';

/**
 * 目标校验与归一化。
 *
 * @param target - 用户传入的目标
 * @returns 归一化后的 Object3D 数组
 * @throws 目标为 null/undefined/空数组时抛出 TypeError
 */
const normalizeTarget = (target: AnimationTarget): THREE.Object3D[] => {
  if (!target) {
    throw new TypeError('动画目标不能为 null 或 undefined');
  }

  if (Array.isArray(target)) {
    if (target.length === 0) {
      throw new TypeError('动画目标数组不能为空');
    }
    for (let i = 0; i < target.length; i++) {
      if (!target[i]) {
        throw new TypeError(`动画目标数组中索引 ${i} 的元素为 null 或 undefined`);
      }
    }
    return target;
  }

  return [target];
};

/**
 * 创建一个动画控制器。
 *
 * 这是动画库的唯一入口函数。返回的控制器支持链式编排和命令式播放控制。
 *
 * **注意**：所有动画均需显式调用 `.play()` 开始播放。
 *
 * @param target - 动画目标，单个 Object3D 或数组
 * @param config - 动画配置（可选）
 * @returns 动画控制器
 *
 * @example
 * ```ts
 * // 简单单步动画
 * animate(mesh, {
 *   to: { position: { x: 2 } },
 *   duration: 1,
 *   ease: 'easeOut',
 * }).play();
 *
 * // 链式串行
 * animate(mesh)
 *   .to({ position: { x: 2 } }, { duration: 0.5 })
 *   .to({ scale: { x: 2 } }, { duration: 0.3 })
 *   .play();
 *
 * // 并行
 * animate(mesh)
 *   .parallel([
 *     (g) => g.to({ position: { x: 2 } }, { duration: 0.5 }),
 *     (g) => g.to({ rotation: { y: Math.PI } }, { duration: 0.5 }),
 *   ])
 *   .play();
 *
 * // 多目标
 * animate([mesh1, mesh2, mesh3], {
 *   to: { position: { x: 2 } },
 *   duration: 1,
 * }).play();
 * ```
 */
const animate = (target: AnimationTarget, config?: AnimationConfig): AnimationController => {
  // 1. 校验并归一化目标
  const targets = normalizeTarget(target);

  // 2. 合并配置（全局默认 ← 用户配置）
  const mergedConfig: InternalAnimationConfig = mergeWithDefaults(config);

  // 3. 创建控制器
  const controller = new AnimationControllerImpl(targets, mergedConfig);

  // 4. 如果 config 中包含 to/from，推入初始步骤
  if (config?.to || config?.from) {
    controller.to(config.to ?? {}, config);
  }

  // 5. autoPlay 始终为 false，用户必须显式调用 .play()
  return controller;
};

export { animate };
