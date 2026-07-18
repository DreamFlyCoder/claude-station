#!/usr/bin/env node

import { startServer } from '../src/server.mjs';
import { findPending } from '../src/indexer.mjs';
import { startReindex } from '../src/reindex-job.mjs';

const PORT = parseInt(process.env.PORT || '3456', 10);

startServer(PORT, (actualPort) => {
  const url = `http://localhost:${actualPort}`;
  console.log(`claude-station running at ${url}`);

  // 启动触发：待索引 >3 条才自动跑一次（可见，不阻塞）
  findPending().then(pending => {
    if (pending.length > 3) {
      console.log(`[session-index] ${pending.length} 条待索引，开始后台刷新…（浏览 /sessions 看进度）`);
      startReindex();
    }
  }).catch(() => {});

  // Skip auto-open if --no-open flag is set (useful for tests/CI)
  if (process.argv.includes('--no-open')) return;

  // Auto-open browser
  const { platform } = process;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  import('child_process').then(({ exec }) => exec(`${cmd} ${url}`));
});
