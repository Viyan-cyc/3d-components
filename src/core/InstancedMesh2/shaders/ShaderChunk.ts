/**
 * @internal Patches Three.js shader chunks to support indirect instancing.
 */

import { ShaderChunk } from 'three';
import {
    instanced_pars_vertex,
    instanced_color_pars_vertex,
    instanced_vertex,
    instanced_color_vertex,
    instanced_skinning_pars_vertex
} from './chunks/instancedChunks';

/** Patches the given shader string by adding a condition for indirect instancing support. */
function patchShader(shader: string): string {
    return shader.replace('#ifdef USE_INSTANCING', '#if defined USE_INSTANCING || defined USE_INSTANCING_INDIRECT');
}

let _patched = false;

/**
 * Patches Three.js ShaderChunk to support indirect instancing.
 * Safe to call multiple times; only patches once.
 */
export function patchShaderChunks(): void {
    if (_patched) return;
    _patched = true;

    // Register custom chunks
    (ShaderChunk as any)['instanced_pars_vertex'] = instanced_pars_vertex;
    (ShaderChunk as any)['instanced_color_pars_vertex'] = instanced_color_pars_vertex;
    (ShaderChunk as any)['instanced_vertex'] = instanced_vertex;
    (ShaderChunk as any)['instanced_color_vertex'] = instanced_color_vertex;

    // Patch existing chunks to support USE_INSTANCING_INDIRECT
    ShaderChunk.project_vertex = patchShader(ShaderChunk.project_vertex);
    ShaderChunk.worldpos_vertex = patchShader(ShaderChunk.worldpos_vertex);
    ShaderChunk.defaultnormal_vertex = patchShader(ShaderChunk.defaultnormal_vertex);

    // Append instancing chunks to batching and color chunks
    ShaderChunk.batching_pars_vertex = ShaderChunk.batching_pars_vertex.concat('\n#include <instanced_pars_vertex>');
    ShaderChunk.color_pars_vertex = ShaderChunk.color_pars_vertex.concat('\n#include <instanced_color_pars_vertex>');
    (ShaderChunk as any)['batching_vertex'] = (ShaderChunk as any)['batching_vertex'].concat('\n#include <instanced_vertex>');

    // Override skinning chunk for per-instance bone support
    ShaderChunk.skinning_pars_vertex = instanced_skinning_pars_vertex;

    // Fix morph instancing if available
    if ((ShaderChunk as any)['morphinstance_vertex']) {
        (ShaderChunk as any)['morphinstance_vertex'] = (ShaderChunk as any)['morphinstance_vertex'].replaceAll('gl_InstanceID', 'instanceIndex');
    }
}
