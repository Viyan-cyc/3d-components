/**
 * 属性解析器
 *
 * 将用户的 PropertyTarget（position/scale/rotation + 任意点路径）
 * 解析为扁平的代理对象和写入器闭包，用于驱动 GSAP tween。
 *
 * 核心模式：代理对象 + 写入器闭包
 * - GSAP 直接操作扁平代理对象的属性
 * - onUpdate 回调中将代理值写回真实 Three.js 对象
 *
 * @module animation/propertyResolver
 */

import * as THREE from 'three';
import type { PropertyTarget, Vec3Like } from './types';

// ─── 类型定义 ───────────────────────────────────────────

/** 属性解析结果 */
export interface ResolvedProperties {

  /** 扁平代理对象，GSAP 直接操作此对象 */
  proxy: Record<string, unknown>;

  /** GSAP tween 的目标属性（仅包含 to 值） */
  toVars: Record<string, unknown>;

  /** GSAP fromTo 的起始属性（仅包含 from 值），无 from 时为 null */
  fromVars: Record<string, unknown> | null;

  /** 写入器映射：代理键名 → 写回闭包 */
  writers: Map<string, (value: unknown) => void>;
}

/** 扁平化过程中的共享上下文 */
interface FlatContext {
  proxy: Record<string, unknown>;
  toVars: Record<string, unknown>;
  fromVars: Record<string, unknown>;
  writers: Map<string, (value: unknown) => void>;
}

// ─── 已知变换属性 ────────────────────────────────────────

const TRANSFORM_KEYS = new Set(['position', 'rotation', 'scale']);

// ─── 点路径解析 ─────────────────────────────────────────

/** 点路径解析结果 */
type DotPathResult = { parent: object; leafKey: string; value: unknown } | null;

/**
 * 沿点路径解析对象链。
 */
const resolveDotPath = (obj: object, path: string): DotPathResult => {
  const segments = path.split('.');
  let current: unknown = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    if (current === null || current === undefined || typeof current !== 'object') {
      // eslint-disable-next-line no-console
      console.warn(`[animation] 无法解析路径 "${path}"："${segments[i]}" 为 ${current}`);
      return null;
    }
    current = (current as Record<string, unknown>)[segments[i]];
  }

  if (current === null || current === undefined || typeof current !== 'object') {
    // eslint-disable-next-line no-console
    console.warn(`[animation] 无法解析路径 "${path}"：父对象为 null`);
    return null;
  }

  const leafKey = segments[segments.length - 1];
  return {
    parent: current,
    leafKey,
    value: (current as Record<string, unknown>)[leafKey],
  };
};

// ─── 值读取与写入 ───────────────────────────────────────

/**
 * 从 Three.js 对象读取当前属性值。
 */
const readCurrentValue = (target: THREE.Object3D, key: string): unknown => {
  if (TRANSFORM_KEYS.has(key)) {
    const vec = (target as unknown as Record<string, unknown>)[key];
    if (vec instanceof THREE.Vector3 || vec instanceof THREE.Euler) {
      return { x: vec.x, y: vec.y, z: vec.z };
    }
    return vec;
  }

  const resolved = resolveDotPath(target, key);
  if (!resolved) {
    return undefined;
  }

  const { parent, leafKey } = resolved;
  const value = (parent as Record<string, unknown>)[leafKey];

  if (value instanceof THREE.Color) {
    return `#${ value.getHexString()}`;
  }

  return value;
};

/**
 * 创建写入器闭包，将代理值写回真实 Three.js 对象。
 */
const createWriter = (target: THREE.Object3D, key: string): ((value: unknown) => void) | null => {
  if (TRANSFORM_KEYS.has(key)) {
    const vec = (target as unknown as Record<string, unknown>)[key];
    if (vec instanceof THREE.Vector3) {
      return (value: unknown) => {
        if (typeof value === 'number') {
          // 单轴写入时，只更新变化的轴
          // 但在代理模式下，我们按轴独立写入，见 createAxisWriter
        }
      };
    }
  }

  const resolved = resolveDotPath(target, key);
  if (!resolved) {
    return null;
  }

  const { parent, leafKey } = resolved;
  const currentValue = (parent as Record<string, unknown>)[leafKey];

  if (currentValue instanceof THREE.Color) {
    const color = currentValue;
    return (value: unknown) => {
      if (typeof value === 'string' || typeof value === 'number') {
        color.set(value);
      }
    };
  }

  if (typeof currentValue === 'number') {
    return (value: unknown) => {
      if (typeof value === 'number') {
        (parent as Record<string, number>)[leafKey] = value;
      }
    };
  }

  return (value: unknown) => {
    (parent as Record<string, unknown>)[leafKey] = value;
  };
};

/**
 * 为变换属性的某个轴创建写入器。
 */
const createAxisWriter = (
  target: THREE.Object3D,
  transformKey: string,
  axis: 'x' | 'y' | 'z',
): (value: unknown) => void => {
  const vec = (target as unknown as Record<string, unknown>)[transformKey];

  if (vec instanceof THREE.Vector3) {
    return (value: unknown) => {
      if (typeof value === 'number') {
        vec[axis] = value;
      }
    };
  }

  if (vec instanceof THREE.Euler) {
    return (value: unknown) => {
      if (typeof value === 'number') {
        vec[axis] = value;
      }
    };
  }

  return (value: unknown) => {
    if (typeof value === 'number' && vec !== null && vec !== undefined && typeof vec === 'object') {
      (vec as Record<string, unknown>)[axis] = value;
    }
  };
};

// ─── 扁平化辅助函数 ─────────────────────────────────────

/**
 * 读取变换属性的当前轴值。
 */
const readCurrentAxisValue = (target: THREE.Object3D, key: string, axis: 'x' | 'y' | 'z'): number => {
  const currentVec = readCurrentValue(target, key) as Vec3Like;
  const vecVal = currentVec?.[axis];
  if (vecVal !== undefined) {
    return vecVal;
  }
  const targetRec = target as unknown as Record<string, Record<string, unknown>>;
  const axisVal = targetRec[key]?.[axis];
  return axisVal === undefined ? 0 : (axisVal as number);
};

/**
 * 解析变换属性的轴值：fromVal 和 toVal。
 */
const resolveAxisValues = (
  fromAxisVal: number | undefined,
  toAxisVal: number | undefined,
  currentVal: number,
): { fromVal: number; toVal: number; hasFrom: boolean } => {
  const fromVal = fromAxisVal === undefined ? currentVal : fromAxisVal;
  let toVal: number;
  if (toAxisVal === undefined) {
    toVal = fromAxisVal === undefined ? currentVal : fromVal;
  } else {
    toVal = toAxisVal;
  }
  return { fromVal, toVal, hasFrom: fromAxisVal !== undefined };
};

/**
 * 解析点路径属性的值：fromVal 和 toVal。
 */
const resolveDotPathValues = (
  fromVal: unknown,
  toVal: unknown,
  currentVal: unknown,
): { resolvedFrom: unknown; resolvedTo: unknown; hasFrom: boolean } => {
  const resolvedFrom = fromVal === undefined ? currentVal : fromVal;
  let resolvedTo: unknown;
  if (toVal === undefined) {
    resolvedTo = fromVal === undefined ? currentVal : resolvedFrom;
  } else {
    resolvedTo = toVal;
  }
  return { resolvedFrom, resolvedTo, hasFrom: fromVal !== undefined };
};

/** 轴值对 */
interface AxisValuePair {
  toAxisVal: number | undefined;
  fromAxisVal: number | undefined;
}

/**
 * 处理单个轴条目，写入上下文并返回是否设置了 from。
 */
const processAxisEntry = (
  target: THREE.Object3D,
  key: string,
  axis: 'x' | 'y' | 'z',
  axisVals: AxisValuePair,
  ctx: FlatContext,
): boolean => {
  const { toAxisVal, fromAxisVal } = axisVals;
  if (toAxisVal === undefined && fromAxisVal === undefined) {
    return false;
  }

  const currentVal = readCurrentAxisValue(target, key, axis);
  const result = resolveAxisValues(fromAxisVal, toAxisVal, currentVal);
  const proxyKey = `${key}.${axis}`;

  ctx.proxy[proxyKey] = result.fromVal;
  ctx.toVars[proxyKey] = result.toVal;
  ctx.fromVars[proxyKey] = result.fromVal;
  ctx.writers.set(proxyKey, createAxisWriter(target, key, axis));

  return result.hasFrom;
};

/**
 * 处理变换属性（position/rotation/scale），展开为轴级代理。
 */
const processTransformAxes = (
  target: THREE.Object3D,
  key: string,
  toVec: Vec3Like | undefined,
  fromVec: Vec3Like | undefined,
  ctx: FlatContext,
): boolean => {
  let hasFrom = false;

  for (const axis of ['x', 'y', 'z'] as const) {
    const axisVals = { toAxisVal: toVec?.[axis], fromAxisVal: fromVec?.[axis] };
    const axisHasFrom = processAxisEntry(target, key, axis, axisVals, ctx);
    if (axisHasFrom) {
      hasFrom = true;
    }
  }

  return hasFrom;
};

/**
 * 处理点路径属性。
 */
const processDotPathProperty = (
  target: THREE.Object3D,
  key: string,
  toVal: unknown,
  fromVal: unknown,
  ctx: FlatContext,
): boolean => {
  if (toVal === undefined && fromVal === undefined) {
    return false;
  }

  const currentVal = readCurrentValue(target, key);
  const result = resolveDotPathValues(fromVal, toVal, currentVal);

  ctx.proxy[key] = result.resolvedFrom;
  ctx.toVars[key] = result.resolvedTo;
  ctx.fromVars[key] = result.resolvedFrom;

  const writer = createWriter(target, key);
  if (writer) {
    ctx.writers.set(key, writer);
  }

  return result.hasFrom;
};

/**
 * 收集 to 和 from 的所有键的并集。
 */
const collectAllKeys = (to?: PropertyTarget, from?: PropertyTarget): Set<string> => {
  const allKeys = new Set<string>();
  if (to) {
    Object.keys(to).forEach((k) => allKeys.add(k));
  }
  if (from) {
    Object.keys(from).forEach((k) => allKeys.add(k));
  }
  return allKeys;
};

// ─── 主解析函数 ─────────────────────────────────────────

/**
 * 将用户的 PropertyTarget 解析为扁平代理对象和写入器。
 *
 * @param target - Three.js 目标对象
 * @param to - 目标属性值
 * @param from - 起始属性值（可选，不传则从当前状态读取）
 * @returns 解析结果
 */
const flattenProperties = (
  target: THREE.Object3D,
  to?: PropertyTarget,
  from?: PropertyTarget,
): ResolvedProperties => {
  const ctx: FlatContext = {
    proxy: {},
    toVars: {},
    fromVars: {},
    writers: new Map(),
  };
  let hasFrom = false;

  if (!to && !from) {
    return {
      proxy: ctx.proxy,
      toVars: ctx.toVars,
      fromVars: null,
      writers: ctx.writers,
    };
  }

  const allKeys = collectAllKeys(to, from);

  for (const key of allKeys) {
    if (TRANSFORM_KEYS.has(key)) {
      const toVec = to?.[key] as Vec3Like | undefined;
      const fromVec = from?.[key] as Vec3Like | undefined;
      if (processTransformAxes(target, key, toVec, fromVec, ctx)) {
        hasFrom = true;
      }
    } else {
      if (processDotPathProperty(target, key, to?.[key], from?.[key], ctx)) {
        hasFrom = true;
      }
    }
  }

  return {
    proxy: ctx.proxy,
    toVars: ctx.toVars,
    fromVars: hasFrom ? ctx.fromVars : null,
    writers: ctx.writers,
  };
};

/**
 * 创建 onUpdate 回调：将代理值写回真实 Three.js 对象。
 */
const createWriteBackCallback = (
  proxy: Record<string, unknown>,
  writers: Map<string, (value: unknown) => void>,
): (() => void) => () => {
  for (const [key, writer] of writers) {
    writer(proxy[key]);
  }
};

export { flattenProperties, createWriteBackCallback };
