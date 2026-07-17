# claude-station 原生索引刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把会话摘要索引的构建流水线用纯 Node 搬进 claude-station（只在生成摘要时 spawn 本机 `claude -p`），启动时（>3 条待索引）与页面按钮触发刷新，移除外部 launchd 方案，使 station 开源自包含。

**Architecture:** 新增 `src/indexer.mjs`（Node 版 distill/findPending/merge/summarizeBatch/runBackfill）与 `src/reindex-job.mjs`（单飞状态机）；server 加 `POST /api/reindex` + `GET /api/reindex/status`；bin/cli 加启动触发；`/sessions` 页加刷新按钮 + 轮询进度。summarize 通过 `child_process.spawn('claude', ['-p', ...])`，模型只读 prompt、只回 JSON，不用任何工具。

**Tech Stack:** Node stdlib（`node:fs/promises`、`node:child_process`、`node:readline`），测试 `node --test`。无第三方依赖。

## Global Constraints

- 零第三方依赖，只用 Node stdlib + spawn 本机 `claude`。
- 纯加法 + 一处删除（launchd）；不改 station 现有页面/路由既有行为。
- **不动 session-finder skill 及其 Python 脚本**（用户继续使用）。
- 索引文件 `~/.claude/session-index.json`；会话数据 `~/.claude/projects/**/*.jsonl`；跳过 `agent-*.jsonl`。
- sessionId 一律取**文件名 stem**（不信记录内 sessionId）。
- 索引条目字段契约：`sessionId, cwd, title, summary, topics[], startedAt, messageCount, sourceMtime, indexedAt, resume`；`resume = "cd <shell-quoted cwd> && claude --resume <sessionId>"`。
- sourceMtime = `Math.floor(mtimeMs/1000)`（整数秒），与 skill 侧一致。
- 触发规则：仅「启动时待索引 >3」与「点刷新按钮」；其余不跑。单飞锁，二者互斥。
- 每轮上限 cap=40，merge 增量原子（tmp+rename），可续。
- `claude` 缺失/未登录 → 优雅降级，浏览不受影响。
- 当前分支：`feature-station-native-reindex`。

---

## File Structure

- `src/indexer.mjs`（新）— distill / findPending / merge / summarizeBatch / runBackfill。
- `src/reindex-job.mjs`（新）— 单飞状态机：startReindex / getStatus。
- `src/server.mjs`（改）— import + 两个 API 路由。
- `bin/cli.mjs`（改）— 启动触发（>3）。
- `src/views/sessions.mjs`（改）— 刷新按钮 + 状态区 + 轮询脚本。
- `src/views/layout.mjs`（改）— 按钮/进度条样式。
- `test/indexer.test.mjs`（新）、`test/reindex-job.test.mjs`（新）。
- 删除：`~/Library/LaunchAgents/io.session-finder.backfill.plist`、`skills/session-finder/cron/`。

---

### Task 1: 移除 launchd 方案

**Files:**
- Delete: `skills/session-finder/cron/`（整目录：backfill-prompt.txt / run-backfill.sh / io.session-finder.backfill.plist）
- System: 卸载并删除 `~/Library/LaunchAgents/io.session-finder.backfill.plist`

- [ ] **Step 1: 卸载 launchd 任务**

Run:
```bash
launchctl unload -w ~/Library/LaunchAgents/io.session-finder.backfill.plist 2>/dev/null
rm -f ~/Library/LaunchAgents/io.session-finder.backfill.plist
launchctl list | grep session-finder && echo "仍在(异常)" || echo "已移除"
```
Expected: 打印 `已移除`。

- [ ] **Step 2: 删仓库 cron 目录**

Run:
```bash
cd /Users/luguotao/code/claude-station
git rm -r skills/session-finder/cron
```
Expected: git 显示删除 3 个文件。

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(session-finder): 移除 launchd 定时方案（改由 station 原生驱动）"
```

---

### Task 2: `distill()` — Node 蒸馏

**Files:**
- Create: `src/indexer.mjs`
- Test: `test/indexer.test.mjs`

**Interfaces:**
- Consumes: `PATHS`、`readSessionIndex` from `./scanner.mjs`（后续任务用；本任务仅建文件 + distill）
- Produces: `distill(path: string) -> Promise<{sessionId,cwd,startedAt,messageCount,sourceMtime,text} | null>`
  sessionId=文件名 stem；保留 user 字符串/text 块 + assistant text 块，user 截 500 / assistant 截 800，丢其它；无文本→null；sourceMtime=整数秒。

- [ ] **Step 1: 写失败测试**

Create `test/indexer.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { distill } from '../src/indexer.mjs';

async function tmpFile(name, lines) {
  const dir = await mkdtemp(join(tmpdir(), 'idx-'));
  const p = join(dir, name);
  await writeFile(p, lines.join('\n'));
  return { dir, p };
}

describe('distill', () => {
  it('keeps conversation text, strips noise, id from filename', async () => {
    const { dir, p } = await tmpFile('88888888-4444-4444-4444-121212121212.jsonl', [
      JSON.stringify({ type: 'user', sessionId: 'SIDECHAIN-OTHER', cwd: '/Users/x/proj', timestamp: '2026-06-01T10:00:00.000Z', message: { role: 'user', content: '讲一下 mbo 逻辑' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-06-01T10:00:05.000Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'SECRET' }, { type: 'text', text: 'mbo 是这样' }, { type: 'tool_use', name: 'Bash', input: { command: 'NOISE_LS' } }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'NOISE_TR' }] } }),
      JSON.stringify({ type: 'attachment', attachment: { data: 'NOISE_B64' } }),
    ]);
    const r = await distill(p);
    assert.equal(r.sessionId, '88888888-4444-4444-4444-121212121212'); // 文件名，非记录内 SIDECHAIN-OTHER
    assert.equal(r.cwd, '/Users/x/proj');
    assert.equal(r.startedAt, '2026-06-01T10:00:00.000Z');
    assert.equal(r.messageCount, 3);
    assert.match(r.text, /讲一下 mbo 逻辑/);
    assert.match(r.text, /mbo 是这样/);
    for (const n of ['SECRET', 'NOISE_LS', 'NOISE_TR', 'NOISE_B64', 'SIDECHAIN-OTHER']) assert.doesNotMatch(r.text, new RegExp(n));
    assert.equal(typeof r.sourceMtime, 'number');
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when no conversation text', async () => {
    const { dir, p } = await tmpFile('empty.jsonl', [JSON.stringify({ type: 'attachment', attachment: { data: 'x' } })]);
    assert.equal(await distill(p), null);
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/luguotao/code/claude-station && node --test test/indexer.test.mjs`
Expected: FAIL（`../src/indexer.mjs` 不存在）

- [ ] **Step 3: 写实现**

Create `src/indexer.mjs`:

```js
import { readFile, readdir, stat, writeFile, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { PATHS, readSessionIndex } from './scanner.mjs';

const U_CAP = 500, A_CAP = 800;

export async function distill(path) {
  const sessionId = basename(path, '.jsonl');
  let cwd = null, startedAt = null, messageCount = 0;
  const users = [], assts = [];
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf-8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    let d;
    try { d = JSON.parse(t); } catch { continue; }
    if (cwd === null && d.cwd) cwd = d.cwd;
    if (startedAt === null && d.timestamp) startedAt = d.timestamp;
    const m = d.message;
    if (d.type === 'user' && m && typeof m === 'object') {
      messageCount++;
      const c = m.content;
      if (typeof c === 'string') { if (c.trim()) users.push(c.slice(0, U_CAP)); }
      else if (Array.isArray(c)) for (const b of c) if (b && b.type === 'text' && b.text && b.text.trim()) users.push(b.text.slice(0, U_CAP));
    } else if (d.type === 'assistant' && m && typeof m === 'object') {
      messageCount++;
      const c = m.content;
      if (Array.isArray(c)) for (const b of c) if (b && b.type === 'text' && b.text && b.text.trim()) assts.push(b.text.slice(0, A_CAP));
    }
  }
  const text = [...users.map(u => '[USER]\n' + u), ...assts.map(a => '[ASSISTANT]\n' + a)].join('\n');
  if (!text.trim()) return null;
  let sourceMtime = 0;
  try { sourceMtime = Math.floor((await stat(path)).mtimeMs / 1000); } catch { /* keep 0 */ }
  return { sessionId, cwd, startedAt, messageCount, sourceMtime, text };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/luguotao/code/claude-station && node --test test/indexer.test.mjs`
Expected: PASS（2 个）

- [ ] **Step 5: Commit**

```bash
git add src/indexer.mjs test/indexer.test.mjs
git commit -m "feat(station): indexer.distill Node 蒸馏 + 单测"
```

---

### Task 3: `findPending()` — 增量 diff（stat 级，便宜）

**Files:**
- Modify: `src/indexer.mjs`（追加函数）
- Test: `test/indexer.test.mjs`（追加）

**Interfaces:**
- Consumes: `readSessionIndex`、`PATHS.PROJECTS_DIR`、`PATHS.SESSION_INDEX_FILE`
- Produces: `findPending(projectsDir?, indexPath?) -> Promise<Array<{sessionId,path,sourceMtime}>>`
  扫 projectsDir 下各目录的 `*.jsonl`（跳过 `.archive` 目录与 `agent-*` 文件），sessionId=文件名 stem，sourceMtime=整数秒；与索引按 sessionId+sourceMtime diff，返回未索引/已变动项。只 stat，不读文件内容。

- [ ] **Step 1: 追加失败测试**

在 `test/indexer.test.mjs` 追加：

```js
import { findPending } from '../src/indexer.mjs';
import { mkdir } from 'node:fs/promises';

describe('findPending', () => {
  it('diffs by sessionId+mtime, skips agent-* and .archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pend-'));
    const projects = join(root, 'projects');
    await mkdir(join(projects, '-proj-a'), { recursive: true });
    await mkdir(join(projects, '.archive'), { recursive: true });
    await writeFile(join(projects, '-proj-a', 'realsess.jsonl'), '{}');
    await writeFile(join(projects, '-proj-a', 'agent-xyz.jsonl'), '{}');
    await writeFile(join(projects, '.archive', 'old.jsonl'), '{}');
    const indexPath = join(root, 'index.json');

    // 无索引 → realsess 待办，agent-* 与 .archive 跳过
    let pend = await findPending(projects, indexPath);
    assert.deepEqual(pend.map(p => p.sessionId).sort(), ['realsess']);

    // 索引里已含 realsess 且 mtime 一致 → 无待办
    const mt = pend[0].sourceMtime;
    await writeFile(indexPath, JSON.stringify([{ sessionId: 'realsess', sourceMtime: mt }]));
    assert.deepEqual(await findPending(projects, indexPath), []);

    // mtime 不一致 → 又待办
    await writeFile(indexPath, JSON.stringify([{ sessionId: 'realsess', sourceMtime: 1 }]));
    assert.equal((await findPending(projects, indexPath)).length, 1);

    await rm(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/luguotao/code/claude-station && node --test test/indexer.test.mjs`
Expected: FAIL（`findPending` 未导出）

- [ ] **Step 3: 写实现**

在 `src/indexer.mjs` 追加：

```js
export async function findPending(projectsDir = PATHS.PROJECTS_DIR, indexPath = PATHS.SESSION_INDEX_FILE) {
  const index = await readSessionIndex(indexPath);
  const byId = new Map(index.filter(e => e && e.sessionId).map(e => [e.sessionId, e]));
  const pending = [];
  let dirents;
  try { dirents = await readdir(projectsDir, { withFileTypes: true }); } catch { return []; }
  for (const de of dirents) {
    if (!de.isDirectory() || de.name === '.archive') continue;
    let files;
    try { files = await readdir(join(projectsDir, de.name)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl') || f.startsWith('agent-')) continue;
      const path = join(projectsDir, de.name, f);
      const sessionId = basename(f, '.jsonl');
      let sourceMtime;
      try { sourceMtime = Math.floor((await stat(path)).mtimeMs / 1000); } catch { continue; }
      const prev = byId.get(sessionId);
      if (prev && prev.sourceMtime === sourceMtime) continue;
      pending.push({ sessionId, path, sourceMtime });
    }
  }
  return pending;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/luguotao/code/claude-station && node --test test/indexer.test.mjs`
Expected: PASS（3 个）

- [ ] **Step 5: Commit**

```bash
git add src/indexer.mjs test/indexer.test.mjs
git commit -m "feat(station): indexer.findPending 增量 diff + 单测"
```

---

### Task 4: `merge()` — Node upsert 原子写

**Files:**
- Modify: `src/indexer.mjs`（追加 `merge` + `shellQuote`）
- Test: `test/indexer.test.mjs`（追加）

**Interfaces:**
- Produces: `merge(entries, indexPath?, now?) -> Promise<number>`
  按 sessionId upsert 进索引；派生 `indexedAt=now`（默认当前 ISO）与 `resume="cd <shellQuote(cwd)> && claude --resume <sessionId>"`；原子写（tmp+rename）；返回索引总条目数。

- [ ] **Step 1: 追加失败测试**

在 `test/indexer.test.mjs` 追加：

```js
import { merge } from '../src/indexer.mjs';
import { readFile as rf } from 'node:fs/promises';

describe('merge', () => {
  const entry = (sid, extra = {}) => ({ sessionId: sid, cwd: '/p/a', title: 'T', summary: 's', topics: ['t'], startedAt: '2026-06-01T00:00:00Z', messageCount: 3, sourceMtime: 111, ...extra });

  it('inserts, derives resume + indexedAt, atomic write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mrg-'));
    const ip = join(dir, 'index.json');
    const n = await merge([entry('s1')], ip, '2026-07-17T00:00:00Z');
    assert.equal(n, 1);
    const data = JSON.parse(await rf(ip, 'utf-8'));
    assert.equal(data[0].resume, 'cd /p/a && claude --resume s1');
    assert.equal(data[0].indexedAt, '2026-07-17T00:00:00Z');
    await rm(dir, { recursive: true, force: true });
  });

  it('upserts same id, adds new id, shell-quotes cwd with spaces', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mrg-'));
    const ip = join(dir, 'index.json');
    await merge([entry('s1', { title: 'old' })], ip, 't0');
    await merge([entry('s1', { title: 'new' }), entry('s2', { cwd: '/Users/x/My Project' })], ip, 't1');
    const data = JSON.parse(await rf(ip, 'utf-8'));
    assert.equal(data.length, 2);
    assert.equal(data.find(e => e.sessionId === 's1').title, 'new');
    assert.equal(data.find(e => e.sessionId === 's2').resume, "cd '/Users/x/My Project' && claude --resume s2");
    await rm(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/luguotao/code/claude-station && node --test test/indexer.test.mjs`
Expected: FAIL（`merge` 未导出）

- [ ] **Step 3: 写实现**

在 `src/indexer.mjs` 追加：

```js
function shellQuote(s) {
  if (s === '') return "''";
  if (/^[A-Za-z0-9_/.@%+=:,-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

export async function merge(entries, indexPath = PATHS.SESSION_INDEX_FILE, now = new Date().toISOString()) {
  const existing = await readSessionIndex(indexPath);
  const byId = new Map(existing.filter(e => e && e.sessionId).map(e => [e.sessionId, e]));
  for (const e of entries) {
    const cwd = e.cwd || '';
    byId.set(e.sessionId, {
      sessionId: e.sessionId,
      cwd,
      title: e.title || '',
      summary: e.summary || '',
      topics: Array.isArray(e.topics) ? e.topics : [],
      startedAt: e.startedAt ?? null,
      messageCount: e.messageCount ?? 0,
      sourceMtime: e.sourceMtime ?? null,
      indexedAt: now,
      resume: `cd ${shellQuote(cwd)} && claude --resume ${e.sessionId}`,
    });
  }
  const merged = [...byId.values()];
  const tmp = indexPath + '.tmp';
  await writeFile(tmp, JSON.stringify(merged, null, 2), 'utf-8');
  await rename(tmp, indexPath);
  return merged.length;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/luguotao/code/claude-station && node --test test/indexer.test.mjs`
Expected: PASS（5 个）

- [ ] **Step 5: Commit**

```bash
git add src/indexer.mjs test/indexer.test.mjs
git commit -m "feat(station): indexer.merge Node upsert 原子写 + 单测"
```

---

### Task 5: `summarizeBatch()` + `runBackfill()` — 摘要与编排

**Files:**
- Modify: `src/indexer.mjs`（追加）
- Test: `test/indexer.test.mjs`（追加）

**Interfaces:**
- Consumes: `distill`、`findPending`、`merge`
- Produces:
  - `summarizeBatch(items, {runner}?) -> Promise<{summaries: Array<{idx,title,summary,topics}>, cost: number}>`
    items=`[{idx,text}]`。默认 runner spawn `claude -p <prompt> --output-format json --permission-mode bypassPermissions --allowedTools ""`；解析外层 `{result,total_cost_usd,is_error}` → 内层 JSON 数组（容错去 markdown 围栏）。`runner(prompt)->Promise<string>` 可注入。
  - `runBackfill({cap=40,onProgress,summarize,projectsDir,indexPath}?) -> Promise<{added,total,cost}>`
    findPending→前 cap→distill→按大小分批（≤15 且 ≤80KB，超大单独）→summarize→按 idx 挂身份→逐批增量 merge；每批后 `onProgress({done,total})`。

- [ ] **Step 1: 追加失败测试**

在 `test/indexer.test.mjs` 追加：

```js
import { summarizeBatch, runBackfill } from '../src/indexer.mjs';

describe('summarizeBatch', () => {
  it('parses claude json result into summaries + cost, honoring idx', async () => {
    const fakeRunner = async () => JSON.stringify({
      is_error: false, total_cost_usd: 0.12,
      result: JSON.stringify([{ idx: 0, title: 'A', summary: 'sa', topics: ['x'] }, { idx: 1, title: 'B', summary: 'sb', topics: [] }]),
    });
    const { summaries, cost } = await summarizeBatch([{ idx: 0, text: 't0' }, { idx: 1, text: 't1' }], { runner: fakeRunner });
    assert.equal(summaries.length, 2);
    assert.equal(summaries[0].idx, 0);
    assert.equal(summaries[1].title, 'B');
    assert.equal(cost, 0.12);
  });

  it('strips markdown fences in result', async () => {
    const fakeRunner = async () => JSON.stringify({ is_error: false, total_cost_usd: 0, result: '```json\n[{"idx":0,"title":"A","summary":"s","topics":[]}]\n```' });
    const { summaries } = await summarizeBatch([{ idx: 0, text: 't' }], { runner: fakeRunner });
    assert.equal(summaries[0].title, 'A');
  });
});

describe('runBackfill', () => {
  it('distills pending, summarizes via injected fn, merges with correct identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bf-'));
    const projects = join(root, 'projects');
    await mkdir(join(projects, '-proj'), { recursive: true });
    const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await writeFile(join(projects, '-proj', sid + '.jsonl'),
      JSON.stringify({ type: 'user', cwd: '/w/proj', timestamp: '2026-06-01T00:00:00Z', message: { role: 'user', content: '先做 A 再做 B' } }));
    const ip = join(root, 'index.json');

    const fakeSummarize = async (items) => ({
      summaries: items.map(it => ({ idx: it.idx, title: '标题', summary: '先 A→再 B', topics: ['a', 'b'] })),
      cost: 0.01,
    });
    const progress = [];
    const r = await runBackfill({ projectsDir: projects, indexPath: ip, summarize: fakeSummarize, onProgress: p => progress.push(p) });
    assert.equal(r.added, 1);
    const data = JSON.parse(await rf(ip, 'utf-8'));
    assert.equal(data[0].sessionId, sid);          // 身份=文件名，来自 station 不是模型
    assert.equal(data[0].cwd, '/w/proj');
    assert.equal(data[0].title, '标题');
    assert.equal(data[0].resume, `cd /w/proj && claude --resume ${sid}`);
    assert.ok(progress.length >= 1);
    await rm(root, { recursive: true, force: true });
  });

  it('returns added:0 when nothing pending', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bf0-'));
    await mkdir(join(root, 'projects'), { recursive: true });
    const r = await runBackfill({ projectsDir: join(root, 'projects'), indexPath: join(root, 'index.json'), summarize: async () => ({ summaries: [], cost: 0 }) });
    assert.equal(r.added, 0);
    await rm(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/luguotao/code/claude-station && node --test test/indexer.test.mjs`
Expected: FAIL（`summarizeBatch`/`runBackfill` 未导出）

- [ ] **Step 3: 写实现**

在 `src/indexer.mjs` 追加：

```js
const MAX_N = 15, MAX_CHARS = 80000, SOLO = 80000;

const SUMMARY_INSTRUCTION = `你在为会话检索索引生成摘要。输入是若干条 {idx, text}（text 是蒸馏后的对话，含 [USER]/[ASSISTANT] 标记）。
对每条输出一个对象：{"idx":<原样整数>,"title":"简短中文标题","summary":"3-5句中文，描述会话演进弧线：先→接着→再→最后，抓用户意图推进，不只写开头","topics":["主题词",...]}。
idx 必须原样回传，不要编造或改动任何 id。只输出一个 JSON 数组，不要 markdown 代码围栏、不要多余文字。`;

function defaultRunner(prompt) {
  return new Promise((resolve, reject) => {
    const cp = spawn('claude', ['-p', prompt, '--output-format', 'json', '--permission-mode', 'bypassPermissions', '--allowedTools', ''], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    cp.stdout.on('data', d => (out += d));
    cp.stderr.on('data', d => (err += d));
    cp.on('error', e => reject(Object.assign(new Error('claude spawn failed: ' + e.message), { code: e.code })));
    cp.on('close', code => code === 0 ? resolve(out) : reject(new Error('claude exited ' + code + ': ' + err.slice(0, 300))));
  });
}

export async function summarizeBatch(items, { runner = defaultRunner } = {}) {
  const prompt = SUMMARY_INSTRUCTION + '\n\n输入：\n' + JSON.stringify(items.map(i => ({ idx: i.idx, text: i.text })));
  const raw = await runner(prompt);
  let outer;
  try { outer = JSON.parse(raw); } catch { throw new Error('claude output not JSON'); }
  if (outer.is_error) throw new Error('claude error: ' + String(outer.result || '').slice(0, 200));
  let text = String(outer.result || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const arr = JSON.parse(text);
  if (!Array.isArray(arr)) throw new Error('summary result not an array');
  return { summaries: arr, cost: outer.total_cost_usd || 0 };
}

export async function runBackfill({ cap = 40, onProgress = () => {}, summarize = summarizeBatch, projectsDir, indexPath } = {}) {
  const pd = projectsDir || PATHS.PROJECTS_DIR;
  const ip = indexPath || PATHS.SESSION_INDEX_FILE;
  const pending = (await findPending(pd, ip)).slice(0, cap);
  const items = [];
  for (const p of pending) {
    const d = await distill(p.path);
    if (d) items.push({ ...d, idx: items.length });
  }
  if (items.length === 0) {
    const total = (await readSessionIndex(ip)).length;
    return { added: 0, total, cost: 0 };
  }
  const batches = [];
  let cur = [], curChars = 0;
  for (const it of items) {
    const tl = it.text.length;
    if (tl > SOLO) { if (cur.length) { batches.push(cur); cur = []; curChars = 0; } batches.push([it]); continue; }
    if (cur.length && (cur.length >= MAX_N || curChars + tl > MAX_CHARS)) { batches.push(cur); cur = []; curChars = 0; }
    cur.push(it); curChars += tl;
  }
  if (cur.length) batches.push(cur);

  const byIdx = new Map(items.map(it => [it.idx, it]));
  let done = 0, cost = 0, added = 0;
  onProgress({ done, total: items.length });
  for (const batch of batches) {
    const { summaries, cost: c } = await summarize(batch.map(it => ({ idx: it.idx, text: it.text })));
    cost += c || 0;
    const entries = [];
    for (const s of summaries) {
      const it = byIdx.get(s.idx);
      if (!it) continue;
      entries.push({ sessionId: it.sessionId, cwd: it.cwd, title: s.title, summary: s.summary, topics: s.topics, startedAt: it.startedAt, messageCount: it.messageCount, sourceMtime: it.sourceMtime });
    }
    if (entries.length) { await merge(entries, ip); added += entries.length; }
    done += batch.length;
    onProgress({ done, total: items.length });
  }
  const total = (await readSessionIndex(ip)).length;
  return { added, total, cost };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/luguotao/code/claude-station && node --test test/indexer.test.mjs`
Expected: PASS（9 个）

- [ ] **Step 5: Commit**

```bash
git add src/indexer.mjs test/indexer.test.mjs
git commit -m "feat(station): indexer.summarizeBatch + runBackfill（可注入 runner）+ 单测"
```

---

### Task 6: 单飞任务机 + API 路由

**Files:**
- Create: `src/reindex-job.mjs`
- Modify: `src/server.mjs`
- Test: `test/reindex-job.test.mjs`

**Interfaces:**
- Consumes: `runBackfill` from `./indexer.mjs`
- Produces:
  - `startReindex({backfill}?) -> {started: boolean, alreadyRunning?: boolean}` 单飞：running 时返回 `{started:false, alreadyRunning:true}`。
  - `getStatus() -> {running,total,done,startedAt,finishedAt,added,cost,error,claudeMissing}`
- Server: `POST /api/reindex` → `sendJson(startReindex())`；`GET /api/reindex/status` → `sendJson(getStatus())`。

- [ ] **Step 1: 写失败测试**

Create `test/reindex-job.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startReindex, getStatus } from '../src/reindex-job.mjs';

describe('reindex-job single-flight', () => {
  it('rejects a second start while running, then allows after finish', async () => {
    let release;
    const gate = new Promise(r => (release = r));
    const backfill = async ({ onProgress }) => { onProgress?.({ done: 0, total: 2 }); await gate; return { added: 2, total: 10, cost: 0.05 }; };

    const first = startReindex({ backfill });
    assert.equal(first.started, true);
    assert.equal(getStatus().running, true);

    const second = startReindex({ backfill });
    assert.equal(second.started, false);
    assert.equal(second.alreadyRunning, true);

    release();
    // 等任务收尾
    for (let i = 0; i < 50 && getStatus().running; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(getStatus().running, false);
    assert.equal(getStatus().added, 2);

    // 收尾后可再次启动
    assert.equal(startReindex({ backfill: async () => ({ added: 0, total: 10, cost: 0 }) }).started, true);
    for (let i = 0; i < 50 && getStatus().running; i++) await new Promise(r => setTimeout(r, 10));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/luguotao/code/claude-station && node --test test/reindex-job.test.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

Create `src/reindex-job.mjs`:

```js
import { runBackfill } from './indexer.mjs';

let state = freshIdle();

function freshIdle() {
  return { running: false, total: 0, done: 0, startedAt: null, finishedAt: null, added: 0, cost: 0, error: null, claudeMissing: false };
}

export function getStatus() {
  return { ...state };
}

export function startReindex({ backfill = runBackfill } = {}) {
  if (state.running) return { started: false, alreadyRunning: true };
  state = { ...freshIdle(), running: true, startedAt: new Date().toISOString() };
  Promise.resolve()
    .then(() => backfill({ cap: 40, onProgress: ({ done, total }) => { state.done = done; state.total = total; } }))
    .then(r => { state.added = r.added; if (typeof r.total === 'number') state.total = r.total; state.cost = r.cost || 0; })
    .catch(e => { state.error = e.message; if (e.code === 'ENOENT') state.claudeMissing = true; })
    .finally(() => { state.running = false; state.finishedAt = new Date().toISOString(); });
  return { started: true };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd /Users/luguotao/code/claude-station && node --test test/reindex-job.test.mjs`
Expected: PASS（1 个）

- [ ] **Step 5: 接 API 路由（server.mjs）**

在 `src/server.mjs` 顶部 import 区（`renderSessions` import 之后）加：

```js
import { startReindex, getStatus } from './reindex-job.mjs';
```

在 `GET /sessions` 路由块之后加：

```js
      // POST /api/reindex — 触发一次增量索引（单飞）
      if (method === 'POST' && path === '/api/reindex') {
        return sendJson(res, startReindex());
      }

      // GET /api/reindex/status — 索引任务状态
      if (method === 'GET' && path === '/api/reindex/status') {
        return sendJson(res, getStatus());
      }
```

- [ ] **Step 6: 冒烟（起服务打接口）**

Run:
```bash
cd /Users/luguotao/code/claude-station && node bin/cli.mjs --no-open >/tmp/st.log 2>&1 &
sleep 1.5; P=$(grep -oE 'localhost:[0-9]+' /tmp/st.log|head -1|cut -d: -f2); P=${P:-3456}
curl -s -o /dev/null -w "status端点:%{http_code}\n" "http://localhost:$P/api/reindex/status"
curl -s "http://localhost:$P/api/reindex/status" | head -c 200; echo
pkill -f "bin/cli.mjs"
```
Expected: `status端点:200`，返回含 `"running"` 的 JSON。

- [ ] **Step 7: Commit**

```bash
git add src/reindex-job.mjs src/server.mjs test/reindex-job.test.mjs
git commit -m "feat(station): reindex 单飞任务机 + /api/reindex 路由 + 单测"
```

---

### Task 7: 启动触发（>3）+ 刷新按钮 UI + 进度轮询

**Files:**
- Modify: `bin/cli.mjs`（启动触发）
- Modify: `src/views/sessions.mjs`（按钮 + 状态区 + 轮询脚本）
- Modify: `src/views/layout.mjs`（按钮/进度条样式）

**Interfaces:**
- Consumes: `findPending`（cli 用）、`startReindex`（cli 用）、`/api/reindex` + `/api/reindex/status`（前端用）

- [ ] **Step 1: 启动触发（bin/cli.mjs）**

把 `bin/cli.mjs` 的 import 区改为：

```js
#!/usr/bin/env node

import { startServer } from '../src/server.mjs';
import { findPending } from '../src/indexer.mjs';
import { startReindex } from '../src/reindex-job.mjs';
```

在 `startServer(PORT, (actualPort) => { ... })` 回调内、`console.log(...running...)` 之后加：

```js
  // 启动触发：待索引 >3 条才自动跑一次（可见，不阻塞）
  findPending().then(pending => {
    if (pending.length > 3) {
      console.log(`[session-index] ${pending.length} 条待索引，开始后台刷新…（浏览 /sessions 看进度）`);
      startReindex();
    }
  }).catch(() => {});
```

- [ ] **Step 2: 手测启动触发（观察日志，不实际等它跑完）**

Run:
```bash
cd /Users/luguotao/code/claude-station && node bin/cli.mjs --no-open >/tmp/st2.log 2>&1 &
sleep 2; cat /tmp/st2.log; pkill -f "bin/cli.mjs"
```
Expected: 打印 running 行；若当前待索引 >3 则additionally 打印 `[session-index] N 条待索引…`。（≤3 则只有 running 行——都算正常。）

- [ ] **Step 3: UI — 按钮 + 状态区（sessions.mjs）**

在 `src/views/sessions.mjs` 的 `renderSessionCards` 返回的 HTML 顶部（`<h2>Session Finder ...</h2>` 那行之后）插入按钮与状态区，并把标题行下方的说明段保留。具体：把 `renderSessionCards` 里 `return \`<h2 ...>...</h2>` 起始那段替换为在 h2 之后紧跟：

```js
    <div class="sf-toolbar">
      <button id="sf-reindex" class="sf-reindex-btn" type="button">🔄 刷新 session 索引</button>
      <span id="sf-reindex-status" class="sf-reindex-status"></span>
    </div>
```

即返回模板改为（h2 → toolbar → 原说明段 → 过滤框 → 列表 → 原过滤脚本 → 新增轮询脚本）。新增轮询脚本追加在返回模板末尾（原 `</script>` 之后）：

```html
    <script>
    (function(){
      var btn = document.getElementById('sf-reindex');
      var statusEl = document.getElementById('sf-reindex-status');
      if(!btn || !statusEl) return;
      var polling = false;
      function render(s){
        if(s.claudeMissing){ statusEl.textContent = '需要本机安装并登录 Claude Code 才能刷新'; btn.disabled = false; return; }
        if(s.error){ statusEl.textContent = '出错：' + s.error; btn.disabled = false; return; }
        if(s.running){ btn.disabled = true; statusEl.textContent = '索引中 ' + s.done + '/' + s.total + '…'; }
        else { btn.disabled = false; }
      }
      function poll(){
        fetch('/api/reindex/status').then(function(r){return r.json();}).then(function(s){
          render(s);
          if(s.running){ setTimeout(poll, 2000); }
          else if(polling){ polling = false; if(s.added>0){ location.reload(); } else { statusEl.textContent = s.finishedAt ? ('已是最新' + (s.cost? '（$'+s.cost.toFixed(3)+'）':'')) : ''; } }
        }).catch(function(){ statusEl.textContent=''; });
      }
      btn.addEventListener('click', function(){
        btn.disabled = true; statusEl.textContent = '启动中…';
        fetch('/api/reindex', {method:'POST'}).then(function(r){return r.json();}).then(function(){ polling = true; poll(); });
      });
      // 页面加载时若已有任务在跑（启动触发的），直接接管显示
      fetch('/api/reindex/status').then(function(r){return r.json();}).then(function(s){ if(s.running){ polling = true; render(s); setTimeout(poll, 2000); } });
    })();
    </script>
```

- [ ] **Step 4: UI 样式（layout.mjs）**

在 `layout.mjs` `<style>` 内 `.sf-filter {` 之前插入：

```css
    .sf-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .sf-reindex-btn {
      background: var(--bg-card); border: 1px solid var(--border); color: var(--fg);
      padding: 8px 14px; border-radius: 8px; font-family: inherit; font-size: 0.85rem;
      cursor: pointer; transition: all 200ms cubic-bezier(0.4,0,0.2,1);
    }
    .sf-reindex-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .sf-reindex-btn:disabled { opacity: 0.55; cursor: default; }
    .sf-reindex-status { font-size: 0.8rem; color: var(--fg-dim); }
```

- [ ] **Step 5: 全测试 + 端到端手测**

Run: `cd /Users/luguotao/code/claude-station && npm test 2>&1 | grep -E "^# (pass|fail)"`
Expected: 全绿（既有 + indexer 9 + reindex-job 1）。

再起服务手测：
```bash
cd /Users/luguotao/code/claude-station && node bin/cli.mjs --no-open >/tmp/st3.log 2>&1 &
sleep 1.5; P=$(grep -oE 'localhost:[0-9]+' /tmp/st3.log|head -1|cut -d: -f2); P=${P:-3456}
curl -s "http://localhost:$P/sessions" | grep -c 'sf-reindex' 
pkill -f "bin/cli.mjs"
```
Expected: `/sessions` 含 `sf-reindex` 按钮（计数 ≥1）。浏览器打开点按钮 → 状态显示"索引中 x/y…" → 完成后列表刷新（有新会话时）。

- [ ] **Step 6: Commit**

```bash
git add bin/cli.mjs src/views/sessions.mjs src/views/layout.mjs
git commit -m "feat(station): 启动触发(>3)+刷新按钮+进度轮询，索引刷新纳入 station"
```

---

## Self-Review

**Spec coverage：**
- Node 流水线 distill/findPending/merge/summarizeBatch/runBackfill → Task 2-5 ✅
- summarize 仅 spawn claude、不用工具（--allowedTools ""）→ Task 5 defaultRunner ✅
- 单飞 + 状态 → Task 6 reindex-job ✅
- API POST/GET → Task 6 ✅
- 启动触发 >3 → Task 7 Step 1 ✅
- 按钮 + 进度轮询 + 降级(claudeMissing/error) → Task 7 Step 3 ✅
- 移除 launchd（unload+删plist+删cron目录）→ Task 1 ✅
- sessionId=文件名、resume shell-quote、sourceMtime 秒、跳过 agent-*、cap40、增量原子 merge → 分布在 Task 2/3/4/5，测试覆盖 ✅
- 不动 skill/Python → 本计划不触及 `skills/session-finder/scripts` 与 SKILL.md ✅

**Placeholder scan：** 无 TBD/TODO；所有代码步骤给出完整代码；测试为真实断言。

**Type consistency：** `distill` 返回字段被 `runBackfill` 消费一致；`findPending` 返回 `{sessionId,path,sourceMtime}` 与 runBackfill 用法一致；`summarizeBatch` 返回 `{summaries,cost}` 与 runBackfill 解构一致；`startReindex`/`getStatus` 字段与前端轮询脚本读取字段（running/done/total/added/cost/error/claudeMissing/finishedAt）一致；索引条目契约字段在 merge 与既有 `sessions.mjs`/`readSessionIndex` 之间一致。
