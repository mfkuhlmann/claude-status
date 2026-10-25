"""The chat pane (pane.py): a chat's conversation, sending it a message,
answering its permission prompt (with the hook, permission_hook.py, or keys
in tmux) and reviewing what it changed (Undo, Commit, Mark reviewed); and
what the status rows carry for it (claude_status.py)."""
import base64
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True  # keep __pycache__ out of the plasmoid package
CODE = Path(__file__).resolve().parent.parent / "package/contents/code"
sys.path.insert(0, str(CODE))
import pane  # noqa: E402

cs = pane.cs

from test_claude_status import Fixture, iso, session, write  # noqa: E402
from test_tasks import FAKE_CLAUDE, lines, prompt  # noqa: E402

SID = "5c1d7a6e-0d4f-4a8b-9a51-1f2e3d4c5b6a"


def tool_use(tid, name, inp, ts, msg="m2", **kw):
    return {"type": "assistant", "timestamp": iso(ts), **kw,
            "message": {"id": msg, "role": "assistant",
                        "content": [{"type": "tool_use", "id": tid, "name": name, "input": inp}]}}


def tool_result(tid, ts, error=False, text="ok"):
    return {"type": "user", "timestamp": iso(ts),
            "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "is_error": error,
                                                     "content": text}]}}


def text_reply(text, ts, msg, stop=None):
    return {"type": "assistant", "timestamp": iso(ts),
            "message": {"id": msg, "role": "assistant", "content": [{"type": "text", "text": text}],
                        "stop_reason": stop}}


class PaneFixture(Fixture):
    def setUp(self):
        super().setUp()
        self.folder = self.home / "repos/app"
        self.folder.mkdir(parents=True)
        self.transcript = self.home / f".claude-work/projects/-repos-app/{SID}.jsonl"
        for p in (mock.patch.object(cs.Path, "home", return_value=self.home),
                  mock.patch.object(cs, "cache_dir", return_value=self.cache)):
            p.start()
            self.addCleanup(p.stop)

    def chat(self, *entries):
        write(self.transcript, lines(*entries))

    def cli(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pane.main(list(args))
        text = out.getvalue()
        return json.loads(text.split(cs.REMOTE_MARK)[1] if cs.REMOTE_MARK in text else text)

    def rows(self):
        return {s["sessionId"]: s for g in cs.collect(self.home, self.cache, with_tokens=False)["groups"]
                for s in g["sessions"]}


class ConversationTests(PaneFixture):
    def test_items(self):
        t = self.now - 100
        a = str(self.folder / "a.py")
        self.chat(prompt("run the tests", t, cwd=str(self.folder)),
                  text_reply("I'll run them.", t + 1, "m1"),
                  text_reply("First the unit tests.", t + 1, "m1"),  # (a reply's blocks are entries of their own)
                  tool_use("t1", "Bash", {"command": "pytest -q"}, t + 2, "m1"),
                  tool_result("t1", t + 3, error=True, text="1 failed"),
                  tool_use("t2", "Read", {"file_path": a}, t + 4, "m2"),
                  tool_result("t2", t + 5),
                  tool_use("sub", "Bash", {"command": "ls"}, t + 5, "m9", isSidechain=True),
                  text_reply("One test fails.", t + 6, "m3", "end_turn"),
                  prompt("[Request interrupted by user]", t + 7),
                  {"type": "system", "subtype": "compact_boundary", "timestamp": iso(t + 8)},
                  {"type": "assistant", "timestamp": iso(t + 9), "isApiErrorMessage": True,
                   "message": {"id": "e", "role": "assistant",
                               "content": [{"type": "text", "text": "You've hit your session limit · resets 7pm"}]}},
                  tool_use("t3", "Edit", {"file_path": a, "old_string": "x = 1", "new_string": "x = 2"}, t + 10, "m4"))
        items, more = pane.conversation(self.transcript)
        self.assertFalse(more)
        self.assertEqual([(i["kind"], i.get("text") or i.get("line")) for i in items], [
            ("you", "run the tests"),
            ("claude", "I'll run them.\n\nFirst the unit tests."),
            ("tool", "Bash: pytest -q"),
            ("tool", "Read: a.py"),
            ("claude", "One test fails."),
            ("note", "Interrupted"),
            ("note", "The conversation was compacted"),
            ("note", "You've hit your session limit · resets 7pm"),
            ("tool", "Edit: a.py"),
        ])
        bash, read, edit = items[2], items[3], items[8]
        self.assertEqual((bash["status"], bash["input"], bash["output"]), ("error", "$ pytest -q", "1 failed"))
        self.assertEqual(read["status"], "ok")
        self.assertEqual(edit["status"], "open")  # (no result yet: it asks, or runs)
        self.assertIn("-x = 1", edit["input"])
        self.assertIn("+x = 2", edit["input"])
        self.assertEqual([i["key"] for i in items[1:4]], ["m1", "t1", "t2"])
        self.assertEqual(len({i["key"] for i in items}), len(items))

    def test_the_newest_items_and_more(self):
        t = self.now - 1000
        self.chat(*[prompt(f"prompt {n}", t + n) for n in range(50)])
        items, more = pane.conversation(self.transcript, limit=10)
        self.assertEqual([i["text"] for i in items], [f"prompt {n}" for n in range(40, 50)])
        self.assertTrue(more)
        # a big transcript: read from the end, further back until there's enough
        with mock.patch.object(pane, "PANE_TAIL_BYTES", 300):
            items, more = pane.conversation(self.transcript, limit=10)
        self.assertEqual(len(items), 10)
        self.assertTrue(more)

    def test_unchanged_answer(self):
        self.chat(prompt("hello", self.now, cwd=str(self.folder)))
        first = self.cli("--conversation", SID, "--profile", ".claude-work")
        self.assertTrue(first["ok"], first)
        self.assertEqual((first["name"], first["cwd"], first["profileDir"]), ("hello", str(self.folder), ".claude-work"))
        self.assertEqual(self.cli("--conversation", SID, "--if-changed", first["stamp"]), {"ok": True, "unchanged": True})
        with open(self.transcript, "a") as f:
            f.write(json.dumps(text_reply("hi", self.now + 1, "m1", "end_turn")) + "\n")
        again = self.cli("--conversation", SID, "--if-changed", first["stamp"])
        self.assertEqual([i["kind"] for i in again["items"]], ["you", "claude"])
        # (asking for more items isn't the same answer)
        self.assertNotIn("unchanged", self.cli("--conversation", SID, "--limit", "5", "--if-changed", again["stamp"]))

    def test_remote_answer_after_a_marker(self):
        self.chat(prompt("hello", self.now))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            pane.main(["--conversation", SID, "--remote"])
        self.assertTrue(out.getvalue().startswith("\n" + cs.REMOTE_MARK + " "))

    def test_on_a_host(self):
        with mock.patch("remote.host_answer", return_value={"ok": True, "items": []}) as asked:
            answer = self.cli("--conversation", SID, "--host", "gpu", "--profile", ".claude-work", "--limit", "40")
        self.assertEqual(answer, {"ok": True, "items": []})
        asked.assert_called_once_with("gpu", ["--conversation", SID, "--profile", ".claude-work", "--limit", "40"],
                                      name="pane.py")


class PermissionViewTests(PaneFixture):
    def test_the_newest_call_without_a_result(self):
        t = self.now - 10
        self.chat(prompt("go", t),
                  tool_use("a", "Read", {"file_path": "/x"}, t + 1, "m1"),
                  tool_use("b", "Bash", {"command": "rm -rf build"}, t + 1, "m1"),
                  tool_result("a", t + 2))  # (parallel calls: one has its result, the other asks)
        self.assertEqual(cs.pending_tool(self.transcript)["id"], "b")
        with open(self.transcript, "a") as f:
            f.write(json.dumps(tool_result("b", t + 3)) + "\n")
        self.assertIsNone(cs.pending_tool(self.transcript))

    def test_views(self):
        bash = cs.permission_view("Bash", {"command": "npm publish"}, str(self.folder),
                                  [{"type": "addRules", "rules": [{"toolName": "Bash", "ruleContent": "npm publish"}],
                                    "behavior": "allow", "destination": "localSettings"}])
        self.assertEqual((bash["line"], bash["command"], bash["always"]),
                         ("Bash: npm publish", "npm publish", "Bash(npm publish)"))
        edit = cs.permission_view("Edit", {"file_path": str(self.folder / "src/a.py"), "old_string": "a\nb",
                                           "new_string": "a\nc"}, str(self.folder))
        self.assertEqual(edit["file"], "src/a.py")
        self.assertEqual(edit["diff"][-2:], ["-b", "+c"])
        write(self.folder / "b.txt", "old\n")
        whole = cs.permission_view("Write", {"file_path": str(self.folder / "b.txt"), "content": "new\n"},
                                   str(self.folder), [{"type": "addDirectories", "directories": [str(self.home / "other")]}])
        self.assertEqual(whole["diff"][-2:], ["-old", "+new"])
        self.assertEqual(whole["always"], "the folder ~/other")

    def test_rows_waiting_for_a_permission(self):
        # bgperm (Fixture) waits for a permission; what it asks comes from its transcript
        write(self.home / ".claude-work/projects/-tmp-proj-bgperm/bgperm.jsonl",
              lines(prompt("write it", self.now - 5),
                    tool_use("w", "Write", {"file_path": "/tmp/x", "content": "hi"}, self.now - 4)))
        rows = self.rows()
        self.assertEqual((rows["bgperm"]["permission"]["line"], rows["bgperm"]["permission"]["answer"]), ("Write: x", ""))
        self.assertIsNone(rows["waiting"]["permission"])  # (waiting for something else)
        self.assertIsNone(rows["busy"]["permission"])
        # relayed by the hook: its request, which the widget can answer
        hook = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        self.addCleanup(lambda: (hook.kill(), hook.wait()))
        write(self.cache / "permissions/123-abcdef01.json",
              {"id": "123-abcdef01", "at": int(self.now * 1000), "hookPid": hook.pid, "sessionId": "bgperm",
               "tool": "Bash", "input": {"command": "make deploy"}, "suggestions": [], "cwd": "/tmp"})
        write(self.cache / "permissions/100-00000000.json",  # (its hook is gone: dropped)
              {"id": "100-00000000", "at": 1, "hookPid": 4194304 + 4242, "sessionId": "bgperm"})
        rows = self.rows()
        self.assertEqual((rows["bgperm"]["permission"]["line"], rows["bgperm"]["permission"]["answer"],
                          rows["bgperm"]["permission"]["request"]), ("Bash: make deploy", "hook", "123-abcdef01"))
        self.assertFalse((self.cache / "permissions/100-00000000.json").exists())

    def test_reply_routes(self):
        rows = self.rows()
        self.assertEqual(rows["vscode"]["reply"], "vscode")
        self.assertEqual(rows["bgworking"]["reply"], "background")
        self.assertEqual(rows["busy"]["reply"], "terminal")
        self.assertEqual(cs.reply_route({"pid": 5, "kind": "interactive", "tmux": True}), "tmux")
        self.assertEqual(cs.reply_route({"pid": None, "kind": "interactive"}), "background")


SCREEN = """\
 Bash command
 python3 -c 'print(42)'
 This command requires approval
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don’t ask again for: python3 *
   3. Yes, and switch to auto mode · auto mode handles these prompts for you
   4. No
 Esc to cancel · Tab to amend
"""


class KeysTests(unittest.TestCase):
    """Answering the dialog of a chat in tmux (as Claude Code 2.1.310 shows it)."""

    def test_options(self):
        self.assertEqual(pane.dialog_options(SCREEN)["2"], "Yes, and don’t ask again for: python3 *")
        self.assertEqual(pane.dialog_options("❯ 1. Yes\n"), {})  # (no dialog: a list in a reply)

    def keys(self, decision, note="", screen=SCREEN):
        sent = []

        def run(base, args, data=None):
            sent.append(args)
            return (True, screen) if args[0] == "capture-pane" else (True, "")
        with mock.patch.object(pane, "tmux_base", return_value=(["tmux"], "%3")), \
                mock.patch.object(pane, "tmux_run", side_effect=run), \
                mock.patch.object(pane, "tmux_type", return_value=(True, "")) as typed, \
                mock.patch.object(pane.time, "sleep"):
            ok, message = pane.answer_with_keys({"pid": 1, "tmux": "s:1.%3"}, decision, note)
        return ok, message, [a[-1] for a in sent if a[0] == "send-keys"], typed.call_args

    def test_keys(self):
        self.assertEqual(self.keys("allow")[2], ["1"])
        self.assertEqual(self.keys("always")[2], ["2"])
        ok, message, keys, typed = self.keys("deny", "use make instead")
        self.assertEqual((ok, keys, typed[0][1]), (True, ["4"], "use make instead"))
        ok, message, keys, _ = self.keys("allow", screen="❯ \n")
        self.assertEqual((ok, keys), (False, []))
        self.assertIn("no permission question", message)


class HookTests(unittest.TestCase):
    """permission_hook.py, run as Claude runs it (this test is its Claude)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.cache = self.home / "cache"
        self.state = self.home / ".claude-x/sessions" / f"{os.getpid()}.json"
        write(self.state, {"pid": os.getpid(), "status": "waiting"})

    def start(self):
        env = dict(os.environ, HOME=str(self.home), XDG_CACHE_HOME=str(self.cache),
                   CLAUDE_CONFIG_DIR=str(self.home / ".claude-x"))
        hook = subprocess.Popen([sys.executable, "-I", str(CODE / "permission_hook.py")], stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, env=env)
        self.addCleanup(lambda: (hook.poll() is None and hook.kill(), hook.wait(), hook.stdout.close()))
        hook.stdin.write(json.dumps({"session_id": SID, "tool_name": "Bash", "tool_input": {"command": "make"},
                                     "cwd": "/tmp", "permission_suggestions": [{
                                         "type": "addRules", "rules": [{"toolName": "Bash", "ruleContent": "make"}],
                                         "behavior": "allow", "destination": "localSettings"}]}).encode())
        hook.stdin.close()
        deadline = time.time() + 5
        while time.time() < deadline and not cs.permission_requests(self.cache / "claude-widget"):
            time.sleep(0.05)
        (request,) = cs.permission_requests(self.cache / "claude-widget").values()
        return hook, request

    def test_the_widget_answers(self):
        hook, request = self.start()
        self.assertEqual((request["tool"], request["input"], request["hookPid"]), ("Bash", {"command": "make"}, hook.pid))
        ok, message = pane.answer_request(self.cache / "claude-widget", request["id"], "always")
        self.assertEqual((ok, message), (True, "Allowed, and from now on"))
        out = json.loads(hook.stdout.read())
        hook.wait(5)
        decision = out["hookSpecificOutput"]["decision"]
        self.assertEqual(decision["behavior"], "allow")
        self.assertEqual(decision["updatedPermissions"][0]["rules"][0]["ruleContent"], "make")
        self.assertEqual(list((self.cache / "claude-widget/permissions").iterdir()), [])

    def test_answered_in_the_chat(self):
        hook, request = self.start()
        write(self.state, {"pid": os.getpid(), "status": "busy"})  # (you answered its dialog)
        self.assertEqual(hook.stdout.read(), b"")  # no word: the dialog decided
        self.assertEqual(hook.wait(5), 0)
        ok, message = pane.answer_request(self.cache / "claude-widget", request["id"], "allow")
        self.assertFalse(ok)
        self.assertIn("isn't asking any more", message)

    def test_decisions(self):
        self.assertEqual(pane.decision_of("deny", " use make test ", []),
                         {"behavior": "deny", "message": "The user denied this and said: use make test"})
        self.assertTrue(pane.decision_of("deny", "", [])["interrupt"])
        self.assertEqual(pane.decision_of("always", "", []), {"behavior": "allow"})  # (nothing to remember)


class SendTests(PaneFixture):
    def setUp(self):
        super().setUp()
        self.bin = self.home / "bin"
        self.log = self.home / "claude.log"
        write(self.bin / "claude", FAKE_CLAUDE.format(python=sys.executable, log=str(self.log)))
        (self.bin / "claude").chmod(0o755)
        w = self.home / ".claude-work"
        data = json.loads((w / ".claude.json").read_text())
        data["projects"] = {str(self.folder): {"hasTrustDialogAccepted": True}}
        write(w / ".claude.json", data)
        self.chat(prompt("fix it", self.now - 100, cwd=str(self.folder)),
                  text_reply("Done.", self.now - 90, "m1", "end_turn"))

    def send(self, how="auto", text="and the docs"):
        return pane.send(self.home, [], ".claude-work", SID, text, None, how, str(self.bin / "claude"))

    def calls(self):
        return [json.loads(l)["argv"] for l in self.log.read_text().splitlines()] if self.log.exists() else []

    def live(self, **kw):
        write(self.home / ".claude-work/sessions/30.json", session(SID, cwd=str(self.folder), **kw))

    def test_a_finished_chat_goes_on_in_the_background(self):
        answer = self.send()
        self.assertTrue(answer["ok"], answer)
        self.assertEqual((answer["how"], answer["message"]),
                         ("background", "Sent: the chat goes on with it in the background (1a2b3c4d)"))
        self.assertEqual(self.calls(), [["--bg", "--resume", SID, "and the docs"]])

    def test_a_background_session_stops_first(self):
        self.live(kind="bg", status="busy", jobId="bgjob1")
        write(self.home / ".claude-work/jobs/bgjob1/state.json", {"state": "working", "sessionId": SID})
        with mock.patch.object(cs, "stop_background", return_value=(True, "Stopped")) as stopped, \
                mock.patch.object(cs, "continue_chat", return_value={"ok": True, "id": "1a2b3c4d"}) as went_on:
            answer = self.send()
        self.assertEqual(answer["how"], "background")
        self.assertEqual(stopped.call_args[0][1], "bgjob1")
        self.assertEqual(went_on.call_args[1]["text"], "and the docs")

    def test_vscode(self):
        self.live(entrypoint="claude-vscode")
        answer = self.send(text="also: README")
        self.assertEqual(answer["how"], "vscode")
        self.assertTrue(answer["link"].startswith(
            f"vscode://anthropic.claude-code/open?session={SID}&prompt=also%3A%20README"), answer["link"])
        self.assertEqual(self.calls(), [])

    def test_tmux(self):
        self.live(tmux="main:1.%3")
        with mock.patch.object(pane, "tmux_type", return_value=(True, "")) as typed:
            self.assertEqual(self.send()["how"], "typed")
        self.assertEqual(typed.call_args[0][1], "and the docs")
        self.live(tmux="main:1.%3", status="waiting", waitingFor="permission prompt")
        answer = self.send()
        self.assertFalse(answer["ok"])  # (it would land in its dialog)
        self.assertIn("answer that first", answer["message"])

    def test_a_terminal_asks(self):
        self.live()
        self.assertEqual(self.send()["how"], "ask")
        with mock.patch.object(cs, "stop_chat", return_value=(True, "Stopped")) as stopped, \
                mock.patch.object(cs, "continue_chat", return_value={"ok": True}) as went_on:
            self.assertEqual(self.send("background")["how"], "background")
        stopped.assert_called_once()
        went_on.assert_called_once()
        self.live(status="busy")
        with mock.patch.object(cs, "stop_chat") as stopped:
            answer = self.send("background")
        self.assertIn("send it when this turn ends", answer["message"])
        stopped.assert_not_called()
        with mock.patch.object(pane, "copy_to_clipboard", return_value=True):
            self.assertEqual(self.send("copy")["how"], "copy")

    def test_after_the_turn(self):
        answer = self.cli("--send", SID, "--profile", ".claude-work", "--text", "next: docs", "--after-turn",
                          "--how", "background", "--session", SID, "--name", "Fix it")
        self.assertEqual(answer, {"ok": True, "message": "It's sent when this turn ends"})
        self.cli("--send", SID, "--profile", ".claude-work", "--text", "next: the docs", "--after-turn")
        (task,) = cs.queued_tasks(self.cache, int(time.time() * 1000))  # (one waits per chat)
        self.assertEqual((task["chat"], task["prompt"], task["afterTurn"], task["due"], task["how"]),
                         (SID, "next: the docs", True, False, "auto"))
        import jump
        with mock.patch.object(pane, "send", return_value={"ok": True, "how": "typed", "message": "Sent"}) as sent, \
                mock.patch.object(jump.cs, "cache_dir", return_value=self.cache), \
                mock.patch.object(jump, "claude_path", return_value="claude"):
            self.assertEqual(jump.start_queued(self.home, [], task["id"]), (True, "Sent"))
        self.assertEqual(sent.call_args[0][1:6], ([], ".claude-work", SID, "next: the docs", None))
        self.assertEqual(cs.load_queue(self.cache), [])


GIT_ENV = {"GIT_AUTHOR_NAME": "T", "GIT_AUTHOR_EMAIL": "t@example.org", "GIT_COMMITTER_NAME": "T",
           "GIT_COMMITTER_EMAIL": "t@example.org", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}


class ReviewTests(PaneFixture):
    def setUp(self):
        super().setUp()
        p = mock.patch.dict(os.environ, GIT_ENV)
        p.start()
        self.addCleanup(p.stop)
        self.git("init", "-q")
        write(self.folder / "a.py", "x = 1\ny = 2\n")
        write(self.folder / "other.py", "keep\n")
        self.git("add", ".")
        self.git("commit", "-qm", "start")
        # the chat: a.py edited (a backup of how it was), new.py made; other.py isn't the chat's
        write(self.home / f".claude-work/file-history/{SID}/aa11@v1", "x = 1\ny = 2\n")
        t = self.now - 100
        a, new = str(self.folder / "a.py"), str(self.folder / "new.py")
        self.chat(prompt("change x", t, cwd=str(self.folder)),
                  {"type": "file-history-delta", "trackingPath": a, "snapshotMessageId": "p",
                   "backup": {"backupFileName": "aa11@v1", "version": 1}, "sessionId": SID},
                  tool_use("e1", "Edit", {"file_path": a, "old_string": "x = 1", "new_string": "x = 3"}, t + 1),
                  tool_result("e1", t + 2),
                  {"type": "file-history-delta", "trackingPath": new, "snapshotMessageId": "p",
                   "backup": {"backupFileName": None, "version": 1}, "sessionId": SID},
                  tool_use("e2", "Write", {"file_path": new, "content": "z = 0\n"}, t + 3),
                  tool_result("e2", t + 4),
                  tool_use("t1", "Bash", {"command": "python3 -m pytest -q"}, t + 5),
                  tool_result("t1", t + 6),
                  {"type": "system", "subtype": "away_summary", "timestamp": iso(t + 7),
                   "content": "You changed x to 3 and added new.py."})
        write(self.folder / "a.py", "x = 3\ny = 2\n")
        write(self.folder / "new.py", "z = 0\n")
        write(self.folder / "other.py", "mine, not the chat's\n")

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.folder), *args], check=True, capture_output=True, text=True).stdout

    def test_review(self):
        r = self.cli("--review", SID)
        self.assertTrue(r["ok"], r)
        self.assertEqual([(f["label"], f["added"], f["removed"], f["created"]) for f in r["files"]],
                         [("a.py", 1, 1, False), ("new.py", 1, 0, True)])
        self.assertEqual(r["files"][0]["diff"][-3:], ["-x = 1", "+x = 3", " y = 2"])
        self.assertEqual((r["tests"]["command"], r["tests"]["ok"]), ("python3 -m pytest -q", True))
        self.assertEqual(r["repos"], [str(self.folder)])
        self.assertEqual(r["message"], "change x\n\nYou changed x to 3 and added new.py.")

    def test_undo(self):
        ok, message = pane.undo(self.home, [], SID, None, {str(self.folder / "new.py")})
        self.assertEqual((ok, message), (True, "Put back 1 file as before the chat"))
        self.assertFalse((self.folder / "new.py").exists())
        self.assertEqual(self.cli("--undo", SID)["message"], "Put back 1 file as before the chat")
        self.assertEqual((self.folder / "a.py").read_text(), "x = 1\ny = 2\n")
        self.assertEqual((self.folder / "other.py").read_text(), "mine, not the chat's\n")  # (not the chat's)

    def test_commit_only_its_files(self):
        answer = self.cli("--commit", SID, "--message", "Set x to 3\n\nAnd new.py.")
        self.assertTrue(answer["ok"], answer)
        self.assertRegex(answer["message"], r"^Committed 2 files in .*app \([0-9a-f]{7,}\)$")
        self.assertEqual(self.git("show", "--name-only", "--format=%s", "HEAD").split(),
                         ["Set", "x", "to", "3", "a.py", "new.py"])
        self.assertIn("other.py", self.git("status", "--porcelain"))  # yours stays as it was

    def test_marked_reviewed(self):
        since = cs.collect(self.home, self.cache, with_tokens=False, now=self.now)["reviewedSince"]
        self.assertEqual(since, int(self.now * 1000))  # (what chats changed before the first look isn't to review)
        self.cli("--reviewed", SID)
        self.assertGreater(cs.load_reviewed(self.cache)[SID], 0)
        self.assertIsNotNone(self.cli("--review", SID)["reviewedAt"])
        self.cli("--reviewed", SID, "--host", "gpu")  # (a host's chat: marked here)
        self.assertIn("gpu|" + SID, cs.load_reviewed(self.cache))
        self.cli("--reviewed", SID, "--off")
        self.assertEqual(cs.load_reviewed(self.cache)[SID], 0)  # not reviewed, however old its changes
        result = cs.collect(self.home, self.cache, with_tokens=False, now=self.now + 60)
        self.assertIn("gpu|" + SID, result["reviewed"])
        self.assertEqual(result["reviewedSince"], since)


class TestsAfterEditTests(PaneFixture):
    def test_tests_since_the_last_edit(self):
        t = self.now - 100
        a = str(self.folder / "a.py")
        self.chat(prompt("go", t, cwd=str(self.folder)),
                  tool_use("e1", "Edit", {"file_path": a, "old_string": "a", "new_string": "b"}, t + 1),
                  tool_result("e1", t + 2),
                  tool_use("t1", "Bash", {"command": "npm test"}, t + 3),
                  tool_result("t1", t + 4, error=True))
        cache = cs.TestsCache(self.cache / "tests.json")
        review = cache.review(self.transcript)
        self.assertEqual((review["tests"]["command"], review["tests"]["ok"]), ("npm test", False))
        # edited again since: no run counts
        with open(self.transcript, "a") as f:
            f.write(lines(tool_use("e2", "Edit", {"file_path": a, "old_string": "b", "new_string": "c"}, t + 5)))
        self.assertIsNone(cache.review(self.transcript)["tests"])
        with open(self.transcript, "a") as f:
            f.write(lines(tool_use("t2", "Bash", {"command": "cd app && npm test"}, t + 6), tool_result("t2", t + 7)))
        self.assertTrue(cache.review(self.transcript)["tests"]["ok"])
        cache.save()
        # read once: the next check reads only what was added
        again = cs.TestsCache(self.cache / "tests.json")
        with mock.patch.object(cs, "scan_tests", wraps=cs.scan_tests) as scanned:
            self.assertTrue(again.review(self.transcript)["tests"]["ok"])
        scanned.assert_not_called()

    def test_no_edits_no_review(self):
        self.chat(prompt("explain", self.now - 5), tool_use("t1", "Bash", {"command": "pytest"}, self.now - 4))
        self.assertIsNone(cs.TestsCache(self.cache / "tests.json").review(self.transcript))

    def test_what_counts_as_a_test_run(self):
        runs = ["python3 -I -m unittest discover -s tests 2>&1 | tail -3", "cd x && npm test", "make -C build test",
                "./gradlew test", "pytest -q tests/test_a.py", "node --test", "go test ./...", "bash run_tests.sh",
                "npm run check && npm test"]
        others = ['git commit -m "fix pytest run"', "python3 - <<'EOF'\nimport unittest\nEOF", "ls tests/",
                  "cargo build", 'echo "a \\" pytest"']
        self.assertEqual([c for c in runs if not cs.is_test_run(c)], [])
        self.assertEqual([c for c in others if cs.is_test_run(c)], [])


class RelayTests(PaneFixture):
    def test_on_and_off(self):
        shared = self.home / ".claude-shared/settings.json"
        mine = {"matcher": "Bash", "hooks": [{"type": "command", "command": "mine"}]}
        write(shared, {"model": "opus", "hooks": {
            "PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "guard"}]}],
            "PermissionRequest": [mine]}})
        (self.home / ".claude-work/settings.json").symlink_to(shared)
        self.assertEqual(pane.relay(self.home, [], True), (True, "Permission prompts can be answered from the widget"))
        self.assertTrue((self.home / ".claude-work/settings.json").is_symlink())  # (written through the link)
        groups = json.loads(shared.read_text())["hooks"]["PermissionRequest"]
        hook = self.home / ".local/share/claude-widget/permission-hook.py"
        self.assertEqual(groups[0], mine)
        self.assertEqual(groups[1]["hooks"][0], {"type": "command", "command": f"python3 -I {hook}",
                                                 "timeout": pane.HOOK_TIMEOUT_S})
        self.assertEqual(hook.read_text(), (CODE / "permission_hook.py").read_text())
        self.assertTrue(self.cli("--relay", "status")["on"])
        self.assertEqual(pane.relay(self.home, [], True)[1],
                         "Permission prompts can be answered from the widget (they could already)")
        pane.relay(self.home, [], False)
        data = json.loads(shared.read_text())
        self.assertEqual((data["hooks"]["PermissionRequest"], data["model"]), ([mine], "opus"))
        self.assertFalse(hook.exists())
        self.assertFalse(self.cli("--relay", "status")["some"])

    def test_on_a_host_it_gets_the_hook(self):
        with mock.patch("remote.host_answer", return_value={"ok": True, "message": "ok"}) as asked:
            self.cli("--relay", "on", "--host", "gpu")
        args = asked.call_args[0][1]
        self.assertEqual(args[:2], ["--relay", "on"])
        self.assertEqual(base64.b64decode(args[args.index("--hook-source") + 1]),
                         (CODE / "permission_hook.py").read_bytes())


if __name__ == "__main__":
    unittest.main()
