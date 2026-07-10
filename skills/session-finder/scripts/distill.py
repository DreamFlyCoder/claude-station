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
