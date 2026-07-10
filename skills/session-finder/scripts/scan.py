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
