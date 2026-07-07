// @ts-nocheck
import { MeshDistanceMaterial, WebGLRenderer } from 'three';

/**
 * @internal Patches `WebGLProperties` temporarily during rendering to prevent
 * shader conflicts between `InstancedMesh` and `InstancedMesh2` sharing the same material.
 */

let propertiesGetBase: (obj: unknown) => unknown = null;
let propertiesGet: WeakMap<any, () => unknown> = null;
const propertiesGetMap: { [x: string]: WeakMap<any, () => unknown> } = {};

function propertiesGetCallback(object: unknown): unknown {
    return propertiesGet.get(object)?.() ?? propertiesGetBase(object);
}

function addProperties(material: unknown): void {
    if (propertiesGet.has(material)) return;

    const materialProperties: { [x: string]: any } = {};

    propertiesGet.set(material, () => {
        if ((material as MeshDistanceMaterial).isMeshDistanceMaterial) {
            const materialPropertiesBase = propertiesGetBase(material) as { [x: string]: any };
            materialProperties.light = materialPropertiesBase.light;
        }

        return materialProperties;
    });
}

export function patchProperties(obj: any, renderer: WebGLRenderer, material: unknown): void {
    const properties = renderer.properties;
    propertiesGetBase = properties.get;

    const key = `${!!obj.colorsTexture}_${obj._useOpacity}_${!!obj.boneTexture}_${!!obj.uniformsTexture}`;
    propertiesGetMap[key] ??= new WeakMap<any, () => unknown>();
    propertiesGet = propertiesGetMap[key];

    properties.get = propertiesGetCallback;

    addProperties(material);
}

export function unpatchProperties(renderer: WebGLRenderer): void {
    renderer.properties.get = propertiesGetBase;
}
