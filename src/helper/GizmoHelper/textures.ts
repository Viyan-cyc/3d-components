
import * as THREE from 'three';

// ---- 贴图工厂（均为白底，靠 SpriteMaterial.color 着色）----
// 抽离自 GizmoViewport，便于复用与单独维护。

const FONT_SIZE = 44;
const CANVAS_SIZE = 64;
const PADDING = 12;
const TEXT_BASELINE_OFFSET = 3;
const ANISOTROPY = 4;
const BACKDROP_INNER_RATIO = 0.6;
const BACKDROP_MID_STOP = 0.85;

/** 在画布上绘制并生成贴图。 */
const drawTexture = (draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  draw(ctx, CANVAS_SIZE);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = ANISOTROPY;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

let cachedCircleTex: THREE.CanvasTexture | null = null;

/** 实心白圆（正轴气泡）。 */
export const makeCircleTexture = (): THREE.CanvasTexture => {
  if (cachedCircleTex) {
    return cachedCircleTex;
  }
  return (cachedCircleTex = drawTexture((ctx, s) => {
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }));
};

let cachedRingTex: THREE.CanvasTexture | null = null;
let cachedAlpha: number | undefined;

/** 半透明填充 + 实心边框（负轴气泡）。 */
export const makeRingTexture = (fillAlpha: number): THREE.CanvasTexture => {
  // 透明度变化时重建
  if (cachedRingTex && cachedAlpha === fillAlpha) {
    return cachedRingTex;
  }
  const tex = drawTexture((ctx, s) => {
    const r = s / 2 - 1;
    // 半透明填充
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,255,255,${fillAlpha})`;
    ctx.fill();
    // 实心边框（同色，不透明）
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, r - 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  });
  cachedAlpha = fillAlpha;
  cachedRingTex = tex;
  return tex;
};

let cachedBackdropTex: THREE.CanvasTexture | null = null;

/** 浅白圆底（整体悬停背景，边缘略羽化）。 */
export const makeBackdropTexture = (): THREE.CanvasTexture => {
  if (cachedBackdropTex) {
    return cachedBackdropTex;
  }
  return (cachedBackdropTex = drawTexture((ctx, s) => {
    const r = s / 2;
    const grad = ctx.createRadialGradient(r, r, r * BACKDROP_INNER_RATIO, r, r, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(BACKDROP_MID_STOP, '#ffffff');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }));
};

/**
 * 白色字母（透明背景），由 SpriteMaterial.color 着色。
 * 字号固定（与正负轴一致）；多字符（如 "-X"）仅加宽画布、保持字高不变。
 */
export const makeLabelTexture = (letter: string): THREE.CanvasTexture => {
  // 先量算文字宽度以决定画布宽度
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `bold ${FONT_SIZE}px Arial, sans-serif`;
  const textWidth = probe.measureText(letter).width;
  const width = Math.max(CANVAS_SIZE, Math.ceil(textWidth) + PADDING);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, CANVAS_SIZE);
  ctx.font = `bold ${FONT_SIZE}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(letter, width / 2, CANVAS_SIZE / 2 + TEXT_BASELINE_OFFSET);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = ANISOTROPY;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};
