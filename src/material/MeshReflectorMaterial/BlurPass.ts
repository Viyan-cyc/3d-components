import * as THREE from 'three';
import { ConvolutionMaterial } from './ConvolutionMaterial';

/**
 * Multi-pass Kawase blur pass for reflection textures.
 *
 * Renders the input texture through a series of progressively wider
 * blur kernels into intermediate render targets, then outputs the
 * final blurred result to the output buffer.
 *
 * Supports depth-aware blurring: when `depthScale > 0`, the blur
 * strength varies based on the depth buffer, creating a more
 * realistic depth-of-field effect on reflections.
 *
 * @internal Used by {@link MeshReflectorMaterial}.
 */
export class BlurPass {
  renderTargetA: THREE.WebGLRenderTarget;
  renderTargetB: THREE.WebGLRenderTarget;
  convolutionMaterial: ConvolutionMaterial;

  private _scene: THREE.Scene;
  private _camera: THREE.Camera;
  private _screen: THREE.Mesh;

  /** Whether to render the final pass to screen instead of the output buffer. */
  renderToScreen = false;

  constructor(options: {
    resolution: number;
    width?: number;
    height?: number;
    minDepthThreshold?: number;
    maxDepthThreshold?: number;
    depthScale?: number;
    depthToBlurRatioBias?: number;
  }) {
    const {
      resolution,
      width = 500,
      height = 500,
      minDepthThreshold = 0,
      maxDepthThreshold = 1,
      depthScale = 0,
      depthToBlurRatioBias = 0.25,
    } = options;

    const rtParams = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      stencilBuffer: false,
      depthBuffer: false,
      type: THREE.HalfFloatType,
    };

    this.renderTargetA = new THREE.WebGLRenderTarget(resolution, resolution, rtParams);
    this.renderTargetB = this.renderTargetA.clone();

    this.convolutionMaterial = new ConvolutionMaterial();
    this.convolutionMaterial.setTexelSize(1.0 / width, 1.0 / height);
    this.convolutionMaterial.setResolution(new THREE.Vector2(width, height));

    this.convolutionMaterial.uniforms.minDepthThreshold.value = minDepthThreshold;
    this.convolutionMaterial.uniforms.maxDepthThreshold.value = maxDepthThreshold;
    this.convolutionMaterial.uniforms.depthScale.value = depthScale;
    this.convolutionMaterial.uniforms.depthToBlurRatioBias.value = depthToBlurRatioBias;

    if (depthScale > 0) {
      this.convolutionMaterial.defines.USE_DEPTH = '';
    }

    // Full-screen quad
    const vertices = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
    const uvs = new Float32Array([0, 0, 2, 0, 0, 2]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    this._scene = new THREE.Scene();
    this._camera = new THREE.Camera();
    this._screen = new THREE.Mesh(geometry, this.convolutionMaterial);
    this._screen.frustumCulled = false;
    this._scene.add(this._screen);
  }

  /**
   * Execute the multi-pass blur.
   *
   * @param renderer - The WebGL renderer.
   * @param inputBuffer - Render target containing the sharp reflection texture (and depth).
   * @param outputBuffer - Render target to write the final blurred result into.
   */
  render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    const uniforms = this.convolutionMaterial.uniforms;
    uniforms.depthBuffer.value = inputBuffer.depthTexture;

    const kernel = this.convolutionMaterial.kernel;
    let lastRT: THREE.WebGLRenderTarget | typeof inputBuffer = inputBuffer;
    let destRT: THREE.WebGLRenderTarget;

    // Multi-pass blur: alternate between renderTargetA and renderTargetB
    for (let i = 0, l = kernel.length - 1; i < l; ++i) {
      destRT = i % 2 === 0 ? this.renderTargetA : this.renderTargetB;
      uniforms.kernel.value = kernel[i];
      uniforms.inputBuffer.value = lastRT.texture;
      renderer.setRenderTarget(destRT);
      renderer.render(this._scene, this._camera);
      lastRT = destRT;
    }

    // Final pass → output
    uniforms.kernel.value = kernel[kernel.length - 1];
    uniforms.inputBuffer.value = lastRT.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this._scene, this._camera);
  }

  /**
   * Dispose all GPU resources held by this pass.
   */
  dispose(): void {
    this.renderTargetA.dispose();
    this.renderTargetB.dispose();
    this.convolutionMaterial.dispose();
    this._screen.geometry.dispose();
  }
}
