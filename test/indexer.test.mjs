import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { distill } from '../src/indexer.mjs';

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
