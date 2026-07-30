import * as THREE from 'three';
import { animate, registerEasing } from '../../../src/animation';
import { createScene, createGround, startLoop, addSimpleOrbit } from '../../shared/scene-setup';

// ---- Animation Demo ----
export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): () => void {
  const { renderer, scene, camera, resize } = createScene(canvas);
  camera.position.set(5, 4, 8);
  camera.lookAt(0, 0, 0);

  // 地面
  const floor = createGround();
  scene.add(floor);

  addSimpleOrbit(canvas, camera);

  // ─── 创建演示对象 ────────────────────────────────────

  // 主方块：用于串行/并行/控制演示
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x4488ff, roughness: 0.4, metalness: 0.2 });
  const box = new THREE.Mesh(boxGeo, boxMat);
  box.position.set(-3, 0.5, 0);
  box.castShadow = true;
  scene.add(box);

  // 十二面体：用于 from/to 演示
  const dodecGeo = new THREE.DodecahedronGeometry(0.55);
  const dodecMat = new THREE.MeshStandardMaterial({ color: 0xff6644, roughness: 0.3, metalness: 0.3 });
  const dodec = new THREE.Mesh(dodecGeo, dodecMat);
  dodec.position.set(0, 0.5, 0);
  dodec.castShadow = true;
  scene.add(dodec);

  // 圆环：用于 repeat/yoyo 演示
  const torusGeo = new THREE.TorusGeometry(0.4, 0.15, 16, 48);
  const torusMat = new THREE.MeshStandardMaterial({ color: 0x44cc88, roughness: 0.3, metalness: 0.3 });
  const torus = new THREE.Mesh(torusGeo, torusMat);
  torus.position.set(3, 0.5, 0);
  torus.castShadow = true;
  scene.add(torus);

  // 小立方体组：用于多目标演示
  const cubes: THREE.Mesh[] = [];
  const cubeColors = [0xff4444, 0xffaa00, 0x44ff44, 0x4488ff, 0xaa44ff];
  for (let i = 0; i < 5; i++) {
    const cGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
    const cMat = new THREE.MeshStandardMaterial({ color: cubeColors[i], roughness: 0.4, metalness: 0.2 });
    const c = new THREE.Mesh(cGeo, cMat);
    c.position.set(-2 + i, 0.175, -2);
    c.castShadow = true;
    scene.add(c);
    cubes.push(c);
  }

  // 标签（HTML 覆盖层，显示当前动画名）
  const labelDiv = document.createElement('div');
  labelDiv.textContent = '点击下方按钮开始演示';
  labelDiv.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);'
    + 'padding:6px 16px;background:rgba(255,255,255,0.85);border-radius:6px;'
    + 'font:bold 15px/1.4 sans-serif;color:#333;pointer-events:none;white-space:nowrap;'
    + 'backdrop-filter:blur(4px);box-shadow:0 1px 4px rgba(0,0,0,0.1);z-index:2';
  canvas.parentElement!.style.position = 'relative';
  canvas.parentElement!.appendChild(labelDiv);

  function setLabel(text: string) {
    labelDiv.textContent = text;
  }

  // ─── 动画实例引用（用于控制按钮） ──────────────────────

  let currentAnim: ReturnType<typeof animate> | null = null;

  /** 停止当前动画并重置所有对象位置 */
  function resetAll() {
    if (currentAnim) {
      currentAnim.destroy();
      currentAnim = null;
    }
    box.position.set(-3, 0.5, 0);
    box.rotation.set(0, 0, 0);
    box.scale.set(1, 1, 1);
    boxMat.color.set(0x4488ff);

    dodec.position.set(0, 0.5, 0);
    dodec.rotation.set(0, 0, 0);
    dodec.scale.set(1, 1, 1);
    dodecMat.color.set(0xff6644);

    torus.position.set(3, 0.5, 0);
    torus.rotation.set(0, 0, 0);
    torus.scale.set(1, 1, 1);
    torusMat.color.set(0x44cc88);

    cubes.forEach((c, i) => {
      c.position.set(-2 + i, 0.175, -2);
      c.scale.set(1, 1, 1);
    });
  }

  // ─── 注册自定义缓动 ───────────────────────────────────

  registerEasing('customElastic', (t) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  });

  // ─── 演示场景 ─────────────────────────────────────────

  const demos: Record<string, () => void> = {

    /** 1. 基础单步动画：方块右移 + 变色 */
    basic() {
      resetAll();
      setLabel('基础动画: to + ease');
      currentAnim = animate(box, {
        to: { position: { x: -1 }, 'material.color': '#ff8800' },
        duration: 1,
        ease: 'easeOut',
        onComplete: () => setLabel('完成 ✓'),
      });
      currentAnim.play();
    },

    /** 2. 串行编排：方块 → 移动 → 旋转 → 变色 */
    serial() {
      resetAll();
      setLabel('串行编排: .to().to().to()');
      currentAnim = animate(box)
        .to({ position: { x: -1 } }, { duration: 0.5, ease: 'easeOut' })
        .to({ rotation: { y: Math.PI * 2 } }, { duration: 0.6, ease: 'easeInOut' })
        .to({ 'material.color': '#ff4488' }, { duration: 0.4, ease: 'easeIn' })
      ;
      currentAnim.play();
    },

    /** 3. 并行编排：球体同时移动+旋转+变色 */
    parallel() {
      resetAll();
      setLabel('并行编排: .parallel([...])');
      currentAnim = animate(dodec)
        .parallel([
          (g) => g.to({ position: { y: 2 } }, { duration: 0.8, ease: 'easeOut' }),
          (g) => g.to({ rotation: { y: Math.PI } }, { duration: 0.8, ease: 'easeInOut' }),
          (g) => g.to({ 'material.color': '#ffff00' }, { duration: 0.8, ease: 'linear' }),
        ])
      ;
      currentAnim.play();
    },

    /** 4. 混合编排：先移动，再同时旋转+变色，最后缩放 */
    mixed() {
      resetAll();
      setLabel('混合编排: 串行+并行');
      currentAnim = animate(box)
        .to({ position: { x: -1 } }, { duration: 0.5, ease: 'easeOut' })
        .parallel([
          (g) => g.to({ rotation: { y: Math.PI } }, { duration: 0.5, ease: 'easeInOut' }),
          (g) => g.to({ 'material.color': '#ff0044' }, { duration: 0.5, ease: 'linear' }),
        ])
        .to({ scale: { x: 1.5, y: 1.5, z: 1.5 } }, { duration: 0.3, ease: 'easeOutBack' })
      ;
      currentAnim.play();
    },

    /** 5. 并行中嵌套串行 */
    parallelSerial() {
      resetAll();
      setLabel('并行中嵌套串行');
      currentAnim = animate(dodec)
        .parallel([
          (g) => g
            .to({ position: { x: 2 } }, { duration: 0.5, ease: 'easeOut', onUpdate: (progress) => console.log(`移动进度: ${(progress * 100).toFixed(0)}%`) })
            .to({ position: { y: 2 } }, { duration: 0.5, ease: 'easeOut', onUpdate: (progress) => console.log(`上升进度: ${(progress * 100).toFixed(0)}%`) }),
          (g) => g
            .to({ rotation: { y: Math.PI * 2 } }, { duration: 0.8, ease: 'easeInOut', onUpdate: (progress) => console.log(`旋转进度: ${(progress * 100).toFixed(0)}%`) }),
        ])
      ;
      currentAnim.play();
    },


    /** 6. from 动画：从远处飞入 */
    from() {
      resetAll();
      setLabel('from 动画: 从远处飞入');
      currentAnim = animate(dodec, {
        from: { position: { x: -5, y: 5 } },
        to: { position: { x: 0, y: 0.5 } },
        duration: 1,
        ease: 'easeOutCubic',
      });
      // 立即设置 from 起始位置让用户看到初始状态
      dodec.position.set(-5, 5, 0);
      currentAnim.play();
    },

    /** 7. repeat + yoyo */
    repeatYoyo() {
      resetAll();
      setLabel('repeat=3, yoyo=true');
      currentAnim = animate(torus, {
        to: { position: { y: 2 } },
        duration: 0.6,
        ease: 'easeInOut',
        repeat: 3,
        yoyo: true,
        onComplete: () => setLabel('所有重复完成 ✓'),
      });
      currentAnim.play();
    },

    /** 8. 多目标同时动画 */
    multiTarget() {
      resetAll();
      setLabel('多目标: animate([...])');
      currentAnim = animate(cubes, {
        to: { position: { y: 2 } },
        duration: 0.8,
        ease: 'easeOutBack',
      });
      currentAnim.play();
    },

    /** 9. 控制演示：可手动 play/pause/resume/seek/stop */
    control() {
      resetAll();
      setLabel('控制演示: play/pause/seek');
      currentAnim = animate(box, {
        to: { position: { x: -1 }, rotation: { y: Math.PI }, 'material.color': '#ff8800' },
        duration: 3,
        ease: 'easeInOut',
      });
      currentAnim.play();
    },

    /** 10. 自定义缓动 */
    customEase() {
      resetAll();
      setLabel('自定义缓动: customElastic');
      currentAnim = animate(dodec, {
        to: { position: { x: 2 } },
        duration: 1.5,
        ease: 'customElastic',
      });
      currentAnim.play();
    },

    /** 11. 纯 onUpdate 模式 */
    pureOnUpdate() {
      resetAll();
      setLabel('纯 onUpdate: 进度驱动');
      let startScale = 1;
      currentAnim = animate(torus, {
        duration: 2,
        ease: 'easeInOut',
        onStart: () => { startScale = torus.scale.x; },
        onUpdate: (progress) => {
          const s = startScale + Math.sin(progress * Math.PI) * 0.8;
          torus.scale.set(s, s, s);
          torus.rotation.y = progress * Math.PI * 2;
        },
      });
      currentAnim.play();
    },

    /** 12. 多目标 + 纯 onUpdate */
    multiTargetOnUpdate() {
      resetAll();
      setLabel('多目标 + onUpdate');
      currentAnim = animate(cubes, {
        duration: 1.5,
        ease: 'easeInOut',
        onUpdate: (progress) => {
          cubes.forEach((c, i) => {
            const offset = i * 0.15; // 逐个错开
            const p = Math.max(0, Math.min(1, (progress - offset) / (1 - offset)));
            c.position.y = 0.175 + Math.sin(p * Math.PI) * 2;
            c.rotation.y = p * Math.PI * 2;
            (c.material as THREE.MeshStandardMaterial).opacity = 1 - p * 0.5;
          });
        },
      });
      currentAnim.play();
    },
  };

  // ─── UI 控件 ──────────────────────────────────────────

  ctrl.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">
      <button id="btn-anim-basic" class="active">基础动画</button>
      <button id="btn-anim-serial">串行编排</button>
      <button id="btn-anim-parallel">并行编排</button>
      <button id="btn-anim-mixed">混合编排</button>
      <button id="btn-anim-parallelSerial">并行嵌套串行</button>
      <button id="btn-anim-from">from 动画</button>
      <button id="btn-anim-repeatYoyo">repeat+yoyo</button>
      <button id="btn-anim-multiTarget">多目标</button>
      <button id="btn-anim-multiTargetOnUpdate">多目标+onUpdate</button>
      <button id="btn-anim-control">控制演示</button>
      <button id="btn-anim-customEase">自定义缓动</button>
      <button id="btn-anim-pureOnUpdate">onUpdate</button>
    </div>
    <div id="anim-ctrl-panel" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">
      <button id="btn-anim-play">▶ play</button>
      <button id="btn-anim-pause">⏸ pause</button>
      <button id="btn-anim-resume">▶ resume</button>
      <button id="btn-anim-stop">⏹ stop</button>
      <button id="btn-anim-restart">↺ restart</button>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <label><span>seek: <code id="v-anim-progress">0.00</code></span>
      <input type="range" id="inp-anim-seek" min="0" max="1" step="0.01" value="0"></label>
      <span id="v-anim-state" style="font-size:12px;color:#888">idle</span>
    </div>
  `;

  // 演示按钮切换
  const demoButtons = ctrl.querySelectorAll('[id^="btn-anim-"]:not([id="btn-anim-play"]):not([id="btn-anim-pause"]):not([id="btn-anim-resume"]):not([id="btn-anim-stop"]):not([id="btn-anim-restart"])');

  demoButtons.forEach((btn) => {
    const el = btn as HTMLButtonElement;
    const demoKey = el.id.replace('btn-anim-', '');
    if (demos[demoKey]) {
      el.addEventListener('click', () => {
        demoButtons.forEach((b) => b.classList.remove('active'));
        el.classList.add('active');
        demos[demoKey]();
      });
    }
  });

  // 控制按钮
  ctrl.querySelector('#btn-anim-play')!.addEventListener('click', () => {
    currentAnim?.play();
  });
  ctrl.querySelector('#btn-anim-pause')!.addEventListener('click', () => {
    currentAnim?.pause();
  });
  ctrl.querySelector('#btn-anim-resume')!.addEventListener('click', () => {
    currentAnim?.resume();
  });
  ctrl.querySelector('#btn-anim-stop')!.addEventListener('click', () => {
    currentAnim?.stop();
  });
  ctrl.querySelector('#btn-anim-restart')!.addEventListener('click', () => {
    currentAnim?.restart();
  });

  // seek 滑块
  const seekInput = ctrl.querySelector('#inp-anim-seek') as HTMLInputElement;
  const progressLabel = ctrl.querySelector('#v-anim-progress')!;
  const stateLabel = ctrl.querySelector('#v-anim-state')!;

  seekInput.addEventListener('input', () => {
    const v = +(seekInput as HTMLInputElement).value;
    if (currentAnim) {
      currentAnim.seek(v);
    }
  });

  // ─── 渲染循环 ─────────────────────────────────────────

  const stop = startLoop(renderer, scene, camera, resize, () => {
    // 每帧更新进度显示
    if (currentAnim) {
      const progress = currentAnim.getProgress();
      const state = currentAnim.getState();
      progressLabel.textContent = progress.toFixed(2);
      stateLabel.textContent = state;
      // 同步 seek 滑块（仅在非拖动时）
      if (document.activeElement !== seekInput) {
        seekInput.value = progress.toFixed(2);
      }
    }
  });

  // ─── 清理 ─────────────────────────────────────────────

  return () => {
    stop();
    if (currentAnim) {
      currentAnim.destroy();
      currentAnim = null;
    }
    boxGeo.dispose(); boxMat.dispose();
    dodecGeo.dispose(); dodecMat.dispose();
    torusGeo.dispose(); torusMat.dispose();
    cubes.forEach((c) => {
      (c.geometry as THREE.BufferGeometry).dispose();
      ((c as THREE.Mesh).material as THREE.Material).dispose();
    });
    labelDiv.remove();
  };
}
