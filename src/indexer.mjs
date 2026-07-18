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
