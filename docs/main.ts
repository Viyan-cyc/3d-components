import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import 'highlight.js/styles/github.css';

import './style.css';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('bash', bash);

// ===================== SIDEBAR FOLDERS =====================
document.querySelectorAll<HTMLButtonElement>('.nav-folder').forEach((btn) => {
  btn.addEventListener('click', () => {
    const group = btn.parentElement!;
    group.classList.toggle('open');
    // expand parent group when opening a folder
    if (group.classList.contains('open')) {
      group.querySelectorAll<HTMLElement>('.nav-group').forEach((g) => g.classList.add('open'));
    }
  });
});

// ===================== SIDEBAR SEARCH =====================
const searchInput = document.getElementById('search') as HTMLInputElement;
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  const tree = document.getElementById('nav-tree')!;

  if (!q) {
    // Show all
    tree.querySelectorAll('.nav-item, .nav-group, .nav-fn, .nav-label, .nav-divider, .nav-folder').forEach((el) => {
      (el as HTMLElement).style.display = '';
    });
    // Re-collapse groups
    tree.querySelectorAll('.nav-group').forEach((g) => g.classList.remove('open'));
    return;
  }

  // Hide everything first
  tree.querySelectorAll('.nav-item, .nav-group, .nav-fn, .nav-label, .nav-divider').forEach((el) => {
    (el as HTMLElement).style.display = 'none';
  });
  tree.querySelectorAll<HTMLElement>('.nav-folder').forEach((el) => { el.style.display = 'none'; });

  // Show matching items and their parents
  tree.querySelectorAll<HTMLElement>('.nav-page, .nav-fn').forEach((el) => {
    const text = (el.dataset.search || el.textContent || '').toLowerCase();
    if (text.includes(q)) {
      el.style.display = '';
      // Show parent group
      const group = el.closest('.nav-group');
      if (group) {
        group.style.display = '';
        group.classList.add('open');
        const folder = group.querySelector<HTMLElement>('.nav-folder');
        if (folder) folder.style.display = '';
        // Show labels in between
        group.querySelectorAll<HTMLElement>('.nav-label').forEach((l) => { l.style.display = ''; });
      }
      // Show dividers before visible elements
      const prevDivider = el.parentElement?.previousElementSibling;
      if (prevDivider?.classList.contains('nav-divider')) {
        (prevDivider as HTMLElement).style.display = '';
      }
    }
  });
});

// ===================== PAGE ROUTER =====================
// 每个组件页面拆成独立目录维护：
//   组件  → components/<name>/index.html + demo.ts
//   guide → pages/guide.html
// 切页时按 hash fetch 对应 HTML 片段到 #page-host，再动态 import demo。
const host = document.getElementById('page-host')!;
let activePage = '';
let activeDispose: (() => void) | null = null;

/** 组件页名 → 片段路径。guide / utils 等非组件页单独映射。 */
function pageUrl(name: string): string {
  if (name === 'guide') return './pages/guide.html';
  return `./components/${name}/index.html`;
}

/** guide 页无 demo；其余页名与组件目录名一致。 */
function hasDemo(name: string): boolean {
  return name !== 'guide';
}

async function showPage(name: string) {
  if (name === activePage) return;
  activePage = name;

  // 卸载上一页的演示（若有 dispose 钩子）
  if (activeDispose) { activeDispose(); activeDispose = null; }

  // Highlight sidebar nav
  document.querySelectorAll('.nav-page').forEach((a) => {
    a.classList.toggle('active', (a as HTMLElement).dataset.page === name);
  });

  // Fetch + 注入片段
  const res = await fetch(pageUrl(name));
  if (!res.ok) {
    host.innerHTML = `<div class="page"><p>页面加载失败：${name} (${res.status})</p></div>`;
    return;
  }
  host.innerHTML = await res.text();

  // Syntax highlight code blocks on the newly active page
  host.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el as HTMLElement));

  // Lazy-init demo
  if (hasDemo(name)) {
    try {
      const mod = await import(`./components/${name}/demo.ts`);
      const pageEl = host.querySelector('.page');
      const canvas = pageEl?.querySelector('canvas') as HTMLCanvasElement | null;
      const ctrl = pageEl?.querySelector('.demo-ctrl') as HTMLElement | null;
      if (canvas && ctrl) {
        const maybeDispose = mod.initDemo(canvas, ctrl);
        if (typeof maybeDispose === 'function') activeDispose = maybeDispose;
      }
    } catch (err) {
      console.error(`demo load failed: ${name}`, err);
    }
  }
}

function navigateTo(name: string) {
  window.location.hash = name;
}

// Bind sidebar nav clicks
document.querySelectorAll('.nav-page').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo((a as HTMLElement).dataset.page!);
  });
});

// Bind hash change
window.addEventListener('hashchange', () => {
  showPage(getPageFromHash());
});

function getPageFromHash(): string {
  const h = window.location.hash.replace('#', '');
  return h || 'guide';
}

// ===================== INIT =====================
// Expand all nav groups by default
document.querySelectorAll('.nav-group').forEach((g) => g.classList.add('open'));

// Show initial page
showPage(getPageFromHash());
