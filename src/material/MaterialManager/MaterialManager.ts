/**
 * @module material/MaterialManager
 *
 * 材质管理器 —— 按风格模板(dark/light/outdoor)管理材质配置,一键换肤。
 *
 * 职责:
 * - 持有多套 theme(每套是 `key → MaterialConfig`),`setTheme` 切换当前模板。
 * - `copy(key, cb)` 返回**共享工作实例**:多次 copy 同 key 共享同一 material,换肤时直接
 *   改写该实例属性,所有持有方自动生效,引用始终不变。
 * - `clone(key, cb, shareTexture)` 返回**独立实例**:shareTexture=false 时连贴图一起独立
 *   (可各自改 repeat/offset),换肤时同样直接改写,引用不变。
 * - 材质自带的贴图通过注入的 {@link AssetCache} 异步加载;贴图就绪、换肤时通过回调通知。
 * - 可选 `placeholderColor`:带贴图材质在贴图未就绪时填占位色,避免闪白;就绪后恢复 config color。
 *
 * 核心不变式:
 * - **引用不变**:换肤时直接改原材质对象的属性,不创建新对象。引用始终不变,
 *   初始 `mesh.material = m` 一次即可,后续换肤自动生效,无需重新赋值或 dispose。
 * - **类型固定**:同一 key 首次的材质类型被固定;新 theme 若声明不同类型 → onError + 跳过
 *   (不重建,否则引用会变)。同 key 在各 theme 中应保持类型一致。
 * - **只更新 config 声明的属性**:未声明的属性保持不动,保留调用方追加的特有属性。
 * - **共享贴图不可独立变换**:`copy` 与 `clone(shareTexture=true)` 共用同一 Texture,
 *   `repeat/offset/rotation` 改一处会牵连所有引用,故忽略并 onError;需独立变换用 `clone(false)`。
 * - **贴图三种写法**:`{ url }` 加载赋值;`null` 清空;不写则不动(保留手动设的贴图)。
 *
 * 所有权:共享贴图归 AssetCache(不 dispose);shareTexture=false 的 owned 贴图副本归本管理器
 * (换肤/取消时释放);所有 material 实例由本管理器释放。调用方零 dispose 负担。
 *
 * Implements {@link IDisposable}.
 */

import type * as THREE from 'three';
import type { AssetCache } from '../../loader/AssetCache';
import type { IDisposable } from '../../types';
import type {
  MaterialChangeCallback,
  MaterialConfig,
  MaterialManagerOptions,
  MaterialType,
  SharedInstanceState,
  Subscription,
  TextureDescriptor,
  TextureSlot,
  Theme,
  Unsubscriber,
} from './types';
import {
  applySyncProps,
  applyTextureLoadOpts,
  applyTextureTransform,
  assignTextureSlot,
  createMaterial,
  DEFAULT_COLOR,
  disposeOwnedTextures,
  getDeclaredSlots,
  hasSlot,
  hasTextureDescriptors,
  hasTextureTransform,
  setColor,
  texturesReady,
  toLoadOpts,
} from './materialFactory';

/** 默认错误回调:静默(建议用户传入 onError 以观测错误)。 */
const defaultOnError = (): void => {};

/** 空取消订阅函数。 */
const noop = (): void => {};

/** 取 Record 的第一个 key(空则空串)。 */
const firstThemeName = (themes: Record<string, Theme>): string =>
  Object.keys(themes)[0] ?? '';

/** Theme(Record)→ Map,便于按 key 查询。 */
const toThemeMap = (theme: Theme): Map<string, MaterialConfig> => {
  const map = new Map<string, MaterialConfig>();
  for (const [key, cfg] of Object.entries(theme)) {
    map.set(key, cfg);
  }
  return map;
};

export class MaterialManager implements IDisposable {
  private readonly themes = new Map<string, Map<string, MaterialConfig>>();
  private readonly sharedInstances = new Map<string, SharedInstanceState>();
  private readonly subscribers = new Map<string, Set<Subscription>>();
  private readonly pinnedTypes = new Map<string, MaterialType>();
  private readonly assetCache: AssetCache | null;
  private readonly onError: (key: string, err: unknown) => void;
  private placeholderColor: THREE.ColorRepresentation | null;
  private currentTheme: string;
  private themeEpoch = 0;
  private disposed = false;

  /**
   * @param options - 见 {@link MaterialManagerOptions}。
   */
  constructor(options: MaterialManagerOptions) {
    this.assetCache = options.assetCache ?? null;
    this.onError = options.onError ?? defaultOnError;
    this.placeholderColor = options.placeholderColor ?? null;
    for (const [name, theme] of Object.entries(options.themes)) {
      this.themes.set(name, toThemeMap(theme));
    }
    const initial = options.current ?? firstThemeName(options.themes);
    this.currentTheme = this.themes.has(initial)
      ? initial
      : firstThemeName(options.themes);
    if (!this.themes.has(initial)) {
      this.emitError('*', `初始 theme "${initial}" 不存在,fallback 到第一个`);
    }
  }

  // ────────────── public API ──────────────

  /**
   * 获取共享材质实例。多次 copy 同 key 返回同一实例;换肤时 直接改写,引用不变。
   * @param key - 材质 key(当前 theme 中定义)。
   * @param callback - 材质变化回调(init / theme / texture-ready),引用始终不变。
   * @returns 取消订阅函数。
   */
  copy(key: string, callback: MaterialChangeCallback): Unsubscriber {
    const cfg = this.resolveConfig(key);
    if (!cfg) {
      return noop;
    }
    const state = this.getOrCreateShared(key, cfg);
    const sub = this.createSubscription(key, callback, state.material, true, cfg.type);
    this.addSubscriber(key, sub);
    this.applyPlaceholderColor(state.material, cfg, false);
    callback(state.material, 'init');
    void this.applySharedTextures(cfg, sub, this.themeEpoch);
    return () => this.release(sub);
  }

  /**
   * 克隆独立材质实例。shareTexture=false 时连贴图一起独立(可各自改 repeat)。
   * 换肤时 直接改写该实例,引用不变。
   * @param key - 材质 key。
   * @param callback - 材质变化回调。
   * @param shareTexture - 是否共享贴图。`true`(默认)共享 Texture 引用;`false` clone 独立贴图副本。
   * @returns 取消订阅函数。
   */
  clone(key: string, callback: MaterialChangeCallback, shareTexture = true): Unsubscriber {
    const cfg = this.resolveConfig(key);
    if (!cfg) {
      return noop;
    }
    const material = createMaterial(cfg.type);
    applySyncProps(material, cfg);
    const sub = this.createSubscription(key, callback, material, shareTexture, cfg.type);
    this.addSubscriber(key, sub);
    this.applyPlaceholderColor(material, cfg, false);
    callback(material, 'init');
    const p = shareTexture
      ? this.applySharedTextures(cfg, sub, this.themeEpoch)
      : this.applyOwnedTextures(cfg, sub, this.themeEpoch);
    void p;
    return () => this.release(sub);
  }

  /**
   * 切换当前 theme,对所有订阅 直接改写。返回 Promise 在所有受影响贴图就绪后 resolve
   * (单贴图失败走 onError,不阻塞整体)。
   */
  async setTheme(name: string): Promise<void> {
    if (!this.themes.has(name)) {
      this.emitError('*', `未知 theme: "${name}"`);
      return;
    }
    this.currentTheme = name;
    this.themeEpoch += 1;
    const captured = this.themeEpoch;
    const loads: Promise<void>[] = [];
    this.collectThemeLoads(name, captured, loads);
    await Promise.allSettled(loads);
  }

  /** 当前 theme 名。 */
  getTheme(): string {
    return this.currentTheme;
  }

  /** 运行时修改占位色。仅影响后续贴图未就绪时的占位;已就绪材质不变。 */
  setPlaceholderColor(color: THREE.ColorRepresentation | null): void {
    this.placeholderColor = color;
  }

  /** 释放所有材质与 owned 贴图(共享贴图归 AssetCache,不释放)。调用后实例不可用。 */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.disposeSubscribers();
    for (const state of this.sharedInstances.values()) {
      state.material.dispose();
    }
    this.subscribers.clear();
    this.sharedInstances.clear();
    this.pinnedTypes.clear();
  }

  // ────────────── 内部:订阅与配置解析 ──────────────

  /** 当前 theme 的某 key 配置。 */
  private getConfig(key: string): MaterialConfig | undefined {
    return this.themes.get(this.currentTheme)?.get(key);
  }

  /** 解析配置 + 校验 type 固定;失败 emitError 并返回 null。 */
  private resolveConfig(key: string): MaterialConfig | null {
    const cfg = this.getConfig(key);
    if (!cfg) {
      this.emitError(key, `未知材质 key: "${key}"`);
      return null;
    }
    if (!this.checkPinnedType(key, cfg.type)) {
      return null;
    }
    return cfg;
  }

  /** 校验/固定 type。首次记录;不一致 emitError 返回 false。 */
  private checkPinnedType(key: string, type: MaterialType): boolean {
    const pinned = this.pinnedTypes.get(key);
    if (pinned === undefined) {
      this.pinnedTypes.set(key, type);
      return true;
    }
    if (pinned !== type) {
      this.emitError(key, `材质类型不一致(已钉为 ${pinned},传入 ${type}),跳过`);
      return false;
    }
    return true;
  }

  /** 构造订阅对象。 */
  private createSubscription(
    key: string,
    callback: MaterialChangeCallback,
    material: THREE.Material,
    shareTexture: boolean,
    pinnedType: MaterialType,
  ): Subscription {
    return {
      key,
      callback,
      material,
      shareTexture,
      pinnedType,
      disposed: false,
      ownedSlots: new Map(),
    };
  }

  /** lazy 创建/复用 copy 共享实例。 */
  private getOrCreateShared(key: string, cfg: MaterialConfig): SharedInstanceState {
    let state = this.sharedInstances.get(key);
    if (!state) {
      const material = createMaterial(cfg.type);
      applySyncProps(material, cfg);
      state = { material };
      this.sharedInstances.set(key, state);
    }
    return state;
  }

  /** 注册订阅。 */
  private addSubscriber(key: string, sub: Subscription): void {
    let set = this.subscribers.get(key);
    if (!set) {
      set = new Set();
      this.subscribers.set(key, set);
    }
    set.add(sub);
  }

  /** 取消订阅:clone 释放独立材质 + owned;copy 共享实例 keep-alive 到 dispose。 */
  private release(sub: Subscription): void {
    sub.disposed = true;
    const subs = this.subscribers.get(sub.key);
    if (subs) {
      subs.delete(sub);
    }
    if (!this.isSharedInstance(sub.material)) {
      disposeOwnedTextures(sub.ownedSlots);
      sub.material.dispose();
    }
  }

  /** 是否 copy 共享实例。 */
  private isSharedInstance(material: THREE.Material): boolean {
    for (const state of this.sharedInstances.values()) {
      if (state.material === material) {
        return true;
      }
    }
    return false;
  }

  // ────────────── 内部:换肤编排 ──────────────

  /** 收集 setTheme 触发的所有贴图加载 promise。 */
  private collectThemeLoads(name: string, captured: number, loads: Promise<void>[]): void {
    for (const [key, subs] of this.subscribers) {
      const cfg = this.themes.get(name)?.get(key);
      if (cfg && this.checkPinnedType(key, cfg.type)) {
        this.applyThemeToSubs(cfg, subs, captured, loads);
      }
    }
  }

  /** 对某 key 的所有活跃订阅应用新 theme。 */
  private applyThemeToSubs(
    cfg: MaterialConfig,
    subs: Set<Subscription>,
    captured: number,
    loads: Promise<void>[],
  ): void {
    for (const sub of subs) {
      if (!sub.disposed) {
        applySyncProps(sub.material, cfg);
        this.applyPlaceholderColor(sub.material, cfg, false, true);
        sub.callback(sub.material, 'theme');
        const p = sub.shareTexture
          ? this.applySharedTextures(cfg, sub, captured)
          : this.applyOwnedTextures(cfg, sub, captured);
        loads.push(p);
      }
    }
  }

  // ────────────── 内部:贴图应用 ──────────────

  /** 共享贴图路径(copy 与 clone shareTexture=true):加载共享 Texture 赋到槽位。 */
  private applySharedTextures(
    cfg: MaterialConfig,
    sub: Subscription,
    capturedEpoch: number,
  ): Promise<void> {
    const slots = getDeclaredSlots(cfg);
    const loads: Promise<void>[] = [];
    for (const { slot, desc } of slots) {
      if (desc === null) {
        assignTextureSlot(sub.material, slot, null);
      } else {
        if (hasTextureTransform(desc)) {
          this.emitError(sub.key, `槽位 ${slot} 的 repeat/offset/rotation 需 clone(shareTexture=false),已忽略`);
        }
        loads.push(this.loadSharedSlot(sub, slot, desc, capturedEpoch));
      }
    }
    return this.awaitAndNotify(loads, sub, capturedEpoch, cfg);
  }

  /** owned 贴图路径(clone shareTexture=false):clone 独立副本,同 url 复用只重设 transform。 */
  private applyOwnedTextures(
    cfg: MaterialConfig,
    sub: Subscription,
    capturedEpoch: number,
  ): Promise<void> {
    const slots = getDeclaredSlots(cfg);
    const loads: Promise<void>[] = [];
    for (const { slot, desc } of slots) {
      if (desc === null) {
        this.clearOwnedSlot(sub, slot);
      } else {
        loads.push(this.loadOwnedSlot(sub, slot, desc, capturedEpoch));
      }
    }
    return this.awaitAndNotify(loads, sub, capturedEpoch, cfg);
  }

  /** 清空 owned 槽位:释放 owned 贴图 + 清材质槽位。 */
  private clearOwnedSlot(sub: Subscription, slot: TextureSlot): void {
    const owned = sub.ownedSlots.get(slot);
    if (owned) {
      owned.texture.dispose();
      sub.ownedSlots.delete(slot);
    }
    assignTextureSlot(sub.material, slot, null);
  }

  /** 加载单个共享贴图并赋到槽位(竞态/失败安全)。 */
  private async loadSharedSlot(
    sub: Subscription,
    slot: TextureSlot,
    desc: TextureDescriptor,
    capturedEpoch: number,
  ): Promise<void> {
    if (!this.assetCache) {
      this.emitError(sub.key, `槽位 ${slot} 需贴图但未注入 assetCache,已跳过`);
      return;
    }
    try {
      const texture = await this.assetCache.loadTextureFromUrl(desc.url, toLoadOpts(desc));
      if (this.isStale(sub, capturedEpoch)) {
        return;
      }
      if (hasSlot(sub.material, slot)) {
        assignTextureSlot(sub.material, slot, texture);
      }
    } catch (err) {
      this.onError(sub.key, err);
    }
  }

  /** 加载单个 owned 贴图:同 url 复用只重设 transform,否则 clone 独立副本。 */
  private async loadOwnedSlot(
    sub: Subscription,
    slot: TextureSlot,
    desc: TextureDescriptor,
    capturedEpoch: number,
  ): Promise<void> {
    if (!this.assetCache) {
      this.emitError(sub.key, `槽位 ${slot} 需贴图但未注入 assetCache,已跳过`);
      return;
    }
    const existing = sub.ownedSlots.get(slot);
    if (existing && existing.url === desc.url) {
      applyTextureTransform(existing.texture, desc);
      if (!this.isStale(sub, capturedEpoch) && hasSlot(sub.material, slot)) {
        assignTextureSlot(sub.material, slot, existing.texture);
      }
      return;
    }
    try {
      const shared = await this.assetCache.loadTextureFromUrl(desc.url, toLoadOpts(desc));
      if (this.isStale(sub, capturedEpoch)) {
        return;
      }
      const owned = shared.clone();
      owned.needsUpdate = true;
      applyTextureLoadOpts(owned, desc);
      applyTextureTransform(owned, desc);
      if (existing) {
        existing.texture.dispose();
      }
      sub.ownedSlots.set(slot, { texture: owned, url: desc.url });
      if (hasSlot(sub.material, slot)) {
        assignTextureSlot(sub.material, slot, owned);
      }
    } catch (err) {
      this.onError(sub.key, err);
    }
  }

  /** 等待所有贴图加载后触发 texture-ready(无贴图则不触发),并恢复 color。 */
  private awaitAndNotify(
    loads: Promise<void>[],
    sub: Subscription,
    capturedEpoch: number,
    cfg: MaterialConfig,
  ): Promise<void> {
    if (loads.length === 0) {
      return Promise.resolve();
    }
    return Promise.all(loads).then(() => {
      if (this.isStale(sub, capturedEpoch)) {
        return;
      }
      this.applyPlaceholderColor(sub.material, cfg, true);
      sub.callback(sub.material, 'texture-ready');
    });
  }

  /** 占位颜色:带贴图材质贴图未就绪时填占位色,就绪后恢复 config color(默认白)。无贴图材质不动。 */
  private applyPlaceholderColor(material: THREE.Material, cfg: MaterialConfig, ready: boolean, force = false): void {
    if (this.placeholderColor === null) {
      return;
    }
    if (!hasTextureDescriptors(cfg)) {
      return;
    }
    if (ready) {
      setColor(material, cfg.color ?? DEFAULT_COLOR);
    } else if (force || !texturesReady(material, cfg)) {
      setColor(material, this.placeholderColor);
    }
  }

  // ────────────── 内部:工具 ──────────────

  /** 异步闭包是否已过期(disposed / 换肤 / 取消订阅)。 */
  private isStale(sub: Subscription, capturedEpoch: number): boolean {
    return this.disposed || sub.disposed || capturedEpoch !== this.themeEpoch;
  }

  /** dispose 时释放所有订阅的独立材质与 owned 贴图。 */
  private disposeSubscribers(): void {
    for (const subs of this.subscribers.values()) {
      for (const sub of subs) {
        sub.disposed = true;
        if (!this.isSharedInstance(sub.material)) {
          disposeOwnedTextures(sub.ownedSlots);
          sub.material.dispose();
        }
      }
    }
  }

  /** 触发错误回调。 */
  private emitError(key: string, message: string): void {
    this.onError(key, new Error(message));
  }
}
