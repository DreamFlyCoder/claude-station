import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseFrontmatter,
  searchSessions,
  getStats,
  getCommands, getSkills, getSubagents, getHooks, getMcpServers,
} from '../src/scanner.mjs';
import { startServer } from '../src/server.mjs';
import { getProjects } from '../src/scanner.mjs';

describe('parseFrontmatter', () => {
  it('parses simple frontmatter', () => {
    const out = parseFrontmatter('---\nname: foo\ndescription: hello world\n---\nbody text');
    assert.equal(out.frontmatter.name, 'foo');
    assert.equal(out.frontmatter.description, 'hello world');
    assert.equal(out.body, 'body text');
  });

  it('returns empty frontmatter when missing', () => {
    const out = parseFrontmatter('# Just markdown\nno frontmatter here');
    assert.deepEqual(out.frontmatter, {});
    assert.ok(out.body.includes('Just markdown'));
  });

  it('strips wrapping quotes', () => {
    const out = parseFrontmatter('---\nname: "quoted"\n---\nbody');
    assert.equal(out.frontmatter.name, 'quoted');
  });

  it('returns empty frontmatter on garbage input', () => {
    const out = parseFrontmatter(null);
    assert.deepEqual(out.frontmatter, {});
  });
});

describe('config readers', () => {
  it('getCommands returns array', async () => {
    const out = await getCommands();
    assert.ok(Array.isArray(out));
  });
  it('getSubagents returns array', async () => {
    const out = await getSubagents();
    assert.ok(Array.isArray(out));
  });
  it('getSkills returns array', async () => {
    const out = await getSkills();
    assert.ok(Array.isArray(out));
  });
  it('getHooks returns groups array', async () => {
    const out = await getHooks();
    assert.ok(out && typeof out === 'object');
    assert.ok(Array.isArray(out.groups));
  });
  it('getMcpServers returns servers array', async () => {
    const out = await getMcpServers();
    assert.ok(out && typeof out === 'object');
    assert.ok(Array.isArray(out.servers));
  });
});

describe('searchSessions', () => {
  it('returns array on empty query', async () => {
    const out = await searchSessions('');
    assert.deepEqual(out, []);
  });
  it('returns case-insensitive matches with snippet + matchCount', async () => {
    // Use a token that almost certainly appears in some session.
    const out = await searchSessions('CLAUDE', { limit: 5 });
    assert.ok(Array.isArray(out));
    if (out.length > 0) {
      const r = out[0];
      assert.ok(r.sessionId);
      assert.ok(r.escapedPath);
      assert.ok(r.snippet);
      assert.ok(typeof r.snippet.before === 'string');
      assert.ok(typeof r.snippet.hit === 'string');
      assert.ok(typeof r.snippet.after === 'string');
      assert.equal(r.snippet.hit.toLowerCase(), 'claude');
      // matchCount should be a positive integer
      assert.ok(Number.isInteger(r.matchCount));
      assert.ok(r.matchCount >= 1);
    }
  });
  it('deduplicates per session — sessionIds are unique in results', async () => {
    const out = await searchSessions('claude', { limit: 100 });
    const seen = new Set();
    for (const r of out) {
      const key = r.escapedPath + '/' + r.sessionId;
      assert.ok(!seen.has(key), `duplicate session in results: ${key}`);
      seen.add(key);
    }
  });
  it('respects scope: only returns sessions from the given project', async () => {
    // Pick one project that has matches.
    const all = await searchSessions('claude', { limit: 50 });
    if (all.length === 0) return; // empty dataset
    const scope = all[0].escapedPath;
    const scoped = await searchSessions('claude', { limit: 50, scope });
    assert.ok(scoped.length > 0);
    for (const r of scoped) {
      assert.equal(r.escapedPath, scope);
    }
  });
});

describe('readSessionMeta lastTime', () => {
  it('getSessions returns lastTime alongside startTime', async () => {
    const { getProjects, getSessions } = await import('../src/scanner.mjs');
    const ps = await getProjects();
    if (ps.length === 0) return; // empty dataset
    const sessions = await getSessions(ps[0].escapedPath);
    if (sessions.length === 0) return;
    const s = sessions[0];
    // Either both present or both null; lastTime ≥ startTime when both set
    assert.ok('lastTime' in s, 'session must have lastTime field');
    if (s.startTime && s.lastTime) {
      assert.ok(new Date(s.lastTime) >= new Date(s.startTime),
        `lastTime (${s.lastTime}) should be >= startTime (${s.startTime})`);
    }
  });
});

describe('getStats', () => {
  it('returns aggregated stats', async () => {
    const stats = await getStats({ force: true });
    assert.ok(stats.byDay && typeof stats.byDay === 'object');
    assert.ok(Array.isArray(stats.byProject));
    assert.ok(stats.totals && typeof stats.totals.sessions === 'number');
    assert.ok(typeof stats.totals.cost === 'number');
  });
});

describe('server: search route', () => {
  it('GET /search renders 200', async () => {
    const server = startServer(0, () => {});
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/search?q=test`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.ok(text.includes('Search'));
    } finally {
      server.close();
    }
  });
});

describe('server: config route', () => {
  it('GET /config renders 200 with all five tabs', async () => {
    const server = startServer(0, () => {});
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/config`);
      assert.equal(res.status, 200);
      const text = await res.text();
      for (const tab of ['commands', 'subagents', 'skills', 'hooks', 'mcp']) {
        assert.ok(text.includes(`data-tab="${tab}"`), `missing tab ${tab}`);
      }
    } finally {
      server.close();
    }
  });
});

describe('server: session export markdown', () => {
  it('returns markdown with Content-Disposition for a real session', async () => {
    const projects = await getProjects();
    if (projects.length === 0) return;
    // Find a project with at least one session.
    const proj = projects.find(p => p.sessionCount > 0);
    if (!proj) return;

    const { getSessions } = await import('../src/scanner.mjs');
    const sessions = await getSessions(proj.escapedPath);
    if (sessions.length === 0) return;

    const server = startServer(0, () => {});
    const port = server.address().port;
    try {
      const url = `http://localhost:${port}/api/session/${encodeURIComponent(proj.escapedPath)}/${sessions[0].id}/export.md`;
      const res = await fetch(url);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/markdown/);
      assert.match(res.headers.get('content-disposition') || '', /attachment/);
      const body = await res.text();
      assert.ok(body.startsWith('# Session '));
      assert.ok(body.includes('**Project**'));
    } finally {
      server.close();
    }
  });
});

describe('server: archive validation', () => {
  it('rejects escapedPath starting with dot (would map to .archive) with 403', async () => {
    const server = startServer(0, () => {});
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/api/session/.archive/abcd1234/archive`, {
        method: 'POST',
      });
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.ok, false);
    } finally {
      server.close();
    }
  });

  it('rejects malformed sessionId with 403', async () => {
    const server = startServer(0, () => {});
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/api/session/some-project/bad_id_with_underscores/archive`, {
        method: 'POST',
      });
      assert.equal(res.status, 403);
    } finally {
      server.close();
    }
  });
});

describe('server: claude-md write validation', () => {
  it('rejects non-CLAUDE.md path', async () => {
    const server = startServer(0, () => {});
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/api/claude-md`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/tmp/evil.txt', content: 'x' }),
      });
      assert.equal(res.status, 403);
    } finally {
      server.close();
    }
  });

  it('rejects path outside HOME', async () => {
    const server = startServer(0, () => {});
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/api/claude-md`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '/etc/CLAUDE.md', content: 'x' }),
      });
      assert.equal(res.status, 403);
    } finally {
      server.close();
    }
  });

  it('writes a CLAUDE.md under a tempdir inside HOME and creates a backup', async () => {
    // We need a path under $HOME. Use os.tmpdir() only if it's under HOME; otherwise use HOME/.claude-station-test.
    const home = process.env.HOME;
    const dir = mkdtempSync(join(home, '.claude-station-test-'));
    const target = join(dir, 'CLAUDE.md');
    writeFileSync(target, 'original\n', 'utf-8');

    const server = startServer(0, () => {});
    const port = server.address().port;
    try {
      const res = await fetch(`http://localhost:${port}/api/claude-md`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: target, content: 'updated\n' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.ok(body.backupPath, 'should produce backupPath');
      assert.ok(existsSync(body.backupPath), 'backup file should exist');
      const { readFileSync } = await import('node:fs');
      assert.equal(readFileSync(target, 'utf-8'), 'updated\n');
      assert.equal(readFileSync(body.backupPath, 'utf-8'), 'original\n');
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
