import { runBackfill } from './indexer.mjs';

let state = freshIdle();

function freshIdle() {
  return { running: false, total: 0, done: 0, startedAt: null, finishedAt: null, added: 0, cost: 0, error: null, claudeMissing: false };
}

export function getStatus() {
  return { ...state };
}

export function startReindex({ backfill = runBackfill } = {}) {
  if (state.running) return { started: false, alreadyRunning: true };
  state = { ...freshIdle(), running: true, startedAt: new Date().toISOString() };
  Promise.resolve()
    .then(() => backfill({ cap: 40, onProgress: ({ done, total }) => { state.done = done; state.total = total; } }))
    .then(r => { state.added = r.added; if (typeof r.total === 'number') state.total = r.total; state.cost = r.cost || 0; })
    .catch(e => { state.error = e.message; if (e.code === 'ENOENT') state.claudeMissing = true; })
    .finally(() => { state.running = false; state.finishedAt = new Date().toISOString(); });
  return { started: true };
}
