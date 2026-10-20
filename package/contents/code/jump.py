#!/usr/bin/env python3
"""Bring a Claude Code session to the front, stop a background one, or start
a new chat (used by the Claude Status widget).

    python3 -I jump.py SESSION_ID [--config-dir DIR]...
    python3 -I jump.py --stop SESSION_ID [--profile PROFILE] [--busy] [--config-dir DIR]...
    python3 -I jump.py --interrupt SESSION_ID [--profile PROFILE]   (Ctrl+C in its tmux pane)
    python3 -I jump.py --save-settings JSON --by WIDGET [--unless-default]   (settings the widgets share)
    python3 -I jump.py --new-chat PROFILE_DIRNAME [--cwd FOLDER] [--config-dir DIR]...
    python3 -I jump.py --new-chat PROFILE_DIRNAME --choose-folder   (ask for the folder first)
    python3 -I jump.py --new-chat PROFILE_DIRNAME [--cwd FOLDER | --choose-folder] --vscode
                                                 (in VS Code's Claude extension instead)
    python3 -I jump.py --remote-new-vscode HOST [--cwd FOLDER_ON_HOST] [--account CONFIG_DIR|-]   (the same on an SSH host;
                                     --account first has VS Code's Claude there run on that account)
    python3 -I jump.py --dismiss SESSION_ID      (hide a finished session in the widget)
    python3 -I jump.py --undismiss-all           (show hidden ones again)
    python3 -I jump.py --resume SESSION_ID --profile PROFILE    (reopen a chat there)
    python3 -I jump.py --resume SESSION_ID --profile PROFILE --vscode   (in VS Code's Claude extension)
    python3 -I jump.py --remote-resume-vscode HOST SESSION_ID [--cwd FOLDER_ON_HOST]   (the same on an SSH host)
    python3 -I jump.py --continue SESSION_ID --profile PROFILE  (share it if needed, reopen it there)
    python3 -I jump.py --share SESSION_ID                       (share it with every account)
    python3 -I jump.py --unshare SESSION_ID --profile PROFILE   (keep it only there)
    python3 -I jump.py --changes CHAT_ID [--profile PROFILE] [--turn] [--list]
                                                 (compare the files a chat changed in VS Code)
    python3 -I jump.py --phone MESSAGE [--device ID]   (to your phone, with KDE Connect)
    python3 -I jump.py --phone-devices           (the phones paired with KDE Connect)
    python3 -I jump.py --agent-run AGENT_ID --chat CHAT_ID [--profile PROFILE] [--no-open]
                                                 (a subagent's whole run, as a Markdown file)

Sharing is done by sharing.py; a chat that's open in a session isn't touched
(it can be open in one at a time).

`--stop` runs `claude stop <id>` for a background session: it's interrupted,
its conversation is kept, and `claude attach <id>` resumes it. A chat in a
terminal or in VS Code is stopped too (claude_status.stop_chat): Claude quits,
its terminal stays open (VS Code's tab goes on with the next message), and
`claude --resume <id>` reopens it; only an idle one unless --busy (you were
told it's working or waiting). `--interrupt` presses Ctrl+C for a chat in tmux.

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
import signal
import subprocess
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path
from urllib.parse import urlencode

sys.dont_write_bytecode = True  # no __pycache__ inside the installed widget
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script dir off sys.path
import claude_status as cs  # noqa: E402
import sharing  # noqa: E402

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
    profiles = [p for p in every if not profile_dir or cs.matches_profile(p, profile_dir)]
    # A live session is looked up in every profile: after ~/.claude was
    # switched, its file can still be in the profile it started on.
    for entry, runs_on, holder in cs.live_entries_all(every):
        if profile_dir and not (cs.matches_profile(runs_on, profile_dir) or cs.matches_profile(holder, profile_dir)):
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


def find_chat(home, extra_dirs, session_id, profile_dir=None):
    """(profile, transcript) of a chat with no session or job: the first
    profile (or the one named) that has its transcript."""
    for profile in cs.discover_profiles(home, extra_dirs):
        if profile_dir and not cs.matches_profile(profile, profile_dir):
            continue
        path = cs.transcript_path(profile, session_id)
        if path is not None:
            return profile, path
    return None, None


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


def tmux_client_pids(pane, socket=None):
    """Select the tmux pane (session:@window.%pane) and return the pids of
    clients showing it. socket: its tmux server's ($TMUX of the chat's
    process; a chat in `tmux -L work` isn't on the default server)."""
    session = pane.split(":", 1)[0]
    target = pane.rsplit(".", 1)[-1] if "." in pane else pane
    tmux = ["tmux", *(["-S", socket] if socket else [])]
    run([*tmux, "select-window", "-t", target])
    run([*tmux, "select-pane", "-t", target])
    code, out = run([*tmux, "list-clients", "-F", "#{client_pid} #{session_name}"])
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
        clients = tmux_client_pids(entry["tmux"], cs.tmux_socket(entry.get("pid")))
        if not clients:
            return False, f"This {what} runs in a tmux session no terminal shows right now: attach to it to see it"
        pids = [p for c in clients for p in ancestors(c)]
    if any(proc_name(p).startswith("sshd") for p in pids):
        return False, f"This {what} runs in an SSH login to this computer: there's no window here to show"
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
    remote_folder = remote_folder_uri(host, folder) if folder.startswith("/") else None
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


def remote_folder_uri(host, folder):
    """VS Code's address of a folder on an SSH host (# ? % and spaces in a
    folder name would end or change it)."""
    return f"vscode-remote://ssh-remote+{host}{urllib.parse.quote(folder)}"


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
    # The commands are POSIX shell: sh runs them whatever your shell is
    # (fish, nushell…), and then your shell takes over the window
    yours = os.environ.get("SHELL") or "/bin/bash"
    script = f"trap : INT; {command}; exec {shlex.quote(yours)}"
    shell = "/bin/sh"
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


# ---------------------------------------------------------------- finding claude
#
# The desktop session's PATH often lacks claude's folder (~/.local/bin, an
# npm or nvm folder): installers add it in shell startup files the desktop
# never reads. So past PATH, claude is looked for where it's usually
# installed, and then on the PATH your login shell sets up.

NO_CLAUDE = ("Can't find the claude command: it isn't on the desktop's PATH, in ~/.local/bin or npm's or nvm's "
             "folders, nor on your login shell's PATH. Add its folder to PATH in ~/.profile, then log in again")


def claude_path(home):
    """Full path of the claude command, or None."""
    found = shutil.which("claude") or cs.find_claude(home, ask_shell=True)
    return found if found != "claude" else None


def claude_in_terminal(home):
    """How a terminal we open runs claude: by name when it's on our PATH (the
    terminal inherits that), else by its full path; None if there's none."""
    return "claude" if shutil.which("claude") else claude_path(home)


def jump_job(profile, job_id, job, name, home=None):
    # A terminal already showing the job: bring that one up instead of
    # attaching a second client.
    for entry in live_entries(profile):
        if entry.get("parkedJobId") == job_id:
            return jump_terminal(entry, "background job")
    tab = find_attached_tab(job_id, name, profile.path.resolve())
    if tab and show_konsole_tab(*tab):
        return True, "Switched to the terminal showing this background job"
    claude = claude_in_terminal(home or Path.home())
    if claude is None:
        return False, NO_CLAUDE
    if not open_terminal((job or {}).get("cwd"), attach_command(profile, job_id, home, job, claude)):
        return False, "No terminal found to open the background job in"
    return True, "Opened the background job in a terminal"


def resume_chat(profile, path, session_id, home):
    """Open a terminal that reopens a finished chat with `claude --resume`."""
    claude = claude_in_terminal(home)
    if claude is None:
        return False, NO_CLAUDE
    folder = cs.chat_folder(path)
    if not open_terminal(folder, resume_command(profile, session_id, home, folder, claude)):
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
        return jump_job(profile, job_id, job, name if isinstance(name, str) else "", home)
    return False, "Don't know how to open this session"


def stop(home, extra_dirs, session_id, profile_dir=None, busy=False):
    """Stop a background session with `claude stop`, or a chat in a terminal
    or VS Code (its process quits; only an idle one unless busy). Either way
    the conversation is kept."""
    profile, entry, job, job_id = find_session(home, extra_dirs, session_id, profile_dir)
    if profile is None:
        return False, "That session isn't running any more"
    if not job_id:
        if entry is not None and entry.get("kind") == "interactive":
            return cs.stop_chat(entry, busy_ok=busy)
        return False, "Only background sessions and chats with a process can be stopped here"
    claude = claude_path(home)
    if not claude:
        return False, NO_CLAUDE
    env = dict(os.environ)
    value = config_dir_value(profile, home, job, for_job=True)
    if value is None:
        env.pop("CLAUDE_CONFIG_DIR", None)
    else:
        env["CLAUDE_CONFIG_DIR"] = value
    folder = os.path.dirname(claude)
    if os.path.isfile(os.path.join(folder, "node")):  # an npm install under nvm needs its node
        env["PATH"] = os.pathsep.join([folder, env.get("PATH", "")])
    try:
        r = subprocess.run([claude, "stop", job_id], env=env, cwd=str(home), stdin=subprocess.DEVNULL,
                           capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"claude stop didn't finish: {exc}"
    lines = [l.strip() for l in (r.stdout + "\n" + r.stderr).splitlines() if l.strip()]
    if r.returncode != 0:
        return False, lines[-1] if lines else f"claude stop failed (exit {r.returncode})"
    return True, lines[-1] if lines else "Stopped"


def interrupt(home, extra_dirs, session_id, profile_dir=None):
    """Interrupt a working chat in tmux (Ctrl+C in its pane); it stays open."""
    profile, entry, _job, job_id = find_session(home, extra_dirs, session_id, profile_dir)
    if profile is None or entry is None:
        return False, "That session isn't running any more"
    if job_id:
        return False, "A background session can only be stopped"
    return cs.interrupt_chat(entry)


def save_settings(home, values_json, by, unless_default=False):
    """Save a widget's settings for its other copies (claude_status: several widgets at once)."""
    try:
        values = json.loads(values_json)
    except ValueError:
        return False, "The settings aren't JSON"
    if not isinstance(values, dict):
        return False, "The settings aren't a JSON object"
    return cs.save_shared_settings(cs.cache_dir(home), by, values, int(time.time() * 1000), unless_default)


def new_chat(home, extra_dirs, dirname, folder=None):
    """Open a terminal with a new interactive chat on one profile (e.g. .claude-work)."""
    profile = next((p for p in cs.discover_profiles(home, extra_dirs) if cs.matches_profile(p, dirname)), None)
    if profile is None:
        return False, f"No Claude profile called {dirname}"
    claude = claude_in_terminal(home)
    if claude is None:
        return False, NO_CLAUDE
    folder = folder if folder and os.path.isdir(folder) else str(home)
    if not open_terminal(folder, cs.new_chat_command(profile, home, claude)):
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
    profile = next((p for p in cs.discover_profiles(home, extra_dirs) if cs.matches_profile(p, dirname)), None)
    if profile is None:
        return False, f"No Claude profile called {dirname}"
    if not vscode and claude_in_terminal(home) is None:
        return False, NO_CLAUDE
    folder, error = choose_folder(f"New Claude chat on {profile.label} in…", home)
    if folder is None:
        return (False, error) if error else (True, "")
    if not os.path.isdir(folder):
        return False, f"Not a folder: {folder}"
    return (new_chat_vscode if vscode else new_chat)(home, extra_dirs, dirname, folder)


# ---------------------------------------------------------------- new chats in VS Code

VSCODE_NEW_CHAT = "vscode://anthropic.claude-code/open"   # without a session: a new conversation


def vscode_chat_link(session_id):
    """The Claude extension's link that opens this chat (an open one is
    brought up; another one is resumed in a new tab)."""
    return VSCODE_NEW_CHAT + "?" + urlencode({"session": session_id})


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


def open_vscode_chat(caption, wait, prefer="", link=VSCODE_NEW_CHAT):
    """After wait seconds (VS Code opening the folder): bring up its window
    whose title has caption, then hand the Claude extension its link (a new
    chat, or vscode_chat_link's). A vscode:// link goes to the VS Code window
    that was active last."""
    time.sleep(wait)
    raise_window(vscode_main_pids(), caption, require=True, prefer=prefer)
    time.sleep(0.3)  # let VS Code see its window focused, so the link opens there
    opener = shutil.which("xdg-open")
    if opener:
        subprocess.Popen([opener, link], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL, start_new_session=True)


def vscode_for(home, extra_dirs, dirname):
    """(VS Code's command, the profile named dirname), when VS Code's Claude
    runs on that profile: VS Code's environment and settings decide which one
    (claude_status.vscode_profile), so other profiles are refused. Else
    (None, why not)."""
    profiles = cs.discover_profiles(home, extra_dirs)
    profile = next((p for p in profiles if cs.matches_profile(p, dirname)), None)
    if profile is None:
        return None, f"No Claude profile called {dirname}"
    code, _ = cs.vscode_app()
    if code is None:
        return None, "VS Code isn't installed"
    if not shutil.which("xdg-open"):
        return None, "xdg-open is missing; can't hand the chat to VS Code"
    _, there = cs.vscode_profile(home, profiles)
    if there is None or there.real != profile.real:
        where = there.label if there is not None else "another Claude folder"
        return None, f"VS Code's Claude runs on {where}, not {profile.label}: switch its profile first"
    return code, profile


def start_vscode_chat(code, folder, link=VSCODE_NEW_CHAT):
    """Open folder in VS Code (or bring up its window), then the link there."""
    wait = 2.5 if vscode_main_pids() else 8   # a window of a running VS Code, or VS Code starting up
    start_app([code, folder])
    later(lambda: open_vscode_chat(os.path.basename(folder.rstrip("/")) or folder, wait, link=link))


def new_chat_vscode(home, extra_dirs, dirname, folder=None):
    """Open folder in VS Code and a new chat in its Claude extension, when
    that runs on this profile (vscode_for)."""
    code, profile = vscode_for(home, extra_dirs, dirname)
    if code is None:
        return False, profile
    folder = folder if folder and os.path.isdir(folder) else str(home)
    start_vscode_chat(code, folder)
    return True, f"Opening a new {profile.label} chat in VS Code ({cs.short_path(folder, home)})"


def resume_vscode(home, extra_dirs, session_id, profile_dir):
    """Reopen a finished chat in VS Code's Claude extension: VS Code opens
    the folder the chat last ran in, then the extension resumes the chat
    there. Only on the profile VS Code's Claude runs on (vscode_for)."""
    code, profile = vscode_for(home, extra_dirs, profile_dir)
    if code is None:
        return False, profile
    path = cs.transcript_path(profile, session_id)
    if path is None:
        return False, f"That chat isn't on {profile.label}"
    folder = cs.chat_folder(path)
    if not folder or not os.path.isdir(folder):
        return False, f"The chat's folder {folder or '(unknown)'} isn't there any more; reopen it in a terminal"
    start_vscode_chat(code, folder, vscode_chat_link(session_id))
    return True, f"Reopening the chat in VS Code ({cs.short_path(folder, home)})"


def remote_vscode(host, folder, link, what):
    """VS Code connected to an SSH host (Remote-SSH), in folder there or its
    home folder, then the link in its Claude extension once connected."""
    code, _ = cs.vscode_app()
    if code is None:
        return False, f"VS Code isn't installed here, so it can't connect to {host}"
    if not shutil.which("xdg-open"):
        return False, "xdg-open is missing; can't hand the chat to VS Code"
    if folder.startswith("/"):
        start_app([code, "--folder-uri", remote_folder_uri(host, folder)])
    else:
        start_app([code, "--remote", f"ssh-remote+{host}"])
    later(lambda: open_vscode_chat(f"[SSH: {host}]", 10, prefer=os.path.basename(folder.rstrip("/")), link=link))
    return True, f"Opening VS Code on {host}; {what} once it's connected"


def new_chat_remote_vscode(host, folder="", account=None):
    """A new chat in VS Code connected to an SSH host (remote_vscode). With
    account (a CLAUDE_CONFIG_DIR on the host, "-" for none), VS Code's Claude
    there first switches to that account, and stays on it: nothing opens
    when it can't (the chat would start on the other account)."""
    if account is not None:
        import remote
        ok, message = remote.vscode_account(host, None if account == "-" else account)
        if not ok:
            return False, f"Couldn't switch VS Code's Claude on {host}: {message}"
    return remote_vscode(host, folder, VSCODE_NEW_CHAT, "the new chat starts")


def resume_remote_vscode(host, session_id, folder=""):
    """A finished chat of an SSH host, reopened in VS Code connected to it,
    in the chat's folder there (remote_vscode)."""
    return remote_vscode(host, folder, vscode_chat_link(session_id), "the chat shows")


# ---------------------------------------------------------------- your phone
#
# While you're away, the widget can send chats that need you to your phone
# with KDE Connect: `--phone MESSAGE [--device ID]` pings the phone named, or
# every paired phone that's reachable now (on the same network);
# `--phone-devices` lists the paired ones for the settings.


def kdeconnect_ids(*args):
    """The lines kdeconnect-cli prints for these options (its "0 devices found" goes to stderr)."""
    cli = shutil.which("kdeconnect-cli")
    if not cli:
        return None
    try:
        out = subprocess.run([cli, *args], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.DEVNULL, timeout=10).stdout.decode(errors="replace")
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [line.strip() for line in out.splitlines() if line.strip()]


def phone_devices():
    """(ok, message, [{"id", "name", "reachable"}]) of the devices paired with KDE Connect."""
    paired = kdeconnect_ids("-l", "--id-name-only")
    if paired is None:
        return False, "KDE Connect isn't installed (kdeconnect-cli)", []
    reachable = set(kdeconnect_ids("-a", "--id-only") or [])
    devices = []
    for line in paired:
        ident, _, name = line.partition(" ")
        devices.append({"id": ident, "name": name.strip() or ident, "reachable": ident in reachable})
    return True, f"{len(devices)} paired device{'s' if len(devices) != 1 else ''}", devices


def send_to_phone(message, device=None):
    """Ping the phone with message (the one named, else every reachable paired one)."""
    ok, why, devices = phone_devices()
    if not ok:
        return False, why
    if device:
        targets = [d for d in devices if d["id"] == device]
        if not targets:
            return False, "That phone isn't paired with KDE Connect any more"
        if not targets[0]["reachable"]:
            return False, f"{targets[0]['name']} isn't reachable (is it on the same network?)"
    else:
        targets = [d for d in devices if d["reachable"]]
        if not targets:
            return False, "No paired phone is reachable through KDE Connect right now"
    sent = []
    for d in targets:
        try:
            done = subprocess.run([shutil.which("kdeconnect-cli"), "-d", d["id"], "--ping-msg", message],
                                  stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  timeout=15).returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            done = False
        if done:
            sent.append(d["name"])
    if not sent:
        return False, "KDE Connect couldn't send it"
    return True, "Sent to " + ", ".join(sent)


# ---------------------------------------------------------------- what a chat changed
#
# `--changes ID` compares the files a chat changed (claude_status.chat_edits)
# with what they were before it: copies of the originals go to a folder of
# their own in the cache (named like the files, so VS Code highlights them),
# then VS Code shows them side by side. With the Claude Status extension for
# VS Code (1.8 or newer) all of them open in one multi-file diff, through its
# vscode:// link; else each file opens with `code --diff`. `--turn` compares
# with what they were when you sent your last prompt; `--list` only prints
# the comparison (the VS Code extension opens it itself).

CHANGES_KEEP_S = 86400  # comparison folders are removed after a day
CHANGES_ONE_BY_ONE = 25  # files `code --diff` opens, at most
STATUS_EXTENSION = "wzaielamri.claude-status"
STATUS_EXTENSION_CHANGES = (1, 8)  # its first version that opens CHANGES_LINK
CHANGES_LINK = "vscode://wzaielamri.claude-status/changes"
EXTENSION_FOLDERS = {"code": ".vscode", "code-insiders": ".vscode-insiders", "codium": ".vscode-oss",
                     "code-oss": ".vscode-oss"}


def git_original(path):
    """A file's content as of git's HEAD: b"" for a file git doesn't have
    there (new since), None outside a git repository."""
    folder = os.path.dirname(path)
    if not shutil.which("git") or not os.path.isdir(folder):
        return None
    try:
        top = subprocess.run(["git", "-C", folder, "rev-parse", "--show-toplevel"],
                             stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=5)
        if top.returncode != 0:
            return None
        root = top.stdout.decode(errors="replace").strip()
        rel = os.path.relpath(os.path.realpath(path), os.path.realpath(root))
        shown = subprocess.run(["git", "-C", root, "show", f"HEAD:{rel}"],
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None
    return shown.stdout if shown.returncode == 0 else b""


def read_bytes(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def backup_content(profiles, sessions, name):
    """A file-history backup's content, from the folder of a session that wrote the chat."""
    for p in profiles:
        for sid in sessions:
            data = read_bytes(p.path / "file-history" / sid / name)
            if data is not None:
                return data
    return None


def changes_folder(home):
    """A new, empty folder for one comparison's copies; older ones are removed."""
    root = cs.cache_dir(home) / "changes"
    cs.private_dir(root)
    now = time.time()
    for old in root.iterdir():
        try:
            if now - old.stat().st_mtime > CHANGES_KEEP_S:
                shutil.rmtree(old, ignore_errors=True)
        except OSError:
            pass
    return Path(tempfile.mkdtemp(prefix=time.strftime("%Y%m%d-%H%M%S-"), dir=root))


def chat_comparison(home, extra_dirs, session_id, profile_dir=None, turn=False):
    """(ok, message, comparison) of what a chat changed: {"title", "folder",
    "items": [{"label", "path", "original", "created", "deleted"}]}, where
    original is a copy of the file before the chat (before its last turn),
    created means it didn't exist then and deleted that it's gone now."""
    profiles = cs.discover_profiles(home, extra_dirs)
    ordered = sorted(profiles, key=lambda p: not (profile_dir and cs.matches_profile(p, profile_dir)))
    path = next((t for t in (cs.transcript_path(p, session_id) for p in ordered) if t is not None), None)
    if path is None:
        return False, "Can't find that chat's transcript", None
    rec = cs.chat_edits(path)
    try:
        name, _, _ = cs.read_chat_info(path, path.stat().st_size)
    except OSError:
        name = ""
    cwd = cs.chat_folder(path) or ""
    skip = cs.own_folders(profiles)
    if turn:
        if rec["snap"] is None:
            return False, "Claude kept no record of where the last turn started", None
        names = dict(rec["snapFiles"], **rec["turn"])  # each file's backup as of your last prompt
    else:
        names = {key: first[0] for key, first in rec["files"].items()}  # from before the chat first changed it
    wanted = {}
    for key, backup in names.items():
        full = cs.absolute_path(key, cwd)
        if cs.project_file(full, skip):
            wanted[full] = backup
    folder, items, unknown = None, [], 0
    for full in sorted(wanted):
        backup = wanted[full]
        if backup is None:
            original = b""  # it didn't exist yet
        elif backup is False:
            original = git_original(full)  # no backup on record: git's last commit
        else:
            original = backup_content(profiles, rec["sessions"], backup)
            if original is None:
                original = git_original(full)  # Claude has removed the backup since
        if original is None:
            unknown += 1
            continue
        current = read_bytes(full)
        if current == original or (current is None and original == b""):
            continue  # unchanged (or made and removed again)
        if folder is None:
            folder = changes_folder(home)
        copy = folder / str(len(items)) / os.path.basename(full)
        copy.parent.mkdir()
        copy.write_bytes(original)
        items.append({"label": cs.file_label(full, cwd, home), "path": full, "original": str(copy),
                      "created": backup is None or (original == b"" and backup is False),
                      "deleted": current is None})
    what = "in its last turn" if turn else "since it started"
    if not items:
        more = f" ({unknown} with no earlier version to compare with)" if unknown else ""
        return False, f"No changed files {what}{more}", None
    title = f"{name or 'Chat'}: {'last turn' if turn else 'all changes'}"
    message = f"{len(items)} changed file{'s' if len(items) != 1 else ''} {what}"
    if unknown:
        message += f"; {unknown} more with no earlier version to compare with"
    return True, message, {"title": title, "folder": cwd, "items": items}


def status_extension_opens_changes(code):
    """Has VS Code the Claude Status extension, new enough for CHANGES_LINK?"""
    folder = EXTENSION_FOLDERS.get(os.path.basename(code or ""), ".vscode")
    installed = cs.read_json(Path.home() / folder / "extensions" / "extensions.json")
    for ext in installed if isinstance(installed, list) else []:
        ident = ext.get("identifier") if isinstance(ext, dict) else None
        if isinstance(ident, dict) and str(ident.get("id", "")).lower() == STATUS_EXTENSION:
            try:
                version = tuple(int(x) for x in str(ext.get("version", "")).split(".")[:2])
            except ValueError:
                continue
            if version >= STATUS_EXTENSION_CHANGES:
                return True
    return False


def open_diffs(code, items):
    """One `code --diff ORIGINAL FILE` per file (in the window used last)."""
    for item in items[:CHANGES_ONE_BY_ONE]:
        current = item["path"]
        if item["deleted"]:
            current = os.path.join(os.path.dirname(item["original"]), "(deleted) " + os.path.basename(item["path"]))
            Path(current).write_bytes(b"")
        subprocess.run([code, "--reuse-window", "--diff", item["original"], current], stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)


def show_changes(home, extra_dirs, session_id, profile_dir=None, turn=False):
    """Open what a chat changed in VS Code (see chat_comparison)."""
    code, _ = cs.vscode_app()
    if code is None:
        return False, "VS Code isn't installed: it shows the changes side by side"
    ok, message, comparison = chat_comparison(home, extra_dirs, session_id, profile_dir, turn)
    if not ok:
        return False, message
    folder = comparison["folder"]
    if status_extension_opens_changes(code) and shutil.which("xdg-open"):
        manifest = Path(comparison["items"][0]["original"]).parent.parent / "changes.json"
        cs.write_json_atomic(manifest, comparison)
        link = CHANGES_LINK + "?" + urlencode({"file": str(manifest)})
        if folder and os.path.isdir(folder):
            start_vscode_chat(code, folder, link)  # the folder's window, then the link there
        else:
            subprocess.Popen([shutil.which("xdg-open"), link], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
        return True, f"Comparing {message} in VS Code"
    items = comparison["items"]
    later(lambda: open_diffs(code, items))
    if len(items) > CHANGES_ONE_BY_ONE:
        return True, f"Comparing {message} in VS Code (the first {CHANGES_ONE_BY_ONE}; " \
                     f"the Claude Status extension for VS Code shows all of them in one view)"
    return True, f"Comparing {message} in VS Code"


def list_changes(home, extra_dirs, session_id, profile_dir=None, turn=False):
    """(ok, message, comparison) for the VS Code extension, which opens it itself."""
    return chat_comparison(home, extra_dirs, session_id, profile_dir, turn)


# ---------------------------------------------------------------- a subagent's run
#
# A subagent can't be opened in Claude Code from outside, so its whole run is
# saved as a Markdown file (claude_status.agent_run) and opened in the app you
# use for those. The VS Code extension opens the file itself (--no-open).

RUNS_KEEP_S = 86400  # saved runs are removed after a day


def runs_folder(home):
    """The folder for saved runs; files older than a day are removed."""
    root = cs.cache_dir(home) / "agent-runs"
    cs.private_dir(root)
    now = time.time()
    for old in root.iterdir():
        try:
            if now - old.stat().st_mtime > RUNS_KEEP_S:
                old.unlink()
        except OSError:
            pass
    return root


def save_run(home, title, agent_id, markdown):
    """Write a subagent's run to a file named after it; its path."""
    name = " ".join(re.sub(r"[^\w .,()+!'-]+", " ", title or "").split())[:60].strip() or "Subagent"
    path = runs_folder(home) / f"{name} ({re.sub(r'[^A-Za-z0-9]', '', agent_id)[:8]}).md"
    path.write_text(markdown, encoding="utf-8")
    return path


def open_file(path):
    """Open a file in the app you use for its type; False without xdg-open."""
    opener = shutil.which("xdg-open")
    if opener is None:
        return False
    start_app([opener, str(path)])
    return True


def show_agent_run(home, extra_dirs, chat_id, agent_id, profile_dir=None, open_it=True):
    """Save a chat's subagent's run as Markdown and open it: (ok, message, file)."""
    ok, message, title, markdown = cs.agent_run(home, extra_dirs, chat_id, agent_id, profile_dir)
    if not ok:
        return False, message, None
    path = save_run(home, title, agent_id, markdown)
    if open_it and not open_file(path):
        return False, f"Saved it as {path}, but there's no xdg-open to open it with", str(path)
    return True, message, str(path)


# ---------------------------------------------------------------- shared chats


def resume(home, extra_dirs, session_id, profile_dir=None):
    """Reopen a chat on a profile in a new terminal (claude --resume)."""
    profile, path = find_chat(home, extra_dirs, session_id, profile_dir)
    if profile is None:
        return False, "That chat isn't on this account"
    return resume_chat(profile, path, session_id, home)


def continue_on(home, extra_dirs, session_id, profile_dir):
    """Continue a chat on another account: share it with that account if it
    doesn't have it yet, then reopen it there in a terminal."""
    target, there = sharing.give_to(cs.discover_profiles(home, extra_dirs), session_id, profile_dir,
                                    sharing.store_root(home))
    if target is None:
        return False, there
    return resume_chat(target, there, session_id, home)


def continue_command(home, extra_dirs, session_id, profile_dir):
    """The same, but hand back the command that reopens it there instead of
    opening a terminal (the VS Code extension runs it in one of its own):
    (ok, message, command or None)."""
    claude = claude_in_terminal(home)
    if claude is None:
        return False, NO_CLAUDE, None
    return sharing.continue_command(cs.discover_profiles(home, extra_dirs), session_id, profile_dir,
                                    sharing.store_root(home), home, claude)


def share(home, extra_dirs, session_id, profile_dir=None):
    """Share a chat with every profile (from profile_dir's copy, if given)."""
    return sharing.share_with_all(cs.discover_profiles(home, extra_dirs), session_id, sharing.store_root(home),
                                  profile_dir)


def unshare(home, extra_dirs, session_id, profile_dir):
    """Make a shared chat a normal chat of one profile again; the others lose it."""
    return sharing.keep_only_on(cs.discover_profiles(home, extra_dirs), session_id, profile_dir,
                                sharing.store_root(home))


def dismiss(home, extra_dirs, session_id):
    """Hide a finished session from the widget's list. Nothing of Claude's is touched."""
    cs.change_dismissed(cs.cache_dir(home), add=session_id)
    return True, "Removed from the list"


def undismiss_all(home, extra_dirs, _session_id=None):
    cache_root = cs.cache_dir(home)
    count = len(cs.load_dismissed(cache_root))
    if count:
        cs.change_dismissed(cache_root, clear=True)
    return True, f"{count} session(s) shown again"


USAGE = ("usage: jump.py [--stop [--busy] | --interrupt] SESSION_ID [--profile PROFILE] [--config-dir DIR]...\n"
         "       jump.py --save-settings JSON --by WIDGET [--unless-default]\n"
         "       jump.py --new-chat PROFILE_DIRNAME [--cwd FOLDER | --choose-folder] [--vscode] [--config-dir DIR]...\n"
         "       jump.py --resume|--continue|--unshare SESSION_ID --profile PROFILE\n"
         "       jump.py --continue SESSION_ID --profile PROFILE --print-command   (share it; print the command, no terminal)\n"
         "       jump.py --share SESSION_ID\n"
         "       jump.py --remote-vscode HOST SESSION_ID [--cwd FOLDER_ON_HOST]\n"
         "       jump.py --remote-terminal HOST [--name SESSION_NAME]\n"
         "       jump.py --remote-new-vscode HOST [--cwd FOLDER_ON_HOST] [--account CONFIG_DIR|-]\n"
         "       jump.py --resume SESSION_ID --profile PROFILE --vscode\n"
         "       jump.py --remote-resume-vscode HOST SESSION_ID [--cwd FOLDER_ON_HOST]\n"
         "       jump.py --changes CHAT_ID [--profile PROFILE] [--turn] [--list]\n"
         "       jump.py --phone MESSAGE [--device ID]\n"
         "       jump.py --phone-devices\n"
         "       jump.py --agent-run AGENT_ID --chat CHAT_ID [--profile PROFILE] [--no-open]")


def stop_on_term(signum, frame):
    """Given up on (e.g. a folder dialog nobody answered): exiting through
    Python ends what subprocess.run runs (the dialog) too."""
    sys.exit(128 + signum)


def main(argv=None):
    if argv is None:
        signal.signal(signal.SIGTERM, stop_on_term)
    args = sys.argv[1:] if argv is None else list(argv)
    extra, session_id, action, folder, profile_dir = [], None, jump, None, None
    remote_host, name_arg, choose, vscode, print_command = None, "", False, False, False
    busy, settings_json, settings_by, unless_default = False, None, "", False
    turn, listing, device, devices = False, False, None, None
    agent_id, open_it, run_file, account = None, True, None, None
    while args:
        arg = args.pop(0)
        if arg == "--config-dir" and args:
            extra.append(args.pop(0))
        elif arg == "--print-command":
            print_command = True
        elif arg == "--profile" and args:
            profile_dir = args.pop(0)
        elif arg == "--stop":
            action = stop
        elif arg == "--busy":
            busy = True
        elif arg == "--interrupt":
            action = interrupt
        elif arg == "--changes":
            action = show_changes
        elif arg == "--phone" and args:
            action, session_id = send_to_phone, args.pop(0)  # the message
        elif arg == "--device" and args:
            device = args.pop(0)
        elif arg == "--agent-run" and args:
            action, agent_id = show_agent_run, args.pop(0)
        elif arg == "--chat" and args:
            session_id = args.pop(0)
        elif arg == "--no-open":
            open_it = False
        elif arg == "--phone-devices":
            action, session_id = phone_devices, "-"
        elif arg == "--turn":
            turn = True
        elif arg == "--list":
            listing = True
        elif arg == "--save-settings" and args:
            action, settings_json, session_id = save_settings, args.pop(0), session_id or "-"
        elif arg == "--by" and args:
            settings_by = args.pop(0)
        elif arg == "--unless-default":
            unless_default = True
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
        elif arg in ("--remote-vscode", "--remote-terminal", "--remote-new-vscode", "--remote-resume-vscode") and args:
            action, remote_host = arg, args.pop(0)
        elif arg == "--name" and args:
            name_arg = args.pop(0)
        elif arg in ("--resume", "--continue", "--share", "--unshare"):
            action = {"--resume": resume, "--continue": continue_on, "--share": share, "--unshare": unshare}[arg]
        elif arg == "--cwd" and args:
            folder = args.pop(0)
        elif arg == "--account" and args:
            account = args.pop(0)
        elif session_id is None and not arg.startswith("-"):
            session_id = arg
        else:
            sys.exit(USAGE)
    if action in ("--remote-terminal", "--remote-new-vscode"):
        session_id = session_id or "-"
    if not session_id or (action in (continue_on, unshare) and not profile_dir):
        sys.exit(USAGE)
    if print_command and action is not continue_on:
        sys.exit(USAGE)
    if vscode and action is resume and not profile_dir:
        sys.exit(USAGE)
    if (turn or listing) and action is not show_changes:
        sys.exit(USAGE)
    if not open_it and action is not show_agent_run:
        sys.exit(USAGE)
    command, comparison = None, None
    try:
        if print_command:
            ok, message, command = continue_command(Path.home(), extra, session_id, profile_dir)
        elif action == "--remote-vscode":
            ok, message = jump_remote_vscode(remote_host, session_id, folder or "")
        elif action == "--remote-terminal":
            ok, message = jump_remote_terminal(remote_host, name_arg)
        elif action == "--remote-new-vscode":
            ok, message = new_chat_remote_vscode(remote_host, folder or "", account)
        elif action == "--remote-resume-vscode":
            ok, message = resume_remote_vscode(remote_host, session_id, folder or "")
        elif action is resume and vscode:
            ok, message = resume_vscode(Path.home(), extra, session_id, profile_dir)
        elif action is stop:
            ok, message = stop(Path.home(), extra, session_id, profile_dir, busy)
        elif action is send_to_phone:
            ok, message = send_to_phone(session_id, device)
        elif action is phone_devices:
            ok, message, devices = phone_devices()
        elif action is show_agent_run:
            ok, message, run_file = show_agent_run(Path.home(), extra, session_id, agent_id, profile_dir, open_it)
        elif action is show_changes and listing:
            ok, message, comparison = list_changes(Path.home(), extra, session_id, profile_dir, turn)
        elif action is show_changes:
            ok, message = show_changes(Path.home(), extra, session_id, profile_dir, turn)
        elif action is save_settings:
            ok, message = save_settings(Path.home(), settings_json, settings_by, unless_default)
        elif action is new_chat and choose:
            ok, message = (new_chat_choosing_folder(Path.home(), extra, session_id, vscode=True) if vscode
                           else new_chat_choosing_folder(Path.home(), extra, session_id))
        elif action is new_chat:
            ok, message = (new_chat_vscode if vscode else new_chat)(Path.home(), extra, session_id, folder)
        elif action in (jump, interrupt, resume, continue_on, share, unshare):
            ok, message = action(Path.home(), extra, session_id, profile_dir)
        else:
            ok, message = action(Path.home(), extra, session_id)
    except Exception as exc:  # report, don't crash: the widget shows the message
        ok, message = False, f"{type(exc).__name__}: {exc}"
    print(json.dumps({"ok": ok, "message": message, **({"command": command} if command else {}),
                      **({"comparison": comparison} if comparison else {}),
                      **({"devices": devices} if devices is not None else {}),
                      **({"file": run_file} if run_file else {})}))


if __name__ == "__main__":
    main()
