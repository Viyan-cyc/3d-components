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
      onPointerEnter: (e) => {
        log(`⬆ onPointerEnter→ ${objName(e.eventObject)}`);
      },
      onPointerLeave: (e) => {
        log(`⬇ onPointerLeave→ ${objName(e.eventObject)}`);
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

  // ─── Overlap demo: big sphere + small sphere (parent-child) ──
  // 小球是大球的子对象（bigSphere.add(smallSphere)），部分嵌入大球。
  // 形成三种交互区域：
  //   A. 只在小球上（小球突出大球的部分）——射线只命中 smallSphere
  //   B. 两者重合处（小球嵌入大球的部分）——射线先命中 bigSphere 表面，再命中 smallSphere
  //   C. 只在大球上（大球表面不在小球范围内的部分）——射线只命中 bigSphere
  //
  // 祖先展开（"冒泡"）规则：
  //   每个原始 ray hit 沿 parent 链向上走，每遇到一个注册对象就多产生
  //   一条 Intersection，同一个 hit 的 distance 相同。
  //
  //   - 区域 A：射线只命中 smallSphere → 展开到 bigSphere（parent）
  //             intersections = [(smallSphere, d), (bigSphere, d)]
  //             → 两者都收到事件，小球先派发，大球后派发（同 distance 按列表序）
  //             → 这就是"冒泡"：子对象命中，父对象也收到
  //
  //   - 区域 B：射线命中 bigSphere(d1) + smallSphere(d2)
  //             bigSphere 的 hit 展开只有 bigSphere 自身（无更上注册祖先）
  //             smallSphere 的 hit 展开到 bigSphere（parent）
  //             intersections = [(bigSphere,d1), (smallSphere,d2), (bigSphere,d2)]
  //             → 三条 Intersection 按距离依次派发
  //             → 注意 bigSphere 出现两次：一次是自身被直接命中(d1)，
  //               一次是作为 smallSphere 的祖先展开(d2)
  //
  //   - 区域 C：射线只命中 bigSphere → 无 smallSphere 相关条目
  //             intersections = [(bigSphere, d)]
  //             → 只触发大球事件
  //
  // over/out 的逻辑：基于 composite-id diffing（eventObject/faceIndex/instanceId）
  //   - 从 C→A：smallSphere 从无到有 → over+enter；bigSphere 持续在 → 无变化
  //   - 从 A→C：smallSphere 消失 → out+leave；bigSphere 持续在 → 无变化
  //   - stopPropagation()：子对象调用后，大球不再收到该事件

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
  smallSphereMesh.position.set(0, 1, 0); // 偏移，部分在大球内，部分突出
  // 小球是大球的子对象 → 命中小球时，祖先展开会走到大球（冒泡）
  bigSphereMesh.add(smallSphereMesh);

  let bubbleStopped = false;

  // 冒泡来源标注：e.object 是射线实际命中的对象，e.eventObject 是注册了 handler 的对象
  // 当 e.object !== e.eventObject 时，说明事件是从 e.object 冒泡上来的
  // 注意：只有通过 handleIntersects 派发的事件才冒泡（over/enter/move/click/down/up/wheel/contextMenu）
  // out/leave 由 cancelPointer 直接 per-object 派发，不冒泡，不应使用此标注
  function bubbleTag(e: { object: THREE.Object3D; eventObject: THREE.Object3D }): string {
    return e.object !== e.eventObject ? ` 🔼冒泡自${objName(e.object)}` : '';
  }

  // Register small sphere
  manager.add(smallSphereMesh, {
    onPointerOver: (e) => {
      smallSphereMat.emissive.setHex(0x444444);
      log(`⬆ onPointerOver → ${objName(e.eventObject)}${bubbleTag(e)}`);
      if (bubbleStopped) {
        e.stopPropagation();
        log(`  └─ ${objName(e.eventObject)} stopPropagation() — 后续对象不再收到`);
      }
    },
    onPointerOut: (e) => {
      smallSphereMat.emissive.setHex(0x000000);
      log(`⬇ onPointerOut  → ${objName(e.eventObject)}`);
    },
    onPointerEnter: (e) => {
      log(`⬆ onPointerEnter→ ${objName(e.eventObject)}${bubbleTag(e)}`);
      if (bubbleStopped) {
        e.stopPropagation();
        log(`  └─ ${objName(e.eventObject)} stopPropagation() — 后续对象不再收到`);
      }
    },
    onPointerLeave: (e) => {
      log(`⬇ onPointerLeave→ ${objName(e.eventObject)}`);
    },
    onPointerMove: (e) => {
      log(`↔ onPointerMove → ${objName(e.eventObject)}${bubbleTag(e)}`);
      if (bubbleStopped) {
        e.stopPropagation();
      }
    },
    onClick: (e) => {
      log(`🖱 onClick       → ${objName(e.eventObject)}${bubbleTag(e)}`);
      if (bubbleStopped) {
        e.stopPropagation();
        log(`  └─ ${objName(e.eventObject)} stopPropagation() — 后续对象不再收到`);
      }
    },
    onContextMenu: (e) => {
      log(`📋 onContextMenu → ${objName(e.eventObject)}${bubbleTag(e)}`);
      if (bubbleStopped) {
        e.stopPropagation();
      }
    },
  });

  // Register big sphere
  manager.add(bigSphereMesh, {
    onPointerOver: (e) => {
      bigSphereMat.emissive.setHex(0x222222);
      log(`⬆ onPointerOver → ${objName(e.eventObject)}${bubbleTag(e)}`);
    },
    onPointerOut: (e) => {
      bigSphereMat.emissive.setHex(0x000000);
      log(`⬇ onPointerOut  → ${objName(e.eventObject)}`);
    },
    onPointerEnter: (e) => {
      log(`⬆ onPointerEnter→ ${objName(e.eventObject)}${bubbleTag(e)}`);
    },
    onPointerLeave: (e) => {
      log(`⬇ onPointerLeave→ ${objName(e.eventObject)}`);
    },
    onPointerMove: (e) => {
      log(`↔ onPointerMove → ${objName(e.eventObject)}${bubbleTag(e)}`);
    },
    onClick: (e) => {
      log(`🖱 onClick       → ${objName(e.eventObject)}${bubbleTag(e)}`);
    },
    onContextMenu: (e) => {
      log(`📋 onContextMenu → ${objName(e.eventObject)}${bubbleTag(e)}`);
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
      <b>事件模型</b><br>
      • 每个原始 ray hit 沿 parent 链展开到注册祖先<br>
      • 展开后按 distance 排序，扁平列表依次派发<br>
      • stopPropagation() 中断后续派发<br>
      • over+enter 同时触发；out+leave 同时触发<br>
      • click 仅在 pointerDown 命中的对象上触发<br>
      <b>重叠演示（小球是大球子对象）</b><br>
      • A区(仅小球)→小球+大球都收到(祖先展开)<br>
      • B区(重叠)→大球直接命中+小球命中展开到大球<br>
      • C区(仅大球)→只有大球事件<br>
      • 勾选阻止传播后，小球stopPropagation可阻止大球收到
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
