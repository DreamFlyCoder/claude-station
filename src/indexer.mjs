import { readdir, stat, writeFile, rename } from 'node:fs/promises';
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

function shellQuote(s) {
  if (s === '') return "''";
  if (/^[A-Za-z0-9_/.@%+=:,-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, `'\\''`) + "'";
}

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
    return { added: 0, total, cost: 0, errors: 0 };
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
  let done = 0, cost = 0, added = 0, errors = 0;
  onProgress({ done, total: items.length });
  for (const batch of batches) {
    let batchOut;
    try {
      batchOut = await summarize(batch.map(it => ({ idx: it.idx, text: it.text })));
    } catch (e) {
      if (e && e.code === 'ENOENT') throw e; // claude 缺失 → 整个任务失败，交由上层标记 claudeMissing
      errors += 1;
      done += batch.length;
      onProgress({ done, total: items.length });
      continue;
    }
    const { summaries, cost: c } = batchOut;
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
  return { added, total, cost, errors };
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
