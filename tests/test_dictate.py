"""Dictating a reply (dictate.py): recorded here, written down by whisper.cpp
here; run with stand-ins for the recorder and whisper.cpp."""
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

CODE = Path(__file__).resolve().parent.parent / "package/contents/code"

# Records until it's interrupted (SIGINT), as pw-record does: a WAV file
FAKE_RECORDER = """#!{python}
import signal, sys, time
out = sys.argv[-1]
def done(*_):
    open(out, "wb").write(b"RIFF" + b"\\0" * 8000)
    sys.exit(0)
signal.signal(signal.SIGINT, done)
open({log!r}, "a").write(" ".join(sys.argv[1:]) + "\\n")
while True:
    time.sleep(0.05)
"""
FAKE_WHISPER = """#!{python}
import sys
open({log!r}, "a").write(" ".join(sys.argv[1:]) + "\\n")
print(" Make the parser accept ISO weeks.")
print(" [BLANK_AUDIO]")
print(" Then run the tests.")
"""


class DictateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.bin = self.home / "bin"
        self.bin.mkdir()
        self.log = self.home / "calls.log"
        self.model = self.home / "ggml-base.bin"
        self.model.write_bytes(b"model")

    def tool(self, name, source):
        path = self.bin / name
        path.write_text(source.format(python=sys.executable, log=str(self.log)))
        path.chmod(0o755)

    def run_it(self, *args, model=True):
        env = dict(os.environ, HOME=str(self.home), XDG_CACHE_HOME=str(self.home / "cache"),
                   XDG_DATA_HOME=str(self.home / "data"), PATH=f"{self.bin}:/usr/bin:/bin")
        if model:
            env["WHISPER_MODEL"] = str(self.model)
        else:
            env.pop("WHISPER_MODEL", None)
        out = subprocess.run([sys.executable, "-I", str(CODE / "dictate.py"), *args], stdout=subprocess.PIPE, env=env,
                             timeout=30)
        return json.loads(out.stdout)

    def test_recorded_then_written_down_and_the_recording_goes(self):
        self.tool("pw-record", FAKE_RECORDER)
        self.tool("whisper-cli", FAKE_WHISPER)
        self.assertTrue(self.run_it("--status")["ok"])
        self.assertEqual(self.run_it("--start", "r1")["message"], "Recording")
        time.sleep(0.3)
        got = self.run_it("--stop", "r1", "--language", "de")
        self.assertEqual(got, {"ok": True, "text": "Make the parser accept ISO weeks. Then run the tests.", "message": ""})
        calls = self.log.read_text()
        self.assertIn("--rate 16000 --channels 1 --format s16", calls)
        self.assertIn(f"-m {self.model}", calls)
        self.assertIn("-l de", calls)
        folder = self.home / "cache/claude-widget/dictation"
        self.assertEqual(list(folder.iterdir()), [])   # (what you said isn't kept)
        self.assertEqual(oct(folder.stat().st_mode & 0o777), "0o700")

    def test_cancelled_nothing_is_written_down(self):
        self.tool("pw-record", FAKE_RECORDER)
        self.tool("whisper-cli", FAKE_WHISPER)
        self.run_it("--start", "r2")
        time.sleep(0.2)
        self.assertEqual(self.run_it("--cancel", "r2"), {"ok": True, "message": "Not written down"})
        self.assertNotIn("-m ", self.log.read_text())
        self.assertEqual(list((self.home / "cache/claude-widget/dictation").iterdir()), [])

    def test_what_is_missing_is_said(self):
        self.tool("pw-record", FAKE_RECORDER)
        got = self.run_it("--status", model=False)
        self.assertFalse(got["ok"])
        self.assertIsNone(got["tool"])
        self.assertIsNone(got["model"])
        self.assertIn("sudo dnf install whisper-cpp", got["missing"][0])
        self.assertEqual([m["name"] for m in got["models"]], ["base", "small", "base.en"])
        # a model downloaded before is found where the widget keeps them
        folder = self.home / "data/claude-widget/whisper"
        folder.mkdir(parents=True)
        (folder / "ggml-small.bin").write_bytes(b"m")
        self.assertEqual(self.run_it("--status", model=False)["model"], str(folder / "ggml-small.bin"))

    def test_odd_ids_and_models_are_refused(self):
        self.assertEqual(self.run_it("--start", "../x"), {"ok": False, "message": "Not a recording: ../x"})
        self.assertEqual(self.run_it("--get-model", "huge"), {"ok": False, "message": "Not a model: huge"})


if __name__ == "__main__":
    unittest.main()
