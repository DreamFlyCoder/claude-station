import { layout } from './layout.mjs';
import { getArchivedSessions } from '../scanner.mjs';
import { basename } from 'node:path';

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatTime(ts) {
  if (!ts) return 'unknown';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

export async function renderArchive() {
  const groups = await getArchivedSessions();
  const totalSessions = groups.reduce((s, g) => s + g.sessions.length, 0);

  const projectsHtml = groups.length === 0
    ? `<div class="card" style="text-align:center; padding:40px 16px; color:var(--fg-dim);">
         <div style="font-size:2rem; margin-bottom:8px;">🗂</div>
         <div>No archived sessions yet.</div>
         <div style="font-size:0.85rem; margin-top:6px;">Sessions you delete will appear here so you can restore them or remove them permanently.</div>
       </div>`
    : groups.map(g => {
        const name = basename(g.realPath) || g.escapedPath;
        const cards = g.sessions.map(s => {
          const restoreUrl = `/api/session/archive/${encodeURIComponent(g.escapedPath)}/${s.id}/restore`;
          const deleteUrl = `/api/session/archive/${encodeURIComponent(g.escapedPath)}/${s.id}/delete-forever`;
          return `
            <div class="card archive-card">
              <div class="card-main">
                <div class="card-title">${escapeHtml(formatTime(s.archivedAt))} <span class="muted">archived</span></div>
                <div class="preview">${escapeHtml(s.firstPrompt)}</div>
                <div class="meta">
                  ${s.messageCount} messages &middot; ${formatSize(s.fileSize)}
                </div>
              </div>
              <div class="card-actions">
                <button class="btn-restore" data-url="${restoreUrl}" data-redirect="/archive" title="Move back to active sessions">↩ Restore</button>
                <button class="btn-delete-forever" data-url="${deleteUrl}" data-redirect="/archive" title="Permanently delete this jsonl file (cannot be undone)">⚠️ Delete forever</button>
              </div>
            </div>`;
        }).join('');
        return `
          <h2 style="color:var(--accent); margin:18px 0 10px; font-size:1rem; font-weight:600;">
            📁 ${escapeHtml(name)}
            <span class="muted" style="font-weight:normal; margin-left:8px;">${escapeHtml(g.realPath)}</span>
          </h2>
          ${cards}
        `;
      }).join('');

  const content = `
    <div class="stats">
      <div class="stat-box">
        <div class="num">${groups.length}</div>
        <div class="label">Projects with archives</div>
      </div>
      <div class="stat-box">
        <div class="num">${totalSessions}</div>
        <div class="label">Archived sessions</div>
      </div>
    </div>
    <p style="color:var(--fg-dim); font-size:0.85rem; margin: 8px 0 16px;">
      Stored at <code>~/.claude/projects/.archive/</code>. Restore moves a session back to its project; Delete forever removes the jsonl file (irreversible).
    </p>
    ${projectsHtml}
  `;

  return layout('Archive', content, {
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: 'Archive' },
    ],
    isArchive: true,
  });
}
