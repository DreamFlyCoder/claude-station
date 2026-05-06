import { layout } from './layout.mjs';
import { getProjects, getGlobalClaudeMd } from '../scanner.mjs';

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function renderHome() {
  const projects = await getProjects();
  const globalMd = await getGlobalClaudeMd();

  const totalSessions = projects.reduce((s, p) => s + p.sessionCount, 0);

  const globalMdHtml = globalMd
    ? `<details class="claude-md-section" open>
        <summary>Global CLAUDE.md</summary>
        <div data-md>${escapeHtml(globalMd)}</div>
       </details>`
    : '<p style="color:var(--fg-dim);">No global CLAUDE.md found at <code>~/.claude/CLAUDE.md</code>.</p>';

  const content = `
    <div class="stats">
      <div class="stat-box">
        <div class="num">${projects.length}</div>
        <div class="label">Projects</div>
      </div>
      <div class="stat-box">
        <div class="num">${totalSessions}</div>
        <div class="label">Sessions</div>
      </div>
    </div>
    <h2 style="color:var(--accent); margin-bottom:12px; font-size:1.1rem;">Projects</h2>
    <p style="color:var(--fg-dim); font-size:0.85rem; margin-bottom:18px;">
      Pick a project from the sidebar to view its sessions.
    </p>
    ${globalMdHtml}
  `;

  return layout('Home', content, { isHome: true });
}
