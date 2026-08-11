/**
 * @module material
 *
 * **材质组件 (Material Components)**
 *
 * Pre-configured Three.js materials with chainable convenience methods.
 * Wraps standard PBR materials for quick prototyping and production use.
 *
 * @example
 * ```ts
 * import { MeshReflectorMaterial } from '@a3d/a3d-components/material';
 *
 * const reflectorMat = new MeshReflectorMaterial({ mirror: 0.75, blur: [300, 100] });
 * const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), reflectorMat);
 * reflectorMat.bindToMesh(floor);
 * ```
 */

export { MeshReflectorMaterial } from './MeshReflectorMaterial';
export type { MeshReflectorMaterialOptions } from './MeshReflectorMaterial';

export { MaterialManager } from './MaterialManager';
export type {
  ChangeReason,
  MaterialChangeCallback,
  MaterialConfig,
  MaterialManagerOptions,
  MaterialType,
  TextureDescriptor,
  Theme,
  Unsubscriber,
} from './MaterialManager';

// 材质工厂：纯同步创建 + 属性应用 + 贴图槽位工具（供调用方组合内联材质，避免重复实现）。
export {
  createMaterial,
  applySyncProps,
  getDeclaredSlots,
  assignTextureSlot,
  toLoadOpts,
  hasSlot,
} from './MaterialManager/materialFactory';
export type { TextureSlot } from './MaterialManager/types';
