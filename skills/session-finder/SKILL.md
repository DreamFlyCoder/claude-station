---
name: session-finder
description: 用自然语言描述历史 Claude Code 会话的内容/脉络，按匹配度找回会话并给出 resume 命令。当用户说"我想找之前那个会话/找回某次对话/上次讲过 xxx 的会话在哪"时使用；也负责建立/更新会话摘要索引（backfill）。
---

# session-finder

把散落在 `~/.claude/projects/**/*.jsonl` 的历史会话，蒸馏成结构化摘要，存进 `~/.claude/session-index.json`。之后用户用自然语言描述，就能按匹配度找回会话。

脚本目录：本 skill 的 `scripts/`。索引文件：`~/.claude/session-index.json`。

## 何时做 backfill（建/更新索引）

用户要求"建索引/更新索引/把新会话加进去"，或搜索时发现索引缺失/过旧时。

### backfill 步骤

1. 列出待索引会话：
   `python3 <skill>/scripts/scan.py > /tmp/sf_todo.json`
   读 `/tmp/sf_todo.json`，得到待办数组（每项含 sessionId/path/cwd/aiTitle/startedAt/messageCount/sourceMtime）。若为空，告诉用户"索引已是最新"，结束。

2. 对每个待办会话取蒸馏文本：`python3 <skill>/scripts/distill.py <path>` 得到含 `text` 的 JSON。

3. **分批派 subagent 生成摘要**（这是耗 token 的一步，务必并行）。把待办按累计 `text` 大小分批，每批 ≤ ~15 个会话且累计字符 ≤ ~40KB；蒸馏后 >50KB 的大会话单独成批。对每批 spawn 一个 subagent，喂入该批各会话的 `sessionId + 蒸馏 text`，要求它对**每个**会话按下面 schema 产出一条：

   ```json
   {"sessionId":"...","title":"简短中文标题(可参考已有 aiTitle 但用中文重述)","summary":"3-5句，必须描述会话的演进弧线：先做了什么→接着→再→最后","topics":["主题词","涉及的仓/功能","关键名词"]}
   ```

   摘要要点：抓住**用户意图的推进过程**（例："先请 agent 讲 mbo/mmm 逻辑 → 复用讲解给自定义看板加数据集 → 再复用逻辑加 ltv 数据集"），不要只写开头。

4. 收齐所有 subagent 产出的条目，为每条补上 scan 给的 `cwd/startedAt/messageCount/sourceMtime`（按 sessionId 对齐），写到 `/tmp/sf_entries.json`（数组）。

5. 合并进索引：`python3 <skill>/scripts/merge.py ~/.claude/session-index.json /tmp/sf_entries.json`。

6. 回报：新增/更新了多少条、索引现共多少条。

## 何时做 search（找回会话）

用户描述某个历史会话的内容/脉络，想找回它。

### search 步骤

1. 读 `~/.claude/session-index.json`。若不存在或明显过旧（用户提到的会话不在里面），提示先 backfill。
2. 通读全部条目的 `title/summary/topics`，按用户描述做**语义匹配打分**，选出最像的 top 3-5。
3. 输出每个候选：**标题** + 一句话摘要 + **为什么匹配**（点出与用户描述对上的脉络/主题）+ 可直接复制的 `resume` 命令。
4. 若没有明显匹配，坦白说没找到高置信项，列出最接近的 2 个并说明差在哪，建议用户补充描述或先 backfill。

## 注意

- `<skill>` 指本 SKILL.md 所在目录。
- backfill 的 subagent 只做摘要，不改任何文件、不跑别的工具。
- 搜索阶段默认只读索引；用户要对某候选深挖时，才用 distill.py 重新读那一个会话原文。
