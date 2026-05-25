import { layout } from './layout.mjs';
import { getSessions, getProjectClaudeMd, getRealPath } from '../scanner.mjs';
import { join } from 'node:path';

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatTime(ts) {
  if (!ts) return 'unknown';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  });
}

const RESUME_TIP = 'Copy to terminal to open and continue this claude code conversation';

function renderProjectMdEditor(realPath, projectMd) {
  const path = join(realPath, 'CLAUDE.md');
  const content = projectMd || '';
  return `
    <details class="claude-md-section md-editor" data-path="${escapeHtml(path)}">
      <summary>
        <span class="claude-md-title"><span class="icon">📄</span>Project CLAUDE.md</span>
        <span style="display:flex; gap:8px; align-items:center;">
          <button class="btn-md-edit md-editor-btn" type="button" onclick="event.preventDefault();event.stopPropagation();">Edit</button>
          <span class="chevron" aria-hidden="true">▶</span>
        </span>
      </summary>
      <div class="md-body">
        <div class="md-view">
          ${projectMd ? `<div data-md>${escapeHtml(projectMd)}</div>` : `<p style="color:var(--fg-dim); font-size:0.85rem;">No CLAUDE.md at <code>${escapeHtml(path)}</code>. Click Edit to create one.</p>`}
        </div>
        <div class="md-edit" style="display:none;">
          <textarea aria-label="Project CLAUDE.md content">${escapeHtml(content)}</textarea>
          <div class="actions">
            <button class="btn-md-save primary" type="button">Save</button>
            <button class="btn-md-cancel" type="button">Cancel</button>
            <span style="color:var(--fg-faint); font-size:0.75rem; align-self:center;">A timestamped backup will be created.</span>
          </div>
        </div>
      </div>
    </details>
  `;
}

export async function renderProject(escapedPath) {
  const realPath = await getRealPath(escapedPath);
  const sessions = await getSessions(escapedPath);
  const projectMd = await getProjectClaudeMd(realPath);

  const editorHtml = renderProjectMdEditor(realPath, projectMd);

  const sessionCards = sessions.map(s => {
    const resumeCmd = `cd ${realPath} && claude --resume ${s.id}`;
    const archiveUrl = `/api/session/${encodeURIComponent(escapedPath)}/${s.id}/archive`;
    const showLast = s.lastTime && s.lastTime !== s.startTime;
    return `
    <div class="card session-card">
      <a class="card-link" href="/session/${encodeURIComponent(escapedPath)}/${s.id}" aria-label="Open session ${formatTime(s.startTime)}"></a>
      <div class="card-main">
        <div class="card-title">${formatTime(s.lastTime || s.startTime)}</div>
        <div class="session-times">
          <span title="When the first message in this session was recorded">Created <strong>${formatTime(s.startTime)}</strong></span>
          ${showLast ? `<span class="sep">·</span><span title="Timestamp of the latest message in this session">Last activity <strong>${formatTime(s.lastTime)}</strong></span>` : ''}
        </div>
        <div class="preview">${escapeHtml(s.firstPrompt)}</div>
        <div class="meta">
          ${s.messageCount} messages &middot; ${formatSize(s.fileSize)}
        </div>
      </div>
      <div class="card-actions">
        <span class="resume-wrap">
          <button class="btn-resume" data-cmd="${escapeHtml(resumeCmd)}" title="${RESUME_TIP}">Resume</button>
          <span class="tip">${RESUME_TIP}</span>
        </span>
        <button class="btn-archive" data-url="${archiveUrl}" data-redirect="/project/${encodeURIComponent(escapedPath)}" title="Delete (moved to ~/.claude/projects/.archive/ for recovery)">🗑 Delete</button>
      </div>
    </div>`;
  }).join('');

  const content = `
    <div class="stats">
      <div class="stat-box">
        <div class="num">${sessions.length}</div>
        <div class="label">Sessions</div>
      </div>
    </div>
    ${editorHtml}
    <form class="project-search" method="GET" action="/search">
      <input type="search" name="q" placeholder="Search inside this project's sessions..." aria-label="Search this project" />
      <input type="hidden" name="project" value="${escapeHtml(escapedPath)}" />
      <button type="submit">Search</button>
    </form>
    <h2 style="color:var(--accent); margin:18px 0 12px; font-size:1.1rem;">Sessions</h2>
    ${sessionCards || '<p style="color:var(--fg-dim);">No sessions found.</p>'}
  `;

  return layout(realPath, content, {
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: realPath },
    ],
    activeEscapedPath: escapedPath,
  });
}
