#!/usr/bin/env node

import { startServer } from '../src/server.mjs';

const PORT = parseInt(process.env.PORT || '3456', 10);

startServer(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`claude-station running at ${url}`);

  // Auto-open browser
  const { platform } = process;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  import('child_process').then(({ exec }) => exec(`${cmd} ${url}`));
});
