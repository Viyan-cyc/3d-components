/**
 * @module InstancedMesh2
 *
 * **增强实例化网格 (Enhanced Instanced Mesh)**
 *
 * An enhanced `InstancedMesh` with per-instance frustum culling, BVH-accelerated
 * raycasting, LOD, per-instance uniforms, skeletal animation, morph targets,
 * and indirect instancing via data textures.
 *
 * @example
 * ```ts
 * import { InstancedMesh2 } from '@cyc/3d-components/core';
 *
 * const mesh = new InstancedMesh2(geometry, material, { capacity: 10000 });
 * mesh.addInstances(100, (entity, i) => {
 *   entity.position.set(Math.random() * 100, 0, Math.random() * 100);
 * });
 * mesh.computeBVH();
 * scene.add(mesh);
 * ```
 */

// Main class
export { InstancedMesh2 } from './InstancedMesh2';
export type { InstancedMesh2Params } from './InstancedMesh2';

// Entity
export { InstancedEntity } from './InstancedEntity';

// BVH
export { InstancedMeshBVH } from './InstancedMeshBVH';
export type { BVHParams } from './InstancedMeshBVH';

// Feature types
export type { Entity, UpdateEntityCallback } from './feature/Instances';
export type { LODInfo, LODLevel, LODRenderList } from './feature/LOD';
export type { CustomSortCallback, OnFrustumEnterCallback } from './feature/FrustumCulling';

// Utility types
export type { UniformType, UniformValue, UniformValueObj } from './utils/SquareDataTexture';
