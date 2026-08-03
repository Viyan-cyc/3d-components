/**
 * 缓动系统
 *
 * 提供内置缓动预设、自定义缓动注册和缓动解析。
 * 所有缓动名称对用户友好，与 GSAP 缓动字符串无关。
 *
 * @module animation/easing
 */

import type { EasingInput } from './types';
import gsap from 'gsap';

// ─── 数学工具 ───────────────────────────────────────────

const clamp = (v: number, min: number, max: number): number => {
  if (v < min) {
    return min;
  }
  if (v > max) {
    return max;
  }
  return v;
};

// ─── 缓动函数常量 ────────────────────────────────────────

/** easeInOut 阈值 */
const FACTOR_0_5 = 0.5;

/** easeInOut 偏移量 */
const OFFSET_NEG_2 = -2;

/** 三次方指数 */
const POWER_3 = 3;

/** 四次方指数 */
const POWER_4 = 4;

/** 四次方入出乘数 */
const FACTOR_8 = 8;

/** 五次方指数 */
const POWER_5 = 5;

/** 五次方入出乘数 */
const FACTOR_16 = 16;

/** 指数缓动乘数 */
const FACTOR_10 = 10;

/** 指数缓动负乘数 */
const FACTOR_NEG_10 = -10;

/** 指数入出正乘数 */
const FACTOR_20 = 20;

/** 指数入出负乘数 */
const FACTOR_NEG_20 = -20;

/** 过冲入出系数因子 */
const BACK_C2_FACTOR = 1.525;

/** 弹性入出周期除数 */
const ELASTIC_C5_DIVISOR = 4.5;

/** 弹性入出偏移 */
const ELASTIC_OFFSET = 11.125;

/** 弹性入相位偏移 */
const ELASTIC_PHASE_IN = 10.75;

/** 弹性出相位偏移 */
const ELASTIC_PHASE_OUT = 0.75;

/** 弹跳常量 n1 */
const BOUNCE_N1 = 7.5625;

/** 弹跳常量 d1 */
const BOUNCE_D1 = 2.75;

/** 弹跳偏移1 */
const BOUNCE_OFFSET_1 = 1.5;

/** 弹跳阈值2 */
const BOUNCE_THRESHOLD_2 = 2.5;

/** 弹跳偏移2 */
const BOUNCE_OFFSET_2 = 2.25;

/** 弹跳偏移3 */
const BOUNCE_OFFSET_3 = 2.625;

/** 弹跳阶段1值 */
const BOUNCE_PHASE_1 = 0.75;

/** 弹跳阶段2值 */
const BOUNCE_PHASE_2 = 0.9375;

/** 弹跳阶段3值 */
const BOUNCE_PHASE_3 = 0.984375;

// ─── 缓动函数实现 ────────────────────────────────────────

/** 线性 */
const linear = (t: number): number => t;

/** 二次方入 */
const easeInQuad = (t: number): number => t * t;

/** 二次方出 */
const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);

/** 二次方入出 */
const easeInOutQuad = (t: number): number => {
  if (t < FACTOR_0_5) {
    return 2 * t * t;
  }
  return 1 - Math.pow(OFFSET_NEG_2 * t + 2, 2) / OFFSET_NEG_2;
};

/** 三次方入（= easeIn） */
const easeInCubic = (t: number): number => t * t * t;

/** 三次方出（= easeOut） */
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, POWER_3);

/** 三次方入出（= easeInOut） */
const easeInOutCubic = (t: number): number => {
  if (t < FACTOR_0_5) {
    return POWER_4 * t * t * t;
  }
  return 1 - Math.pow(OFFSET_NEG_2 * t + 2, POWER_3) / OFFSET_NEG_2;
};

/** 四次方入 */
const easeInQuart = (t: number): number => t * t * t * t;

/** 四次方出 */
const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, POWER_4);

/** 四次方入出 */
const easeInOutQuart = (t: number): number => {
  if (t < FACTOR_0_5) {
    return FACTOR_8 * t * t * t * t;
  }
  return 1 - Math.pow(OFFSET_NEG_2 * t + 2, POWER_4) / OFFSET_NEG_2;
};

/** 五次方入 */
const easeInQuint = (t: number): number => t * t * t * t * t;

/** 五次方出 */
const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, POWER_5);

/** 五次方入出 */
const easeInOutQuint = (t: number): number => {
  if (t < FACTOR_0_5) {
    return FACTOR_16 * t * t * t * t * t;
  }
  return 1 - Math.pow(OFFSET_NEG_2 * t + 2, POWER_5) / OFFSET_NEG_2;
};

/** 正弦入 */
const easeInSine = (t: number): number => 1 - Math.cos((t * Math.PI) / 2);

/** 正弦出 */
const easeOutSine = (t: number): number => Math.sin((t * Math.PI) / 2);

/** 正弦入出 */
const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / OFFSET_NEG_2;

/** 指数入 */
const easeInExpo = (t: number): number => {
  if (t === 0) {
    return 0;
  }
  return Math.pow(2, FACTOR_10 * t - FACTOR_10);
};

/** 指数出 */
const easeOutExpo = (t: number): number => {
  if (t === 1) {
    return 1;
  }
  return 1 - Math.pow(2, FACTOR_NEG_10 * t);
};

/** 指数入出 */
const easeInOutExpo = (t: number): number => {
  if (t === 0) {
    return 0;
  }
  if (t === 1) {
    return 1;
  }
  if (t < FACTOR_0_5) {
    return Math.pow(2, FACTOR_20 * t - FACTOR_10) / OFFSET_NEG_2;
  }
  return (2 - Math.pow(2, FACTOR_NEG_20 * t + FACTOR_10)) / OFFSET_NEG_2;
};

/** 圆形入 */
const easeInCirc = (t: number): number => 1 - Math.sqrt(1 - t * t);

/** 圆形出 */
const easeOutCirc = (t: number): number => Math.sqrt(1 - (t - 1) * (t - 1));

/** 圆形入出 */
const easeInOutCirc = (t: number): number => {
  if (t < FACTOR_0_5) {
    return (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / OFFSET_NEG_2;
  }
  return (Math.sqrt(1 - Math.pow(OFFSET_NEG_2 * t + 2, 2)) + 1) / OFFSET_NEG_2;
};

/** 过冲入 */
const easeInBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return c3 * t * t * t - c1 * t * t;
};

/** 过冲出 */
const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, POWER_3) + c1 * Math.pow(t - 1, 2);
};

/** 过冲入出 */
const easeInOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c2 = c1 * BACK_C2_FACTOR;
  if (t < FACTOR_0_5) {
    return (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / OFFSET_NEG_2;
  }
  const backPart = Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2;
  return backPart / OFFSET_NEG_2;
};

/** 弹性入 */
const easeInElastic = (t: number): number => {
  if (t === 0 || t === 1) {
    return t;
  }
  const c4 = (2 * Math.PI) / POWER_3;
  return -Math.pow(2, FACTOR_10 * t - FACTOR_10) * Math.sin((t * FACTOR_10 - ELASTIC_PHASE_IN) * c4);
};

/** 弹性出 */
const easeOutElastic = (t: number): number => {
  if (t === 0 || t === 1) {
    return t;
  }
  const c4 = (2 * Math.PI) / POWER_3;
  return Math.pow(2, FACTOR_NEG_10 * t) * Math.sin((t * FACTOR_10 - ELASTIC_PHASE_OUT) * c4) + 1;
};

/** 弹性入出 */
const easeInOutElastic = (t: number): number => {
  if (t === 0 || t === 1) {
    return t;
  }
  const c5 = (2 * Math.PI) / ELASTIC_C5_DIVISOR;
  if (t < FACTOR_0_5) {
    const pow = Math.pow(2, FACTOR_20 * t - FACTOR_10);
    return -(pow * Math.sin((FACTOR_20 * t - ELASTIC_OFFSET) * c5)) / OFFSET_NEG_2;
  }
  const pow = Math.pow(2, FACTOR_NEG_20 * t + FACTOR_10);
  return (pow * Math.sin((FACTOR_20 * t - ELASTIC_OFFSET) * c5)) / OFFSET_NEG_2 + 1;
};

/** 弹跳出 */
const easeOutBounce = (t: number): number => {
  let tt = t;
  if (tt < 1 / BOUNCE_D1) {
    return BOUNCE_N1 * tt * tt;
  }
  if (tt < 2 / BOUNCE_D1) {
    tt -= BOUNCE_OFFSET_1 / BOUNCE_D1;
    return BOUNCE_N1 * tt * tt + BOUNCE_PHASE_1;
  }
  if (tt < BOUNCE_THRESHOLD_2 / BOUNCE_D1) {
    tt -= BOUNCE_OFFSET_2 / BOUNCE_D1;
    return BOUNCE_N1 * tt * tt + BOUNCE_PHASE_2;
  }
  tt -= BOUNCE_OFFSET_3 / BOUNCE_D1;
  return BOUNCE_N1 * tt * tt + BOUNCE_PHASE_3;
};

/** 弹跳入 */
const easeInBounce = (t: number): number => 1 - easeOutBounce(1 - t);

/** 弹跳入出 */
const easeInOutBounce = (t: number): number => {
  if (t < FACTOR_0_5) {
    return (1 - easeOutBounce(1 - 2 * t)) / OFFSET_NEG_2;
  }
  return (1 + easeOutBounce(2 * t - 1)) / OFFSET_NEG_2;
};

// ─── 缓动注册表 ─────────────────────────────────────────

/**
 * 缓动函数注册表。
 *
 * 键为用户友好的缓动名称，值为 `(t: number) => number` 函数。
 * 所有内置预设在此初始化，自定义缓动通过 {@link registerEasing} 添加。
 *
 * @internal
 */
export const easingRegistry = new Map<string, (t: number) => number>([
  // 通用别名（映射到三次方/cubic）
  ['linear', linear],
  ['easeIn', easeInCubic],
  ['easeOut', easeOutCubic],
  ['easeInOut', easeInOutCubic],

  // 二次方 (Quad / Power2)
  ['easeInQuad', easeInQuad],
  ['easeOutQuad', easeOutQuad],
  ['easeInOutQuad', easeInOutQuad],

  // 三次方 (Cubic / Power3)
  ['easeInCubic', easeInCubic],
  ['easeOutCubic', easeOutCubic],
  ['easeInOutCubic', easeInOutCubic],

  // 四次方 (Quart / Power4)
  ['easeInQuart', easeInQuart],
  ['easeOutQuart', easeOutQuart],
  ['easeInOutQuart', easeInOutQuart],

  // 五次方 (Quint / Power5)
  ['easeInQuint', easeInQuint],
  ['easeOutQuint', easeOutQuint],
  ['easeInOutQuint', easeInOutQuint],

  // 正弦
  ['easeInSine', easeInSine],
  ['easeOutSine', easeOutSine],
  ['easeInOutSine', easeInOutSine],

  // 指数
  ['easeInExpo', easeInExpo],
  ['easeOutExpo', easeOutExpo],
  ['easeInOutExpo', easeInOutExpo],

  // 圆形
  ['easeInCirc', easeInCirc],
  ['easeOutCirc', easeOutCirc],
  ['easeInOutCirc', easeInOutCirc],

  // 过冲
  ['easeInBack', easeInBack],
  ['easeOutBack', easeOutBack],
  ['easeInOutBack', easeInOutBack],

  // 弹性
  ['easeInElastic', easeInElastic],
  ['easeOutElastic', easeOutElastic],
  ['easeInOutElastic', easeInOutElastic],

  // 弹跳
  ['easeInBounce', easeInBounce],
  ['easeOutBounce', easeOutBounce],
  ['easeInOutBounce', easeInOutBounce],
]);

// ─── 缓动解析 ───────────────────────────────────────────

/**
 * 将用户传入的缓动参数解析为函数。
 *
 * - 字符串：在注册表中查找，找不到则抛出错误
 * - 函数：包装安全夹值，防止返回非有限值或超出 [0,1] 范围
 *
 * @param ease - 用户传入的缓动参数
 * @returns 缓动函数
 * @throws 未知缓动名称时抛出 Error
 *
 * @internal
 */
const resolveEase = (ease: EasingInput): (t: number) => number => {
  if (typeof ease === 'function') {
    const fn = ease;
    return (t: number): number => {
      const v = fn(t);
      if (typeof v !== 'number' || !isFinite(v)) {
        // 降级为线性
        return t;
      }
      return clamp(v, 0, 1);
    };
  }

  const fn = easingRegistry.get(ease);
  if (!fn) {
    const available = [...easingRegistry.keys()].join(', ');
    throw new Error(`未知的缓动 "${ease}"。可用: ${available}`);
  }
  return fn;
};

// ─── 公开 API ───────────────────────────────────────────

/**
 * 注册自定义缓动函数。
 *
 * 注册后即可通过名称在任何动画配置中使用。
 * 同时在 GSAP 内部注册，确保一致性。
 *
 * @param name - 缓动名称（不可与内置名称重复）
 * @param fn - 缓动函数 `(t: number) => number`，t 范围 [0,1]，返回值范围 [0,1]
 *
 * @example
 * ```ts
 * registerEasing('myBounce', (t) => {
 *   return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
 * });
 *
 * animate(mesh, { to: { position: { x: 2 } }, ease: 'myBounce' }).play();
 * ```
 */
const registerEasing = (name: string, fn: (t: number) => number): void => {
  if (typeof name !== 'string' || !name) {
    throw new TypeError('缓动名称必须是非空字符串');
  }
  if (typeof fn !== 'function') {
    throw new TypeError('缓动必须是一个函数 (t: number) => number');
  }
  easingRegistry.set(name, fn);
  // 同时注册到 GSAP 内部，保持一致性
  gsap.registerEase(name, fn);
};

export { resolveEase, registerEasing };
