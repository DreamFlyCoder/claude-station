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
