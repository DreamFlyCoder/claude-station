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

function renderSidebar(projects, activeEscapedPath, isHome, isConfig) {
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

  return `<div class="sb-body">
    <div class="sb-header">
      <input class="sb-search" type="text" placeholder="Search projects..." aria-label="Search projects" id="sb-search-input" />
    </div>
    <nav class="sb-list" id="sb-list">
      ${items || '<div class="sb-empty">No projects.</div>'}
    </nav>
    <div class="sb-footer">
      <a class="sb-global${isHome ? ' active' : ''}" href="/">🌐 Global CLAUDE.md</a>
      <a class="sb-global${isConfig ? ' active' : ''}" href="/config">⚙️ Config Center</a>
    </div>
  </div>`;
}

/**
 * @param {string} title
 * @param {string} content
 * @param {object} opts
 * @param {Array<{label,href?}>} [opts.breadcrumbs]
 * @param {string} [opts.activeEscapedPath] — escapedPath of the active project (for sidebar highlight)
 * @param {boolean} [opts.isHome] — true when rendering the home page
 * @param {boolean} [opts.isConfig] — true when rendering the config center
 */
export async function layout(title, content, { breadcrumbs = [], activeEscapedPath = null, isHome = false, isConfig = false } = {}) {
  const marked = await getMarkedJs();
  const projects = await getProjects();

  const breadcrumbHtml = breadcrumbs.length > 0
    ? `<nav class="breadcrumb">${breadcrumbs.map((b, i) =>
        i === breadcrumbs.length - 1
          ? `<span>${escapeHtml(b.label)}</span>`
          : `<a href="${b.href}">${escapeHtml(b.label)}</a><span class="sep">/</span>`
      ).join('')}</nav>`
    : '';

  const sidebarHtml = renderSidebar(projects, activeEscapedPath, isHome, isConfig);

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

      --shadow-sm: 0 1px 2px rgba(0,0,0,0.25);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.3);
      --shadow-lg: 0 8px 24px rgba(0,0,0,0.4);
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

      --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
      --shadow-lg: 0 8px 24px rgba(0,0,0,0.12);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    :focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
      border-radius: 3px;
    }
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
    /* sb-body fills remaining height under topbar so footer pins to bottom */
    .sb-body {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
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
    .topbar-actions { display: inline-flex; gap: 6px; align-items: center; }
    .theme-toggle, .home-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--fg);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 0.95rem;
      cursor: pointer;
      transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
    }
    .theme-toggle:hover, .home-btn:hover {
      background: var(--bg-hover);
      border-color: var(--border-strong);
    }
    .home-btn:hover .icon { transform: scale(1.15); }
    .home-btn .icon { display: inline-block; transition: transform 240ms cubic-bezier(0.4, 0, 0.2, 1); }
    .theme-toggle .icon {
      display: inline-block;
      transition: transform 600ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .theme-toggle:hover .icon {
      transform: rotate(360deg);
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
      transition: background 200ms cubic-bezier(0.4, 0, 0.2, 1);
      overflow: hidden;
    }
    .sb-item::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--accent-bar);
      transform: translateX(-100%);
      transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .sb-item:hover::before,
    .sb-item.active::before {
      transform: translateX(0);
    }
    .sb-item:hover {
      background: var(--bg-hover);
    }
    .sb-item.active {
      background: var(--bg-hover);
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
      box-shadow: var(--shadow-sm);
      transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .card:hover {
      border-color: var(--accent);
      box-shadow: var(--shadow-md);
      transform: translateY(-2px);
    }
    .card a { color: var(--accent); text-decoration: none; font-weight: 500; }

    /* Session card — entire row clickable via stretched <a> */
    .session-card {
      position: relative;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      cursor: pointer;
    }
    .session-card .card-link {
      position: absolute;
      inset: 0;
      z-index: 0;
      border-radius: inherit;
      text-decoration: none;
    }
    .session-card .card-main {
      flex: 1;
      min-width: 0;
      position: relative;
      pointer-events: none; /* let clicks fall through to the stretched <a> */
    }
    .session-card .card-title {
      color: var(--accent);
      font-weight: 600;
      margin-bottom: 4px;
    }
    .session-card .card-actions {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-shrink: 0;
      position: relative;
      z-index: 1; /* above stretched link so buttons remain clickable */
    }
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
      transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .btn-resume:hover {
      background: var(--resume-bg-hover);
      transform: translateY(-1px);
      box-shadow: var(--shadow-sm);
    }
    .btn-resume:active { transform: translateY(0); }
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
      border-left: 3px solid var(--accent);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
      box-shadow: var(--shadow-sm);
      transition: box-shadow 200ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .claude-md-section:hover { box-shadow: var(--shadow-md); }
    .claude-md-section summary {
      cursor: pointer;
      color: var(--accent);
      font-weight: 600;
      font-size: 0.9rem;
    }
    .claude-md-section .md-content { margin-top: 12px; }
    .claude-md-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: var(--accent);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      letter-spacing: 0.01em;
    }
    .claude-md-title .icon { font-size: 1.1rem; line-height: 1; }
    /* Collapsible <details> for project CLAUDE.md */
    details.claude-md-section > summary {
      list-style: none;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 2px 0;
    }
    details.claude-md-section > summary::-webkit-details-marker { display: none; }
    details.claude-md-section > summary::marker { display: none; }
    details.claude-md-section > summary .chevron {
      display: inline-block;
      color: var(--fg-muted);
      font-size: 0.75rem;
      transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
      width: 14px;
      text-align: center;
      flex-shrink: 0;
    }
    details.claude-md-section[open] > summary .chevron {
      transform: rotate(90deg);
    }
    details.claude-md-section > .md-body {
      overflow: hidden;
      max-height: 0;
      opacity: 0;
      transition: max-height 240ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms cubic-bezier(0.4, 0, 0.2, 1), margin-top 200ms cubic-bezier(0.4, 0, 0.2, 1);
      margin-top: 0;
    }
    details.claude-md-section[open] > .md-body {
      max-height: 4000px;
      opacity: 1;
      margin-top: 12px;
    }

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
      box-shadow: var(--shadow-sm);
      transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .stat-box:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
      border-color: var(--accent);
    }
    .stat-box .num { font-size: 1.5rem; color: var(--accent); font-weight: 700; }
    .stat-box .label { font-size: 0.75rem; color: var(--fg-dim); }

    /* ===== Hero (top row on home: 田 stats + activity heatmap) ===== */
    .hero-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 24px;
      align-items: stretch;
    }
    @media (max-width: 1024px) {
      .hero-grid { grid-template-columns: 1fr; }
    }
    .hero-block {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      min-height: 280px;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
    }
    .hero-block h3 {
      color: var(--accent);
      font-size: 0.9rem;
      margin-bottom: 14px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr 1fr;
      gap: 10px;
      flex: 1;
    }
    .stats-grid .stat-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px 12px;
      min-height: 0;
    }
    .stats-grid .stat-box .num {
      font-size: 2.2rem;
      line-height: 1.1;
      margin-bottom: 4px;
    }
    .stats-grid .stat-box .label {
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .heatmap-wrap {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 0;
    }
    .heatmap-wrap .heatmap {
      width: 100%;
      height: auto;
      max-height: 100%;
    }
    .heatmap rect {
      transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
      transform-origin: center;
      transform-box: fill-box;
    }
    .heatmap rect:hover {
      transform: scale(1.3);
      stroke: var(--accent);
      stroke-width: 1;
    }

    /* ===== Top search bar ===== */
    .top-search {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }
    .top-search input {
      flex: 1;
      background: var(--bg-input);
      border: 1px solid var(--border-input);
      color: var(--fg);
      padding: 7px 12px;
      border-radius: 6px;
      font-family: inherit;
      font-size: 0.9rem;
      outline: none;
    }
    .top-search input:focus { border-color: var(--accent); }
    .top-search button {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 7px 14px;
      border-radius: 6px;
      font-family: inherit;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .top-search button:hover { border-color: var(--accent); color: var(--accent); }

    /* ===== Dashboard sections ===== */
    .dash-section { margin-bottom: 28px; }
    .dash-section h3 {
      color: var(--accent);
      font-size: 0.95rem;
      margin-bottom: 10px;
      font-weight: 600;
    }
    .dash-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    @media (max-width: 900px) { .dash-grid { grid-template-columns: 1fr; } }
    .dash-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      box-shadow: var(--shadow-sm);
      min-height: 320px;
      display: flex;
      flex-direction: column;
    }
    .dash-card h3 { margin-bottom: 14px; }
    .dash-card .chart-body { flex: 1; display: flex; flex-direction: column; justify-content: center; min-width: 0; }

    .heatmap { display: block; }
    .heatmap rect { stroke: var(--border); stroke-width: 0.5; }
    .heat-0 { fill: var(--bg-input); }
    .heat-1 { fill: #9be9a8; }
    .heat-2 { fill: #40c463; }
    .heat-3 { fill: #30a14e; }
    .heat-4 { fill: #216e39; }
    [data-theme="light"] .heat-0 { fill: #ebedf0; }

    .bar-chart .bar-row {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 2fr) minmax(170px, auto);
      gap: 10px;
      align-items: center;
      margin: 6px 0;
      font-size: 0.8rem;
    }
    .bar-chart .bar-row .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--fg);
    }
    .bar-chart .bar-row .name a { color: var(--accent-link); text-decoration: none; }
    .bar-chart .bar-row .name a:hover { text-decoration: underline; }
    .bar-chart .bar-row .track {
      background: var(--bg-input);
      border-radius: 3px;
      height: 14px;
      overflow: hidden;
      cursor: pointer;
    }
    .bar-chart .bar-row .fill {
      background: var(--accent);
      height: 100%;
      transition: opacity 200ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .bar-chart .bar-row:hover .fill { opacity: 0.75; }
    .bar-chart .bar-row .num {
      color: var(--fg-dim);
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .line-chart { display: block; }
    .line-chart .grid { stroke: var(--border); stroke-width: 0.5; }
    .line-chart .axis { stroke: var(--border-strong); stroke-width: 1; }
    .line-chart .line { stroke: var(--accent); stroke-width: 1.5; fill: none; }
    .line-chart .label { fill: var(--fg-dim); font-size: 9px; }

    /* ===== Tabs (config center) ===== */
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
      margin-bottom: 14px;
      gap: 4px;
      flex-wrap: wrap;
    }
    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      border-bottom: none;
      color: var(--fg-muted);
      padding: 7px 14px;
      font-family: inherit;
      font-size: 0.85rem;
      cursor: pointer;
      border-radius: 6px 6px 0 0;
      margin-bottom: -1px;
    }
    .tab-btn:hover { color: var(--fg); background: var(--bg-hover); }
    .tab-btn.active {
      background: var(--bg-card);
      border-color: var(--border);
      color: var(--accent);
    }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    .config-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 8px;
    }
    .config-card .name {
      color: var(--accent);
      font-weight: 600;
      font-size: 0.9rem;
    }
    .config-card .path {
      color: var(--fg-faint);
      font-size: 0.7rem;
      margin-top: 2px;
      word-break: break-all;
    }
    .config-card .desc {
      color: var(--fg-muted);
      font-size: 0.82rem;
      margin-top: 6px;
      line-height: 1.5;
    }

    /* ===== Search results ===== */
    .search-result {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px 16px;
      margin-bottom: 10px;
    }
    .search-result .head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 0.78rem;
      color: var(--fg-dim);
      margin-bottom: 6px;
    }
    .search-result .head a { color: var(--accent-link); text-decoration: none; font-weight: 500; }
    .search-result .head a:hover { text-decoration: underline; }
    .search-result .snippet {
      font-size: 0.85rem;
      color: var(--fg);
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .search-result mark {
      background: var(--accent);
      color: var(--bg);
      padding: 0 2px;
      border-radius: 2px;
    }

    /* ===== Archive button ===== */
    .btn-archive {
      background: transparent;
      color: var(--fg-dim);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 0.72rem;
      cursor: pointer;
      font-family: inherit;
      transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .btn-archive:hover {
      color: #e57373;
      border-color: #e57373;
      transform: translateY(-1px);
      box-shadow: var(--shadow-sm);
    }
    .btn-archive:active { transform: translateY(0); }
    .btn-export {
      background: transparent;
      color: var(--fg-muted);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 0.75rem;
      cursor: pointer;
      font-family: inherit;
      text-decoration: none;
      display: inline-block;
      transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .btn-export:hover {
      color: var(--accent);
      border-color: var(--accent);
      transform: translateY(-1px);
      box-shadow: var(--shadow-sm);
    }
    .btn-export:active { transform: translateY(0); }

    /* ===== CLAUDE.md editor ===== */
    .md-editor textarea {
      width: 100%;
      min-height: 320px;
      background: var(--bg-input);
      color: var(--fg);
      border: 1px solid var(--border-input);
      border-radius: 6px;
      padding: 10px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.85rem;
      line-height: 1.5;
      outline: none;
      resize: vertical;
    }
    .md-editor textarea:focus { border-color: var(--accent); }
    .md-editor .actions {
      margin-top: 8px;
      display: flex;
      gap: 8px;
    }
    .md-editor button {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 5px 12px;
      border-radius: 4px;
      font-size: 0.78rem;
      cursor: pointer;
      font-family: inherit;
    }
    .md-editor button.primary { color: var(--accent); border-color: var(--accent); }
    .md-editor button:hover { background: var(--bg-hover); }
    .md-editor button:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ===== Toast ===== */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--bg-card);
      color: var(--fg);
      border: 1px solid var(--accent);
      border-radius: 6px;
      padding: 10px 16px;
      font-size: 0.85rem;
      box-shadow: var(--shadow-md);
      opacity: 0;
      transform: translateY(40px);
      transition: opacity 500ms cubic-bezier(0.4, 0, 0.2, 1), transform 500ms cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 1000;
      pointer-events: none;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast.error { border-color: #e57373; }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="topbar">
        <h1><a href="/">Claude Station</a></h1>
        <div class="topbar-actions">
          <a class="home-btn" href="/" title="Home" aria-label="Home"><span class="icon">🏠</span></a>
          <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Toggle theme" title="Toggle theme"><span class="icon">🌙</span></button>
        </div>
      </div>
      ${sidebarHtml}
    </aside>
    <main class="main">
      <form class="top-search" action="/search" method="GET" role="search">
        <input type="search" name="q" placeholder="Search session content (Enter)..." aria-label="Search sessions" />
        <button type="submit">Search</button>
      </form>
      <div class="main-header">
        ${breadcrumbHtml || '<div style="font-size:0.85rem;color:var(--fg-dim);">' + escapeHtml(title) + '</div>'}
      </div>
      ${content}
    </main>
  </div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
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
        if (btn) {
          const icon = btn.querySelector('.icon') || btn;
          icon.textContent = t === 'dark' ? '🌙' : '☀️';
        }
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

    // Toast helper
    window.toast = function(msg, opts) {
      opts = opts || {};
      const el = document.getElementById('toast');
      if (!el) return;
      el.textContent = msg;
      el.classList.toggle('error', !!opts.error);
      el.classList.add('show');
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.remove('show'), opts.duration || 2000);
    };

    // Tabs (config center)
    (function() {
      document.querySelectorAll('[data-tabs]').forEach(group => {
        const btns = group.querySelectorAll('.tab-btn');
        const panels = group.querySelectorAll('.tab-panel');
        btns.forEach(btn => {
          btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            btns.forEach(b => b.classList.toggle('active', b === btn));
            panels.forEach(p => p.classList.toggle('active', p.dataset.tab === target));
          });
        });
      });
    })();

    // Archive button
    document.querySelectorAll('.btn-archive').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Archive this session? The jsonl file will be moved to ~/.claude/projects/.archive/. You can restore it manually.')) return;
        const url = btn.dataset.url;
        btn.disabled = true;
        try {
          const res = await fetch(url, { method: 'POST' });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'archive failed');
          window.toast('Archived');
          const redirect = btn.dataset.redirect;
          setTimeout(() => { if (redirect) location.replace(redirect); else location.reload(); }, 500);
        } catch (e) {
          window.toast('Archive failed: ' + e.message, { error: true, duration: 3000 });
          btn.disabled = false;
        }
      });
    });

    // CLAUDE.md editor (multiple instances supported)
    document.querySelectorAll('.md-editor').forEach(wrap => {
      const path = wrap.dataset.path;
      const view = wrap.querySelector('.md-view');
      const editor = wrap.querySelector('.md-edit');
      const ta = wrap.querySelector('textarea');
      const btnEdit = wrap.querySelector('.btn-md-edit');
      const btnSave = wrap.querySelector('.btn-md-save');
      const btnCancel = wrap.querySelector('.btn-md-cancel');
      let original = ta ? ta.value : '';

      if (btnEdit) btnEdit.addEventListener('click', () => {
        view.style.display = 'none';
        editor.style.display = '';
        original = ta.value;
        // If wrap is a <details>, force it open so the editor is visible
        if (wrap.tagName === 'DETAILS') wrap.open = true;
      });
      if (btnCancel) btnCancel.addEventListener('click', () => {
        ta.value = original;
        editor.style.display = 'none';
        view.style.display = '';
      });
      if (btnSave) btnSave.addEventListener('click', async () => {
        btnSave.disabled = true;
        try {
          const res = await fetch('/api/claude-md', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path, content: ta.value }),
          });
          const data = await res.json();
          if (!res.ok || !data.ok) throw new Error(data.error || 'save failed');
          window.toast('Saved');
          // Refresh markdown preview without full reload
          const md = view.querySelector('[data-md]');
          if (md) {
            md.textContent = ta.value;
            md.innerHTML = window.marked ? window.marked.parse(ta.value) : ta.value;
          }
          original = ta.value;
          editor.style.display = 'none';
          view.style.display = '';
        } catch (e) {
          window.toast('Save failed: ' + e.message, { error: true, duration: 3000 });
        } finally {
          btnSave.disabled = false;
        }
      });
    });
  </script>
</body>
</html>`;
}
