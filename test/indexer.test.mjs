import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm, mkdir, readFile as rf } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { distill, findPending, merge, summarizeBatch, runBackfill } from '../src/indexer.mjs';

async function tmpFile(name, lines) {
  const dir = await mkdtemp(join(tmpdir(), 'idx-'));
  const p = join(dir, name);
  await writeFile(p, lines.join('\n'));
  return { dir, p };
}

describe('distill', () => {
  it('keeps conversation text, strips noise, id from filename', async () => {
    const { dir, p } = await tmpFile('88888888-4444-4444-4444-121212121212.jsonl', [
      JSON.stringify({ type: 'user', sessionId: 'SIDECHAIN-OTHER', cwd: '/Users/x/proj', timestamp: '2026-06-01T10:00:00.000Z', message: { role: 'user', content: '讲一下 mbo 逻辑' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-06-01T10:00:05.000Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'SECRET' }, { type: 'text', text: 'mbo 是这样' }, { type: 'tool_use', name: 'Bash', input: { command: 'NOISE_LS' } }] } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'NOISE_TR' }] } }),
      JSON.stringify({ type: 'attachment', attachment: { data: 'NOISE_B64' } }),
    ]);
    const r = await distill(p);
    assert.equal(r.sessionId, '88888888-4444-4444-4444-121212121212'); // 文件名，非记录内 SIDECHAIN-OTHER
    assert.equal(r.cwd, '/Users/x/proj');
    assert.equal(r.startedAt, '2026-06-01T10:00:00.000Z');
    assert.equal(r.messageCount, 3);
    assert.match(r.text, /讲一下 mbo 逻辑/);
    assert.match(r.text, /mbo 是这样/);
    for (const n of ['SECRET', 'NOISE_LS', 'NOISE_TR', 'NOISE_B64', 'SIDECHAIN-OTHER']) assert.doesNotMatch(r.text, new RegExp(n));
    assert.equal(typeof r.sourceMtime, 'number');
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when no conversation text', async () => {
    const { dir, p } = await tmpFile('empty.jsonl', [JSON.stringify({ type: 'attachment', attachment: { data: 'x' } })]);
    assert.equal(await distill(p), null);
    await rm(dir, { recursive: true, force: true });
  });
});

describe('findPending', () => {
  it('diffs by sessionId+mtime, skips agent-* and .archive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pend-'));
    const projects = join(root, 'projects');
    await mkdir(join(projects, '-proj-a'), { recursive: true });
    await mkdir(join(projects, '.archive'), { recursive: true });
    await writeFile(join(projects, '-proj-a', 'realsess.jsonl'), '{}');
    await writeFile(join(projects, '-proj-a', 'agent-xyz.jsonl'), '{}');
    await writeFile(join(projects, '.archive', 'old.jsonl'), '{}');
    const indexPath = join(root, 'index.json');

    // 无索引 → realsess 待办，agent-* 与 .archive 跳过
    let pend = await findPending(projects, indexPath);
    assert.deepEqual(pend.map(p => p.sessionId).sort(), ['realsess']);

    // 索引里已含 realsess 且 mtime 一致 → 无待办
    const mt = pend[0].sourceMtime;
    await writeFile(indexPath, JSON.stringify([{ sessionId: 'realsess', sourceMtime: mt }]));
    assert.deepEqual(await findPending(projects, indexPath), []);

    // mtime 不一致 → 又待办
    await writeFile(indexPath, JSON.stringify([{ sessionId: 'realsess', sourceMtime: 1 }]));
    assert.equal((await findPending(projects, indexPath)).length, 1);

    await rm(root, { recursive: true, force: true });
  });
});

describe('summarizeBatch', () => {
  it('parses claude json result into summaries + cost, honoring idx', async () => {
    const fakeRunner = async () => JSON.stringify({
      is_error: false, total_cost_usd: 0.12,
      result: JSON.stringify([{ idx: 0, title: 'A', summary: 'sa', topics: ['x'] }, { idx: 1, title: 'B', summary: 'sb', topics: [] }]),
    });
    const { summaries, cost } = await summarizeBatch([{ idx: 0, text: 't0' }, { idx: 1, text: 't1' }], { runner: fakeRunner });
    assert.equal(summaries.length, 2);
    assert.equal(summaries[0].idx, 0);
    assert.equal(summaries[1].title, 'B');
    assert.equal(cost, 0.12);
  });

  it('strips markdown fences in result', async () => {
    const fakeRunner = async () => JSON.stringify({ is_error: false, total_cost_usd: 0, result: '```json\n[{"idx":0,"title":"A","summary":"s","topics":[]}]\n```' });
    const { summaries } = await summarizeBatch([{ idx: 0, text: 't' }], { runner: fakeRunner });
    assert.equal(summaries[0].title, 'A');
  });

  it('propagates runner errors', async () => {
    const boom = async () => { throw new Error('boom'); };
    await assert.rejects(() => summarizeBatch([{ idx: 0, text: 't' }], { runner: boom }), /boom/);
  });
});

describe('runBackfill', () => {
  it('distills pending, summarizes via injected fn, merges with correct identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bf-'));
    const projects = join(root, 'projects');
    await mkdir(join(projects, '-proj'), { recursive: true });
    const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await writeFile(join(projects, '-proj', sid + '.jsonl'),
      JSON.stringify({ type: 'user', cwd: '/w/proj', timestamp: '2026-06-01T00:00:00Z', message: { role: 'user', content: '先做 A 再做 B' } }));
    const ip = join(root, 'index.json');

    const fakeSummarize = async (items) => ({
      summaries: items.map(it => ({ idx: it.idx, title: '标题', summary: '先 A→再 B', topics: ['a', 'b'] })),
      cost: 0.01,
    });
    const progress = [];
    const r = await runBackfill({ projectsDir: projects, indexPath: ip, summarize: fakeSummarize, onProgress: p => progress.push(p) });
    assert.equal(r.added, 1);
    const data = JSON.parse(await rf(ip, 'utf-8'));
    assert.equal(data[0].sessionId, sid);          // 身份=文件名，来自 station 不是模型
    assert.equal(data[0].cwd, '/w/proj');
    assert.equal(data[0].title, '标题');
    assert.equal(data[0].resume, `cd /w/proj && claude --resume ${sid}`);
    assert.ok(progress.length >= 1);
    await rm(root, { recursive: true, force: true });
  });

  it('returns added:0 when nothing pending', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bf0-'));
    await mkdir(join(root, 'projects'), { recursive: true });
    const r = await runBackfill({ projectsDir: join(root, 'projects'), indexPath: join(root, 'index.json'), summarize: async () => ({ summaries: [], cost: 0 }) });
    assert.equal(r.added, 0);
    await rm(root, { recursive: true, force: true });
  });

  it('skips a failing batch instead of aborting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bferr-'));
    const projects = join(root, 'projects');
    await mkdir(join(projects, '-proj'), { recursive: true });
    await writeFile(join(projects, '-proj', 'ffffffff-1111-2222-3333-444444444444.jsonl'),
      JSON.stringify({ type: 'user', cwd: '/w', timestamp: '2026-06-01T00:00:00Z', message: { role: 'user', content: '嗨' } }));
    const r = await runBackfill({ projectsDir: projects, indexPath: join(root, 'index.json'), summarize: async () => { throw new Error('flaky'); } });
    assert.equal(r.added, 0);
    assert.ok(r.errors >= 1);
    await rm(root, { recursive: true, force: true });
  });
});

describe('merge', () => {
  const entry = (sid, extra = {}) => ({ sessionId: sid, cwd: '/p/a', title: 'T', summary: 's', topics: ['t'], startedAt: '2026-06-01T00:00:00Z', messageCount: 3, sourceMtime: 111, ...extra });

  it('inserts, derives resume + indexedAt, atomic write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mrg-'));
    const ip = join(dir, 'index.json');
    const n = await merge([entry('s1')], ip, '2026-07-17T00:00:00Z');
    assert.equal(n, 1);
    const data = JSON.parse(await rf(ip, 'utf-8'));
    assert.equal(data[0].resume, 'cd /p/a && claude --resume s1');
    assert.equal(data[0].indexedAt, '2026-07-17T00:00:00Z');
    await rm(dir, { recursive: true, force: true });
  });

  it('upserts same id, adds new id, shell-quotes cwd with spaces', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mrg-'));
    const ip = join(dir, 'index.json');
    await merge([entry('s1', { title: 'old' })], ip, 't0');
    await merge([entry('s1', { title: 'new' }), entry('s2', { cwd: '/Users/x/My Project' })], ip, 't1');
    const data = JSON.parse(await rf(ip, 'utf-8'));
    assert.equal(data.length, 2);
    assert.equal(data.find(e => e.sessionId === 's1').title, 'new');
    assert.equal(data.find(e => e.sessionId === 's2').resume, "cd '/Users/x/My Project' && claude --resume s2");
    await rm(dir, { recursive: true, force: true });
  });
});
