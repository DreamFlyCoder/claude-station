# claude-station「Session Finder」展示页设计（session-finder 阶段2-②）

**日期**: 2026-07-16
**状态**: 设计已确认，待写实现计划
**关联**: `2026-07-10-session-finder-design.md`（阶段1 已交付）

## 背景

session-finder 阶段1 已交付：skill 把历史会话蒸馏成结构化摘要写入 `~/.claude/session-index.json`（当前 138 条真实会话），并在 Claude Code 里提供 AI 语义搜索。阶段2-② 是给 claude-station（用户自建的本地 web 面板）加一个页面，把这份索引**可视化浏览 + 关键词筛选 + 一键 resume**。

## 关键约束

- **station 无大模型 API** → 本页面**不做 AI 语义搜索**，只做在已生成好的摘要/主题词上的**关键词即时过滤**。AI 语义搜索继续留在 skill。
- **skill ↔ station 零代码耦合**，只通过 `~/.claude/session-index.json` 字段契约对接。本页面是 index.json 的**只读消费方**。
- **纯加法**：不改 station 任何现有行为。沿用 station 现有模式（HTML-string view + `layout()` + 正则路由 + 零依赖 Node stdlib）。

## 索引字段契约（消费方视角，只读）

每条：`sessionId, cwd, title, summary, topics[], startedAt, messageCount, sourceMtime, indexedAt, resume`。
本页面用到：`title, summary, topics, cwd, messageCount, startedAt, resume`。

## 组件拆分

1. **`readSessionIndex()`（新增于 `src/scanner.mjs`）**
   - 读并 `JSON.parse` `~/.claude/session-index.json`；文件不存在、读失败、JSON 坏、或顶层非数组 → 返回 `[]`（不抛）。
   - 只做 IO + 解析，不排序不渲染。可独立测试。
   - 职责边界：输入无（固定路径），输出条目数组。

2. **`renderSessions()`（新增 view `src/views/sessions.mjs`）**
   - 调 `readSessionIndex()` → 按 `startedAt` 倒序 → 生成卡片列表 HTML + 顶部过滤框 → 套 `layout('Session Finder', content, { isSessions: true, breadcrumbs })`。
   - 每张卡：标题 · 摘要 · 主题词 chips · 项目名（`basename(cwd)`）· 消息数 · 日期 · Resume 按钮。全字段 `escapeHtml`。
   - Resume 按钮复用现有 `.btn-resume`（`data-cmd="<entry.resume>"`），交给 layout 里已有的复制-to-clipboard JS。
   - 空/异常态（索引为空）：提示"还没建索引，在 Claude Code 里说『更新会话索引』先跑一次 backfill"。
   - 过滤：每张卡带 `data-blob`（`title+summary+topics` 小写拼接）；页内 `<script>` 监听过滤框 `input`，实时显隐并更新计数 `Sessions (N)`。纯前端，无新 API。

3. **路由（改 `src/server.mjs`）**
   - 加一条：`GET /sessions` → `renderSessions()`。放在其它 GET 页面路由旁。

4. **侧栏入口（改 `src/views/layout.mjs`）**
   - 在 `renderSidebar` 的 `sb-footer` 加一条全局链接 `🔎 Session Finder`（href `/sessions`），与 Config Center / Archive 并列。
   - `layout()` 与 `renderSidebar` 增加 `isSessions` 形参用于高亮当前页。
   - 主题词 chip 样式：复用现有 `.mem-tag` 视觉，或加一个小的 `.topic-chip`（决定权留给实现，优先复用）。

## 数据流

```
~/.claude/session-index.json
   → readSessionIndex()  (parse, 容错→[])
   → renderSessions()    (sort desc by startedAt, 渲染卡片 + data-blob)
   → layout()            (壳 + 复用 .btn-resume 复制 JS + 过滤 JS)
   → 浏览器：即时关键词过滤 / 点 Resume 复制命令
```

## 错误处理

- 索引缺失/坏/空 → `readSessionIndex()` 返回 `[]`，页面渲染空态提示，不报错。
- 单条缺字段 → 渲染时用默认值兜底（title 缺→"(无标题)"，topics 缺→[]，resume 缺→按钮隐藏或置灰）。

## 测试（`node --test`）

- `readSessionIndex`：正常解析返回数组；文件不存在→[]；坏 JSON→[]；非数组→[]。（用临时文件或 monkey-patch 路径；沿用 test/scanner.test.mjs 风格）
- `renderSessions`：给定若干条→输出 HTML 含标题/主题词/`btn-resume`/`data-cmd`；空数组→输出空态提示文案。

## 非目标（YAGNI）

- 不做 AI 语义搜索（留在 skill）。
- 不做服务端分页/搜索接口（138 条纯前端筛足够）。
- 不做在 station 内触发 backfill / 编辑摘要（建索引是 skill 的职责）。
- 不动 station 现有页面、路由、样式变量。

## 交付后

阶段2 还剩 ①：SessionEnd hook 自动追新（本 spec 不含）。
