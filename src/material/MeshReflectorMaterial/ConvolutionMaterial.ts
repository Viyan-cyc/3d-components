
import * as THREE from 'three';

/**
 * Default depth-to-blur ratio bias for the convolution shader.
 */
const DEFAULT_DEPTH_TO_BLUR_RATIO_BIAS = 0.25;

/**
 * Maximum kernel step value in the default Kawase blur kernel.
 */
const KERNEL_MAX_STEP = 3.0;

/**
 * Scale factor used when computing half-texel size from full texel size.
 */
const HALF_SCALE = 0.5;

/**
 * Default Kawase blur kernel step values.
 * Each value represents a progressively wider blur pass.
 */
const DEFAULT_KERNEL = new Float32Array([0.0, 1.0, 2.0, 2.0, KERNEL_MAX_STEP]);

/**
 * Fragment shader for Kawase multi-pass blur convolution.
 *
 * Performs a depth-aware blur by sampling four offset positions
 * around each pixel. The offset magnitude is controlled by a
 * `kernel` uniform that steps through progressively wider passes.
 */
const CONVOLUTION_FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <dithering_pars_fragment>
  uniform sampler2D inputBuffer;
  uniform sampler2D depthBuffer;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float minDepthThreshold;
  uniform float maxDepthThreshold;
  uniform float depthScale;
  uniform float depthToBlurRatioBias;
  varying vec2 vUv;
  varying vec2 vUv0;
  varying vec2 vUv1;
  varying vec2 vUv2;
  varying vec2 vUv3;

  void main() {
    float depthFactor = 0.0;

    #ifdef USE_DEPTH
      vec4 depth = texture2D(depthBuffer, vUv);
      depthFactor = smoothstep(
        minDepthThreshold, maxDepthThreshold,
        1.0 - (depth.r * depth.a)
      );
      depthFactor *= depthScale;
      depthFactor = max(0.0, min(1.0, depthFactor + 0.25));
    #endif

    vec4 sum = texture2D(inputBuffer, mix(vUv0, vUv, depthFactor));
    sum += texture2D(inputBuffer, mix(vUv1, vUv, depthFactor));
    sum += texture2D(inputBuffer, mix(vUv2, vUv, depthFactor));
    sum += texture2D(inputBuffer, mix(vUv3, vUv, depthFactor));
    gl_FragColor = sum * 0.25;

    #include <dithering_fragment>
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Vertex shader for Kawase multi-pass blur convolution.
 *
 * Computes four offset UV positions based on the kernel step
 * and texel size for the fragment shader to sample.
 */
const CONVOLUTION_VERTEX_SHADER = /* glsl */ `
  uniform vec2 texelSize;
  uniform vec2 halfTexelSize;
  uniform float kernel;
  uniform float scale;
  varying vec2 vUv;
  varying vec2 vUv0;
  varying vec2 vUv1;
  varying vec2 vUv2;
  varying vec2 vUv3;

  void main() {
    vec2 uv = position.xy * 0.5 + 0.5;
    vUv = uv;

    vec2 dUv = (texelSize * vec2(kernel) + halfTexelSize) * scale;
    vUv0 = vec2(uv.x - dUv.x, uv.y + dUv.y);
    vUv1 = vec2(uv.x + dUv.x, uv.y + dUv.y);
    vUv2 = vec2(uv.x + dUv.x, uv.y - dUv.y);
    vUv3 = vec2(uv.x - dUv.x, uv.y - dUv.y);

    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

/**
 * Shader material for Kawase multi-pass blur convolution.
 *
 * Performs a depth-aware blur by sampling four offset positions
 * around each pixel. The offset magnitude is controlled by a
 * `kernel` uniform that steps through progressively wider passes.
 *
 * Based on the Kawase blur filter.
 *
 * @internal Used by {@link BlurPass}.
 */
export class ConvolutionMaterial extends THREE.ShaderMaterial {
  /** Kernel step values for each blur pass. */
  kernel: Float32Array;

  constructor(texelSize = new THREE.Vector2()) {
    super({
      uniforms: {
        inputBuffer: new THREE.Uniform(null),
        depthBuffer: new THREE.Uniform(null),
        resolution: new THREE.Uniform(new THREE.Vector2()),
        texelSize: new THREE.Uniform(new THREE.Vector2()),
        halfTexelSize: new THREE.Uniform(new THREE.Vector2()),
        kernel: new THREE.Uniform(0.0),
        scale: new THREE.Uniform(1.0),
        cameraNear: new THREE.Uniform(0.0),
        cameraFar: new THREE.Uniform(1.0),
        minDepthThreshold: new THREE.Uniform(0.0),
        maxDepthThreshold: new THREE.Uniform(1.0),
        depthScale: new THREE.Uniform(0.0),
        depthToBlurRatioBias: new THREE.Uniform(DEFAULT_DEPTH_TO_BLUR_RATIO_BIAS),
      },
      fragmentShader: CONVOLUTION_FRAGMENT_SHADER,
      vertexShader: CONVOLUTION_VERTEX_SHADER,
      blending: THREE.NoBlending,
      depthWrite: false,
      depthTest: false,
    });

    this.toneMapped = false;
    this.setTexelSize(texelSize.x, texelSize.y);
    this.kernel = DEFAULT_KERNEL;
  }

  /**
   * Set the texel size used for blur offset calculations.
   * Typically `1.0 / width` and `1.0 / height` of the render target.
   */
  setTexelSize(x: number, y: number): void {
    this.uniforms.texelSize.value.set(x, y);
    this.uniforms.halfTexelSize.value.set(x, y).multiplyScalar(HALF_SCALE);
  }

  /**
   * Set the resolution uniform (used for reference in shader).
   */
  setResolution(resolution: THREE.Vector2): void {
    this.uniforms.resolution.value.copy(resolution);
  }
}
