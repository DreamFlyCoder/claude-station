import { layout } from './layout.mjs';
import { searchSessions } from '../scanner.mjs';

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

export async function renderSearch(q) {
  const query = (q || '').trim();
  let resultsHtml;

  if (!query) {
    resultsHtml = '<p style="color:var(--fg-dim);">Enter a query above to search across all session content.</p>';
  } else {
    const results = await searchSessions(query, { limit: 200 });
    if (results.length === 0) {
      resultsHtml = `<p style="color:var(--fg-dim);">No matches for <code>${escapeHtml(query)}</code>.</p>`;
    } else {
      resultsHtml = results.map(r => {
        const sessionUrl = `/session/${encodeURIComponent(r.escapedPath)}/${r.sessionId}`;
        const projectUrl = `/project/${encodeURIComponent(r.escapedPath)}`;
        return `
        <div class="search-result">
          <div class="head">
            <span><a href="${projectUrl}">${escapeHtml(r.realPath || r.escapedPath)}</a> &middot; <a href="${sessionUrl}">session ${r.sessionId.slice(0, 8)}</a> &middot; ${escapeHtml(r.role)}</span>
            <span>${escapeHtml(formatTime(r.timestamp))}</span>
          </div>
          <div class="snippet">${escapeHtml(r.snippet.before)}<mark>${escapeHtml(r.snippet.hit)}</mark>${escapeHtml(r.snippet.after)}</div>
        </div>`;
      }).join('');
    }
  }

  const content = `
    <h2 style="color:var(--accent); margin-bottom:8px; font-size:1.1rem;">Search</h2>
    <p style="color:var(--fg-dim); font-size:0.85rem; margin-bottom:16px;">
      ${query ? `Results for <code>${escapeHtml(query)}</code>` : 'Full-text search across user/assistant message text in all sessions.'}
    </p>
    ${resultsHtml}
  `;

  // Pre-fill the top-search input via a small inline script.
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
