import { readdir, stat, readFile, access, mkdir, rename, copyFile, writeFile, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

const HOME = homedir();
const CLAUDE_DIR = join(HOME, '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
const ARCHIVE_DIR = join(PROJECTS_DIR, '.archive');
const COMMANDS_DIR = join(CLAUDE_DIR, 'commands');
const AGENTS_DIR = join(CLAUDE_DIR, 'agents');
const SKILLS_DIR = join(CLAUDE_DIR, 'skills');
const SETTINGS_FILE = join(CLAUDE_DIR, 'settings.json');
const CLAUDE_JSON = join(HOME, '.claude.json');

export const PATHS = {
  HOME, CLAUDE_DIR, PROJECTS_DIR, ARCHIVE_DIR,
  COMMANDS_DIR, AGENTS_DIR, SKILLS_DIR,
  SETTINGS_FILE, CLAUDE_JSON,
};

/**
 * Extract the real project path from a jsonl file by reading the `cwd` field.
 * This is the only reliable way since the escaped dir name loses info
 * (underscores, dots, etc. all become dashes).
 */
async function extractCwdFromJsonl(filePath) {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.cwd) {
        rl.close();
        return obj.cwd;
      }
    } catch { continue; }
  }
  return null;
}

/**
 * Fallback: convert escaped directory name back to real path.
 * Strip leading '-', replace remaining '-' with '/'.
 * Not always accurate (ambiguous), only used when no jsonl has cwd.
 */
export function escapedToRealPath(escaped) {
  return escaped.slice(1).replace(/-/g, '/');
}

/**
 * Get the real filesystem path for an escaped project directory.
 * Reads cwd from jsonl (reliable), falls back to heuristic.
 */
export async function getRealPath(escapedPath) {
  const projectDir = join(PROJECTS_DIR, escapedPath);
  let files;
  try {
    files = await readdir(projectDir);
  } catch {
    return '/' + escapedToRealPath(escapedPath);
  }
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
  for (const f of jsonlFiles) {
    const cwd = await extractCwdFromJsonl(join(projectDir, f));
    if (cwd) return cwd;
  }
  return '/' + escapedToRealPath(escapedPath);
}

/**
 * Get the global CLAUDE.md content.
 */
export async function getGlobalClaudeMd() {
  try {
    return await readFile(join(CLAUDE_DIR, 'CLAUDE.md'), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Get a project-level CLAUDE.md content.
 */
export async function getProjectClaudeMd(realPath) {
  try {
    return await readFile(join(realPath, 'CLAUDE.md'), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Scan all projects under ~/.claude/projects/.
 * Returns [{escapedPath, realPath, sessionCount, lastActive, hasClaudeMd}]
 */
export async function getProjects() {
  let entries;
  try {
    entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const escapedPath = entry.name;
    const projectDir = join(PROJECTS_DIR, escapedPath);

    // Find all .jsonl files
    let files;
    try {
      files = await readdir(projectDir);
    } catch {
      continue;
    }
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    if (jsonlFiles.length === 0) continue;

    // Get real path from the first jsonl that has a cwd field
    let realPath = null;
    for (const f of jsonlFiles) {
      realPath = await extractCwdFromJsonl(join(projectDir, f));
      if (realPath) break;
    }
    if (!realPath) {
      // Fallback to heuristic
      realPath = '/' + escapedToRealPath(escapedPath);
    }

    // Get last active time from the most recent jsonl mtime
    let lastActive = new Date(0);
    for (const f of jsonlFiles) {
      try {
        const s = await stat(join(projectDir, f));
        if (s.mtime > lastActive) lastActive = s.mtime;
      } catch { /* skip */ }
    }

    // Check for project CLAUDE.md
    let hasClaudeMd = false;
    try {
      await access(join(realPath, 'CLAUDE.md'));
      hasClaudeMd = true;
    } catch { /* no file */ }

    projects.push({
      escapedPath,
      realPath,
      sessionCount: jsonlFiles.length,
      lastActive,
      hasClaudeMd,
    });
  }

  // Sort by lastActive descending
  projects.sort((a, b) => b.lastActive - a.lastActive);
  return projects;
}

/**
 * Get all sessions for a project.
 * Returns [{id, firstPrompt, messageCount, startTime, fileSize}]
 */
export async function readSessionMeta(filePath) {
  let firstPrompt = '';
  let startTime = null;
  let lastTime = null;
  let messageCount = 0;
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.timestamp) {
      if (!startTime) startTime = obj.timestamp;
      lastTime = obj.timestamp;
    }
    if (obj.type === 'user' || obj.type === 'assistant') {
      messageCount++;
      if (!firstPrompt && obj.type === 'user') {
        const content = extractTextContent(obj.message?.content);
        if (content && !content.startsWith('<')) firstPrompt = content.slice(0, 80);
      }
    }
  }
  return { firstPrompt: firstPrompt || '(no prompt)', startTime, lastTime, messageCount };
}

export async function getSessions(escapedPath) {
  const projectDir = join(PROJECTS_DIR, escapedPath);
  let files;
  try {
    files = await readdir(projectDir);
  } catch {
    return [];
  }
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

  const sessions = [];

  for (const f of jsonlFiles) {
    const filePath = join(projectDir, f);
    const id = f.replace('.jsonl', '');

    let firstPrompt = '';
    let startTime = null;
    let lastTime = null;
    let messageCount = 0;

    try {
      const meta = await readSessionMeta(filePath);
      firstPrompt = meta.firstPrompt;
      startTime = meta.startTime;
      lastTime = meta.lastTime;
      messageCount = meta.messageCount;

      const s = await stat(filePath);

      sessions.push({
        id,
        firstPrompt: firstPrompt || '(no prompt)',
        messageCount,
        startTime,
        lastTime,
        fileSize: s.size,
      });
    } catch { /* skip broken files */ }
  }

  // Sort by lastTime descending (most recently active first); fall back to startTime
  sessions.sort((a, b) => {
    const aT = a.lastTime || a.startTime;
    const bT = b.lastTime || b.startTime;
    if (!aT) return 1;
    if (!bT) return -1;
    return new Date(bT) - new Date(aT);
  });

  return sessions;
}

/**
 * Get all messages from a session (streaming read).
 * Returns [{role, content, timestamp}]
 */
export async function getSessionMessages(escapedPath, sessionId) {
  const filePath = join(PROJECTS_DIR, escapedPath, `${sessionId}.jsonl`);
  const messages = [];

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch { continue; }

    if (obj.type !== 'user' && obj.type !== 'assistant') continue;

    const msg = obj.message || {};
    const content = extractTextContent(msg.content);
    if (!content) continue;

    messages.push({
      role: msg.role || obj.type,
      content,
      timestamp: obj.timestamp || null,
    });
  }

  return messages;
}

/**
 * Extract text from content (can be string or array of content blocks).
 */
function extractTextContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(block => block.type === 'text')
      .map(block => block.text || '')
      .join('\n');
  }
  return '';
}

// ---------- Full-text search ----------

/**
 * Search across sessions (or one project when `scope` is set). Streams jsonl files;
 * matches user/assistant text content case-insensitively. Returns at most one result
 * per session — the FIRST hit in that session — and counts the rest in `matchCount`.
 *
 * Each result: { escapedPath, realPath, sessionId, timestamp, snippet, role, matchCount }
 */
export async function searchSessions(query, { limit = 200, scope = null } = {}) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];

  let entries;
  try {
    entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue; // skip .archive
    const escapedPath = entry.name;
    if (scope && scope !== 'all' && escapedPath !== scope) continue;
    const projectDir = join(PROJECTS_DIR, escapedPath);

    let files;
    try {
      files = await readdir(projectDir);
    } catch { continue; }
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    if (jsonlFiles.length === 0) continue;

    // Lazily resolve realPath only if a file in this project matches.
    let realPath = null;

    for (const f of jsonlFiles) {
      const filePath = join(projectDir, f);
      const sessionId = f.replace('.jsonl', '');
      // Per-session: keep only the first hit, but tally total hits in this session.
      let firstHit = null;
      let matchCount = 0;

      try {
        const rl = createInterface({
          input: createReadStream(filePath, { encoding: 'utf-8' }),
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          if (!line.trim()) continue;
          let obj;
          try { obj = JSON.parse(line); } catch { continue; }
          if (obj.type !== 'user' && obj.type !== 'assistant') continue;

          const text = extractTextContent(obj.message?.content);
          if (!text) continue;
          const lower = text.toLowerCase();
          if (lower.indexOf(q) === -1) continue;

          // Count every occurrence in this message (not just the first).
          let from = 0;
          while (true) {
            const idx = lower.indexOf(q, from);
            if (idx === -1) break;
            matchCount++;
            if (!firstHit) {
              const start = Math.max(0, idx - 60);
              const end = Math.min(text.length, idx + q.length + 60);
              const before = (start > 0 ? '…' : '') + text.slice(start, idx);
              const hit = text.slice(idx, idx + q.length);
              const after = text.slice(idx + q.length, end) + (end < text.length ? '…' : '');
              firstHit = {
                timestamp: obj.timestamp || null,
                role: obj.message?.role || obj.type,
                snippet: { before, hit, after }, // caller escapes
              };
            }
            from = idx + q.length;
          }
        }
      } catch { /* skip */ }

      if (firstHit) {
        if (!realPath) realPath = await getRealPath(escapedPath);
        results.push({
          escapedPath,
          realPath,
          sessionId,
          timestamp: firstHit.timestamp,
          role: firstHit.role,
          snippet: firstHit.snippet,
          matchCount,
        });
        if (results.length >= limit) break;
      }
    }
    if (results.length >= limit) break;
  }

  results.sort((a, b) => {
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  return results.slice(0, limit);
}

// ---------- Stats / dashboard ----------

let _statsCache = null;
let _statsCachedAt = 0;
const STATS_TTL_MS = 5 * 60 * 1000;

/**
 * Aggregate per-day session counts and token usage across all jsonl files.
 * Returns { byDay: Map<YYYY-MM-DD, {sessions, inputTokens, outputTokens, cost}>,
 *           byProject: [{escapedPath, realPath, sessions, totalTokens}], totals: {...} }
 *
 * Cost is a rough estimate using Sonnet pricing:
 *   (input_tokens * 3 + output_tokens * 15) / 1e6  USD
 */
export async function getStats({ force = false } = {}) {
  if (!force && _statsCache && Date.now() - _statsCachedAt < STATS_TTL_MS) {
    return _statsCache;
  }

  let entries;
  try {
    entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return { byDay: {}, byProject: [], totals: { sessions: 0, inputTokens: 0, outputTokens: 0, cost: 0 } };
  }

  const byDay = {}; // dayKey -> {sessions, inputTokens, outputTokens, cost}
  const byProject = []; // {escapedPath, realPath, sessions, totalTokens}
  let totalSessions = 0, totalInput = 0, totalOutput = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    const escapedPath = entry.name;
    const projectDir = join(PROJECTS_DIR, escapedPath);

    let files;
    try { files = await readdir(projectDir); } catch { continue; }
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    if (jsonlFiles.length === 0) continue;

    let projInput = 0, projOutput = 0;

    for (const f of jsonlFiles) {
      const filePath = join(projectDir, f);
      let firstTs = null;
      let inTok = 0, outTok = 0;

      try {
        const rl = createInterface({
          input: createReadStream(filePath, { encoding: 'utf-8' }),
          crlfDelay: Infinity,
        });
        for await (const line of rl) {
          if (!line.trim()) continue;
          let obj;
          try { obj = JSON.parse(line); } catch { continue; }
          if (obj.timestamp && !firstTs) firstTs = obj.timestamp;
          const u = obj.message?.usage;
          if (u) {
            inTok += (u.input_tokens || 0);
            outTok += (u.output_tokens || 0);
          }
        }
      } catch { continue; }

      if (firstTs) {
        const day = firstTs.slice(0, 10); // YYYY-MM-DD
        const slot = byDay[day] || (byDay[day] = { sessions: 0, inputTokens: 0, outputTokens: 0, cost: 0 });
        slot.sessions += 1;
        slot.inputTokens += inTok;
        slot.outputTokens += outTok;
        slot.cost += (inTok * 3 + outTok * 15) / 1e6;
      }

      totalSessions += 1;
      totalInput += inTok;
      totalOutput += outTok;
      projInput += inTok;
      projOutput += outTok;
    }

    let realPath = null;
    for (const f of jsonlFiles) {
      realPath = await extractCwdFromJsonl(join(projectDir, f));
      if (realPath) break;
    }
    if (!realPath) realPath = '/' + escapedToRealPath(escapedPath);

    byProject.push({
      escapedPath,
      realPath,
      sessions: jsonlFiles.length,
      totalTokens: projInput + projOutput,
      inputTokens: projInput,
      outputTokens: projOutput,
    });
  }

  const totalCost = (totalInput * 3 + totalOutput * 15) / 1e6;
  const result = {
    byDay,
    byProject: byProject.sort((a, b) => b.sessions - a.sessions),
    totals: { sessions: totalSessions, inputTokens: totalInput, outputTokens: totalOutput, cost: totalCost },
  };
  _statsCache = result;
  _statsCachedAt = Date.now();
  return result;
}

// ---------- Archive ----------

/**
 * Move a session jsonl to ~/.claude/projects/.archive/<escapedPath>/<sessionId>.jsonl.
 * Validates that the target file lives under PROJECTS_DIR (defense in depth).
 * Returns { archivedPath }.
 */
export async function archiveSession(escapedPath, sessionId) {
  // path traversal guard
  if (escapedPath.includes('/') || escapedPath.includes('..') || escapedPath.startsWith('.')) {
    throw new Error('invalid escapedPath');
  }
  if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) {
    throw new Error('invalid sessionId');
  }

  const src = join(PROJECTS_DIR, escapedPath, `${sessionId}.jsonl`);
  // Ensure src is inside PROJECTS_DIR
  const srcResolved = resolve(src);
  if (!srcResolved.startsWith(resolve(PROJECTS_DIR) + sep)) {
    throw new Error('path outside projects dir');
  }
  await access(srcResolved); // throws if missing

  const destDir = join(ARCHIVE_DIR, escapedPath);
  await mkdir(destDir, { recursive: true });
  const dest = join(destDir, `${sessionId}.jsonl`);
  await rename(srcResolved, dest);
  return { archivedPath: dest };
}

/**
 * List all archived sessions, grouped by escapedPath.
 * Returns [{ escapedPath, realPath, sessions: [{id, archivedAt, fileSize, firstPrompt, messageCount}] }].
 */
export async function getArchivedSessions() {
  let projects;
  try {
    projects = await readdir(ARCHIVE_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const escapedPath = p.name;
    const dir = join(ARCHIVE_DIR, escapedPath);
    let files;
    try { files = (await readdir(dir)).filter(f => f.endsWith('.jsonl')); }
    catch { continue; }
    if (files.length === 0) continue;

    const sessions = [];
    for (const f of files) {
      const id = f.replace(/\.jsonl$/, '');
      const filePath = join(dir, f);
      let st;
      try { st = await stat(filePath); } catch { continue; }
      const meta = await readSessionMeta(filePath).catch(() => ({ firstPrompt: '', messageCount: 0 }));
      sessions.push({
        id,
        archivedAt: st.mtime.toISOString(),
        fileSize: st.size,
        firstPrompt: meta.firstPrompt,
        messageCount: meta.messageCount,
      });
    }
    sessions.sort((a, b) => (a.archivedAt < b.archivedAt ? 1 : -1));

    // try to recover real path: archived jsonl still has cwd field
    let realPath = null;
    for (const f of files) {
      realPath = await extractCwdFromJsonl(join(dir, f));
      if (realPath) break;
    }
    if (!realPath) realPath = '/' + escapedToRealPath(escapedPath);

    out.push({ escapedPath, realPath, sessions });
  }
  return out;
}

/**
 * Move an archived session back to active projects dir.
 */
export async function restoreSession(escapedPath, sessionId) {
  if (escapedPath.includes('/') || escapedPath.includes('..') || escapedPath.startsWith('.')) {
    throw new Error('invalid escapedPath');
  }
  if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) {
    throw new Error('invalid sessionId');
  }
  const src = resolve(join(ARCHIVE_DIR, escapedPath, `${sessionId}.jsonl`));
  if (!src.startsWith(resolve(ARCHIVE_DIR) + sep)) {
    throw new Error('path outside archive dir');
  }
  await access(src);
  const destDir = join(PROJECTS_DIR, escapedPath);
  await mkdir(destDir, { recursive: true });
  const dest = join(destDir, `${sessionId}.jsonl`);
  await rename(src, dest);
  return { restoredPath: dest };
}

/**
 * Permanently delete an archived session jsonl. Only allowed under ARCHIVE_DIR.
 */
export async function permanentlyDeleteSession(escapedPath, sessionId) {
  if (escapedPath.includes('/') || escapedPath.includes('..') || escapedPath.startsWith('.')) {
    throw new Error('invalid escapedPath');
  }
  if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) {
    throw new Error('invalid sessionId');
  }
  const target = resolve(join(ARCHIVE_DIR, escapedPath, `${sessionId}.jsonl`));
  if (!target.startsWith(resolve(ARCHIVE_DIR) + sep)) {
    throw new Error('refuse to delete: target outside archive dir');
  }
  await unlink(target);
  return { deleted: target };
}

// ---------- CLAUDE.md write ----------

/**
 * Save CLAUDE.md content with a timestamped backup.
 * Validates: path must end with CLAUDE.md AND live under HOME.
 */
export async function saveClaudeMd(targetPath, content) {
  if (typeof targetPath !== 'string' || typeof content !== 'string') {
    throw new Error('invalid input');
  }
  if (!targetPath.endsWith('CLAUDE.md')) {
    throw new Error('only CLAUDE.md files allowed');
  }
  const resolved = resolve(targetPath);
  if (!resolved.startsWith(resolve(HOME) + sep)) {
    throw new Error('path must be under home directory');
  }

  // Backup if file exists.
  let backupPath = null;
  try {
    await access(resolved);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = `${resolved}.bak.${ts}`;
    await copyFile(resolved, backupPath);
  } catch { /* file did not exist; no backup needed */ }

  await writeFile(resolved, content, 'utf-8');
  return { savedPath: resolved, backupPath };
}

// ---------- Configs (commands / subagents / skills / hooks / mcp) ----------

/**
 * Parse a simple YAML frontmatter block (just `key: value` single-line pairs).
 * Returns { frontmatter: {...}, body: '...' }. Returns frontmatter={} if absent or malformed.
 */
export function parseFrontmatter(text) {
  if (typeof text !== 'string') return { frontmatter: {}, body: '' };
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: text };
  const frontmatter = {};
  const lines = m[1].split(/\r?\n/);
  for (const line of lines) {
    const kv = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    // Strip wrapping quotes.
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    frontmatter[kv[1]] = v;
  }
  return { frontmatter, body: m[2] };
}

async function readMaybe(path) {
  try { return await readFile(path, 'utf-8'); }
  catch { return null; }
}

/** List `~/.claude/commands/*.md`. */
export async function getCommands() {
  let files;
  try { files = await readdir(COMMANDS_DIR); } catch { return []; }
  const items = [];
  for (const f of files.filter(x => x.endsWith('.md'))) {
    const filePath = join(COMMANDS_DIR, f);
    const text = await readMaybe(filePath);
    if (text == null) continue;
    const { frontmatter } = parseFrontmatter(text);
    items.push({
      name: f.replace(/\.md$/, ''),
      path: filePath,
      description: frontmatter.description || '',
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

/** List `~/.claude/agents/*.md`. */
export async function getSubagents() {
  let files;
  try { files = await readdir(AGENTS_DIR); } catch { return []; }
  const items = [];
  for (const f of files.filter(x => x.endsWith('.md'))) {
    const filePath = join(AGENTS_DIR, f);
    const text = await readMaybe(filePath);
    if (text == null) continue;
    const { frontmatter } = parseFrontmatter(text);
    items.push({
      name: frontmatter.name || f.replace(/\.md$/, ''),
      path: filePath,
      description: frontmatter.description || '',
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

/** List `~/.claude/skills/<name>/SKILL.md`. */
export async function getSkills() {
  let entries;
  try { entries = await readdir(SKILLS_DIR, { withFileTypes: true }); } catch { return []; }
  const items = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const filePath = join(SKILLS_DIR, ent.name, 'SKILL.md');
    const text = await readMaybe(filePath);
    if (text == null) continue;
    const { frontmatter } = parseFrontmatter(text);
    items.push({
      name: frontmatter.name || ent.name,
      path: filePath,
      description: frontmatter.description || '',
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

/** Read hooks from settings.json, grouped by event. */
export async function getHooks() {
  const text = await readMaybe(SETTINGS_FILE);
  if (!text) return { source: SETTINGS_FILE, groups: [] };
  let json;
  try { json = JSON.parse(text); } catch { return { source: SETTINGS_FILE, groups: [] }; }
  const hooks = json.hooks || {};
  const groups = Object.keys(hooks).sort().map(event => ({
    event,
    matchers: (hooks[event] || []).map(entry => ({
      matcher: entry.matcher || '*',
      hooks: entry.hooks || [],
    })),
  }));
  return { source: SETTINGS_FILE, groups };
}

/** Read mcpServers from ~/.claude.json. */
export async function getMcpServers() {
  const text = await readMaybe(CLAUDE_JSON);
  if (!text) return { source: CLAUDE_JSON, servers: [] };
  let json;
  try { json = JSON.parse(text); } catch { return { source: CLAUDE_JSON, servers: [] }; }
  const map = json.mcpServers || {};
  const servers = Object.keys(map).sort().map(name => {
    const cfg = map[name] || {};
    // Build a one-line description from common fields, redacting nothing visually
    // since this is local-only viewing — but we summarize, not dump full env.
    const bits = [];
    if (cfg.type) bits.push(`type=${cfg.type}`);
    if (cfg.command) bits.push(`command=${cfg.command}`);
    if (cfg.url) bits.push(`url=${cfg.url}`);
    if (cfg.args && Array.isArray(cfg.args) && cfg.args.length) {
      bits.push(`args=${cfg.args.join(' ')}`);
    }
    return { name, description: bits.join(' · ') };
  });
  return { source: CLAUDE_JSON, servers };
}

// ---------- Project memory ----------

/**
 * List memory files for a project (auto-memory feature output).
 * Path: ~/.claude/projects/<escaped>/memory/*.md
 * Returns [{file, name, description, type, originSessionId, body, isIndex}].
 * MEMORY.md (the index) is included with isIndex: true.
 */
export async function getProjectMemory(escapedPath) {
  const memDir = join(PROJECTS_DIR, escapedPath, 'memory');
  let files;
  try {
    files = await readdir(memDir);
  } catch {
    return [];
  }
  const mdFiles = files.filter(f => f.endsWith('.md'));
  const out = [];
  for (const f of mdFiles) {
    const filePath = join(memDir, f);
    let content;
    try { content = await readFile(filePath, 'utf-8'); } catch { continue; }
    const { frontmatter, body } = parseFrontmatter(content);
    out.push({
      file: f,
      name: frontmatter.name || f.replace(/\.md$/, ''),
      description: frontmatter.description || '',
      type: frontmatter.type || (f === 'MEMORY.md' ? 'index' : 'unknown'),
      originSessionId: frontmatter.originSessionId || null,
      body: body || content,
      isIndex: f === 'MEMORY.md',
    });
  }
  // Sort: index first, then by type, then by name
  out.sort((a, b) => {
    if (a.isIndex !== b.isIndex) return a.isIndex ? -1 : 1;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.name.localeCompare(b.name);
  });
  return out;
}

// ---------- Prompt history ----------

/**
 * Scan ~/.claude/history.jsonl for prompts the user has typed.
 * Each line: { display, timestamp(ms), project(realPath), sessionId, pastedContents }
 *
 * Options:
 *   - query: case-insensitive substring filter on display
 *   - scope: 'all' or an escapedPath (filters by project realPath)
 *   - limit: max results
 *
 * Returns [{ display, timestamp, project, sessionId, escapedPath, snippet }] in time-DESC order.
 */
export async function getPromptHistory({ query = '', scope = 'all', limit = 200 } = {}) {
  const historyFile = join(CLAUDE_DIR, 'history.jsonl');
  let exists = true;
  try { await access(historyFile); } catch { exists = false; }
  if (!exists) return [];

  // Resolve scope to a realPath if not 'all'.
  let scopeRealPath = null;
  if (scope && scope !== 'all') {
    try { scopeRealPath = await getRealPath(scope); } catch { return []; }
  }

  const q = (query || '').trim().toLowerCase();
  const out = [];
  const rl = createInterface({
    input: createReadStream(historyFile, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  // Map realPath -> escapedPath cache (for cheap UI links).
  // We could do strict reverse mapping by reading dir entries; for now derive heuristically.
  const realToEscaped = new Map();

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (typeof obj.display !== 'string') continue;
    if (scopeRealPath && obj.project !== scopeRealPath) continue;

    if (q) {
      const lower = obj.display.toLowerCase();
      const idx = lower.indexOf(q);
      if (idx === -1) continue;
      const start = Math.max(0, idx - 60);
      const end = Math.min(obj.display.length, idx + q.length + 60);
      const before = (start > 0 ? '…' : '') + obj.display.slice(start, idx);
      const hit = obj.display.slice(idx, idx + q.length);
      const after = obj.display.slice(idx + q.length, end) + (end < obj.display.length ? '…' : '');
      obj._snippet = { before, hit, after };
    }

    out.push(obj);
  }

  // Sort by timestamp DESC and take top `limit`.
  out.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const trimmed = out.slice(0, limit);

  // Resolve realPath -> escapedPath by listing PROJECTS_DIR once.
  if (trimmed.some(o => o.project)) {
    try {
      const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name.startsWith('.')) continue;
        const real = await getRealPath(e.name).catch(() => null);
        if (real) realToEscaped.set(real, e.name);
      }
    } catch { /* skip */ }
  }

  return trimmed.map(o => ({
    display: o.display,
    timestamp: o.timestamp,
    project: o.project,
    sessionId: o.sessionId,
    escapedPath: realToEscaped.get(o.project) || null,
    snippet: o._snippet || null,
  }));
}

// ---------- Installed plugins ----------

/**
 * Read ~/.claude/plugins/installed_plugins.json.
 * Returns { plugins: [{key, name, marketplace, scope, version, installedAt, lastUpdated, installPath}], marketplaces: [...] }
 */
export async function getInstalledPlugins() {
  const installedFile = join(CLAUDE_DIR, 'plugins', 'installed_plugins.json');
  const marketsFile = join(CLAUDE_DIR, 'plugins', 'known_marketplaces.json');

  let installed = { version: 0, plugins: {} };
  try {
    const raw = await readFile(installedFile, 'utf-8');
    installed = JSON.parse(raw);
  } catch { /* missing or invalid */ }

  let markets = {};
  try {
    const raw = await readFile(marketsFile, 'utf-8');
    markets = JSON.parse(raw);
  } catch { /* skip */ }

  const plugins = [];
  for (const [key, list] of Object.entries(installed.plugins || {})) {
    const [name, marketplace] = key.split('@');
    for (const inst of (Array.isArray(list) ? list : [])) {
      plugins.push({
        key,
        name,
        marketplace: marketplace || null,
        scope: inst.scope || 'unknown',
        version: inst.version || '?',
        installedAt: inst.installedAt || null,
        lastUpdated: inst.lastUpdated || null,
        installPath: inst.installPath || '',
      });
    }
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name));

  const marketplaces = Object.entries(markets).map(([k, v]) => ({
    name: k,
    url: typeof v === 'string' ? v : (v?.url || ''),
  }));

  return { plugins, marketplaces };
}
