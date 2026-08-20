import {
  type Color,
  type ColorRepresentation,
  Euler,
  type Matrix4,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three';
import type { UniformValue, UniformValueObj } from './utils/SquareDataTexture';
import type { InstancedMesh2 } from './InstancedMesh2';

// owner references the owning mesh regardless of its generic instantiation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInstancedMesh2 = InstancedMesh2<any, any, any, any>;

const MATRIX_ELEMENTS = 16;
const W_OFFSET = 3;
const COL1_BASE = 4;
const COL2_BASE = 8;
const COL3_BASE = 12;

const tempQuat = new Quaternion();
const tempVec3 = new Vector3();
const tempXAxis = new Vector3(1, 0, 0);
const tempYAxis = new Vector3(0, 1, 0);
const tempZAxis = new Vector3(0, 0, 1);

const writeMatrixFromTransform = (
  te: Float32Array,
  offset: number,
  quaternion: Quaternion,
  scale: Vector3,
  position: Vector3,
): void => {
  const x = quaternion.x;
  const y = quaternion.y;
  const z = quaternion.z;
  const w = quaternion.w;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const sx = scale.x;
  const sy = scale.y;
  const sz = scale.z;

  te[offset] = (1 - (yy + zz)) * sx;
  te[offset + 1] = (xy + wz) * sx;
  te[offset + 2] = (xz - wy) * sx;
  te[offset + W_OFFSET] = 0;

  te[offset + COL1_BASE] = (xy - wz) * sy;
  te[offset + COL1_BASE + 1] = (1 - (xx + zz)) * sy;
  te[offset + COL1_BASE + 2] = (yz + wx) * sy;
  te[offset + COL1_BASE + W_OFFSET] = 0;

  te[offset + COL2_BASE] = (xz + wy) * sz;
  te[offset + COL2_BASE + 1] = (yz - wx) * sz;
  te[offset + COL2_BASE + 2] = (1 - (xx + yy)) * sz;
  te[offset + COL2_BASE + W_OFFSET] = 0;

  te[offset + COL3_BASE] = position.x;
  te[offset + COL3_BASE + 1] = position.y;
  te[offset + COL3_BASE + 2] = position.z;
  te[offset + COL3_BASE + W_OFFSET] = 1;
};

/**
 * Represents an individual instance in an `InstancedMesh2`.
 * Stores transformation data (position, rotation, scale) and provides methods to manipulate them.
 * This class is instantiated automatically when `createEntities` is `true` in constructor params.
 */
export class InstancedEntity {
  public readonly isInstanceEntity = true;

  /** The unique identifier for this instance. */
  public readonly id: number;

  /** The `InstancedMesh2` that owns this instance. */
  public readonly owner: AnyInstancedMesh2;

  /** The local position. */
  public position = new Vector3();

  /** The local scale. */
  public scale = new Vector3(1, 1, 1);

  /** The local rotation as `Quaternion`. */
  public quaternion = new Quaternion();

  /** The local rotation as `Euler` (only if `allowsEuler` is `true`). */
  public rotation: Euler | undefined;

  public get visible(): boolean {
    return this.owner.getVisibilityAt(this.id);
  }

  public set visible(value: boolean) {
    this.owner.setVisibilityAt(this.id, value);
  }

  public get active(): boolean {
    return this.owner.getActiveAt(this.id);
  }

  public set active(value: boolean) {
    this.owner.setActiveAt(this.id, value);
  }

  public get color(): Color {
    return this.owner.getColorAt(this.id);
  }

  public set color(value: ColorRepresentation) {
    this.owner.setColorAt(this.id, value);
  }

  public get opacity(): number {
    return this.owner.getOpacityAt(this.id);
  }

  public set opacity(value: number) {
    this.owner.setOpacityAt(this.id, value);
  }

  public get matrix(): Matrix4 {
    return this.owner.getMatrixAt(this.id);
  }

  public get matrixWorld(): Matrix4 {
    return this.matrix.premultiply(this.owner.matrixWorld);
  }

  constructor(owner: AnyInstancedMesh2, id: number, useEuler: boolean) {
    this.id = id;
    this.owner = owner;

    if (useEuler) {
      const quaternion = this.quaternion;
      const rotation = new Euler();
      this.rotation = rotation;

      rotation._onChange(() => quaternion.setFromEuler(rotation, false));
      quaternion._onChange(() => rotation.setFromQuaternion(quaternion, undefined, false));
    }
  }

  /** @internal Resets matrix to identity. */
  public setMatrixIdentity(): void {
    const owner = this.owner;
    const te = owner.matricesTexture._data;
    const id = this.id;
    const offset = id * MATRIX_ELEMENTS;

    te.fill(0, offset, offset + MATRIX_ELEMENTS);
    te[offset] = 1;
    te[offset + COL1_BASE + 1] = 1;
    te[offset + COL2_BASE + 2] = 1;
    te[offset + COL3_BASE + W_OFFSET] = 1;

    owner.matricesTexture.enqueueUpdate(id);
  }

  /** Updates the transformation matrix from current position, quaternion, and scale. */
  public updateMatrix(): void {
    const owner = this.owner;
    const position = this.position;
    const quaternion = this.quaternion;
    const scale = this.scale;
    const te = owner.matricesTexture._data;
    const id = this.id;
    const offset = id * MATRIX_ELEMENTS;

    writeMatrixFromTransform(te, offset, quaternion, scale, position);

    owner.matricesTexture.enqueueUpdate(id);

    if (owner.bvh && owner.autoUpdateBVH) {
      owner.bvh.move(id);
    }
  }

  /** Updates only the position component of the transformation matrix. */
  public updateMatrixPosition(): void {
    const owner = this.owner;
    const position = this.position;
    const te = owner.matricesTexture._data;
    const id = this.id;
    const offset = id * MATRIX_ELEMENTS;

    te[offset + COL3_BASE] = position.x;
    te[offset + COL3_BASE + 1] = position.y;
    te[offset + COL3_BASE + 2] = position.z;

    owner.matricesTexture.enqueueUpdate(id);

    if (owner.bvh && owner.autoUpdateBVH) {
      owner.bvh.move(id);
    }
  }

  public getUniform(name: string, target?: UniformValueObj): UniformValue {
    return this.owner.getUniformAt(this.id, name, target);
  }

  public setUniform(name: string, value: UniformValue): void {
    this.owner.setUniformAt(this.id, name, value);
  }

  public updateBones(updateBonesMatrices = true, excludeBonesSet?: Set<string>): void {
    this.owner.setBonesAt(this.id, updateBonesMatrices, excludeBonesSet);
  }

  /** Copies transformation to an Object3D. */
  public copyTo(target: Object3D): void {
    target.position.copy(this.position);
    target.scale.copy(this.scale);
    target.quaternion.copy(this.quaternion);
    if (this.rotation) {
      target.rotation.copy(this.rotation);
    }
  }

  public applyMatrix4(m: Matrix4): this {
    this.matrix.premultiply(m).decompose(this.position, this.quaternion, this.scale);
    return this;
  }

  public applyQuaternion(q: Quaternion): this {
    this.quaternion.premultiply(q);
    return this;
  }

  public rotateOnAxis(axis: Vector3, angle: number): this {
    tempQuat.setFromAxisAngle(axis, angle);
    this.quaternion.multiply(tempQuat);
    return this;
  }

  public rotateOnWorldAxis(axis: Vector3, angle: number): this {
    tempQuat.setFromAxisAngle(axis, angle);
    this.quaternion.premultiply(tempQuat);
    return this;
  }

  public rotateX(angle: number): this {
    return this.rotateOnAxis(tempXAxis, angle);
  }

  public rotateY(angle: number): this {
    return this.rotateOnAxis(tempYAxis, angle);
  }

  public rotateZ(angle: number): this {
    return this.rotateOnAxis(tempZAxis, angle);
  }

  public translateOnAxis(axis: Vector3, distance: number): this {
    tempVec3.copy(axis).applyQuaternion(this.quaternion);
    this.position.add(tempVec3.multiplyScalar(distance));
    return this;
  }

  public translateX(distance: number): this {
    return this.translateOnAxis(tempXAxis, distance);
  }

  public translateY(distance: number): this {
    return this.translateOnAxis(tempYAxis, distance);
  }

  public translateZ(distance: number): this {
    return this.translateOnAxis(tempZAxis, distance);
  }

  /** Removes this entity from its owner instance. */
  public remove(): this {
    this.owner.removeInstances(this.id);
    return this;
  }
}
