# session-finder 实现计划（阶段1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个 `session-finder` skill，把历史 Claude Code 会话蒸馏成结构化摘要索引，让用户用自然语言描述就能按匹配度找回会话并拿到 resume 命令。

**Architecture:** 三个纯 Python 脚本（distill / scan / merge，无 AI、可单测）+ 一份 SKILL.md 编排（backfill 与 search 两条工作流，AI 部分由 Claude 按 SKILL.md 执行）。skill 与 claude-station 通过共享索引文件 `~/.claude/session-index.json` 的字段契约对接，不共享代码。

**Tech Stack:** Python 3 标准库（`json`/`os`/`glob`/`datetime`/`unittest`），无第三方依赖。

## Global Constraints

- 脚本零第三方依赖，只用 Python3 标准库。
- 测试用 `python3 -m unittest`（不假设装了 pytest）。
- skill 源码放 claude-station 仓库 `skills/session-finder/`，通过 symlink 挂到 `~/.claude/skills/session-finder` 生效。
- 索引文件路径：`~/.claude/session-index.json`（脚本内用 `os.path.expanduser`）。
- 会话数据路径：`~/.claude/projects/**/*.jsonl`。
- 索引条目字段契约（稳定，勿随意改名）：
  `sessionId, cwd, title, summary, topics[], startedAt, messageCount, sourceMtime, indexedAt, resume`
- distiller 降噪规则：保留 `user` 记录的字符串内容与 `text` 块、`assistant` 记录的 `text` 块；丢弃 `thinking`/`tool_use`/`tool_result`/`attachment`/`file-history-snapshot`/其余类型；每条 user 文本截断 500 字、assistant 文本截断 800 字。
- 当前工作分支：`feature-session-finder`（claude-station 仓库，`/Users/luguotao/code/claude-station`）。

---

## File Structure

- `skills/session-finder/scripts/distill.py` — 单文件蒸馏：jsonl → 结构化 dict（含蒸馏文本 + 元数据）
- `skills/session-finder/scripts/scan.py` — 扫 projects 目录，跟现有索引 diff，列出需要（重新）索引的会话
- `skills/session-finder/scripts/merge.py` — 把新条目 upsert 进索引，派生 resume/indexedAt，原子写盘
- `skills/session-finder/tests/test_distill.py` — distill 单测
- `skills/session-finder/tests/test_scan.py` — scan 单测
- `skills/session-finder/tests/test_merge.py` — merge 单测
- `skills/session-finder/tests/fixtures/*.jsonl` — 手写的极小假会话
- `skills/session-finder/SKILL.md` — backfill + search 两条工作流编排

---

### Task 1: distiller 脚本

**Files:**
- Create: `skills/session-finder/scripts/distill.py`
- Create: `skills/session-finder/tests/fixtures/sample_basic.jsonl`
- Test: `skills/session-finder/tests/test_distill.py`

**Interfaces:**
- Produces: `distill_file(path: str) -> dict | None`
  返回 `{"sessionId": str, "cwd": str, "aiTitle": str|None, "startedAt": str|None, "messageCount": int, "sourceMtime": int, "text": str}`；文件无法解析或无任何对话文本时返回 `None`。
  CLI：`python3 distill.py <jsonl_path>` 把该 dict 打成 JSON 到 stdout；返回 `None` 时退出码 1、无输出。

- [ ] **Step 1: 写 fixture（极小假会话，覆盖降噪各分支）**

Create `skills/session-finder/tests/fixtures/sample_basic.jsonl`（每行一条 JSON）：

```jsonl
{"type":"user","sessionId":"test-sess-1","cwd":"/Users/x/proj","timestamp":"2026-06-01T10:00:00.000Z","message":{"role":"user","content":"讲一下 mbo 逻辑"}}
{"type":"assistant","sessionId":"test-sess-1","timestamp":"2026-06-01T10:00:05.000Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"SECRET_THOUGHT"},{"type":"text","text":"mbo 是这样..."},{"type":"tool_use","name":"Bash","input":{"command":"NOISE_LS"}}]}}
{"type":"user","sessionId":"test-sess-1","timestamp":"2026-06-01T10:00:10.000Z","message":{"role":"user","content":[{"type":"tool_result","content":"NOISE_TOOL_RESULT"}]}}
{"type":"ai-title","sessionId":"test-sess-1","aiTitle":"MBO logic explained"}
{"type":"attachment","sessionId":"test-sess-1","attachment":{"data":"NOISE_BASE64"}}
```

- [ ] **Step 2: 写失败测试**

Create `skills/session-finder/tests/test_distill.py`:

```python
import os, unittest
from scripts.distill import distill_file

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "sample_basic.jsonl")

class TestDistill(unittest.TestCase):
    def setUp(self):
        self.r = distill_file(FIX)

    def test_returns_dict(self):
        self.assertIsNotNone(self.r)

    def test_keeps_conversation_text(self):
        self.assertIn("讲一下 mbo 逻辑", self.r["text"])
        self.assertIn("mbo 是这样...", self.r["text"])

    def test_strips_noise(self):
        for noise in ("SECRET_THOUGHT", "NOISE_LS", "NOISE_TOOL_RESULT", "NOISE_BASE64"):
            self.assertNotIn(noise, self.r["text"])

    def test_metadata(self):
        self.assertEqual(self.r["sessionId"], "test-sess-1")
        self.assertEqual(self.r["cwd"], "/Users/x/proj")
        self.assertEqual(self.r["aiTitle"], "MBO logic explained")
        self.assertEqual(self.r["startedAt"], "2026-06-01T10:00:00.000Z")
        self.assertEqual(self.r["messageCount"], 3)  # user, assistant, user(tool_result) 三条记录
        self.assertIsInstance(self.r["sourceMtime"], int)

    def test_empty_returns_none(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
            f.write('{"type":"attachment","attachment":{"data":"x"}}\n')
            p = f.name
        self.assertIsNone(distill_file(p))
        os.unlink(p)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd skills/session-finder && python3 -m unittest tests.test_distill -v`
Expected: FAIL / ERROR（`No module named 'scripts.distill'`）

- [ ] **Step 4: 写实现**

Create `skills/session-finder/scripts/__init__.py`（空文件）和 `skills/session-finder/tests/__init__.py`（空文件），然后 Create `skills/session-finder/scripts/distill.py`:

```python
import sys, os, json

U_CAP, A_CAP = 500, 800

def _iter_records(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue

def distill_file(path):
    session_id = os.path.splitext(os.path.basename(path))[0]
    cwd = None
    ai_title = None
    started_at = None
    msg_count = 0
    users, assts = [], []
    for d in _iter_records(path):
        t = d.get("type")
        if d.get("sessionId"):
            session_id = d["sessionId"]
        if cwd is None and d.get("cwd"):
            cwd = d["cwd"]
        if started_at is None and d.get("timestamp"):
            started_at = d["timestamp"]
        if t == "ai-title" and d.get("aiTitle"):
            ai_title = d["aiTitle"]
        m = d.get("message")
        if t == "user" and isinstance(m, dict):
            msg_count += 1
            c = m.get("content")
            if isinstance(c, str):
                if c.strip():
                    users.append(c[:U_CAP])
            elif isinstance(c, list):
                for b in c:
                    if isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip():
                        users.append(b["text"][:U_CAP])
        elif t == "assistant" and isinstance(m, dict):
            msg_count += 1
            c = m.get("content")
            if isinstance(c, list):
                for b in c:
                    if isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip():
                        assts.append(b["text"][:A_CAP])
    text = "\n".join(["[USER]\n" + u for u in users] + ["[ASSISTANT]\n" + a for a in assts])
    if not text.strip():
        return None
    return {
        "sessionId": session_id,
        "cwd": cwd,
        "aiTitle": ai_title,
        "startedAt": started_at,
        "messageCount": msg_count,
        "sourceMtime": int(os.path.getmtime(path)),
        "text": text,
    }

if __name__ == "__main__":
    r = distill_file(sys.argv[1])
    if r is None:
        sys.exit(1)
    print(json.dumps(r, ensure_ascii=False))
```

注：`session_id` 以文件名为初值，循环内始终用记录里的 `sessionId` 覆盖——真实数据里文件名即 sessionId（二者一致），fixture 里以记录为准，测试断言 `test-sess-1` 因此成立。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd skills/session-finder && python3 -m unittest tests.test_distill -v`
Expected: PASS（5 个测试全绿）

- [ ] **Step 6: 真实数据冒烟**

Run: `cd skills/session-finder && python3 scripts/distill.py "$(find ~/.claude/projects -name '*.jsonl' -size +100k | head -1)" | python3 -c "import sys,json; d=json.load(sys.stdin); print('sid',d['sessionId'][:8],'cwd',d['cwd'],'chars',len(d['text']),'msgs',d['messageCount'])"`
Expected: 打印出真实 sessionId/cwd、text 字符数（几千到几万）、消息数。

- [ ] **Step 7: Commit**

```bash
git add skills/session-finder/scripts/distill.py skills/session-finder/scripts/__init__.py skills/session-finder/tests/__init__.py skills/session-finder/tests/test_distill.py skills/session-finder/tests/fixtures/sample_basic.jsonl
git commit -m "feat(session-finder): distiller 脚本 + 单测"
```

---

### Task 2: scan 脚本（增量 diff）

**Files:**
- Create: `skills/session-finder/scripts/scan.py`
- Test: `skills/session-finder/tests/test_scan.py`

**Interfaces:**
- Consumes: `distill_file`（仅用其中的元数据字段，Task 1 产出）
- Produces: `find_todo(projects_dir: str, index_path: str) -> list[dict]`
  返回需要（重新）索引的会话列表，每项 `{"sessionId","path","cwd","aiTitle","startedAt","messageCount","sourceMtime"}`。判定规则：该 sessionId 不在索引中，或索引里的 `sourceMtime` 与当前文件 mtime 不同。索引文件不存在时视为全部待索引。
  CLI：`python3 scan.py [projects_dir] [index_path]`，默认 `~/.claude/projects` 与 `~/.claude/session-index.json`，打印 JSON 数组到 stdout。

- [ ] **Step 1: 写失败测试**

Create `skills/session-finder/tests/test_scan.py`:

```python
import os, json, tempfile, shutil, unittest
from scripts.scan import find_todo

class TestScan(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.projects = os.path.join(self.dir, "projects", "-proj-a")
        os.makedirs(self.projects)
        self.sess = os.path.join(self.projects, "sess-a.jsonl")
        with open(self.sess, "w", encoding="utf-8") as f:
            f.write('{"type":"user","sessionId":"sess-a","cwd":"/p/a","timestamp":"2026-06-01T00:00:00.000Z","message":{"role":"user","content":"hello"}}\n')
        self.index = os.path.join(self.dir, "index.json")

    def tearDown(self):
        shutil.rmtree(self.dir)

    def test_all_todo_when_no_index(self):
        todo = find_todo(os.path.join(self.dir, "projects"), self.index)
        self.assertEqual(len(todo), 1)
        self.assertEqual(todo[0]["sessionId"], "sess-a")
        self.assertEqual(todo[0]["cwd"], "/p/a")

    def test_skips_already_indexed_same_mtime(self):
        mtime = int(os.path.getmtime(self.sess))
        with open(self.index, "w", encoding="utf-8") as f:
            json.dump([{"sessionId": "sess-a", "sourceMtime": mtime}], f)
        todo = find_todo(os.path.join(self.dir, "projects"), self.index)
        self.assertEqual(todo, [])

    def test_reindex_when_mtime_changed(self):
        with open(self.index, "w", encoding="utf-8") as f:
            json.dump([{"sessionId": "sess-a", "sourceMtime": 1}], f)
        todo = find_todo(os.path.join(self.dir, "projects"), self.index)
        self.assertEqual(len(todo), 1)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd skills/session-finder && python3 -m unittest tests.test_scan -v`
Expected: ERROR（`No module named 'scripts.scan'`）

- [ ] **Step 3: 写实现**

Create `skills/session-finder/scripts/scan.py`:

```python
import sys, os, json, glob

def _load_index(index_path):
    if not os.path.exists(index_path):
        return {}
    with open(index_path, encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError:
            return {}
    return {e["sessionId"]: e for e in data if isinstance(e, dict) and e.get("sessionId")}

def _meta(path):
    """轻量扫一遍取元数据，不做文本蒸馏。"""
    session_id = os.path.splitext(os.path.basename(path))[0]
    cwd = ai_title = started_at = None
    msg_count = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if d.get("sessionId"):
                session_id = d["sessionId"]
            if cwd is None and d.get("cwd"):
                cwd = d["cwd"]
            if started_at is None and d.get("timestamp"):
                started_at = d["timestamp"]
            if d.get("type") == "ai-title" and d.get("aiTitle"):
                ai_title = d["aiTitle"]
            if d.get("type") in ("user", "assistant") and isinstance(d.get("message"), dict):
                msg_count += 1
    return {
        "sessionId": session_id, "path": path, "cwd": cwd, "aiTitle": ai_title,
        "startedAt": started_at, "messageCount": msg_count,
        "sourceMtime": int(os.path.getmtime(path)),
    }

def find_todo(projects_dir, index_path):
    index = _load_index(index_path)
    todo = []
    for path in glob.glob(os.path.join(projects_dir, "**", "*.jsonl"), recursive=True):
        m = _meta(path)
        prev = index.get(m["sessionId"])
        if prev is None or prev.get("sourceMtime") != m["sourceMtime"]:
            todo.append(m)
    return todo

if __name__ == "__main__":
    pd = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.claude/projects")
    ip = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser("~/.claude/session-index.json")
    print(json.dumps(find_todo(pd, ip), ensure_ascii=False))
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd skills/session-finder && python3 -m unittest tests.test_scan -v`
Expected: PASS（3 个测试）

- [ ] **Step 5: 真实数据冒烟（应列出全部 392）**

Run: `cd skills/session-finder && python3 scripts/scan.py | python3 -c "import sys,json; d=json.load(sys.stdin); print('待索引会话数:', len(d))"`
Expected: 打印约 392（因为索引还不存在）。

- [ ] **Step 6: Commit**

```bash
git add skills/session-finder/scripts/scan.py skills/session-finder/tests/test_scan.py
git commit -m "feat(session-finder): scan 增量 diff 脚本 + 单测"
```

---

### Task 3: merge 脚本（upsert + 派生字段 + 原子写）

**Files:**
- Create: `skills/session-finder/scripts/merge.py`
- Test: `skills/session-finder/tests/test_merge.py`

**Interfaces:**
- Produces: `merge_entries(index_path: str, new_entries: list[dict], now_iso: str) -> int`
  输入条目须含 `sessionId, cwd, title, summary, topics, startedAt, messageCount, sourceMtime`；函数为每条派生 `resume = "cd {cwd} && claude --resume {sessionId}"` 与 `indexedAt = now_iso`，按 `sessionId` upsert 进现有索引，原子写回，返回索引总条目数。
  CLI：`python3 merge.py <index_path> <entries_json_path>`，用系统当前时间作 `indexedAt`。

- [ ] **Step 1: 写失败测试**

Create `skills/session-finder/tests/test_merge.py`:

```python
import os, json, tempfile, shutil, unittest
from scripts.merge import merge_entries

class TestMerge(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.index = os.path.join(self.dir, "index.json")

    def tearDown(self):
        shutil.rmtree(self.dir)

    def _entry(self, sid, title):
        return {"sessionId": sid, "cwd": "/p/a", "title": title, "summary": "s",
                "topics": ["t"], "startedAt": "2026-06-01T00:00:00.000Z",
                "messageCount": 3, "sourceMtime": 111}

    def test_insert_and_derive(self):
        n = merge_entries(self.index, [self._entry("s1", "T1")], "2026-07-10T00:00:00Z")
        self.assertEqual(n, 1)
        data = json.load(open(self.index, encoding="utf-8"))
        self.assertEqual(data[0]["resume"], "cd /p/a && claude --resume s1")
        self.assertEqual(data[0]["indexedAt"], "2026-07-10T00:00:00Z")

    def test_upsert_replaces_same_id(self):
        merge_entries(self.index, [self._entry("s1", "T1")], "t0")
        merge_entries(self.index, [self._entry("s1", "T1-new")], "t1")
        data = json.load(open(self.index, encoding="utf-8"))
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["title"], "T1-new")

    def test_adds_new_id(self):
        merge_entries(self.index, [self._entry("s1", "T1")], "t0")
        merge_entries(self.index, [self._entry("s2", "T2")], "t1")
        data = json.load(open(self.index, encoding="utf-8"))
        self.assertEqual({e["sessionId"] for e in data}, {"s1", "s2"})

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd skills/session-finder && python3 -m unittest tests.test_merge -v`
Expected: ERROR（`No module named 'scripts.merge'`）

- [ ] **Step 3: 写实现**

Create `skills/session-finder/scripts/merge.py`:

```python
import sys, os, json, datetime

def merge_entries(index_path, new_entries, now_iso):
    existing = []
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as f:
            try:
                existing = json.load(f)
            except json.JSONDecodeError:
                existing = []
    by_id = {e["sessionId"]: e for e in existing if isinstance(e, dict) and e.get("sessionId")}
    for e in new_entries:
        sid, cwd = e["sessionId"], e.get("cwd") or ""
        by_id[sid] = {
            "sessionId": sid,
            "cwd": cwd,
            "title": e.get("title", ""),
            "summary": e.get("summary", ""),
            "topics": e.get("topics", []),
            "startedAt": e.get("startedAt"),
            "messageCount": e.get("messageCount", 0),
            "sourceMtime": e.get("sourceMtime"),
            "indexedAt": now_iso,
            "resume": f"cd {cwd} && claude --resume {sid}",
        }
    merged = list(by_id.values())
    tmp = index_path + ".tmp"
    os.makedirs(os.path.dirname(index_path) or ".", exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
    os.replace(tmp, index_path)
    return len(merged)

if __name__ == "__main__":
    index_path, entries_path = sys.argv[1], sys.argv[2]
    with open(entries_path, encoding="utf-8") as f:
        entries = json.load(f)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    total = merge_entries(index_path, entries, now)
    print(f"索引现有 {total} 条")
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd skills/session-finder && python3 -m unittest tests.test_merge -v`
Expected: PASS（3 个测试）

- [ ] **Step 5: Commit**

```bash
git add skills/session-finder/scripts/merge.py skills/session-finder/tests/test_merge.py
git commit -m "feat(session-finder): merge upsert 脚本 + 单测"
```

---

### Task 4: SKILL.md — backfill 工作流 + 挂载生效 + 小样验证

**Files:**
- Create: `skills/session-finder/SKILL.md`

**Interfaces:**
- Consumes: `scan.py`（列待办）、`distill.py`（取蒸馏文本）、`merge.py`（写索引）
- Produces: SKILL.md 的 backfill 段，供 Claude 执行；产物是写入 `~/.claude/session-index.json` 的条目。

- [ ] **Step 1: 写 SKILL.md（含 backfill 编排）**

Create `skills/session-finder/SKILL.md`:

````markdown
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
````

- [ ] **Step 2: 挂载到 ~/.claude/skills 生效**

Run:
```bash
mkdir -p ~/.claude/skills
ln -sfn /Users/luguotao/code/claude-station/skills/session-finder ~/.claude/skills/session-finder
ls -l ~/.claude/skills/session-finder
```
Expected: 显示 symlink 指向仓库目录。

- [ ] **Step 3: 小样 backfill 验证（只跑一个小项目目录，避免一上来烧 392 个）**

选一个会话数少的项目目录做端到端演练。先看各项目会话数：
```bash
for d in ~/.claude/projects/*/; do echo "$(find "$d" -name '*.jsonl' | wc -l) $d"; done | sort -n | head
```
挑一个 2-5 个会话的目录 `<small_dir>`，用它跑一遍 backfill 三段脚本到一个**临时索引**（不污染正式索引）：
```bash
cd /Users/luguotao/code/claude-station/skills/session-finder
python3 scripts/scan.py "<small_dir>的父级" /tmp/sf_test_index.json > /tmp/sf_todo.json
python3 -c "import json;print('待办',len(json.load(open('/tmp/sf_todo.json'))))"
```
然后**手动扮演 backfill**：对 todo 里每个 path 跑 `distill.py`，你（Claude）读蒸馏文本、按 schema 写出 entries 到 `/tmp/sf_entries.json`，再 `python3 scripts/merge.py /tmp/sf_test_index.json /tmp/sf_entries.json`。
Expected: `/tmp/sf_test_index.json` 生成，条目数 = 待办数，每条 summary 能看出会话脉络、resume 命令正确。

- [ ] **Step 4: Commit**

```bash
git add skills/session-finder/SKILL.md
git commit -m "feat(session-finder): SKILL.md backfill+search 编排，挂载生效"
```

---

### Task 5: 全量 backfill + 真实查询验收

**Files:**（无新增，执行与验证）

**Interfaces:**
- Consumes: 全部脚本 + SKILL.md 的 backfill/search 流程。

- [ ] **Step 1: 全量 backfill 正式索引**

按 SKILL.md backfill 流程，对全部 392 个会话执行（scan → 分批 distill → 并行 subagent 摘要 → merge 到 `~/.claude/session-index.json`）。分批并行以控制时间与 token。

- [ ] **Step 2: 校验索引规模与结构**

Run:
```bash
python3 -c "import json,os; d=json.load(open(os.path.expanduser('~/.claude/session-index.json'))); print('条目数',len(d)); e=d[0]; print('字段',sorted(e)); print('示例标题',e['title'])"
```
Expected: 条目数接近 392；字段含全部契约字段；标题/摘要可读。

- [ ] **Step 3: 真实查询验收（用户原始需求那次会话）**

按 search 流程执行查询：
> "找那个会话：最开始让 agent 讲 mbo/mmm 的逻辑，后来让他给自定义看板添加数据集，后续把加数据集的逻辑复用继续添加 ltv 数据集"

Expected: 返回的 top 候选里，能命中那个真实会话（platform-dbt 相关、含 mbo/mmm/自定义看板/ltv 脉络），并给出可直接复制的 resume 命令。若未命中，检查该会话是否已入索引、其 summary 是否抓住了脉络，据此调 backfill 的摘要 prompt（SKILL.md Step 1 的 schema 说明）后重跑该会话。

- [ ] **Step 4: 反向验收（无关查询不应乱匹配）**

按 search 流程查一个索引里大概率没有的主题（如"配置 Kubernetes Ingress 证书"）。
Expected: skill 坦白无高置信匹配，而不是硬凑一个。

- [ ] **Step 5: 记录索引文件到 .gitignore 说明（不提交索引本体）**

索引在 `~/.claude/`，本就不在仓库内，无需 gitignore。此步仅确认：`git status` 干净，无意外把 `/tmp` 或索引文件加入仓库。
Run: `git status --short`
Expected: 无未预期的改动。

- [ ] **Step 6: Commit（若 Task 3 验收后微调了 SKILL.md 的摘要 schema）**

```bash
git add -A skills/session-finder/
git commit -m "chore(session-finder): 全量 backfill 验收后的摘要 prompt 微调" || echo "无改动可提交"
```

---

## Self-Review

**Spec coverage：**
- 摘要索引+模型通读 → Task 4 search 流程（读索引、语义排序）✅
- 蒸馏降噪 → Task 1 distill.py（规则见 Global Constraints）✅
- 索引文件字段契约 → Task 3 merge.py 派生 + Global Constraints 定义 ✅
- 手动批量 backfill + 增量 → Task 2 scan diff + Task 4/5 backfill ✅
- skill↔station 靠索引文件不靠代码 → 阶段2，不在本计划范围（spec 已注明"后面再说"）✅
- 大会话（>50KB）单独处理 → Task 4 backfill Step 3 ✅
- 抓演进弧线 → Task 4 摘要 schema 明确要求 ✅

**阶段2（hook 自动追新 + station 展示页）不在本计划**，符合 spec 分阶段约定。

**Placeholder scan：** 无 TBD/TODO；所有脚本给出完整代码；测试给出完整断言。AI 步骤（摘要/搜索）是 SKILL.md 里的确定性 prompt 而非占位。

**Type consistency：** `distill_file` 返回字段、`find_todo` 项字段、`merge_entries` 入参字段与索引契约字段三处一致；`sourceMtime` 全程为 int；`sessionId` 为对齐键贯穿 scan→摘要→merge。
