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
 * import { MeshReflectorMaterial } from '@cyc/3d-components/material';
 *
 * const reflectorMat = new MeshReflectorMaterial({ mirror: 0.75, blur: [300, 100] });
 * const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), reflectorMat);
 * reflectorMat.bindToMesh(floor);
 * ```
 */

export { MeshReflectorMaterial } from './MeshReflectorMaterial';
export type { MeshReflectorMaterialOptions } from './MeshReflectorMaterial';
