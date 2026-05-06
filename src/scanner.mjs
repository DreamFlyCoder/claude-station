import { readdir, stat, readFile, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

const CLAUDE_DIR = join(homedir(), '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');

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
