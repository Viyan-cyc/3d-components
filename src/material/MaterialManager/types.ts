import type * as THREE from 'three';
import type { AssetCache } from '../../loader/AssetCache';

/**
 * 支持的材质类型。某 key 首次创建时按此类型 `new`,后续换肤不可变更(否则引用不变无法保持)。
 */
export type MaterialType = 'standard' | 'basic' | 'physical' | 'phong' | 'lambert';

/**
 * 材质上的贴图槽位。apply 时按 duck-type(`'slot' in material`)守卫,basic 等无该槽位的材质自动跳过。
 */
export type TextureSlot =
  | 'map'
  | 'normalMap'
  | 'roughnessMap'
  | 'metalnessMap'
  | 'emissiveMap'
  | 'aoMap'
  | 'alphaMap';

/**
 * 回调触发原因:
 * - `init` —— 首次 copy/clone,材质刚创建(贴图可能未就绪);
 * - `theme` —— 换肤,同步属性已 直接更新(贴图异步中);
 * - `texture-ready` —— 该材质声明的所有贴图已加载并 直接赋值完成。
 */
export type ChangeReason = 'init' | 'theme' | 'texture-ready';

/**
 * 贴图描述符。MaterialManager 通过 {@link AssetCache.loadTextureFromUrl} 异步加载。
 *
 * `colorSpace/wrapS/wrapT/anisotropy/flipY` 作为 load options 传入(仅首次加载烘焙进缓存)。
 * `repeat/offset/rotation` 是 Texture 实例级变换,**仅 `clone(shareTexture=false)` 生效**;
 * `copy` 与 `clone(shareTexture=true)` 共享 Texture 实例,改这些会串扰所有引用,故被忽略并 `onError`。
 */
export interface TextureDescriptor {

  /** 贴图文件 URL。 */
  url: string;

  /** 颜色空间,颜色贴图通常 sRGB。 */
  colorSpace?: THREE.ColorSpace;

  /** S 方向包裹模式。 */
  wrapS?: THREE.Wrapping;

  /** T 方向包裹模式。 */
  wrapT?: THREE.Wrapping;

  /** 各向异性过滤等级。 */
  anisotropy?: number;

  /** 是否沿 Y 轴翻转。 */
  flipY?: boolean;

  /** UV 平铺重复,仅 shareTexture=false 生效。 */
  repeat?: [number, number];

  /** UV 偏移,仅 shareTexture=false 生效。 */
  offset?: [number, number];

  /** UV 旋转(弧度),仅 shareTexture=false 生效。 */
  rotation?: number;
}

/**
 * 材质配置。换肤时**只更新此处声明的属性**,未声明的属性保持不动(保留调用方追加的特有属性)。
 *
 * 贴图字段三态:`{ url }` = 加载赋值;`null` = 清空槽位;键缺失 = 不动。
 */
export interface MaterialConfig {

  /** 材质类型,按 key 固定,换肤不可变更。 */
  type: MaterialType;

  /** 漫反射颜色。 */
  color?: THREE.ColorRepresentation;

  /** 自发光颜色(standard/physical/phong/lambert)。 */
  emissive?: THREE.ColorRepresentation;

  /** 自发光强度。 */
  emissiveIntensity?: number;

  /** 粗糙度(standard/physical)。 */
  roughness?: number;

  /** 金属度(standard/physical)。 */
  metalness?: number;

  /** 不透明度。 */
  opacity?: number;

  /** 是否透明。 */
  transparent?: boolean;

  /** 渲染面。 */
  side?: THREE.Side;

  /** 漫反射贴图。`null` 显式清空。 */
  map?: TextureDescriptor | null;

  /** 法线贴图。`null` 显式清空。 */
  normalMap?: TextureDescriptor | null;

  /** 粗糙度贴图。`null` 显式清空。 */
  roughnessMap?: TextureDescriptor | null;

  /** 金属度贴图。`null` 显式清空。 */
  metalnessMap?: TextureDescriptor | null;

  /** 自发光贴图。`null` 显式清空。 */
  emissiveMap?: TextureDescriptor | null;

  /** 环境遮蔽贴图。`null` 显式清空。 */
  aoMap?: TextureDescriptor | null;

  /** 透明度遮罩贴图。`null` 显式清空。 */
  alphaMap?: TextureDescriptor | null;
}

/**
 * 风格模板:材质 key → 配置。
 */
export type Theme = Record<string, MaterialConfig>;

/**
 * 材质变化回调。引用始终不变(直接更新),调用方无需重新赋值 `mesh.material`。
 */
export type MaterialChangeCallback = (material: THREE.Material, reason: ChangeReason) => void;

/**
 * 取消订阅函数。copy 移除订阅(不释放共享实例);clone 释放独立材质与 owned 贴图。
 */
export type Unsubscriber = () => void;

/**
 * MaterialManager 构造选项。
 */
export interface MaterialManagerOptions {

  /** 风格模板集合:theme 名 → 材质配置表。 */
  themes: Record<string, Theme>;

  /** 初始 theme,默认第一个。 */
  current?: string;

  /** 注入的 AssetCache,用于贴图异步加载。未注入时仅支持纯配色 config。 */
  assetCache?: AssetCache;

  /** 错误回调(未知 key/theme、type 不一致、贴图加载失败、共享模式下误用 repeat 等)。 */
  onError?: (key: string, err: unknown) => void;

  /**
   * 占位颜色:带贴图材质在贴图未就绪时填充 color,避免闪白;贴图就绪后恢复 config color
   * (默认白)。无贴图材质不受影响。未设置时不占位(贴图未就绪时 color 保持 config 值)。
   */
  placeholderColor?: THREE.ColorRepresentation;
}

/**
 * 已加载的独立贴图(shareTexture=false 时由 manager 持有并 dispose)。
 */
export interface OwnedTexture {

  /** 独立贴图副本(由共享 Texture clone 而来)。 */
  texture: THREE.Texture;

  /** 来源 URL,用于换肤时同 url 复用判断。 */
  url: string;
}

/**
 * 订阅记录。copy 与 clone 统一结构;copy 的 `material` 指向共享实例,clone 的指向独立实例。
 */
export interface Subscription {

  /** 材质 key。 */
  key: string;

  /** 变化回调。 */
  callback: MaterialChangeCallback;

  /** 持有的材质实例(copy 共享 / clone 独立)。 */
  material: THREE.Material;

  /** 是否共享贴图。copy 固定 true;clone 由参数决定。 */
  shareTexture: boolean;

  /** 固定的材质类型。 */
  pinnedType: MaterialType;

  /** 是否已取消(用于异步竞态守卫)。 */
  disposed: boolean;

  /** shareTexture=false 时独立拥有的贴图(换肤/取消时释放)。 */
  ownedSlots: Map<TextureSlot, OwnedTexture>;
}

/**
 * copy 共享实例的运行时状态:仅持有共享材质实例。
 * 贴图加载去重由 AssetCache(按 url 缓存 promise)负责,此处不重复维护。
 */
export interface SharedInstanceState {

  /** 共享材质实例。 */
  material: THREE.Material;
}
