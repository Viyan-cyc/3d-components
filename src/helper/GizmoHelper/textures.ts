import * as THREE from 'three';

// ---- 贴图工厂（均为白底，靠 SpriteMaterial.color 着色）----
// 抽离自 GizmoViewport，便于复用与单独维护。

let _circleTex: THREE.CanvasTexture | null = null;
/** 实心白圆（正轴气泡）。 */
export function makeCircleTexture(): THREE.CanvasTexture {
  if (_circleTex) return _circleTex;
  return (_circleTex = drawTexture((ctx, s) => {
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2 - 1, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }));
}

let _ringTex: THREE.CanvasTexture | null = null;
/** 半透明填充 + 实心边框（负轴气泡）。 */
export function makeRingTexture(fillAlpha: number): THREE.CanvasTexture {
  // 透明度变化时重建
  if (_ringTex && (makeRingTexture as unknown as { _a?: number })._a === fillAlpha) return _ringTex;
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
  (makeRingTexture as unknown as { _a?: number })._a = fillAlpha;
  _ringTex = tex;
  return tex;
}

let _backdropTex: THREE.CanvasTexture | null = null;
/** 浅白圆底（整体悬停背景，边缘略羽化）。 */
export function makeBackdropTexture(): THREE.CanvasTexture {
  if (_backdropTex) return _backdropTex;
  return (_backdropTex = drawTexture((ctx, s) => {
    const r = s / 2;
    const grad = ctx.createRadialGradient(r, r, r * 0.6, r, r, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.85, '#ffffff');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }));
}

/**
 * 白色字母（透明背景），由 SpriteMaterial.color 着色。
 * 字号固定（与正负轴一致）；多字符（如 "-X"）仅加宽画布、保持字高不变。
 */
export function makeLabelTexture(letter: string): THREE.CanvasTexture {
  const fontSize = 44;
  const height = 64;
  // 先量算文字宽度以决定画布宽度
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `bold ${fontSize}px Arial, sans-serif`;
  const textWidth = probe.measureText(letter).width;
  const width = Math.max(height, Math.ceil(textWidth) + 12);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(letter, width / 2, height / 2 + 3);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 在 64×64 画布上绘制并生成贴图。 */
function drawTexture(draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, s, s);
  draw(ctx, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
