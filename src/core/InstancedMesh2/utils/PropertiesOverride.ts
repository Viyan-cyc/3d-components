import type { MeshDistanceMaterial, WebGLRenderer } from 'three';

/**
 * @internal Patches `WebGLProperties` temporarily during rendering to prevent
 * shader conflicts between `InstancedMesh` and `InstancedMesh2` sharing the same material.
 */

let propertiesGetBase: (obj: unknown) => unknown = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let propertiesGet: WeakMap<any, () => unknown> = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const propertiesGetMap: { [x: string]: WeakMap<any, () => unknown> } = {};

const propertiesGetCallback = (object: unknown): unknown =>
  propertiesGet.get(object)?.() ?? propertiesGetBase(object);

const addProperties = (material: unknown): void => {
  if (propertiesGet.has(material)) {
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const materialProperties: { [x: string]: any } = {};

  propertiesGet.set(material, () => {
    if ((material as MeshDistanceMaterial).isMeshDistanceMaterial) {

      const base = propertiesGetBase(material);
      materialProperties.light = base.light;
    }

    return materialProperties;
  });
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export const patchProperties = (obj: any, renderer: WebGLRenderer, material: unknown): void => {
  const properties = renderer.properties;
  propertiesGetBase = properties.get;

  const key = `${Boolean(obj.colorsTexture)}_${obj._useOpacity}`
    + `_${Boolean(obj.boneTexture)}_${Boolean(obj.uniformsTexture)}`;
  propertiesGetMap[key] ??= new WeakMap<any, () => unknown>();
  propertiesGet = propertiesGetMap[key];

  properties.get = propertiesGetCallback;

  addProperties(material);
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export const unpatchProperties = (renderer: WebGLRenderer): void => {
  renderer.properties.get = propertiesGetBase;
};
