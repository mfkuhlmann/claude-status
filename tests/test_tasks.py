"""Recaps, permission modes, usage limits that stopped chats, plans, finding
chats and starting tasks (claude_status.py, jump.py, sharing.py, remote.py)."""
import contextlib
import importlib.util
import io
import json
import os
import shlex
import stat
import subprocess
import sys
import threading
import time
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True  # keep __pycache__ out of the plasmoid package
CODE = Path(__file__).resolve().parent.parent / "package/contents/code"
sys.path.insert(0, str(CODE))
spec = importlib.util.spec_from_file_location("jump_tasks", CODE / "jump.py")
jump = importlib.util.module_from_spec(spec)
spec.loader.exec_module(jump)
cs = jump.cs
sharing = jump.sharing

from test_claude_status import Fixture, iso, session, write  # noqa: E402


def lines(*entries):
    return "".join(json.dumps(e) + "\n" for e in entries)


def prompt(text, ts, **kw):
    return {"type": "user", "timestamp": iso(ts), "message": {"role": "user", "content": text}, **kw}


def reply(text, ts, msg_id="m1", **kw):
    return {"type": "assistant", "timestamp": iso(ts),
            "message": {"id": msg_id, "role": "assistant", "content": [{"type": "text", "text": text}],
                        "stop_reason": "end_turn"}, **kw}


def recap(text, ts):
    return {"type": "system", "subtype": "away_summary", "timestamp": iso(ts), "content": text}


def limit_error(text, ts):
    return {"type": "assistant", "timestamp": iso(ts), "isApiErrorMessage": True,
            "message": {"id": "err", "role": "assistant", "content": [{"type": "text", "text": text}],
                        "stop_reason": "stop_sequence"}}


class PeekTests(Fixture):
    def peek(self, *entries):
        path = self.home / ".claude-work/projects/-p/chat1.jsonl"
        write(path, lines(*entries))
        return cs.chat_peek(path)

    def test_recap_while_nothing_was_said_after_it(self):
        t = self.now - 600
        p = self.peek(prompt("fix it", t), reply("Fixed.", t + 10),
                      recap("You asked me to fix it; it's fixed. (disable recaps in /config)", t + 300))
        self.assertEqual(p["recap"], {"text": "You asked me to fix it; it's fixed.", "at": int((t + 300) * 1000)})
        # a prompt (or a reply) after it makes it old
        p = self.peek(prompt("fix it", t), reply("Fixed.", t + 10), recap("Old recap", t + 300),
                      prompt("and now?", t + 400))
        self.assertIsNone(p["recap"])
        p = self.peek(recap("Old recap", t), reply("More news", t + 10, msg_id="m2"))
        self.assertIsNone(p["recap"])

    def test_permission_mode_and_slug(self):
        t = self.now - 600
        p = self.peek({"type": "permission-mode", "permissionMode": "plan"},
                      prompt("plan it", t, permissionMode="plan", slug="happy-blue-fox"),
                      reply("Here's the plan.", t + 5, slug="happy-blue-fox"),
                      {"type": "permission-mode", "permissionMode": "acceptEdits"})
        self.assertEqual((p["mode"], p["slug"]), ("acceptEdits", "happy-blue-fox"))
        p = self.peek(prompt("hi", t, permissionMode="auto"), reply("Hello.", t + 5))
        self.assertEqual((p["mode"], p["slug"]), ("auto", None))
        # a slug that can't be a file name is no slug
        self.assertIsNone(self.peek(prompt("hi", t, slug="../x"), reply("Hi.", t + 1))["slug"])

    def test_what_stopped_it(self):
        t = self.now - 600
        p = self.peek(prompt("go on", t), limit_error("You've hit your session limit · resets 7:10pm (Europe/Berlin)", t + 2))
        self.assertEqual(p["stopped"], {"kind": "limit", "window": "five_hour", "at": int((t + 2) * 1000),
                                        "text": "You've hit your session limit · resets 7:10pm (Europe/Berlin)"})
        p = self.peek(prompt("go on", t), limit_error("You've hit your weekly limit · resets Oct 24, 9am", t + 2))
        self.assertEqual(p["stopped"]["window"], "seven_day")
        p = self.peek(prompt("go on", t), limit_error("You've reached your Fable limit.", t + 2))
        self.assertEqual(p["stopped"]["window"], "seven_day_overage_included")
        p = self.peek(prompt("go on", t), limit_error("You've hit your monthly spend limit.", t + 2))
        self.assertEqual((p["stopped"]["kind"], p["stopped"]["window"]), ("limit", None))
        p = self.peek(prompt("go on", t), limit_error("Login expired · Please run /login", t + 2))
        self.assertEqual(p["stopped"]["kind"], "login")
        # another API error, or a prompt after it: nothing stopped it
        self.assertIsNone(self.peek(prompt("go", t), limit_error("API Error: Connection lost", t + 2))["stopped"])
        self.assertIsNone(self.peek(prompt("go", t), limit_error("You've hit your session limit", t + 2),
                                    prompt("again", t + 3))["stopped"])

    def test_cached_peek_of_an_older_copy_is_read_again(self):
        path = self.home / ".claude-work/projects/-p/chat1.jsonl"
        t = self.now - 600
        write(path, lines(prompt("hi", t), reply("Hello.", t + 1), recap("You said hi.", t + 100)))
        st = path.stat()
        old = {"activity": "", "prompt": "hi", "reply": "Hello.", "replyLine": "Hello.", "at": 1}
        write(self.cache / "chats.json", {"version": cs.CHAT_CACHE_VERSION, "edits": {},
                                          "peeks": {cs.file_key(st): [st.st_size, st.st_mtime_ns, old]}})
        chats = cs.ChatCache(self.cache / "chats.json")
        self.assertEqual(chats.peek(path)["recap"]["text"], "You said hi.")
        # (an older copy keeps the new keys it doesn't know: no reading again)
        chats.save()
        self.assertEqual(cs.ChatCache(self.cache / "chats.json").peek(path)["recap"]["text"], "You said hi.")


class LimitStopTests(unittest.TestCase):
    NOW = 1_800_000_000_000

    def stop(self, at, window="five_hour", text="You've hit your session limit"):
        return {"kind": "limit", "window": window, "text": text, "at": at}

    def test_resets_with_its_window(self):
        limits = {"windows": [{"key": "five_hour", "reset": False, "resetsAt": self.NOW + 3600_000}]}
        s = cs.limit_stop(self.stop(self.NOW - 600_000), limits, self.NOW)
        self.assertEqual((s["resetsAt"], s["over"]), (self.NOW + 3600_000, False))
        # the window started (4 h ago) after the chat stopped: that limit is over
        s = cs.limit_stop(self.stop(self.NOW - 5 * 3600_000), limits, self.NOW)
        self.assertEqual((s["resetsAt"], s["over"]), (None, True))

    def test_a_window_past_its_reset(self):
        limits = {"windows": [{"key": "five_hour", "reset": True, "resetsAt": None, "endedAt": self.NOW - 60_000}]}
        self.assertTrue(cs.limit_stop(self.stop(self.NOW - 600_000), limits, self.NOW)["over"])
        # numbers from before the chat stopped say nothing about it: the time in its message does
        text = "You've hit your session limit · resets 7:10pm (Europe/Berlin)"
        at = int(datetime(2026, 10, 20, 15, 0).timestamp() * 1000)
        limits = {"windows": [{"key": "five_hour", "reset": True, "resetsAt": None, "endedAt": at - 3600_000}]}
        s = cs.limit_stop(self.stop(at, text=text), limits, at + 60_000)
        self.assertEqual((s["resetsAt"], s["over"]), (int(datetime(2026, 10, 20, 19, 10).timestamp() * 1000), False))

    def test_time_in_the_message(self):
        at = int(datetime(2026, 10, 20, 23, 0).timestamp() * 1000)
        self.assertEqual(cs.reset_from_text("… · resets 5:10am (Europe/Berlin)", at),
                         int(datetime(2026, 10, 21, 5, 10).timestamp() * 1000))
        self.assertEqual(cs.reset_from_text("resets 12am", at), int(datetime(2026, 10, 21, 0, 0).timestamp() * 1000))
        self.assertIsNone(cs.reset_from_text("You've hit your monthly spend limit.", at))
        s = cs.limit_stop(self.stop(at, window=None, text="resets 5:10am"), None,
                          int(datetime(2026, 10, 21, 6, 0).timestamp() * 1000))
        self.assertTrue(s["over"])

    def test_login_and_unknown_limits_dont_reset(self):
        s = cs.limit_stop({"kind": "login", "window": None, "text": "Login expired", "at": 1}, None, self.NOW)
        self.assertEqual((s["resetsAt"], s["over"]), (None, False))


class RowTests(Fixture):
    """The new fields of a listed chat (and a recent one): its plan, what stopped it."""

    def test_a_chat_stopped_by_the_limit_and_its_plan(self):
        w = self.home / ".claude-work"
        t = self.now - 1200
        write(w / "projects/-p/perso-idle-w.jsonl", "")
        write(w / "sessions/30.json", session("limited", cwd="/tmp/x"))
        write(w / "projects/-tmp-x/limited.jsonl",
              lines(prompt("plan it", t, slug="calm-red-owl", cwd="/tmp/x"),
                    reply("Planned.", t + 5, slug="calm-red-owl", cwd="/tmp/x"),
                    limit_error("You've hit your session limit · resets 7:10pm (Europe/Berlin)", t + 60)))
        write(w / "plans/calm-red-owl.md", "# Calm plan\n\n1. Do it\n")
        snap = self.cache / "statusline/.claude-work/limited.json"
        write(snap, {"session_id": "limited", "rate_limits": {
            "five_hour": {"used_percentage": 100, "resets_at": int(self.now + 1800)}}})
        g = self.group(self.collect(with_tokens=False), "work")
        row = next(s for s in g["sessions"] if s["sessionId"] == "limited")
        self.assertEqual(row["plan"]["title"], "Calm plan")
        self.assertEqual(row["plan"]["path"], str(w / "plans/calm-red-owl.md"))
        self.assertEqual((row["stopped"]["kind"], row["stopped"]["over"]), ("limit", False))
        self.assertEqual(row["stopped"]["resetsAt"], int(self.now + 1800) * 1000)
        # the account's plans, with the chat that made each
        plan = g["plans"][0]
        self.assertEqual((plan["slug"], plan["title"], plan["chatId"], plan["cwd"], plan["shared"]),
                         ("calm-red-owl", "Calm plan", "limited", "/tmp/x", False))

    def test_a_background_session_the_limit_blocked_waits_for_the_limit(self):
        # Claude marks it "blocked" ("rate limited — wait and retry"), as if it
        # needed you: it's stopped by the limit instead
        w = self.home / ".claude-work"
        sid = "e3de1242-7bc8-40a5-938f-aadb5f5aa9ee"
        write(w / "sessions/31.json", session(sid, kind="bg", jobId="e3de1242", cwd="/tmp/x"))
        write(w / "jobs/e3de1242/state.json", {
            "state": "blocked", "tempo": "blocked", "sessionId": sid, "cwd": "/tmp/x",
            "detail": "You've hit your session limit · resets 10:40am (Europe/Berlin)",
            "needs": "rate limited — wait and retry · You've hit your session limit · resets 10:40am (Europe/Berlin)"})
        write(w / f"projects/-tmp-x/{sid}.jsonl",
              lines(prompt("test", self.now - 60), limit_error("You've hit your session limit · resets 10:40am (Europe/Berlin)", self.now - 59)))
        g = self.group(self.collect(with_tokens=False), "work")
        row = next(s for s in g["sessions"] if s["sessionId"] == sid)
        self.assertEqual((row["state"], row["detail"], row["stopped"]["kind"]), ("idle", "", "limit"))
        # blocked on something else, it still needs you
        write(w / f"projects/-tmp-x/{sid}.jsonl", lines(prompt("test", self.now - 60)))
        row = next(s for s in self.group(self.collect(with_tokens=False), "work")["sessions"] if s["sessionId"] == sid)
        self.assertEqual((row["state"], row["stopped"]), ("waiting", None))

    def test_working_again_isnt_stopped(self):
        w = self.home / ".claude-work"
        write(w / "projects/-x/busy.jsonl", lines(limit_error("You've hit your session limit", self.now - 60)))
        g = self.group(self.collect(with_tokens=False), "work")
        self.assertIsNone(next(s for s in g["sessions"] if s["sessionId"] == "busy")["stopped"])

    def test_plans_newest_first_and_shared_once(self):
        w, p = self.home / ".claude-work", self.home / ".claude-personal"
        for i, slug in enumerate(["old-plan", "new-plan"]):
            write(w / f"plans/{slug}.md", f"# {slug}\n")
            os.utime(w / f"plans/{slug}.md", (self.now - 1000 + i, self.now - 1000 + i))
        write(w / "plans/not a slug.md", "# no\n")
        (p / "plans").mkdir(parents=True)
        os.link(w / "plans/new-plan.md", p / "plans/new-plan.md")
        r = self.collect(with_tokens=False)
        work = self.group(r, "work")
        self.assertEqual([(x["slug"], x["shared"]) for x in work["plans"]], [("new-plan", True), ("old-plan", False)])
        self.assertEqual([x["slug"] for x in self.group(r, "personal")["plans"]], ["new-plan"])
        self.assertEqual(self.collect(with_tokens=False, plans=1)["groups"][1]["plans"][0]["slug"], "new-plan")

    def test_slugs_are_read_from_what_was_appended(self):
        path = self.home / ".claude-work/projects/-p/chat7.jsonl"
        write(path, lines(prompt("plan it", self.now - 60, slug="calm-red-owl")))
        slugs = cs.SlugCache(self.cache / "plans.json")
        self.assertEqual(slugs.slug(path, path.stat()), "calm-red-owl")
        reads = []
        real = cs.transcript_slug
        with mock.patch.object(cs, "transcript_slug", lambda p, size, start=0: reads.append(start) or real(p, size, start)):
            with open(path, "a") as f:
                f.write(lines(reply("Planned.", self.now - 50)))   # no slug in what came: it keeps its own
            self.assertEqual(slugs.slug(path, path.stat()), "calm-red-owl")
            size = path.stat().st_size
            self.assertEqual(slugs.slug(path, path.stat()), "calm-red-owl")   # unchanged: nothing read
        self.assertEqual(reads, [size - len(lines(reply("Planned.", self.now - 50)))])
        slugs.save()
        self.assertEqual(cs.SlugCache(self.cache / "plans.json").slug(path, path.stat()), "calm-red-owl")

    def test_recent_chats_carry_their_recap(self):
        w = self.home / ".claude-work"
        t = self.now - 3600
        write(w / "projects/-r/oldchat.jsonl", lines(prompt("tidy up", t, cwd="/r"), reply("Tidied.", t + 5, cwd="/r"),
                                                    recap("You asked me to tidy up; done.", t + 100)))
        recent = self.group(self.collect(with_tokens=False), "work")["recent"]
        chat = next(c for c in recent if c["sessionId"] == "oldchat")
        self.assertEqual((chat["recap"]["text"], chat["stopped"]), ("You asked me to tidy up; done.", None))

    def test_trusted_folders(self):
        w = self.home / ".claude-work"
        repo = self.home / "repos/app"
        (repo / ".git").mkdir(parents=True)
        (repo / "sub").mkdir()
        other = self.home / "notes/a"
        other.mkdir(parents=True)
        data = json.loads((w / ".claude.json").read_text())
        data["projects"] = {str(self.home / "repos"): {"hasTrustDialogAccepted": True},
                            str(self.home / "notes"): {"hasTrustDialogAccepted": True}}
        write(w / ".claude.json", data)
        profile = next(p for p in cs.discover_profiles(self.home) if p.label == "work")
        # Claude looks up the folders above, but not past a git repository's root
        self.assertTrue(cs.folder_trusted(profile, str(other), self.home))
        self.assertFalse(cs.folder_trusted(profile, str(repo / "sub"), self.home))
        data["projects"][str(repo)] = {"hasTrustDialogAccepted": True}
        write(w / ".claude.json", data)
        self.assertTrue(cs.folder_trusted(profile, str(repo / "sub"), self.home))
        # Claude never keeps trusting the home folder (an old record of it doesn't count)
        data["projects"][str(self.home)] = {"hasTrustDialogAccepted": True}
        write(w / ".claude.json", data)
        self.assertFalse(cs.folder_trusted(profile, str(self.home), self.home))


class FindTests(Fixture):
    def setUp(self):
        super().setUp()
        w, p = self.home / ".claude-work", self.home / ".claude-personal"
        t = self.now - 7200
        write(w / "projects/-a/aaa.jsonl", lines(prompt("refactor the parser", t, cwd="/srv/app"),
                                                 reply("Done.", t + 1, cwd="/srv/app"),
                                                 {"type": "ai-title", "aiTitle": "Parser cleanup"}))
        write(w / "projects/-b/bbb.jsonl", lines(prompt("write docs", t + 10, cwd="/srv/docs"),
                                                 reply("Done.", t + 11, cwd="/srv/docs")))
        write(w / "history.jsonl", lines({"display": "write docs", "sessionId": "bbb", "timestamp": (t + 10) * 1000},
                                         {"display": "and mention the PARSER flags", "sessionId": "bbb",
                                          "timestamp": (t + 20) * 1000}))
        os.utime(w / "projects/-b/bbb.jsonl", (t + 30, t + 30))
        os.utime(w / "projects/-a/aaa.jsonl", (t + 5, t + 5))
        # a chat shared with personal, used there last
        write(w / "projects/-c/ccc.jsonl", lines(prompt("parser tests", t, cwd="/srv/app"), reply("Ok.", t + 1, cwd="/srv/app")))
        (p / "projects/-c").mkdir(parents=True)
        os.link(w / "projects/-c/ccc.jsonl", p / "projects/-c/ccc.jsonl")
        write(p / "history.jsonl", lines({"display": "parser tests", "sessionId": "ccc", "timestamp": (t + 40) * 1000}))
        os.utime(w / "projects/-c/ccc.jsonl", (t, t))

    def find(self, query, limit=30):
        return cs.find_chats(self.home, self.cache, [], query, limit)

    def test_every_word_in_name_folder_or_prompts(self):
        found = self.find("parser")
        self.assertEqual([c["sessionId"] for c in found["results"]], ["bbb", "aaa", "ccc"])
        docs = found["results"][0]
        self.assertEqual((docs["name"], docs["account"], docs["match"]),
                         ("write docs", "work · Team", "and mention the PARSER flags"))
        self.assertEqual(found["results"][1]["name"], "Parser cleanup")
        self.assertEqual([c["sessionId"] for c in self.find("PARSER srv/app")["results"]], ["aaa", "ccc"])
        self.assertEqual(self.find("nothing like this")["results"], [])
        self.assertEqual(self.find("   ")["results"], [])

    def test_a_shared_chat_once_on_the_account_it_was_used_on_last(self):
        ccc = [c for c in self.find("tests")["results"] if c["sessionId"] == "ccc"]
        self.assertEqual([(c["profileDir"], c["shared"]) for c in ccc], [(".claude-personal", True)])
        with open(self.home / ".claude-work/history.jsonl", "a") as f:   # then used on work
            f.write(lines({"display": "more parser tests", "sessionId": "ccc", "timestamp": (self.now - 60) * 1000}))
        ccc = [c for c in self.find("tests")["results"] if c["sessionId"] == "ccc"]
        self.assertEqual([(c["profileDir"], c["account"]) for c in ccc], [(".claude-work", "work · Team")])

    def test_a_chat_and_its_copies_once(self):
        w = self.home / ".claude-work"
        t = self.now - 7200
        start = dict(prompt("refactor the parser", t, cwd="/srv/app"), uuid="u-first")
        write(w / "projects/-a/fork.jsonl", lines(start, reply("Forked.", t + 50, cwd="/srv/app")))
        os.utime(w / "projects/-a/fork.jsonl", (t + 60, t + 60))
        write(w / "projects/-a/aaa.jsonl", lines(start, reply("Done.", t + 1, cwd="/srv/app"),
                                                 {"type": "ai-title", "aiTitle": "Parser cleanup"}))
        os.utime(w / "projects/-a/aaa.jsonl", (t + 5, t + 5))
        self.assertEqual([c["sessionId"] for c in self.find("refactor")["results"]], ["fork"])

    def test_limit(self):
        found = self.find("parser", limit=2)
        self.assertEqual((len(found["results"]), found["more"]), (2, True))

    def test_command_line(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), mock.patch.object(cs.Path, "home", return_value=self.home), \
                mock.patch.object(cs, "cache_dir", return_value=self.cache):
            cs.main(["--find", "docs", "--remote"])
        answer = json.loads(out.getvalue().split(cs.REMOTE_MARK)[1])
        self.assertEqual([c["sessionId"] for c in answer["results"]], ["bbb"])
        self.assertIn("--resume bbb", answer["results"][0]["openCommand"])


FAKE_CLAUDE = """#!{python}
import json, os, sys
with open({log!r}, "a") as f:
    f.write(json.dumps({{"argv": sys.argv[1:], "cwd": os.getcwd(),
                         "config": os.environ.get("CLAUDE_CONFIG_DIR"),
                         "session": os.environ.get("CLAUDECODE"),
                         "noAgentView": os.environ.get("CLAUDE_CODE_DISABLE_AGENT_VIEW")}}) + "\\n")
if "--bg" in sys.argv:  # (what Claude Code 2.1.306 prints)
    print("backgrounded · 1a2b3c4d\\n  claude agents             list sessions\\n"
          "  claude attach 1a2b3c4d    open in this terminal\\n  claude stop 1a2b3c4d      stop this session")
"""


class TaskTests(Fixture):
    def setUp(self):
        super().setUp()
        self.bin = self.home / "bin"
        self.log = self.home / "claude.log"
        write(self.bin / "claude", FAKE_CLAUDE.format(python=sys.executable, log=str(self.log)))
        (self.bin / "claude").chmod(0o755)
        self.folder = self.home / "repos/app"
        self.folder.mkdir(parents=True)
        w = self.home / ".claude-work"
        data = json.loads((w / ".claude.json").read_text())
        data["projects"] = {str(self.folder): {"hasTrustDialogAccepted": True}}
        write(w / ".claude.json", data)
        write(w / "plans/calm-red-owl.md", "# Calm plan\n\n1. Do it\n")
        self.profile = next(p for p in cs.discover_profiles(self.home) if p.label == "work")

    def calls(self):
        return [json.loads(l) for l in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_prompt_with_a_plan(self):
        text = cs.task_prompt("Do step 1 only.", self.home / ".claude-work/plans/calm-red-owl.md", self.home)
        self.assertEqual(text, "Do step 1 only.\n\nThe plan (saved as ~/.claude-work/plans/calm-red-owl.md):\n\n"
                               "# Calm plan\n\n1. Do it\n")
        self.assertTrue(cs.task_prompt("", self.home / ".claude-work/plans/calm-red-owl.md", self.home)
                        .startswith("Implement this plan.\n"))

    def test_background(self):
        with mock.patch.dict(os.environ, {"CLAUDECODE": "1", "CLAUDE_CODE_DISABLE_AGENT_VIEW": "1"}):
            ok, message, job = cs.start_background(self.profile, str(self.folder), "--fix the tests",
                                                   self.home, str(self.bin / "claude"))
        self.assertEqual((ok, job), (True, "1a2b3c4d"), message)
        call, = self.calls()
        # a prompt that looks like an option stays the prompt; the account's
        # folder by name; not as part of this session
        self.assertEqual(call["argv"], ["--bg", " --fix the tests"])
        self.assertEqual((call["cwd"], call["config"], call["session"]),
                         (str(self.folder), str((self.home / ".claude-work").resolve()), None))
        self.assertIsNone(call["noAgentView"])   # (Claude refuses --bg with it)

    def test_background_needs_a_trusted_folder(self):
        for folder in (str(self.home), str(self.home / "repos")):
            ok, message, _ = cs.start_background(self.profile, folder, "go", self.home, str(self.bin / "claude"))
            self.assertFalse(ok)
            self.assertIn("doesn't trust", message)
        self.assertEqual(self.calls(), [])

    def test_background_reports_claudes_refusal(self):
        write(self.bin / "claude", f"#!{sys.executable}\nimport sys\nprint('Workspace not trusted.', file=sys.stderr)\nsys.exit(1)\n")
        ok, message, _ = cs.start_background(self.profile, str(self.folder), "go", self.home, str(self.bin / "claude"))
        self.assertEqual((ok, message), (False, "Workspace not trusted."))

    def test_terminal_command(self):
        answer = cs.run_task(self.home, [], False, str(self.folder), ".claude-work", "go on", "calm-red-owl",
                             claude="claude")
        self.assertTrue(answer["ok"])
        words = shlex.split(answer["command"])
        self.assertEqual(words[:3], ["cd", str(self.folder), "2>/dev/null;"])
        self.assertIn("CLAUDE_CODE_DISABLE_AGENT_VIEW=1", words)
        self.assertTrue(words[-1].startswith("go on\n\nThe plan (saved as ~/.claude-work/plans/calm-red-owl.md)"))
        gone = cs.run_task(self.home, [], False, str(self.folder), ".claude-work", "", "no-such-plan", claude="claude")
        self.assertEqual(gone, {"ok": False, "message": "That plan isn't there any more"})

    def test_jump_new_chat_with_a_task(self):
        opened = []
        out = io.StringIO()
        prefixes = []
        with mock.patch.object(jump, "open_terminal", lambda cwd, command: opened.append((cwd, command)) or True), \
                mock.patch.object(jump, "scope_prefix", lambda name: prefixes.append(name) or []), \
                mock.patch.object(jump, "claude_in_terminal", return_value="claude"), \
                mock.patch.object(jump, "claude_path", return_value=str(self.bin / "claude")), \
                mock.patch.object(jump.Path, "home", return_value=self.home), contextlib.redirect_stdout(out):
            jump.main(["--new-chat", ".claude-work", "--cwd", str(self.folder), "--prompt", "write tests"])
            jump.main(["--new-chat", ".claude-work", "--cwd", str(self.folder), "--plan", "calm-red-owl", "--bg"])
            jump.main(["--new-chat", ".claude-work", "--cwd", str(self.folder), "--plan", "gone", "--bg"])
        answers = [json.loads(l) for l in out.getvalue().splitlines()]
        self.assertEqual([a["ok"] for a in answers], [True, True, False])
        self.assertEqual(answers[2]["message"], "That plan isn't there any more")
        (cwd, command), = opened
        self.assertEqual(cwd, str(self.folder))
        self.assertEqual(shlex.split(command)[-1], "write tests")
        call, = self.calls()
        self.assertTrue(call["argv"][1].startswith("Implement this plan.\n\nThe plan (saved as"))
        self.assertEqual(prefixes, ["claude"])   # in a systemd scope of its own (the service may start with it)
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            jump.main(["--new-chat", ".claude-work", "--bg", "--vscode", "--prompt", "x"])

    def test_vscode_link_types_the_task_in(self):
        link = jump.vscode_task_link("fix it & ship")
        self.assertEqual(link, "vscode://anthropic.claude-code/open?prompt=fix+it+%26+ship")
        self.assertEqual(jump.vscode_task_link(""), "vscode://anthropic.claude-code/open")


class PlanSharingTests(Fixture):
    def setUp(self):
        super().setUp()
        self.w, self.p = self.home / ".claude-work", self.home / ".claude-personal"
        write(self.w / "plans/calm-red-owl.md", "# Calm plan\n")
        self.profiles = cs.discover_profiles(self.home)
        self.work = sharing.named(self.profiles, ".claude-work")
        self.personal = sharing.named(self.profiles, ".claude-personal")

    def test_share_and_keep_only(self):
        ok, message = sharing.plan_sharing(self.profiles, "calm-red-owl", ".claude-work", True, ".claude-personal")
        self.assertTrue(ok, message)
        self.assertTrue(os.path.samefile(self.w / "plans/calm-red-owl.md", self.p / "plans/calm-red-owl.md"))
        self.assertFalse((self.home / ".claude/plans/calm-red-owl.md").exists())
        # a change on one is a change on both (Claude writes plans in place)
        with open(self.p / "plans/calm-red-owl.md", "a") as f:
            f.write("2. More\n")
        self.assertIn("2. More", (self.w / "plans/calm-red-owl.md").read_text())
        ok, message = sharing.plan_sharing(self.profiles, "calm-red-owl", ".claude-personal", False)
        self.assertTrue(ok, message)
        self.assertEqual((self.w / "plans/calm-red-owl.md").exists(), False)
        self.assertTrue((self.p / "plans/calm-red-owl.md").exists())
        self.assertEqual(sharing.plan_sharing(self.profiles, "calm-red-owl", ".claude-personal", False),
                         (False, "This plan isn't shared"))

    def test_another_plan_of_that_name_stays(self):
        write(self.p / "plans/calm-red-owl.md", "# Another\n")
        ok, message = sharing.plan_sharing(self.profiles, "calm-red-owl", ".claude-work", True, ".claude-personal")
        self.assertFalse(ok)
        self.assertIn("another plan of that name", message)
        self.assertEqual((self.p / "plans/calm-red-owl.md").read_text(), "# Another\n")

    def test_a_shared_chat_takes_its_plan_along(self):
        write(self.w / "projects/-p/chat9.jsonl", lines(prompt("plan", self.now - 60, slug="calm-red-owl")))
        target, there = sharing.give_to(self.profiles, "chat9", ".claude-personal", sharing.store_root(self.home))
        self.assertIsNotNone(target, there)
        self.assertTrue(os.path.samefile(self.w / "plans/calm-red-owl.md", self.p / "plans/calm-red-owl.md"))

    def test_jump_command_line(self):
        out = io.StringIO()
        with mock.patch.object(jump.Path, "home", return_value=self.home), contextlib.redirect_stdout(out):
            jump.main(["--share-plan", "calm-red-owl", "--profile", ".claude-work"])
        self.assertTrue(json.loads(out.getvalue())["ok"])
        self.assertTrue((self.home / ".claude/plans/calm-red-owl.md").exists())


class HandoverTests(Fixture):
    """Continuing a chat a usage limit stopped on another account: an idle
    session that has it open quits first; one in VS Code isn't touched."""

    def test_vscode_and_busy_sessions_stay(self):
        w = self.home / ".claude-work"
        write(w / "sessions/40.json", session("in-vscode", entrypoint="claude-vscode"))
        ok, message = cs.end_for_handover(self.home, cs.discover_profiles(self.home), "in-vscode")
        self.assertEqual((ok, message), (False, "It's open in VS Code's Claude: close its tab there first"))
        ok, message = cs.end_for_handover(self.home, cs.discover_profiles(self.home), "busy")
        self.assertEqual((ok, message), (False, "It's at work again, so it stays where it is"))
        self.assertEqual(cs.end_for_handover(self.home, cs.discover_profiles(self.home), "nobody"),
                         (True, "Nothing had it open"))

    def test_an_idle_chat_in_a_terminal_quits(self):
        proc = subprocess.Popen([sys.executable, "-c", "import time; print('ready', flush=True); time.sleep(60)"],
                                stdout=subprocess.PIPE, text=True)
        self.addCleanup(proc.stdout.close)
        self.addCleanup(lambda: (proc.kill(), proc.wait()) if proc.poll() is None else None)
        self.assertEqual(proc.stdout.readline().strip(), "ready")
        w = self.home / ".claude-work"
        write(w / f"sessions/{proc.pid}.json", session("limited", pid=proc.pid, procStart=cs.proc_start_time(proc.pid)))
        write(w / "projects/-p/limited.jsonl", lines(prompt("go", self.now - 60)))
        # (its parent here reaps it once it quits, as a terminal's shell does)
        reaper = threading.Thread(target=proc.wait)
        reaper.start()
        self.addCleanup(reaper.join, 10)
        target, there = sharing.give_to(cs.discover_profiles(self.home), "limited", ".claude-personal",
                                        sharing.store_root(self.home), end_first=True, home=self.home)
        self.assertEqual(proc.wait(timeout=5), -15)
        self.assertIsNotNone(target, there)
        self.assertTrue((self.home / ".claude-personal/projects/-p/limited.jsonl").exists())


if __name__ == "__main__":
    unittest.main()


class QueueTests(TaskTests):
    """Background tasks that wait for a usage limit to reset."""

    def queue(self, *args):
        out = io.StringIO()
        with mock.patch.object(jump.Path, "home", return_value=self.home), \
                mock.patch.object(jump, "claude_path", return_value=str(self.bin / "claude")), \
                mock.patch.object(jump, "scope_prefix", return_value=[]), contextlib.redirect_stdout(out):
            jump.main(list(args))
        return json.loads(out.getvalue())

    def test_queue_then_start_once(self):
        at = int((time.time() + 3600) * 1000)
        answer = self.queue("--queue", ".claude-work", "--cwd", str(self.folder), "--at", str(at), "--prompt", "fix it",
                            "--plan", "calm-red-owl", "--plan-profile", ".claude-work", "--account", "work · Team")
        self.assertTrue(answer["ok"], answer)
        self.assertRegex(answer["message"], r"^Queued: it starts at \d\d:\d\d, when the limit resets$")
        (task,) = cs.queued_tasks(self.cache_root(), int(time.time() * 1000))
        self.assertEqual((task["prompt"], task["plan"], task["planTitle"], task["account"], task["due"]),
                         ("fix it", "calm-red-owl", "Calm plan", "work · Team", False))
        self.assertTrue(cs.queued_tasks(self.cache_root(), at + 1)[0]["due"])
        # the status lists it
        status = cs.collect(self.home, self.cache_root(), with_tokens=False, now=self.now)
        self.assertEqual([t["id"] for t in status["queue"]], [task["id"]])
        # starting it takes it out of the queue: a second copy starts nothing
        self.assertEqual(self.queue("--start-queued", task["id"]), {"ok": True, "message": "Started in the background on work (1a2b3c4d)"})
        self.assertEqual(self.queue("--start-queued", task["id"]), {"ok": True, "message": ""})
        call, = self.calls()
        self.assertEqual(call["argv"][0], "--bg")
        self.assertTrue(call["argv"][1].startswith("fix it\n\nThe plan (saved as"))
        self.assertEqual(cs.load_queue(self.cache_root()), [])

    def cache_root(self):
        return cs.cache_dir(self.home)

    def test_a_task_that_fails_to_start_stays_with_the_error(self):
        at = int(time.time() * 1000)
        self.assertTrue(self.queue("--queue", ".claude-work", "--cwd", str(self.folder), "--at", str(at), "--prompt", "go")["ok"])
        (task,) = cs.load_queue(self.cache_root())
        write(self.bin / "claude", f"#!{sys.executable}\nimport sys\nprint('Workspace not trusted.', file=sys.stderr)\nsys.exit(1)\n")
        self.assertEqual(self.queue("--start-queued", task["id"]), {"ok": False, "message": "Workspace not trusted."})
        (back,) = cs.queued_tasks(self.cache_root(), at + 1)
        self.assertEqual((back["id"], back["error"], back["due"]), (task["id"], "Workspace not trusted.", False))
        self.assertEqual(self.queue("--unqueue", task["id"]), {"ok": True, "message": "Cancelled the queued task"})
        self.assertEqual(cs.load_queue(self.cache_root()), [])

    def test_only_trusted_folders_and_a_task(self):
        at = str(int(time.time() * 1000))
        self.assertIn("doesn't trust", self.queue("--queue", ".claude-work", "--cwd", str(self.home), "--at", at, "--prompt", "x")["message"])
        self.assertEqual(self.queue("--queue", ".claude-work", "--cwd", str(self.folder), "--at", at),
                         {"ok": False, "message": "Write what Claude should do first"})
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            self.queue("--queue", ".claude-work", "--cwd", str(self.folder), "--prompt", "x")  # no time
        # an SSH host's task: checked there when it starts
        self.assertTrue(self.queue("--queue", ".claude", "--cwd", "/srv/app", "--at", at, "--prompt", "x", "--host", "lab")["ok"])
        self.assertEqual(cs.load_queue(self.cache_root())[0]["host"], "lab")


class ContinueAfterResetTests(TaskTests):
    """A chat a usage limit stopped, queued to go on once the limit resets."""

    SID = "e3de1242-7bc8-40a5-938f-aadb5f5aa9ee"
    queue, cache_root = QueueTests.queue, QueueTests.cache_root

    def stopped_chat(self, *more):
        t = self.now - 120
        write(self.home / f".claude-work/projects/-repos-app/{self.SID}.jsonl",
              lines(prompt("fix it", t, cwd=str(self.folder)),
                    limit_error("You've hit your session limit · resets 10:40am (Europe/Berlin)", t + 1), *more))

    def test_queue_then_go_on_in_the_background(self):
        self.stopped_chat()
        at = int((time.time() + 3600) * 1000)
        answer = self.queue("--queue-continue", self.SID, "--profile", ".claude-work", "--at", str(at),
                            "--name", "Fix it", "--account", "work · Team")
        self.assertTrue(answer["ok"], answer)
        self.assertRegex(answer["message"], r"^Queued: it goes on at \d\d:\d\d, when the limit resets$")
        self.assertTrue(self.queue("--queue-continue", self.SID, "--profile", ".claude-work", "--at", str(at),
                                   "--name", "Fix it", "--account", "work · Team")["ok"])  # (twice: queued once)
        (task,) = cs.queued_tasks(self.cache_root(), int(time.time() * 1000))
        self.assertEqual((task["chat"], task["name"], task["folder"], task["prompt"], task["account"]),
                         (self.SID, "Fix it", str(self.folder), "", "work · Team"))
        self.assertEqual(self.queue("--start-queued", task["id"]),
                         {"ok": True, "message": "Went on in the background on work (1a2b3c4d)"})
        call, = self.calls()
        self.assertEqual(call["argv"], ["--bg", "--resume", self.SID, cs.CONTINUE_PROMPT])
        self.assertEqual(call["cwd"], str(self.folder))
        self.assertEqual(cs.load_queue(self.cache_root()), [])

    def test_a_chat_that_went_on_already_is_left_alone(self):
        self.stopped_chat(reply("Done.", self.now - 10))
        at = int(time.time() * 1000)
        self.assertTrue(self.queue("--queue-continue", self.SID, "--profile", ".claude-work", "--at", str(at),
                                   "--prompt", "go on with step 2")["ok"])
        (task,) = cs.load_queue(self.cache_root())
        self.assertEqual(self.queue("--start-queued", task["id"]), {"ok": True, "message": ""})
        self.assertEqual((self.calls(), cs.load_queue(self.cache_root())), ([], []))

    def test_a_session_that_still_has_it_open_is_stopped_first(self):
        self.stopped_chat()
        stops = []
        with mock.patch.object(cs, "stop_background", side_effect=lambda *a, **k: stops.append(a[1]) or (True, "stopped")), \
                mock.patch.object(cs, "live_entries_all", return_value=[]) as live:
            live.side_effect = [[({"sessionId": self.SID, "kind": "bg", "jobId": "e3de1242", "status": "idle"},
                                  self.profile, self.profile)], []]
            answer = cs.continue_chat(self.home, [], ".claude-work", self.SID, None, "", str(self.bin / "claude"))
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(stops, ["e3de1242"])
        self.assertEqual(self.calls()[0]["argv"][:3], ["--bg", "--resume", self.SID])

    def test_its_folder_must_be_trusted_and_ssh_hosts_go_through_ssh(self):
        t = self.now - 120
        write(self.home / f".claude-work/projects/-home/{self.SID}.jsonl",
              lines(prompt("hi", t, cwd=str(self.home)), limit_error("You've hit your session limit", t + 1)))
        at = str(int(time.time() * 1000))
        answer = self.queue("--queue-continue", self.SID, "--profile", ".claude-work", "--at", at)
        self.assertFalse(answer["ok"])
        self.assertIn("Claude doesn't trust your home folder", answer["message"])
        self.assertEqual(self.queue("--queue-continue", "nope", "--profile", ".claude-work", "--at", at),
                         {"ok": False, "message": "That chat isn't on this account any more"})
        # on an SSH host: checked there, when it goes on
        self.assertTrue(self.queue("--queue-continue", self.SID, "--profile", ".claude", "--at", at, "--cwd", "/srv/app",
                                   "--host", "lab", "--name", "Fix it")["ok"])
        (task,) = cs.load_queue(self.cache_root())
        import remote
        with mock.patch.object(remote, "host_answer", return_value={"ok": True, "message": "Went on in the background on work (1a2b3c4d)"}) as ask:
            self.assertEqual(self.queue("--start-queued", task["id"])["message"], "Went on in the background on work (1a2b3c4d)")
        ask.assert_called_once_with("lab", ["--continue-chat", self.SID, "--profile", ".claude", "--folder", "/srv/app"])

    def test_queue_in_a_folder_picked_in_the_dialog(self):
        at = str(int((time.time() + 3600) * 1000))
        with mock.patch.object(jump, "choose_folder", return_value=(str(self.folder), "")), \
                mock.patch.object(jump, "claude_in_terminal", return_value="claude"):
            answer = self.queue("--queue", ".claude-work", "--choose-folder", "--at", at, "--prompt", "fix it")
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(cs.load_queue(self.cache_root())[0]["folder"], str(self.folder))
        with mock.patch.object(jump, "choose_folder", return_value=(None, "")), \
                mock.patch.object(jump, "claude_in_terminal", return_value="claude"):
            self.assertEqual(self.queue("--queue", ".claude-work", "--choose-folder", "--at", at, "--prompt", "x"),
                             {"ok": True, "message": ""})  # (cancelled)
        self.assertEqual(len(cs.load_queue(self.cache_root())), 1)


class OverlapTests(Fixture):
    def test_two_chats_with_a_process_that_changed_the_same_files(self):
        rows = [{"key": k, "name": k.upper(), "sessionId": k, "chatId": k, "profileDir": ".claude-work", "pid": pid,
                 "cwd": "/srv/app", "overlaps": None} for k, pid in (("a", 1), ("b", 2), ("c", None), ("d", 4))]
        rows[3]["chatId"] = "a"   # the same chat listed twice
        changed = {"a": {"/srv/app/x.py", "/srv/app/y.py"}, "b": {"/srv/app/y.py", "/home/me/z.md"},
                   "c": {"/srv/app/x.py"}, "d": {"/srv/app/x.py"}}
        cs.note_overlaps([{"sessions": rows}], changed, Path("/home/me"))
        a, b, c, d = rows
        self.assertEqual(a["overlaps"], [{"key": "b", "name": "B", "sessionId": "b", "profileDir": ".claude-work",
                                          "count": 1, "files": ["y.py"]}])
        self.assertEqual([o["key"] for o in b["overlaps"]], ["a"])
        self.assertEqual((c["overlaps"], d["overlaps"]), (None, None))  # no process; the same chat

    def test_rows_get_them_from_what_the_chats_changed(self):
        w = self.home / ".claude-work"
        write(w / "sessions/50.json", session("one", cwd="/srv/app"))
        write(w / "sessions/51.json", session("two", cwd="/srv/app"))
        edit = lambda f: {"type": "assistant", "timestamp": iso(self.now - 30), "message": {"id": "m" + f, "role": "assistant",
                          "content": [{"type": "tool_use", "id": "t" + f, "name": "Edit", "input": {"file_path": f}}]}}
        write(w / "projects/-srv-app/one.jsonl", lines(prompt("go", self.now - 60), edit("/srv/app/x.py")))
        write(w / "projects/-srv-app/two.jsonl", lines(prompt("go", self.now - 60), edit("/srv/app/x.py")))
        rows = {s["sessionId"]: s for s in self.group(self.collect(with_tokens=False), "work")["sessions"]}
        self.assertEqual([(o["name"], o["files"]) for o in rows["one"]["overlaps"]], [(rows["two"]["name"], ["x.py"])])


class MarkdownTests(Fixture):
    def open(self, app, which=("okular", "xdg-open", "code")):
        started = []
        if app:
            write(self.cache / "claude-widget/settings.json", {"at": 1, "by": "x", "values": {"markdownApp": app}})
        path = self.home / "run.md"
        write(path, "# Run\n\nDone.\n")
        self.cache.mkdir(parents=True, exist_ok=True)
        with mock.patch.object(jump, "start_app", lambda args, cwd=None: started.append(args)), \
                mock.patch.object(jump.cs, "cache_dir", return_value=self.cache / "claude-widget"), \
                mock.patch.object(jump.shutil, "which", lambda n: f"/usr/bin/{n}" if n in which else None), \
                mock.patch.object(jump.cs, "vscode_app", return_value=("/usr/bin/code", "Code") if "code" in which else (None, None)), \
                mock.patch.object(jump, "status_extension_since", return_value=True), \
                mock.patch.object(jump, "runs_folder", return_value=self.cache):
            return jump.open_markdown(path, self.home), started

    def test_okular_where_installed_else_a_page_in_the_browser(self):
        self.assertEqual(self.open(None)[1], [["/usr/bin/okular", str(self.home / "run.md")]])
        (ok, _), started = self.open(None, which=("xdg-open",))
        self.assertTrue(ok)
        self.assertEqual(started, [["/usr/bin/xdg-open", str(self.cache / "run.html")]])
        self.assertIn("<h1>Run</h1>", (self.cache / "run.html").read_text())
        self.assertEqual(self.open("okular", which=("xdg-open",))[1][0][1], str(self.cache / "run.html"))
        self.assertEqual(self.open("browser")[1][0][1], str(self.cache / "run.html"))
        self.assertEqual(self.open("default")[1], [["/usr/bin/xdg-open", str(self.home / "run.md")]])
        self.assertTrue(self.open("vscode")[1][0][1].startswith("vscode://wzaielamri.claude-status/markdown?path="))
        self.assertEqual(self.open("auto", which=())[0][0], False)  # nothing to show it with

    def test_the_page_loads_nothing_and_runs_nothing(self):
        import markdown_page as mp
        page = mp.page("# T\n\n<script>alert(1)</script> [x](javascript:alert(1)) [y](https://example.com/a?b=1&c=2)\n\n"
                       "![pic](https://example.com/p.png)\n\n| a | b |\n|---|---|\n| 1 | `|` |\n\n- [x] done\n- [ ] todo\n"
                       "  1. nested\n\n```py\n<b>code</b>\n```\n")
        self.assertNotIn("<script>", page)
        self.assertIn("&lt;script&gt;", page)
        self.assertNotIn('href="javascript', page)
        self.assertIn('<a href="https://example.com/a?b=1&amp;c=2" rel="noreferrer noopener">y</a>', page)
        self.assertNotIn("<img", page)
        self.assertIn("[image: pic]", page)
        self.assertIn("default-src 'none'", page)
        self.assertIn("<th>a</th>", page)
        self.assertIn("☑ done", page)
        self.assertIn("<ol>", page)
        self.assertIn("&lt;b&gt;code&lt;/b&gt;", page)
        self.assertIn("<ol><li>One</li>", mp.body("Steps:\n1. One\n2. Two"))
