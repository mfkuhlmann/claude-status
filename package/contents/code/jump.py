#!/usr/bin/env python3
"""Bring a Claude Code session to the front, stop a background one, or start
a new chat (used by the Claude Status widget).

    python3 -I jump.py SESSION_ID [--config-dir DIR]...
    python3 -I jump.py --stop SESSION_ID [--config-dir DIR]...
    python3 -I jump.py --new-chat PROFILE_DIRNAME [--cwd FOLDER] [--config-dir DIR]...
    python3 -I jump.py --new-chat PROFILE_DIRNAME --choose-folder   (ask for the folder first)
    python3 -I jump.py --new-chat PROFILE_DIRNAME [--cwd FOLDER | --choose-folder] --vscode
                                                 (in VS Code's Claude extension instead)
    python3 -I jump.py --remote-new-vscode HOST [--cwd FOLDER_ON_HOST]   (the same on an SSH host)
    python3 -I jump.py --dismiss SESSION_ID      (hide a finished session in the widget)
    python3 -I jump.py --undismiss-all           (show hidden ones again)
    python3 -I jump.py --resume SESSION_ID --profile PROFILE    (reopen a chat there)
    python3 -I jump.py --continue SESSION_ID --profile PROFILE  (share it if needed, reopen it there)
    python3 -I jump.py --share SESSION_ID                       (share it with every account)
    python3 -I jump.py --unshare SESSION_ID --profile PROFILE   (keep it only there)

Sharing is done by ~/.claude-shared/profile-tools/shared-chats.sh; a chat
that's open in a session isn't touched (it can be open in one at a time).

`--stop` runs `claude stop <id>` for a background session: it's interrupted,
its conversation is kept, and `claude attach <id>` resumes it.

- terminal session: switch Konsole to the tab running it (or select its tmux
  pane) and raise that window;
- VS Code session: raise the VS Code window of the project and reveal the
  conversation through the Claude extension's vscode:// link;
- background job: raise a terminal already attached to it, else open a new
  Konsole tab running `claude attach <id>`;
- a finished chat with no session or background job on that profile (a
  shared chat last used there): open a terminal running `claude --resume <id>`.

Windows are raised with a short KWin script: on Plasma Wayland that is the
way to activate another application's window. On GNOME the Claude Status
extension raises them (it runs inside GNOME Shell and offers RaiseWindow on
D-Bus). Prints one JSON line, {"ok": bool, "message": str}.
"""

import ast
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlencode

sys.dont_write_bytecode = True  # no __pycache__ inside the installed widget
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script dir off sys.path
import claude_status as cs  # noqa: E402

KWIN_SCRIPT = """\
const want = %s;
let best = null, bestScore = -1;
for (const w of workspace.windowList()) {
    if (!w.normalWindow) continue;
    const rank = want.pids.indexOf(w.pid);
    if (rank < 0) continue;
    const hit = want.caption && w.caption.indexOf(want.caption) >= 0;
    if (want.require && !hit) continue;
    let score = 100 - rank;  // the nearest ancestor owning a window wins
    if (hit) score += 1000;
    if (want.prefer && w.caption.indexOf(want.prefer) >= 0) score += 500;
    if (score > bestScore) { best = w; bestScore = score; }
}
if (best) {
    if (best.minimized) best.minimized = false;
    if (!best.onAllDesktops && best.desktops.length && best.desktops.indexOf(workspace.currentDesktop) < 0)
        workspace.currentDesktop = best.desktops[0];
    workspace.activeWindow = best;
}
"""


# ---------------------------------------------------------------- helpers


def run(args, timeout=5):
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return 1, ""


def dbus_call(dest, path, method, *args):
    """Call a session-bus method via gdbus; returns the first result value or None."""
    code, out = run(["gdbus", "call", "--session", "--dest", dest, "--object-path", path,
                     "--method", method, *[str(a) for a in args]])
    if code != 0:
        return None
    for text in (out, out.replace("(true,)", "(True,)").replace("(false,)", "(False,)")):
        try:
            value = ast.literal_eval(text)
        except (ValueError, SyntaxError):
            continue
        return value[0] if isinstance(value, tuple) and value else value
    return out


def dbus_children(dest, path):
    """Names of the child objects of path (gdbus also lists path itself, as "node /path")."""
    code, out = run(["gdbus", "introspect", "--session", "--dest", dest, "--object-path", path])
    if code != 0:
        return []
    names = (line.split()[1] for line in out.splitlines()
             if line.strip().startswith("node ") and len(line.split()) > 1)
    return [n for n in names if not n.startswith("/")]


def parent_pid(pid):
    try:
        stat = Path(f"/proc/{pid}/stat").read_text()
        return int(stat[stat.rfind(")") + 2:].split()[1])
    except (OSError, ValueError, IndexError):
        return 0


def proc_name(pid):
    try:
        return Path(f"/proc/{pid}/comm").read_text().strip()
    except OSError:
        return ""


def ancestors(pid):
    """pid, its parent, grandparent, ... up to (not including) init."""
    chain = []
    while isinstance(pid, int) and pid > 1 and pid not in chain and len(chain) < 64:
        chain.append(pid)
        pid = parent_pid(pid)
    return chain


def raise_window(pids, caption="", require=False, prefer=""):
    """Activate the window owned by the nearest of pids (preferring one whose
    title has caption; only those if require; and then one that has prefer).
    KWin does it on Plasma; without KWin, the GNOME extension does."""
    want = {"pids": pids, "caption": caption, "require": require, "prefer": prefer}
    return raise_window_kwin(want) or raise_window_gnome(want)


def raise_window_kwin(want):
    fd, path = tempfile.mkstemp(prefix="claude-status-", suffix=".js")
    name = f"claude-status-jump-{os.getpid()}"
    try:
        with os.fdopen(fd, "w") as f:
            f.write(KWIN_SCRIPT % json.dumps(want))
        script_id = dbus_call("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.loadScript", path, name)
        if not isinstance(script_id, int) or script_id < 0:
            return False
        dbus_call("org.kde.KWin", f"/Scripting/Script{script_id}", "org.kde.kwin.Script.run")
        time.sleep(0.2)
        return True
    finally:
        dbus_call("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", name)
        os.unlink(path)


def on_gnome():
    """Is this a GNOME session (Ubuntu's says "ubuntu:GNOME")? Plasma says "KDE"."""
    desktops = os.environ.get("XDG_CURRENT_DESKTOP", "").split(":")
    return "GNOME" in desktops and "KDE" not in desktops


def raise_hint():
    return "is the Claude Status extension enabled?" if on_gnome() else "is KWin scripting available?"


GNOME_RAISER = ("org.gnome.Shell", "/org/gnome/Shell/Extensions/ClaudeStatus",
                "org.gnome.Shell.Extensions.ClaudeStatus.RaiseWindow")


def raise_window_gnome(want):
    """Ask the Claude Status GNOME Shell extension to raise the window (the
    same choice as KWIN_SCRIPT); False when it isn't running."""
    dest, path, method = GNOME_RAISER
    # gdbus reads its arguments as GVariant text: a quoted string literal
    # (JSON's escapes are GVariant's too) so the JSON isn't read as a dict
    argument = json.dumps(json.dumps(want, ensure_ascii=False), ensure_ascii=False)
    return dbus_call(dest, path, method, argument) is True


# ---------------------------------------------------------------- finding the session


def find_session(home, extra_dirs, session_id, profile_dir=None):
    """(profile, live session entry or None, job record or None, job id or None).

    profile_dir (e.g. ".claude-work") limits the search to one profile: a chat
    shared across profiles has the same id in each."""
    every = cs.discover_profiles(home, extra_dirs)
    profiles = [p for p in every if not profile_dir or matches(p, profile_dir)]
    # A live session is looked up in every profile: after ~/.claude was
    # switched, its file can still be in the profile it started on.
    for entry, runs_on, holder in cs.live_entries_all(every):
        if profile_dir and not (matches(runs_on, profile_dir) or matches(holder, profile_dir)):
            continue
        if session_id in (entry.get("sessionId"), entry.get("jobId")) and entry.get("kind") in cs.SESSION_KINDS \
                and not entry.get("spare") and not entry.get("parkedJobId"):
            job_id = entry.get("jobId") if isinstance(entry.get("jobId"), str) else None
            return runs_on, entry, read_job(runs_on, job_id) or read_job(holder, job_id), job_id
    for profile in profiles:  # a background job whose process is gone
        try:
            dirs = [d for d in (profile.path / "jobs").iterdir() if d.is_dir()]
        except OSError:
            continue
        for d in dirs:
            job = cs.read_json(d / "state.json")
            if isinstance(job, dict) and session_id in (job.get("sessionId"), d.name):
                return profile, None, job, d.name
    return None, None, None, None


def matches(profile, name):
    """Is name (a folder name like .claude-work, or a path) this profile?"""
    if name in (profile.dirname, profile.key, *profile.snapshot_dirs):
        return True
    try:
        return Path(name).expanduser().resolve() == profile.real
    except (OSError, RuntimeError):
        return False


def find_chat(home, extra_dirs, session_id, profile_dir=None):
    """(profile, transcript) of a chat with no session or job: the first
    profile (or the one named) that has its transcript."""
    for profile in cs.discover_profiles(home, extra_dirs):
        if profile_dir and not matches(profile, profile_dir):
            continue
        path = cs.transcript_path(profile, session_id)
        if path is not None:
            return profile, path
    return None, None


def chat_folder(path):
    """The folder a chat last ran in (the last "cwd" in its transcript)."""
    try:
        size = path.stat().st_size
        with open(path, "rb") as f:
            f.seek(max(0, size - 262144))
            lines = f.read().splitlines()
    except OSError:
        return None
    for line in reversed(lines):
        if b'"cwd"' not in line:
            continue
        try:
            cwd = json.loads(line).get("cwd")
        except (ValueError, AttributeError):
            continue
        if isinstance(cwd, str) and cwd.startswith("/"):
            return cwd
    return None


def live_entries(profile):
    try:
        files = sorted((profile.path / "sessions").glob("*.json"))
    except OSError:
        return []
    entries = (cs.read_json(f) for f in files)
    return [e for e in entries if isinstance(e, dict) and cs.is_alive(e)]


def read_job(profile, job_id):
    if not job_id or "/" in job_id:
        return None
    job = cs.read_json(profile.path / "jobs" / job_id / "state.json")
    return job if isinstance(job, dict) else None


# ---------------------------------------------------------------- terminals


def konsole_pids():
    return [int(p) for p in os.listdir("/proc") if p.isdigit() and proc_name(int(p)) == "konsole"]


def konsole_tabs(konsole_pid):
    """[(session, shell pid, foreground pid, title)] of one Konsole process."""
    service = f"org.kde.konsole-{konsole_pid}"
    tabs = []
    for session in dbus_children(service, "/Sessions"):
        path = f"/Sessions/{session}"
        title = dbus_call(service, path, "org.kde.konsole.Session.title", 1)
        tabs.append((session, dbus_call(service, path, "org.kde.konsole.Session.processId"),
                     dbus_call(service, path, "org.kde.konsole.Session.foregroundProcessId"),
                     title if isinstance(title, str) else ""))
    return tabs


def show_konsole_tab(konsole_pid, session):
    """Make the tab current in its window and raise that window."""
    service = f"org.kde.konsole-{konsole_pid}"
    for window in dbus_children(service, "/Windows"):
        if session in (dbus_call(service, f"/Windows/{window}", "org.kde.konsole.Window.sessionList") or []):
            dbus_call(service, f"/Windows/{window}", "org.kde.konsole.Window.setCurrentSession", session)
    title = dbus_call(service, f"/Sessions/{session}", "org.kde.konsole.Session.title", 1)
    return raise_window([konsole_pid], title if isinstance(title, str) else "")


def process_children():
    """{parent pid: [child pids]} for every process."""
    children = {}
    for p in os.listdir("/proc"):
        if p.isdigit():
            children.setdefault(parent_pid(int(p)), []).append(int(p))
    return children


def descendants(pid, children):
    found, stack = [], [pid]
    while stack:
        for child in children.get(stack.pop(), []):
            found.append(child)
            stack.append(child)
    return found


def find_attached_tab(job_id, name, config_dir):
    """(konsole pid, session) of a tab showing this background job, or None.

    Looks at every process in a tab, not only Konsole's foreground one: when a
    tab runs `bash -c "... claude attach ..."` (as the widget opens them), the
    foreground process is that bash and Claude runs underneath it.
    `claude attach <id>` names the job on its command line; the agent view
    (plain `claude`) doesn't register itself, but sets the tab title to the
    session name, so a claude tab of the same profile titled with it counts.
    """
    children = process_children()
    by_title = None
    for k in konsole_pids():
        for session, shell, _fg, title in konsole_tabs(k):
            if not isinstance(shell, int):
                continue
            for pid in [shell, *descendants(shell, children)]:
                if proc_name(pid) != "claude":
                    continue
                argv = proc_cmdline(pid)
                if len(argv) >= 3 and argv[1] == "attach" and argv[2] in (job_id, name):
                    return k, session
                if by_title is None and name and name in title and proc_config_dir(pid) == config_dir:
                    by_title = (k, session)
    return by_title


def proc_cmdline(pid):
    try:
        return Path(f"/proc/{pid}/cmdline").read_bytes().decode(errors="replace").split("\0")[:-1]
    except OSError:
        return []


def proc_config_dir(pid):
    """Resolved Claude config dir a process runs with."""
    return cs.process_config_dir(pid)


def konsole_tab(konsole_pid, pids):
    """Switch Konsole to the tab whose shell is one of pids; returns its title or None."""
    for session, shell, _fg, title in konsole_tabs(konsole_pid):
        if shell in pids:
            service = f"org.kde.konsole-{konsole_pid}"
            for window in dbus_children(service, "/Windows"):
                if session in (dbus_call(service, f"/Windows/{window}", "org.kde.konsole.Window.sessionList") or []):
                    dbus_call(service, f"/Windows/{window}", "org.kde.konsole.Window.setCurrentSession", session)
            return title
    return None


def tmux_client_pids(pane):
    """Select the tmux pane (session:@window.%pane) and return the pids of clients showing it."""
    session = pane.split(":", 1)[0]
    target = pane.rsplit(".", 1)[-1] if "." in pane else pane
    run(["tmux", "select-window", "-t", target])
    run(["tmux", "select-pane", "-t", target])
    code, out = run(["tmux", "list-clients", "-F", "#{client_pid} #{session_name}"])
    pids = []
    for line in out.splitlines() if code == 0 else []:
        pid, _, name = line.partition(" ")
        if name == session and pid.isdigit():
            pids.append(int(pid))
    return pids


def jump_terminal(entry, what="session"):
    pids = ancestors(entry.get("pid"))
    if not pids:
        return False, f"This {what} has no running process to show"
    if isinstance(entry.get("tmux"), str) and entry["tmux"]:
        clients = tmux_client_pids(entry["tmux"])
        if clients:
            pids = [p for c in clients for p in ancestors(c)]
    caption = ""
    konsole = next((p for p in pids if proc_name(p) == "konsole"), None)
    if konsole:
        title = konsole_tab(konsole, pids)
        caption = title or ""
    elif any(proc_name(p) == "code" for p in pids):  # VS Code's integrated terminal
        caption = os.path.basename(entry.get("cwd") or "")
    if not raise_window(pids, caption):
        return False, f"Couldn't raise the window of this {what} ({raise_hint()})"
    return True, f"Switched to the terminal running this {what}"


# ---------------------------------------------------------------- sessions on SSH hosts
#
# A session that runs on an SSH host but shows here: in a VS Code window
# connected to the host (Remote-SSH), or in a terminal tab running ssh.

VSCODE_NAMES = ("code", "codium", "code-oss", "code-insiders")


def vscode_main_pids():
    """VS Code's main processes (they own its windows)."""
    pids = []
    for p in os.listdir("/proc"):
        if p.isdigit() and proc_name(int(p)) in VSCODE_NAMES:
            argv = proc_cmdline(int(p))
            if argv and not any(a.startswith("--type=") for a in argv[1:]):
                pids.append(int(p))
    return pids


def ssh_target(argv):
    """The host an ssh command line connects to, or None (proxy -W helpers too)."""
    if not argv or os.path.basename(argv[0]) != "ssh" or "-W" in argv:
        return None
    takes_value = set("BbcDEeFIiJLlmOoPpQRSWw")
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == "--":
            i += 1
            break
        if a.startswith("-") and len(a) > 1:
            if a[-1] in takes_value and len(a) == 2:
                i += 1  # its value is the next word
            i += 1
            continue
        break
    if i >= len(argv):
        return None
    target = argv[i]
    return target.split("@", 1)[-1].split(":", 1)[0] if not target.startswith("ssh://") else target[6:].split("@")[-1].split(":")[0].split("/")[0]


def host_names(host):
    """Names a host goes by: its ~/.ssh/config alias and HostName."""
    names = {host}
    try:
        import remote
        for h in remote.ssh_hosts():
            if h["name"] == host and h["hostname"]:
                names.add(h["hostname"])
    except Exception:
        pass
    return names


def jump_remote_vscode(host, session_id, folder=""):
    """Show a VS Code chat that runs on an SSH host: raise the VS Code window
    connected to that host (Remote-SSH puts "[SSH: host]" in its title) and
    reveal the conversation; open VS Code on the host if none is."""
    url = "vscode://anthropic.claude-code/open?" + urlencode({"session": session_id})
    opener = shutil.which("xdg-open")
    if not opener:
        return False, "xdg-open is missing; can't hand the session link to VS Code"
    names = host_names(host)
    children = process_children()
    mains = vscode_main_pids()
    connected = any(ssh_target(proc_cmdline(pid)) in names
                    for main in mains for pid in descendants(main, children) if proc_name(pid) == "ssh")
    if connected:
        raise_window(mains, f"[SSH: {host}]", require=True, prefer=os.path.basename(folder.rstrip("/")))
        time.sleep(0.3)  # let VS Code see its window focused, so the link opens there
        subprocess.Popen([opener, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return True, f"Opened the conversation in VS Code ({host})"
    code = next((shutil.which(n) for n in VSCODE_NAMES if shutil.which(n)), None)
    if not code:
        return False, f"This chat runs in VS Code on {host}, and VS Code isn't installed here"
    remote_folder = f"vscode-remote://ssh-remote+{host}{folder}" if folder.startswith("/") else None
    args = [code, "--folder-uri", remote_folder] if remote_folder else [code, "--remote", f"ssh-remote+{host}"]
    start_app(args)
    # the link once the window has connected (VS Code passes it to the extension there)
    subprocess.Popen(["bash", "-c", f"sleep 10; exec {shlex.quote(opener)} {shlex.quote(url)}"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return True, f"Opening VS Code on {host}; the chat shows once it's connected"


def jump_remote_terminal(host, name=""):
    """Switch to the terminal tab here that runs ssh to host (the one whose
    title has the session's name, if several)."""
    names = host_names(host)
    children = process_children()
    best, best_score = None, -1
    for k in konsole_pids():
        for session, shell, _fg, title in konsole_tabs(k):
            if not isinstance(shell, int):
                continue
            if not any(proc_name(pid) == "ssh" and ssh_target(proc_cmdline(pid)) in names
                       for pid in [shell, *descendants(shell, children)]):
                continue
            score = 1 + (10 if name and name in (title or "") else 0)
            if score > best_score:
                best, best_score = (k, session), score
    if best is None:
        return False, (f"This session runs in a terminal on {host}, but no terminal here has an ssh connection "
                       f"to {host} (it may run in tmux or on another computer)")
    if not show_konsole_tab(*best):
        return False, f"Couldn't raise the terminal window ({raise_hint()})"
    return True, f"Switched to the terminal with the ssh session to {host}"


def jump_vscode(entry):
    pids = ancestors(entry.get("pid"))
    folder = os.path.basename(entry.get("cwd") or "")
    raise_window(pids, folder)  # VS Code titles end with "<folder> - Visual Studio Code"
    time.sleep(0.3)  # let VS Code see its window focused, so the link opens there
    url = "vscode://anthropic.claude-code/open?" + urlencode({"session": entry.get("sessionId", "")})
    opener = shutil.which("xdg-open")
    if not opener:
        return False, "xdg-open is missing; can't hand the session link to VS Code"
    subprocess.Popen([opener, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return True, "Opened the conversation in VS Code"


# Shell commands for a profile (they live in the backend, which remote hosts run too)
service_config_dir = cs.service_config_dir
job_config_dir = cs.job_config_dir
config_dir_value = cs.config_dir_value
folder_trusted = cs.folder_trusted
claude_command = cs.claude_command
attach_command = cs.attach_command
resume_command = cs.resume_command
short_folder = cs.short_folder


def kde_terminal():
    """The terminal picked in System Settings > Default Applications, as the
    words of its command line; [] when that's Konsole or nothing is set."""
    path = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "kdeglobals"
    try:
        lines = path.read_text(errors="replace").splitlines()
    except OSError:
        return []
    group = ""
    for line in lines:
        line = line.strip()
        if line.startswith("["):
            group = line
        elif group == "[General]" and line.startswith("TerminalApplication="):
            try:
                words = shlex.split(line.split("=", 1)[1])
            except ValueError:
                return []
            return [] if not words or Path(words[0]).name == "konsole" else words
    return []


def scope_prefix(name):
    """systemd-run options that start a program in a systemd scope of its own
    (named after it), or [] where that isn't possible.

    The widget runs inside plasmashell, so whatever it starts lands in
    plasmashell's systemd group, and restarting plasmashell (by hand, after an
    update or a crash) stops every process in that group: a chat running in a
    terminal the widget opened would be killed. KDE starts apps in scopes of
    their own for the same reason.
    """
    run = shutil.which("systemd-run")
    runtime = os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"
    if not run or not os.path.exists(os.path.join(runtime, "systemd", "private")):
        return []  # no systemd user manager here
    base = [run, "--user", "--scope", "--quiet", "--collect"]
    try:  # make sure it works now: if it failed later, the program wouldn't start at all
        if subprocess.run(base + ["--", "true"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, timeout=5).returncode != 0:
            return []
    except (OSError, subprocess.TimeoutExpired):
        return []
    unit = f"app-claudestatus-{re.sub(r'[^A-Za-z0-9_.]', '_', name)}-{os.urandom(4).hex()}.scope"
    return base + [f"--unit={unit}", "--"]


def start_app(args, cwd=None):
    """Start a program that lives on by itself (a terminal, VS Code), in a
    systemd scope of its own where possible (see scope_prefix)."""
    subprocess.Popen(scope_prefix(Path(args[0]).name) + list(args), cwd=cwd, stdin=subprocess.DEVNULL,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def open_terminal(cwd, command):
    """Open a terminal window running command, then an interactive shell.

    The command goes on the terminal's command line: Konsole refuses to have
    commands typed into its tabs over DBus ("security sensitive DBus API is
    disabled"). The trap keeps Ctrl+C from closing the window, and leaving
    Claude drops to a normal shell in the same window. Konsole unless another
    terminal is your default; other terminals get `-e`, as KDE does. The
    terminal gets a systemd scope of its own (start_app), so restarting
    plasmashell doesn't kill the chat in it.
    """
    cwd = cwd if cwd and os.path.isdir(cwd) else str(Path.home())
    shell = os.environ.get("SHELL") or "/bin/bash"
    script = f"trap : INT; {command}; exec {shlex.quote(shell)}"
    if on_gnome():
        args = gnome_terminal_args(shell, cwd, script)
        if not args:
            return False
        start_app(args, cwd=cwd)
        return True
    chosen = kde_terminal()
    konsole = shutil.which("konsole")
    if chosen and shutil.which(chosen[0]):
        args = chosen + ["-e", shell, "-c", f"cd {shlex.quote(cwd)} && {script}"]
    elif konsole:
        args = [konsole, "--workdir", cwd, "-e", shell, "-c", script]
    else:
        terminal = shutil.which("x-terminal-emulator") or shutil.which("xterm")
        if not terminal:
            return False
        args = [terminal, "-e", shell, "-c", f"cd {shlex.quote(cwd)} && {script}"]
    start_app(args, cwd=cwd)
    return True


# GNOME's terminals, the default first (xdg-terminal-exec runs the one you
# picked), each with the option after which its command line follows
GNOME_TERMINALS = (("xdg-terminal-exec", []), ("ptyxis", ["--new-window", "--"]),
                   ("gnome-terminal", ["--window", "--"]), ("kgx", ["--"]))


def gnome_terminal_args(shell, cwd, script):
    """open_terminal's command line on GNOME, or None without a terminal."""
    line = [shell, "-c", f"cd {shlex.quote(cwd)} && {script}"]
    for name, options in GNOME_TERMINALS:
        path = shutil.which(name)
        if path:
            return [path, *options, *line]
    konsole = shutil.which("konsole")
    if konsole:
        return [konsole, "--workdir", cwd, "-e", shell, "-c", script]
    terminal = shutil.which("x-terminal-emulator") or shutil.which("xterm")
    return [terminal, "-e", *line] if terminal else None


def jump_job(profile, job_id, job, name):
    # A terminal already showing the job: bring that one up instead of
    # attaching a second client.
    for entry in live_entries(profile):
        if entry.get("parkedJobId") == job_id:
            return jump_terminal(entry, "background job")
    tab = find_attached_tab(job_id, name, profile.path.resolve())
    if tab and show_konsole_tab(*tab):
        return True, "Switched to the terminal showing this background job"
    if not shutil.which("claude"):
        return False, "The claude command isn't on PATH; can't attach to the background job"
    if not open_terminal((job or {}).get("cwd"), attach_command(profile, job_id, job=job)):
        return False, "No terminal found to open the background job in"
    return True, "Opened the background job in a terminal"


def resume_chat(profile, path, session_id, home):
    """Open a terminal that reopens a finished chat with `claude --resume`."""
    if not shutil.which("claude"):
        return False, "The claude command isn't on PATH; can't reopen the chat"
    folder = chat_folder(path)
    if not open_terminal(folder, resume_command(profile, session_id, home, folder)):
        return False, "No terminal found to reopen the chat in"
    return True, "Reopened the chat in a terminal"


def jump(home, extra_dirs, session_id, profile_dir=None):
    profile, entry, job, job_id = find_session(home, extra_dirs, session_id, profile_dir)
    if profile is None:
        chat_profile, path = find_chat(home, extra_dirs, session_id, profile_dir)
        if chat_profile is not None:
            return resume_chat(chat_profile, path, session_id, home)
        return False, "That session isn't running any more"
    if entry is not None and entry.get("kind") == "interactive":
        if entry.get("entrypoint") == "claude-vscode":
            return jump_vscode(entry)
        return jump_terminal(entry)
    if job_id:
        name = (entry or {}).get("name") or (job or {}).get("name") or ""
        return jump_job(profile, job_id, job, name if isinstance(name, str) else "")
    return False, "Don't know how to open this session"


def stop(home, extra_dirs, session_id, profile_dir=None):
    """Stop a background session with `claude stop` (its conversation is kept)."""
    profile, entry, job, job_id = find_session(home, extra_dirs, session_id, profile_dir)
    if profile is None:
        return False, "That session isn't running any more"
    if not job_id:
        return False, "Only background sessions can be stopped here; close a terminal session's window to end it"
    claude = shutil.which("claude")
    if not claude:
        return False, "The claude command isn't on PATH"
    env = dict(os.environ)
    value = config_dir_value(profile, home, job)
    if value is None:
        env.pop("CLAUDE_CONFIG_DIR", None)
    else:
        env["CLAUDE_CONFIG_DIR"] = value
    try:
        r = subprocess.run([claude, "stop", job_id], env=env, cwd=str(home), stdin=subprocess.DEVNULL,
                           capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"claude stop didn't finish: {exc}"
    lines = [l.strip() for l in (r.stdout + "\n" + r.stderr).splitlines() if l.strip()]
    if r.returncode != 0:
        return False, lines[-1] if lines else f"claude stop failed (exit {r.returncode})"
    return True, lines[-1] if lines else "Stopped"


def new_chat(home, extra_dirs, dirname, folder=None):
    """Open a terminal with a new interactive chat on one profile (e.g. .claude-work)."""
    profile = next((p for p in cs.discover_profiles(home, extra_dirs) if matches(p, dirname)), None)
    if profile is None:
        return False, f"No Claude profile called {dirname}"
    if not shutil.which("claude"):
        return False, "The claude command isn't on PATH"
    folder = folder if folder and os.path.isdir(folder) else str(home)
    if not open_terminal(folder, cs.new_chat_command(profile, home)):
        return False, "No terminal found to open the chat in"
    return True, f"Opened a new {profile.label} chat in {cs.short_path(folder, home)}"


def choose_folder(title, start):
    """Ask for a folder in the desktop's folder dialog (KDE's, else GTK's;
    on GNOME GTK's first), opening at start: (folder, "") or, cancelled or
    failed, (None, error or "")."""
    kde = ["kdialog", "--title", title, "--getexistingdirectory", str(start)]
    gtk = ["zenity", "--file-selection", "--directory", "--title", title, f"--filename={start}/"]
    args = next((a for a in ([gtk, kde] if on_gnome() else [kde, gtk]) if shutil.which(a[0])), None)
    if args is None:
        return None, f"No folder dialog found (install {'zenity' if on_gnome() else 'kdialog'})"
    r = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    folder = r.stdout.strip()
    if r.returncode != 0 or not folder:
        return None, ""
    return folder, ""


def new_chat_choosing_folder(home, extra_dirs, dirname, vscode=False):
    """Ask for a folder (the dialog opens in your home folder), then open a new
    chat on the profile there, in a terminal or in VS Code. Cancelling the
    dialog does nothing."""
    profile = next((p for p in cs.discover_profiles(home, extra_dirs) if matches(p, dirname)), None)
    if profile is None:
        return False, f"No Claude profile called {dirname}"
    if not vscode and not shutil.which("claude"):
        return False, "The claude command isn't on PATH"
    folder, error = choose_folder(f"New Claude chat on {profile.label} in…", home)
    if folder is None:
        return (False, error) if error else (True, "")
    if not os.path.isdir(folder):
        return False, f"Not a folder: {folder}"
    return (new_chat_vscode if vscode else new_chat)(home, extra_dirs, dirname, folder)


# ---------------------------------------------------------------- new chats in VS Code

VSCODE_NEW_CHAT = "vscode://anthropic.claude-code/open"   # without a session: a new conversation


def later(task):
    """Run task in a process of its own once this script has answered (the
    widget waits until our output ends, so it mustn't inherit it)."""
    try:
        pid = os.fork()
    except OSError:
        return
    if pid:
        return
    try:
        os.setsid()
        devnull = os.open(os.devnull, os.O_RDWR)
        for fd in (0, 1, 2):
            os.dup2(devnull, fd)
        task()
    except Exception:
        pass
    finally:
        os._exit(0)


def open_vscode_chat(caption, wait, prefer=""):
    """After wait seconds (VS Code opening the folder): bring up its window
    whose title has caption, then ask the Claude extension for a new chat. A
    vscode:// link goes to the VS Code window that was active last."""
    time.sleep(wait)
    raise_window(vscode_main_pids(), caption, require=True, prefer=prefer)
    time.sleep(0.3)  # let VS Code see its window focused, so the link opens there
    opener = shutil.which("xdg-open")
    if opener:
        subprocess.Popen([opener, VSCODE_NEW_CHAT], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)


def new_chat_vscode(home, extra_dirs, dirname, folder=None):
    """Open folder in VS Code and a new chat in its Claude extension, when
    that runs on this profile: VS Code's environment and settings decide
    which one (claude_status.vscode_profile), so other profiles are refused."""
    profiles = cs.discover_profiles(home, extra_dirs)
    profile = next((p for p in profiles if matches(p, dirname)), None)
    if profile is None:
        return False, f"No Claude profile called {dirname}"
    code, _ = cs.vscode_app()
    if code is None:
        return False, "VS Code isn't installed"
    if not shutil.which("xdg-open"):
        return False, "xdg-open is missing; can't hand the new chat to VS Code"
    _, there = cs.vscode_profile(home, profiles)
    if there is None or there.real != profile.real:
        where = there.label if there is not None else "another Claude folder"
        return False, f"VS Code's Claude runs on {where}, not {profile.label}: switch its profile first"
    folder = folder if folder and os.path.isdir(folder) else str(home)
    wait = 2.5 if vscode_main_pids() else 8   # a window of a running VS Code, or VS Code starting up
    start_app([code, folder])
    later(lambda: open_vscode_chat(os.path.basename(folder.rstrip("/")) or folder, wait))
    return True, f"Opening a new {profile.label} chat in VS Code ({cs.short_path(folder, home)})"


def new_chat_remote_vscode(host, folder=""):
    """VS Code connected to an SSH host (Remote-SSH), in folder there or its
    home folder, then a new chat in its Claude extension once connected."""
    code, _ = cs.vscode_app()
    if code is None:
        return False, f"VS Code isn't installed here, so it can't connect to {host}"
    if not shutil.which("xdg-open"):
        return False, "xdg-open is missing; can't hand the new chat to VS Code"
    if folder.startswith("/"):
        start_app([code, "--folder-uri", f"vscode-remote://ssh-remote+{host}{folder}"])
    else:
        start_app([code, "--remote", f"ssh-remote+{host}"])
    later(lambda: open_vscode_chat(f"[SSH: {host}]", 10, prefer=os.path.basename(folder.rstrip("/"))))
    return True, f"Opening VS Code on {host}; the new chat starts once it's connected"


# ---------------------------------------------------------------- shared chats


def run_share_tool(home, args):
    """Run shared-chats.sh; (ok, what it said)."""
    tool = cs.share_tool(home)
    if tool is None:
        return False, "The shared-chats tool isn't installed (~/.claude-shared/profile-tools/shared-chats.sh)"
    try:
        # it works on $HOME: make that the home we're looking at
        r = subprocess.run(["bash", str(tool), *args], cwd=str(home), stdin=subprocess.DEVNULL,
                           env=dict(os.environ, HOME=str(home)), capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"shared-chats.sh didn't finish: {exc}"
    text = " ".join((r.stdout.strip() or r.stderr.strip()).split())
    return r.returncode == 0, text or f"shared-chats.sh stopped (exit {r.returncode})"


def open_somewhere(home, extra_dirs, session_id):
    """Label of the profile where a running session has this chat open, or None."""
    profiles = cs.discover_profiles(home, extra_dirs)
    for entry, runs_on, _holder in cs.live_entries_all(profiles):
        if entry.get("sessionId") == session_id and entry.get("kind") in cs.SESSION_KINDS and not entry.get("spare"):
            return runs_on.label
    return cs.shared_holder(session_id, profiles)


def profile_named(home, extra_dirs, profile_dir):
    return next((p for p in cs.discover_profiles(home, extra_dirs) if profile_dir and matches(p, profile_dir)), None)


def resume(home, extra_dirs, session_id, profile_dir=None):
    """Reopen a chat on a profile in a new terminal (claude --resume)."""
    profile, path = find_chat(home, extra_dirs, session_id, profile_dir)
    if profile is None:
        return False, "That chat isn't on this account"
    return resume_chat(profile, path, session_id, home)


def continue_on(home, extra_dirs, session_id, profile_dir):
    """Continue a chat on another account: share it if that account doesn't
    have it yet, then reopen it there."""
    target = profile_named(home, extra_dirs, profile_dir)
    if target is None:
        return False, f"No Claude profile called {profile_dir}"
    busy = open_somewhere(home, extra_dirs, session_id)
    if busy:
        return False, f"It's open in a session on {busy}. A chat can be open in one session at a time: exit that one first."
    copies = [path for p in cs.discover_profiles(home, extra_dirs) for path in [cs.transcript_path(p, session_id)] if path]
    if not copies:
        return False, "That chat has no transcript on this computer"
    there = cs.transcript_path(target, session_id)
    if there is None:
        ok, message = run_share_tool(home, ["share", session_id])
        if not ok:
            return False, message
        there = cs.transcript_path(target, session_id)
        if there is None:
            return False, f"It wasn't added to {target.label}: {message}"
    elif any(not os.path.samefile(there, other) for other in copies):
        return False, f"{target.label} has a different chat with the same id; left everything as it is"
    return resume_chat(target, there, session_id, home)


def share(home, extra_dirs, session_id, _profile_dir=None):
    """Share a chat with every account (shared-chats.sh share)."""
    return run_share_tool(home, ["share", session_id])


def unshare(home, extra_dirs, session_id, profile_dir):
    """Make a shared chat a normal chat of one profile again; the others lose it."""
    keep = profile_named(home, extra_dirs, profile_dir)
    name = cs.share_name(keep, home) if keep else None
    if not name:
        return False, f"{profile_dir} isn't a profile the shared-chats tool knows"
    busy = open_somewhere(home, extra_dirs, session_id)
    if busy:
        return False, f"It's open in a session on {busy}. Exit that session first."
    return run_share_tool(home, ["unshare", session_id, name])


def dismiss(home, extra_dirs, session_id):
    """Hide a finished session from the widget's list. Nothing of Claude's is touched."""
    cache_root = cs.cache_dir(home)
    sessions = cs.load_dismissed(cache_root)
    sessions[session_id] = int(time.time() * 1000)
    cs.private_dir(cache_root)
    cs.save_dismissed(cache_root, sessions)
    return True, "Removed from the list"


def undismiss_all(home, extra_dirs, _session_id=None):
    cache_root = cs.cache_dir(home)
    count = len(cs.load_dismissed(cache_root))
    if count:
        cs.save_dismissed(cache_root, {})
    return True, f"{count} session(s) shown again"


USAGE = ("usage: jump.py [--stop] SESSION_ID [--profile PROFILE] [--config-dir DIR]...\n"
         "       jump.py --new-chat PROFILE_DIRNAME [--cwd FOLDER | --choose-folder] [--vscode] [--config-dir DIR]...\n"
         "       jump.py --resume|--continue|--unshare SESSION_ID --profile PROFILE\n"
         "       jump.py --share SESSION_ID\n"
         "       jump.py --remote-vscode HOST SESSION_ID [--cwd FOLDER_ON_HOST]\n"
         "       jump.py --remote-terminal HOST [--name SESSION_NAME]\n"
         "       jump.py --remote-new-vscode HOST [--cwd FOLDER_ON_HOST]")


def main(argv=None):
    args = sys.argv[1:] if argv is None else list(argv)
    extra, session_id, action, folder, profile_dir = [], None, jump, None, None
    remote_host, name_arg, choose, vscode = None, "", False, False
    while args:
        arg = args.pop(0)
        if arg == "--config-dir" and args:
            extra.append(args.pop(0))
        elif arg == "--profile" and args:
            profile_dir = args.pop(0)
        elif arg == "--stop":
            action = stop
        elif arg == "--new-chat":
            action = new_chat
        elif arg == "--choose-folder":
            choose = True
        elif arg == "--vscode":
            vscode = True
        elif arg == "--dismiss":
            action = dismiss
        elif arg == "--undismiss-all":
            action, session_id = undismiss_all, session_id or "-"
        elif arg in ("--remote-vscode", "--remote-terminal", "--remote-new-vscode") and args:
            action, remote_host = arg, args.pop(0)
        elif arg == "--name" and args:
            name_arg = args.pop(0)
        elif arg in ("--resume", "--continue", "--share", "--unshare"):
            action = {"--resume": resume, "--continue": continue_on, "--share": share, "--unshare": unshare}[arg]
        elif arg == "--cwd" and args:
            folder = args.pop(0)
        elif session_id is None and not arg.startswith("-"):
            session_id = arg
        else:
            sys.exit(USAGE)
    if action in ("--remote-terminal", "--remote-new-vscode"):
        session_id = session_id or "-"
    if not session_id or (action in (continue_on, unshare) and not profile_dir):
        sys.exit(USAGE)
    try:
        if action == "--remote-vscode":
            ok, message = jump_remote_vscode(remote_host, session_id, folder or "")
        elif action == "--remote-terminal":
            ok, message = jump_remote_terminal(remote_host, name_arg)
        elif action == "--remote-new-vscode":
            ok, message = new_chat_remote_vscode(remote_host, folder or "")
        elif action is new_chat and choose:
            ok, message = (new_chat_choosing_folder(Path.home(), extra, session_id, vscode=True) if vscode
                           else new_chat_choosing_folder(Path.home(), extra, session_id))
        elif action is new_chat:
            ok, message = (new_chat_vscode if vscode else new_chat)(Path.home(), extra, session_id, folder)
        elif action in (jump, stop, resume, continue_on, share, unshare):
            ok, message = action(Path.home(), extra, session_id, profile_dir)
        else:
            ok, message = action(Path.home(), extra, session_id)
    except Exception as exc:  # report, don't crash: the widget shows the message
        ok, message = False, f"{type(exc).__name__}: {exc}"
    print(json.dumps({"ok": ok, "message": message}))


if __name__ == "__main__":
    main()
