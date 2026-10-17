"""New chats in VS Code: which account VS Code's Claude extension runs on
(its environmentVariables setting, VS Code's environment, else ~/.claude),
and jump.py opening the folder there and asking the extension for a chat."""
import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
CODE = Path(__file__).resolve().parent.parent / "package/contents/code"
sys.path.insert(0, str(CODE))
spec = importlib.util.spec_from_file_location("jump_vscode", CODE / "jump.py")
jump = importlib.util.module_from_spec(spec)
spec.loader.exec_module(jump)
cs = jump.cs


class Patch:
    """Temporarily replace attributes of modules: Patch((module, name, value), ...)."""

    def __init__(self, *changes):
        self.changes, self.saved = changes, []

    def __enter__(self):
        try:
            for module, name, value in self.changes:
                self.saved.append((module, name, getattr(module, name)))
                setattr(module, name, value)
        except Exception:
            self.__exit__()   # put back what was changed so far
            raise

    def __exit__(self, *exc):
        for module, name, value in reversed(self.saved):
            setattr(module, name, value)


class Home(unittest.TestCase):
    """A home with the work and personal profiles; ~/.claude links to work."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "home"
        for name in ("work", "personal"):
            d = self.home / f".claude-{name}"
            (d / "sessions").mkdir(parents=True)
            (d / ".profile-name").write_text(name)
        (self.home / ".claude").symlink_to(self.home / ".claude-work")
        self.config = Path(self.tmp.name) / "config"
        self.env = {k: os.environ.get(k) for k in ("XDG_CONFIG_HOME", "CLAUDE_CONFIG_DIR")}
        os.environ["XDG_CONFIG_HOME"] = str(self.config)
        os.environ.pop("CLAUDE_CONFIG_DIR", None)

    def tearDown(self):
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def settings(self, text):
        path = self.config / "Code/User/settings.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def profiles(self):
        return cs.discover_profiles(self.home)

    def label(self, running=(False, None), installed=True):
        app = ("/usr/bin/code", "Code") if installed else (None, None)
        with Patch((cs, "vscode_app", lambda: app), (cs, "vscode_running_config_dir", lambda: running)):
            found, profile = cs.vscode_profile(self.home, self.profiles())
        return found, profile.label if profile else None


class SettingsTests(Home):
    def test_settings_with_comments_and_trailing_commas(self):
        self.assertEqual(cs.jsonc('{\n // a "comment"\n "a": "http://x/*y*/", /* more */ "b": [1, 2,],\n}'),
                         {"a": "http://x/*y*/", "b": [1, 2]})
        self.assertEqual(cs.jsonc('{"q": "say \\"hi\\" // no comment"}'), {"q": 'say "hi" // no comment'})

    def test_config_dir_from_the_extension_setting(self):
        self.assertIsNone(cs.vscode_setting_config_dir(self.home, "Code"))   # no settings file
        self.settings('{"claudeCode.environmentVariables": [{"name": "FOO", "value": "1"},'
                      ' {"name": "CLAUDE_CONFIG_DIR", "value": "/x/.claude-y"},], // mine\n}')
        self.assertEqual(cs.vscode_setting_config_dir(self.home, "Code"), "/x/.claude-y")
        self.settings('{"claudeCode.environmentVariables": [{"name": "FOO", "value": "1"}]}')
        self.assertIsNone(cs.vscode_setting_config_dir(self.home, "Code"))
        self.settings('{"broken": ')
        self.assertIsNone(cs.vscode_setting_config_dir(self.home, "Code"))


class ProfileTests(Home):
    def test_the_setting_decides_and_links_are_followed(self):
        self.settings(json.dumps({"claudeCode.environmentVariables": [
            {"name": "CLAUDE_CONFIG_DIR", "value": str(self.home / ".claude")}]}))
        self.assertEqual(self.label(running=(True, str(self.home / ".claude-personal"))), (True, "work"))
        (self.home / ".claude").unlink()   # switched to the other profile
        (self.home / ".claude").symlink_to(self.home / ".claude-personal")
        self.assertEqual(self.label(), (True, "personal"))

    def test_else_the_running_vscode_else_what_the_widget_would_start_it_with(self):
        self.assertEqual(self.label(running=(True, str(self.home / ".claude-personal"))), (True, "personal"))
        self.assertEqual(self.label(running=(True, None)), (True, "work"))       # ~/.claude
        self.assertEqual(self.label(), (True, "work"))
        os.environ["CLAUDE_CONFIG_DIR"] = str(self.home / ".claude-personal")
        self.assertEqual(self.label(), (True, "personal"))

    def test_not_installed_or_no_such_profile(self):
        self.assertEqual(self.label(installed=False), (False, None))
        self.assertEqual(self.label(running=(True, "/nowhere/.claude")), (True, None))

    def test_ssh_host_uses_its_own_claude_folder(self):
        with Patch((cs, "vscode_app", lambda: (None, None))):
            installed, profile = cs.vscode_profile(self.home, self.profiles(), remote=True)
        self.assertEqual((installed, profile.label), (None, "work"))

    def test_groups_say_where_a_vscode_chat_goes(self):
        result = {"groups": [{"profileKeys": [p.key]} for p in self.profiles()]}
        with Patch((cs, "vscode_app", lambda: ("/usr/bin/code", "Code")),
                   (cs, "vscode_running_config_dir", lambda: (False, None))):
            cs.add_vscode(result, self.home)
        self.assertEqual(result["vscode"], {"installed": True, "on": "work"})
        here = {p.label: g["vscodeHere"] for p, g in zip(self.profiles(), result["groups"])}
        self.assertEqual(here, {"work": True, "personal": False})


class VscodeHome(Home):
    """Stand-ins for VS Code, xdg-open and KWin, recording what they're asked."""

    def setUp(self):
        super().setUp()
        self.started, self.raised, self.opened = [], [], []
        self.folder = self.home / "repos/app"
        self.folder.mkdir(parents=True)

    def fakes(self, running=False):
        fake_popen = type("P", (), {"Popen": staticmethod(lambda args, **k: self.opened.append(args)),
                                    "DEVNULL": None, "PIPE": None})
        self.waits = []
        return [
            (cs, "vscode_app", lambda: ("/usr/bin/code", "Code")),
            (cs, "vscode_running_config_dir", lambda: (running, None)),
            (jump, "vscode_main_pids", lambda: [100] if running else []),
            (jump, "start_app", lambda args, cwd=None: self.started.append(args)),
            (jump, "later", lambda task: task()),
            (jump, "raise_window", lambda pids, caption="", require=False, prefer="": self.raised.append((caption, require))),
            (jump, "time", type("T", (), {"sleep": staticmethod(lambda s: self.waits.append(s))})),
            (jump, "subprocess", fake_popen),
            (jump, "shutil", type("W", (), {"which": staticmethod(lambda n: f"/usr/bin/{n}")})),
        ]


class NewChatTests(VscodeHome):
    def new(self, profile, folder=None, running=False, choose=None):
        changes = self.fakes(running)
        if choose is not None:
            changes.append((jump, "choose_folder", lambda title, start: (choose, "")))
        with Patch(*changes):
            if choose is not None:
                return jump.new_chat_choosing_folder(self.home, [], profile, vscode=True)
            return jump.new_chat_vscode(self.home, [], profile, folder)

    def test_opens_the_folder_then_asks_for_a_new_chat(self):
        ok, message = self.new(".claude-work", str(self.folder))
        self.assertTrue(ok, message)
        self.assertEqual(self.started, [["/usr/bin/code", str(self.folder)]])
        self.assertEqual(self.raised, [("app", True)])   # the folder's window first...
        self.assertEqual(self.opened, [["/usr/bin/xdg-open", "vscode://anthropic.claude-code/open"]])   # ...then the link
        self.assertEqual(self.waits[0], 8)   # VS Code wasn't running: give it time to start

    def test_a_running_vscode_is_quicker(self):
        self.new(".claude-work", str(self.folder), running=True)
        self.assertEqual(self.waits[0], 2.5)

    def test_refuses_an_account_vscode_isnt_on(self):
        ok, message = self.new(".claude-personal", str(self.folder))
        self.assertFalse(ok)
        self.assertIn("runs on work, not personal", message)
        self.assertEqual((self.started, self.opened), ([], []))

    def test_chosen_folder(self):
        ok, _ = self.new(".claude-work", choose=str(self.folder))
        self.assertTrue(ok)
        self.assertEqual(self.started, [["/usr/bin/code", str(self.folder)]])

    def test_ssh_host(self):
        changes = [(cs, "vscode_app", lambda: ("/usr/bin/code", "Code")),
                   (jump, "start_app", lambda args, cwd=None: self.started.append(args)),
                   (jump, "later", lambda task: task()),
                   (jump, "raise_window", lambda pids, caption="", require=False, prefer="":
                    self.raised.append((caption, prefer))),
                   (jump, "vscode_main_pids", lambda: []),
                   (jump, "time", type("T", (), {"sleep": staticmethod(lambda s: None)})),
                   (jump, "subprocess", type("P", (), {"Popen": staticmethod(lambda args, **k: self.opened.append(args)),
                                                       "DEVNULL": None})),
                   (jump, "shutil", type("W", (), {"which": staticmethod(lambda n: f"/usr/bin/{n}")}))]
        with Patch(*changes):
            self.assertTrue(jump.new_chat_remote_vscode("lab", "/srv/proj")[0])
            self.assertTrue(jump.new_chat_remote_vscode("lab")[0])
        self.assertEqual(self.started, [["/usr/bin/code", "--folder-uri", "vscode-remote://ssh-remote+lab/srv/proj"],
                                        ["/usr/bin/code", "--remote", "ssh-remote+lab"]])
        self.assertEqual(self.raised, [("[SSH: lab]", "proj"), ("[SSH: lab]", "")])

    def test_command_line(self):
        calls = []
        with Patch((jump, "new_chat_vscode", lambda home, extra, name, folder: calls.append(("vscode", name, folder)) or (True, "")),
                   (jump, "new_chat", lambda home, extra, name, folder: calls.append(("terminal", name, folder)) or (True, "")),
                   (jump, "new_chat_remote_vscode", lambda host, folder: calls.append(("ssh", host, folder)) or (True, "")),
                   (jump, "new_chat_choosing_folder", lambda home, extra, name, vscode=False:
                    calls.append(("choose", name, vscode)) or (True, ""))), \
                contextlib.redirect_stdout(io.StringIO()):
            jump.main(["--new-chat", ".claude-work", "--cwd", "/p", "--vscode"])
            jump.main(["--new-chat", ".claude-work", "--cwd", "/p"])
            jump.main(["--remote-new-vscode", "lab", "--cwd", "/srv"])
            jump.main(["--new-chat", ".claude-work", "--choose-folder", "--vscode"])
        self.assertEqual(calls, [("vscode", ".claude-work", "/p"), ("terminal", ".claude-work", "/p"), ("ssh", "lab", "/srv"),
                                 ("choose", ".claude-work", True)])


class ResumeTests(VscodeHome):
    """A recent chat reopened in VS Code: its folder, then the extension's
    link with the chat's id (it resumes the chat in a new tab)."""

    CHAT = "5e550000-0000-4000-8000-000000000001"

    def setUp(self):
        super().setUp()
        transcript = self.home / ".claude-work/projects/-repos-app" / f"{self.CHAT}.jsonl"
        transcript.parent.mkdir(parents=True)
        transcript.write_text(json.dumps({"type": "user", "cwd": str(self.folder), "sessionId": self.CHAT}) + "\n")

    def resume(self, profile, chat=None):
        with Patch(*self.fakes()):
            return jump.resume_vscode(self.home, [], chat or self.CHAT, profile)

    def test_opens_the_chats_folder_then_the_chat(self):
        ok, message = self.resume(".claude-work")
        self.assertEqual((ok, message), (True, "Reopening the chat in VS Code (~/repos/app)"))
        self.assertEqual(self.started, [["/usr/bin/code", str(self.folder)]])
        self.assertEqual(self.raised, [("app", True)])
        self.assertEqual(self.opened, [["/usr/bin/xdg-open", f"vscode://anthropic.claude-code/open?session={self.CHAT}"]])

    def test_refused_where_it_cant_open(self):
        self.assertIn("runs on work, not personal", self.resume(".claude-personal")[1])
        self.assertEqual(self.resume(".claude-work", "0ther000-0000-4000-8000-000000000001"),
                         (False, "That chat isn't on work"))
        self.folder.rmdir()
        self.assertIn("isn't there any more", self.resume(".claude-work")[1])
        self.assertEqual((self.started, self.opened), ([], []))

    def test_ssh_host(self):
        with Patch(*self.fakes()):
            self.assertTrue(jump.resume_remote_vscode("lab", self.CHAT, "/srv/proj")[0])
        self.assertEqual(self.started, [["/usr/bin/code", "--folder-uri", "vscode-remote://ssh-remote+lab/srv/proj"]])
        self.assertEqual(self.raised, [("[SSH: lab]", True)])
        self.assertEqual(self.opened, [["/usr/bin/xdg-open", f"vscode://anthropic.claude-code/open?session={self.CHAT}"]])

    def test_resume_command_line(self):
        calls = []
        with Patch((jump, "resume_vscode", lambda home, extra, sid, prof: calls.append(("vscode", sid, prof)) or (True, "")),
                   (jump, "resume", lambda home, extra, sid, prof: calls.append(("terminal", sid, prof)) or (True, "")),
                   (jump, "resume_remote_vscode", lambda host, sid, folder: calls.append(("ssh", host, sid, folder)) or (True, ""))), \
                contextlib.redirect_stdout(io.StringIO()):
            jump.main(["--resume", "abc", "--profile", ".claude-work", "--vscode"])
            jump.main(["--resume", "abc", "--profile", ".claude-work"])
            jump.main(["--remote-resume-vscode", "lab", "abc", "--cwd", "/srv"])
            with self.assertRaises(SystemExit):
                jump.main(["--remote-resume-vscode", "lab"])   # which chat?
        self.assertEqual(calls, [("vscode", "abc", ".claude-work"), ("terminal", "abc", ".claude-work"),
                                 ("ssh", "lab", "abc", "/srv")])


class LaterTests(unittest.TestCase):
    def test_runs_on_its_own_after_we_answer(self):
        # The child runs the task with its output closed, so the widget gets
        # this script's answer without waiting for it
        with tempfile.TemporaryDirectory() as tmp:
            done = Path(tmp) / "done"
            start = time.time()
            jump.later(lambda: (time.sleep(0.3), done.write_text(str(os.getpid()))))
            self.assertLess(time.time() - start, 0.2)
            for _ in range(50):
                if done.exists() and done.read_text():
                    break
                time.sleep(0.05)
            self.assertNotEqual(done.read_text(), str(os.getpid()))


if __name__ == "__main__":
    unittest.main()
