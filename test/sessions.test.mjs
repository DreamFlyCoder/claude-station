import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionIndex } from '../src/scanner.mjs';
import { renderSessionCards } from '../src/views/sessions.mjs';

describe('readSessionIndex', () => {
  it('parses a valid index array', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sf-'));
    const f = join(dir, 'idx.json');
    await writeFile(f, JSON.stringify([{ sessionId: 's1', title: 'T' }]));
    const out = await readSessionIndex(f);
    assert.equal(out.length, 1);
    assert.equal(out[0].sessionId, 's1');
    await rm(dir, { recursive: true, force: true });
  });

  it('returns [] when file missing', async () => {
    const out = await readSessionIndex('/nonexistent/nope-session-index.json');
    assert.deepEqual(out, []);
  });

  it('returns [] on bad JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sf-'));
    const f = join(dir, 'idx.json');
    await writeFile(f, '{ not json');
    assert.deepEqual(await readSessionIndex(f), []);
    await rm(dir, { recursive: true, force: true });
  });

  it('returns [] when top-level is not an array', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sf-'));
    const f = join(dir, 'idx.json');
    await writeFile(f, JSON.stringify({ not: 'array' }));
    assert.deepEqual(await readSessionIndex(f), []);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('renderSessionCards', () => {
  const sample = [{
    sessionId: 's1', cwd: '/Users/x/proj', title: '加 LTV 数据集',
    summary: '先讲 mbo 再加数据集', topics: ['mbo', 'ltv'],
    startedAt: '2026-06-01T00:00:00Z', messageCount: 41,
    resume: 'cd /Users/x/proj && claude --resume s1',
  }];

  it('renders title, topic chips, and a resume button with escaped data-cmd', () => {
    const html = renderSessionCards(sample);
    assert.match(html, /加 LTV 数据集/);
    assert.match(html, /topic-chip/);
    assert.match(html, /btn-resume/);
    assert.match(html, /data-cmd="cd \/Users\/x\/proj &amp;&amp; claude --resume s1"/);
    assert.match(html, /data-blob=/);
  });

  it('renders empty-state message for empty array', () => {
    const html = renderSessionCards([]);
    assert.match(html, /更新会话索引/);
    assert.doesNotMatch(html, /sf-card/);
  });
});
