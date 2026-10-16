#!/usr/bin/env python3
"""SSH hosts for the Claude Status widget.

    python3 -I remote.py --hosts                    hosts named in ~/.ssh/config
    python3 -I remote.py --status HOST [--done-hours H] [--recent N] [--no-tokens]
    python3 -I remote.py --open HOST COMMAND        a terminal running COMMAND on HOST
    python3 -I remote.py --run HOST COMMAND         run COMMAND on HOST (e.g. claude stop)
    python3 -I remote.py --dismiss HOST SESSION_ID  hide a finished session of HOST
    python3 -I remote.py --undismiss-all HOST

--status runs claude_status.py on HOST: the script goes to `python3 -I -` on
the host's stdin, so nothing is installed there (it keeps its caches in the
host's ~/.cache/claude-widget, like here). SSH runs in batch mode, so it never
asks for a password or a host key: log in once in a terminal for that. One
connection per host is kept open for a few minutes (ControlMaster), so polls
are quick even through a jump host. Prints one JSON line.
"""

import glob
import json
import os
import re
import shlex
import stat
import subprocess
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ inside the installed widget
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script dir off sys.path
import claude_status as cs  # noqa: E402

HERE = Path(__file__).resolve().parent
HOST_NAME = re.compile(r"^[A-Za-z0-9_.@][A-Za-z0-9_.@:-]*$")
STATUS_TIMEOUT = 45
RUN_TIMEOUT = 60


# ---------------------------------------------------------------- ~/.ssh/config


def config_lines(path, depth=0, seen=None):
    """(keyword, value) of an ssh config file, with Include files spliced in."""
    seen = set() if seen is None else seen
    try:
        real = path.resolve()
        if real in seen or depth > 8:
            return
        seen.add(real)
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"([A-Za-z]+)\s*(?:=\s*|\s+)(.*)", line)
        if not m:
            continue
        key, value = m.group(1).lower(), m.group(2).strip()
        if key == "include":
            for pattern in shlex.split(value):
                pattern = os.path.expanduser(pattern)
                if not os.path.isabs(pattern):
                    pattern = str(Path.home() / ".ssh" / pattern)
                for match in sorted(glob.glob(pattern)):
                    yield from config_lines(Path(match), depth + 1, seen)
        else:
            yield key, value


def ssh_hosts(path=None):
    """Hosts with a name of their own in ~/.ssh/config (no wildcard patterns),
    in file order, with what's useful to show next to the name."""
    path = path or Path.home() / ".ssh" / "config"
    hosts, current = {}, []
    for key, value in config_lines(path):
        if key == "host":
            current = []
            for name in value.split():
                name = name.strip('"')
                if any(c in name for c in "*?!") or not HOST_NAME.match(name):
                    continue
                hosts.setdefault(name, {"name": name, "hostname": "", "user": "", "port": "", "jump": ""})
                current.append(name)
        elif key == "match":
            current = []
        elif current and key in ("hostname", "user", "port", "proxyjump"):
            field = "jump" if key == "proxyjump" else key
            for name in current:
                if not hosts[name][field]:  # ssh uses the first value it sees
                    hosts[name][field] = value
    return list(hosts.values())


# ---------------------------------------------------------------- talking to a host


SOCKET_TMP = "/tmp"
SOCKET_DIR_MAX = 49  # a socket path may have 107 characters; ssh adds 58 (/%C and a temporary suffix)


def control_dir():
    """Folder for ssh's shared connections (one per host), or None to go
    without. Short on purpose: under ~/.cache a long home folder name made
    the socket path too long. $XDG_RUNTIME_DIR (/run/user/<uid>) is short and
    private; else a folder in /tmp that only you own. The VS Code extension
    uses the same folder (sshControl.ts), so both share the connections."""
    runtime = os.environ.get("XDG_RUNTIME_DIR", "")
    if os.path.isabs(runtime) and os.path.isdir(runtime):
        d = Path(runtime) / "claude-status-ssh"
    else:
        d = Path(SOCKET_TMP) / f"claude-status-ssh-{os.getuid()}"
    if len(str(d)) > SOCKET_DIR_MAX:
        return None
    try:
        d.mkdir(mode=0o700, exist_ok=True)
        st = os.lstat(str(d))
        if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid():
            return None  # a link, or someone else's: no sockets there
        if st.st_mode & 0o077:
            os.chmod(str(d), 0o700)
    except OSError:
        return None
    return d


def ssh_options(batch=True):
    """Options for every connection: batch mode (never ask, never hang), keep
    one connection per host open for reuse, no X11/agent forwarding."""
    d = control_dir()
    opts = ["-o", "ControlMaster=auto", "-o", f"ControlPath={d}/%C", "-o", "ControlPersist=300"] if d else []
    opts += ["-o", "ServerAliveInterval=10", "-o", "ServerAliveCountMax=3"]
    if batch:
        opts += ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ForwardX11=no", "-o", "ForwardAgent=no"]
    return opts


def check_host(host):
    if not isinstance(host, str) or not HOST_NAME.match(host):
        raise ValueError(f"not a host name: {host!r}")
    return host


def explain(host, code, stderr):
    """A sentence for why talking to host failed."""
    text = stderr.strip()
    last = text.splitlines()[-1] if text else ""
    low = text.lower()
    if "host key verification failed" in low or "no matching host key" in low:
        return f"{host}'s host key isn't known yet. Run ssh {host} once in a terminal to accept it."
    if "permission denied" in low or "too many authentication failures" in low:
        return f"{host} refused the login. The widget can't type a password: load your key into the agent (ssh-add) or run ssh {host} once in a terminal."
    if "could not resolve hostname" in low or "name or service not known" in low:
        return f"Can't find {host} (DNS). Are you on the right network or VPN?"
    if any(s in low for s in ("connection timed out", "operation timed out", "no route to host",
                              "network is unreachable", "connection refused", "connection closed by")):
        return f"Can't reach {host}: {last}"
    if code == 127 or "python3: command not found" in low or "python3: not found" in low:
        return f"python3 isn't installed on {host}; the widget needs it there."
    return f"{host}: {last}" if last else f"{host}: ssh failed (exit {code})"


def status(host, done_hours=None, recent=None, tokens=True):
    """The widget's status of host, as claude_status.py --remote prints it there."""
    host = check_host(host)
    args = ["--remote"]
    if done_hours is not None:
        args += ["--done-hours", str(done_hours)]
    if recent is not None:
        args += ["--recent", str(recent)]
    if not tokens:
        args.append("--no-tokens")
    script = (HERE / "claude_status.py").read_text(encoding="utf-8")
    command = ["ssh", *ssh_options(), "-T", host, "python3 -I - " + " ".join(shlex.quote(a) for a in args)]
    started = time.time()
    try:
        r = subprocess.run(command, input=script, capture_output=True, text=True, timeout=STATUS_TIMEOUT)
    except subprocess.TimeoutExpired:
        return {"ok": False, "host": host, "error": f"{host} didn't answer within {STATUS_TIMEOUT} s."}
    except OSError as exc:
        return {"ok": False, "host": host, "error": f"Can't run ssh: {exc}"}
    elapsed = int((time.time() - started) * 1000)
    mark = r.stdout.rfind(cs.REMOTE_MARK)
    if mark < 0:
        return {"ok": False, "host": host, "error": explain(host, r.returncode, r.stderr), "elapsedMs": elapsed}
    try:
        result = json.loads(r.stdout[mark + len(cs.REMOTE_MARK):])
    except ValueError:
        return {"ok": False, "host": host, "error": f"{host} sent an answer the widget can't read.", "elapsedMs": elapsed}
    if not result.get("ok"):
        return {"ok": False, "host": host, "error": f"{host}: {result.get('error') or 'status failed'}", "elapsedMs": elapsed}
    return {"ok": True, "host": host, "result": result, "elapsedMs": elapsed}


def run(host, command, stdin=None):
    """Run a shell command on host; (ok, last line of its output)."""
    host = check_host(host)
    try:
        r = subprocess.run(["ssh", *ssh_options(), "-T", host, command], input=stdin, capture_output=True,
                           text=True, timeout=RUN_TIMEOUT)
    except subprocess.TimeoutExpired:
        return False, f"{host} didn't answer within {RUN_TIMEOUT} s"
    except OSError as exc:
        return False, f"Can't run ssh: {exc}"
    lines = [l.strip() for l in (r.stdout + "\n" + r.stderr).splitlines() if l.strip()]
    if r.returncode != 0:
        return False, explain(host, r.returncode, r.stderr) if r.returncode == 255 else (lines[-1] if lines else f"exit {r.returncode}")
    return True, lines[-1] if lines else "Done"


def dismiss(host, session_id=None):
    """Hide a finished session in the host's list (or show all again)."""
    script = (HERE / "claude_status.py").read_text(encoding="utf-8")
    args = "--dismiss " + shlex.quote(session_id) if session_id else "--undismiss-all"
    ok, message = run(host, f"python3 -I - --remote {args}", stdin=script)
    if ok and cs.REMOTE_MARK in message:
        try:
            answer = json.loads(message.split(cs.REMOTE_MARK, 1)[1])
            return bool(answer.get("ok")), answer.get("message") or ""
        except ValueError:
            pass
    return ok, message


def open_remote(host, command):
    """A local terminal running command on host (ssh -t: Claude needs a terminal).
    Not in batch mode: ssh may ask for a password or host key there."""
    host = check_host(host)
    import jump
    ssh = " ".join(shlex.quote(a) for a in ["ssh", *ssh_options(batch=False), "-t", host, command])
    if not jump.open_terminal(str(Path.home()), ssh):
        return False, "No terminal found to open the session in"
    return True, f"Opened a terminal on {host}"


USAGE = __doc__.split("\n\n")[1]


def main(argv=None):
    args = sys.argv[1:] if argv is None else list(argv)
    if not args:
        sys.exit(USAGE)
    action, args = args[0], args[1:]
    try:
        if action == "--hosts":
            out = {"ok": True, "hosts": ssh_hosts()}
        elif action == "--status" and args:
            host, rest, kw = args[0], args[1:], {}
            while rest:
                arg = rest.pop(0)
                if arg == "--done-hours" and rest:
                    kw["done_hours"] = float(rest.pop(0))
                elif arg == "--recent" and rest:
                    kw["recent"] = int(rest.pop(0))
                elif arg == "--no-tokens":
                    kw["tokens"] = False
                else:
                    sys.exit(USAGE)
            out = status(host, **kw)
        elif action in ("--open", "--run") and len(args) == 2:
            ok, message = (open_remote if action == "--open" else run)(args[0], args[1])
            out = {"ok": ok, "message": message}
        elif action == "--dismiss" and len(args) == 2:
            ok, message = dismiss(args[0], args[1])
            out = {"ok": ok, "message": message}
        elif action == "--undismiss-all" and len(args) == 1:
            ok, message = dismiss(args[0])
            out = {"ok": ok, "message": message}
        else:
            sys.exit(USAGE)
    except (ValueError, OSError) as exc:
        out = {"ok": False, "error": str(exc), "message": str(exc)}
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
