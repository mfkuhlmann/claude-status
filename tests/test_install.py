"""install.sh in a made-up home: stand-ins for kpackagetool6, gdbus and
GNOME's tools only note how they were called, so nothing is installed for
real."""
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STUB = "#!/bin/sh\necho \"$(basename \"$0\") $*\" >> \"$STUB_LOG\"\n"


class InstallTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name) / "home"
        self.bin = Path(tmp.name) / "bin"
        self.log = Path(tmp.name) / "stubs.log"
        self.home.mkdir()
        self.bin.mkdir()
        for name in ("kpackagetool6", "gdbus", "gnome-extensions", "gsettings"):
            self.stub(name, STUB)

    def stub(self, name, text):
        (self.bin / name).write_text(text)
        (self.bin / name).chmod(0o755)

    def install(self, *args, env=None):
        env = {"HOME": str(self.home), "PATH": f"{self.bin}:{os.environ['PATH']}", "STUB_LOG": str(self.log),
               "XDG_CURRENT_DESKTOP": "KDE", **(env or {})}
        return subprocess.run(["bash", str(ROOT / "install.sh"), "--yes", *args], capture_output=True, text=True,
                               env=env, stdin=subprocess.DEVNULL)

    def statusline(self, command, text):
        script = self.home / ".claude/statusline.sh"
        script.parent.mkdir(parents=True, exist_ok=True)
        script.write_text(text)
        script.chmod(0o750)
        (self.home / ".claude/settings.json").write_text('{"statusLine": {"type": "command", "command": "%s"}}' % command)
        return script

    def test_no_status_line_says_how_to_add_it(self):
        out = self.install()
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("No Claude profile runs a status-line script", out.stdout)
        self.assertNotIn("not found:", out.stdout)

    def test_home_variable_and_no_last_newline(self):
        script = self.statusline("bash $HOME/.claude/statusline.sh", "#!/bin/bash\ninput=\"$(cat)\"")
        out = self.install()
        self.assertEqual(out.returncode, 0, out.stderr)
        text = script.read_text()
        self.assertTrue(text.startswith("#!/bin/bash\ninput=\"$(cat)\"\n# >>> claude-widget >>>\n"), text)
        self.assertEqual(stat.S_IMODE(script.stat().st_mode), 0o750)  # its mode kept
        self.assertEqual(len(list(script.parent.glob("statusline.sh.bak.*"))), 1)
        self.assertIn("already up to date", self.install().stdout)
        ran = subprocess.run(["bash", str(script)], input='{"session_id": "s1"}', capture_output=True, text=True,
                             env={**os.environ, "HOME": str(self.home)})
        self.assertEqual(ran.returncode, 0, ran.stderr)

    def test_a_script_without_the_sh_suffix(self):
        script = self.statusline("~/.claude/statusline.sh", "")
        script.rename(self.home / ".claude/statusline")
        (self.home / ".claude/statusline").write_text("#!/bin/sh\ninput=$(cat)\necho ok\n")
        (self.home / ".claude/settings.json").write_text('{"statusLine": {"command": "~/.claude/statusline"}}')
        self.install()
        self.assertIn("# >>> claude-widget >>>", (self.home / ".claude/statusline").read_text())

    def test_a_line_that_goes_on_isnt_the_place(self):
        script = self.statusline("~/.claude/statusline.sh", "#!/bin/sh\ninput=$(cat) && echo \"$input\"\n")
        out = self.install()
        self.assertIn("no 'input=$(cat)' line found", out.stderr)
        self.assertNotIn("claude-widget", script.read_text())

    def test_uninstall_keeps_the_snippet_another_front_end_uses(self):
        script = self.statusline("~/.claude/statusline.sh", "#!/bin/sh\ninput=$(cat)\n")
        self.install()
        (self.home / ".vscode/extensions/wzaielamri.claude-status-1.10.0").mkdir(parents=True)
        out = self.install("--uninstall")
        self.assertIn("Kept the status-line snippet: the VS Code extension still uses it.", out.stdout)
        self.assertIn("claude-widget", script.read_text())

    def test_the_permission_hook_with_plasma(self):
        self.statusline("~/.claude/statusline.sh", "#!/bin/sh\ninput=$(cat)\n")
        out = self.install()
        self.assertIn("Permission prompts can be answered from the widget", out.stdout)
        settings = (self.home / ".claude/settings.json").read_text()
        self.assertIn(".local/share/claude-widget/permission-hook.py", settings)
        self.assertTrue((self.home / ".local/share/claude-widget/permission-hook.py").is_file())
        self.assertIn("the hook is up to date", self.install().stdout)  # (an upgrade keeps it, brought up to date)
        out = self.install("--uninstall")
        self.assertNotIn("permission-hook", (self.home / ".claude/settings.json").read_text())
        self.assertFalse((self.home / ".local/share/claude-widget/permission-hook.py").exists())

    @unittest.skipUnless(shutil.which("kwriteconfig6") and shutil.which("kreadconfig6"), "needs KDE's kwriteconfig6")
    def test_the_chat_panes_icon(self):
        rules = self.home / ".config/kwinrulesrc"
        rules.parent.mkdir(parents=True)
        mine = "[General]\ncount=1\nrules=mine\n\n[mine]\nDescription=my rule\n"
        rules.write_text(mine)
        out = self.install()
        self.assertIn("The chat pane shows Talpa in the taskbar", out.stdout)
        text = rules.read_text()
        self.assertIn("count=2\nrules=mine,claude-status-chat-pane\n", text)
        self.assertIn("[claude-status-chat-pane]\n", text)
        self.assertIn("title=— Claude chat\n", text)
        self.assertIn("desktopfile=org.wzaielamri.claudestatus.chat\ndesktopfilerule=2\n", text)
        self.assertIn("[mine]\nDescription=my rule\n", text)
        desktop = self.home / ".local/share/applications/org.wzaielamri.claudestatus.chat.desktop"
        self.assertIn(f"Icon={self.home}/.local/share/plasma/plasmoids/org.wzaielamri.claudestatus/contents/pets/window.svg\n",
                      desktop.read_text())
        self.assertIn("org.kde.KWin.reconfigure", self.log.read_text())
        out = self.install()  # (an upgrade: the same rule, once)
        self.assertNotIn("The chat pane shows Talpa", out.stdout)
        self.assertIn("count=2\nrules=mine,claude-status-chat-pane\n", rules.read_text())
        self.install("--uninstall")
        self.assertEqual(rules.read_text(), mine)
        self.assertFalse(desktop.exists())

    def test_gnome_45_to_48_refused(self):
        self.stub("gnome-shell", "#!/bin/sh\necho 'GNOME Shell 46.0'\n")
        out = self.install("--gnome")
        self.assertEqual(out.returncode, 1)
        self.assertIn("GNOME Shell 46 isn't supported", out.stderr)
        self.assertNotIn("gnome-extensions install", self.log.read_text() if self.log.exists() else "")


if __name__ == "__main__":
    unittest.main()
