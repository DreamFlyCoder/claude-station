import { readdir, stat, readFile, access, mkdir, rename, copyFile, writeFile } from 'node:fs/promises';
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
    let messageCount = 0;

    try {
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

        // Capture earliest non-null timestamp
        if (!startTime && obj.timestamp) {
          startTime = obj.timestamp;
        }

        if (obj.type === 'user' || obj.type === 'assistant') {
          messageCount++;

          // Capture first user prompt
          if (!firstPrompt && obj.type === 'user') {
            const content = extractTextContent(obj.message?.content);
            if (content && !content.startsWith('<')) {
              firstPrompt = content.slice(0, 80);
            }
          }
        }
      }

      const s = await stat(filePath);

      sessions.push({
        id,
        firstPrompt: firstPrompt || '(no prompt)',
        messageCount,
        startTime,
        fileSize: s.size,
      });
    } catch { /* skip broken files */ }
  }

  // Sort by startTime descending
  sessions.sort((a, b) => {
    if (!a.startTime) return 1;
    if (!b.startTime) return -1;
    return new Date(b.startTime) - new Date(a.startTime);
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
 * Search across all sessions. Streams jsonl files; matches user/assistant text content
 * case-insensitively. Returns up to `limit` results, sorted by timestamp descending.
 *
 * Each result: { escapedPath, realPath, sessionId, timestamp, snippet, role }
 */
export async function searchSessions(query, { limit = 200 } = {}) {
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
      let matchedInThisFile = false;

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
          const idx = lower.indexOf(q);
          if (idx === -1) continue;

          if (!realPath) {
            realPath = await getRealPath(escapedPath);
          }

          // Build snippet: 60 chars before/after, with bounds
          const start = Math.max(0, idx - 60);
          const end = Math.min(text.length, idx + q.length + 60);
          const before = (start > 0 ? '…' : '') + text.slice(start, idx);
          const hit = text.slice(idx, idx + q.length);
          const after = text.slice(idx + q.length, end) + (end < text.length ? '…' : '');

          results.push({
            escapedPath,
            realPath,
            sessionId,
            timestamp: obj.timestamp || null,
            role: obj.message?.role || obj.type,
            // Caller is responsible for HTML-escaping `before`/`hit`/`after`.
            snippet: { before, hit, after },
          });
          matchedInThisFile = true;
          if (results.length >= limit * 3) {
            // Soft cap: prevent runaway in giant repos. We over-collect so sort still has variety.
            rl.close();
            break;
          }
        }
      } catch { /* skip */ }

      if (results.length >= limit * 3) break;
      void matchedInThisFile;
    }
    if (results.length >= limit * 3) break;
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
