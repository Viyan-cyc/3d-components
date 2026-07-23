import * as THREE from 'three';
import { PivotControls } from '../../../src/controls';
import type { PivotControlsOptions } from '../../../src/controls';
import { createScene, createGround, addSimpleOrbit, startLoop } from '../../shared/scene-setup';

// ---- PivotControls Demo ----
// 演示四类操控件（轴 / 平面 / 旋转 / 缩放）一体操控一个 TorusKnot 模型。
// 结构性开关（fixed / annotations / disable*）通过重建 PivotControls 切换；
// 显示 / 启用开关走 setVisible / setEnabled（无需重建）。
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): () => void {
  const { renderer, scene, camera, resize } = createScene(canvas);
  camera.position.set(3.6, 2.6, 4.6);
  camera.lookAt(0, 0.2, 0);

  const controls = addSimpleOrbit(canvas, camera, () => new THREE.Vector3(0, 0.2, 0));
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // 地面
  const ground = createGround(20);
  ground.position.y = -1.1;
  scene.add(ground);

  // 受控模型（TorusKnot —— 旋转 / 缩放都看得清）
  const model = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.55, 0.18, 160, 24),
    new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.45, metalness: 0.15 }),
  );
  model.castShadow = true;
  model.receiveShadow = true;

  // ---- PivotControls 状态 + 重建 ----
  const opts = {
    fixed: false,
    annotations: true,
    disableAxes: false,
    disableSliders: false,
    disableRotations: false,
    disableScaling: false,
  };

  let pivot: PivotControls | null = null;
  const buildPivot = (): void => {
    if (pivot) {
      pivot.remove(model);
      pivot.dispose();
      scene.remove(pivot);
    }
    const pcOpts: PivotControlsOptions = {
      camera,
      renderer,
      controls,
      scale: 1,
      lineWidth: 4,
      fixed: opts.fixed,
      annotations: opts.annotations,
      disableAxes: opts.disableAxes,
      disableSliders: opts.disableSliders,
      disableRotations: opts.disableRotations,
      disableScaling: opts.disableScaling,
      depthTest: false, // gizmo 穿透显示，便于演示
    };
    pivot = new PivotControls(pcOpts);
    pivot.add(model);
    scene.add(pivot);
  };
  buildPivot();

  // ---- 控制面板 ----
  const ids = {
    annotations: 'inp-pivot-anno',
    fixed: 'inp-pivot-fixed',
    axes: 'inp-pivot-axes',
    sliders: 'inp-pivot-sliders',
    rotations: 'inp-pivot-rot',
    scaling: 'inp-pivot-scale',
    visible: 'inp-pivot-visible',
    enabled: 'inp-pivot-enabled',
    reset: 'btn-pivot-reset',
    readout: 'v-pivot-readout',
  };

  ctrl.innerHTML = `
    <label><input type="checkbox" id="${ids.annotations}" checked>注释 annotations</label>
    <label><input type="checkbox" id="${ids.fixed}">固定像素 fixed</label>
    <label><input type="checkbox" id="${ids.axes}" checked>轴箭头</label>
    <label><input type="checkbox" id="${ids.sliders}" checked>平面滑块</label>
    <label><input type="checkbox" id="${ids.rotations}" checked>旋转弧</label>
    <label><input type="checkbox" id="${ids.scaling}" checked>缩放球</label>
    <label><input type="checkbox" id="${ids.visible}" checked>显示 gizmo</label>
    <label><input type="checkbox" id="${ids.enabled}" checked>启用交互</label>
    <button id="${ids.reset}" type="button">重置变换</button>
    <pre id="${ids.readout}" style="opacity:.75;font-size:11px;line-height:1.5;margin:6px 0 0"></pre>
    <p style="opacity:.7;font-size:12px;margin:4px 0 0">拖轴/平面 = 平移；拖弧 = 旋转（Shift 吸附 10°）；拖球 = 缩放（Shift 吸附 0.1）。拖拽时轨道自动暂停。</p>`;

  const checkbox = (id: string): HTMLInputElement => ctrl.querySelector(`#${id}`) as HTMLInputElement;

  // 直接映射：勾选状态 == 选项值
  const bindRebuild = (id: string, key: 'annotations' | 'fixed'): void => {
    checkbox(id).addEventListener('change', (e) => {
     	opts[key] = (e.target as HTMLInputElement).checked;
      buildPivot();
    });
  };
  // 取反映射：勾选 = 启用该类操控件（选项为 disable*）
  const bindDisable = (id: string, key: 'disableAxes' | 'disableSliders' | 'disableRotations' | 'disableScaling'): void => {
    checkbox(id).addEventListener('change', (e) => {
     	opts[key] = !(e.target as HTMLInputElement).checked;
      buildPivot();
    });
  };

  bindRebuild(ids.annotations, 'annotations');
  bindRebuild(ids.fixed, 'fixed');
  bindDisable(ids.axes, 'disableAxes');
  bindDisable(ids.sliders, 'disableSliders');
  bindDisable(ids.rotations, 'disableRotations');
  bindDisable(ids.scaling, 'disableScaling');
  checkbox(ids.visible).addEventListener('change', (e) => pivot?.setVisible((e.target as HTMLInputElement).checked));
  checkbox(ids.enabled).addEventListener('change', (e) => pivot?.setEnabled((e.target as HTMLInputElement).checked));
  ctrl.querySelector(`#${ids.reset}`)!.addEventListener('click', buildPivot);

  // ---- 读出当前变换 ----
  const readout = ctrl.querySelector(`#${ids.readout}`)!;
  const _pos = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const _scl = new THREE.Vector3();
  const _euler = new THREE.Euler();

  // ---- 渲染循环 ----
  const tick = (dt: number): void => {
    controls.update();
    pivot?.update(dt);
    if (pivot) {
      pivot.matrix.decompose(_pos, _quat, _scl);
      _euler.setFromQuaternion(_quat);
      readout.textContent =
        `pos    ${_pos.x.toFixed(2)}, ${_pos.y.toFixed(2)}, ${_pos.z.toFixed(2)}\n` +
        `rot(°) ${THREE.MathUtils.radToDeg(_euler.x).toFixed(0)}, ${THREE.MathUtils.radToDeg(_euler.y).toFixed(0)}, ${THREE.MathUtils.radToDeg(_euler.z).toFixed(0)}\n` +
        `scale  ${_scl.x.toFixed(2)}, ${_scl.y.toFixed(2)}, ${_scl.z.toFixed(2)}`;
    }
  };
  const stop = startLoop(renderer, scene, camera, resize, tick);

  // ---- 卸载 ----
  return () => {
    stop();
    pivot?.dispose();
    (model.material as THREE.Material).dispose();
    model.geometry.dispose();
    scene.remove(ground);
  };
}
