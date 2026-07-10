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
