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

    def test_resume_shell_quotes_cwd(self):
        entry = {"sessionId": "s1", "cwd": "/Users/x/My Project", "title": "T1", "summary": "s",
                 "topics": ["t"], "startedAt": "2026-06-01T00:00:00.000Z",
                 "messageCount": 3, "sourceMtime": 111}
        merge_entries(self.index, [entry], "2026-07-10T00:00:00Z")
        data = json.load(open(self.index, encoding="utf-8"))
        self.assertEqual(data[0]["resume"], "cd '/Users/x/My Project' && claude --resume s1")

if __name__ == "__main__":
    unittest.main()
