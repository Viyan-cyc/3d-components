// @ts-nocheck
import { Color, Euler, Matrix4, Object3D, Quaternion, Vector3 } from 'three';
import type { ColorRepresentation } from 'three';
import type { InstancedMesh2 } from './InstancedMesh2';
import type { UniformValue, UniformValueObj } from './utils/SquareDataTexture';

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
    public readonly owner: InstancedMesh2;
    /** The local position. */
    public position = new Vector3();
    /** The local scale. */
    public scale = new Vector3(1, 1, 1);
    /** The local rotation as `Quaternion`. */
    public quaternion = new Quaternion();
    /** The local rotation as `Euler` (only if `allowsEuler` is `true`). */
    public rotation: Euler;

    public get visible(): boolean { return this.owner.getVisibilityAt(this.id); }
    public set visible(value: boolean) { this.owner.setVisibilityAt(this.id, value); }

    public get active(): boolean { return this.owner.getActiveAt(this.id); }
    public set active(value: boolean) { this.owner.setActiveAt(this.id, value); }

    public get color(): Color { return this.owner.getColorAt(this.id); }
    public set color(value: ColorRepresentation) { this.owner.setColorAt(this.id, value); }

    public get opacity(): number { return this.owner.getOpacityAt(this.id); }
    public set opacity(value: number) { this.owner.setOpacityAt(this.id, value); }

    public get matrix(): Matrix4 { return this.owner.getMatrixAt(this.id); }

    public get matrixWorld(): Matrix4 { return this.matrix.premultiply(this.owner.matrixWorld); }

    constructor(owner: InstancedMesh2, id: number, useEuler: boolean) {
        this.id = id;
        this.owner = owner;

        if (useEuler) {
            const quaternion = this.quaternion;
            const rotation = this.rotation = new Euler();

            rotation._onChange(() => quaternion.setFromEuler(rotation, false));
            quaternion._onChange(() => rotation.setFromQuaternion(quaternion, undefined, false));
        }
    }

    /** @internal Resets matrix to identity. */
    public setMatrixIdentity(): void {
        const owner = this.owner;
        const te = owner.matricesTexture._data;
        const id = this.id;
        const offset = id * 16;

        te[offset + 0] = 1; te[offset + 1] = 0; te[offset + 2] = 0; te[offset + 3] = 0;
        te[offset + 4] = 0; te[offset + 5] = 1; te[offset + 6] = 0; te[offset + 7] = 0;
        te[offset + 8] = 0; te[offset + 9] = 0; te[offset + 10] = 1; te[offset + 11] = 0;
        te[offset + 12] = 0; te[offset + 13] = 0; te[offset + 14] = 0; te[offset + 15] = 1;

        owner.matricesTexture.enqueueUpdate(id);
    }

    /** Updates the transformation matrix from current position, quaternion, and scale. */
    public updateMatrix(): void {
        const owner = this.owner;
        const position = this.position;
        const quaternion = this.quaternion as any;
        const scale = this.scale;
        const te = owner.matricesTexture._data;
        const id = this.id;
        const offset = id * 16;

        const x = quaternion._x, y = quaternion._y, z = quaternion._z, w = quaternion._w;
        const x2 = x + x, y2 = y + y, z2 = z + z;
        const xx = x * x2, xy = x * y2, xz = x * z2;
        const yy = y * y2, yz = y * z2, zz = z * z2;
        const wx = w * x2, wy = w * y2, wz = w * z2;

        const sx = scale.x, sy = scale.y, sz = scale.z;

        te[offset + 0] = (1 - (yy + zz)) * sx;
        te[offset + 1] = (xy + wz) * sx;
        te[offset + 2] = (xz - wy) * sx;
        te[offset + 3] = 0;

        te[offset + 4] = (xy - wz) * sy;
        te[offset + 5] = (1 - (xx + zz)) * sy;
        te[offset + 6] = (yz + wx) * sy;
        te[offset + 7] = 0;

        te[offset + 8] = (xz + wy) * sz;
        te[offset + 9] = (yz - wx) * sz;
        te[offset + 10] = (1 - (xx + yy)) * sz;
        te[offset + 11] = 0;

        te[offset + 12] = position.x;
        te[offset + 13] = position.y;
        te[offset + 14] = position.z;
        te[offset + 15] = 1;

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
        const offset = id * 16;

        te[offset + 12] = position.x;
        te[offset + 13] = position.y;
        te[offset + 14] = position.z;

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
        if (this.rotation) target.rotation.copy(this.rotation);
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
        _quat.setFromAxisAngle(axis, angle);
        this.quaternion.multiply(_quat);
        return this;
    }

    public rotateOnWorldAxis(axis: Vector3, angle: number): this {
        _quat.setFromAxisAngle(axis, angle);
        this.quaternion.premultiply(_quat);
        return this;
    }

    public rotateX(angle: number): this { return this.rotateOnAxis(_xAxis, angle); }
    public rotateY(angle: number): this { return this.rotateOnAxis(_yAxis, angle); }
    public rotateZ(angle: number): this { return this.rotateOnAxis(_zAxis, angle); }

    public translateOnAxis(axis: Vector3, distance: number): this {
        _vec3.copy(axis).applyQuaternion(this.quaternion);
        this.position.add(_vec3.multiplyScalar(distance));
        return this;
    }

    public translateX(distance: number): this { return this.translateOnAxis(_xAxis, distance); }
    public translateY(distance: number): this { return this.translateOnAxis(_yAxis, distance); }
    public translateZ(distance: number): this { return this.translateOnAxis(_zAxis, distance); }

    /** Removes this entity from its owner instance. */
    public remove(): this {
        this.owner.removeInstances(this.id);
        return this;
    }
}

const _quat = new Quaternion();
const _vec3 = new Vector3();
const _xAxis = new Vector3(1, 0, 0);
const _yAxis = new Vector3(0, 1, 0);
const _zAxis = new Vector3(0, 0, 1);
