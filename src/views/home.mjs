import { layout } from './layout.mjs';
import { getProjects, getGlobalClaudeMd, getStats, PATHS } from '../scanner.mjs';
import { join } from 'node:path';
import { basename } from 'node:path';

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function bucketLevel(count) {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

/**
 * Render a 90-day GitHub-style heatmap.
 * Layout: 7 rows (weekdays) × ~13 columns. Cells fill bottom-up: today is the
 * rightmost column at the row corresponding to today's weekday.
 */
function renderHeatmap(byDay) {
  const SIZE = 12;
  const GAP = 3;
  const cols = 14;
  const rows = 7;
  const now = new Date();
  // Start = today minus (cols*7 - 1 - todayWeekday) days, so the last column ends at today
  // Simpler: walk backwards 90 days, place each on its (col, row) by date.
  const cells = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // We render exactly cols*7 cells ending at today (some leading cells may be empty/future).
  const totalCells = cols * rows;
  // Find the first cell date so the last cell == today.
  const todayWeekday = today.getDay(); // 0=Sun..6=Sat
  const lastColIndex = cols - 1;
  // total cells AFTER today's cell within last col = (rows-1 - todayWeekday)
  // First cell date = today - (totalCells - 1 - (rows-1 - todayWeekday)) days
  const trailing = (rows - 1 - todayWeekday);
  const startOffset = totalCells - 1 - trailing;
  const startDate = new Date(today.getTime() - startOffset * 86400000);

  for (let i = 0; i < totalCells; i++) {
    const d = new Date(startDate.getTime() + i * 86400000);
    const col = Math.floor(i / rows);
    const row = i % rows;
    const key = ymd(d);
    const isFuture = d > today;
    const sessions = byDay[key]?.sessions || 0;
    cells.push({ col, row, key, sessions, isFuture, date: d });
  }

  const width = cols * (SIZE + GAP);
  const height = rows * (SIZE + GAP);

  const rects = cells.map(c => {
    if (c.isFuture) return '';
    const x = c.col * (SIZE + GAP);
    const y = c.row * (SIZE + GAP);
    const lvl = bucketLevel(c.sessions);
    return `<rect class="heat-${lvl}" x="${x}" y="${y}" width="${SIZE}" height="${SIZE}" rx="2"><title>${c.key}: ${c.sessions} session${c.sessions === 1 ? '' : 's'}</title></rect>`;
  }).join('');

  return `<svg class="heatmap" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Sessions per day, last 90 days">${rects}</svg>`;
}

function renderTopProjects(byProject, limit = 10) {
  const top = byProject.slice(0, limit);
  if (top.length === 0) return '<p style="color:var(--fg-dim);">No data.</p>';
  const max = Math.max(...top.map(p => p.sessions), 1);
  const rows = top.map(p => {
    const name = basename(p.realPath) || p.escapedPath;
    const pct = (p.sessions / max) * 100;
    return `<div class="bar-row">
      <div class="name"><a href="/project/${encodeURIComponent(p.escapedPath)}" title="${escapeHtml(p.realPath)}">${escapeHtml(name)}</a></div>
      <div class="track"><div class="fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="num"><strong>${p.sessions}</strong> sessions <span class="num-sep">·</span> <strong>${(p.totalTokens / 1000).toFixed(0)}k</strong> tokens</div>
    </div>`;
  }).join('');
  return `<div class="bar-chart">${rows}</div>`;
}

/**
 * Cost line chart for the last 30 days.
 * Cost is a rough estimate: (input_tokens * 3 + output_tokens * 15) / 1e6 USD,
 * using Sonnet pricing as a baseline.
 */
function renderCostLine(byDay) {
  const W = 480, H = 160, PADL = 52, PADR = 12, PADT = 12, PADB = 32;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const k = ymd(d);
    days.push({ date: d, key: k, cost: byDay[k]?.cost || 0 });
  }
  const maxCost = Math.max(...days.map(d => d.cost), 0.01);
  const innerW = W - PADL - PADR;
  const innerH = H - PADT - PADB;

  const dotData = days.map((d, i) => ({
    x: PADL + (i / (days.length - 1)) * innerW,
    y: PADT + innerH - (d.cost / maxCost) * innerH,
    key: d.key,
    cost: d.cost,
  }));
  const points = dotData.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // X labels: every ~7 days so we get 5 ticks; first/last anchored
  // at the edge so they never spill past the viewBox.
  const tickIdx = [0, 7, 14, 21, 29];
  const xLabels = tickIdx.map((i, idx) => {
    const p = dotData[i];
    const anchor = idx === 0 ? 'start' : (idx === tickIdx.length - 1 ? 'end' : 'middle');
    return `<text class="label" x="${p.x.toFixed(1)}" y="${H - 8}" text-anchor="${anchor}">${days[i].key.slice(5)}</text>`;
  }).join('');

  const gridLines = [0, 0.5, 1].map(t => {
    const y = PADT + innerH - t * innerH;
    return `<line class="grid" x1="${PADL}" y1="${y.toFixed(1)}" x2="${W - PADR}" y2="${y.toFixed(1)}"/>
            <text class="label" x="${PADL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">$${(maxCost * t).toFixed(2)}</text>`;
  }).join('');

  // Per-point dot with native SVG <title> tooltip on hover
  const dots = dotData.map(p => {
    const tip = `${p.key} · $${p.cost.toFixed(2)}`;
    return `<circle class="dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.4"><title>${tip}</title></circle>`;
  }).join('');

  return `<svg class="line-chart" width="100%" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimated daily cost, last 30 days">
    ${gridLines}
    <line class="axis" x1="${PADL}" y1="${PADT + innerH}" x2="${W - PADR}" y2="${PADT + innerH}"/>
    <polyline class="line" points="${points}"/>
    ${dots}
    ${xLabels}
  </svg>`;
}

function renderClaudeMdEditor(globalMd) {
  const path = join(PATHS.CLAUDE_DIR, 'CLAUDE.md');
  const content = globalMd || '';
  return `
    <div class="claude-md-section md-editor" data-path="${escapeHtml(path)}">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span class="claude-md-title"><span class="icon">📕</span>Global CLAUDE.md</span>
        <div>
          <button class="btn-md-edit md-editor-btn" type="button">Edit</button>
        </div>
      </div>
      <div class="md-view">
        ${globalMd ? `<div data-md>${escapeHtml(globalMd)}</div>` : `<p style="color:var(--fg-dim); font-size:0.85rem;">No global CLAUDE.md at <code>${escapeHtml(path)}</code>. Click Edit to create one.</p>`}
      </div>
      <div class="md-edit" style="display:none;">
        <textarea aria-label="Global CLAUDE.md content">${escapeHtml(content)}</textarea>
        <div class="actions">
          <button class="btn-md-save primary" type="button">Save</button>
          <button class="btn-md-cancel" type="button">Cancel</button>
          <span style="color:var(--fg-faint); font-size:0.75rem; align-self:center;">A timestamped backup will be created.</span>
        </div>
      </div>
    </div>
  `;
}

export async function renderHome() {
  const [projects, globalMd, stats] = await Promise.all([
    getProjects(),
    getGlobalClaudeMd(),
    getStats(),
  ]);

  const totalSessions = projects.reduce((s, p) => s + p.sessionCount, 0);

  const heatmapHtml = renderHeatmap(stats.byDay);
  const topProjectsHtml = renderTopProjects(stats.byProject);
  const costLineHtml = renderCostLine(stats.byDay);
  const editorHtml = renderClaudeMdEditor(globalMd);

  const content = `
    <div class="hero-grid">
      <div class="hero-block hero-stats">
        <h3>Overview</h3>
        <div class="stats-grid">
          <div class="stat-box">
            <div class="num">${projects.length}</div>
            <div class="label">Projects</div>
          </div>
          <div class="stat-box">
            <div class="num">${totalSessions}</div>
            <div class="label">Sessions</div>
          </div>
          <div class="stat-box">
            <div class="num">$${stats.totals.cost.toFixed(2)}</div>
            <div class="label">Est. Cost</div>
          </div>
          <div class="stat-box">
            <div class="num">${(stats.totals.outputTokens / 1000).toFixed(0)}k</div>
            <div class="label">Output Tokens</div>
          </div>
        </div>
      </div>
      <div class="hero-block hero-activity">
        <h3>Activity (last 90 days)</h3>
        <div class="heatmap-wrap">${heatmapHtml}</div>
      </div>
    </div>

    <div class="dash-grid">
      <div class="dash-card">
        <h3>Top Projects</h3>
        <div class="chart-body">${topProjectsHtml}</div>
      </div>
      <div class="dash-card">
        <h3>Estimated Daily Cost (last 30 days)</h3>
        <div class="chart-body">
          ${costLineHtml}
          <p style="color:var(--fg-faint); font-size:0.7rem; margin-top:4px;">
            Rough estimate using Sonnet pricing ($3/MTok input, $15/MTok output).
          </p>
        </div>
      </div>
    </div>

    ${editorHtml}
  `;

  return layout('Home', content, { isHome: true });
}
