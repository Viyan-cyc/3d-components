// @ts-nocheck
import { GLBufferAttribute, WebGLRenderer } from 'three';
import type { TypedArray } from 'three';

/**
 * @internal Extends `GLBufferAttribute` to handle instanced buffer attributes.
 * Allows updating during `onBeforeRender` for efficient dynamic modification.
 */
export class GLInstancedBufferAttribute extends GLBufferAttribute {
    public isGLInstancedBufferAttribute = true;
    public meshPerAttribute: number;
    public array: TypedArray;
    protected _cacheArray: TypedArray;
    /** @internal */ _needsUpdate = false;

    /** HACK: so Three.js treats it as an instanced attribute. */
    public isInstancedBufferAttribute = true;

    constructor(gl: WebGL2RenderingContext, type: GLenum, itemSize: number, elementSize: 1 | 2 | 4, array: TypedArray, meshPerAttribute = 1) {
        const buffer = gl.createBuffer();
        super(buffer, type, itemSize, elementSize, array.length / itemSize);

        this.meshPerAttribute = meshPerAttribute;
        this.array = array;
        this._cacheArray = array;

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, array, gl.DYNAMIC_DRAW);
    }

    /** Updates the buffer data. Designed to be called during `onBeforeRender`. */
    public update(renderer: WebGLRenderer, count: number): void {
        if (!this._needsUpdate || count === 0) return;

        const gl = renderer.getContext();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);

        if (this.array === this._cacheArray) {
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.array, 0, count);
        } else {
            gl.bufferData(gl.ARRAY_BUFFER, this.array, gl.DYNAMIC_DRAW);
            this._cacheArray = this.array;
        }

        this._needsUpdate = false;
    }

    /** @internal Intentionally empty to avoid exceptions when cloning geometry. */
    public clone(): this {
        return this;
    }
}
