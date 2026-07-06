import * as THREE from 'three';
import { BitmapText } from '../../../src/core/BitmapText';
import { createScene, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- BitmapText Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): () => void {
  const { renderer, scene, camera, resize } = createScene(canvas);

  camera.position.set(0, 2, 10);
  camera.lookAt(0, 0, 0);

  const defaultText = '道可道，非常道；名可名，非常名。';

  const params = {
    text: defaultText,
    mode: 'word-wrapper' as 'nowrap' | 'pre' | 'word-wrapper',
    align: 'center' as 'left' | 'center' | 'right',
    letterSpacing: 0,
    lineHeight: 100,
    baseline: 80,
    halo: 0.75,
    gamma: 1,
    shadow: false,
    shadowColor: '#4d4d4d',
    shadowOffsetX: 0.001,
    shadowOffsetY: -0.001,
    shadowGamma: 1,
    outline: true,
    outlineColor: '#4a90e2',
    outlineWidth: 0.06,
    outlineGamma: 1,
  };

  const textMesh = new BitmapText({
    text: params.text,
    fontSize: 72,
    width: 1000,
    mode: params.mode,
    align: params.align,
    letterSpacing: params.letterSpacing,
    lineHeight: params.lineHeight,
    baseline: params.baseline,
    color: 0x333333,
    halo: params.halo,
    gamma: params.gamma,
    shadow: params.shadow,
    shadowColor: params.shadowColor,
    shadowOffset: [params.shadowOffsetX, params.shadowOffsetY],
    shadowGamma: params.shadowGamma,
    outline: params.outline,
    outlineColor: params.outlineColor,
    outlineWidth: params.outlineWidth,
    outlineGamma: params.outlineGamma,
    scale: 0.008,
  });
  scene.add(textMesh);

  addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 0, 0));

  // ── Controls ──
  ctrl.innerHTML = `
    <label><span>文字</span>
    <input type="text" id="inp-bt-text" value="${params.text}" style="width:150px;font-size:11px"></label>
    <label><span>换行</span>
    <select id="inp-bt-mode" style="width:100px">
      <option value="nowrap">nowrap</option>
      <option value="pre">pre</option>
      <option value="word-wrapper" selected>word-wrapper</option>
    </select></label>
    <label><span>对齐</span>
    <select id="inp-bt-align" style="width:70px">
      <option value="left">left</option>
      <option value="center" selected>center</option>
      <option value="right">right</option>
    </select></label>
    <label><span>letterSpacing: <code id="v-bt-ls">0</code></span>
    <input type="range" id="inp-bt-ls" min="-20" max="50" step="1" value="0"></label>
    <label><span>lineHeight: <code id="v-bt-lh">100</code></span>
    <input type="range" id="inp-bt-lh" min="20" max="200" step="1" value="100"></label>
    <label><span>baseline: <code id="v-bt-bl">80</code></span>
    <input type="range" id="inp-bt-bl" min="0" max="150" step="1" value="80"></label>
    <label class="check"><input type="checkbox" id="inp-bt-shadow">阴影 shadow</label>
    <label class="check"><input type="checkbox" id="inp-bt-outline" checked>描边 outline</label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;margin-top:4px">
      <label><span>halo: <code id="v-bt-halo">0.75</code></span>
      <input type="range" id="inp-bt-halo" min="0.3" max="1" step="0.01" value="0.75"></label>
      <label><span>gamma: <code id="v-bt-gamma">1</code></span>
      <input type="range" id="inp-bt-gamma" min="0" max="5" step="0.1" value="1"></label>
      <label><span>outlineWidth: <code id="v-bt-ow">0.06</code></span>
      <input type="range" id="inp-bt-ow" min="0" max="0.15" step="0.005" value="0.06"></label>
      <label><span>opacity: <code id="v-bt-op">1</code></span>
      <input type="range" id="inp-bt-op" min="0" max="1" step="0.1" value="1"></label>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;align-items:center;margin-top:4px">
      <label class="check" style="justify-content:flex-start"><input type="color" id="inp-bt-color" value="#333333">文字</label>
      <label class="check" style="justify-content:flex-start"><input type="color" id="inp-bt-oc" value="#4a90e2">描边</label>
      <label class="check" style="justify-content:flex-start"><input type="color" id="inp-bt-sc" value="#4d4d4d">阴影</label>
    </div>`;

  // ── Geometry update ──
  function updateGeometry() {
    textMesh.setLayout({
      mode: params.mode,
      align: params.align,
      letterSpacing: params.letterSpacing,
      lineHeight: params.lineHeight,
      baseline: params.baseline,
    });
    textMesh.setText(params.text);
  }

  // Text input
  ctrl.querySelector('#inp-bt-text')!.addEventListener('input', (e) => {
    params.text = (e.target as HTMLInputElement).value;
    updateGeometry();
  });

  // Mode select
  ctrl.querySelector('#inp-bt-mode')!.addEventListener('change', (e) => {
    params.mode = (e.target as HTMLSelectElement).value as typeof params.mode;
    updateGeometry();
  });

  // Align select
  ctrl.querySelector('#inp-bt-align')!.addEventListener('change', (e) => {
    params.align = (e.target as HTMLSelectElement).value as typeof params.align;
    updateGeometry();
  });

  // Slider helper
  const bind = (
    sel: string, valId: string,
    apply: (v: number) => void,
    fmt = (v: number) => v.toFixed(1),
  ) => {
    ctrl.querySelector(sel)!.addEventListener('input', (e) => {
      const v = +(e.target as HTMLInputElement).value;
      ctrl.querySelector(`#${valId}`)!.textContent = fmt(v);
      apply(v);
    });
  };

  bind('#inp-bt-ls', 'v-bt-ls', (v) => { params.letterSpacing = v; updateGeometry(); }, (v) => v.toFixed(0));
  bind('#inp-bt-lh', 'v-bt-lh', (v) => { params.lineHeight = v; updateGeometry(); }, (v) => v.toFixed(0));
  bind('#inp-bt-bl', 'v-bt-bl', (v) => { params.baseline = v; updateGeometry(); }, (v) => v.toFixed(0));
  bind('#inp-bt-halo', 'v-bt-halo', (v) => textMesh.setHalo(v), (v) => v.toFixed(2));
  bind('#inp-bt-gamma', 'v-bt-gamma', (v) => textMesh.setGamma(v), (v) => v.toFixed(1));
  bind('#inp-bt-ow', 'v-bt-ow', (v) => { textMesh.setOutlineParams(params.outlineColor, v, params.outlineGamma); }, (v) => v.toFixed(3));
  bind('#inp-bt-op', 'v-bt-op', (v) => textMesh.setOpacity(v), (v) => v.toFixed(1));

  // Shadow toggle
  ctrl.querySelector('#inp-bt-shadow')!.addEventListener('change', (e) => {
    params.shadow = (e.target as HTMLInputElement).checked;
    textMesh.setShadow(params.shadow);
  });

  // Outline toggle
  ctrl.querySelector('#inp-bt-outline')!.addEventListener('change', (e) => {
    params.outline = (e.target as HTMLInputElement).checked;
    textMesh.setOutline(params.outline);
  });

  // Color pickers
  ctrl.querySelector('#inp-bt-color')!.addEventListener('input', (e) => {
    textMesh.setColor((e.target as HTMLInputElement).value);
  });
  ctrl.querySelector('#inp-bt-oc')!.addEventListener('input', (e) => {
    params.outlineColor = (e.target as HTMLInputElement).value;
    textMesh.setOutlineParams(params.outlineColor, params.outlineWidth, params.outlineGamma);
  });
  ctrl.querySelector('#inp-bt-sc')!.addEventListener('input', (e) => {
    params.shadowColor = (e.target as HTMLInputElement).value;
    textMesh.setShadowParams(params.shadowColor, params.shadowOffsetX, params.shadowOffsetY, params.shadowGamma);
  });

  const stop = startLoop(renderer, scene, camera, resize, () => {});

  return () => {
    stop();
    textMesh.dispose();
  };
}
