"""SSH hosts: the host list, and status/open/run through a stand-in ssh that
runs the command locally in a fake remote home."""
import contextlib
import importlib.util
import io
import json
import os
import shlex
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
CODE = Path(__file__).resolve().parent.parent / "package/contents/code"
sys.path.insert(0, str(CODE))
spec = importlib.util.spec_from_file_location("remote", CODE / "remote.py")
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)
cs = remote.cs

FAKE_SSH = r'''#!/bin/bash
# Stand-in for ssh: skip options, take the host, run the command here with bash
# in the fake remote home. FAKE_SSH_MODE picks a failure to imitate.
log="$FAKE_SSH_LOG"
while [ $# -gt 0 ]; do
  case "$1" in
    -o) shift 2 ;;
    -T|-t) shift ;;
    *) break ;;
  esac
done
host="$1"; shift
cmd="$*"
printf '%s\t%s\n' "$host" "$cmd" >> "$log"
case "$FAKE_SSH_MODE" in
  denied) echo "$host: Permission denied (publickey)." >&2; exit 255 ;;
  hostkey) echo "Host key verification failed." >&2; exit 255 ;;
  unreachable) echo "ssh: connect to host x port 22: Connection timed out" >&2; exit 255 ;;
  slow) sleep 5 ;;
  noisy) echo "Welcome to the cluster! Quota: 80%" ;;
esac
cd "$FAKE_HOME" && exec env -i HOME="$FAKE_HOME" PATH="$FAKE_PATH" XDG_CACHE_HOME="$FAKE_HOME/.cache" bash -c "$cmd"
'''


class HostListTests(unittest.TestCase):
    def test_parses_hosts_includes_and_skips_patterns(self):
        with tempfile.TemporaryDirectory() as tmp:
            ssh = Path(tmp)
            (ssh / "conf.d").mkdir()
            (ssh / "conf.d/lab.conf").write_text("Host gpu1 gpu2\n  HostName %h.lab.example\n  User me\n")
            (ssh / "config").write_text(textwrap.dedent(f"""\
                # global
                Host *
                    ForwardX11 yes
                Include {ssh}/conf.d/*.conf
                Host bastion
                 HostName bastion01.example.org
                 User alice
                 Port 2222
                Host gpubox
                 HostName=gpubox.intra
                 ProxyJump bastion
                 HostName second-value-ignored
                Host web-* !web-bad *.internal
                 User nobody
                Host pre
                Match host foo
                 User matched
                Host "quoted"
                """))
            hosts = remote.ssh_hosts(ssh / "config")
        self.assertEqual([h["name"] for h in hosts], ["gpu1", "gpu2", "bastion", "gpubox", "pre", "quoted"])
        by = {h["name"]: h for h in hosts}
        self.assertEqual(by["bastion"], {"name": "bastion", "hostname": "bastion01.example.org", "user": "alice",
                                      "port": "2222", "jump": ""})
        self.assertEqual((by["gpubox"]["hostname"], by["gpubox"]["jump"]), ("gpubox.intra", "bastion"))
        self.assertEqual(by["gpu2"]["user"], "me")
        self.assertEqual(by["pre"]["user"], "")  # a Match block doesn't apply to the host before it

    def test_missing_config(self):
        self.assertEqual(remote.ssh_hosts(Path("/nonexistent/config")), [])

    def test_include_loop_is_harmless(self):
        with tempfile.TemporaryDirectory() as tmp:
            cfg = Path(tmp) / "config"
            cfg.write_text(f"Include {cfg}\nHost a\n")
            self.assertEqual([h["name"] for h in remote.ssh_hosts(cfg)], ["a"])

    def test_host_names_checked(self):
        for bad in ("-oProxyCommand=evil", "a b", "", "x;rm", "$(id)"):
            with self.assertRaises(ValueError):
                remote.check_host(bad)
        self.assertEqual(remote.check_host("user@host.example:22"), "user@host.example:22")


class FakeSSH(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.bin, self.fake_home, self.log = root / "bin", root / "remote-home", root / "ssh.log"
        self.bin.mkdir()
        (self.bin / "ssh").write_text(FAKE_SSH)
        (self.bin / "ssh").chmod(0o755)
        # the remote: one profile with a finished background job
        prof = self.fake_home / ".claude"
        (prof / "sessions").mkdir(parents=True)
        (prof / "projects/-p").mkdir(parents=True)
        (prof / ".claude.json").write_text(json.dumps({"oauthAccount": {"accountUuid": "r", "organizationType": "claude_max",
                                                                       "displayName": "Remote Me"}}))
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 60))
        (prof / "jobs/abc12345").mkdir(parents=True)
        (prof / "jobs/abc12345/state.json").write_text(json.dumps(
            {"state": "done", "tempo": "idle", "sessionId": "abc12345", "name": "remote job", "cwd": "/srv/x",
             "updatedAt": stamp, "createdAt": stamp}))
        python_dir = str(Path(sys.executable).parent)
        self.env = {"PATH": f"{self.bin}:{os.environ['PATH']}", "FAKE_HOME": str(self.fake_home),
                    "FAKE_PATH": f"{python_dir}:/usr/bin:/bin", "FAKE_SSH_LOG": str(self.log),
                    "XDG_CACHE_HOME": str(root / "local-cache")}
        self.saved = {k: os.environ.get(k) for k in [*self.env, "FAKE_SSH_MODE"]}
        os.environ.update(self.env)

    def tearDown(self):
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def mode(self, name):
        os.environ["FAKE_SSH_MODE"] = name

    def calls(self):
        return [line.split("\t", 1) for line in self.log.read_text().splitlines()] if self.log.exists() else []


class StatusTests(FakeSSH):
    def test_status_of_a_host(self):
        out = remote.status("lab", recent=3, tokens=False)
        self.assertTrue(out["ok"], out)
        result = out["result"]
        (group,) = result["groups"]
        self.assertEqual(group["title"], "Remote Me · Max")
        (row,) = group["sessions"]
        self.assertEqual((row["name"], row["state"]), ("remote job", "done"))
        self.assertIn("claude attach abc12345", row["openCommand"])
        ((host, command),) = self.calls()
        self.assertEqual((host, command), ("lab", "python3 -I - --remote --recent 3 --no-tokens"))
        # nothing was written on the remote except the widget's cache
        self.assertEqual(sorted(p.name for p in (self.fake_home / ".cache").iterdir()), ["claude-widget"])

    def test_login_noise_before_the_answer(self):
        self.mode("noisy")
        self.assertTrue(remote.status("lab")["ok"])

    def test_failures_explained(self):
        cases = {"denied": "refused the login", "hostkey": "host key isn't known yet",
                 "unreachable": "Can't reach lab"}
        for mode, words in cases.items():
            self.mode(mode)
            out = remote.status("lab")
            self.assertFalse(out["ok"])
            self.assertIn(words, out["error"], mode)

    def test_python_missing(self):
        os.environ["FAKE_PATH"] = "/nonexistent"
        out = remote.status("lab")
        self.assertIn("python3 isn't installed on lab", out["error"])

    def test_timeout(self):
        self.mode("slow")
        old = remote.STATUS_TIMEOUT
        remote.STATUS_TIMEOUT = 1
        try:
            out = remote.status("lab")
        finally:
            remote.STATUS_TIMEOUT = old
        self.assertEqual(out, {"ok": False, "host": "lab", "error": "lab didn't answer within 1 s."})

    def test_main_prints_json(self):
        r = subprocess.run([sys.executable, "-I", str(CODE / "remote.py"), "--status", "lab", "--no-tokens"],
                           capture_output=True, text=True, env=os.environ)
        self.assertTrue(json.loads(r.stdout)["ok"], r.stdout + r.stderr)
        r = subprocess.run([sys.executable, "-I", str(CODE / "remote.py"), "--status", "-oProxyCommand=x"],
                           capture_output=True, text=True, env=os.environ)
        self.assertFalse(json.loads(r.stdout)["ok"])


class ActionTests(FakeSSH):
    def test_run_and_its_errors(self):
        self.assertEqual(remote.run("lab", "echo stopped abc"), (True, "stopped abc"))
        self.assertEqual(remote.run("lab", "echo oops >&2; exit 3"), (False, "oops"))
        self.mode("denied")
        ok, message = remote.run("lab", "true")
        self.assertFalse(ok)
        self.assertIn("refused the login", message)

    def test_dismiss_on_the_host(self):
        self.assertEqual(remote.dismiss("lab", "abc12345"), (True, "Removed from the list"))
        self.assertIn("abc12345", cs.load_dismissed(self.fake_home / ".cache/claude-widget"))
        out = remote.status("lab", tokens=False)
        self.assertEqual(out["result"]["groups"][0]["sessions"], [])
        self.assertEqual(remote.dismiss("lab")[0], True)
        self.assertEqual(cs.load_dismissed(self.fake_home / ".cache/claude-widget"), {})

    def test_stop_an_idle_chat_on_the_host(self):
        proc = subprocess.Popen([sys.executable, "-c", "print('ready', flush=True); import time; time.sleep(60)"],
                                stdout=subprocess.PIPE, text=True)
        self.addCleanup(proc.stdout.close)
        self.addCleanup(lambda: (proc.kill(), proc.wait()) if proc.poll() is None else None)
        self.assertEqual(proc.stdout.readline().strip(), "ready")
        (self.fake_home / f".claude/sessions/{proc.pid}.json").write_text(json.dumps(
            {"pid": proc.pid, "procStart": cs.proc_start_time(proc.pid), "sessionId": "idle-there",
             "cwd": "/srv/x", "kind": "interactive", "status": "idle"}))
        self.assertEqual(remote.end("lab", "idle-there", ".claude-work"), (False, "That session isn't running any more"))
        self.assertIsNone(proc.poll())
        self.assertEqual(remote.end("lab", "idle-there", ".claude"), (True, "Stopped; the chat is kept"))
        self.assertEqual(proc.wait(timeout=5), -15)
        self.assertEqual(self.calls()[-1], ["lab", "python3 -I - --remote --end idle-there --profile .claude"])

    def test_stop_a_working_chat_or_interrupt_it_on_the_host(self):
        proc = subprocess.Popen([sys.executable, "-c", "print('ready', flush=True); import time; time.sleep(60)"],
                                stdout=subprocess.PIPE, text=True)
        self.addCleanup(proc.stdout.close)
        self.addCleanup(lambda: (proc.kill(), proc.wait()) if proc.poll() is None else None)
        self.assertEqual(proc.stdout.readline().strip(), "ready")
        (self.fake_home / f".claude/sessions/{proc.pid}.json").write_text(json.dumps(
            {"pid": proc.pid, "procStart": cs.proc_start_time(proc.pid), "sessionId": "busy-there",
             "cwd": "/srv/x", "kind": "interactive", "status": "busy"}))
        self.assertIn("doesn't run in tmux", remote.interrupt("lab", "busy-there")[1])
        self.assertEqual(self.calls()[-1], ["lab", "python3 -I - --remote --interrupt busy-there"])
        self.assertFalse(remote.end("lab", "busy-there")[0])   # working: only when you were told
        self.assertIsNone(proc.poll())
        out = subprocess.run([sys.executable, "-I", str(CODE / "remote.py"), "--end", "lab", "busy-there", ".claude", "--busy"],
                             capture_output=True, text=True, env=os.environ).stdout
        self.assertEqual(json.loads(out), {"ok": True, "message": "Stopped; the chat is kept"})
        self.assertEqual(proc.wait(timeout=5), -15)
        self.assertEqual(self.calls()[-1], ["lab", "python3 -I - --remote --end busy-there --profile .claude --busy"])

    def test_host_says_whether_claude_is_there(self):
        self.assertEqual(remote.status("lab", tokens=False)["result"]["cli"], {"installed": False})
        claude = self.fake_home / ".local/bin/claude"
        claude.parent.mkdir(parents=True)
        claude.write_text("#!/bin/sh\n")
        claude.chmod(0o755)
        result = remote.status("lab", tokens=False)["result"]
        self.assertEqual((result["cli"], result["claude"]), ({"installed": True}, str(claude)))

    def test_open_runs_the_command_unchanged_on_the_host(self):
        # A command with quotes, spaces and $: it must reach the host as is.
        command = "cd '/srv/my dir' 2>/dev/null; printf '%s\\n' \"$HOME\" 'it''s' > /dev/null; echo done"
        opened = []
        import jump
        old = jump.open_terminal
        jump.open_terminal = lambda cwd, cmd: opened.append(cmd) or True
        try:
            self.assertEqual(remote.open_remote("lab", command), (True, "Opened a terminal on lab"))
        finally:
            jump.open_terminal = old
        (ssh_line,) = opened
        words = shlex.split(ssh_line)
        self.assertEqual((words[0], words[-3:]), ("ssh", ["-t", "lab", command]))
        self.assertNotIn("BatchMode=yes", ssh_line)  # a terminal may ask for a password
        out = subprocess.run(["bash", "-c", ssh_line], capture_output=True, text=True, env=os.environ)
        self.assertEqual(out.stdout.strip(), "done")
        self.assertEqual(self.calls()[-1], ["lab", command])

    def test_a_subagents_run_comes_here(self):
        d = self.fake_home / ".claude/projects/-p/abc12345/subagents"
        d.mkdir(parents=True)
        (d / "agent-ag1.meta.json").write_text(json.dumps({"agentType": "Explore", "description": "Check the host"}))
        report = {"type": "tool_use", "id": "h", "name": "SubagentHandback",
                  "input": {"message": "The widget's answer starts after \n" + cs.REMOTE_MARK + " {\"ok\": false}"}}
        (d / "agent-ag1.jsonl").write_text("".join(json.dumps(l) + "\n" for l in (
            {"type": "user", "isSidechain": True, "message": {"content": "Look around"}},
            {"type": "assistant", "isSidechain": True, "message": {"content": [report]}})))
        self.mode("noisy")  # a login banner first
        import jump
        opened, old = [], jump.open_file
        jump.open_file = lambda path: opened.append(path) or True
        try:
            ok, message, path = remote.agent_run("lab", "abc12345", "ag1")
            self.assertEqual(self.calls()[-1], ["lab", "python3 -I - --remote --agent-run ag1 --chat abc12345"])
            self.assertEqual(remote.agent_run("lab", "abc12345", "nope", ".claude", open_it=False),
                             (False, "lab: Can't find that subagent's transcript", None))
            self.assertEqual(self.calls()[-1], ["lab", "python3 -I - --remote --agent-run nope --chat abc12345 --profile .claude"])
        finally:
            jump.open_file = old
        self.assertEqual((ok, message), (True, "The run of “Check the host” on lab"))
        self.assertEqual(Path(path).parent, Path(self.env["XDG_CACHE_HOME"]) / "claude-widget/agent-runs")  # saved here
        self.assertIn(cs.REMOTE_MARK + ' {"ok": false}', Path(path).read_text())  # the marker in the run is just text
        self.assertEqual(opened, [Path(path)])
        self.mode("unreachable")
        self.assertFalse(remote.agent_run("lab", "abc12345", "ag1")[0])

    def test_agent_run_command_line(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            remote.main(["--agent-run", "lab", "abc12345", "missing", "--no-open"])
        self.assertEqual(json.loads(out.getvalue()), {"ok": False, "message": "lab: Can't find that subagent's transcript"})

    def test_control_socket_folder_is_short_and_only_yours(self):
        saved = (os.environ.get("XDG_RUNTIME_DIR"), remote.SOCKET_TMP)

        def restore():
            os.environ.pop("XDG_RUNTIME_DIR", None)
            if saved[0] is not None:
                os.environ["XDG_RUNTIME_DIR"] = saved[0]
            remote.SOCKET_TMP = saved[1]
        self.addCleanup(restore)
        with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
            os.environ["XDG_RUNTIME_DIR"] = tmp
            d = remote.control_dir()
            self.assertEqual(d, Path(tmp) / "claude-status-ssh")
            self.assertEqual(d.stat().st_mode & 0o777, 0o700)
            self.assertIn(f"ControlPath={d}/%C", remote.ssh_options())
            self.assertLessEqual(len(f"{d}/{'0' * 40}.{'x' * 16}"), 107)  # what ssh binds
            # no runtime folder: one in /tmp, unless it's a link (or someone else's)
            del os.environ["XDG_RUNTIME_DIR"]
            remote.SOCKET_TMP = tmp
            self.assertEqual(remote.control_dir(), Path(tmp) / f"claude-status-ssh-{os.getuid()}")
            os.rmdir(str(remote.control_dir()))
            os.symlink(tmp, str(Path(tmp) / f"claude-status-ssh-{os.getuid()}"))
            self.assertIsNone(remote.control_dir())
            self.assertNotIn("ControlMaster=auto", remote.ssh_options())
            # a runtime folder so long that the socket path wouldn't fit: none either
            os.environ["XDG_RUNTIME_DIR"] = str(Path(tmp) / ("r" * 60))
            os.mkdir(os.environ["XDG_RUNTIME_DIR"])
            self.assertIsNone(remote.control_dir())


if __name__ == "__main__":
    unittest.main()
