import importlib.util
import json
import os
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True  # keep __pycache__ out of the plasmoid package
CODE = Path(__file__).resolve().parent.parent / "package/contents/code"
sys.path.insert(0, str(CODE))
spec = importlib.util.spec_from_file_location("accounts", CODE / "accounts.py")
accounts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(accounts)
cs, jump = accounts.cs, accounts.jump

from test_claude_status import session, write  # noqa: E402

# A stand-in claude: notes each call (its arguments and CLAUDE_CONFIG_DIR),
# answers `auth status` from the folder's .claude.json and logs out the way
# Claude does (oauthAccount gone from .claude.json, the login file deleted)
FAKE_CLAUDE = r"""#!/usr/bin/env python3
import json, os, sys
d = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
with open(os.environ["CALLS"], "a") as f:
    f.write(json.dumps({"args": sys.argv[1:], "dir": os.environ.get("CLAUDE_CONFIG_DIR")}) + "\n")
path = os.path.join(d, ".claude.json")
try:
    data = json.load(open(path))
except OSError:
    data = {}
if sys.argv[1:3] == ["auth", "status"]:
    account = data.get("oauthAccount")
    print(json.dumps({"loggedIn": bool(account), "authMethod": "claude.ai" if account else "none",
                      **({"email": account.get("emailAddress")} if account else {})}))
    sys.exit(0 if account else 1)
if sys.argv[1:3] == ["auth", "logout"]:
    if os.environ.get("LOGOUT_FAILS"):
        print("Logout failed: network down", file=sys.stderr)
        sys.exit(1)
    data.pop("oauthAccount", None)
    json.dump(data, open(path, "w"))
    try:
        os.unlink(os.path.join(d, ".credentials.json"))
    except OSError:
        pass
    print("Successfully logged out from your Anthropic account.")
"""


class Home(unittest.TestCase):
    """A home with ~/.claude (a plain folder, logged in), ~/.claude-work and
    the stand-in claude in ~/.local/bin."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = h = Path(self.tmp.name) / "home"
        write(h / ".claude/projects/-x/a.jsonl", "")
        write(h / ".claude/settings.json", {"statusLine": {"type": "command", "command": "~/.claude/statusline.sh"}})
        write(h / ".claude/CLAUDE.md", "my rules")
        write(h / ".claude/skills/mine/SKILL.md", "a skill")
        write(h / ".claude/skills/synced/org-skill/SKILL.md", "claude.ai's")
        write(h / ".claude/agents/reviewer.md", "an agent")
        write(h / ".claude.json", {"oauthAccount": {"accountUuid": "acct-pro", "organizationType": "claude_pro"}})
        w = h / ".claude-work"
        write(w / ".profile-name", "work\n")
        write(w / ".claude.json", {"oauthAccount": {"accountUuid": "acct-team", "organizationType": "claude_team",
                                                    "emailAddress": "me@example.com"}})
        write(w / ".credentials.json", "{}")
        write(w / "projects/-y/b.jsonl", "")
        self.bin = h / ".local/bin"
        self.claude = self.bin / "claude"
        write(self.claude, FAKE_CLAUDE)
        self.claude.chmod(0o755)
        self.calls = Path(self.tmp.name) / "calls.jsonl"
        env = {"HOME": str(h), "PATH": f"{self.bin}:/usr/bin:/bin", "CALLS": str(self.calls),
               "XDG_CACHE_HOME": str(Path(self.tmp.name) / "cache"), "XDG_DATA_HOME": str(h / ".local/share")}
        self.env = mock.patch.dict(os.environ, env)
        self.env.start()
        os.environ.pop("CLAUDE_CONFIG_DIR", None)
        self.opened = []
        self.patches = [
            mock.patch.object(jump, "open_terminal", lambda cwd, cmd: self.opened.append((cwd, cmd)) or True),
            mock.patch.object(cs, "vscode_profile", lambda *a, **k: (False, None)),
            mock.patch.object(cs, "login_shell_path", lambda home: ""),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.env.stop()
        self.tmp.cleanup()

    def calls_made(self):
        try:
            return [json.loads(line) for line in self.calls.read_text().splitlines()]
        except OSError:
            return []

    def listed(self, check=False):
        ok, _, more = accounts.list_accounts(self.home, [], check)
        self.assertTrue(ok)
        return {a["key"]: a for a in more["accounts"]}

    def add(self, name, **kw):
        return accounts.add_account(self.home, [], name, **kw)


class AddTests(Home):
    def test_new_folder_is_an_account_not_logged_in(self):
        ok, message, profile = self.add("side")
        self.assertTrue(ok, message)
        folder = self.home / ".claude-side"
        self.assertEqual((folder / ".profile-name").read_text(), "side\n")  # claude-switch's marker
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
        self.assertEqual(profile.key, ".claude-side")
        # the status check lists it, as an account to log in
        result = cs.collect(self.home, cs.cache_dir(self.home), with_tokens=False)
        group = next(g for g in result["groups"] if g["name"] == "side")
        self.assertTrue(group["loggedOut"])
        self.assertIsNone(group["limits"])
        self.assertFalse(next(g for g in result["groups"] if g["name"] == "work")["loggedOut"])
        self.assertFalse(self.listed()[".claude-side"]["loggedIn"])

    def test_names(self):
        for name, problem in [("", "Give the account a name"), ("default", "default is the name"),
                              ("1st", "starting with a letter"), ("a b", "letters, digits"),
                              ("x" * 33, "up to 32"), ("work", "There's an account called work"),
                              ("../etc", "letters, digits")]:
            ok, message, _ = self.add(name)
            self.assertFalse(ok, name)
            self.assertIn(problem, message)
        (self.home / ".claude-notes").mkdir()  # a folder that isn't an account
        self.assertIn("~/.claude-notes is there already", self.add("notes")[1])
        self.assertTrue(self.add("my_Work-2")[0])

    def test_shares_settings_from_the_real_files(self):
        # ~/.claude links to work: sharing from it links work's real files,
        # so switching the link later changes nothing here
        shared = self.home / "shared"
        write(shared / "settings.json", {"statusLine": {"type": "command", "command": "x"}})
        w = self.home / ".claude-work"
        os.symlink(shared / "settings.json", w / "settings.json")
        write(w / "skills/own/SKILL.md", "work's skill")
        os.symlink(shared, w / "commands")  # a folder shared whole
        ok, message, _ = self.add("side", share_from=".claude-work")
        self.assertTrue(ok, message)
        side = self.home / ".claude-side"
        self.assertEqual(os.readlink(side / "settings.json"), str(shared / "settings.json"))
        self.assertEqual(os.readlink(side / "skills/own"), str(w / "skills/own"))
        self.assertEqual(os.readlink(side / "commands"), str(shared))
        self.assertIn("sharing settings.json, skills (1), commands with work", message)

    def test_own_skills_one_by_one_without_claude_ais(self):
        ok, message, _ = self.add("side", share_from=".claude")
        self.assertTrue(ok, message)
        side, main = self.home / ".claude-side", self.home / ".claude"
        self.assertEqual(os.readlink(side / "settings.json"), str(main / "settings.json"))
        self.assertEqual(os.readlink(side / "CLAUDE.md"), str(main / "CLAUDE.md"))
        self.assertFalse(side.joinpath("skills").is_symlink())  # a folder of its own…
        self.assertEqual(sorted(os.listdir(side / "skills")), ["mine"])  # …without skills/synced
        self.assertEqual(os.readlink(side / "agents/reviewer.md"), str(main / "agents/reviewer.md"))
        for kept in (".claude.json", ".credentials.json", "plugins", "projects", "keybindings.json"):
            self.assertFalse(os.path.lexists(side / kept), kept)

    def test_unknown_profile_to_share_from(self):
        ok, message, _ = self.add("side", share_from=".claude-nope")
        self.assertFalse(ok)
        self.assertFalse((self.home / ".claude-side").exists())

    def test_command(self):
        ok, message, profile = self.add("side", with_command=True)
        self.assertTrue(ok, message)
        self.assertIn("Added claude-side", message)
        script = self.bin / "claude-side"
        self.assertEqual(script.stat().st_mode & 0o777, 0o755)
        # it runs claude on the account
        r = subprocess.run([str(script), "--version"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.calls_made()[-1], {"args": ["--version"], "dir": str(self.home / ".claude-side")})
        self.assertTrue(self.listed()[".claude-side"]["command"])
        self.assertEqual(accounts.remove_command(profile, self.home), (True, "Removed claude-side"))
        self.assertFalse(script.exists())

    def test_command_uses_the_link_name_where_claude_does(self):
        # ~/.claude links to work: terminals run work as ~/.claude (Claude
        # keys its background service by that name), so the command does too
        os.rename(self.home / ".claude", self.home / ".claude-old")
        os.symlink(self.home / ".claude-work", self.home / ".claude")
        profile, _ = accounts.find_profile(self.home, [], ".claude-work")
        self.assertTrue(accounts.add_command(profile, self.home)[0])
        subprocess.run([str(self.bin / "claude-work")], check=True)
        self.assertEqual(self.calls_made()[-1]["dir"], str(self.home / ".claude"))

    def test_command_never_replaces_another_program(self):
        write(self.bin / "claude-switch", "#!/bin/sh\necho the real claude-switch\n")
        ok, message, _ = self.add("switch", with_command=True)
        self.assertFalse(ok)
        self.assertIn("~/.local/bin/claude-switch is there already (not made by Claude Status)", message)
        self.assertFalse((self.home / ".claude-switch").exists())  # nothing made
        self.assertTrue(self.add("switch")[0])  # without the command it's fine
        profile, _ = accounts.find_profile(self.home, [], ".claude-switch")
        self.assertFalse(accounts.remove_command(profile, self.home)[0])
        self.assertIn("the real claude-switch", (self.bin / "claude-switch").read_text())

    def test_command_off_path_says_so(self):
        os.environ["PATH"] = "/usr/bin:/bin"
        profile, _ = accounts.find_profile(self.home, [], ".claude-work")
        ok, message = accounts.add_command(profile, self.home)
        self.assertTrue(ok)
        self.assertIn("~/.local/bin isn't on your PATH", message)

    def test_main_has_no_command(self):
        profile, _ = accounts.find_profile(self.home, [], ".claude")
        self.assertFalse(accounts.add_command(profile, self.home)[0])
        self.assertIsNone(self.listed()[".claude"]["commandName"])


class LoginTests(Home):
    def test_add_opens_claudes_login_in_a_terminal(self):
        out = self.main("--add", "side")
        self.assertTrue(out["ok"], out)
        self.assertEqual(out["key"], ".claude-side")
        [(cwd, command)] = self.opened
        self.assertEqual(cwd, str(self.home))
        self.assertIn(f"CLAUDE_CONFIG_DIR={shlex.quote(str(self.home / '.claude-side'))} claude auth login", command)
        self.assertIn("Log in to Claude for side (~/.claude-side)", command)

    def test_print_command_for_a_terminal_of_your_own(self):
        out = self.main("--login", ".claude-work", "--print-command")
        self.assertTrue(out["ok"])
        self.assertEqual(self.opened, [])
        self.assertTrue(out["command"].endswith(f"{self.claude} auth login"))

    def test_plain_default_logs_in_without_the_variable(self):
        out = self.main("--login", ".claude", "--print-command")
        self.assertIn("env -u CLAUDE_CONFIG_DIR", out["command"])

    def test_check_asks_claude(self):
        accounts_ = self.listed(check=True)
        self.assertTrue(accounts_[".claude-work"]["checked"])
        self.assertEqual(accounts_[".claude-work"]["email"], "me@example.com")
        self.assertEqual(accounts_[".claude-work"]["method"], "claude.ai")
        self.assertEqual({c["dir"] for c in self.calls_made()}, {None, str(self.home / ".claude-work")})

    def test_logout(self):
        ok, message = accounts.logout(self.home, [], ".claude-work")
        self.assertTrue(ok, message)
        self.assertEqual(self.calls_made()[-1], {"args": ["auth", "logout"], "dir": str(self.home / ".claude-work")})
        # the popup says so, though the folder has chats (and no .profile-name)
        (self.home / ".claude-work/.profile-name").unlink()
        result = cs.collect(self.home, cs.cache_dir(self.home), with_tokens=False)
        self.assertTrue(next(g for g in result["groups"] if g["name"] == "work")["loggedOut"])
        self.assertFalse(self.listed()[".claude-work"]["loggedIn"])

    def test_logout_refused_while_chats_run(self):
        write(self.home / ".claude-work/sessions/1.json", session("busy", status="busy"))
        ok, message = accounts.logout(self.home, [], ".claude-work")
        self.assertFalse(ok)
        self.assertIn("A chat runs on work", message)
        self.assertEqual(self.calls_made(), [])

    def test_logout_failure_is_reported(self):
        os.environ["LOGOUT_FAILS"] = "1"
        ok, message = accounts.logout(self.home, [], ".claude-work")
        self.assertFalse(ok)
        self.assertIn("network down", message)

    def main(self, *args):
        with mock.patch("sys.stdout") as out:
            accounts.main(list(args))
        return json.loads("".join(c.args[0] for c in out.write.call_args_list))


class RemoveTests(Home):
    def trash(self):
        return self.home / ".local/share/Trash"

    def test_logs_out_then_moves_to_the_trash(self):
        profile, _ = accounts.find_profile(self.home, [], ".claude-work")
        accounts.add_command(profile, self.home)
        ok, message = accounts.remove_account(self.home, [], ".claude-work")
        self.assertTrue(ok, message)
        self.assertFalse(os.path.lexists(self.home / ".claude-work"))
        self.assertEqual(self.calls_made()[-1]["args"], ["auth", "logout"])
        moved = self.trash() / "files/.claude-work"
        self.assertTrue((moved / "projects/-y/b.jsonl").exists())
        self.assertFalse(os.path.lexists(moved / ".credentials.json"))
        info = (self.trash() / "info/.claude-work.trashinfo").read_text()
        self.assertIn(f"Path={self.home / '.claude-work'}\n", info)
        self.assertIn("DeletionDate=", info)
        self.assertFalse((self.bin / "claude-work").exists())
        self.assertIn("Removed claude-work", message)
        # one with the same name again goes next to it
        self.add("work")
        self.assertTrue(accounts.remove_account(self.home, [], ".claude-work")[0])
        self.assertTrue((self.trash() / "files/.claude-work.2/.profile-name").exists())
        self.assertNotIn(".claude-work", {a["key"] for a in self.listed().values()})

    def test_login_never_reaches_the_trash(self):
        os.environ["LOGOUT_FAILS"] = "1"
        ok, message = accounts.remove_account(self.home, [], ".claude-work")
        self.assertTrue(ok)
        self.assertIn("couldn't log out first", message)
        self.assertFalse(os.path.lexists(self.trash() / "files/.claude-work/.credentials.json"))

    def test_refusals(self):
        self.assertIn("main Claude folder", accounts.remove_account(self.home, [], ".claude")[1])
        write(self.home / ".claude-work/sessions/1.json", session("busy", status="busy"))
        self.assertIn("A chat runs on it", accounts.remove_account(self.home, [], ".claude-work")[1])
        (self.home / ".claude-work/sessions/1.json").unlink()
        with mock.patch.object(cs, "vscode_profile", lambda home, profiles, **k: (True, profiles[1])):
            self.assertIn("VS Code's Claude runs on it", accounts.remove_account(self.home, [], ".claude-work")[1])
        extra = Path(self.tmp.name) / "elsewhere"
        write(extra / ".profile-name", "elsewhere")
        self.assertIn("Only ~/.claude-NAME folders", accounts.remove_account(self.home, [str(extra)], str(extra))[1])
        os.rename(self.home / ".claude", self.home / ".claude-old")
        os.symlink(self.home / ".claude-work", self.home / ".claude")
        self.assertIn("~/.claude links to it", accounts.remove_account(self.home, [], ".claude-work")[1])
        self.assertTrue((self.home / ".claude-work/.credentials.json").exists())
        self.assertEqual(self.calls_made(), [])
        self.assertTrue(self.listed()[".claude-work"]["notRemovable"])

    def test_not_across_disks_without_gio(self):
        with mock.patch.object(accounts, "device", lambda p: 2 if str(p).endswith("files") else 1), \
                mock.patch.object(accounts.shutil, "which", lambda name: None):
            ok, message = accounts.remove_account(self.home, [], ".claude-work")
        self.assertFalse(ok)
        self.assertIn("another disk than your Trash", message)
        self.assertTrue((self.home / ".claude-work/.credentials.json").exists())


class CommandLineTests(unittest.TestCase):
    def test_usage(self):
        for args in ([], ["--logout"], ["--list", "--command"], ["--logout", "x", "--print-command"], ["--bogus"]):
            with self.assertRaises(SystemExit, msg=args):
                accounts.main(args)

    def test_runs_as_a_script(self):
        with tempfile.TemporaryDirectory() as home:
            env = {"HOME": home, "PATH": "/usr/bin:/bin", "XDG_CACHE_HOME": home + "/cache"}
            r = subprocess.run([sys.executable, "-I", str(CODE / "accounts.py"), "--list"], env=env,
                               capture_output=True, text=True, timeout=60)
            out = json.loads(r.stdout)
            self.assertEqual((out["ok"], out["accounts"]), (True, []))


if __name__ == "__main__":
    unittest.main()
