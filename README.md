# Claude Atlas

Local web dashboard to visualize and manage Claude Code session history.

## Quick Start

```bash
node bin/cli.mjs
```

Opens `http://localhost:3456` in your browser automatically.

## Features

- Project listing with session counts and last active time
- Session list with first prompt preview and message count
- Full conversation view with markdown rendering
- One-click resume command copy
- Global and project-level CLAUDE.md display
- Dark theme matching Claude Code terminal style

## Requirements

- Node.js 18+
- No npm dependencies required

## Testing

```bash
node --test test/scanner.test.mjs
```
