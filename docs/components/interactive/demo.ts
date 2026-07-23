import * as THREE from 'three';
import { InteractiveManager } from '../../../src/interactive';
import { createScene, startLoop, addSimpleOrbit, createGround } from '../../shared/scene-setup';

export function initDemo(canvas: HTMLCanvasElement, ctrl: HTMLElement): () => void {
  const { renderer, scene, camera, resize } = createScene(canvas);
  const orbit = addSimpleOrbit(canvas, camera);

  // Ground
  const ground = createGround();
  ground.name = 'Ground';
  scene.add(ground);

  // ─── Log helper ────────────────────────────────────────────
  const logLines: string[] = [];
  function log(msg: string) {
    const now = new Date();
    const ts = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    logLines.push(`[${ts}] ${msg}`);
    if (logLines.length > 80) logLines.shift();
    const el = document.getElementById('im-log');
    if (el) {
      el.textContent = logLines.join('\n');
      el.scrollTop = el.scrollHeight;
    }
  }

  function objName(obj: THREE.Object3D): string {
    return obj.name || obj.type;
  }

  // ─── InteractiveManager ───────────────────────────────────
  const manager = new InteractiveManager({
    camera,
    domElement: renderer.domElement,
    scene,
    controls: orbit,
  });

  // ─── Interactive boxes ───────────────────────────────────
  const boxNames = ['RedBox', 'BlueBox', 'GreenBox', 'OrangeBox'];
  const colors = [0xe94560, 0x0f3460, 0x16c79a, 0xf5a623];
  const meshes: THREE.Mesh[] = [];
  const materials: THREE.MeshStandardMaterial[] = [];

  for (let i = 0; i < 4; i++) {
    const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const mat = new THREE.MeshStandardMaterial({ color: colors[i], roughness: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = boxNames[i];
    mesh.position.set((i - 1.5) * 1.5, 0.4, 0);
    mesh.castShadow = true;
    scene.add(mesh);
    meshes.push(mesh);
    materials.push(mat);

    manager.add(mesh, {
      onPointerOver: (e) => {
        mat.emissive.setHex(0x333333);
        log(`⬆ onPointerOver → ${objName(e.eventObject)}`);
      },
      onPointerOut: (e) => {
        mat.emissive.setHex(0x000000);
        log(`⬇ onPointerOut  → ${objName(e.eventObject)}`);
      },
      onPointerDown: (e) => {
        log(`⏬ onPointerDown → ${objName(e.eventObject)}`);
      },
      onPointerUp: (e) => {
        log(`⏫ onPointerUp   → ${objName(e.eventObject)}`);
      },
      onClick: (e) => {
        const s = e.eventObject.scale.x > 1 ? 1 : 1.5;
        e.eventObject.scale.setScalar(s);
        log(`🖱 onClick       → ${objName(e.eventObject)} (scale → ${s.toFixed(1)})`);
      },
      onDoubleClick: (e) => {
        e.eventObject.scale.setScalar(1);
        log(`🖱🖱 onDoubleClick→ ${objName(e.eventObject)} (scale → 1.0)`);
      },
      onPointerMove: (e) => {
        log(`↔ onPointerMove → ${objName(e.eventObject)}`);
      },
      onContextMenu: (e) => {
        log(`📋 onContextMenu → ${objName(e.eventObject)}`);
      },
      onWheel: (e) => {
        log(`🔄 onWheel       → ${objName(e.eventObject)}`);
      },
    });
  }

  // ─── Overlap demo: big sphere + small sphere ──────────────
  // 小球只有一部分嵌入大球，形成三种交互区域：
  //   A. 只在小球上（小球突出大球的部分）
  //   B. 两者重合处（小球嵌入大球的部分）
  //   C. 只在大球上（大球表面不在小球范围内的部分）
  //
  // R3F 模型下，两个对象是**独立的**注册对象（非父子关系）。
  // 射线检测的结果是按 distance 排序的扁平列表，每个原始 hit 会向
  // 上展开到所有注册的祖先。但大球和小球互不为祖先，所以：
  //   - 区域 A：只有小球的 intersection → 只触发小球事件
  //   - 区域 B：射线先击中大球表面，再击中小球表面（或反之），
  //             两个对象都会出现在 flat intersections 列表中，
  //             事件按 distance 顺序依次派发（近的先）
  //   - 区域 C：只有大球的 intersection → 只触发大球事件
  //
  // over/out 的逻辑：基于 composite-id diffing。
  //   - 进入重叠区时，如果之前只悬停了其中一个，另一个的 over+enter 会触发
  //   - 离开重叠区时，离开的那个触发 out+leave
  //   - 两者独立追踪，互不影响

  const bigSphereMat = new THREE.MeshStandardMaterial({
    color: 0x9b59b6,
    roughness: 0.3,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const bigSphereMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.0, 32, 32),
    bigSphereMat,
  );
  bigSphereMesh.name = 'BigSphere';
  bigSphereMesh.position.set(0, 1.0, -2);
  scene.add(bigSphereMesh);

  // 小球中心偏移，使其只有一部分在大球内
  const smallSphereMat = new THREE.MeshStandardMaterial({ color: 0xff6b6b, roughness: 0.3 });
  const smallSphereMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 32, 32),
    smallSphereMat,
  );
  smallSphereMesh.name = 'SmallSphere';
  smallSphereMesh.position.set(0.7, 0.3, 0.6); // 偏移，部分在大球内，部分突出
  // 注意：小球是 scene.add，不是 bigSphere.add！两者是同级，非父子
  scene.add(smallSphereMesh);

  let bubbleStopped = false;

  // Register small sphere
  manager.add(smallSphereMesh, {
    onPointerOver: (e) => {
      smallSphereMat.emissive.setHex(0x444444);
      log(`⬆ onPointerOver → ${objName(e.eventObject)}`);
    },
    onPointerOut: (e) => {
      smallSphereMat.emissive.setHex(0x000000);
      log(`⬇ onPointerOut  → ${objName(e.eventObject)}`);
    },
    onPointerEnter: (e) => {
      log(`⬆ onPointerEnter→ ${objName(e.eventObject)}`);
    },
    onPointerLeave: (e) => {
      log(`⬇ onPointerLeave→ ${objName(e.eventObject)}`);
    },
    onPointerMove: (e) => {
      log(`↔ onPointerMove → ${objName(e.eventObject)}`);
    },
    onClick: (e) => {
      log(`🖱 onClick       → ${objName(e.eventObject)}`);
      if (bubbleStopped) {
        e.stopPropagation();
        log(`  └─ ${objName(e.eventObject)} stopPropagation() — 后续对象不再收到`);
      }
    },
    onContextMenu: (e) => {
      log(`📋 onContextMenu → ${objName(e.eventObject)}`);
      if (bubbleStopped) {
        e.stopPropagation();
      }
    },
  });

  // Register big sphere
  manager.add(bigSphereMesh, {
    onPointerOver: (e) => {
      bigSphereMat.emissive.setHex(0x222222);
      log(`⬆ onPointerOver → ${objName(e.eventObject)}`);
    },
    onPointerOut: (e) => {
      bigSphereMat.emissive.setHex(0x000000);
      log(`⬇ onPointerOut  → ${objName(e.eventObject)}`);
    },
    onPointerEnter: (e) => {
      log(`⬆ onPointerEnter→ ${objName(e.eventObject)}`);
    },
    onPointerLeave: (e) => {
      log(`⬇ onPointerLeave→ ${objName(e.eventObject)}`);
    },
    onPointerMove: (e) => {
      log(`↔ onPointerMove → ${objName(e.eventObject)}`);
    },
    onClick: (e) => {
      const bubbled = e.eventObject !== e.object;
      log(`🖱 onClick       → ${objName(e.eventObject)}${bubbled ? ' 🔵 同一射线命中' : ''}`);
    },
    onContextMenu: (e) => {
      const bubbled = e.eventObject !== e.object;
      log(`📋 onContextMenu → ${objName(e.eventObject)}${bubbled ? ' 🔵 同一射线命中' : ''}`);
    },
  });

  // ─── Pointer missed demo ────────────────────────────────
  manager.add(ground, {
    onPointerMissed: () => {
      log('❌ onPointerMissed → 点击了空白区域');
    },
  });

  // ─── Controls (right floating panel) ────────────────────
  ctrl.innerHTML = `
    <h3>InteractiveManager</h3>
    <p style="margin:0">悬停→高亮 左键点击→缩放</p>
    <p style="margin:0">双击→复原 右键→contextMenu</p>
    <p style="margin:0">滚轮→wheel 球体→重叠演示</p>
    <label style="display:flex;align-items:center;gap:6px">
      <input type="checkbox" id="im-bubble-stop" /> 阻止传播
    </label>
    <label style="display:flex;align-items:center;gap:6px">
      <input type="checkbox" id="im-enabled" checked /> 启用
    </label>
    <button id="im-dispose">Dispose</button>
    <div class="info" style="margin-top:6px;border-top:1px solid var(--border-lighter);padding-top:6px">
      <b>R3F 事件模型</b><br>
      • 射线按 distance 排序，扁平列表依次派发<br>
      • stopPropagation() 中断后续派发<br>
      • over+enter 同时触发；out+leave 同时触发<br>
      • click 仅在 pointerDown 命中的对象上触发<br>
      <b>重叠演示</b><br>
      • 大球/小球同级（非父子），各自独立注册<br>
      • A区(仅小球)→只有小球事件<br>
      • B区(重叠)→两者都收到，按距离排序<br>
      • C区(仅大球)→只有大球事件<br>
      • 勾选阻止传播后，近处对象stopPropagation可阻止远处对象
    </div>
  `;

  const chkBubble = ctrl.querySelector('#im-bubble-stop') as HTMLInputElement;
  const chkEnabled = ctrl.querySelector('#im-enabled') as HTMLInputElement;
  const btnDispose = ctrl.querySelector('#im-dispose') as HTMLButtonElement;

  chkBubble.addEventListener('change', () => {
    bubbleStopped = chkBubble.checked;
  });

  chkEnabled.addEventListener('change', () => {
    manager.setEnabled(chkEnabled.checked);
  });

  let disposed = false;
  btnDispose.addEventListener('click', () => {
    if (disposed) return;
    manager.dispose();
    disposed = true;
    btnDispose.disabled = true;
    btnDispose.textContent = '已 Dispose';
    log('Manager 已 dispose，事件不再响应');
  });

  // ─── Event log panel (left-bottom floating) ─────────────
  const demoCard = canvas.closest('.demo-card')!;
  const logPanel = document.createElement('div');
  logPanel.id = 'im-log-wrap';
  logPanel.innerHTML = `
    <div id="im-log-header"><span>📋 事件日志</span><button id="im-log-clear">清空</button></div>
    <pre id="im-log"></pre>
  `;
  demoCard.appendChild(logPanel);

  // Bind log clear button
  logPanel.querySelector('#im-log-clear')!.addEventListener('click', () => {
    logLines.length = 0;
    const el = document.getElementById('im-log');
    if (el) el.textContent = '';
  });

  // ─── Render loop ────────────────────────────────────────
  const stop = startLoop(renderer, scene, camera, resize, () => {
    orbit.update();
  });

  // ─── Cleanup ────────────────────────────────────────────
  return () => {
    stop();
    if (!disposed) manager.dispose();
    logPanel.remove();
    meshes.forEach(m => { m.geometry.dispose(); });
    materials.forEach(m => { m.dispose(); });
    bigSphereMat.dispose();
    smallSphereMat.dispose();
    bigSphereMesh.geometry.dispose();
    smallSphereMesh.geometry.dispose();
    scene.remove(bigSphereMesh);
    scene.remove(smallSphereMesh);
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
  };
}
