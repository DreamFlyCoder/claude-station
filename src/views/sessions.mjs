import { basename } from 'node:path';
import { layout } from './layout.mjs';
import { readSessionIndex } from '../scanner.mjs';

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function renderSessionCards(entries) {
  if (!entries || entries.length === 0) {
    return `<h2 style="color:var(--accent); margin-bottom:8px; font-size:1.1rem;">Session Finder</h2>
      <p style="color:var(--fg-dim);">还没建索引。在 Claude Code 里说「更新会话索引」先跑一次 backfill（session-finder skill），再回来刷新本页。</p>`;
  }

  const sorted = [...entries].sort(
    (a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || ''))
  );

  const cards = sorted.map(e => {
    const title = escapeHtml(e.title || '(无标题)');
    const summary = escapeHtml(e.summary || '');
    const topics = Array.isArray(e.topics) ? e.topics : [];
    const chips = topics.map(t => `<span class="topic-chip">${escapeHtml(t)}</span>`).join('');
    const proj = escapeHtml(basename(e.cwd || '') || e.cwd || '');
    const date = escapeHtml(formatDate(e.startedAt));
    const msgs = Number.isFinite(e.messageCount) ? `${e.messageCount}条` : '';
    const meta = [proj, msgs, date].filter(Boolean).join(' · ');
    const blob = escapeHtml([e.title, e.summary, topics.join(' ')].join(' ').toLowerCase());
    const resumeBtn = e.resume
      ? `<div class="resume-wrap"><button class="btn-resume" data-cmd="${escapeHtml(e.resume)}">▶ Resume</button><span class="tip">复制 resume 命令</span></div>`
      : '';
    return `<div class="sf-card" data-blob="${blob}">
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
    <p style="color:var(--fg-dim); font-size:0.85rem; margin-bottom:12px;">在会话摘要/主题词上关键词即时过滤。想按语义描述找回，请在 Claude Code 里用 session-finder skill。</p>
    <input id="sf-filter" class="sf-filter" type="search" placeholder="🔍 输入关键词即时过滤标题/摘要/主题词..." aria-label="Filter sessions" />
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
    </script>`;
}

export async function renderSessions() {
  const entries = await readSessionIndex();
  return await layout('Session Finder', renderSessionCards(entries), {
    isSessions: true,
    breadcrumbs: [{ label: 'Home', href: '/' }, { label: 'Session Finder' }],
  });
}
