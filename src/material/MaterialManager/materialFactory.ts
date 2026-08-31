import * as THREE from 'three';
import type { TextureLoadOptions } from '../../loader/AssetCache';
import type {
  MaterialConfig,
  MaterialType,
  OwnedTexture,
  TextureDescriptor,
  TextureSlot,
} from './types';

/**
 * 材质工厂 —— 纯同步操作,无 AssetCache、无异步。
 *
 * 负责:按类型创建材质、直接应用同步属性、贴图槽位读写、owned 贴图释放、贴图变换应用。
 * 所有材质属性的写入都用 duck-type(`'prop' in material`)守卫,basic 等无该属性的材质自动跳过。
 */

/** MaterialType → 构造器。 */
const MATERIAL_FACTORIES: Record<MaterialType, () => THREE.Material> = {
  standard: () => new THREE.MeshStandardMaterial(),
  basic: () => new THREE.MeshBasicMaterial(),
  physical: () => new THREE.MeshPhysicalMaterial(),
  phong: () => new THREE.MeshPhongMaterial(),
  lambert: () => new THREE.MeshLambertMaterial(),
};

/** 按类型创建空材质实例。 */
export const createMaterial = (type: MaterialType): THREE.Material => MATERIAL_FACTORIES[type]();

/**
 * 扩展属性写入（颜色/标量/布尔/枚举）：duck-type 'in' 守卫 + Record 直赋。
 * 基类属性（depthTest/depthWrite/blending/fog/toneMapped）对所有材质 'in' 恒真；
 * 类型专属属性缺该 prop 时自动跳过。颜色用 .set() 保引用不变。
 */
const applyExtendedProps = (material: THREE.Material, config: MaterialConfig): void => {
  const anyMat = material as unknown as Record<string, unknown>;
  const cfg = config as unknown as Record<string, unknown>;
  // 颜色（新 Color 字段；.set 保引用）
  const colorKeys = ['specular'];
  for (const k of colorKeys) {
    if (cfg[k] !== undefined && k in material) {
      (anyMat[k] as THREE.Color).set(cfg[k] as THREE.ColorRepresentation);
    }
  }
  // 标量/布尔/枚举（直赋；'in' 守卫保证该 prop 存在）
  const directKeys = [
    'shininess', 'sheenRoughness', 'iridescence', 'iridescenceIOR',
    'anisotropy', 'anisotropyRotation', 'size',
    'depthTest', 'depthWrite', 'blending', 'fog', 'toneMapped',
    'wireframe', 'flatShading', 'sizeAttenuation',
  ];
  for (const k of directKeys) {
    if (cfg[k] !== undefined && k in material) {
      anyMat[k] = cfg[k];
    }
  }
};

/**
 * 直接应用 config 中的同步(非贴图)属性。只写 config 声明的字段,其余不动。
 * `color`/`emissive` 是 Color 对象,用 `.set()` 而非重新赋值,保住引用不变。
 */
export const applySyncProps = (material: THREE.Material, config: MaterialConfig): void => {
  const m = material as THREE.MeshStandardMaterial;

  if (config.color !== undefined && 'color' in material) {
    m.color.set(config.color);
  }
  if (config.emissive !== undefined && 'emissive' in material) {
    m.emissive.set(config.emissive);
  }
  if (config.emissiveIntensity !== undefined && 'emissiveIntensity' in material) {
    m.emissiveIntensity = config.emissiveIntensity;
  }
  if (config.roughness !== undefined && 'roughness' in material) {
    m.roughness = config.roughness;
  }
  if (config.metalness !== undefined && 'metalness' in material) {
    m.metalness = config.metalness;
  }
  if (config.transmission !== undefined && 'transmission' in material) {
    (material as THREE.MeshPhysicalMaterial).transmission = config.transmission;
  }
  if (config.ior !== undefined && 'ior' in material) {
    (material as THREE.MeshPhysicalMaterial).ior = config.ior;
  }
  if (config.thickness !== undefined && 'thickness' in material) {
    (material as THREE.MeshPhysicalMaterial).thickness = config.thickness;
  }
  if (config.clearcoat !== undefined && 'clearcoat' in material) {
    (material as THREE.MeshPhysicalMaterial).clearcoat = config.clearcoat;
  }
  if (config.clearcoatRoughness !== undefined && 'clearcoatRoughness' in material) {
    (material as THREE.MeshPhysicalMaterial).clearcoatRoughness = config.clearcoatRoughness;
  }
  if (config.sheen !== undefined && 'sheen' in material) {
    (material as THREE.MeshPhysicalMaterial).sheen = config.sheen;
  }
  if (config.sheenColor !== undefined && 'sheenColor' in material) {
    (material as THREE.MeshPhysicalMaterial).sheenColor.set(config.sheenColor);
  }
  if (config.opacity !== undefined) {
    material.opacity = config.opacity;
  }
  if (config.transparent !== undefined) {
    material.transparent = config.transparent;
  }
  if (config.side !== undefined) {
    material.side = config.side;
  }
  applyExtendedProps(material, config);
  // 任何同步属性改动都需重编译（flatShading/wireframe 换 shader；其余幂等）
  material.needsUpdate = true;
};

/** 该材质是否具备某贴图槽位。 */
export const hasSlot = (material: THREE.Material, slot: TextureSlot): boolean =>
  slot in material;

/** 把贴图赋到槽位并标记 needsUpdate。传 null 清空槽位。 */
export const assignTextureSlot = (
  material: THREE.Material,
  slot: TextureSlot,
  texture: THREE.Texture | null,
): void => {
  (material as unknown as Record<string, THREE.Texture | null>)[slot] = texture;
  material.needsUpdate = true;
};

/** 读取槽位当前贴图,非 Texture 返回 null。 */
export const readSlotTexture = (
  material: THREE.Material,
  slot: TextureSlot,
): THREE.Texture | null => {
  const value = (material as unknown as Record<string, unknown>)[slot];
  return value instanceof THREE.Texture ? value : null;
};

/** 对 owned 贴图应用 repeat/offset/rotation 变换(仅 shareTexture=false 调用)。 */
export const applyTextureTransform = (texture: THREE.Texture, desc: TextureDescriptor): void => {
  if (desc.repeat) {
    texture.repeat.set(desc.repeat[0], desc.repeat[1]);
  }
  if (desc.offset) {
    texture.offset.set(desc.offset[0], desc.offset[1]);
  }
  if (desc.rotation !== undefined) {
    texture.rotation = desc.rotation;
  }
  texture.needsUpdate = true;
};

/** 对 owned 贴图覆盖 colorSpace/wrap/anisotropy/flipY(仅 shareTexture=false 调用)。 */
export const applyTextureLoadOpts = (texture: THREE.Texture, desc: TextureDescriptor): void => {
  if (desc.colorSpace !== undefined) {
    texture.colorSpace = desc.colorSpace;
  }
  if (desc.wrapS !== undefined) {
    texture.wrapS = desc.wrapS;
  }
  if (desc.wrapT !== undefined) {
    texture.wrapT = desc.wrapT;
  }
  if (desc.anisotropy !== undefined) {
    texture.anisotropy = desc.anisotropy;
  }
  if (desc.flipY !== undefined) {
    texture.flipY = desc.flipY;
  }
};

/** 释放所有 owned 贴图并清空 Map。 */
export const disposeOwnedTextures = (ownedSlots: Map<TextureSlot, OwnedTexture>): void => {
  for (const { texture } of ownedSlots.values()) {
    texture.dispose();
  }
  ownedSlots.clear();
};

/** 从 descriptor 提取 AssetCache.loadTextureFromUrl 所需的 load options。 */
export const toLoadOpts = (desc: TextureDescriptor): TextureLoadOptions => ({
  colorSpace: desc.colorSpace,
  wrapS: desc.wrapS,
  wrapT: desc.wrapT,
  anisotropy: desc.anisotropy,
  flipY: desc.flipY,
});

/** descriptor 是否声明了 repeat/offset/rotation(共享模式下需忽略并 onError)。 */
export const hasTextureTransform = (desc: TextureDescriptor): boolean =>
  desc.repeat !== undefined || desc.offset !== undefined || desc.rotation !== undefined;

/** 所有受支持的贴图槽位。 */
const TEXTURE_SLOTS: readonly TextureSlot[] = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
];

/** config 中已声明的贴图槽位(undefined = 不动,排除;null = 显式清空,保留)。 */
export interface DeclaredSlot {
  slot: TextureSlot;
  desc: TextureDescriptor | null;
}

/** 收集 config 中声明的贴图槽位(含显式 null)。 */
export const getDeclaredSlots = (config: MaterialConfig): DeclaredSlot[] => {
  const slots: DeclaredSlot[] = [];
  for (const slot of TEXTURE_SLOTS) {
    const value = config[slot];
    if (value !== undefined) {
      slots.push({ slot, desc: value });
    }
  }
  return slots;
};

/** 默认 color(未声明 color 时回填)。 */
export const DEFAULT_COLOR = 0xffffff;

/** 设置材质 color(duck-type 守卫)。 */
export const setColor = (material: THREE.Material, color: THREE.ColorRepresentation): void => {
  if ('color' in material) {
    (material as THREE.MeshStandardMaterial).color.set(color);
  }
};

/** config 是否含至少一个贴图描述符(排除 null 清空)。 */
export const hasTextureDescriptors = (cfg: MaterialConfig): boolean =>
  getDeclaredSlots(cfg).some((s) => s.desc !== null);

/** config 声明的贴图是否都已赋值到材质(null 槽位视为已就绪)。 */
export const texturesReady = (material: THREE.Material, cfg: MaterialConfig): boolean =>
  getDeclaredSlots(cfg).every(({ slot, desc }) => desc === null || readSlotTexture(material, slot) !== null);
