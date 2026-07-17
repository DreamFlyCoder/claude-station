import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionIndex, getSessionLocationMap } from '../src/scanner.mjs';
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
    // blob 是过滤的数据源，须含小写化的 title/summary/topics 文本
    assert.match(html, /data-blob="[^"]*ltv[^"]*"/);
    assert.match(html, /data-blob="[^"]*加 ltv 数据集[^"]*"/);
  });

  it('renders empty-state message for empty array', () => {
    const html = renderSessionCards([]);
    assert.match(html, /更新会话索引/);
    assert.doesNotMatch(html, /sf-card/);
  });

  it('makes a card clickable to the session viewer when its location is known', () => {
    const html = renderSessionCards(sample, { s1: '-Users-x-proj' });
    assert.match(html, /class="sf-card clickable"/);
    assert.match(html, /<a class="card-link" href="\/session\/-Users-x-proj\/s1" target="_blank"/);
  });

  it('leaves a card non-clickable when its location is unknown', () => {
    const html = renderSessionCards(sample, {});
    assert.doesNotMatch(html, /card-link/);
    assert.doesNotMatch(html, /sf-card clickable/);
  });
});

describe('getSessionLocationMap', () => {
  it('maps sessionId -> project dir and skips .archive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sf-loc-'));
    await mkdir(join(dir, '-proj-a'));
    await mkdir(join(dir, '-proj-b'));
    await mkdir(join(dir, '.archive'));
    await writeFile(join(dir, '-proj-a', 'sess1.jsonl'), '');
    await writeFile(join(dir, '-proj-b', 'sess2.jsonl'), '');
    await writeFile(join(dir, '.archive', 'sess3.jsonl'), '');
    const map = await getSessionLocationMap(dir);
    assert.equal(map.sess1, '-proj-a');
    assert.equal(map.sess2, '-proj-b');
    assert.equal(map.sess3, undefined);
    await rm(dir, { recursive: true, force: true });
  });

  it('returns {} when projects dir is missing', async () => {
    assert.deepEqual(await getSessionLocationMap('/nonexistent/nope-projects'), {});
  });
});
