import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { renderHome } from './views/home.mjs';
import { renderProject } from './views/project.mjs';
import { renderSession } from './views/session.mjs';
import { renderSearch } from './views/search.mjs';
import { renderConfig } from './views/config.mjs';
import {
  getSessionMessages, getRealPath,
  archiveSession, saveClaudeMd,
} from './scanner.mjs';

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function send404(res) {
  sendHtml(res, '<h1>404 Not Found</h1>', 404);
}

async function readJsonBody(req, { maxBytes = 5 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function buildExportMarkdown(sessionId, realPath, messages) {
  const lines = [];
  lines.push(`# Session ${sessionId.slice(0, 8)}`);
  lines.push('');
  lines.push(`**Project**: ${realPath}`);
  if (messages.length > 0 && messages[0].timestamp) {
    lines.push(`**Started**: ${messages[0].timestamp}`);
  }
  lines.push(`**Messages**: ${messages.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  for (const m of messages) {
    const isUser = m.role === 'user';
    lines.push(isUser ? '## 👤 User' : '## 🤖 Assistant');
    if (m.timestamp) lines.push(`*${m.timestamp}*`);
    lines.push('');
    lines.push(m.content);
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

export function startServer(port, callback) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const path = decodeURIComponent(url.pathname);
    // Treat HEAD same as GET; node strips the body automatically for HEAD requests.
    const rawMethod = req.method || 'GET';
    const method = rawMethod === 'HEAD' ? 'GET' : rawMethod;

    try {
      // GET / — Home page
      if (method === 'GET' && (path === '/' || path === '')) {
        const html = await renderHome();
        return sendHtml(res, html);
      }

      // GET /search?q=...
      if (method === 'GET' && path === '/search') {
        const q = url.searchParams.get('q') || '';
        const html = await renderSearch(q);
        return sendHtml(res, html);
      }

      // GET /config
      if (method === 'GET' && path === '/config') {
        const html = await renderConfig();
        return sendHtml(res, html);
      }

      // POST /api/session/:escapedPath/:id/archive
      const archiveMatch = path.match(/^\/api\/session\/([^/]+)\/([^/]+)\/archive$/);
      if (archiveMatch && method === 'POST') {
        const escapedPath = decodeURIComponent(archiveMatch[1]);
        const sessionId = archiveMatch[2];
        try {
          const out = await archiveSession(escapedPath, sessionId);
          return sendJson(res, { ok: true, ...out });
        } catch (e) {
          return sendJson(res, { ok: false, error: e.message }, 403);
        }
      }

      // GET /api/session/:escapedPath/:id/export.md
      const exportMatch = path.match(/^\/api\/session\/([^/]+)\/([^/]+)\/export\.md$/);
      if (exportMatch && method === 'GET') {
        const escapedPath = decodeURIComponent(exportMatch[1]);
        const sessionId = exportMatch[2];
        if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) {
          return sendJson(res, { error: 'invalid session id' }, 400);
        }
        try {
          const realPath = await getRealPath(escapedPath);
          const messages = await getSessionMessages(escapedPath, sessionId);
          const md = buildExportMarkdown(sessionId, realPath, messages);
          res.writeHead(200, {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="session-${sessionId.slice(0, 8)}.md"`,
          });
          return res.end(md);
        } catch (e) {
          return sendJson(res, { error: e.message }, 404);
        }
      }

      // GET /project/:escapedPath
      const projectMatch = path.match(/^\/project\/(.+)$/);
      if (projectMatch && method === 'GET') {
        const escapedPath = decodeURIComponent(projectMatch[1]);
        const html = await renderProject(escapedPath);
        return sendHtml(res, html);
      }

      // GET /session/:escapedPath/:uuid
      const sessionMatch = path.match(/^\/session\/([^/]+)\/([^/]+)$/);
      if (sessionMatch && method === 'GET') {
        const escapedPath = decodeURIComponent(sessionMatch[1]);
        const sessionId = sessionMatch[2];
        const html = await renderSession(escapedPath, sessionId);
        return sendHtml(res, html);
      }

      // GET /api/claude-md?path=... — Return CLAUDE.md content
      if (method === 'GET' && path === '/api/claude-md') {
        const mdPath = url.searchParams.get('path');
        if (!mdPath) return sendJson(res, { error: 'path required' }, 400);
        if (!mdPath.endsWith('CLAUDE.md')) {
          return sendJson(res, { error: 'only CLAUDE.md files allowed' }, 403);
        }
        try {
          const content = await readFile(mdPath, 'utf-8');
          return sendJson(res, { content });
        } catch {
          return sendJson(res, { content: null }, 404);
        }
      }

      // POST /api/claude-md  body: { path, content }
      if (method === 'POST' && path === '/api/claude-md') {
        let body;
        try { body = await readJsonBody(req); }
        catch (e) { return sendJson(res, { error: 'invalid body: ' + e.message }, 400); }
        const { path: targetPath, content } = body || {};
        if (!targetPath || typeof content !== 'string') {
          return sendJson(res, { error: 'path and content required' }, 400);
        }
        try {
          const out = await saveClaudeMd(targetPath, content);
          return sendJson(res, { ok: true, ...out });
        } catch (e) {
          return sendJson(res, { ok: false, error: e.message }, 403);
        }
      }

      send404(res);
    } catch (err) {
      console.error('Server error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });

  // Try the requested port; if busy, walk forward until we find a free one (max 20 tries).
  const MAX_TRIES = 20;
  let tries = 0;
  let started = false;

  function tryListen(p) {
    tries++;
    server.removeAllListeners('error');
    server.removeAllListeners('listening');
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && tries < MAX_TRIES) {
        console.warn(`port ${p} in use, trying ${p + 1}...`);
        setImmediate(() => tryListen(p + 1));
      } else {
        throw err;
      }
    });
    server.once('listening', () => {
      if (started) return;
      started = true;
      if (callback) callback(p);
    });
    server.listen(p);
  }

  tryListen(port);
  return server;
}
