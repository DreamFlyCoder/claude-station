import { layout } from './layout.mjs';
import { getSessionMessages, getRealPath } from '../scanner.mjs';

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTimestamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

const RESUME_TIP = 'Copy to terminal to open and continue this claude code conversation';

export async function renderSession(escapedPath, sessionId) {
  const realPath = await getRealPath(escapedPath);
  const messages = await getSessionMessages(escapedPath, sessionId);

  const resumeCmd = `cd ${realPath} && claude --resume ${sessionId}`;

  const messagesHtml = messages.map(m => `
    <div class="msg ${m.role === 'user' ? 'user' : 'assistant'}">
      <div class="role-label">${m.role === 'user' ? 'You' : 'Claude'}</div>
      <div data-md>${escapeHtml(m.content)}</div>
      ${m.timestamp ? `<div class="timestamp">${formatTimestamp(m.timestamp)}</div>` : ''}
    </div>
  `).join('');

  const content = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <div>
        <span style="color:var(--fg-dim); font-size:0.85rem;">Session ${sessionId.slice(0, 8)}...</span>
        <span style="color:var(--fg-faint); font-size:0.8rem; margin-left:8px;">${messages.length} messages</span>
      </div>
      <span class="resume-wrap">
        <button class="btn-resume" data-cmd="${escapeHtml(resumeCmd)}" title="${RESUME_TIP}">Resume</button>
        <span class="tip">${RESUME_TIP}</span>
      </span>
    </div>
    <div class="chat">
      ${messagesHtml || '<p style="color:var(--fg-dim);">No messages in this session.</p>'}
    </div>
  `;

  return layout(`Session ${sessionId.slice(0, 8)}`, content, {
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: realPath, href: `/project/${encodeURIComponent(escapedPath)}` },
      { label: `Session ${sessionId.slice(0, 8)}...` },
    ],
    activeEscapedPath: escapedPath,
  });
}
