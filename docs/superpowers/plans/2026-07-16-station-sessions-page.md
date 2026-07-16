# Station Session Finder 展示页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 claude-station 加一个 `/sessions` 页面，读 `~/.claude/session-index.json` 卡片化浏览会话、关键词即时过滤、一键 resume。

**Architecture:** 纯加法，沿用 station 现有模式（零依赖 Node stdlib + HTML-string view + `layout()` + 正则路由）。数据层 `readSessionIndex()` 落在 `scanner.mjs`；视图层 `sessions.mjs` 提供纯函数 `renderSessionCards(entries)` 与 `renderSessions()`；路由与侧栏入口分别改 `server.mjs` 和 `layout.mjs`。Resume 复用现有 `.btn-resume` 复制 JS。

**Tech Stack:** Node stdlib（`node:fs/promises`/`node:path`/`node:os`），测试用 `node --test` + `node:assert/strict`。无第三方依赖。

## Global Constraints

- 零第三方依赖，只用 Node stdlib（与 station 一致）。
- 纯加法：不改 station 任何现有页面/路由/样式变量的行为。
- 页面对 `~/.claude/session-index.json` **只读**；不做 AI 语义搜索、不做服务端搜索接口、不在 station 内触发 backfill。
- 索引缺失/坏/空 → 优雅降级为空态提示，不抛错。
- 所有渲染进 HTML 的字段必须 `escapeHtml`。
- 消费的索引字段：`title, summary, topics[], cwd, messageCount, startedAt, resume`。
- 当前工作分支：`feature-station-sessions`（`/Users/luguotao/code/claude-station`）。

---

## File Structure

- `src/scanner.mjs`（改）— 加 `SESSION_INDEX_FILE` 常量 + `readSessionIndex()`。
- `src/views/sessions.mjs`（新）— `renderSessionCards(entries)`（纯函数）+ `renderSessions()`（套 layout）。
- `src/server.mjs`（改）— import + `GET /sessions` 路由。
- `src/views/layout.mjs`（改）— 侧栏 footer 加入口，`layout`/`renderSidebar` 加 `isSessions` 形参，`<style>` 加卡片/过滤/chip 样式。
- `test/sessions.test.mjs`（新）— `readSessionIndex` + `renderSessionCards` 测试。

---

### Task 1: `readSessionIndex()` 数据读取（scanner.mjs）

**Files:**
- Modify: `src/scanner.mjs`（顶部常量区 + 新增导出函数）
- Test: `test/sessions.test.mjs`（本任务先建，只放 readSessionIndex 部分）

**Interfaces:**
- Produces: `readSessionIndex(indexPath = SESSION_INDEX_FILE) -> Promise<Array>`
  读并 `JSON.parse` 索引文件；文件缺失/读失败/JSON 坏/顶层非数组 → 返回 `[]`（不抛）。`indexPath` 可传自定义路径（为测试），默认 `~/.claude/session-index.json`。

- [ ] **Step 1: 写失败测试**

Create `test/sessions.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionIndex } from '../src/scanner.mjs';

describe('readSessionIndex', () => {
  it('parses a valid index array', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sf-'));
    const f = join(dir, 'idx.json');
    await writeFile(f, JSON.stringify([{ sessionId: 's1', title: 'T' }]));
    const out = await readSessionIndex(f);
    assert.equal(out.length, 1);
    assert.equal(out[0].sessionId, 's1');
    await rm(dir, { recursive: true, force: true });
  });

  it('returns [] when file missing', async () => {
    const out = await readSessionIndex('/nonexistent/nope-session-index.json');
    assert.deepEqual(out, []);
  });

  it('returns [] on bad JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sf-'));
    const f = join(dir, 'idx.json');
    await writeFile(f, '{ not json');
    assert.deepEqual(await readSessionIndex(f), []);
    await rm(dir, { recursive: true, force: true });
  });

  it('returns [] when top-level is not an array', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sf-'));
    const f = join(dir, 'idx.json');
    await writeFile(f, JSON.stringify({ not: 'array' }));
    assert.deepEqual(await readSessionIndex(f), []);
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/luguotao/code/claude-station && node --test test/sessions.test.mjs`
Expected: FAIL（`readSessionIndex` 未导出 / import 报错）

- [ ] **Step 3: 写实现**

在 `src/scanner.mjs`：常量区（`CLAUDE_JSON` 那行之后）加：

```js
const SESSION_INDEX_FILE = join(CLAUDE_DIR, 'session-index.json');
```

并把它加进 `PATHS` 导出对象（在 `SETTINGS_FILE, CLAUDE_JSON,` 之后加一行 `SESSION_INDEX_FILE,`）。

然后在文件末尾（其它 `export` 函数旁）新增：

```js
/**
 * Read the session-finder index (~/.claude/session-index.json).
 * Returns [] on any problem (missing/unreadable/bad JSON/not an array) — never throws.
 * @param {string} [indexPath] override for testing
 * @returns {Promise<Array>}
 */
export async function readSessionIndex(indexPath = SESSION_INDEX_FILE) {
  try {
    const raw = await readFile(indexPath, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
```

（`readFile` 已在文件顶部从 `node:fs/promises` 导入，无需改 import。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/luguotao/code/claude-station && node --test test/sessions.test.mjs`
Expected: PASS（4 个 readSessionIndex 测试）

- [ ] **Step 5: 真实数据冒烟**

Run: `cd /Users/luguotao/code/claude-station && node -e "import('./src/scanner.mjs').then(m=>m.readSessionIndex()).then(d=>console.log('索引条目:',d.length,'| 示例标题:',d[0]&&d[0].title))"`
Expected: 打印真实索引条目数（约 138）与一个中文标题。

- [ ] **Step 6: Commit**

```bash
git add src/scanner.mjs test/sessions.test.mjs
git commit -m "feat(station): readSessionIndex 读取会话索引 + 单测"
```

---

### Task 2: Session Finder 页面（view + 路由 + 侧栏 + 样式）

**Files:**
- Create: `src/views/sessions.mjs`
- Modify: `src/server.mjs`（import + 路由）
- Modify: `src/views/layout.mjs`（侧栏入口 + `isSessions` 形参 + CSS）
- Test: `test/sessions.test.mjs`（追加 renderSessionCards 测试）

**Interfaces:**
- Consumes: `readSessionIndex()`（Task 1）、`layout(title, content, opts)`（已有）
- Produces:
  - `renderSessionCards(entries: Array) -> string` — 纯函数，返回页面内容 HTML（过滤框 + 卡片列表 + 内联过滤脚本）；空数组返回空态提示 HTML。
  - `renderSessions() -> Promise<string>` — `layout('Session Finder', renderSessionCards(await readSessionIndex()), {...})`。

- [ ] **Step 1: 追加失败测试**

在 `test/sessions.test.mjs` 末尾追加：

```js
import { renderSessionCards } from '../src/views/sessions.mjs';

describe('renderSessionCards', () => {
  const sample = [{
    sessionId: 's1', cwd: '/Users/x/proj', title: '加 LTV 数据集',
    summary: '先讲 mbo 再加数据集', topics: ['mbo', 'ltv'],
    startedAt: '2026-06-01T00:00:00Z', messageCount: 41,
    resume: 'cd /Users/x/proj && claude --resume s1',
  }];

  it('renders title, topic chips, and a resume button with escaped data-cmd', () => {
    const html = renderSessionCards(sample);
    assert.match(html, /加 LTV 数据集/);
    assert.match(html, /topic-chip/);
    assert.match(html, /btn-resume/);
    assert.match(html, /data-cmd="cd \/Users\/x\/proj &amp;&amp; claude --resume s1"/);
    assert.match(html, /data-blob=/);
  });

  it('renders empty-state message for empty array', () => {
    const html = renderSessionCards([]);
    assert.match(html, /更新会话索引/);
    assert.doesNotMatch(html, /sf-card/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/luguotao/code/claude-station && node --test test/sessions.test.mjs`
Expected: FAIL（`../src/views/sessions.mjs` 不存在 / `renderSessionCards` 未导出）

- [ ] **Step 3: 写 view**

Create `src/views/sessions.mjs`:

```js
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
```

- [ ] **Step 4: 跑 renderSessionCards 测试确认通过**

Run: `cd /Users/luguotao/code/claude-station && node --test test/sessions.test.mjs`
Expected: PASS（Task1 的 4 个 + 本任务 2 个 = 6 个）

- [ ] **Step 5: 接路由（server.mjs）**

在 `src/server.mjs` 顶部 import 区（`renderConfig` import 那行之后）加：

```js
import { renderSessions } from './views/sessions.mjs';
```

在 `/config` 路由块之后加：

```js
      // GET /sessions — Session Finder (browse session-index.json)
      if (method === 'GET' && path === '/sessions') {
        const html = await renderSessions();
        return sendHtml(res, html);
      }
```

- [ ] **Step 6: 侧栏入口 + isSessions 形参（layout.mjs）**

改 `renderSidebar` 签名，加末尾形参 `isSessions`：

```js
function renderSidebar(projects, activeEscapedPath, isHome, isConfig, isArchive, isSessions) {
```

在 `sb-footer` 里（`Config Center` 那条链接之后）加：

```js
      <a class="sb-global${isSessions ? ' active' : ''}" href="/sessions">🔎 Session Finder</a>
```

改 `layout` 签名，opts 解构加 `isSessions = false`：

```js
export async function layout(title, content, { breadcrumbs = [], activeEscapedPath = null, isHome = false, isConfig = false, isArchive = false, isSessions = false } = {}) {
```

改 `renderSidebar` 调用处，把 `isSessions` 传进去：

```js
  const sidebarHtml = renderSidebar(projects, activeEscapedPath, isHome, isConfig, isArchive, isSessions);
```

- [ ] **Step 7: 卡片/过滤/chip 样式（layout.mjs `<style>`）**

在 `<style>` 块内、`/* ===== Search results ===== */` 注释那段之前，插入：

```css
    /* ===== Session Finder page ===== */
    .sf-filter {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--border-input);
      color: var(--fg);
      padding: 11px 16px;
      border-radius: 8px;
      font-family: inherit;
      font-size: 0.95rem;
      outline: none;
      margin-bottom: 16px;
      transition: border-color 0.15s;
    }
    .sf-filter:focus { border-color: var(--accent); }
    .sf-card {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 10px;
      box-shadow: var(--shadow-sm);
      transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    .sf-card:hover {
      border-color: var(--accent);
      box-shadow: var(--shadow-md);
      transform: translateY(-2px);
    }
    .sf-main { flex: 1; min-width: 0; }
    .sf-title { color: var(--accent); font-weight: 600; margin-bottom: 4px; }
    .sf-summary { font-size: 0.85rem; color: var(--fg-muted); line-height: 1.5; margin-bottom: 8px; }
    .sf-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
    .topic-chip {
      background: var(--bg-hover);
      color: var(--fg-dim);
      font-size: 0.7rem;
      padding: 2px 8px;
      border-radius: 10px;
    }
    .sf-meta { font-size: 0.75rem; color: var(--fg-faint); }
    .sf-actions { flex-shrink: 0; }
```

- [ ] **Step 8: 端到端手测（真实索引）**

Run: `cd /Users/luguotao/code/claude-station && node -e "import('./src/views/sessions.mjs').then(m=>m.renderSessions()).then(h=>console.log('HTML 长度:',h.length,'| 含 Session Finder:',h.includes('Session Finder'),'| 含 btn-resume:',h.includes('btn-resume'),'| 含侧栏入口:',h.includes('href=\"/sessions\"')))"`
Expected: HTML 长度较大；三个布尔全 true。

- [ ] **Step 9: 起服务肉眼确认（可选但推荐）**

Run: `cd /Users/luguotao/code/claude-station && node bin/cli.mjs &` 然后浏览器开 `http://localhost:3456/sessions`，确认：卡片列出会话、顶部过滤框输入关键词即时筛选、点 Resume 变「✓ Copied」、侧栏底部有 🔎 Session Finder 入口且高亮。确认后 `kill %1`。

- [ ] **Step 10: 全测试 + Commit**

Run: `cd /Users/luguotao/code/claude-station && npm test`
Expected: 全绿（含既有 scanner/v2 测试 + 新 sessions 测试）。

```bash
git add src/views/sessions.mjs src/server.mjs src/views/layout.mjs test/sessions.test.mjs
git commit -m "feat(station): Session Finder 页面（卡片浏览+即时过滤+resume）"
```

---

## Self-Review

**Spec coverage：**
- `readSessionIndex()` 容错读取 → Task 1 ✅
- `renderSessions()`/`renderSessionCards()` 卡片+过滤+空态 → Task 2 Step 3 ✅
- `GET /sessions` 路由 → Task 2 Step 5 ✅
- 侧栏入口 + isSessions 高亮 → Task 2 Step 6 ✅
- 复用 `.btn-resume` 复制 JS → resume 按钮用 `.btn-resume data-cmd`，layout 已有全局绑定 ✅
- 主题词 chip → 新增 `.topic-chip`（spec 允许"优先复用，实现定"，此处选轻量新类）✅
- 即时前端过滤 + 计数 → Task 2 Step 3 内联脚本 ✅
- 空/异常态提示 → renderSessionCards 空分支 + readSessionIndex 容错 ✅
- 单条缺字段兜底 → title/topics/resume/meta 均有默认值 ✅
- 测试 readSessionIndex + renderSessionCards → Task 1/2 ✅
- 纯加法不改现有行为 → 仅新增函数/路由/入口/样式，未改既有逻辑 ✅

**Placeholder scan：** 无 TBD/TODO；所有代码步骤给出完整代码。

**Type consistency：** `readSessionIndex` 返回数组贯穿；`renderSessionCards(entries)` 入参数组、返回 string；`renderSessions()` 返回 Promise<string>；`isSessions` 形参在 `renderSidebar` 与 `layout` 两处签名一致并正确透传。索引字段名（title/summary/topics/cwd/messageCount/startedAt/resume）与阶段1 契约一致。
