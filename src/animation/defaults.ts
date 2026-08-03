/**
 * 全局默认配置管理
 *
 * @module animation/defaults
 */

import type { AnimationDefaults, InternalAnimationConfig } from './types';

/**
 * 全局默认配置。
 *
 * 所有 {@link animate} 调用中未指定的字段从此对象继承。
 * 通过 {@link setDefaultConfig} 修改，通过 {@link getDefaultConfig} 读取。
 */
const globalDefaults: AnimationDefaults = {
  duration: 1,
  delay: 0,
  ease: 'easeInOut',
  repeat: 0,
  yoyo: false,
};

/**
 * 修改全局默认配置。
 *
 * 传入的对象会与当前默认配置浅合并，仅覆盖指定的字段。
 * 后续所有 `animate()` 调用将使用新的默认值。
 *
 * @param config - 要覆盖的默认配置字段
 *
 * @example
 * ```ts
 * setDefaultConfig({ duration: 1.2, ease: 'easeInOut' });
 * // 之后所有动画的默认时长为 1.2s，缓动为 easeInOut
 * ```
 */
const setDefaultConfig = (config: Partial<AnimationDefaults>): void => {
  if (!config || typeof config !== 'object') {
    throw new TypeError('配置必须是一个对象');
  }
  Object.assign(globalDefaults, config);
};

/**
 * 获取当前全局默认配置的只读副本。
 *
 * @returns 全局默认配置的浅拷贝
 */
const getDefaultConfig = (): Readonly<AnimationDefaults> => ({ ...globalDefaults });

/**
 * 将用户配置与全局默认配置合并，生成内部完整配置。
 *
 * 合并优先级：用户配置 > 全局默认配置。
 *
 * @param config - 用户传入的配置（可能部分字段缺失）
 * @returns 合并后的完整内部配置
 *
 * @internal
 */
const mergeWithDefaults = (config?: Partial<InternalAnimationConfig>): InternalAnimationConfig => ({
  duration: config?.duration ?? globalDefaults.duration,
  delay: config?.delay ?? globalDefaults.delay,
  ease: config?.ease ?? globalDefaults.ease,
  repeat: config?.repeat ?? globalDefaults.repeat,
  yoyo: config?.yoyo ?? globalDefaults.yoyo,
  to: config?.to,
  from: config?.from,
  onStart: config?.onStart,
  onUpdate: config?.onUpdate,
  onPause: config?.onPause,
  onComplete: config?.onComplete,
  onStop: config?.onStop,
  onSeek: config?.onSeek,
});

export { setDefaultConfig, getDefaultConfig, mergeWithDefaults };
