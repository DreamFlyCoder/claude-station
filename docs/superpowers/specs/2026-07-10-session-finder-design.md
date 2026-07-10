# session-finder 设计文档

**日期**: 2026-07-10
**状态**: 设计已确认，待写实现计划

## 问题

用户有 392 个 Claude Code 历史会话（`~/.claude/projects/**/*.jsonl`，共 247MB）。claude-station 已提供**关键词全文搜索**，但当用户只记得会话的**语义脉络**而记不住具体关键词时搜不到。

典型场景（真实需求原话）：
> "最开始我让 agent 给我讲 mbo/mmm 的逻辑，后来让他帮我给自定义看板添加数据集，后续又把加数据集的逻辑复用，继续添加 ltv 数据集"——记不住关键词，只记得这条演进弧线，现在找不到这个会话了。

**核心需求**：用自然语言**描述**会话内容 → 系统按**匹配度**返回可能适配的会话（带一键 resume）。

## 约束

- 用户**没有自己的大模型 / embedding API**。所有 AI 能力只能借 Claude Code 订阅本身跑 → 指向 skill 方案。
- 数据量：392 会话 / 247MB / 单个最大 12MB。

## 关键设计决策（已与用户确认）

| # | 决策 | 结论 |
|---|------|------|
| 1 | 检索路线 | **摘要索引 + 模型通读**。不用 embedding、不用向量库。 |
| 2 | 入口/展示 | **分阶段**：阶段1 纯 skill；阶段2 再给 claude-station 加展示页。 |
| 3 | 摘要粒度 | **蒸馏后通读弧线**——剥噪声后让模型读，产出能反映演进过程的摘要。 |
| 4 | 建索引时机 | **手动批量 + hook 自动追新**（阶段1 手动 backfill 清存量，阶段2 hook 追增量）。 |

## 可行性验证（已实测，非估算）

对全部 392 个会话跑蒸馏原型（保留 user 消息 + assistant text 块，剥掉 thinking/tool_use/tool_result/attachment/file-history-snapshot/base64；每条 user 截断 500 字、assistant 截断 800 字）：

- **压缩比极高**：12MB 会话 → 170KB（1.4%）；中位数仅 1,839 字符（≈460 token）。
- **蒸馏全文总量 ≈ 627K token** → 这是 **backfill 阶段**输入，分批喂（约 40 批），可控。
- **搜索阶段**读的是**摘要索引**（每条 ~150 token × 392 ≈ **59K token**），一次全读进上下文没问题——语义排序前提成立。
- 9 个会话蒸馏后仍 >50KB（最大 170KB / 42K token），需在 backfill 时单独处理（单会话单 subagent，或 head+tail 截断）。

**结论**：架构成立，一次性成本可控，之后只追增量。

## 索引文件

路径：`~/.claude/session-index.json`（全局，跨项目）。数组，每会话一条：

```jsonc
{
  "sessionId": "94d5...",
  "cwd": "/Users/luguotao/IdeaProjects/platform-dbt",
  "project": "-Users-luguotao-IdeaProjects-platform-dbt",
  "title": "自定义看板加 LTV 数据集",       // 优先用 aiTitle 做种子，模型润色/补中文；缺失则模型生成
  "summary": "先请 agent 讲解 mbo/mmm 指标逻辑；随后复用讲解让它给自定义看板添加数据集；再把加数据集的逻辑复用，继续加 ltv 数据集。",
  "topics": ["mbo", "mmm", "custom-dashboard", "数据集复用", "ltv"],
  "startedAt": "2026-06-20T...",
  "messageCount": 41,
  "sourceMtime": 1720000000,                // 增量判断：文件 mtime 变了才重新索引
  "indexedAt": "2026-07-10T...",
  "resume": "cd /Users/luguotao/IdeaProjects/platform-dbt && claude --resume 94d5..."
}
```

## 组件拆分（各自单一职责、可独立测试）

1. **distiller（纯函数，无 AI）** — `jsonl 文件路径 → 蒸馏文本 + 元数据(cwd/mtime/messageCount/aiTitle/startedAt)`。
   - 语言：Node，零依赖（与 claude-station 一致，便于阶段2 直接并入 station 的 `src/`）。
   - 职责边界：只做机械抽取与降噪，不含任何模型调用；输入一个文件，输出确定结果，纯函数好测。

2. **backfill（skill 命令）** — 建/更新索引。
   - 扫 `~/.claude/projects/**/*.jsonl` → 与现有 index 做 diff（按 sessionId + sourceMtime）→ 只处理"没索引过 / mtime 变了"的会话。
   - 对待处理会话调 distiller 得蒸馏文本 → **并行 spawn subagent**，每个 subagent 读一批蒸馏文本、按固定 schema 产出 entry 列表 → 主 agent 合并写回 index。
   - 大会话（蒸馏后 >50KB）单独成批或截断，避免撑爆单个 subagent。
   - 幂等：重复跑只补差量。

3. **searcher（skill 主命令 / 默认行为）** — 语义找回。
   - 读 index（全部摘要）→ 模型按用户的自然语言描述做**语义排序**打匹配度 → 返回 top N：标题 + 摘要 + **为什么匹配** + 现成 resume 命令。
   - 不读原文（除非用户要求对某个候选深挖，可按需 distiller 再读那一个）。

4. **hook（阶段2）** — SessionEnd/Stop 时把刚结束的会话增量索引进去，保持新鲜、零手动。

5. **station 展示页（阶段2）** — 读同一个 index.json，列表 + 主题词/关键词过滤 + resume 按钮，纯展示无 AI；distiller 从 skill 抽出并入 station `src/` 共用。

## 分阶段交付

- **阶段 1（本次范围）**：distiller + backfill + searcher（都在 skill 内自包含）。跑一次存量后即可"描述→找回"。
- **阶段 2（后续，用户明确说"后面再说"）**：hook 自动追新 + station 展示页 + distiller 抽出共用。

## 非目标（YAGNI）

- 不做 embedding / 向量库 / 相似度计算。
- 不做原文全文重新索引以外的花活。
- 阶段1 不碰 claude-station 代码。

## 主要风险与对策

| 风险 | 对策 |
|------|------|
| backfill 一次性 token 成本（~627K） | 分批 + 只跑存量一次，之后增量；批大小可调。 |
| 单个超大会话撑爆 subagent | >50KB 单独处理 / head+tail 截断。 |
| 摘要抓不住"中段演进" | 蒸馏保留全程 user 意图 + assistant text，摘要 prompt 明确要求描述"先→后→再"的弧线。 |
| 索引与文件不同步 | sourceMtime diff；阶段2 hook 兜底。 |
