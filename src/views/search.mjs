import { layout } from './layout.mjs';
import { searchSessions, getProjects, getRealPath, getPromptHistory } from '../scanner.mjs';
import { basename } from 'node:path';

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(ts) {
  if (!ts) return 'unknown';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function renderMessagesResults(results, query) {
  if (results.length === 0) {
    return `<p style="color:var(--fg-dim);">No matches for <code>${escapeHtml(query)}</code>.</p>`;
  }
  return results.map(r => {
    const sessionUrl = `/session/${encodeURIComponent(r.escapedPath)}/${r.sessionId}`;
    const projectUrl = `/project/${encodeURIComponent(r.escapedPath)}`;
    const more = r.matchCount > 1
      ? ` <span class="match-count">+${r.matchCount - 1} more match${r.matchCount - 1 === 1 ? '' : 'es'} in this session</span>`
      : '';
    return `
    <div class="search-result clickable">
      <a class="card-link" href="${sessionUrl}" aria-label="Open session ${r.sessionId.slice(0, 8)}"></a>
      <div class="head">
        <span><a class="proj-link" href="${projectUrl}">${escapeHtml(r.realPath || r.escapedPath)}</a> &middot; session ${r.sessionId.slice(0, 8)} &middot; ${escapeHtml(r.role)}${more}</span>
        <span>${escapeHtml(formatTime(r.timestamp))}</span>
      </div>
      <div class="snippet">${escapeHtml(r.snippet.before)}<mark>${escapeHtml(r.snippet.hit)}</mark>${escapeHtml(r.snippet.after)}</div>
    </div>`;
  }).join('');
}

function renderPromptResults(results, query) {
  if (results.length === 0) {
    return `<p style="color:var(--fg-dim);">No prompts match <code>${escapeHtml(query)}</code>.</p>`;
  }
  return results.map(p => {
    const clickable = !!(p.escapedPath && p.sessionId);
    const cardLink = clickable
      ? `<a class="card-link" href="/session/${encodeURIComponent(p.escapedPath)}/${p.sessionId}" aria-label="Open session ${p.sessionId.slice(0, 8)}"></a>`
      : '';
    const sessionLabel = p.sessionId
      ? `session ${escapeHtml(p.sessionId.slice(0, 8))}`
      : `<span class="muted">unknown</span>`;
    const projectLink = p.escapedPath
      ? `<a class="proj-link" href="/project/${encodeURIComponent(p.escapedPath)}">${escapeHtml(basename(p.project) || p.project)}</a>`
      : `<span class="muted">${escapeHtml(p.project || 'unknown')}</span>`;
    const displayHtml = p.snippet
      ? escapeHtml(p.snippet.before) + `<mark>${escapeHtml(p.snippet.hit)}</mark>` + escapeHtml(p.snippet.after)
      : escapeHtml(p.display.slice(0, 200) + (p.display.length > 200 ? '…' : ''));
    return `
    <div class="search-result${clickable ? ' clickable' : ''}">
      ${cardLink}
      <div class="head">
        <span>${projectLink} &middot; ${sessionLabel}</span>
        <span>${escapeHtml(formatTime(p.timestamp))}</span>
      </div>
      <div class="snippet prompt-text">${displayHtml}</div>
    </div>`;
  }).join('');
}

export async function renderSearch(q, scope = 'all', mode = 'messages') {
  const query = (q || '').trim();
  const projects = await getProjects();
  const safeMode = mode === 'prompts' ? 'prompts' : 'messages';

  const scopeOptions = [
    `<option value="all"${scope === 'all' ? ' selected' : ''}>All projects</option>`,
    ...projects.map(p => {
      const name = basename(p.realPath) || p.escapedPath;
      const sel = scope === p.escapedPath ? ' selected' : '';
      return `<option value="${escapeHtml(p.escapedPath)}"${sel}>${escapeHtml(name)}</option>`;
    }),
  ].join('');

  const modeTabs = `
    <div class="search-modes">
      <a class="mode-tab${safeMode === 'messages' ? ' active' : ''}" href="/search?q=${encodeURIComponent(query)}&project=${encodeURIComponent(scope)}&mode=messages">Messages</a>
      <a class="mode-tab${safeMode === 'prompts' ? ' active' : ''}" href="/search?q=${encodeURIComponent(query)}&project=${encodeURIComponent(scope)}&mode=prompts">Prompts (my inputs)</a>
    </div>
  `;

  const scopeForm = `
    <form class="search-scope" method="GET" action="/search">
      <input type="search" name="q" placeholder="Keyword" value="${escapeHtml(query)}" />
      <select name="project">${scopeOptions}</select>
      <input type="hidden" name="mode" value="${escapeHtml(safeMode)}" />
      <button type="submit">Search</button>
    </form>
  `;

  let scopeLabel = '';
  if (scope !== 'all') {
    const realPath = await getRealPath(scope).catch(() => scope);
    scopeLabel = `<span class="scope-tag">in <strong>${escapeHtml(basename(realPath) || scope)}</strong></span> `;
  }

  let resultsHtml;
  let helpText;
  if (!query) {
    helpText = safeMode === 'prompts'
      ? 'Search every prompt you ever typed (from ~/.claude/history.jsonl).'
      : 'Search user/assistant message content across sessions.';
    resultsHtml = `<p style="color:var(--fg-dim);">Enter a query above. Mode = <strong>${safeMode}</strong>. ${escapeHtml(helpText)}</p>`;
  } else if (safeMode === 'prompts') {
    const results = await getPromptHistory({ query, scope, limit: 200 });
    helpText = `${scopeLabel}Found ${results.length} prompt${results.length === 1 ? '' : 's'} matching <code>${escapeHtml(query)}</code>`;
    resultsHtml = renderPromptResults(results, query);
  } else {
    const results = await searchSessions(query, { limit: 200, scope });
    helpText = `${scopeLabel}Results for <code>${escapeHtml(query)}</code> (one row per session)`;
    resultsHtml = renderMessagesResults(results, query);
  }

  const content = `
    <h2 style="color:var(--accent); margin-bottom:8px; font-size:1.1rem;">Search</h2>
    ${modeTabs}
    ${scopeForm}
    <p style="color:var(--fg-dim); font-size:0.85rem; margin: 8px 0 16px;">${helpText}</p>
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
