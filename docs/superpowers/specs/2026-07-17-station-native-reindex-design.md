# claude-station 原生索引刷新（自包含，替换 launchd）设计

**日期**: 2026-07-17
**状态**: 设计已确认，待写实现计划
**关联**: `2026-07-16-station-sessions-page-design.md`（Session Finder 页）；替换 `skills/session-finder/cron/`（launchd 方案，本次移除）

## 背景与目标

claude-station 要开源，功能必须**自包含**：clone 下来 `node bin/cli.mjs` 就能建/刷新会话摘要索引并浏览，不依赖用户机器上散落的东西（launchd plist、skill 的 Python 脚本）。

当前索引刷新靠外部 launchd 每 2 天唤起 `claude -p`。本设计把索引流水线**用 Node 搬进 station**，只在"生成摘要"这一步 spawn 本机 `claude -p`（station 无模型 API，这是唯一不可避免的外部依赖，且 station 与 `claude` CLI 同机，spawn 可行）。launchd 方案移除。

**session-finder skill 不在本设计范围、完全不动**（用户继续使用它做 Claude Code 内的语义搜索；它的 Python 脚本原样保留）。station 与 skill 是两个自包含分发物，各留一份 distill 逻辑（可接受的重复），仍通过共享 `~/.claude/session-index.json` 契约对接。

## 触发规则（就两个，其余一律不跑）

1. **station 启动时**：统计"未索引 + 有变动"的会话数，**> 3 条**才跑一次 backfill；≤3 不跑。
2. **用户点 `/sessions` 页的「🔄 刷新 session 索引」按钮**：任何时候都跑。
3. 其它情况一律不跑（不看时间、不在浏览中偷偷触发）。

"不悄悄"的落实：启动触发**不阻塞**服务启动，但**可见**——控制台打印 `正在索引 N 条…`，`/sessions` 页顶显示进度条；跑完列表自动刷新。

"有更新/新增"= sessionId 不在索引，或其 jsonl 文件 mtime 变了（现有增量判断，排除 `agent-*.jsonl`）。>3 阈值顺带滤掉当前正开着的活会话的抖动。

## 组件拆分

1. **`src/indexer.mjs`（新）— 纯 Node 索引流水线**
   - `findPending() -> Promise<Array<{sessionId,path,cwd,startedAt,messageCount,sourceMtime}>>`
     扫 `~/.claude/projects/**/*.jsonl`，跳过 `agent-*`，与 `readSessionIndex()` 按 sessionId+sourceMtime diff，返回待索引项。sessionId = 文件名 stem（不信记录内 sessionId，与 skill 修过的根因 bug 一致）。
   - `distill(path) -> {sessionId,cwd,startedAt,messageCount,sourceMtime,text} | null`
     Node 版蒸馏：保留 user 字符串/text 块 + assistant text 块；丢 thinking/tool_use/tool_result/attachment/其它；user 截 500、assistant 截 800；无文本→null。
   - `summarizeBatch(items, {runner}) -> Promise<Array<{idx,title,summary,topics}>>`
     items 为 `[{idx,text}]`。默认 runner spawn `claude -p "<摘要prompt含各条idx+text>" --output-format json`（**不允许任何工具**——摘要只读 prompt、只输出 JSON，故无权限/工具触点），解析 `result` 为 JSON 数组。`runner` 可注入以便测试。
   - `merge(entries) -> Promise<number>`
     Node 版 upsert：按 sessionId 合并进 `~/.claude/session-index.json`，派生 `resume`（`cd <shell-quoted cwd> && claude --resume <id>`）与 `indexedAt`，原子写（tmp+rename）。返回索引总数。
   - `runBackfill({cap=40, onProgress}) -> Promise<{added,total}>`
     编排：findPending → 取前 cap → 逐条 distill → 按大小分批（≤15 条且 ≤80KB，超大单独）→ summarizeBatch → 按 idx 挂回身份 → merge。每批后调 `onProgress({done,total})`。

2. **索引任务管理（`src/reindex-job.mjs` 或并入 server）— 单飞 + 状态**
   - 内存状态：`{running, total, done, startedAt, finishedAt, added, error, claudeMissing}`。
   - `startReindex()`：若已 running 返回 `{started:false}`；否则后台跑 `runBackfill`，更新状态，返回 `{started:true}`。单飞锁。
   - `getStatus()`：返回当前状态快照。

3. **HTTP 端点（改 `src/server.mjs`）**
   - `POST /api/reindex` → `startReindex()` → JSON `{started, alreadyRunning}`。
   - `GET /api/reindex/status` → JSON 状态快照。

4. **启动触发（改 `bin/cli.mjs`）**
   - server listening 后：`findPending()`，若 `length > 3` → `startReindex()` + 控制台打印。不阻塞。

5. **UI（改 `src/views/sessions.mjs` + layout 样式）**
   - 页面顶部加「🔄 刷新 session 索引」按钮 + 一个状态/进度条区域。
   - 客户端脚本：点按钮 → `POST /api/reindex` → 每 ~2s 轮询 `/api/reindex/status` → 显示 `索引中 done/total…`；跑完 `location.reload()`。
   - 页面加载时也先查一次 status：若正在跑（启动触发的）→ 直接显示进度条并开始轮询。
   - 降级：status 里 `claudeMissing`/`error` → 显示提示（如"需要本机安装并登录 Claude Code"），不崩。

6. **移除 launchd 方案**
   - `launchctl unload -w ~/Library/LaunchAgents/io.session-finder.backfill.plist`
   - 删 `~/Library/LaunchAgents/io.session-finder.backfill.plist`
   - 删仓库 `skills/session-finder/cron/`。

## 摘要 prompt（summarizeBatch 内）

要点同现有：每条按 `{idx,text}` 输入，要求输出 `{idx,title(简短中文),summary(3-5句演进弧线：先→接着→再→最后),topics[]}`，idx 原样回传，**subagent/模型绝不碰 sessionId**（身份由 station 按 idx 挂接）。要求输出合法 JSON 数组。

## 错误处理与健壮性

- **单飞锁**：按钮与启动触发共用，绝不并发两个 backfill。
- **每轮上限 cap=40 + 可续**：merge 增量原子，被中断/下次启动接着来；首次数百条不卡死。
- **`claude` 缺失/未登录**：`summarizeBatch` spawn 失败（ENOENT）或结果含 not-logged-in → 置 `claudeMissing`/`error`，任务优雅结束，浏览已有索引不受影响。
- **摘要 JSON 解析失败**：该批跳过并记 error 计数，不中断其余批；下次可重试。
- **成本可见**：`claude --output-format json` 的 `total_cost_usd` 累加进状态，UI 可显示本次花费。

## 测试（`node --test`）

- `distill`：fixture jsonl → 保留对话文本、剥噪声、sessionId 取文件名、空→null。
- `findPending`：临时 projects 目录 + 临时 index → 正确 diff、跳过 agent-*、按 sourceMtime 判变动。
- `merge`：upsert、派生 resume（cwd 含空格加引号）、indexedAt、原子写。
- `summarizeBatch`：注入假 runner 返回定值 → 正确解析 + 按 idx 对齐；runner 抛错 → 抛出可识别错误。
- `runBackfill`：注入假 summarize runner + 临时目录 → 端到端 added 计数、onProgress 调用、cap 生效。
- `reindex-job` 单飞：running 时再 start 返回 `{started:false}`。
- UI 不做单测（沿用 station 约定），E2E 手测。

## 非目标（YAGNI）

- 不做时间定时（不看 >N 天）；只有启动>3 + 按钮。
- 不动 session-finder skill / 其 Python 脚本。
- 不在 station 做 AI 语义搜索（留在 skill）。
- 不引第三方依赖（纯 Node stdlib + spawn claude）。

## 交付顺序

先移除 launchd（干净起点），再建 indexer → job → 端点 → 启动触发 → UI。
