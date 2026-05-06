import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapedToRealPath, getProjects, getSessions, getSessionMessages } from '../src/scanner.mjs';
import { createServer } from 'node:http';

describe('escapedToRealPath (fallback heuristic)', () => {
  it('converts simple path without ambiguity', () => {
    assert.equal(escapedToRealPath('-Users'), 'Users');
  });

  it('replaces all dashes with slashes (lossy)', () => {
    // This is a best-effort fallback; real path comes from jsonl cwd
    assert.equal(
      escapedToRealPath('-a-b-c-d-e'),
      'a/b/c/d/e'
    );
  });
});

describe('getProjects real path extraction', () => {
  it('extracts real path from jsonl cwd field', async () => {
    const projects = await getProjects();
    // Find the all-project entry
    const ap = projects.find(p => p.escapedPath === '-Users-luguotao-IdeaProjects-all-project');
    if (ap) {
      assert.equal(ap.realPath, '/Users/luguotao/IdeaProjects/all-project',
        'should use cwd from jsonl, not naive dash replacement');
    }
    // Find the platform_fe_react entry (underscore in real name)
    const fe = projects.find(p => p.escapedPath === '-Users-luguotao-IdeaProjects-platform-fe-react');
    if (fe) {
      assert.equal(fe.realPath, '/Users/luguotao/IdeaProjects/platform_fe_react',
        'should correctly resolve underscore path from cwd');
    }
  });
});

describe('getProjects', () => {
  it('returns an array of projects from real ~/.claude/projects/', async () => {
    const projects = await getProjects();
    assert.ok(Array.isArray(projects), 'should return array');
    assert.ok(projects.length > 0, 'should find at least one project');

    const first = projects[0];
    assert.ok(first.escapedPath, 'should have escapedPath');
    assert.ok(first.realPath, 'should have realPath');
    assert.ok(typeof first.sessionCount === 'number', 'should have sessionCount');
    assert.ok(first.lastActive instanceof Date, 'should have lastActive as Date');
    assert.ok(typeof first.hasClaudeMd === 'boolean', 'should have hasClaudeMd');
  });

  it('projects are sorted by lastActive descending', async () => {
    const projects = await getProjects();
    for (let i = 1; i < projects.length; i++) {
      assert.ok(
        projects[i - 1].lastActive >= projects[i].lastActive,
        `project ${i - 1} should be >= project ${i} in lastActive`
      );
    }
  });
});

describe('getSessions', () => {
  it('returns sessions for a known project', async () => {
    const projects = await getProjects();
    assert.ok(projects.length > 0);

    const sessions = await getSessions(projects[0].escapedPath);
    assert.ok(Array.isArray(sessions));
    assert.ok(sessions.length > 0, 'should find at least one session');

    const first = sessions[0];
    assert.ok(first.id, 'should have id');
    assert.ok(typeof first.firstPrompt === 'string', 'should have firstPrompt');
    assert.ok(typeof first.messageCount === 'number', 'should have messageCount');
  });

  it('returns empty for nonexistent project', async () => {
    const sessions = await getSessions('nonexistent-project');
    assert.deepEqual(sessions, []);
  });
});

describe('getSessionMessages', () => {
  it('returns messages for a real session', async () => {
    const projects = await getProjects();
    const sessions = await getSessions(projects[0].escapedPath);
    // Find a session with messages
    const session = sessions.find(s => s.messageCount > 0);
    if (!session) {
      // Skip if no session with messages
      return;
    }

    const messages = await getSessionMessages(projects[0].escapedPath, session.id);
    assert.ok(Array.isArray(messages));
    assert.ok(messages.length > 0, 'should have messages');

    const msg = messages[0];
    assert.ok(['user', 'assistant'].includes(msg.role), `role should be user/assistant, got ${msg.role}`);
    assert.ok(typeof msg.content === 'string', 'content should be string');
  });
});

describe('server routes', () => {
  it('GET / returns 200 with HTML', async () => {
    const { startServer } = await import('../src/server.mjs');
    const server = startServer(0, () => {});
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('Claude Station'), 'should contain title');
      assert.ok(text.includes('Projects'), 'should contain Projects heading');
    } finally {
      server.close();
    }
  });

  it('GET /project/:path returns 200', async () => {
    const projects = await getProjects();
    if (projects.length === 0) return;

    const { startServer } = await import('../src/server.mjs');
    const server = startServer(0, () => {});
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/project/${encodeURIComponent(projects[0].escapedPath)}`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('Sessions'), 'should contain Sessions heading');
    } finally {
      server.close();
    }
  });

  it('GET /nonexistent returns 404', async () => {
    const { startServer } = await import('../src/server.mjs');
    const server = startServer(0, () => {});
    const port = server.address().port;

    try {
      const res = await fetch(`http://localhost:${port}/nonexistent`);
      assert.equal(res.status, 404);
    } finally {
      server.close();
    }
  });
});
