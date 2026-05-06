import { layout } from './layout.mjs';
import { getSessionMessages, escapedToRealPath } from '../scanner.mjs';

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

export async function renderSession(escapedPath, sessionId) {
  const realPath = '/' + escapedToRealPath(escapedPath);
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
        <span style="color:#888; font-size:0.85rem;">Session ${sessionId.slice(0, 8)}...</span>
        <span style="color:#666; font-size:0.8rem; margin-left:8px;">${messages.length} messages</span>
      </div>
      <button class="btn-resume" data-cmd="${escapeHtml(resumeCmd)}">Resume</button>
    </div>
    <div class="chat">
      ${messagesHtml || '<p style="color:#888;">No messages in this session.</p>'}
    </div>
  `;

  return layout(`Session ${sessionId.slice(0, 8)}`, content, {
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: realPath, href: `/project/${encodeURIComponent(escapedPath)}` },
      { label: `Session ${sessionId.slice(0, 8)}...` },
    ],
  });
}
