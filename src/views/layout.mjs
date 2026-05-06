import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProjects } from '../scanner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
let markedJs = null;

async function getMarkedJs() {
  if (!markedJs) {
    markedJs = await readFile(join(__dirname, '..', 'vendor', 'marked.min.js'), 'utf-8');
  }
  return markedJs;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return date.toLocaleDateString();
}

function shortName(realPath) {
  if (!realPath) return '(unknown)';
  const b = basename(realPath);
  return b || realPath;
}

function renderSidebar(projects, activeEscapedPath, isHome) {
  const items = projects.map(p => {
    const isActive = p.escapedPath === activeEscapedPath;
    const name = shortName(p.realPath);
    return `<a class="sb-item${isActive ? ' active' : ''}" data-name="${escapeHtml(name.toLowerCase())}" data-fullpath="${escapeHtml(p.realPath.toLowerCase())}" href="/project/${encodeURIComponent(p.escapedPath)}" title="${escapeHtml(p.realPath)}">
      <div class="sb-item-row">
        <span class="sb-icon">📁</span>
        <span class="sb-name">${escapeHtml(name)}</span>
        <span class="sb-badge">${p.sessionCount}</span>
      </div>
      <div class="sb-meta">${timeAgo(p.lastActive)}</div>
    </a>`;
  }).join('');

  return `<aside class="sidebar">
    <div class="sb-header">
      <input class="sb-search" type="text" placeholder="Search projects..." aria-label="Search projects" id="sb-search-input" />
    </div>
    <nav class="sb-list" id="sb-list">
      ${items || '<div class="sb-empty">No projects.</div>'}
    </nav>
    <div class="sb-footer">
      <a class="sb-global${isHome ? ' active' : ''}" href="/">🌐 Global CLAUDE.md</a>
    </div>
  </aside>`;
}

/**
 * @param {string} title
 * @param {string} content
 * @param {object} opts
 * @param {Array<{label,href?}>} [opts.breadcrumbs]
 * @param {string} [opts.activeEscapedPath] — escapedPath of the active project (for sidebar highlight)
 * @param {boolean} [opts.isHome] — true when rendering the home page
 */
export async function layout(title, content, { breadcrumbs = [], activeEscapedPath = null, isHome = false } = {}) {
  const marked = await getMarkedJs();
  const projects = await getProjects();

  const breadcrumbHtml = breadcrumbs.length > 0
    ? `<nav class="breadcrumb">${breadcrumbs.map((b, i) =>
        i === breadcrumbs.length - 1
          ? `<span>${escapeHtml(b.label)}</span>`
          : `<a href="${b.href}">${escapeHtml(b.label)}</a><span class="sep">/</span>`
      ).join('')}</nav>`
    : '';

  const sidebarHtml = renderSidebar(projects, activeEscapedPath, isHome);

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Claude Station</title>
  <script>
    // Apply theme before paint to avoid flash
    (function() {
      try {
        var t = localStorage.getItem('atlas-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', t);
      } catch (e) {}
    })();
  </script>
  <style>
    /* ===== Theme variables ===== */
    :root,
    [data-theme="dark"] {
      --bg: #1a1a2e;
      --bg-sidebar: #16162d;
      --bg-card: #16213e;
      --bg-code: #0d1117;
      --bg-stat: #16213e;
      --bg-input: #0d1117;
      --bg-msg-user: #1a365d;
      --bg-msg-assistant: #2a2a3e;
      --bg-hover: #1e1e3e;

      --fg: #e0e0e0;
      --fg-muted: #aaa;
      --fg-dim: #888;
      --fg-faint: #666;
      --fg-very-faint: #555;

      --accent: #c9a0ff;
      --accent-link: #7b8cde;
      --accent-bar: #c9a0ff;

      --border: #2a2a4a;
      --border-strong: #4a4a8a;
      --border-input: #333;

      --resume-bg: #2d6a4f;
      --resume-fg: #b7e4c7;
      --resume-border: #40916c;
      --resume-bg-hover: #40916c;
      --resume-bg-copied: #1b4332;
      --resume-fg-copied: #95d5b2;

      --code-fg: #e6db74;
      --tooltip-bg: #0d1117;
      --tooltip-fg: #e0e0e0;
      --tooltip-border: #4a4a8a;
    }
    [data-theme="light"] {
      --bg: #f5f5f7;
      --bg-sidebar: #fafafa;
      --bg-card: #ffffff;
      --bg-code: #f0f0f3;
      --bg-stat: #ffffff;
      --bg-input: #ffffff;
      --bg-msg-user: #e3edff;
      --bg-msg-assistant: #f0f0f5;
      --bg-hover: #ececf2;

      --fg: #1a1a2e;
      --fg-muted: #555;
      --fg-dim: #777;
      --fg-faint: #999;
      --fg-very-faint: #bbb;

      --accent: #6b46c1;
      --accent-link: #4a5fc9;
      --accent-bar: #6b46c1;

      --border: #e0e0e6;
      --border-strong: #b8b8c8;
      --border-input: #d0d0d8;

      --resume-bg: #d4f5e0;
      --resume-fg: #1b4332;
      --resume-border: #40916c;
      --resume-bg-hover: #b7e4c7;
      --resume-bg-copied: #95d5b2;
      --resume-fg-copied: #1b4332;

      --code-fg: #b58900;
      --tooltip-bg: #1a1a2e;
      --tooltip-fg: #f5f5f7;
      --tooltip-border: #6b46c1;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.6;
      min-height: 100vh;
    }

    /* ===== Layout: sidebar + main ===== */
    .app {
      display: flex;
      min-height: 100vh;
    }
    .sidebar {
      width: 280px;
      flex-shrink: 0;
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: hidden;
    }
    .main {
      flex: 1;
      min-width: 0;
      padding: 20px 28px;
      max-width: 1100px;
    }

    /* ===== Top toolbar (theme toggle in sidebar header area) ===== */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }
    .topbar h1 {
      font-size: 1rem;
      color: var(--accent);
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .topbar h1 a { color: inherit; text-decoration: none; }
    .theme-toggle {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      line-height: 1;
    }
    .theme-toggle:hover {
      background: var(--bg-hover);
      border-color: var(--border-strong);
    }

    /* ===== Sidebar internals ===== */
    .sb-header {
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }
    .sb-search {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--border-input);
      color: var(--fg);
      padding: 6px 10px;
      border-radius: 6px;
      font-family: inherit;
      font-size: 0.85rem;
      outline: none;
      transition: border-color 0.15s;
    }
    .sb-search:focus { border-color: var(--accent); }

    .sb-list {
      flex: 1;
      overflow-y: auto;
      padding: 6px 0;
    }
    .sb-list::-webkit-scrollbar { width: 6px; }
    .sb-list::-webkit-scrollbar-track { background: transparent; }
    .sb-list::-webkit-scrollbar-thumb {
      background: var(--border-strong);
      border-radius: 3px;
    }

    .sb-item {
      display: block;
      position: relative;
      padding: 8px 14px 8px 18px;
      color: var(--fg);
      text-decoration: none;
      border-left: 3px solid transparent;
      transition: background 0.12s, border-color 0.12s;
    }
    .sb-item:hover {
      background: var(--bg-hover);
      border-left-color: var(--accent-bar);
    }
    .sb-item.active {
      background: var(--bg-hover);
      border-left-color: var(--accent-bar);
    }
    .sb-item-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .sb-icon { font-size: 0.85rem; flex-shrink: 0; }
    .sb-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.85rem;
      font-weight: 500;
    }
    .sb-badge {
      flex-shrink: 0;
      background: var(--border);
      color: var(--fg-muted);
      font-size: 0.7rem;
      padding: 1px 6px;
      border-radius: 10px;
      min-width: 20px;
      text-align: center;
    }
    .sb-item.active .sb-badge,
    .sb-item:hover .sb-badge {
      background: var(--accent);
      color: var(--bg);
    }
    .sb-meta {
      font-size: 0.7rem;
      color: var(--fg-faint);
      margin-top: 2px;
      margin-left: 16px;
    }
    .sb-empty {
      padding: 14px;
      color: var(--fg-dim);
      font-size: 0.85rem;
      text-align: center;
    }

    .sb-footer {
      border-top: 1px solid var(--border);
      padding: 10px 12px;
    }
    .sb-global {
      display: block;
      color: var(--fg-muted);
      text-decoration: none;
      font-size: 0.85rem;
      padding: 6px 8px;
      border-radius: 6px;
      transition: background 0.12s, color 0.12s;
    }
    .sb-global:hover, .sb-global.active {
      background: var(--bg-hover);
      color: var(--accent);
    }

    /* ===== Main area ===== */
    .main-header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .breadcrumb {
      font-size: 0.85rem;
      color: var(--fg-dim);
    }
    .breadcrumb a { color: var(--accent-link); text-decoration: none; }
    .breadcrumb a:hover { text-decoration: underline; }
    .breadcrumb .sep { margin: 0 6px; color: var(--fg-very-faint); }

    /* ===== Cards ===== */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
      transition: border-color 0.2s;
    }
    .card:hover { border-color: var(--border-strong); }
    .card a { color: var(--accent); text-decoration: none; font-weight: 500; }
    .card a:hover { text-decoration: underline; }
    .card .meta {
      font-size: 0.8rem;
      color: var(--fg-dim);
      margin-top: 4px;
    }
    .card .preview {
      font-size: 0.85rem;
      color: var(--fg-muted);
      margin-top: 6px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ===== Resume button + tooltip ===== */
    .resume-wrap { position: relative; display: inline-block; }
    .btn-resume {
      background: var(--resume-bg);
      color: var(--resume-fg);
      border: 1px solid var(--resume-border);
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 0.75rem;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.2s;
    }
    .btn-resume:hover { background: var(--resume-bg-hover); }
    .btn-resume.copied {
      background: var(--resume-bg-copied);
      color: var(--resume-fg-copied);
    }
    .resume-wrap .tip {
      position: absolute;
      bottom: calc(100% + 6px);
      right: 0;
      background: var(--tooltip-bg);
      color: var(--tooltip-fg);
      border: 1px solid var(--tooltip-border);
      padding: 6px 10px;
      font-size: 0.75rem;
      border-radius: 4px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transform: translateY(2px);
      transition: opacity 0.15s, transform 0.15s;
      z-index: 10;
    }
    .resume-wrap:hover .tip {
      opacity: 1;
      transform: translateY(0);
    }

    /* ===== Chat messages ===== */
    .chat { margin-top: 16px; }
    .msg {
      margin-bottom: 16px;
      padding: 12px 16px;
      border-radius: 8px;
      max-width: 85%;
      font-size: 0.9rem;
      overflow-wrap: break-word;
    }
    .msg.user {
      background: var(--bg-msg-user);
      border: 1px solid var(--border);
      margin-left: auto;
      text-align: left;
    }
    .msg.assistant {
      background: var(--bg-msg-assistant);
      border: 1px solid var(--border);
      margin-right: auto;
    }
    .msg .role-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--fg-dim);
      margin-bottom: 6px;
      font-weight: 600;
    }
    .msg.user .role-label { color: var(--accent-link); }
    .msg.assistant .role-label { color: var(--accent); }
    .msg .timestamp {
      font-size: 0.7rem;
      color: var(--fg-faint);
      margin-top: 6px;
    }

    /* ===== Markdown content ===== */
    .md-content h1, .md-content h2, .md-content h3 {
      color: var(--accent);
      margin: 12px 0 6px;
    }
    .md-content h1 { font-size: 1.3rem; }
    .md-content h2 { font-size: 1.1rem; }
    .md-content h3 { font-size: 1rem; }
    .md-content p { margin: 6px 0; }
    .md-content code {
      background: var(--bg-code);
      padding: 2px 5px;
      border-radius: 3px;
      font-size: 0.85em;
      color: var(--code-fg);
    }
    .md-content pre {
      background: var(--bg-code);
      border: 1px solid var(--border-input);
      border-radius: 6px;
      padding: 12px;
      overflow-x: auto;
      margin: 8px 0;
    }
    .md-content pre code {
      background: none;
      padding: 0;
      color: var(--fg);
    }
    .md-content a { color: var(--accent-link); }
    .md-content ul, .md-content ol { padding-left: 20px; margin: 6px 0; }
    .md-content table { border-collapse: collapse; margin: 8px 0; width: 100%; }
    .md-content th, .md-content td {
      border: 1px solid var(--border-input);
      padding: 6px 10px;
      text-align: left;
      font-size: 0.85rem;
    }
    .md-content th { background: var(--bg-hover); color: var(--accent); }
    .md-content blockquote {
      border-left: 3px solid var(--border-strong);
      padding-left: 12px;
      color: var(--fg-muted);
      margin: 8px 0;
    }

    /* ===== CLAUDE.md section ===== */
    .claude-md-section {
      background: var(--bg-code);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .claude-md-section summary {
      cursor: pointer;
      color: var(--accent);
      font-weight: 600;
      font-size: 0.9rem;
    }
    .claude-md-section .md-content { margin-top: 12px; }

    /* ===== Stats ===== */
    .stats {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .stat-box {
      background: var(--bg-stat);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px 16px;
      text-align: center;
    }
    .stat-box .num { font-size: 1.5rem; color: var(--accent); font-weight: 700; }
    .stat-box .label { font-size: 0.75rem; color: var(--fg-dim); }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar-wrap">
      <div class="topbar">
        <h1><a href="/">Claude Station</a></h1>
        <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Toggle theme" title="Toggle theme">🌙</button>
      </div>
      ${sidebarHtml}
    </aside>
    <main class="main">
      <div class="main-header">
        ${breadcrumbHtml || '<div style="font-size:0.85rem;color:var(--fg-dim);">' + escapeHtml(title) + '</div>'}
      </div>
      ${content}
    </main>
  </div>
  <script>${marked}</script>
  <script>
    // Render all markdown blocks
    document.querySelectorAll('[data-md]').forEach(el => {
      el.innerHTML = marked.parse(el.textContent || '');
      el.classList.add('md-content');
    });

    // Resume button: copy + transient feedback
    document.querySelectorAll('.btn-resume').forEach(btn => {
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        navigator.clipboard.writeText(cmd).then(() => {
          const original = btn.textContent;
          btn.textContent = '✓ Copied';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove('copied');
          }, 2000);
        });
      });
    });

    // Theme toggle
    (function() {
      const root = document.documentElement;
      const btn = document.getElementById('theme-toggle');
      function syncIcon() {
        const t = root.getAttribute('data-theme') || 'dark';
        if (btn) btn.textContent = t === 'dark' ? '🌙' : '☀️';
      }
      syncIcon();
      if (btn) {
        btn.addEventListener('click', () => {
          const cur = root.getAttribute('data-theme') || 'dark';
          const next = cur === 'dark' ? 'light' : 'dark';
          root.setAttribute('data-theme', next);
          try { localStorage.setItem('atlas-theme', next); } catch (e) {}
          syncIcon();
        });
      }
    })();

    // Sidebar search filter
    (function() {
      const input = document.getElementById('sb-search-input');
      const list = document.getElementById('sb-list');
      if (!input || !list) return;
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        list.querySelectorAll('.sb-item').forEach(item => {
          const name = item.dataset.name || '';
          const full = item.dataset.fullpath || '';
          const match = !q || name.includes(q) || full.includes(q);
          item.style.display = match ? '' : 'none';
        });
      });
    })();
  </script>
</body>
</html>`;
}
