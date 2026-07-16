import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionIndex } from '../src/scanner.mjs';

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
