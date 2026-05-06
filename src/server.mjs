import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { renderHome } from './views/home.mjs';
import { renderProject } from './views/project.mjs';
import { renderSession } from './views/session.mjs';

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

export function startServer(port, callback) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const path = decodeURIComponent(url.pathname);

    try {
      // GET / — Home page
      if (path === '/' || path === '') {
        const html = await renderHome();
        return sendHtml(res, html);
      }

      // GET /project/:escapedPath — Project sessions page
      const projectMatch = path.match(/^\/project\/(.+)$/);
      if (projectMatch) {
        const escapedPath = decodeURIComponent(projectMatch[1]);
        const html = await renderProject(escapedPath);
        return sendHtml(res, html);
      }

      // GET /session/:escapedPath/:uuid — Session detail page
      const sessionMatch = path.match(/^\/session\/([^/]+)\/([^/]+)$/);
      if (sessionMatch) {
        const escapedPath = decodeURIComponent(sessionMatch[1]);
        const sessionId = sessionMatch[2];
        const html = await renderSession(escapedPath, sessionId);
        return sendHtml(res, html);
      }

      // GET /api/claude-md?path=... — Return CLAUDE.md content
      if (path === '/api/claude-md') {
        const mdPath = url.searchParams.get('path');
        if (!mdPath) return sendJson(res, { error: 'path required' }, 400);

        // Security: only allow reading CLAUDE.md files
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

      send404(res);
    } catch (err) {
      console.error('Server error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });

  server.listen(port, callback);
  return server;
}
