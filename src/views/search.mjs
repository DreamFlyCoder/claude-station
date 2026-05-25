import { layout } from './layout.mjs';
import { searchSessions, getProjects, getRealPath } from '../scanner.mjs';
import { basename } from 'node:path';

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(ts) {
  if (!ts) return 'unknown';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export async function renderSearch(q, scope = 'all') {
  const query = (q || '').trim();
  const projects = await getProjects();

  const scopeOptions = [
    `<option value="all"${scope === 'all' ? ' selected' : ''}>All projects</option>`,
    ...projects.map(p => {
      const name = basename(p.realPath) || p.escapedPath;
      const sel = scope === p.escapedPath ? ' selected' : '';
      return `<option value="${escapeHtml(p.escapedPath)}"${sel}>${escapeHtml(name)}</option>`;
    }),
  ].join('');

  const scopeForm = `
    <form class="search-scope" method="GET" action="/search">
      <input type="search" name="q" placeholder="Keyword" value="${escapeHtml(query)}" />
      <select name="project">${scopeOptions}</select>
      <button type="submit">Search</button>
    </form>
  `;

  let resultsHtml;
  let scopeLabel = '';
  if (scope !== 'all') {
    const realPath = await getRealPath(scope).catch(() => scope);
    scopeLabel = `<span class="scope-tag">in <strong>${escapeHtml(basename(realPath) || scope)}</strong></span> `;
  }

  if (!query) {
    resultsHtml = '<p style="color:var(--fg-dim);">Enter a query above to search session content.</p>';
  } else {
    const results = await searchSessions(query, { limit: 200, scope });
    if (results.length === 0) {
      resultsHtml = `<p style="color:var(--fg-dim);">No matches for <code>${escapeHtml(query)}</code>${scope !== 'all' ? ' in this project' : ''}.</p>`;
    } else {
      resultsHtml = results.map(r => {
        const sessionUrl = `/session/${encodeURIComponent(r.escapedPath)}/${r.sessionId}`;
        const projectUrl = `/project/${encodeURIComponent(r.escapedPath)}`;
        const more = r.matchCount > 1
          ? ` <span class="match-count">+${r.matchCount - 1} more match${r.matchCount - 1 === 1 ? '' : 'es'} in this session</span>`
          : '';
        return `
        <div class="search-result">
          <div class="head">
            <span><a href="${projectUrl}">${escapeHtml(r.realPath || r.escapedPath)}</a> &middot; <a href="${sessionUrl}">session ${r.sessionId.slice(0, 8)}</a> &middot; ${escapeHtml(r.role)}${more}</span>
            <span>${escapeHtml(formatTime(r.timestamp))}</span>
          </div>
          <div class="snippet">${escapeHtml(r.snippet.before)}<mark>${escapeHtml(r.snippet.hit)}</mark>${escapeHtml(r.snippet.after)}</div>
        </div>`;
      }).join('');
    }
  }

  const content = `
    <h2 style="color:var(--accent); margin-bottom:8px; font-size:1.1rem;">Search</h2>
    ${scopeForm}
    <p style="color:var(--fg-dim); font-size:0.85rem; margin: 8px 0 16px;">
      ${query ? `${scopeLabel}Results for <code>${escapeHtml(query)}</code> (one row per session)` : 'Pick a scope, type a keyword, hit Search. Each session shows once with total match count.'}
    </p>
    ${resultsHtml}
  `;

  const prefill = query
    ? `<script>document.querySelector('.top-search input[name=q]').value = ${JSON.stringify(query)};</script>`
    : '';

  return (await layout('Search', content + prefill, {
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: 'Search' },
    ],
  }));
}
