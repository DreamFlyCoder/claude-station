import os, unittest
from scripts.distill import distill_file

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "test-sess-1.jsonl")

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
        self.assertEqual(self.r["messageCount"], 4)  # user, assistant, user(tool_result), sidechain user = 4
        self.assertIsInstance(self.r["sourceMtime"], int)

    def test_sessionid_from_filename_not_record(self):
        # The fixture contains a sidechain record with sessionId="sidechain-OTHER-id".
        # The canonical id must come from the FILENAME stem ("test-sess-1"), NOT from any record.
        self.assertEqual(self.r["sessionId"], "test-sess-1")
        self.assertNotEqual(self.r["sessionId"], "sidechain-OTHER-id")

    def test_empty_returns_none(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
            f.write('{"type":"attachment","attachment":{"data":"x"}}\n')
            p = f.name
        self.assertIsNone(distill_file(p))
        os.unlink(p)

if __name__ == "__main__":
    unittest.main()
