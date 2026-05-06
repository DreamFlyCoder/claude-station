#!/usr/bin/env node

import { startServer } from '../src/server.mjs';

const PORT = parseInt(process.env.PORT || '3456', 10);

startServer(PORT, (actualPort) => {
  const url = `http://localhost:${actualPort}`;
  console.log(`claude-station running at ${url}`);

  // Skip auto-open if --no-open flag is set (useful for tests/CI)
  if (process.argv.includes('--no-open')) return;

  // Auto-open browser
  const { platform } = process;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  import('child_process').then(({ exec }) => exec(`${cmd} ${url}`));
});
