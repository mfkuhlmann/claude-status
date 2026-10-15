import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True  # keep __pycache__ out of the plasmoid package
CODE = Path(__file__).resolve().parent.parent / "package/contents/code"
sys.path.insert(0, str(CODE))
spec = importlib.util.spec_from_file_location("jump", CODE / "jump.py")
jump = importlib.util.module_from_spec(spec)
spec.loader.exec_module(jump)
cs = jump.cs

from test_claude_status import Fixture, session, write  # noqa: E402


class Patch:
    """Temporarily replace attributes of the jump module."""

    def __init__(self, **attrs):
        self.attrs, self.saved = attrs, {}

    def __enter__(self):
        for k, v in self.attrs.items():
            self.saved[k] = getattr(jump, k)
            setattr(jump, k, v)

    def __exit__(self, *exc):
        for k, v in self.saved.items():
            setattr(jump, k, v)


class DbusParsingTests(unittest.TestCase):
    def call(self, out, code=0):
        with Patch(run=lambda args, timeout=5: (code, out)):
            return jump.dbus_call("d", "/p", "m")

    def test_gdbus_values(self):
        self.assertEqual(self.call("(0,)"), 0)
        self.assertEqual(self.call("(['3', '4'],)"), ["3", "4"])
        self.assertEqual(self.call("(true,)"), True)
        self.assertEqual(self.call("('🏠 ◐ is true or false',)"), "🏠 ◐ is true or false")
        self.assertIsNone(self.call("", code=1))

    def test_children_skip_the_object_itself(self):
        out = "node /Windows {\n  interface org.freedesktop.DBus.Introspectable {\n  };\n  node 1 {\n  };\n  node 12 {\n  };\n};"
        with Patch(run=lambda args, timeout=5: (0, out)):
            self.assertEqual(jump.dbus_children("d", "/Windows"), ["1", "12"])


class OpenTerminalTests(unittest.TestCase):
    def test_command_runs_on_the_command_line_then_a_shell(self):
        started = []
        with Patch(subprocess=type("S", (), {"Popen": lambda *a, **k: started.append(a[0]),
                                            "DEVNULL": None})):
            self.assertTrue(jump.open_terminal("/nonexistent", "claude attach x"))
        (args,) = started
        self.assertEqual(args[0].rsplit("/", 1)[-1], "konsole")
        self.assertEqual(args[1:3], ["--workdir", str(Path.home())])
        self.assertEqual(args[-2], "-c")
        self.assertTrue(args[-1].startswith("trap : INT; claude attach x; exec "))


class AttachCommandTests(unittest.TestCase):
    def profile(self, path, default):
        p = cs.Profile.__new__(cs.Profile)
        p.path, p.is_default = Path(path), default
        return p

    def test_plain_default_profile_unsets_config_dir(self):
        self.assertEqual(jump.attach_command(self.profile("/h/.claude", True), "12ab34cd"),
                         "env -u CLAUDE_CONFIG_DIR claude attach 12ab34cd")

    def test_linked_profile_uses_the_link_name_when_no_service_runs(self):
        # ~/.claude -> ~/.claude-personal: no ~/.claude.json to fall back on, and
        # terminals/VS Code name the folder ~/.claude, so attach under that name
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            real = home / ".claude-personal"
            real.mkdir()
            (home / ".claude").symlink_to(real)
            for path, default in ((home / ".claude", True), (real, False)):
                self.assertEqual(jump.attach_command(self.profile(path, default), "5ab1c0de", home),
                                 f"CLAUDE_CONFIG_DIR={home / '.claude'} claude attach 5ab1c0de")

    def test_reuses_the_running_service_name(self):
        # the service's name is whatever CLAUDE_CONFIG_DIR it runs with (here: this test process)
        with tempfile.TemporaryDirectory() as tmp:
            prof = Path(tmp) / ".claude-work"
            prof.mkdir()
            cs.write_json_atomic(prof / "daemon.status.json", {
                "supervisorPid": os.getpid(), "supervisorProcStart": cs.proc_start_time(os.getpid())})
            expected = os.environ.get("CLAUDE_CONFIG_DIR") or str(Path.home() / ".claude")
            self.assertEqual(jump.service_config_dir(self.profile(prof, False)), expected)
            cs.write_json_atomic(prof / "daemon.status.json", {"supervisorPid": 4194304 + 7})  # dead
            self.assertIsNone(jump.service_config_dir(self.profile(prof, False)))

    def test_uses_the_name_the_job_was_started_with(self):
        # No service running: start it under the job's own name, not the link
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            real = home / ".claude-personal"
            real.mkdir()
            (home / ".claude").symlink_to(real)
            job = {"providerEnv": {"CLAUDE_CONFIG_DIR": str(real)}}
            self.assertEqual(jump.attach_command(self.profile(home / ".claude", True), "5ab1c0de", home, job),
                             f"CLAUDE_CONFIG_DIR={real} claude attach 5ab1c0de")
            # a name of some other folder is ignored
            job = {"providerEnv": {"CLAUDE_CONFIG_DIR": str(home / ".claude-work")}}
            self.assertEqual(jump.attach_command(self.profile(real, False), "5ab1c0de", home, job),
                             f"CLAUDE_CONFIG_DIR={home / '.claude'} claude attach 5ab1c0de")

    def test_explains_the_trust_question_for_untrusted_folders(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            prof = home / ".claude-work"
            prof.mkdir()
            cs.write_json_atomic(prof / ".claude.json", {"projects": {
                str(home): {"hasTrustDialogAccepted": False},
                str(home / "proj"): {"hasTrustDialogAccepted": True}}})
            cmd = jump.attach_command(self.profile(prof, False), "j1", home, {"cwd": str(home)})
            self.assertTrue(cmd.startswith("printf '%s\\n\\n' 'Claude will ask whether you trust ~ before"), cmd)
            self.assertTrue(cmd.endswith(f"; CLAUDE_CONFIG_DIR={prof} claude attach j1"), cmd)
            self.assertEqual(jump.attach_command(self.profile(prof, False), "j1", home, {"cwd": str(home / "proj")}),
                             f"CLAUDE_CONFIG_DIR={prof} claude attach j1")
            # the note survives the shell: run it
            out = subprocess.run(["bash", "-c", cmd.split("; CLAUDE_CONFIG_DIR")[0]], capture_output=True, text=True).stdout
            self.assertIn('Choose "Yes, I trust this folder" to continue', out)

    def test_named_profile_sets_config_dir(self):
        self.assertEqual(jump.attach_command(self.profile("/h/my claude", False), "x;rm"),
                         "CLAUDE_CONFIG_DIR='/h/my claude' claude attach 'x;rm'")


class FindSessionTests(Fixture):
    def test_live_and_parked(self):
        profile, entry, job, job_id = jump.find_session(self.home, [], "busy")
        self.assertEqual((profile.label, entry["sessionId"], job_id), ("work", "busy", None))
        profile, entry, job, job_id = jump.find_session(self.home, [], "bgperm")
        self.assertEqual((entry["kind"], job_id, job["tempo"]), ("bg", "job5", "blocked"))
        # the short job id finds the live session too (not just its record)
        self.assertEqual(jump.find_session(self.home, [], "job5")[1]["sessionId"], "bgperm")
        os.remove(self.home / ".claude-work/sessions/19.json")  # its process is gone
        profile, entry, job, job_id = jump.find_session(self.home, [], "job5")
        self.assertEqual((entry, job_id), (None, "job5"))
        self.assertEqual(jump.find_session(self.home, [], "nope")[0], None)
        self.assertEqual(jump.find_session(self.home, [], "spare")[1], None)  # spares are not sessions

    def test_routing(self):
        calls = []
        with Patch(jump_terminal=lambda e, what="session": calls.append(("terminal", e["sessionId"])) or (True, ""),
                   jump_vscode=lambda e: calls.append(("vscode", e["sessionId"])) or (True, ""),
                   jump_job=lambda p, jid, job, name: calls.append(("job", jid)) or (True, "")):
            for sid in ("busy", "vscode", "bgperm"):
                jump.jump(self.home, [], sid)
        self.assertEqual(calls, [("terminal", "busy"), ("vscode", "vscode"), ("job", "job5")])
        self.assertEqual(jump.jump(self.home, [], "nope"), (False, "That session isn't running any more"))


class StopTests(Fixture):
    def run_stop(self, session_id, returncode=0, stdout="", stderr=""):
        calls = []

        class FakeSubprocess:
            DEVNULL = None
            TimeoutExpired = TimeoutError

            @staticmethod
            def run(args, **kw):
                calls.append((args, kw["env"].get("CLAUDE_CONFIG_DIR", "<unset>")))
                return type("R", (), {"returncode": returncode, "stdout": stdout, "stderr": stderr})()

        with Patch(subprocess=FakeSubprocess, shutil=type("W", (), {"which": staticmethod(lambda n: "/usr/bin/" + n)})):
            return jump.stop(self.home, [], session_id), calls

    def test_stops_background_session_under_its_profile(self):
        (ok, msg), calls = self.run_stop("bgperm", stdout="Stopped job5\n")
        self.assertEqual((ok, msg), (True, "Stopped job5"))
        (args, config_dir), = calls
        self.assertEqual(args, ["/usr/bin/claude", "stop", "job5"])
        self.assertEqual(config_dir, str((self.home / ".claude-work").resolve()))

    def test_refuses_terminal_sessions(self):
        (ok, msg), calls = self.run_stop("busy")
        self.assertFalse(ok)
        self.assertIn("Only background sessions", msg)
        self.assertEqual(calls, [])

    def test_reports_claude_errors(self):
        (ok, msg), _ = self.run_stop("bgperm", returncode=1, stderr="No job matching 'job5'.\n")
        self.assertEqual((ok, msg), (False, "No job matching 'job5'."))
        self.assertEqual(self.run_stop("nope")[0], (False, "That session isn't running any more"))


class NewChatTests(Fixture):
    def test_opens_claude_on_the_profile_in_the_folder(self):
        folder = self.home / "repos/a"
        folder.mkdir(parents=True)
        opened = []
        with Patch(open_terminal=lambda cwd, cmd: opened.append((cwd, cmd)) or True,
                   shutil=type("W", (), {"which": staticmethod(lambda n: "/usr/bin/" + n)})):
            ok, msg = jump.new_chat(self.home, [], ".claude-work", str(folder))
            self.assertEqual(jump.new_chat(self.home, [], ".claude-nope")[0], False)
        self.assertTrue(ok, msg)
        # with background sessions around, plain `claude` opens the agent view: ask for a normal chat
        self.assertEqual(opened, [(str(folder), "CLAUDE_CODE_DISABLE_AGENT_VIEW=1 "
                                   f"CLAUDE_CONFIG_DIR={(self.home / '.claude-work').resolve()} claude")])

    def test_profile_picks_the_right_copy_of_a_shared_chat(self):
        # the same chat id live in two profiles (a chat shared across profiles)
        write(self.home / ".claude-personal/sessions/40.json", session("busy", status="idle"))
        self.assertEqual(jump.find_session(self.home, [], "busy", ".claude-personal")[0].label, "personal")
        self.assertEqual(jump.find_session(self.home, [], "busy", ".claude-work")[0].label, "work")


class ResumeChatTests(Fixture):
    """A finished chat with no session or job on the profile (a shared chat
    last used there): reopened with `claude --resume`."""

    def setUp(self):
        super().setUp()
        self.folder = self.home / "repos/w"
        self.folder.mkdir(parents=True)
        lines = [{"type": "user", "cwd": "/elsewhere", "sessionId": "chatx"},
                 {"type": "assistant", "cwd": str(self.folder), "sessionId": "chatx"}]
        write(self.home / ".claude-personal/projects/-w/chatx.jsonl", "".join(json.dumps(l) + "\n" for l in lines))
        write(self.home / ".claude-personal/.claude.json", {
            "oauthAccount": {"accountUuid": "acct-pro", "organizationType": "claude_pro"},
            "projects": {str(self.folder): {"hasTrustDialogAccepted": True}}})

    def opened(self, *args):
        opened = []
        with Patch(open_terminal=lambda cwd, cmd: opened.append((cwd, cmd)) or True,
                   shutil=type("W", (), {"which": staticmethod(lambda n: "/usr/bin/" + n)})):
            result = jump.jump(self.home, [], *args)
        return result, opened

    def test_resumes_in_the_chats_last_folder(self):
        (ok, msg), opened = self.opened("chatx", ".claude-personal")
        self.assertEqual((ok, msg), (True, "Reopened the chat in a terminal"))
        real = (self.home / ".claude-personal").resolve()
        self.assertEqual(opened, [(str(self.folder), f"CLAUDE_CONFIG_DIR={real} claude --resume chatx")])

    def test_only_on_the_profile_asked_for(self):
        (ok, msg), opened = self.opened("chatx", ".claude-work")
        self.assertEqual((ok, msg, opened), (False, "That session isn't running any more", []))

    def test_explains_trust_question(self):
        cs.write_json_atomic(self.home / ".claude-personal/.claude.json", {"projects": {}})
        prof = next(p for p in cs.discover_profiles(self.home) if p.label == "personal")
        cmd = jump.resume_command(prof, "chatx", self.home, str(self.folder))
        self.assertIn("Claude will ask whether you trust ~/repos/w before", cmd)
        self.assertTrue(cmd.endswith("claude --resume chatx"))

    def test_profile_named_by_real_folder_or_path(self):
        prof = next(p for p in cs.discover_profiles(self.home) if p.label == "work")
        self.assertTrue(jump.matches(prof, ".claude-work"))
        self.assertTrue(jump.matches(prof, str(self.home / ".claude-work")))
        self.assertFalse(jump.matches(prof, ".claude-personal"))


class SwitchedLinkTests(unittest.TestCase):
    """A session started through ~/.claude before it was switched: its file is
    still in the old profile, but it runs on the new one."""

    def test_found_under_the_profile_it_runs_on(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            for name in ("work", "personal"):
                write(home / f".claude-{name}/.profile-name", name)
                write(home / f".claude-{name}/.claude.json", {"oauthAccount": {"accountUuid": name}})
                (home / f".claude-{name}/sessions").mkdir()
            (home / ".claude").symlink_to(home / ".claude-personal")
            env = {k: v for k, v in os.environ.items() if k != "CLAUDE_CONFIG_DIR"}
            env["CLAUDE_CONFIG_DIR"] = str(home / ".claude")
            child = subprocess.Popen(["sleep", "60"], env=env)
            try:
                for _ in range(100):
                    if cs.proc_start_time(child.pid):
                        break
                start = cs.proc_start_time(child.pid)
                write(home / f".claude-work/sessions/{child.pid}.json",
                      {"pid": child.pid, "procStart": start, "sessionId": "s1", "kind": "interactive", "status": "busy"})
                profile, entry, _, _ = jump.find_session(home, [], "s1", ".claude-personal")
                self.assertEqual((profile.label, entry["sessionId"]), ("personal", "s1"))
                self.assertIsNone(jump.find_session(home, [], "s1", ".claude-work")[1] and None)
            finally:
                child.kill()
                child.wait()


class DismissHelperTests(unittest.TestCase):
    def test_dismiss_and_undo(self):
        with tempfile.TemporaryDirectory() as tmp:
            old = os.environ.get("XDG_CACHE_HOME")
            os.environ["XDG_CACHE_HOME"] = tmp
            try:
                self.assertTrue(jump.dismiss(Path(tmp), [], "abc")[0])
                self.assertIn("abc", cs.load_dismissed(cs.cache_dir(Path(tmp))))
                self.assertEqual(jump.undismiss_all(Path(tmp), [])[1], "1 session(s) shown again")
                self.assertEqual(cs.load_dismissed(cs.cache_dir(Path(tmp))), {})
            finally:
                if old is None:
                    os.environ.pop("XDG_CACHE_HOME")
                else:
                    os.environ["XDG_CACHE_HOME"] = old


class AttachedTabTests(unittest.TestCase):
    # tabs: (session, shell pid, foreground pid, title)
    TABS = {100: [("1", 11, 11, "~ : bash"), ("2", 12, 22, "🏠 ◑ fix the parser"), ("3", 13, 23, "🏠 ✳ other"),
                  ("4", 14, 14, "🏠")]}
    CHILDREN = {11: [], 12: [22], 13: [23], 14: [24]}

    def find(self, cmdlines, config_dirs, job_id="ab12cd34", name="fix the parser", config_dir=Path("/h/.claude-work")):
        with Patch(konsole_pids=lambda: list(self.TABS), konsole_tabs=lambda k: self.TABS[k],
                   process_children=lambda: self.CHILDREN,
                   proc_name=lambda pid: "claude" if pid in cmdlines else "bash",
                   proc_cmdline=lambda pid: cmdlines.get(pid, []),
                   proc_config_dir=lambda pid: config_dirs.get(pid)):
            return jump.find_attached_tab(job_id, name, config_dir)

    def test_claude_attach_on_command_line(self):
        self.assertEqual(self.find({23: ["claude", "attach", "ab12cd34"]}, {}), (100, "3"))

    def test_attach_under_a_wrapper_shell(self):
        # the widget's own windows: bash -c "...; claude attach <id>; exec bash" is the foreground
        self.assertEqual(self.find({24: ["claude", "attach", "ab12cd34"]}, {}), (100, "4"))

    def test_agent_view_matched_by_title_and_profile(self):
        self.assertEqual(self.find({22: ["claude"]}, {22: Path("/h/.claude-work")}), (100, "2"))
        self.assertIsNone(self.find({22: ["claude"]}, {22: Path("/h/.claude-personal")}))  # other profile

    def test_nothing_attached(self):
        self.assertIsNone(self.find({}, {}))


class LinkedProfileTests(unittest.TestCase):
    """~/.claude as a link to ~/.claude-personal: one profile, snapshots under both names."""

    def test_linked_default_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            home, cache = Path(tmp) / "home", Path(tmp) / "cache"
            write(home / ".claude-personal/.profile-name", "personal")
            write(home / ".claude-personal/.claude.json",
                  {"oauthAccount": {"accountUuid": "acct", "organizationType": "claude_pro"}})
            write(home / ".claude-personal/sessions/1.json", session("s1", status="busy"))
            (home / ".claude").symlink_to(home / ".claude-personal")
            write(cache / "statusline/.claude-personal/s1.json", {"context_window": {"used_percentage": 12},
                                                                  "rate_limits": {"five_hour": {"used_percentage": 7}}})
            profiles = cs.discover_profiles(home)
            self.assertEqual([(p.label, p.snapshot_dirs) for p in profiles],
                             [("personal", [".claude", ".claude-personal"])])
            r = cs.collect(home, cache, with_tokens=False)
            (group,) = r["groups"]
            self.assertEqual([s["sessionId"] for s in group["sessions"]], ["s1"])  # not listed twice
            self.assertEqual(group["sessions"][0]["context"], 12)
            self.assertEqual(group["limits"]["windows"][0]["pct"], 7)



FAKE_SHARE_TOOL = r"""#!/usr/bin/env bash
# Stand-in for shared-chats.sh with the same command line: share ID, unshare ID NAME
set -u
C=$HOME/.claude-shared/chats
echo "$*" >> "$HOME/share-tool.log"
case "$1" in
  share)
    f=$(ls "$HOME"/.claude-*/projects/*/"$2".jsonl 2>/dev/null | head -1)
    [ -n "$f" ] || { echo "No chat $2 in any profile."; exit 1; }
    K=$(basename "$(dirname "$f")"); mkdir -p "$C/$K"; ln -f "$f" "$C/$K/$2.jsonl"
    for d in "$HOME"/.claude-*/; do
      [ -f "$d.profile-name" ] || continue
      mkdir -p "$d/projects/$K"; [ -e "$d/projects/$K/$2.jsonl" ] || ln "$f" "$d/projects/$K/$2.jsonl"
    done
    echo "Chat shared, no tokens used." ;;
  unshare)
    f=$(ls "$C"/*/"$2".jsonl 2>/dev/null | head -1)
    [ -n "$f" ] || { echo "This chat isn't shared."; exit 1; }
    K=$(basename "$(dirname "$f")")
    for d in "$HOME"/.claude-*/; do
      [ "$(basename "$d")" = ".claude-$3" ] && continue
      rm -f "$d/projects/$K/$2.jsonl"
    done
    rm -f "$f"; echo "This chat is now a normal chat of '$3' again." ;;
esac
"""


class SharedChatActionTests(unittest.TestCase):
    """Share, continue on another account and unshare, through shared-chats.sh."""

    CHAT = "9a8b7c6d-0000-4000-8000-000000000001"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.folder = self.home / "repos/app"
        self.folder.mkdir(parents=True)
        for name in ("personal", "work"):
            d = self.home / f".claude-{name}"
            write(d / ".profile-name", name)
            write(d / ".claude.json", {"oauthAccount": {"accountUuid": name},
                                       "projects": {str(self.folder): {"hasTrustDialogAccepted": True}}})
            (d / "sessions").mkdir()
        write(self.home / ".claude-personal/projects/-repos-app" / f"{self.CHAT}.jsonl",
              json.dumps({"type": "user", "cwd": str(self.folder), "sessionId": self.CHAT}) + "\n")
        tool = self.home / ".claude-shared/profile-tools/shared-chats.sh"
        write(tool, FAKE_SHARE_TOOL)
        tool.chmod(0o755)
        self.state = Path(self.tmp.name) / "state"
        old = os.environ.get("XDG_STATE_HOME")
        os.environ["XDG_STATE_HOME"] = str(self.state)
        self.addCleanup(lambda: os.environ.__setitem__("XDG_STATE_HOME", old) if old else os.environ.pop("XDG_STATE_HOME", None))

    def tearDown(self):
        self.tmp.cleanup()

    def run_action(self, action, *args):
        opened = []
        with Patch(open_terminal=lambda cwd, cmd: opened.append((cwd, cmd)) or True,
                   shutil=type("W", (), {"which": staticmethod(lambda n: "/usr/bin/" + n)})):
            result = action(self.home, [], self.CHAT, *args)
        return result, opened

    def in_work(self):
        return cs.transcript_path(next(p for p in cs.discover_profiles(self.home) if p.label == "work"), self.CHAT)

    def test_continue_on_another_account_shares_then_resumes_there(self):
        (ok, msg), opened = self.run_action(jump.continue_on, ".claude-work")
        self.assertEqual((ok, msg), (True, "Reopened the chat in a terminal"))
        self.assertIsNotNone(self.in_work())
        work = (self.home / ".claude-work").resolve()
        self.assertEqual(opened, [(str(self.folder), f"CLAUDE_CONFIG_DIR={work} claude --resume {self.CHAT}")])
        # already shared: no second share, just reopen
        (ok, _), opened = self.run_action(jump.continue_on, ".claude-work")
        self.assertTrue(ok)
        self.assertEqual((self.home / "share-tool.log").read_text().count("share "), 1)

    def test_refuses_while_open_in_a_session(self):
        write(self.home / ".claude-personal/sessions/50.json",
              {"pid": os.getpid(), "procStart": cs.proc_start_time(os.getpid()), "sessionId": self.CHAT,
               "kind": "interactive", "status": "idle"})
        for action, args in ((jump.continue_on, (".claude-work",)), (jump.unshare, (".claude-personal",))):
            (ok, msg), opened = self.run_action(action, *args)
            self.assertFalse(ok)
            self.assertIn("open in a session on personal", msg)
            self.assertEqual(opened, [])
        self.assertFalse((self.home / "share-tool.log").exists())

    def test_share_then_keep_only_on_one_account(self):
        (ok, msg), _ = self.run_action(jump.share)
        self.assertEqual((ok, msg), (True, "Chat shared, no tokens used."))
        self.assertIsNotNone(self.in_work())
        (ok, msg), _ = self.run_action(jump.unshare, ".claude-personal")
        self.assertEqual((ok, msg), (True, "This chat is now a normal chat of 'personal' again."))
        self.assertIsNone(self.in_work())
        self.assertIn(f"unshare {self.CHAT} personal", (self.home / "share-tool.log").read_text())

    def test_unshare_needs_a_profile_the_tool_knows(self):
        (ok, msg), _ = self.run_action(jump.unshare, ".claude-nope")
        self.assertFalse(ok)
        self.assertIn("isn't a profile the shared-chats tool knows", msg)

    def test_different_chat_with_the_same_id_left_alone(self):
        write(self.home / ".claude-work/projects/-repos-app" / f"{self.CHAT}.jsonl", "{}\n")  # its own file
        (ok, msg), opened = self.run_action(jump.continue_on, ".claude-work")
        self.assertFalse(ok)
        self.assertIn("different chat with the same id", msg)

    def test_tool_not_installed(self):
        (self.home / ".claude-shared/profile-tools/shared-chats.sh").unlink()
        (ok, msg), _ = self.run_action(jump.share)
        self.assertFalse(ok)
        self.assertIn("isn't installed", msg)

    def test_command_line(self):
        out = subprocess.run([sys.executable, "-I", str(CODE / "jump.py"), "--continue", self.CHAT],
                             capture_output=True, text=True)
        self.assertNotEqual(out.returncode, 0)  # --continue needs --profile
        self.assertIn("usage", out.stderr)


@unittest.skipUnless((Path.home() / ".claude-shared/profile-tools/shared-chats.sh").is_file(),
                     "the real shared-chats.sh isn't installed here")
class RealShareToolTests(SharedChatActionTests):
    """The same, with the real shared-chats.sh (copied into a temporary home)."""

    def setUp(self):
        super().setUp()
        tool = self.home / ".claude-shared/profile-tools/shared-chats.sh"
        tool.write_text((Path.home() / ".claude-shared/profile-tools/shared-chats.sh").read_text())

    def test_share_then_keep_only_on_one_account(self):
        (ok, msg), _ = self.run_action(jump.share)
        self.assertTrue(ok, msg)
        self.assertIn("Chat shared", msg)
        store = self.home / ".claude-shared/chats/-repos-app" / f"{self.CHAT}.jsonl"
        self.assertTrue(os.path.samefile(store, self.in_work()))
        (ok, msg), _ = self.run_action(jump.unshare, ".claude-personal")
        self.assertTrue(ok, msg)
        self.assertIsNone(self.in_work())
        self.assertFalse(store.exists())

    def test_continue_on_another_account_shares_then_resumes_there(self):
        (ok, msg), opened = self.run_action(jump.continue_on, ".claude-work")
        self.assertTrue(ok, msg)
        self.assertIsNotNone(self.in_work())
        self.assertEqual(len(opened), 1)


class RemoteShowTests(unittest.TestCase):
    """Sessions that run on an SSH host but show here (VS Code Remote-SSH, ssh in a terminal)."""

    def test_ssh_target(self):
        cases = {
            ("ssh", "labserver"): "labserver",
            ("ssh", "-v", "-T", "-D", "33023", "-o", "ConnectTimeout=15", "labserver", "-T"): "labserver",
            ("ssh", "-t", "alice@labserver.uni.example", "claude"): "labserver.uni.example",
            ("ssh", "-l", "me", "-p", "2222", "box"): "box",
            ("ssh", "-p2222", "-tt", "box:22"): "box",
            ("ssh", "-W", "[labserver]:22", "bastion"): None,       # a ProxyJump helper, not the session
            ("ssh", "-o", "X=1"): None,
            ("bash", "labserver"): None,
            ("/usr/bin/ssh", "--", "host"): "host",
        }
        for argv, want in cases.items():
            self.assertEqual(jump.ssh_target(list(argv)), want, argv)

    def procs(self, tree, names, argvs):
        return dict(process_children=lambda: tree, proc_name=lambda pid: names.get(pid, "bash"),
                    proc_cmdline=lambda pid: argvs.get(pid, []), host_names=lambda host: {host} | ({"labserver.uni.example"} if host == "labserver" else set()))

    def test_vscode_window_connected_to_the_host(self):
        raised, opened = [], []
        tree = {100: [110], 110: [120]}
        names = {100: "code", 120: "ssh"}
        argvs = {100: ["/usr/share/code/code"], 120: ["ssh", "-T", "-D", "1", "labserver"]}
        fake = type("S", (), {"Popen": staticmethod(lambda args, **k: opened.append(args)), "DEVNULL": None})
        with Patch(vscode_main_pids=lambda: [100], raise_window=lambda *a, **k: raised.append((a, k)) or True,
                   subprocess=fake, shutil=type("W", (), {"which": staticmethod(lambda n: "/usr/bin/" + n)}),
                   time=type("T", (), {"sleep": staticmethod(lambda s: None)}), **self.procs(tree, names, argvs)):
            ok, msg = jump.jump_remote_vscode("labserver", "abc-123", "/home/me/proj")
        self.assertEqual((ok, msg), (True, "Opened the conversation in VS Code (labserver)"))
        self.assertEqual(raised, [(([100], "[SSH: labserver]"), {"require": True, "prefer": "proj"})])
        self.assertEqual(opened, [["/usr/bin/xdg-open", "vscode://anthropic.claude-code/open?session=abc-123"]])

    def test_vscode_opened_on_the_host_when_not_connected(self):
        opened = []
        fake = type("S", (), {"Popen": staticmethod(lambda args, **k: opened.append(args)), "DEVNULL": None})
        with Patch(vscode_main_pids=lambda: [100], raise_window=lambda *a, **k: self.fail("nothing to raise"),
                   subprocess=fake, shutil=type("W", (), {"which": staticmethod(lambda n: "/usr/bin/" + n)}),
                   **self.procs({100: []}, {100: "code"}, {100: ["code"]})):
            ok, msg = jump.jump_remote_vscode("labserver", "abc-123", "/home/me/proj")
        self.assertTrue(ok, msg)
        self.assertEqual(opened[0], ["/usr/bin/code", "--folder-uri", "vscode-remote://ssh-remote+labserver/home/me/proj"])
        self.assertIn("vscode://anthropic.claude-code/open?session=abc-123", opened[1][-1])

    def test_terminal_tab_with_the_ssh_session(self):
        tabs = {300: [("1", 11, 11, "~ : bash"), ("2", 12, 22, "🏠 ✳ other chat"), ("3", 13, 23, "🏠 ◐ fix parser")]}
        tree = {11: [], 12: [22], 13: [23]}
        names = {22: "ssh", 23: "ssh"}
        argvs = {22: ["ssh", "labserver"], 23: ["ssh", "labserver.uni.example"]}
        shown = []
        with Patch(konsole_pids=lambda: [300], konsole_tabs=lambda k: tabs[k],
                   show_konsole_tab=lambda k, s: shown.append((k, s)) or True, **self.procs(tree, names, argvs)):
            self.assertEqual(jump.jump_remote_terminal("labserver", "fix parser")[0], True)
            self.assertEqual(jump.jump_remote_terminal("labserver", "")[0], True)
            ok, msg = jump.jump_remote_terminal("buildbox", "fix parser")
        self.assertEqual(shown, [(300, "3"), (300, "2")])
        self.assertFalse(ok)
        self.assertIn("no terminal here has an ssh connection to buildbox", msg)


if __name__ == "__main__":
    unittest.main()
