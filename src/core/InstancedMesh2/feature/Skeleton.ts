/**
 * @internal Per-instance skeletal animation feature module.
 */

import {
  type BufferGeometry, type Material, Matrix4, type Object3DEventMap, type Skeleton,
} from 'three';
import type { InstancedMesh2 } from '../InstancedMesh2';
import { SquareDataTexture } from '../utils/SquareDataTexture';

const BONE_TEX_CHANNELS = 4;
const BONE_TEX_BONES_MULTIPLIER = 4;
const MATRIX_ELEMENTS = 16;

/** Column offsets in a 4x4 matrix stored in column-major order. */
const COL0 = 0;
const COL1 = 4;
const COL2 = 8;
const COL3 = 12;

/** Row offsets within each column. */
const ROW1_OFFSET = 1;
const ROW2_OFFSET = 2;
const ROW3_OFFSET = 3;

const multiplyBoneMatricesAt = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  target: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  instanceIndex: number,
  boneIndex: number,
  m1: Matrix4,
  m2: Matrix4,
): void {
  const offset = (instanceIndex * target.skeleton!.bones.length + boneIndex) * MATRIX_ELEMENTS;
  const ae = m1.elements;
  const be = m2.elements;
  const te = target.boneTexture!._data;

  const a11 = ae[COL0]; const a12 = ae[COL1]; const a13 = ae[COL2]; const a14 = ae[COL3];
  const a21 = ae[COL0 + ROW1_OFFSET]; const a22 = ae[COL1 + ROW1_OFFSET];
  const a23 = ae[COL2 + ROW1_OFFSET]; const a24 = ae[COL3 + ROW1_OFFSET];
  const a31 = ae[COL0 + ROW2_OFFSET]; const a32 = ae[COL1 + ROW2_OFFSET];
  const a33 = ae[COL2 + ROW2_OFFSET]; const a34 = ae[COL3 + ROW2_OFFSET];
  const a41 = ae[COL0 + ROW3_OFFSET]; const a42 = ae[COL1 + ROW3_OFFSET];
  const a43 = ae[COL2 + ROW3_OFFSET]; const a44 = ae[COL3 + ROW3_OFFSET];

  const b11 = be[COL0]; const b12 = be[COL1]; const b13 = be[COL2]; const b14 = be[COL3];
  const b21 = be[COL0 + ROW1_OFFSET]; const b22 = be[COL1 + ROW1_OFFSET];
  const b23 = be[COL2 + ROW1_OFFSET]; const b24 = be[COL3 + ROW1_OFFSET];
  const b31 = be[COL0 + ROW2_OFFSET]; const b32 = be[COL1 + ROW2_OFFSET];
  const b33 = be[COL2 + ROW2_OFFSET]; const b34 = be[COL3 + ROW2_OFFSET];
  const b41 = be[COL0 + ROW3_OFFSET]; const b42 = be[COL1 + ROW3_OFFSET];
  const b43 = be[COL2 + ROW3_OFFSET]; const b44 = be[COL3 + ROW3_OFFSET];

  te[offset + COL0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
  te[offset + COL1] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
  te[offset + COL2] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
  te[offset + COL3] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;

  te[offset + COL0 + ROW1_OFFSET] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
  te[offset + COL1 + ROW1_OFFSET] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
  te[offset + COL2 + ROW1_OFFSET] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
  te[offset + COL3 + ROW1_OFFSET] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;

  te[offset + COL0 + ROW2_OFFSET] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
  te[offset + COL1 + ROW2_OFFSET] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
  te[offset + COL2 + ROW2_OFFSET] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
  te[offset + COL3 + ROW2_OFFSET] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;

  te[offset + COL0 + ROW3_OFFSET] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
  te[offset + COL1 + ROW3_OFFSET] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
  te[offset + COL2 + ROW3_OFFSET] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
  te[offset + COL3 + ROW3_OFFSET] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
};

export const initSkeleton = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  skeleton: Skeleton,
  disableMatrixAutoUpdate = true,
): void {
  if (skeleton && this.skeleton !== skeleton && !this._parentLOD) {
    const bones = skeleton.bones;
    this.skeleton = skeleton;
    this.bindMatrix = new Matrix4();
    this.bindMatrixInverse = new Matrix4();
    this.boneTexture = new SquareDataTexture(
      Float32Array, BONE_TEX_CHANNELS,
      BONE_TEX_BONES_MULTIPLIER * bones.length, this._capacity,
    );

    if (disableMatrixAutoUpdate) {
      for (const bone of bones) {
        bone.matrixAutoUpdate = false;
        bone.matrixWorldAutoUpdate = false;
      }
    }

    this.materialsNeedsUpdate();
  }
};

export const setBonesAt = function <
  TData,
  TGeometry extends BufferGeometry,
  TMaterial extends Material | Material[],
  TEventMap extends Object3DEventMap
>(
  this: InstancedMesh2<TData, TGeometry, TMaterial, TEventMap>,
  id: number,
  updateBonesMatrices = true,
  excludeBonesSet?: Set<string>,
): void {
  const skeleton = this.skeleton;
  if (!skeleton) {
    throw new Error('"setBonesAt" cannot be called before "initSkeleton"');
  }

  const bones = skeleton.bones;
  const boneInverses = skeleton.boneInverses;

  for (let i = 0, l = bones.length; i < l; i++) {
    const bone = bones[i];

    if (updateBonesMatrices) {
      if (!excludeBonesSet?.has(bone.name)) {
        bone.updateMatrix();
      }
      bone.matrixWorld.multiplyMatrices(bone.parent!.matrixWorld, bone.matrix);
    }

    multiplyBoneMatricesAt(this, id, i, bone.matrixWorld, boneInverses[i]);
  }

  this.boneTexture!.enqueueUpdate(id);
};
