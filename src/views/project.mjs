import { layout } from './layout.mjs';
import { getSessions, getProjectClaudeMd, escapedToRealPath } from '../scanner.mjs';

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
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

export async function renderProject(escapedPath) {
  const realPath = '/' + escapedToRealPath(escapedPath);
  const sessions = await getSessions(escapedPath);
  const projectMd = await getProjectClaudeMd(realPath);

  const projectMdHtml = projectMd
    ? `<details class="claude-md-section" open>
        <summary>Project CLAUDE.md</summary>
        <div data-md>${escapeHtml(projectMd)}</div>
       </details>`
    : '';

  const sessionCards = sessions.map(s => {
    const resumeCmd = `cd ${realPath} && claude --resume ${s.id}`;
    return `
    <div class="card" style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
      <div style="flex:1; min-width:0;">
        <a href="/session/${encodeURIComponent(escapedPath)}/${s.id}">${formatTime(s.startTime)}</a>
        <div class="preview">${escapeHtml(s.firstPrompt)}</div>
        <div class="meta">
          ${s.messageCount} messages &middot; ${formatSize(s.fileSize)}
        </div>
      </div>
      <button class="btn-resume" data-cmd="${escapeHtml(resumeCmd)}">Resume</button>
    </div>`;
  }).join('');

  const content = `
    <div class="stats">
      <div class="stat-box">
        <div class="num">${sessions.length}</div>
        <div class="label">Sessions</div>
      </div>
    </div>
    ${projectMdHtml}
    <h2 style="color:#c9a0ff; margin-bottom:12px; font-size:1.1rem;">Sessions</h2>
    ${sessionCards || '<p style="color:#888;">No sessions found.</p>'}
  `;

  return layout(realPath, content, {
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: realPath },
    ],
  });
}
