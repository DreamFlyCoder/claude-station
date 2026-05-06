import { layout } from './layout.mjs';
import { getProjects, getGlobalClaudeMd } from '../scanner.mjs';

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

export async function renderHome() {
  const projects = await getProjects();
  const globalMd = await getGlobalClaudeMd();

  const globalMdHtml = globalMd
    ? `<details class="claude-md-section" open>
        <summary>Global CLAUDE.md</summary>
        <div data-md>${escapeHtml(globalMd)}</div>
       </details>`
    : '';

  const projectCards = projects.map(p => `
    <div class="card">
      <a href="/project/${encodeURIComponent(p.escapedPath)}">${escapeHtml(p.realPath)}</a>
      <div class="meta">
        ${p.sessionCount} session${p.sessionCount !== 1 ? 's' : ''}
        &middot; ${timeAgo(p.lastActive)}
        ${p.hasClaudeMd ? ' &middot; has CLAUDE.md' : ''}
      </div>
    </div>
  `).join('');

  const content = `
    <div class="stats">
      <div class="stat-box">
        <div class="num">${projects.length}</div>
        <div class="label">Projects</div>
      </div>
      <div class="stat-box">
        <div class="num">${projects.reduce((s, p) => s + p.sessionCount, 0)}</div>
        <div class="label">Sessions</div>
      </div>
    </div>
    ${globalMdHtml}
    <h2 style="color:#c9a0ff; margin-bottom:12px; font-size:1.1rem;">Projects</h2>
    ${projectCards}
  `;

  return layout('Home', content);
}
