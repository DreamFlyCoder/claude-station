import { basename } from 'node:path';
import { layout } from './layout.mjs';
import { readSessionIndex, getSessionLocationMap } from '../scanner.mjs';

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

// Newest indexedAt across entries → persistent "last indexed" time (survives restart).
function lastIndexedLabel(entries) {
  let newest = '';
  for (const e of entries) {
    if (e && e.indexedAt && e.indexedAt > newest) newest = e.indexedAt;
  }
  const t = formatDateTime(newest);
  return t ? `Last indexed: ${t}` : '';
}

export function renderSessionCards(entries, locMap = {}) {
  const lastIndexed = lastIndexedLabel(entries || []);

  const toolbar = `<div class="sf-toolbar">
      <button id="sf-reindex" class="sf-reindex-btn" type="button">🔄 Refresh session index</button>
      <span id="sf-reindex-status" class="sf-reindex-status"></span>
      <span id="sf-last-indexed" class="sf-last-indexed">${escapeHtml(lastIndexed)}</span>
    </div>`;

  const pollingScript = `<script>
    (function(){
      var btn = document.getElementById('sf-reindex');
      var statusEl = document.getElementById('sf-reindex-status');
      if(!btn || !statusEl) return;
      var polling = false;
      function render(s){
        if(s.claudeMissing){ statusEl.textContent = 'Claude Code must be installed and logged in to refresh'; btn.disabled = false; return; }
        if(s.error){ statusEl.textContent = 'Error: ' + s.error; btn.disabled = false; return; }
        if(s.running){ btn.disabled = true; statusEl.textContent = 'Indexing ' + s.done + '/' + s.total + '…'; }
        else { btn.disabled = false; }
      }
      function poll(){
        fetch('/api/reindex/status').then(function(r){return r.json();}).then(function(s){
          render(s);
          if(s.running){ setTimeout(poll, 2000); }
          else if(polling){ polling = false; if(s.added>0){ location.reload(); } else { statusEl.textContent = s.finishedAt ? ('Up to date' + (s.cost? ' ($'+s.cost.toFixed(3)+')':'')) : ''; } }
        }).catch(function(){ statusEl.textContent=''; });
      }
      btn.addEventListener('click', function(){
        btn.disabled = true; statusEl.textContent = 'Starting…';
        fetch('/api/reindex', {method:'POST'}).then(function(r){return r.json();}).then(function(){ polling = true; poll(); }).catch(function(){ btn.disabled = false; statusEl.textContent = 'Failed to start, try again'; });
      });
      // On page load, if a job is already running (startup-triggered), take over the display.
      fetch('/api/reindex/status').then(function(r){return r.json();}).then(function(s){ if(s.running){ polling = true; render(s); setTimeout(poll, 2000); } });
    })();
    </script>`;

  if (!entries || entries.length === 0) {
    return `<h2 style="color:var(--accent); margin-bottom:8px; font-size:1.1rem;">Session Finder</h2>
    ${toolbar}
    <p style="color:var(--fg-dim);">No index yet. Click “🔄 Refresh session index” above to build it, or use the session-finder skill inside Claude Code.</p>
    ${pollingScript}`;
  }

  const sorted = [...entries].sort(
    (a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || ''))
  );

  const cards = sorted.map(e => {
    const title = escapeHtml(e.title || '(untitled)');
    const summary = escapeHtml(e.summary || '');
    const topics = Array.isArray(e.topics) ? e.topics : [];
    const chips = topics.map(t => `<span class="topic-chip">${escapeHtml(t)}</span>`).join('');
    const proj = escapeHtml(basename(e.cwd || '') || e.cwd || '');
    const date = escapeHtml(formatDate(e.startedAt));
    const msgs = Number.isFinite(e.messageCount) ? `${e.messageCount} msgs` : '';
    const meta = [proj, msgs, date].filter(Boolean).join(' · ');
    const blob = escapeHtml([e.title, e.summary, topics.join(' ')].join(' ').toLowerCase());
    const resumeBtn = e.resume
      ? `<div class="resume-wrap"><button class="btn-resume" data-cmd="${escapeHtml(e.resume)}">▶ Resume</button><span class="tip">Copy resume command</span></div>`
      : '';
    const escapedPath = locMap[e.sessionId];
    const cardLink = escapedPath
      ? `<a class="card-link" href="/session/${encodeURIComponent(escapedPath)}/${encodeURIComponent(e.sessionId)}" target="_blank" rel="noopener" aria-label="Open session ${title}"></a>`
      : '';
    return `<div class="sf-card${escapedPath ? ' clickable' : ''}" data-blob="${blob}">
      ${cardLink}
      <div class="sf-main">
        <div class="sf-title">${title}</div>
        ${summary ? `<div class="sf-summary">${summary}</div>` : ''}
        ${chips ? `<div class="sf-chips">${chips}</div>` : ''}
        ${meta ? `<div class="sf-meta">${meta}</div>` : ''}
      </div>
      <div class="sf-actions">${resumeBtn}</div>
    </div>`;
  }).join('');

  return `<h2 style="color:var(--accent); margin-bottom:8px; font-size:1.1rem;">Session Finder <span id="sf-count" style="color:var(--fg-dim);font-size:0.85rem;font-weight:400;">(${sorted.length})</span></h2>
    ${toolbar}
    <p style="color:var(--fg-dim); font-size:0.85rem; margin-bottom:12px;">Instant keyword filter over session titles / summaries / topics. For semantic recall, use the session-finder skill inside Claude Code.</p>
    <input id="sf-filter" class="sf-filter" type="search" placeholder="🔍 Filter by keyword in title / summary / topics…" aria-label="Filter sessions" />
    <div id="sf-list">${cards}</div>
    <script>
    (function(){
      var input = document.getElementById('sf-filter');
      var list = document.getElementById('sf-list');
      var count = document.getElementById('sf-count');
      if(!input || !list) return;
      var cards = Array.prototype.slice.call(list.querySelectorAll('.sf-card'));
      input.addEventListener('input', function(){
        var q = input.value.trim().toLowerCase();
        var n = 0;
        cards.forEach(function(c){
          var match = !q || (c.dataset.blob || '').indexOf(q) !== -1;
          c.style.display = match ? '' : 'none';
          if(match) n++;
        });
        if(count) count.textContent = '(' + n + ')';
      });
    })();
    </script>
    ${pollingScript}`;
}

export async function renderSessions() {
  const [entries, locMap] = await Promise.all([readSessionIndex(), getSessionLocationMap()]);
  return await layout('Session Finder', renderSessionCards(entries, locMap), {
    isSessions: true,
    breadcrumbs: [{ label: 'Home', href: '/' }, { label: 'Session Finder' }],
  });
}
