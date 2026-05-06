import { layout } from './layout.mjs';
import {
  getCommands, getSubagents, getSkills, getHooks, getMcpServers,
} from '../scanner.mjs';

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s, n = 200) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function emptyState(label) {
  return `<p style="color:var(--fg-dim); font-size:0.85rem;">No ${escapeHtml(label)} found.</p>`;
}

function renderCard(item) {
  return `
    <div class="config-card">
      <div class="name">${escapeHtml(item.name)}</div>
      <div class="path">${escapeHtml(item.path || '')}</div>
      ${item.description ? `<div class="desc">${escapeHtml(truncate(item.description))}</div>` : ''}
    </div>`;
}

export async function renderConfig() {
  const [commands, subagents, skills, hooks, mcp] = await Promise.all([
    getCommands(),
    getSubagents(),
    getSkills(),
    getHooks(),
    getMcpServers(),
  ]);

  const commandsHtml = commands.length ? commands.map(renderCard).join('') : emptyState('commands');
  const subagentsHtml = subagents.length ? subagents.map(renderCard).join('') : emptyState('subagents');
  const skillsHtml = skills.length ? skills.map(renderCard).join('') : emptyState('skills');

  const hooksHtml = hooks.groups.length
    ? hooks.groups.map(g => `
        <div class="config-card">
          <div class="name">${escapeHtml(g.event)}</div>
          <div class="desc">
            ${g.matchers.map(m => `
              <div style="margin-top:4px;">
                <code>${escapeHtml(m.matcher)}</code>:
                ${m.hooks.map(h => escapeHtml(`${h.type || 'cmd'} ${h.command || ''}`).trim()).join('<br>')}
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')
    : `<p style="color:var(--fg-dim); font-size:0.85rem;">No hooks in <code>${escapeHtml(hooks.source)}</code>.</p>`;

  const mcpHtml = mcp.servers.length
    ? mcp.servers.map(s => `
        <div class="config-card">
          <div class="name">${escapeHtml(s.name)}</div>
          <div class="desc">${escapeHtml(s.description || '(no details)')}</div>
        </div>
      `).join('')
    : `<p style="color:var(--fg-dim); font-size:0.85rem;">No MCP servers in <code>${escapeHtml(mcp.source)}</code>.</p>`;

  const content = `
    <h2 style="color:var(--accent); margin-bottom:8px; font-size:1.1rem;">Config Center</h2>
    <p style="color:var(--fg-dim); font-size:0.85rem; margin-bottom:16px;">
      Read-only view of slash commands, subagents, skills, hooks and MCP servers.
    </p>
    <div data-tabs>
      <div class="tabs">
        <button class="tab-btn active" data-tab="commands">Commands (${commands.length})</button>
        <button class="tab-btn" data-tab="subagents">Subagents (${subagents.length})</button>
        <button class="tab-btn" data-tab="skills">Skills (${skills.length})</button>
        <button class="tab-btn" data-tab="hooks">Hooks (${hooks.groups.length})</button>
        <button class="tab-btn" data-tab="mcp">MCP Servers (${mcp.servers.length})</button>
      </div>
      <div class="tab-panel active" data-tab="commands">${commandsHtml}</div>
      <div class="tab-panel" data-tab="subagents">${subagentsHtml}</div>
      <div class="tab-panel" data-tab="skills">${skillsHtml}</div>
      <div class="tab-panel" data-tab="hooks">${hooksHtml}</div>
      <div class="tab-panel" data-tab="mcp">${mcpHtml}</div>
    </div>
  `;

  return layout('Config Center', content, {
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: 'Config Center' },
    ],
    isConfig: true,
  });
}
