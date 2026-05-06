import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let markedJs = null;

async function getMarkedJs() {
  if (!markedJs) {
    markedJs = await readFile(join(__dirname, '..', 'vendor', 'marked.min.js'), 'utf-8');
  }
  return markedJs;
}

export async function layout(title, content, { breadcrumbs = [] } = {}) {
  const marked = await getMarkedJs();

  const breadcrumbHtml = breadcrumbs.length > 0
    ? `<nav class="breadcrumb">${breadcrumbs.map((b, i) =>
        i === breadcrumbs.length - 1
          ? `<span>${b.label}</span>`
          : `<a href="${b.href}">${b.label}</a><span class="sep">/</span>`
      ).join('')}</nav>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Claude Atlas</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      background: #1a1a2e;
      color: #e0e0e0;
      line-height: 1.6;
      min-height: 100vh;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 20px;
    }
    header {
      border-bottom: 1px solid #2a2a4a;
      padding: 16px 0;
      margin-bottom: 24px;
    }
    header h1 {
      font-size: 1.4rem;
      color: #c9a0ff;
      font-weight: 600;
    }
    header h1 a { color: inherit; text-decoration: none; }
    .breadcrumb {
      margin-top: 8px;
      font-size: 0.85rem;
      color: #888;
    }
    .breadcrumb a { color: #7b8cde; text-decoration: none; }
    .breadcrumb a:hover { text-decoration: underline; }
    .breadcrumb .sep { margin: 0 6px; color: #555; }

    /* Cards */
    .card {
      background: #16213e;
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
      transition: border-color 0.2s;
    }
    .card:hover { border-color: #4a4a8a; }
    .card a { color: #c9a0ff; text-decoration: none; font-weight: 500; }
    .card a:hover { text-decoration: underline; }
    .card .meta {
      font-size: 0.8rem;
      color: #888;
      margin-top: 4px;
    }
    .card .preview {
      font-size: 0.85rem;
      color: #aaa;
      margin-top: 6px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Resume button */
    .btn-resume {
      background: #2d6a4f;
      color: #b7e4c7;
      border: 1px solid #40916c;
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 0.75rem;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.2s;
    }
    .btn-resume:hover { background: #40916c; }
    .btn-resume.copied {
      background: #1b4332;
      color: #95d5b2;
    }

    /* Chat messages */
    .chat { margin-top: 16px; }
    .msg {
      margin-bottom: 16px;
      padding: 12px 16px;
      border-radius: 8px;
      max-width: 85%;
      font-size: 0.9rem;
      overflow-wrap: break-word;
    }
    .msg.user {
      background: #1a365d;
      border: 1px solid #2a4a7f;
      margin-left: auto;
      text-align: left;
    }
    .msg.assistant {
      background: #2a2a3e;
      border: 1px solid #3a3a5e;
      margin-right: auto;
    }
    .msg .role-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #888;
      margin-bottom: 6px;
      font-weight: 600;
    }
    .msg.user .role-label { color: #6b9bd2; }
    .msg.assistant .role-label { color: #b39ddb; }
    .msg .timestamp {
      font-size: 0.7rem;
      color: #666;
      margin-top: 6px;
    }

    /* Markdown content styling */
    .md-content h1, .md-content h2, .md-content h3 {
      color: #c9a0ff;
      margin: 12px 0 6px;
    }
    .md-content h1 { font-size: 1.3rem; }
    .md-content h2 { font-size: 1.1rem; }
    .md-content h3 { font-size: 1rem; }
    .md-content p { margin: 6px 0; }
    .md-content code {
      background: #0d1117;
      padding: 2px 5px;
      border-radius: 3px;
      font-size: 0.85em;
      color: #e6db74;
    }
    .md-content pre {
      background: #0d1117;
      border: 1px solid #333;
      border-radius: 6px;
      padding: 12px;
      overflow-x: auto;
      margin: 8px 0;
    }
    .md-content pre code {
      background: none;
      padding: 0;
      color: #e0e0e0;
    }
    .md-content a { color: #7b8cde; }
    .md-content ul, .md-content ol { padding-left: 20px; margin: 6px 0; }
    .md-content table { border-collapse: collapse; margin: 8px 0; width: 100%; }
    .md-content th, .md-content td {
      border: 1px solid #333;
      padding: 6px 10px;
      text-align: left;
      font-size: 0.85rem;
    }
    .md-content th { background: #1e1e3e; color: #c9a0ff; }
    .md-content blockquote {
      border-left: 3px solid #4a4a8a;
      padding-left: 12px;
      color: #aaa;
      margin: 8px 0;
    }

    /* CLAUDE.md section */
    .claude-md-section {
      background: #0d1117;
      border: 1px solid #2a2a4a;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .claude-md-section summary {
      cursor: pointer;
      color: #c9a0ff;
      font-weight: 600;
      font-size: 0.9rem;
    }
    .claude-md-section .md-content { margin-top: 12px; }

    .stats {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .stat-box {
      background: #16213e;
      border: 1px solid #2a2a4a;
      border-radius: 6px;
      padding: 12px 16px;
      text-align: center;
    }
    .stat-box .num { font-size: 1.5rem; color: #c9a0ff; font-weight: 700; }
    .stat-box .label { font-size: 0.75rem; color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1><a href="/">Claude Atlas</a></h1>
      ${breadcrumbHtml}
    </header>
    <main>
      ${content}
    </main>
  </div>
  <script>${marked}</script>
  <script>
    // Render all markdown blocks
    document.querySelectorAll('[data-md]').forEach(el => {
      el.innerHTML = marked.parse(el.textContent || '');
      el.classList.add('md-content');
    });

    // Resume button handler
    document.querySelectorAll('.btn-resume').forEach(btn => {
      btn.addEventListener('click', () => {
        const cmd = btn.dataset.cmd;
        navigator.clipboard.writeText(cmd).then(() => {
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = 'Resume';
            btn.classList.remove('copied');
          }, 2000);
        });
      });
    });
  </script>
</body>
</html>`;
}
