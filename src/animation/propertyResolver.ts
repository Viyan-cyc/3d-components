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

/** 扁平化后的属性条目 */
interface FlatProperty {
  /** 代理对象中的键名，如 'position.x'、'material.color' */
  key: string;
  /** 起始值（数值或颜色字符串） */
  fromValue: unknown;
  /** 目标值（数值或颜色字符串） */
  toValue: unknown;
  /** 将代理值写回真实 Three.js 对象的闭包 */
  writer: (value: unknown) => void;
}

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

// ─── 已知变换属性 ────────────────────────────────────────

const TRANSFORM_KEYS = new Set(['position', 'rotation', 'scale']);
const AXIS_KEYS = new Set(['x', 'y', 'z']);

// ─── 点路径解析 ─────────────────────────────────────────

/**
 * 沿点路径解析对象链。
 *
 * @param obj - 起始对象
 * @param path - 点路径，如 'material.color'、'material.uniforms.uProgress.value'
 * @returns 解析结果，路径不存在时返回 null
 */
function resolveDotPath(
  obj: object,
  path: string,
): { parent: object; leafKey: string; value: unknown } | null {
  const segments = path.split('.');
  let current: unknown = obj;

  for (let i = 0; i < segments.length - 1; i++) {
    if (current == null || typeof current !== 'object') {
      console.warn(`[animation] 无法解析路径 "${path}"："${segments[i]}" 为 ${current}`);
      return null;
    }
    current = (current as Record<string, unknown>)[segments[i]];
  }

  if (current == null || typeof current !== 'object') {
    console.warn(`[animation] 无法解析路径 "${path}"：父对象为 null`);
    return null;
  }

  const leafKey = segments[segments.length - 1];
  return {
    parent: current as Record<string, unknown>,
    leafKey,
    value: (current as Record<string, unknown>)[leafKey],
  };
}

// ─── 值读取与写入 ───────────────────────────────────────

/**
 * 从 Three.js 对象读取当前属性值。
 *
 * 对于 Color 属性，返回十六进制字符串（如 '#ff0000'）。
 * 对于数值属性，直接返回数值。
 */
function readCurrentValue(target: THREE.Object3D, key: string): unknown {
  // 变换属性
  if (TRANSFORM_KEYS.has(key)) {
    const vec = (target as unknown as Record<string, unknown>)[key];
    if (vec instanceof THREE.Vector3 || vec instanceof THREE.Euler) {
      return { x: vec.x, y: vec.y, z: vec.z };
    }
    return vec;
  }

  // 点路径
  const resolved = resolveDotPath(target, key);
  if (!resolved) return undefined;

  const { parent, leafKey } = resolved;
  const value = (parent as Record<string, unknown>)[leafKey];

  // THREE.Color → 十六进制字符串
  if (value instanceof THREE.Color) {
    return '#' + value.getHexString();
  }

  return value;
}

/**
 * 创建写入器闭包，将代理值写回真实 Three.js 对象。
 */
function createWriter(target: THREE.Object3D, key: string): ((value: unknown) => void) | null {
  // 变换属性写入器
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
    // Euler 的情况在 createAxisWriter 中处理
  }

  // 点路径写入器
  const resolved = resolveDotPath(target, key);
  if (!resolved) return null;

  const { parent, leafKey } = resolved;
  const currentValue = (parent as Record<string, unknown>)[leafKey];

  // THREE.Color → 使用 .set()
  if (currentValue instanceof THREE.Color) {
    const color = currentValue;
    return (value: unknown) => {
      if (typeof value === 'string' || typeof value === 'number') {
        color.set(value as string | number);
      }
    };
  }

  // 普通数值属性 → 直接赋值
  if (typeof currentValue === 'number') {
    return (value: unknown) => {
      if (typeof value === 'number') {
        (parent as Record<string, number>)[leafKey] = value;
      }
    };
  }

  // 其他类型 → 直接赋值（尽力而为）
  return (value: unknown) => {
    (parent as Record<string, unknown>)[leafKey] = value;
  };
}

/**
 * 为变换属性的某个轴创建写入器。
 */
function createAxisWriter(
  target: THREE.Object3D,
  transformKey: string,
  axis: 'x' | 'y' | 'z',
): (value: unknown) => void {
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

  // 降级：直接赋值
  return (value: unknown) => {
    if (typeof value === 'number' && vec != null && typeof vec === 'object') {
      (vec as Record<string, unknown>)[axis] = value;
    }
  };
}

// ─── 主解析函数 ─────────────────────────────────────────

/**
 * 将用户的 PropertyTarget 解析为扁平代理对象和写入器。
 *
 * 处理流程：
 * 1. 遍历 PropertyTarget 的所有键
 * 2. 对变换属性（position/rotation/scale），展开为轴级代理（如 'position.x'）
 * 3. 对点路径属性，直接创建代理键
 * 4. 读取当前值作为 from，使用用户指定的 to
 * 5. 创建写入器闭包
 *
 * @param target - Three.js 目标对象
 * @param to - 目标属性值
 * @param from - 起始属性值（可选，不传则从当前状态读取）
 * @returns 解析结果
 */
export function flattenProperties(
  target: THREE.Object3D,
  to?: PropertyTarget,
  from?: PropertyTarget,
): ResolvedProperties {
  const proxy: Record<string, unknown> = {};
  const toVars: Record<string, unknown> = {};
  const fromVars: Record<string, unknown> = {};
  const writers: Map<string, (value: unknown) => void> = new Map();
  let hasFrom = false;

  if (!to && !from) {
    return { proxy, toVars, fromVars: null, writers };
  }

  // 收集所有需要处理的键（to 和 from 的并集）
  const allKeys = new Set<string>();
  if (to) Object.keys(to).forEach((k) => allKeys.add(k));
  if (from) Object.keys(from).forEach((k) => allKeys.add(k));

  for (const key of allKeys) {
    // 变换属性：展开为轴级代理
    if (TRANSFORM_KEYS.has(key)) {
      const toVec = to?.[key] as Vec3Like | undefined;
      const fromVec = from?.[key] as Vec3Like | undefined;

      // 读取当前值
      const currentVec = readCurrentValue(target, key) as Vec3Like;

      for (const axis of ['x', 'y', 'z'] as const) {
        const proxyKey = `${key}.${axis}`;
        const toAxisVal = toVec?.[axis];
        const fromAxisVal = fromVec?.[axis];

        // 仅处理在 to 或 from 中指定的轴
        if (toAxisVal === undefined && fromAxisVal === undefined) continue;

        // 当前值
        const currentVal = currentVec?.[axis] ?? ((target as unknown as Record<string, Record<string, unknown>>)[key])?.[axis] ?? 0;

        // from 值：优先使用用户指定的 from，否则从当前状态读取
        const fromVal = fromAxisVal !== undefined ? fromAxisVal : currentVal;
        // to 值：优先使用用户指定的 to，如果只有 from 则 to 为当前值
        const toVal = toAxisVal !== undefined ? toAxisVal : (fromAxisVal !== undefined ? currentVal : fromVal);

        proxy[proxyKey] = fromVal;
        toVars[proxyKey] = toVal;
        fromVars[proxyKey] = fromVal;

        if (fromAxisVal !== undefined) hasFrom = true;

        writers.set(proxyKey, createAxisWriter(target, key, axis));
      }
      continue;
    }

    // 点路径属性
    const toVal = to?.[key];
    const fromVal = from?.[key];

    if (toVal === undefined && fromVal === undefined) continue;

    // 读取当前值
    const currentVal = readCurrentValue(target, key);

    // from 值：优先使用用户指定的 from，否则从当前状态读取
    const resolvedFromVal = fromVal !== undefined ? fromVal : currentVal;
    // to 值：优先使用用户指定的 to，如果只有 from 则 to 为当前值
    const resolvedToVal = toVal !== undefined ? toVal : (fromVal !== undefined ? currentVal : resolvedFromVal);

    proxy[key] = resolvedFromVal;
    toVars[key] = resolvedToVal;
    fromVars[key] = resolvedFromVal;

    if (fromVal !== undefined) hasFrom = true;

    const writer = createWriter(target, key);
    if (writer) {
      writers.set(key, writer);
    }
  }

  return {
    proxy,
    toVars,
    fromVars: hasFrom ? fromVars : null,
    writers,
  };
}

/**
 * 创建 onUpdate 回调：将代理值写回真实 Three.js 对象。
 *
 * @param proxy - 代理对象
 * @param writers - 写入器映射
 * @returns onUpdate 回调函数
 */
export function createWriteBackCallback(
  proxy: Record<string, unknown>,
  writers: Map<string, (value: unknown) => void>,
): () => void {
  return () => {
    for (const [key, writer] of writers) {
      writer(proxy[key]);
    }
  };
}
