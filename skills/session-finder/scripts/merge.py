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
