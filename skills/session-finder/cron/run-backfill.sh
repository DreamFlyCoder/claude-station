#!/bin/bash
# session-finder 定时增量索引 wrapper。
# 由 launchd (io.session-finder.backfill) 每 2 天触发；也可手动跑本脚本测试。
# 唤起 headless Claude（复用订阅 OAuth 登录，非 --bare —— --bare 会丢登录态）跑增量 backfill。
set -uo pipefail

export HOME="/Users/luguotao"
# launchd 环境极简，必须显式给全 PATH：claude / node(nvm) / python3(Framework)
export PATH="/opt/homebrew/bin:/Users/luguotao/.nvm/versions/node/v20.19.4/bin:/Library/Frameworks/Python.framework/Versions/3.13/bin:/usr/bin:/bin:/usr/sbin:/sbin"

CLAUDE="/opt/homebrew/bin/claude"
SKILL_DIR="/Users/luguotao/code/claude-station/skills/session-finder"
PROMPT_FILE="$SKILL_DIR/cron/backfill-prompt.txt"
LOG="$HOME/.claude/session-finder-cron.log"

{
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') session-finder cron 开始 ====="
  "$CLAUDE" -p "$(cat "$PROMPT_FILE")" \
    --permission-mode bypassPermissions \
    --max-budget-usd 8 \
    </dev/null
  echo ""
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') 结束 (exit=$?) ====="
} >> "$LOG" 2>&1
