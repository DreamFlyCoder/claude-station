import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startReindex, getStatus } from '../src/reindex-job.mjs';

describe('reindex-job single-flight', () => {
  it('rejects a second start while running, then allows after finish', async () => {
    let release;
    const gate = new Promise(r => (release = r));
    const backfill = async ({ onProgress }) => { onProgress?.({ done: 0, total: 2 }); await gate; return { added: 2, total: 10, cost: 0.05 }; };

    const first = startReindex({ backfill });
    assert.equal(first.started, true);
    assert.equal(getStatus().running, true);

    const second = startReindex({ backfill });
    assert.equal(second.started, false);
    assert.equal(second.alreadyRunning, true);

    release();
    // 等任务收尾
    for (let i = 0; i < 50 && getStatus().running; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(getStatus().running, false);
    assert.equal(getStatus().added, 2);

    // 收尾后可再次启动
    assert.equal(startReindex({ backfill: async () => ({ added: 0, total: 10, cost: 0 }) }).started, true);
    for (let i = 0; i < 50 && getStatus().running; i++) await new Promise(r => setTimeout(r, 10));
  });
});
