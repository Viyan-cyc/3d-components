/**
 * @module utils/object
 *
 * **Object 工具 (Object Utilities)**
 *
 * Deep-clone utility.
 * Handles plain objects, arrays, Dates, RegExps, Maps, Sets, ArrayBuffers,
 * TypedArrays, and circular references — without any runtime dependency.
 *
 * ### Usage
 *
 * **Namespace style:**
 * ```ts
 * import { Util } from '@cyc/3d-components';
 * const copy = Util.cloneDeep(original);
 * ```
 *
 * **Tree-shaking style:**
 * ```ts
 * import { cloneDeep } from '@cyc/3d-components/utils';
 * const copy = cloneDeep(original);
 * ```
 */

// ─── Type helpers ────────────────────────────────────────────────────────────

/** Primitive types that are cloned by simple return. */
type Primitive = null | undefined | boolean | number | string | bigint | symbol;

/** Deep-recursive clone type — preserves structure as closely as possible. */
export type CloneDeep<T> = T extends Primitive
  ? T
  : T extends Date
    ? Date
    : T extends RegExp
      ? RegExp
      : T extends Map<infer K, infer V>
        ? Map<CloneDeep<K>, CloneDeep<V>>
        : T extends Set<infer U>
          ? Set<CloneDeep<U>>
          : T extends ArrayBuffer
            ? ArrayBuffer
            : T extends DataView
              ? DataView
              : T extends ReadonlyArray<infer U>
                ? Array<CloneDeep<U>>
                : T extends object
                  ? { [K in keyof T]: CloneDeep<T[K]> }
                  : T;

// ─── Internal constants ──────────────────────────────────────────────────────

/** Object.prototype.toString used for reliable type tagging. */
const toString = Object.prototype.toString;

// ─── Clone helpers ───────────────────────────────────────────────────────────

/**
 * Create a new instance with the same constructor as `source`.
 * Falls back to `Object.create(Object.getPrototypeOf(source))` when
 * the constructor call with no arguments succeeds.
 */
function initCloneObject<T extends object>(source: T): T {
  const Ctor = source.constructor as new () => T;
  try {
    return new Ctor();
  } catch {
    return Object.create(Object.getPrototypeOf(source)) as T;
  }
}

/**
 * Clone an ArrayBuffer by copying its byte content.
 */
function cloneArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  const result = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(result).set(new Uint8Array(buffer));
  return result;
}

/**
 * Clone a DataView — shares the same underlying ArrayBuffer clone logic.
 */
function cloneDataView(dataView: DataView): DataView {
  const buffer = cloneArrayBuffer(dataView.buffer);
  return new DataView(buffer, dataView.byteOffset, dataView.byteLength);
}

/**
 * Clone any TypedArray (Int8Array, Float32Array, …).
 * Preserves the constructor type and copies element-by-element.
 */
function cloneTypedArray<T extends ArrayBufferView>(typedArray: T): T {
  const buffer = cloneArrayBuffer(typedArray.buffer);
  // Each TypedArray constructor: new XxxArray(buffer, byteOffset, length)
  const Ctor = typedArray.constructor as new (
    buffer: ArrayBuffer,
    byteOffset: number,
    length: number,
  ) => T;
  return new Ctor(buffer, typedArray.byteOffset, (typedArray as unknown as ArrayLike<unknown>).length);
}

/**
 * Clone a RegExp, preserving `source`, `flags`, and `lastIndex`.
 */
function cloneRegExp(regexp: RegExp): RegExp {
  const result = new RegExp(regexp.source, regexp.flags);
  result.lastIndex = regexp.lastIndex;
  return result;
}

/**
 * Clone a Date — new Date with the same timestamp.
 */
function cloneDate(date: Date): Date {
  return new Date(date.getTime());
}

// ─── Type tag checks ─────────────────────────────────────────────────────────

function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

const typedArrayTag = /^\[object (?:Int8|Uint8|Uint8Clamped|Int16|Uint16|Int32|Uint32|Float32|Float64|BigInt64|BigUint64)Array\]$/;

function isTypedArray(value: unknown): value is ArrayBufferView & { length: number } {
  return typedArrayTag.test(toString.call(value));
}

// ─── Core recursive clone ────────────────────────────────────────────────────

/**
 * Recursively deep-clone `value`, tracking circular references via `stack`.
 *
 * Two-phase clone:
 *   1. **init** — create an empty shell of the correct type
 *   2. **populate** — recursively fill the shell
 *
 * @param value  - The value to clone.
 * @param stack  - Map of source → clone to break circular cycles.
 */
function baseClone<T>(value: T, stack: Map<unknown, unknown>): CloneDeep<T> {
  // ── Primitives & functions ──────────────────────────────────────────────
  if (value === null || typeof value !== 'object') {
    return value as CloneDeep<T>;
  }

  // ── Circular reference guard ────────────────────────────────────────────
  const cached = stack.get(value);
  if (cached !== undefined) {
    return cached as CloneDeep<T>;
  }

  // ── Date ────────────────────────────────────────────────────────────────
  if (value instanceof Date) {
    return cloneDate(value) as CloneDeep<T>;
  }

  // ── RegExp ──────────────────────────────────────────────────────────────
  if (value instanceof RegExp) {
    return cloneRegExp(value) as CloneDeep<T>;
  }

  // ── Map ─────────────────────────────────────────────────────────────────
  if (value instanceof Map) {
    const result = new Map<unknown, unknown>();
    stack.set(value, result);
    value.forEach((v, k) => {
      result.set(baseClone(k, stack), baseClone(v, stack));
    });
    return result as CloneDeep<T>;
  }

  // ── Set ─────────────────────────────────────────────────────────────────
  if (value instanceof Set) {
    const result = new Set<unknown>();
    stack.set(value, result);
    value.forEach((v) => {
      result.add(baseClone(v, stack));
    });
    return result as CloneDeep<T>;
  }

  // ── ArrayBuffer ─────────────────────────────────────────────────────────
  if (value instanceof ArrayBuffer) {
    return cloneArrayBuffer(value) as CloneDeep<T>;
  }

  // ── DataView ────────────────────────────────────────────────────────────
  if (value instanceof DataView) {
    return cloneDataView(value) as CloneDeep<T>;
  }

  // ── TypedArray (Int8Array, Float32Array, …) ────────────────────────────
  if (isTypedArray(value)) {
    const result = cloneTypedArray(value);
    stack.set(value, result);
    return result as CloneDeep<T>;
  }

  // ── Array ───────────────────────────────────────────────────────────────
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    stack.set(value, result);
    for (let i = 0; i < value.length; i++) {
      result[i] = baseClone(value[i], stack);
    }
    return result as CloneDeep<T>;
  }

  // ── Plain object (or class instance) ────────────────────────────────────
  const result = initCloneObject(value as object);
  stack.set(value, result);

  // Copy own enumerable + string-keyed properties
  const keys = Object.keys(value as object);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as keyof typeof value;
    (result as Record<string, unknown>)[key as string] = baseClone(
      (value as object)[key],
      stack,
    );
  }

  // Copy symbol-keyed properties
  const symKeys = Object.getOwnPropertySymbols(value as object);
  for (let i = 0; i < symKeys.length; i++) {
    const sym = symKeys[i] as keyof typeof value;
    (result as Record<symbol, unknown>)[sym as symbol] = baseClone(
      (value as object)[sym],
      stack,
    );
  }

  return result as CloneDeep<T>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Recursively deep-clone a value.
 *
 * Supports: primitives, plain objects, arrays, class instances, `Date`,
 * `RegExp`, `Map`, `Set`, `ArrayBuffer`, `DataView`, all TypedArrays,
 * and circular references. Symbol-keyed properties are also cloned.
 *
 * Functions are returned as-is (same reference).
 *
 * @param value - The value to recursively clone.
 * @returns A deep copy of `value`.
 *
 * @example
 * ```ts
 * const original = { a: 1, b: { c: [2, 3] }, d: new Date() };
 * const copy = Util.cloneDeep(original);
 *
 * copy.b.c.push(4);
 * original.b.c; // → [2, 3]  (unaffected)
 * copy.d !== original.d;     // true (new Date instance)
 * ```
 *
 * @example
 * ```ts
 * // Circular references are handled safely
 * const obj: Record<string, unknown> = { name: 'root' };
 * obj.self = obj;
 * const copy = Util.cloneDeep(obj);
 * copy.self === copy;  // true  — cycle preserved in the clone
 * copy !== obj;        // true  — distinct object graph
 * ```
 */
export function cloneDeep<T>(value: T): CloneDeep<T> {
  return baseClone(value, new Map<unknown, unknown>());
}
