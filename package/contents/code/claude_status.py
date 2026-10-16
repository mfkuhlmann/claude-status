#!/usr/bin/env python3
"""Status backend for the Claude Status Plasma widget.

Prints one JSON object describing every local Claude Code session (working,
waiting for input, idle), the plan-limit usage captured by the status line,
and token totals parsed from transcripts. Standard library only; the widget
runs it as `python3 -I claude_status.py` every couple of seconds.

Data sources (per Claude config dir, e.g. ~/.claude, ~/.claude-work):
  <cfg>/sessions/<pid>.json       live session registry kept by Claude Code
  <cfg>/jobs/<id>/state.json      background jobs (also ones with no process)
  <cfg>/projects/**/*.jsonl       transcripts (token usage per message, and
                                  which chat a session shows: shared chats are
                                  hard-linked into several profiles)
  <cfg>/history.jsonl             prompt history (recent folders, last use)
  <account file>                  oauthAccount.accountUuid / organizationType /
                                  displayName, and each folder's trust flag only
  ~/.cache/claude-widget/statusline/<cfg dirname>/<session_id>.json
                                  status-line input snapshots (rate limits,
                                  context window), written by statusline-snippet.sh
"""

import fcntl
import hashlib
import json
import mmap
import os
import re
import shlex
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

SNAPSHOT_MAX_AGE = 8 * 86400  # seconds a status-line snapshot is kept
TOKEN_SCAN_INTERVAL = 60  # seconds between transcript scans
TOKEN_DAYS = 8  # days of per-message token records kept in the cache
CACHE_VERSION = 3  # token cache; 3 = keyed by the real profile folder, linked folders followed

PLAN_NAMES = {
    "claude_free": "Free",
    "claude_pro": "Pro",
    "claude_max": "Max",
    "claude_team": "Team",
    "claude_enterprise": "Enterprise",
}
WINDOW_LABELS = {
    "five_hour": "5h",
    "seven_day": "7d",
    "seven_day_opus": "7d Opus",
    "seven_day_sonnet": "7d Sonnet",
    "spend_limit": "Spend",
}
WINDOW_ORDER = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"]
STATE_ORDER = {"waiting": 0, "working": 1, "idle": 2, "done": 3}
# Why a session reports status "waiting" (Claude Code's waitingFor values) ->
# what it waits for. "dialog open" is left out on purpose: that is a dialog you
# opened yourself (/model, /effort, ...), and Claude Code's own terminal status
# doesn't count it as blocked either.
WAITING_REASONS = {
    "permission prompt": "permission",
    "goal proposal": "goal approval",
    "sandbox request": "network access",
    "worker request": "worker request",
    "input needed": "question",
}
FINISHED_JOB_STATES = ("done", "failed", "stopped")
SESSION_KINDS = ("interactive", "bg")  # not the daemon's own processes
NOT_STARTED = "send a prompt to start"  # needs of a background session given no prompt yet
RECENT_JOB_MS = 5000
KEEP_DONE_HOURS = 24  # finished background jobs stay listed this long


# ---------------------------------------------------------------- helpers


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def read_text(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return None


def short_id(value):
    """Stable one-way id, so account UUIDs and paths never appear in the output."""
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def private_dir(path):
    """Create the cache dir readable only by the user: it holds project paths."""
    path.mkdir(parents=True, exist_ok=True)
    if path.stat().st_mode & 0o077:
        os.chmod(path, 0o700)


def write_json_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(tmp, path)


def to_ms(value):
    """Epoch seconds, epoch milliseconds or an ISO-8601 string -> epoch ms."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value if value > 1e12 else value * 1000)
    if isinstance(value, str):
        try:
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            return None
    return None


def local_day(timestamp):
    """ISO timestamp from a transcript -> local YYYY-MM-DD, or None."""
    ms = to_ms(timestamp)
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000).date().isoformat()


def short_path(path, home):
    if not path:
        return ""
    p, h = str(path), str(home)
    if p == h:
        return "~"
    if p.startswith(h + "/"):
        p = "~/" + p[len(h) + 1 :]
    parts = p.split("/")
    if len(parts) > 4:
        p = "…/" + "/".join(parts[-2:])
    return p


def strip_prefix(text, prefix):  # str.removeprefix needs Python 3.9; remote hosts may be older
    return text[len(prefix):] if text.startswith(prefix) else text


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


# ---------------------------------------------------------------- profiles


class Profile:
    """One Claude Code config dir (what CLAUDE_CONFIG_DIR points at)."""

    def __init__(self, path, home, aliases=()):
        self.path = path
        self.dirname = path.name
        try:
            self.real = path.resolve()
        except (OSError, RuntimeError):
            self.real = path
        # Rows and caches are keyed by the real folder: a link like ~/.claude
        # can be switched to another profile at any time.
        self.key = self.real.name
        # Other names of the same dir (e.g. ~/.claude linked to ~/.claude-personal):
        # status-line snapshots are filed under whichever name a session used.
        # A snapshot filed under a link's name only counts if it's newer than
        # the link itself: before the link was last switched, that name meant
        # another profile.
        names = [path, *(a if isinstance(a, Path) else home / a for a in aliases), self.real]
        self.snapshot_sources = {}
        for p in names:
            try:
                since = p.lstat().st_mtime if p.is_symlink() else 0.0
            except OSError:
                since = 0.0
            self.snapshot_sources[p.name] = max(since, self.snapshot_sources.get(p.name, 0.0))
        self.snapshot_dirs = list(self.snapshot_sources)
        is_default = path == home / ".claude"
        name = (read_text(path / ".profile-name") or "").strip()
        self.custom_name = bool(name)
        if not name:
            name = "default" if is_default else strip_prefix(path.name, ".claude-").lstrip(".") or path.name
        self.label = name
        # Claude Code keeps account info in $CLAUDE_CONFIG_DIR/.claude.json, or
        # ~/.claude.json when running with the default config dir.
        account = (read_json(path / ".claude.json") or {}).get("oauthAccount") or {}
        if is_default and not account:
            account = (read_json(home / ".claude.json") or {}).get("oauthAccount") or {}
        self.account_id = account.get("accountUuid")
        self.display_name = clean_text(account.get("displayName"), 40) or None
        org_type = account.get("organizationType") or ""
        self.plan = PLAN_NAMES.get(org_type) or (
            strip_prefix(org_type, "claude_").replace("_", " ").title() if org_type else None
        )
        self.is_default = is_default


def discover_profiles(home, extra_dirs=()):
    candidates = [home / ".claude", *sorted(home.glob(".claude-*"))]
    found = []
    for d in candidates:
        if d.is_dir() and ((d / "sessions").is_dir() or (d / "projects").is_dir()):
            found.append(d)
    for e in extra_dirs:
        d = Path(e).expanduser()
        if d.is_dir():
            found.append(d)
    by_real = {}
    for d in found:
        by_real.setdefault(d.resolve(), []).append(d)
    profiles = [Profile(dirs[0], home, dirs[1:]) for real, dirs in by_real.items()]
    # A lone ~/.claude isn't the "default" of anything: name it the way Claude
    # knows you (the account's display name), unless .profile-name says otherwise.
    if len(profiles) == 1 and profiles[0].is_default and not profiles[0].custom_name:
        profiles[0].label = profiles[0].display_name or "Claude"
    return profiles


def group_profiles(profiles):
    """Profiles logged into the same account share plan limits -> one group."""
    groups = {}
    for p in profiles:
        groups.setdefault(p.account_id or f"dir:{p.path}", []).append(p)
    return list(groups.items())


# ---------------------------------------------------------------- sessions


def proc_start_time(pid):
    """Field 22 (starttime) of /proc/<pid>/stat, as Claude stores in procStart."""
    try:
        with open(f"/proc/{pid}/stat", encoding="utf-8", errors="replace") as f:
            stat = f.read()
    except OSError:
        return None
    fields = stat[stat.rfind(")") + 2 :].split()  # comm may contain spaces
    return fields[19] if len(fields) > 19 else None


def is_alive(entry):
    pid = entry.get("pid")
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    start = proc_start_time(pid)
    if start is None:
        return False
    expected = entry.get("procStart")
    return expected is None or str(expected) == start  # guards against PID reuse


def is_recurring(job):
    """Routines, self-waking jobs and /loop jobs finish a run without being done
    (Claude Code 2.1.300: GY + Vat)."""
    in_flight = job.get("inFlight") if isinstance(job.get("inFlight"), dict) else {}
    looped = any(isinstance(job.get(k), str) and job[k].strip().lower().startswith("/loop")
                 for k in ("intent", "initialPrompt"))
    return (job.get("routine") is not None or job.get("selfWake") is True
            or "session_cron" in (in_flight.get("kinds") or []) or looped)


def job_finished(job):
    return job.get("state") in FINISHED_JOB_STATES and job.get("tempo") != "active"


def session_state(entry, job=None):
    """Map a session (and its background-job record) to waiting/working/idle/done.

    Mirrors Claude Code 2.1: the `claude agents` rules for background jobs and
    the terminal status (OSC 7501) rules for interactive sessions.
    """
    status = entry.get("status")
    waiting = status == "waiting" and entry.get("waitingFor") != "dialog open"
    if status == "busy":
        return "working"
    if job is None:
        if status == "shell":  # turn over, but a background shell still runs
            return "working"
        return "waiting" if waiting else "idle"
    # Background job. The live status above wins over the job record, whose
    # state can lag behind (e.g. still "blocked" after you answered); a job
    # needs you only when its tempo says so or the session itself waits.
    if job_finished(job) and not (job.get("state") == "done" and is_recurring(job)):
        return "done"
    if job.get("needs") == NOT_STARTED and job.get("tempo") == "blocked":
        return "idle"  # dispatched without a prompt: nothing for Claude to do yet
    if job.get("tempo") == "blocked" or waiting:
        return "waiting"
    return "working"


def parked_job_state(job, present, now_ms, keep_done_ms=0):
    """(state, reason) of a job record whose session process is gone, or None to hide it.

    Mirrors `claude agents --all`: the daemon retires idle workers, including
    jobs blocked on you, so a job can need input with no process running.
    Finished jobs (and jobs whose process died) stay listed for keep_done_ms.
    """
    if job.get("needs") == NOT_STARTED:
        return None
    updated = to_ms(job.get("updatedAt"))
    recent_end = bool(keep_done_ms) and updated is not None and now_ms - updated <= keep_done_ms
    if job_finished(job):
        if not (job.get("state") == "done" and is_recurring(job)):
            return ("done", "" if job.get("state") == "done" else job["state"]) if recent_end else None
        # A recurring job between two runs isn't done (`claude agents` too)
        return ("waiting" if job.get("tempo") == "blocked" else "working"), ""
    created = to_ms(job.get("createdAt"))
    if not present and not (created is not None and now_ms - created < RECENT_JOB_MS):
        exec_job = job.get("template") == "exec" and not job.get("respawnFlags")
        if job.get("state") == "blocked" and not exec_job:
            return "waiting", ""
        return ("done", "failed") if recent_end else None  # its process died mid-task
    return ("waiting" if job.get("tempo") == "blocked" else "working"), ""


def clean_text(value, limit=200):
    return " ".join(value.split())[:limit] if isinstance(value, str) else ""


def mtime(path):
    try:
        return path.stat().st_mtime
    except OSError:
        return None


def valid_id(value):
    return isinstance(value, str) and value != "" and "/" not in value and value not in (".", "..")


def snapshot_paths(snapshot_root, profile, ids):
    """(mtime, path) of this profile's status-line snapshots of these session
    ids, newest first, leaving out ones filed under a link's name before the
    link was last switched."""
    found = []
    for name, since in profile.snapshot_sources.items():
        for sid in ids:
            if not valid_id(sid):
                continue
            path = snapshot_root / name / f"{sid}.json"
            t = mtime(path)
            if t is not None and t >= since:
                found.append((t, path))
    found.sort(reverse=True)
    return found


def attach_snapshot(session, snapshot_root, profile, ids=None):
    """Add model, context fill and cost from the session's newest status-line snapshot."""
    ids = dict.fromkeys(ids or [session["sessionId"]])
    for _, path in snapshot_paths(snapshot_root, profile, ids):
        snap = read_json(path)
        if isinstance(snap, dict):
            ctx = snap.get("context_window") or {}
            session["context"] = number(ctx.get("used_percentage"))
            session["model"] = (snap.get("model") or {}).get("display_name")
            session["costUsd"] = number((snap.get("cost") or {}).get("total_cost_usd"))
            return


def make_session(profile, home, *, sid, pid, name, cwd, kind, entrypoint, state, reason,
                 waiting_for, detail, since, started_at):
    return {
        # A shared chat can be listed under two profiles with the same id, so
        # rows are told apart by profile + id + live/background-record.
        "key": f"{profile.key}/{sid}/{'live' if pid else 'job'}",
        "profileDir": profile.key,
        "sessionId": sid,
        "chatId": sid,
        "pid": pid,
        "name": name or os.path.basename(cwd) or sid[:8],
        "cwd": cwd,
        "cwdShort": short_path(cwd, home),
        "profile": profile.label,
        "kind": kind,
        "entrypoint": entrypoint,
        "state": state,
        "reason": reason,
        "waitingFor": waiting_for,
        "detail": detail,
        "since": since,
        "startedAt": started_at,
        "context": None,
        "model": None,
        "costUsd": None,
        "agents": None,
        "shared": None,
    }


def process_config_dir(pid):
    """The Claude config dir a running process uses right now (its
    CLAUDE_CONFIG_DIR, else ~/.claude of its HOME), with links resolved."""
    try:
        with open(f"/proc/{pid}/environ", "rb") as f:
            env = f.read().split(b"\0")
    except OSError:
        return None
    values = {}
    for item in env:
        key, sep, value = item.partition(b"=")
        if sep and key in (b"CLAUDE_CONFIG_DIR", b"HOME"):
            values[key] = value.decode(errors="replace")
    folder = values.get(b"CLAUDE_CONFIG_DIR") or (values[b"HOME"] + "/.claude" if values.get(b"HOME") else None)
    if not folder:
        return None
    try:
        return Path(folder).expanduser().resolve()
    except (OSError, RuntimeError):
        return None


def live_entries_all(profiles):
    """[(entry, profile it runs on, profile whose sessions/ holds the entry)]
    of every live session process.

    A process started with a link name (CLAUDE_CONFIG_DIR=~/.claude) follows
    the link when it's switched to another profile: its next status write
    lands in the other profile's sessions/, and the old file stays behind
    until the process exits. So the same process (same pid, start time and
    file name) can show up in two profiles: keep its newest entry, under the
    profile its config dir points to now.
    """
    by_real = {p.real: p for p in profiles}
    best, order = {}, []
    for p in profiles:
        try:
            files = sorted((p.path / "sessions").glob("*.json"))
        except OSError:
            continue
        for f in files:
            entry = read_json(f)
            if not isinstance(entry, dict) or not is_alive(entry):
                continue
            key = (entry.get("pid"), str(entry.get("procStart")), f.stem)
            stamp = max(number(entry.get("statusUpdatedAt")) or 0, number(entry.get("updatedAt")) or 0,
                        int((mtime(f) or 0) * 1000))
            if key not in best:
                order.append(key)
            if key not in best or stamp > best[key][2]:
                best[key] = (entry, p, stamp)
    result = []
    for key in order:
        entry, holder, _ = best[key]
        runs_on = by_real.get(process_config_dir(entry["pid"]))
        result.append((entry, runs_on or holder, holder))
    return result


def read_job(profiles, job_id):
    """A job's state.json, from the first of profiles that has it (newest wins
    when several do: a job written through a switched link can leave a copy)."""
    if not valid_id(job_id):
        return None
    best = None
    for p in profiles:
        job = read_json(p.path / "jobs" / job_id / "state.json")
        if isinstance(job, dict) and (best is None or (to_ms(job.get("updatedAt")) or 0) > (to_ms(best.get("updatedAt")) or 0)):
            best = job
    return best


def live_row(entry, profile, holder, home, ctx):
    """The row of a live session process, or None for processes that aren't sessions."""
    # Pre-warmed spares, terminals parked on a background job and the daemon's
    # own processes are not sessions (`claude agents` hides them).
    if entry.get("spare") or entry.get("parkedJobId") or entry.get("kind") not in SESSION_KINDS:
        return None
    job_id = entry.get("jobId") if valid_id(entry.get("jobId")) else None
    # Background jobs keep their lifecycle (state, tempo, what they need, a
    # one-line detail) in jobs/<jobId>/state.json; some sessions write the same
    # fields into their own entry.
    job = read_job(dict.fromkeys([profile, holder]), job_id) if job_id else None
    own = {k: entry[k] for k in ("state", "tempo", "needs", "detail") if k in entry}
    if own:
        job = {**(job or {}), **own}
    state = session_state(entry, job)
    waiting_for = entry.get("waitingFor") if entry.get("status") == "waiting" else None
    if state == "waiting":
        reason = WAITING_REASONS.get(waiting_for, waiting_for or "")
        detail = clean_text((job or {}).get("needs"))
    elif state == "done":
        outcome = (job or {}).get("state")
        reason = outcome if outcome in ("failed", "stopped") else ""
        detail = clean_text((job or {}).get("detail"))
    else:
        reason = "background shell" if entry.get("status") == "shell" else ""
        detail = ""
    cwd = entry.get("cwd") if isinstance(entry.get("cwd"), str) else ""
    sid = entry.get("sessionId") if valid_id(entry.get("sessionId")) else ""
    row = make_session(
        profile, home, sid=sid, pid=entry.get("pid"), name=entry.get("name"),
        cwd=cwd, kind=entry.get("kind"), entrypoint=entry.get("entrypoint") or "", state=state,
        reason=reason, waiting_for=waiting_for or "", detail=detail,
        since=number(entry.get("statusUpdatedAt")) or number(entry.get("startedAt")),
        started_at=number(entry.get("startedAt")))
    return finish_row(row, job, job_id, profile, ctx, alive=True)


def parked_rows(profile, home, live_jobs, ctx):
    """Background jobs with no session process: blocked on you, or recently finished."""
    status = read_json(profile.path / "daemon.status.json")
    roster = status.get("workers") if isinstance(status, dict) else None
    roster = roster if isinstance(roster, dict) else {}
    try:
        dirs = sorted(d for d in (profile.path / "jobs").iterdir() if d.is_dir())
    except OSError:
        return []
    rows = []
    for d in dirs:
        if d.name in live_jobs:
            continue
        job = read_json(d / "state.json")
        if not isinstance(job, dict):
            continue
        worker = roster.get(d.name)
        parked = parked_job_state(job, isinstance(worker, dict) and is_alive(worker), ctx.now_ms, ctx.keep_done_ms)
        if parked is None:
            continue
        state, reason = parked
        name = next((job[k] for k in ("name", "displayIntent", "intent")
                     if isinstance(job.get(k), str) and job[k].strip()), "")
        row = make_session(
            profile, home, sid=job["sessionId"] if valid_id(job.get("sessionId")) else d.name,
            pid=None, name=clean_text(name, 80), cwd=job.get("cwd") if isinstance(job.get("cwd"), str) else "",
            kind="bg", entrypoint="", state=state, reason=reason, waiting_for="",
            detail=clean_text(job.get("needs") if state == "waiting" else job.get("detail") if state == "done" else ""),
            since=to_ms(job.get("updatedAt")), started_at=to_ms(job.get("createdAt")))
        rows.append(finish_row(row, job, d.name, profile, ctx, alive=False))
    return rows


def finish_row(row, job, job_id, profile, ctx, alive):
    """Which conversation the row shows, whether it's shared, its status-line
    snapshot and its subagents."""
    row["jobId"] = job_id
    row["jobSessionId"] = job["sessionId"] if isinstance(job, dict) and valid_id(job.get("sessionId")) else None
    row["chatId"], row["shared"] = chat_link(row, job, profile, ctx)
    attach_snapshot(row, ctx.snapshot_root, profile, [row["sessionId"], row["chatId"], row["jobSessionId"]])
    if ctx.agents is not None:  # a session continuing a chat shows that chat's agents
        row["agents"] = ctx.agents.session_agents(profile, row["chatId"], alive=alive)
    return row


# ---------------------------------------------------------------- subagents

AGENT_TAIL_BYTES = 65536
AGENT_CACHE_VERSION = 2  # bump when agent_progress() reads transcripts differently
AGENT_TREE_LIMIT = 30


def short_text(value, limit=70):
    text = " ".join(str(value).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def describe_tool(block):
    """What a tool call is doing, in a few words: "Bash: npm test", "Edit: parser.py"."""
    name = block.get("name") or "tool"
    inp = block.get("input") if isinstance(block.get("input"), dict) else {}
    if name.startswith("mcp__"):
        parts = name.split("__")
        name = f"{parts[1]}: {parts[2]}" if len(parts) >= 3 else name
    if name == "Bash" and inp.get("command"):
        return f"Bash: {short_text(inp['command'], 60)}"
    for key in ("file_path", "notebook_path", "path"):
        if inp.get(key):
            return f"{name}: {os.path.basename(str(inp[key]).rstrip('/')) or inp[key]}"
    for key in ("description", "pattern", "query", "url", "skill", "prompt"):
        if inp.get(key):
            return f"{name}: {short_text(inp[key], 60)}"
    return name


def report_line(text):
    """First line of an agent's report, without markdown decoration."""
    for line in (text or "").splitlines():
        line = line.replace("**", "").strip().lstrip("#*>-| ").strip()
        if line:
            return short_text(line, 90)
    return "finished"


def agent_progress(path):
    """(status, activity, last timestamp ms) from the end of a subagent transcript.

    Done = it handed its report back (a SubagentHandback call) or its last entry
    is a final answer (end_turn); otherwise it's still working: on a tool call
    (shown) or thinking about tool results.
    """
    try:
        size = path.stat().st_size
        with open(path, "rb") as f:
            f.seek(max(0, size - AGENT_TAIL_BYTES))
            lines = f.read().splitlines()
    except OSError:
        return "running", "", None
    if size > AGENT_TAIL_BYTES:
        lines = lines[1:]  # probably cut in the middle
    recent = []
    for line in reversed(lines):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if isinstance(e, dict) and e.get("type") in ("assistant", "user"):
            recent.append(e)
            if len(recent) >= 8:
                break
    if not recent:
        return "running", "starting…", None
    ts = to_ms(recent[0].get("timestamp"))
    for e in recent:
        msg = e.get("message") if isinstance(e.get("message"), dict) else {}
        content = [c for c in msg.get("content") or [] if isinstance(c, dict)] \
            if isinstance(msg.get("content"), list) else []
        if e["type"] == "user":
            if e is recent[0]:
                continue  # tool results just came back; look at what it ran
            return "running", "thinking…", ts
        uses = [c for c in content if c.get("type") == "tool_use"]
        if uses and uses[-1].get("name") == "SubagentHandback":
            report = (uses[-1].get("input") or {}).get("message")
            return "done", report_line(report if isinstance(report, str) else ""), ts
        if uses:
            label = describe_tool(uses[-1])
            return "running", (label if e is recent[0] else f"{label} (thinking about the result)"), ts
        if msg.get("stop_reason") == "end_turn":
            text = next((c.get("text") for c in content if c.get("type") == "text" and c.get("text")), "")
            return "done", report_line(text), ts
        return "running", "writing…", ts
    return "running", "thinking…", ts


def agent_started(path):
    """Timestamp (ms) of the first entry of a subagent transcript."""
    try:
        with open(path, "rb") as f:
            for line in f:
                try:
                    ts = to_ms(json.loads(line).get("timestamp"))
                except (ValueError, AttributeError):
                    continue
                if ts is not None:
                    return ts
    except OSError:
        pass
    return None


class AgentCache:
    """Remembers each subagent transcript's progress by (size, mtime) between polls,
    so only transcripts that changed are read again."""

    def __init__(self, path):
        self.path = path
        data = read_json(path)
        ok = isinstance(data, dict) and data.get("version") == AGENT_CACHE_VERSION
        self.old_files = data.get("files", {}) if ok else {}
        self.old_parents = data.get("parents", {}) if ok else {}
        self.files, self.parents, self.changed = {}, {}, not ok

    def progress(self, transcript):
        """(status, activity, last ts, started ts) of a subagent transcript."""
        try:
            st = transcript.stat()
        except OSError:
            return "running", "starting…", None, None
        key = str(transcript)
        old = self.old_files.get(key)
        if old and len(old) == 6 and old[0] == st.st_size and old[1] == st.st_mtime_ns:
            self.files[key] = old
            return old[2], old[3], old[4], old[5]
        status, activity, ts = agent_progress(transcript)
        started = old[5] if old and len(old) == 6 and old[5] is not None else agent_started(transcript)
        self.files[key] = [st.st_size, st.st_mtime_ns, status, activity, ts, started]
        self.changed = True
        return status, activity, ts, started

    def parent(self, agent_dir, agent_id, tool_use_id):
        """Which other agent of the session started this one (nested agents), if any."""
        if agent_id in self.old_parents:
            self.parents[agent_id] = self.old_parents[agent_id]
            return self.parents[agent_id]
        needle = f'"{tool_use_id}"'.encode()
        for other in agent_dir.glob("agent-*.jsonl"):
            other_id = other.name[len("agent-"):-len(".jsonl")]
            if other_id == agent_id:
                continue
            try:
                if needle in other.read_bytes():
                    self.parents[agent_id] = other_id
                    self.changed = True
                    return other_id
            except OSError:
                continue
        return None

    def session_agents(self, profile, session_id, alive):
        """Subagents of one session as counts plus a display-ordered tree, or None."""
        if not session_id or "/" in session_id:
            return None
        agents = []
        for agent_dir in (profile.path / "projects").glob(f"*/{session_id}/subagents"):
            for meta_path in agent_dir.glob("agent-*.meta.json"):
                meta = read_json(meta_path)
                if not isinstance(meta, dict):
                    continue
                agent_id = meta_path.name[len("agent-"):-len(".meta.json")]
                status, activity, ts, started = self.progress(agent_dir / f"agent-{agent_id}.jsonl")
                if status == "running" and not alive:
                    status = "stopped"  # its session ended before it finished
                depth = meta.get("spawnDepth") if isinstance(meta.get("spawnDepth"), int) else 1
                parent = None
                if depth > 1 and isinstance(meta.get("toolUseId"), str):
                    parent = self.parent(agent_dir, agent_id, meta["toolUseId"])
                if started is None:
                    try:
                        started = int(meta_path.stat().st_mtime * 1000)
                    except OSError:
                        pass
                agents.append({
                    "id": agent_id,
                    "parent": parent,
                    "type": str(meta.get("agentType") or "agent"),
                    "description": short_text(meta.get("description") or "", 80),
                    "background": meta.get("requestShape") == "background",
                    "status": status,
                    "activity": activity,
                    "started": started,
                    "updated": ts,
                })
        if not agents:
            return None
        counts = {k: sum(a["status"] == k for a in agents) for k in ("running", "done", "stopped")}
        # Display order: depth-first from the session's own agents, oldest first.
        children = {}
        ids = {a["id"] for a in agents}
        for a in sorted(agents, key=lambda a: (a["started"] or 0, a["id"])):
            children.setdefault(a["parent"] if a["parent"] in ids else None, []).append(a)
        tree = []

        def walk(parent, depth):
            for a in children.get(parent, []):
                tree.append({**a, "depth": depth})
                walk(a["id"], depth + 1)
        walk(None, 0)
        if len(tree) > AGENT_TREE_LIMIT:  # keep every running one, then the newest
            keep = {a["id"] for a in tree if a["status"] == "running"}
            for a in sorted(tree, key=lambda a: -(a["started"] or 0)):
                if len(keep) >= AGENT_TREE_LIMIT:
                    break
                keep.add(a["id"])
            tree = [a for a in tree if a["id"] in keep]
        return {**counts, "total": len(agents), "tree": tree}

    def save(self):
        if self.changed or set(self.files) != set(self.old_files):
            try:
                write_json_atomic(self.path, {"version": AGENT_CACHE_VERSION, "files": self.files, "parents": self.parents})
            except OSError:
                pass


# ---------------------------------------------------------------- shared chats
#
# A chat shared across profiles is one transcript file hard-linked into each
# profile's projects/ folder (as ~/.claude-shared/profile-tools/shared-chats.sh
# does). Every row knows which conversation it shows (chatId: the transcript it
# writes) and how that relates to a shared chat:
#   - the shared chat itself, maybe through a background session of its own
#     whose own file holds no messages (`continues`);
#   - a copy: Claude forked the shared chat into a transcript of its own, which
#     starts with the shared chat's history (`forkOf`);
#   - nothing to do with it (a new conversation).


def transcript_path(profile, session_id):
    if not valid_id(session_id):
        return None
    return next(iter(profile.path.glob(f"projects/*/{session_id}.jsonl")), None)


def shared_info(session_id, profile, all_profiles):
    """Is this chat shared across profiles? Returns {"profiles": [labels],
    "openIn": label holding it open or None}, or None."""
    own = transcript_path(profile, session_id)
    try:
        st = own.stat() if own else None
    except OSError:
        return None
    if st is None or st.st_nlink < 2:
        return None
    labels = [profile.label]
    for other in all_profiles:
        if other is profile:
            continue
        for t in other.path.glob(f"projects/*/{session_id}.jsonl"):
            try:
                o = t.stat()
            except OSError:
                continue
            if (o.st_dev, o.st_ino) == (st.st_dev, st.st_ino) and other.label not in labels:
                labels.append(other.label)
    if len(labels) < 2:
        return None
    return {"profiles": labels, "openIn": shared_holder(session_id, all_profiles)}


MESSAGE_LINE = re.compile(rb'"type":\s*"(?:user|assistant)"')


def has_own_messages(profile, session_id):
    """Does this session's own transcript hold any conversation?"""
    path = transcript_path(profile, session_id)
    if path is None:
        return False
    try:
        with open(path, "rb") as f:
            return any(MESSAGE_LINE.search(line) for line in f)
    except OSError:
        return False


def file_key(st):
    return f"{st.st_dev}:{st.st_ino}"


class LinkCache:
    """What the widget learned about transcripts, kept between polls in
    links.json, so big shared transcripts are only read where they grew:

    - for each shared transcript: its `continued-in` records (Claude writes one
      when the chat moves on to another session) and where its last finished
      reply is, which tells whether the chat moved on (Claude's own rule);
    - for each other transcript: the uuid of its first entry, and whether a
      shared transcript holds that entry (then it's a copy of that chat).
    """

    VERSION = 2

    def __init__(self, path):
        self.path = path
        data = read_json(path)
        ok = isinstance(data, dict) and data.get("version") == self.VERSION
        self.old = data if ok else {}
        self.data = {"version": self.VERSION, "transcripts": {}, "firstUuid": {}, "holds": {}, "chats": {}}
        self.changed = not ok

    def _keep(self, section, key, value):
        if self.old.get(section, {}).get(key) != value:
            self.changed = True
        self.data[section][key] = value

    def transcript(self, path):
        """{"size", "conts": [[session id, offset]], "final": offset} of a
        shared transcript, scanning only what was appended since last time."""
        try:
            st = path.stat()
        except OSError:
            return None
        key = file_key(st)
        rec = self.data["transcripts"].get(key) or self.old.get("transcripts", {}).get(key)
        if not (isinstance(rec, dict) and isinstance(rec.get("size"), int) and rec["size"] <= st.st_size):
            rec = {"size": 0, "conts": [], "final": -1}
        if rec["size"] < st.st_size:
            rec = dict(rec, conts=list(rec["conts"]))
            try:
                with open(path, "rb") as f:
                    f.seek(rec["size"])
                    chunk = f.read(st.st_size - rec["size"])
            except OSError:
                chunk = b""
            end = chunk.rfind(b"\n")  # never consume a half-written last line
            if end >= 0:
                offset = rec["size"]
                for line in chunk[:end + 1].splitlines(keepends=True):
                    if b'"continued-in"' in line or b'"stop_reason":"' in line:
                        try:
                            e = json.loads(line)
                        except ValueError:
                            e = None
                        if isinstance(e, dict):
                            if e.get("type") == "continued-in" and valid_id(e.get("continuedInSessionId")):
                                rec["conts"].append([e["continuedInSessionId"], offset])
                            elif finished_reply(e):
                                rec["final"] = offset
                    offset += len(line)
                rec["size"] = offset
        self._keep("transcripts", key, rec)
        return rec

    def first_uuid(self, path):
        """uuid of the first entry that has one ('' if none in the first 256 KB)."""
        try:
            st = path.stat()
        except OSError:
            return ""
        key = file_key(st)
        cached = self.data["firstUuid"].get(key, self.old.get("firstUuid", {}).get(key))
        if isinstance(cached, str) and cached:
            self._keep("firstUuid", key, cached)
            return cached
        found = ""
        try:
            with open(path, "rb") as f:
                head = f.read(262144)
        except OSError:
            head = b""
        for line in head.splitlines()[:-1] if not head.endswith(b"\n") else head.splitlines():
            if b'"uuid"' not in line:
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if isinstance(e, dict) and isinstance(e.get("uuid"), str) and e["uuid"]:
                found = e["uuid"]
                break
        self._keep("firstUuid", key, found)
        return found

    def holds(self, shared_path, uuid):
        """Does this shared transcript contain the entry with this uuid? Once
        known it stays true; a copy's first entry is in the chat before the
        copy exists, so a no stays a no too (per file)."""
        try:
            st = shared_path.stat()
        except OSError:
            return False
        key = f"{uuid}|{file_key(st)}"
        cached = self.data["holds"].get(key, self.old.get("holds", {}).get(key))
        if isinstance(cached, bool):
            self._keep("holds", key, cached)
            return cached
        found = False
        try:
            with open(shared_path, "rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as m:
                found = m.find(f'"uuid":"{uuid}"'.encode()) >= 0
        except (OSError, ValueError):
            pass
        self._keep("holds", key, found)
        return found

    def chat_info(self, path, st):
        """(name, cwd, has messages) of a transcript, read again only when it grew."""
        key = file_key(st)
        cached = self.data["chats"].get(key, self.old.get("chats", {}).get(key))
        if isinstance(cached, list) and len(cached) == 4 and cached[0] == st.st_size:
            self._keep("chats", key, cached)
            return cached[1], cached[2], cached[3]
        name, cwd, messages = read_chat_info(path, st.st_size)
        self._keep("chats", key, [st.st_size, name, cwd, messages])
        return name, cwd, messages

    def save(self):
        if self.changed or any(set(self.data[s]) != set(self.old.get(s, {})) for s in ("transcripts", "firstUuid", "holds", "chats")):
            try:
                write_json_atomic(self.path, self.data)
            except OSError:
                pass


def finished_reply(e):
    """Claude's test for a finished assistant reply (its transcript `I()`)."""
    msg = e.get("message")
    return (e.get("type") == "assistant" and e.get("isApiErrorMessage") is not True
            and isinstance(msg, dict) and isinstance(msg.get("stop_reason"), str))


def shared_transcripts(folder):
    """Shared (hard-linked) transcripts in a project folder."""
    try:
        files = sorted(folder.glob("*.jsonl"))
    except OSError:
        return []
    out = []
    for t in files:
        try:
            if t.stat().st_nlink > 1:
                out.append(t)
        except OSError:
            continue
    return out


def project_folders(profile, ids, cwd):
    """Project folders (projects/<key>) a session's transcripts can be in."""
    folders = []
    for sid in ids:
        path = transcript_path(profile, sid)
        if path is not None:
            folders.append(path.parent)
    if cwd:
        folders.append(profile.path / "projects" / re.sub(r"[^A-Za-z0-9]", "-", cwd))
    return list(dict.fromkeys(f for f in folders if f.is_dir()))


def continued_from(profile, ids, cwd, ctx):
    """The shared chat whose `continued-in` record names one of these ids (a
    background session that took the chat over gets an id of its own)."""
    wanted = {i for i in ids if valid_id(i)}
    for folder in project_folders(profile, ids, cwd):
        for t in shared_transcripts(folder):
            rec = ctx.links.transcript(t)
            if rec and any(c[0] in wanted for c in rec["conts"]) and t.stem not in wanted:
                return t.stem
    return None


def copied_from(profile, session_id, ctx):
    """The shared chat this session's transcript is a copy of: Claude forked it
    and the copy starts with the chat's history (its first entry's uuid is in
    the shared transcript)."""
    path = transcript_path(profile, session_id)
    if path is None:
        return None
    uuid = ctx.links.first_uuid(path)
    if not uuid:
        return None
    for t in shared_transcripts(path.parent):
        if t != path and ctx.links.holds(t, uuid):
            return t.stem
    return None


def chat_link(row, job, profile, ctx):
    """(chatId, shared info or None) of a row.

    chatId is the conversation the row shows: its own transcript, or, when its
    own file holds no messages, the chat it took over (the job's
    resumeSessionId, else the chat whose `continued-in` record names it).
    """
    own = row["sessionId"]
    job = job if isinstance(job, dict) else {}
    chat, continues = own, None
    if not has_own_messages(profile, own):
        target = job.get("resumeSessionId") if valid_id(job.get("resumeSessionId")) else None
        if target == own:
            target = None
        if target is None:
            target = continued_from(profile, [own, job.get("sessionId")], row["cwd"], ctx)
        if target is not None:
            chat, continues = target, target
    info = shared_info(chat, profile, ctx.profiles)
    if info:
        if continues:
            info["continues"] = continues
        return chat, info
    # Not shared itself: a copy of a shared chat? The job may name it; else
    # its history gives it away.
    origin = None
    for k in ("forkParentSessionId", "resumeSessionId"):
        candidate = job.get(k)
        if valid_id(candidate) and candidate != chat and transcript_path(profile, candidate) is not None:
            origin = candidate
            break
    if origin is None or not shared_info(origin, profile, ctx.profiles):
        origin = copied_from(profile, chat, ctx)
    if origin is not None:
        info = next((i for i in (shared_info(origin, p, ctx.profiles) for p in ctx.profiles) if i), None)
        if info:
            return chat, {**info, "forkOf": origin, "forkOn": profile.label}
    return chat, None


def chat_id(session):
    """The conversation a row shows (a background session that took a chat
    over has an id of its own but is that chat)."""
    return session.get("chatId") or session["sessionId"]


def moved_to(chat, ctx):
    """Session id a chat moved on to, by Claude's own rule: its transcript's
    last `continued-in` record comes after its last finished reply."""
    for p in ctx.profiles:
        path = transcript_path(p, chat)
        if path is None:
            continue
        rec = ctx.links.transcript(path)
        if rec:
            after = [c[0] for c in rec["conts"] if c[1] > rec["final"]]
            return after[-1] if after else None
    return None


def chat_activity(chat, ids, ctx):
    """{profile: last time (ms) this chat was used there}, from the status-line
    snapshots, the prompt history and shared-chats.sh's lock."""
    seen = {}
    ids = [i for i in dict.fromkeys([chat, *ids]) if valid_id(i)]
    for p in ctx.profiles:
        snaps = snapshot_paths(ctx.snapshot_root, p, ids)
        times = [int(snaps[0][0] * 1000)] if snaps else []
        last_prompt = max((ctx.prompts.get(p.real, {}).get(i, 0) for i in ids), default=0)
        if last_prompt:
            times.append(last_prompt)
        if times:
            seen[p] = max(times)
    holder = lock_holder(chat, ctx.profiles)
    if holder is not None:
        p, when = holder
        seen[p] = max(seen.get(p, 0), when)
    return seen


REHOME_SLACK_MS = 60_000


def place_chats(groups, ctx):
    """List each conversation once.

    - A chat that moved on to a copy of itself (Claude's `continued-in` rule)
      isn't listed: the copy is, and accounts sharing the chat get a link to it.
    - A chat that runs somewhere is listed there; its finished background
      records elsewhere are left out (the row notes them as stopped copies).
    - A finished shared chat is listed under the account it was used on last.
      If that account has no record of it (e.g. you used it in a terminal
      there), the newest record moves there as a finished chat ("chat").
    """
    by_profile = {p.key: p for p in ctx.profiles}
    group_of = {key: g for g in groups for key in g["profileKeys"]}
    ctx.moved_on = set()
    rows = {}
    for g in groups:
        for s in g["sessions"]:
            rows.setdefault(chat_id(s) or s["key"], []).append((g, s))

    def is_record(s):  # a finished background record with no process
        return s["state"] == "done" and s["pid"] is None

    def note_stopped(keep, gone):
        for _, k in keep:
            for _, s in gone:
                if s["kind"] == "bg" and s["profile"] != k["profile"]:
                    if k["shared"] is not None:
                        stopped = k["shared"].setdefault("stoppedCopies", [])
                        if s["profile"] not in stopped:
                            stopped.append(s["profile"])

    def drop(entries):
        for g, s in entries:
            if g is not None:
                g["sessions"] = [x for x in g["sessions"] if x is not s]

    # A shared chat that moved on to a listed copy of itself
    forks = {}
    for g in groups:
        for s in g["sessions"]:
            if s["shared"] and s["shared"].get("forkOf"):
                forks.setdefault(s["shared"]["forkOf"], []).append(s)
    for chat, entries in list(rows.items()):
        if not any(s["shared"] and not s["shared"].get("forkOf") for _, s in entries) or chat not in forks:
            continue
        target = moved_to(chat, ctx)
        copy = next((f for f in forks[chat] if target in (f["sessionId"], f.get("jobSessionId"))), None)
        if copy is None:
            continue
        if all(is_record(s) for _, s in entries):
            copy["shared"]["movedHere"] = True
            ctx.moved_on.add(chat)
            drop(entries)
            note_stopped([(None, copy)], entries)
            del rows[chat]

    # A finished shared chat that moved on to a chat listed anyway: its copy
    # was shared too, so it's a shared chat of its own rather than a copy
    listed = {i: s for g in groups for s in g["sessions"]
              for i in (s["sessionId"], s.get("jobSessionId"), chat_id(s)) if i}
    for chat, entries in list(rows.items()):
        if not any(s["shared"] for _, s in entries) or not all(is_record(s) for _, s in entries):
            continue
        target = moved_to(chat, ctx)
        if target is None or target == chat or target not in listed or chat_id(listed[target]) == chat:
            continue
        ctx.moved_on.add(chat)
        drop(entries)
        del rows[chat]

    for chat, entries in rows.items():
        shared = next((s["shared"] for _, s in entries if s["shared"] and not s["shared"].get("forkOf")), None)
        active = [(g, s) for g, s in entries if not is_record(s)]
        if active:
            stale = [(g, s) for g, s in entries if is_record(s)]
            drop(stale)
            note_stopped(active, stale)
            continue
        entries = sorted(entries, key=lambda e: -(e[1]["since"] or 0))
        newest_g, newest = entries[0]
        if shared is None:
            drop(entries[1:])
            continue
        # Finished everywhere: which account used it last?
        seen = chat_activity(chat, [i for _, s in entries for i in (s["sessionId"], s.get("jobSessionId"))], ctx)
        for g, s in entries:
            p = by_profile.get(s["profileDir"])
            if p is not None:
                seen[p] = max(seen.get(p, 0), s["since"] or 0)
        listed = {by_profile.get(s["profileDir"]) for _, s in entries}
        home = max(seen, key=lambda p: seen[p]) if seen else None
        if home is None or home in listed or home.key not in group_of \
                or seen[home] - max((seen.get(p, 0) for p in listed if p is not None), default=0) < REHOME_SLACK_MS:
            keep_p = home if home in listed else by_profile.get(newest["profileDir"])
            keep = next(((g, s) for g, s in entries if s["profileDir"] == getattr(keep_p, "key", None)), entries[0])
            gone = [e for e in entries if e[1] is not keep[1]]
            drop(gone)
            note_stopped([keep], gone)
            continue
        # Last used on an account with no record of it: list it there
        moved = dict(newest, shared=dict(newest["shared"]) if newest["shared"] else None)
        moved.update({
            "key": f"{home.key}/{chat}/chat", "profileDir": home.key, "profile": home.label,
            "sessionId": chat, "chatId": chat, "pid": None, "kind": "chat", "entrypoint": "",
            "state": "done", "reason": "", "waitingFor": "", "detail": "", "since": seen[home],
            "startedAt": None, "jobId": None, "jobSessionId": None,
            "context": None, "model": None, "costUsd": None,
        })
        attach_snapshot(moved, ctx.snapshot_root, home, [chat, *(i for _, s in entries for i in (s["sessionId"], s.get("jobSessionId")))])
        drop(entries)
        if moved["shared"] is not None:
            moved["shared"].pop("stoppedCopies", None)
        note_stopped([(None, moved)], entries)
        group_of[home.key]["sessions"].append(moved)


def link_shared_elsewhere(groups):
    """A shared chat is listed once. Give every other account it's shared with
    a pointer to it (`sharedHere`), unless that account lists the chat itself
    or a copy of it. A chat that moved on to a copy points to the copy."""
    for g in groups:
        g["sharedHere"] = []
    listed = {chat_id(s) for g in groups for s in g["sessions"]}
    for g in groups:
        for s in g["sessions"]:
            info = s["shared"]
            if not info:
                continue
            copy = bool(info.get("forkOf"))
            if copy and not (info.get("movedHere") and info["forkOf"] not in listed):
                continue
            chat = info["forkOf"] if copy else chat_id(s)
            for h in groups:
                if h is g or not set(h["profiles"]) & set(info["profiles"]):
                    continue
                if any(chat_id(t) == chat or (t["shared"] or {}).get("forkOf") == chat for t in h["sessions"]):
                    continue
                h["sharedHere"].append({
                    "key": f"{s['key']}/shared",
                    "sessionId": s["sessionId"],
                    "name": s["name"],
                    "cwdShort": s["cwdShort"],
                    "state": s["state"],
                    "reason": s["reason"],
                    "since": s["since"],
                    "profile": s["profile"],
                    "profileDir": s["profileDir"],
                    "copy": copy,
                    "stoppedHere": any(p in h["profiles"] for p in info.get("stoppedCopies", [])),
                })


def lock_path(session_id):
    state = Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local/state") / "claude-shared-chats"
    return state / f"lock-{session_id}"


def read_lock(session_id):
    """(pid, start, config dir, mtime) from shared-chats.sh's lock
    (`<pid>-<start> <config dir>`), or None."""
    if not valid_id(session_id):
        return None
    path = lock_path(session_id)
    text = read_text(path)
    if not text:
        return None
    holder, _, folder = text.strip().partition(" ")
    pid, _, start = holder.partition("-")
    if not pid.isdigit() or not folder:
        return None
    return int(pid), start or None, folder, mtime(path)


def profile_of(folder, all_profiles):
    try:
        real = Path(folder).resolve()
    except (OSError, RuntimeError):
        return None
    return next((p for p in all_profiles if p.real == real), None)


def shared_holder(session_id, all_profiles):
    """Profile whose session holds a shared chat open, from shared-chats.sh's
    lock, if that process is still alive."""
    lock = read_lock(session_id)
    if lock is None or not is_alive({"pid": lock[0], "procStart": lock[1]}):
        return None
    p = profile_of(lock[2], all_profiles)
    return p.label if p else None


def lock_holder(session_id, all_profiles):
    """(profile, ms) of the last session that used a shared chat: the lock is
    rewritten on each prompt and tool call, and stays after the session ends."""
    lock = read_lock(session_id)
    if lock is None or lock[3] is None:
        return None
    p = profile_of(lock[2], all_profiles)
    return (p, int(lock[3] * 1000)) if p else None


# ---------------------------------------------------------------- recent chats

RECENT_CHATS = 5
TITLE_READ_BYTES = 65536
TITLE_KINDS = (("custom-title", "customTitle"), ("agent-name", "agentName"), ("ai-title", "aiTitle"),
               ("summary", "summary"))


def read_chat_info(path, size):
    """(name, cwd, has messages) of a transcript, from its first and last 64 KB.
    The name is what you renamed the chat to, else its session name, else
    Claude's title for it, else its first prompt."""
    try:
        with open(path, "rb") as f:
            head = f.read(TITLE_READ_BYTES)
            if size > 2 * TITLE_READ_BYTES:
                f.seek(size - TITLE_READ_BYTES)
            tail = f.read() if size > TITLE_READ_BYTES else b""
    except OSError:
        return "", "", False
    lines = head.splitlines()[:-1 if len(head) == TITLE_READ_BYTES else None]
    if tail:
        lines += tail.splitlines()[1:]
    found, cwd, first_prompt, messages = {}, "", "", False
    for line in lines:
        if not line.startswith(b"{"):
            continue
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if not isinstance(e, dict):
            continue
        kind = e.get("type")
        for name, field in TITLE_KINDS:
            if kind == name and isinstance(e.get(field), str) and e[field].strip():
                found[name] = e[field]
        if kind in ("user", "assistant"):
            messages = True
            if isinstance(e.get("cwd"), str) and e["cwd"].startswith("/"):
                cwd = e["cwd"]
            if kind == "user" and not first_prompt and not e.get("isMeta"):
                content = (e.get("message") or {}).get("content")
                if isinstance(content, list):
                    content = next((c.get("text") for c in content if isinstance(c, dict) and c.get("type") == "text"), "")
                if isinstance(content, str) and content.strip() and not content.lstrip().startswith("<"):
                    first_prompt = content
    name = next((found[k] for k, _ in TITLE_KINDS if k in found), first_prompt)
    return clean_text(name, 80), cwd, messages


def recent_chats(groups, ctx, limit=RECENT_CHATS):
    """Each account's latest chats that aren't listed as a session already
    (group["recent"]). A chat shared across accounts shows up under the one
    it was used on last; of a chat and its copies (same first entry), only
    the newest; a shared chat that moved on to a listed copy, not at all."""
    listed = {i for g in groups for s in g["sessions"] for i in (s["sessionId"], s.get("chatId"), s.get("jobSessionId")) if i}
    listed |= getattr(ctx, "moved_on", set())
    by_key = {p.key: p for p in ctx.profiles}
    group_of = {key: g for g in groups for key in g["profileKeys"]}
    candidates = []
    for p in ctx.profiles:
        if p.key not in group_of:
            continue
        try:
            files = list(p.path.glob("projects/*/*.jsonl"))
        except OSError:
            continue
        for f in files:
            sid = f.stem
            if not valid_id(sid) or "." in sid or sid in listed:
                continue
            try:
                st = f.stat()
            except OSError:
                continue
            candidates.append((st.st_mtime, p, f, st))
    candidates.sort(key=lambda c: -c[0])
    for g in groups:
        g["recent"] = []
    if limit <= 0:
        return
    seen, firsts = set(), set()
    for t, p, f, st in candidates:
        if all(len(g["recent"]) >= limit for g in groups):
            break
        inode = (st.st_dev, st.st_ino)
        if inode in seen:
            continue
        seen.add(inode)
        name, cwd, messages = ctx.links.chat_info(f, st)
        if not messages:
            continue
        first = ctx.links.first_uuid(f)
        if first and first in firsts:  # an older copy of a chat already listed
            continue
        firsts.add(first)
        shared = st.st_nlink > 1 and shared_info(f.stem, p, ctx.profiles)
        if shared and moved_to(f.stem, ctx) in listed:
            continue  # it moved on to a session listed already
        home = p
        if shared:  # under the account that used it last
            seen_at = chat_activity(f.stem, [], ctx)
            if seen_at:
                home = max(seen_at, key=lambda q: seen_at[q])
                if home.key not in group_of:
                    home = p
        g = group_of[home.key]
        if len(g["recent"]) >= limit:
            continue
        g["recent"].append({
            "key": f"{home.key}/{f.stem}/recent",
            "sessionId": f.stem,
            "name": name or f.stem[:8],
            "cwd": cwd,
            "cwdShort": short_path(cwd, ctx.home),
            "lastActive": int(t * 1000),
            "profile": home.label,
            "profileDir": home.key,
            "shared": bool(shared),
        })


# ---------------------------------------------------------------- shared-chat tool
#
# Sharing itself is done by ~/.claude-shared/profile-tools/shared-chats.sh
# (the widget calls it through jump.py); it shares into every ~/.claude-<name>
# folder with a .profile-name file and names profiles by that <name>.

SHARE_TOOL = ".claude-shared/profile-tools/shared-chats.sh"
SHARE_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")


def share_tool(home):
    path = home / SHARE_TOOL
    return path if path.is_file() else None


def share_name(profile, home):
    """The name shared-chats.sh knows this profile by (work for ~/.claude-work),
    or None if it doesn't take part in sharing."""
    try:
        home_real = home.resolve()
    except (OSError, RuntimeError):
        home_real = home
    real = profile.real
    if real.parent != home_real or not real.name.startswith(".claude-") or not (real / ".profile-name").is_file():
        return None
    name = real.name[len(".claude-"):]
    return name if SHARE_NAME.match(name) else None


# ---------------------------------------------------------------- opening sessions
#
# Shell commands that reopen, stop or start a chat with the right
# CLAUDE_CONFIG_DIR (used by jump.py here and by the widget for remote hosts).


def service_config_dir(profile):
    """CLAUDE_CONFIG_DIR value of the background service running for this profile, if any.

    The service is keyed by the config-dir *path* (its socket lives in
    /tmp/cc-daemon-<uid>/<sha256(path)[:8]>) but locks the real folder. When a
    folder has two names (~/.claude linked to ~/.claude-personal), a client
    using the other name waits forever at "Starting background service...".
    """
    status = read_json(profile.path / "daemon.status.json")
    if not isinstance(status, dict):
        return None
    pid = status.get("supervisorPid")
    if not is_alive({"pid": pid, "procStart": status.get("supervisorProcStart")}):
        return None
    try:
        env = Path(f"/proc/{pid}/environ").read_bytes().split(b"\0")
    except OSError:
        return None
    value = next((e[len(b"CLAUDE_CONFIG_DIR="):].decode(errors="replace") for e in env
                  if e.startswith(b"CLAUDE_CONFIG_DIR=")), None)
    return value or str(Path.home() / ".claude")  # unset means the default path


def job_config_dir(profile, job):
    """The CLAUDE_CONFIG_DIR a background job was started with (its state.json
    providerEnv), if that is a name of this profile's folder."""
    env = (job or {}).get("providerEnv")
    value = env.get("CLAUDE_CONFIG_DIR") if isinstance(env, dict) else None
    if not isinstance(value, str) or not value:
        return None
    try:
        return value if Path(value).resolve() == profile.path.resolve() else None
    except OSError:
        return None


def config_dir_value(profile, home=None, job=None):
    """CLAUDE_CONFIG_DIR to run claude with for this profile, or None to unset it.

    Always named explicitly (a terminal's shell may export another one): the
    running service's own name if one runs, else the name the job was started
    with (a service started under another name of the folder leaves the job's
    worker and the service apart), else ~/.claude when it links to this
    profile (what terminals and VS Code use with linked profiles), else the
    profile's folder. Only a plain (unlinked) ~/.claude runs without the
    variable: its account file is ~/.claude.json, which Claude reads only
    when CLAUDE_CONFIG_DIR is unset.
    """
    default = (home or Path.home()) / ".claude"
    if profile.is_default and not profile.path.is_symlink():
        return None
    path = service_config_dir(profile) or job_config_dir(profile, job)
    if path is None:
        linked_here = default.is_symlink() and default.resolve() == profile.path.resolve()
        path = str(default if linked_here else profile.path.resolve())
    return path


def folder_trusted(profile, folder, home=None):
    """Has Claude's "do you trust this folder?" question been answered yes for
    folder (in this profile's account file)? Claude never saves it for the
    home folder, so it asks there every time."""
    home = home or Path.home()
    data = read_json(profile.path / ".claude.json")
    if profile.is_default and not profile.path.is_symlink() and not (data or {}).get("projects"):
        data = read_json(home / ".claude.json")
    projects = (data or {}).get("projects")
    entry = projects.get(str(folder)) if isinstance(projects, dict) else None
    return isinstance(entry, dict) and entry.get("hasTrustDialogAccepted") is True


def config_env(profile, home=None, job=None):
    """Shell words that set (or unset) CLAUDE_CONFIG_DIR for this profile."""
    value = config_dir_value(profile, home, job)
    return "env -u CLAUDE_CONFIG_DIR" if value is None else f"CLAUDE_CONFIG_DIR={shlex.quote(value)}"


def claude_command(profile, args, home=None, job=None, folder=None, claude="claude"):
    """Shell command running claude with args on this profile, in folder."""
    command = f"{config_env(profile, home, job)} {shlex.quote(claude)} {' '.join(shlex.quote(a) for a in args)}"
    if isinstance(folder, str) and folder and not folder_trusted(profile, folder, home):
        # The question that comes up has "No, exit" preselected: say what it is
        note = (f"Claude will ask whether you trust {short_folder(folder, home)} before it reopens this session. "
                "Choose \"Yes, I trust this folder\" to continue; \"No, exit\" (preselected) closes it.")
        command = f"printf '%s\\n\\n' {shlex.quote(note)}; {command}"
    return command


def attach_command(profile, job_id, home=None, job=None, claude="claude"):
    """Shell command that attaches to a background job of this profile."""
    return claude_command(profile, ["attach", job_id], home, job, (job or {}).get("cwd"), claude)


def resume_command(profile, session_id, home=None, folder=None, claude="claude"):
    """Shell command that reopens a finished chat on this profile."""
    return claude_command(profile, ["--resume", session_id], home, None, folder, claude)


def new_chat_command(profile, home=None, claude="claude"):
    """Shell command starting a new chat on this profile. With background
    sessions around, plain `claude` opens the agent view (where a task becomes
    a new background session): ask for a normal chat."""
    return f"CLAUDE_CODE_DISABLE_AGENT_VIEW=1 {config_env(profile, home)} {shlex.quote(claude)}"


def stop_command(profile, job_id, home=None, job=None, claude="claude"):
    """Shell command stopping a background job (its conversation is kept)."""
    return f"{config_env(profile, home, job)} {shlex.quote(claude)} stop {shlex.quote(job_id)}"


def short_folder(folder, home=None):
    home = str(home or Path.home())
    return "~" + folder[len(home):] if folder == home or folder.startswith(home + "/") else folder



# ---------------------------------------------------------------- prompt history

RECENT_PROJECTS = 6
HISTORY_TAIL_BYTES = 65536


def history_tail(profile):
    """Entries at the end of a profile's prompt history (history.jsonl)."""
    path = profile.path / "history.jsonl"
    try:
        size = path.stat().st_size
        with open(path, "rb") as f:
            f.seek(max(0, size - HISTORY_TAIL_BYTES))
            lines = f.read().splitlines()
    except OSError:
        return []
    if size > HISTORY_TAIL_BYTES:
        lines = lines[1:]  # probably cut in the middle
    entries = []
    for line in lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if isinstance(e, dict):
            entries.append(e)
    return entries


def last_prompts(entries):
    """{session id: when you last sent it a prompt (ms)}."""
    last = {}
    for e in entries:
        sid, ts = e.get("sessionId"), number(e.get("timestamp"))
        if valid_id(sid) and ts:
            last[sid] = max(last.get(sid, 0), int(ts))
    return last


def recent_projects(histories, home):
    """Folders recently chatted in, newest first, from the profiles' prompt
    history (for "new chat in…"). Skips folders that are gone and scratch
    folders inside Claude's own config dirs."""
    last_used = {}
    for entries in histories:
        for e in entries:
            folder, ts = e.get("project"), number(e.get("timestamp"))
            if isinstance(folder, str) and folder.startswith("/") and ts:
                last_used[folder] = max(last_used.get(folder, 0), ts)
    result = []
    for folder in sorted(last_used, key=lambda f: -last_used[f]):
        if any(part.startswith(".claude") for part in Path(folder).parts) or not os.path.isdir(folder):
            continue
        result.append({"path": folder, "short": short_path(folder, home)})
        if len(result) >= RECENT_PROJECTS:
            break
    return result


# ---------------------------------------------------------------- plan limits


def snapshot_files(snapshot_root, profiles):
    """(mtime, path) of these profiles' status-line snapshots, newest first,
    leaving out ones filed under a link's name before the link was switched."""
    since = {}
    for p in profiles:
        for name, t in p.snapshot_sources.items():
            since[name] = max(t, since.get(name, t))
    files = []
    for name, t0 in since.items():
        try:
            with os.scandir(snapshot_root / name) as it:
                for e in it:
                    if e.name.endswith(".json") and not e.name.startswith("."):
                        t = e.stat().st_mtime
                        if t >= t0:
                            files.append((t, Path(e.path)))
        except OSError:
            continue
    files.sort(reverse=True)
    return files


def prune_snapshots(snapshot_root, now):
    try:
        dirs = list(snapshot_root.iterdir())
    except OSError:
        return
    for d in dirs:
        try:
            for f in d.iterdir():
                if now - f.stat().st_mtime > SNAPSHOT_MAX_AGE:
                    try:
                        f.unlink()
                    except FileNotFoundError:  # unlink(missing_ok=True) needs Python 3.8
                        pass
        except OSError:
            continue


def plan_limits(snapshot_root, profiles, now_ms):
    """Rate-limit windows from the newest status-line snapshot of the group."""
    for mtime, path in snapshot_files(snapshot_root, profiles):
        snap = read_json(path)
        limits = snap.get("rate_limits") if isinstance(snap, dict) else None
        if not isinstance(limits, dict) or not limits:
            continue
        windows = []
        for key, w in limits.items():
            if not isinstance(w, dict):
                continue
            pct = number(w.get("used_percentage"))
            if pct is None:
                continue
            resets = to_ms(w.get("resets_at"))
            reset = resets is not None and resets <= now_ms
            windows.append({
                "key": key,
                "label": WINDOW_LABELS.get(key, key.replace("_", " ")),
                "pct": 0.0 if reset else float(pct),
                "resetsAt": None if reset else resets,
                "reset": reset,
            })
        if not windows:
            continue
        rank = {k: i for i, k in enumerate(WINDOW_ORDER)}
        windows.sort(key=lambda w: rank.get(w["key"], len(rank)))
        return {"updatedAt": int(mtime * 1000), "windows": windows}
    return None


# ---------------------------------------------------------------- token totals


def empty_token_cache():
    return {"version": CACHE_VERSION, "scannedAt": 0, "files": {}, "messages": {}}


def transcript_files(profile):
    """(path, reached through a linked folder) of every transcript under the
    profile's projects/. Linked folders are followed: a shared chat's folder
    (its subagents) is a link into the shared store."""
    out, seen, stack = [], set(), [(profile.real / "projects", False)]
    while stack:
        folder, linked = stack.pop()
        try:
            real = os.path.realpath(folder)
            if real in seen:
                continue
            seen.add(real)
            with os.scandir(folder) as it:
                entries = list(it)
        except OSError:
            continue
        for e in entries:
            try:
                if e.is_dir():
                    stack.append((Path(e.path), linked or e.is_symlink()))
                elif e.name.endswith(".jsonl") and e.is_file():
                    out.append((Path(e.path), linked))
            except OSError:
                continue
    return out


def token_cache_path(cache_root, profile):
    # Named after the real folder: ~/.claude can be switched between profiles
    return cache_root / f"tokens-{profile.key}-{short_id(str(profile.real))[:8]}.json"


def prune_token_caches(cache_root, profiles):
    """Delete token caches of profiles that are gone (or of an older format)."""
    keep = {token_cache_path(cache_root, p).name for p in profiles}
    try:
        files = list(cache_root.glob("tokens-*.json"))
    except OSError:
        return
    for f in files:
        if f.name not in keep:
            try:
                f.unlink()
            except OSError:
                pass


def scan_transcripts(profile, cache, now):
    """Incrementally read new transcript lines into cache["messages"].

    messages: {message id: [day, model, input, output, cacheRead, cacheWrite, shared]},
    shared = 1 when the transcript is hard-linked elsewhere or sits in a linked
    folder (a chat shared with another profile: it counts on both accounts).
    Claude writes one line per content block, each repeating the message's
    usage (the last one sometimes with the final output count), so lines are
    merged by message id with an element-wise max.
    """
    cutoff_day = (date.fromtimestamp(now) - timedelta(days=TOKEN_DAYS - 1)).isoformat()
    cutoff_mtime = now - TOKEN_DAYS * 86400
    messages = {k: v for k, v in cache["messages"].items() if v[0] >= cutoff_day}
    old_files, files = cache["files"], {}

    def add(line, shared):
        if b'"usage"' not in line:
            return
        try:
            e = json.loads(line)
        except ValueError:
            return
        m = e.get("message") if isinstance(e, dict) else None
        if e.get("type") != "assistant" or not isinstance(m, dict):
            return
        u = m.get("usage")
        if not isinstance(u, dict):
            return
        day = local_day(e.get("timestamp"))
        if day is None or day < cutoff_day:
            return
        vals = [int(number(u.get(k)) or 0) for k in (
            "input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")]
        if not any(vals):
            return
        key = m.get("id") or e.get("requestId") or e.get("uuid")
        if not key:
            return
        prev = messages.get(key)
        if prev:
            vals = [max(a, b) for a, b in zip(prev[2:6], vals)]
            day = prev[0]
            shared = shared or bool(prev[6])
        messages[key] = [day, m.get("model") or "unknown", *vals, int(shared)]

    for path, linked in transcript_files(profile):
        try:
            st = path.stat()
        except OSError:
            continue
        rec = old_files.get(str(path))
        offset = 0
        if rec and rec.get("ino") == st.st_ino and rec.get("offset", 0) <= st.st_size:
            offset = rec["offset"]
        if offset == 0 and st.st_mtime < cutoff_mtime:
            offset = st.st_size  # untouched for longer than we keep data
        elif offset < st.st_size:
            try:
                with open(path, "rb") as f:
                    f.seek(offset)
                    chunk = f.read()
            except OSError:
                chunk = b""
            end = chunk.rfind(b"\n")  # never consume a half-written last line
            if end >= 0:
                for line in chunk[:end].splitlines():
                    add(line, st.st_nlink > 1 or linked)
                offset += end + 1
        files[str(path)] = {"offset": offset, "ino": st.st_ino}

    cache["files"], cache["messages"], cache["scannedAt"] = files, messages, now
    return cache


def load_token_cache(cache_root, profile, now, lock_held):
    path = token_cache_path(cache_root, profile)
    cache = read_json(path)
    if not isinstance(cache, dict) or cache.get("version") != CACHE_VERSION:
        cache = empty_token_cache()
    if lock_held and now - cache.get("scannedAt", 0) >= TOKEN_SCAN_INTERVAL:
        cache = scan_transcripts(profile, cache, now)
        try:
            write_json_atomic(path, cache)
        except OSError:
            pass
    return cache


def token_totals(caches, now):
    today = date.fromtimestamp(now).isoformat()
    week_start = (date.fromtimestamp(now) - timedelta(days=6)).isoformat()
    keys = ("input", "output", "cacheRead", "cacheWrite")

    def zero():
        return dict(dict.fromkeys(keys, 0), total=0, messages=0, shared=0)

    totals = {"today": zero(), "week": zero()}
    models = {}
    for cache in caches:
        for day, model, *rest in cache["messages"].values():
            if day < week_start:
                continue
            vals, shared = rest[:4], bool(rest[4]) if len(rest) > 4 else False
            buckets = [totals["week"]] + ([totals["today"]] if day == today else [])
            for b in buckets:
                for k, v in zip(keys, vals):
                    b[k] += v
                b["total"] += sum(vals)
                b["messages"] += 1
                if shared:
                    b["shared"] += sum(vals)
            models[model] = models.get(model, 0) + sum(vals)
    totals["models"] = [{"model": m, "total": t} for m, t in sorted(models.items(), key=lambda x: -x[1])]
    return totals


class ScanLock:
    """Non-blocking lock so overlapping polls don't scan transcripts twice."""

    def __init__(self, path):
        self.path, self.fd, self.held = path, None, False

    def __enter__(self):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o600)
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.held = True
        except OSError:
            self.held = False
        return self

    def __exit__(self, *exc):
        if self.fd is not None:
            os.close(self.fd)


# ---------------------------------------------------------------- dismissed sessions


def cache_dir(home):
    return Path(os.environ.get("XDG_CACHE_HOME") or home / ".cache") / "claude-widget"


def load_dismissed(cache_root):
    """Finished sessions the user removed from the widget's list: {session id: when}."""
    data = read_json(cache_root / "dismissed.json")
    sessions = data.get("sessions") if isinstance(data, dict) else None
    return dict(sessions) if isinstance(sessions, dict) else {}


def save_dismissed(cache_root, sessions):
    write_json_atomic(cache_root / "dismissed.json", {"sessions": sessions})


# ---------------------------------------------------------------- main


class Context:
    """What one poll knows, handed to the row builders."""

    def __init__(self, **kw):
        self.__dict__.update(kw)


def collect(home, cache_root, extra_dirs=(), with_tokens=True, now=None, keep_done_hours=KEEP_DONE_HOURS,
            recent=RECENT_CHATS):
    now = time.time() if now is None else now
    now_ms = int(now * 1000)
    snapshot_root = cache_root / "statusline"
    profiles = discover_profiles(home, extra_dirs)
    counts = dict.fromkeys(STATE_ORDER, 0)
    errors, groups = [], []
    try:
        private_dir(cache_root)
    except OSError as exc:
        errors.append(f"cache: {exc}")

    histories = {p.real: history_tail(p) for p in profiles}
    ctx = Context(
        home=home, profiles=profiles, snapshot_root=snapshot_root, now_ms=now_ms,
        keep_done_ms=int(keep_done_hours * 3600_000),
        agents=AgentCache(cache_root / "agents.json"), links=LinkCache(cache_root / "links.json"),
        prompts={real: last_prompts(entries) for real, entries in histories.items()},
    )
    with ScanLock(cache_root / "tokens.lock") as lock:
        if lock.held and with_tokens:
            prune_snapshots(snapshot_root, now)
            prune_token_caches(cache_root, profiles)

        # Every live session process, under the profile it runs on now
        rows = {p.real: [] for p in profiles}
        live_jobs = set()
        try:
            live = live_entries_all(profiles)
        except Exception as exc:  # internal format: fail soft
            errors.append(f"sessions: {exc}")
            live = []
        for entry, profile, holder in live:
            if valid_id(entry.get("jobId")):
                live_jobs.add(entry["jobId"])
            try:
                row = live_row(entry, profile, holder, home, ctx)
            except Exception as exc:
                errors.append(f"{profile.label}: sessions: {exc}")
                continue
            if row is not None:
                rows[profile.real].append(row)
        # Background jobs with no process; a job held by two profiles (written
        # through a switched link) is listed once, from its newest record
        newest_job = {}
        for p in profiles:
            try:
                for row in parked_rows(p, home, live_jobs, ctx):
                    prev = newest_job.get(row["jobId"])
                    if prev is None or (row["since"] or 0) > (prev[1]["since"] or 0):
                        newest_job[row["jobId"]] = (p, row)
            except Exception as exc:
                errors.append(f"{p.label}: background jobs: {exc}")
        for p, row in newest_job.values():
            rows[p.real].append(row)

        for gid, members in group_profiles(profiles):
            named = next((p for p in members if not p.is_default), members[0])
            plan = next((p.plan for p in members if p.plan), None)
            group = {
                "id": short_id(gid),
                "name": named.label,
                "plan": plan,
                "title": f"{named.label} · {plan}" if plan else named.label,
                "profiles": [p.label for p in members],
                "profileKeys": [p.key for p in members],
                "sessions": [row for p in members for row in rows[p.real]],
                "limits": None,
                "tokens": None,
                # for "new chat": the profile folder name jump.py --new-chat takes
                "chatProfile": named.key,
                # for sharing a chat with this account (shared-chats.sh): its profile and name there
                "shareProfile": next((p.key for p in members if share_name(p, home)), None),
                "shareName": next((share_name(p, home) for p in members if share_name(p, home)), None),
                "projects": recent_projects([histories[p.real] for p in members], home),
            }
            try:
                group["limits"] = plan_limits(snapshot_root, members, now_ms)
            except Exception as exc:
                errors.append(f"{group['title']}: limits: {exc}")
            if with_tokens:
                try:
                    caches = [load_token_cache(cache_root, p, now, lock.held) for p in members]
                    group["tokens"] = token_totals(caches, now)
                except Exception as exc:
                    errors.append(f"{group['title']}: tokens: {exc}")
            groups.append(group)

    try:
        place_chats(groups, ctx)
    except Exception as exc:
        errors.append(f"shared chats: {exc}")
    # Removed from the list by the user: hidden while finished; one that runs
    # again comes back (and is forgotten).
    dismissed = load_dismissed(cache_root)
    still_dismissed, hidden = {}, 0
    for g in groups:
        shown = []
        for s in g["sessions"]:
            ids = [i for i in (s["sessionId"], s.get("chatId")) if i in dismissed]
            if ids and s["state"] == "done":
                for i in ids:
                    still_dismissed[i] = dismissed[i]
                hidden += 1
            else:
                shown.append(s)
        g["sessions"] = sorted(shown, key=lambda s: (STATE_ORDER[s["state"]], -(s["since"] or 0)))
    link_shared_elsewhere(groups)
    try:
        # a finished session you removed from the list is still one of your
        # recent chats: it shows there
        recent_chats(groups, ctx, recent)
    except Exception as exc:
        errors.append(f"recent chats: {exc}")
        for g in groups:
            g.setdefault("recent", [])
    for g in groups:
        for s in g["sessions"]:
            counts[s["state"]] += 1
    ctx.agents.save()
    ctx.links.save()
    if still_dismissed != dismissed:
        try:
            save_dismissed(cache_root, still_dismissed)  # drop sessions that are gone or active again
        except OSError:
            pass
    if counts["waiting"]:
        overall = "waiting"
    elif counts["working"]:
        overall = "working"
    elif any(s["state"] in ("idle", "done") and s["pid"] is not None for g in groups for s in g["sessions"]):
        overall = "idle"
    else:
        overall = "none"  # finished jobs kept for the record don't count as running
    return {
        "ok": True,
        "generatedAt": now_ms,
        "overall": overall,
        "counts": counts,
        "groups": groups,
        "dismissed": hidden,
        "canShare": share_tool(home) is not None,  # the shared-chats tool is installed
        "errors": errors,
    }


# ---------------------------------------------------------------- VS Code
#
# "New chat in VS Code" starts a chat in VS Code's Claude extension. The
# extension runs Claude with VS Code's environment plus its own
# claudeCode.environmentVariables setting, so those decide the account (the
# Claude config folder), not the widget: it only offers the button on the
# account VS Code will use.

VSCODE_APPS = (("code", "Code"), ("code-insiders", "Code - Insiders"), ("codium", "VSCodium"),
               ("code-oss", "Code - OSS"))


def vscode_app():
    """(command, settings folder name) of the installed VS Code, or (None, None)."""
    import shutil
    for command, folder in VSCODE_APPS:
        path = shutil.which(command)
        if path:
            return path, folder
    return None, None


def jsonc(text):
    """Parse a VS Code settings file: JSON with comments and trailing commas."""
    out, i, n = [], 0, len(text)
    while i < n:
        c = text[i]
        if c == '"':
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            out.append(text[i:j + 1])
            i = j + 1
        elif text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
        else:
            out.append(c)
            i += 1
    return json.loads(re.sub(r",(\s*[}\]])", r"\1", "".join(out)))


def vscode_setting_config_dir(home, settings_folder):
    """CLAUDE_CONFIG_DIR from the Claude extension's environmentVariables
    setting in VS Code's user settings, or None."""
    config = Path(os.environ.get("XDG_CONFIG_HOME") or home / ".config")
    try:
        settings = jsonc((config / settings_folder / "User" / "settings.json").read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError):
        return None
    entries = settings.get("claudeCode.environmentVariables") if isinstance(settings, dict) else None
    for e in entries if isinstance(entries, list) else []:
        if isinstance(e, dict) and e.get("name") == "CLAUDE_CONFIG_DIR" and isinstance(e.get("value"), str) and e["value"]:
            return e["value"]
    return None


def vscode_running_config_dir():
    """(VS Code runs, CLAUDE_CONFIG_DIR in its environment or None). Only the
    main process counts: helpers run as node (ELECTRON_RUN_AS_NODE) inherit
    the extensions' environment."""
    names = {Path(c).name for c, _ in VSCODE_APPS}
    try:
        pids = [p for p in os.listdir("/proc") if p.isdigit()]
    except OSError:
        return False, None
    for pid in pids:
        try:
            if Path(f"/proc/{pid}/comm").read_text().strip() not in names:
                continue
            argv = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
            env = dict(item.partition(b"=")[::2] for item in Path(f"/proc/{pid}/environ").read_bytes().split(b"\0") if item)
        except OSError:
            continue
        if any(a.startswith(b"--type=") for a in argv) or b"ELECTRON_RUN_AS_NODE" in env:
            continue
        value = env.get(b"CLAUDE_CONFIG_DIR")
        return True, value.decode(errors="replace") if value else None
    return False, None


def vscode_profile(home, profiles, remote=False):
    """(VS Code installed, the profile a new chat in VS Code's Claude would
    use or None). On an SSH host (remote) the VS Code server's Claude uses the
    host's ~/.claude; whether VS Code is installed is up to the other side."""
    installed, value = None, None
    if not remote:
        command, settings_folder = vscode_app()
        if command is None:
            return False, None
        installed = True
        value = vscode_setting_config_dir(home, settings_folder)
        if value is None:
            running, env_value = vscode_running_config_dir()
            # not running: the widget starts it, with its own environment
            value = env_value if running else os.environ.get("CLAUDE_CONFIG_DIR")
    try:
        real = (Path(value).expanduser() if value else home / ".claude").resolve()
    except (OSError, RuntimeError):
        return installed, None
    return installed, next((p for p in profiles if p.real == real), None)


def add_vscode(result, home, extra_dirs=(), remote=False):
    """Which account a new chat in VS Code would be on: result["vscode"] =
    {installed, on (its label)} and each group's vscodeHere."""
    installed, profile = vscode_profile(home, discover_profiles(home, extra_dirs), remote)
    result["vscode"] = {"installed": installed, "on": profile.label if profile else None}
    for g in result.get("groups", []):
        g["vscodeHere"] = profile is not None and profile.key in g.get("profileKeys", [])


# ---------------------------------------------------------------- remote hosts
#
# The widget runs this script on an SSH host (`ssh host python3 -I - --remote`
# with the script on stdin: nothing is installed there). In that mode every row
# also carries the shell command that opens it on the host, so the widget can
# run it in a local terminal as `ssh -t host <command>`.

REMOTE_MARK = "@@claude-status@@"
CLAUDE_PLACES = (".local/bin", ".claude/local", ".npm-global/bin", ".bun/bin", "bin", ".volta/bin")


def find_claude(home):
    """Absolute path of the claude command: a command run over ssh doesn't
    read the login files that usually put ~/.local/bin on PATH."""
    path = os.environ.get("PATH", "")
    extra = [str(home / d) for d in CLAUDE_PLACES] + ["/usr/local/bin", "/opt/homebrew/bin"]
    import shutil
    return shutil.which("claude", path=os.pathsep.join([path, *extra])) or "claude"


def in_folder(folder, command):
    """command, run in folder when it exists (ssh starts in the home folder)."""
    if isinstance(folder, str) and folder.startswith("/"):
        return f"cd {shlex.quote(folder)} 2>/dev/null; {command}"
    return command


def add_remote_commands(result, home, extra_dirs=()):
    """Shell commands that open, stop or start chats on this host."""
    claude = find_claude(home)
    profiles = {p.key: p for p in discover_profiles(home, extra_dirs)}
    result["claude"] = claude
    for g in result.get("groups", []):
        named = profiles.get(g.get("chatProfile"))
        if named is not None:
            chat = new_chat_command(named, home, claude)
            g["homeChatCommand"] = in_folder(str(home), chat)
            for project in g.get("projects", []):
                project["newChatCommand"] = in_folder(project["path"], chat)
        for s in g["sessions"]:
            p = profiles.get(s["profileDir"])
            s["openCommand"] = s["stopCommand"] = None
            if p is None:
                continue
            if s.get("jobId"):
                job = read_job([p], s["jobId"]) or {}
                s["openCommand"] = in_folder(job.get("cwd") or s["cwd"], attach_command(p, s["jobId"], home, job, claude))
                if s["pid"] is not None:
                    s["stopCommand"] = stop_command(p, s["jobId"], home, job, claude)
            elif s["kind"] == "chat":
                s["openCommand"] = in_folder(s["cwd"], resume_command(p, s["chatId"], home, s["cwd"], claude))
        for c in g.get("recent", []):
            p = profiles.get(c["profileDir"])
            c["openCommand"] = in_folder(c["cwd"], resume_command(p, c["sessionId"], home, c["cwd"], claude)) if p else None
    rows = {s["key"]: s for g in result.get("groups", []) for s in g["sessions"]}
    for g in result.get("groups", []):
        for h in g.get("sharedHere", []):  # a link opens the chat's own row
            target = rows.get(h["key"][:-len("/shared")]) if h["key"].endswith("/shared") else None
            h["openCommand"] = target["openCommand"] if target else None


USAGE = """usage: claude_status.py [--config-dir DIR]... [--done-hours H] [--recent N] [--no-tokens] [--pretty] [--remote]
       claude_status.py --dismiss SESSION_ID | --undismiss-all
  --config-dir DIR  extra Claude config dir (repeatable)
  --done-hours H    keep finished background jobs listed for H hours (default 24, 0 = never)
  --recent N        list each account's N latest other chats (default 5, 0 = none)
  --no-tokens       skip transcript token totals
  --pretty          indent the JSON output
  --remote          for the widget on another machine: add the shell commands that open
                    each chat here, and print the JSON after a marker line
  --dismiss ID      hide a finished session in the widget (--undismiss-all shows them again)"""


def main(argv=None):
    # Hand-rolled instead of argparse, which alone costs ~10 ms of startup on
    # every poll.
    args = sys.argv[1:] if argv is None else list(argv)
    config_dirs, with_tokens, pretty, done_hours = [], True, False, KEEP_DONE_HOURS
    recent, remote, dismiss, undismiss = RECENT_CHATS, False, None, False
    while args:
        arg = args.pop(0)
        if arg == "--config-dir" and args:
            config_dirs.append(args.pop(0))
        elif arg == "--done-hours" and args:
            try:
                done_hours = max(0.0, float(args.pop(0)))
            except ValueError:
                sys.exit(USAGE)
        elif arg == "--recent" and args:
            try:
                recent = max(0, int(args.pop(0)))
            except ValueError:
                sys.exit(USAGE)
        elif arg == "--remote":
            remote = True
        elif arg == "--dismiss" and args:
            dismiss = args.pop(0)
        elif arg == "--undismiss-all":
            undismiss = True
        elif arg.startswith("--config-dir="):
            config_dirs.append(arg.partition("=")[2])
        elif arg == "--no-tokens":
            with_tokens = False
        elif arg == "--pretty":
            pretty = True
        else:
            sys.exit(USAGE)
    os.umask(0o077)  # cache files are private to the user
    home = Path.home()
    cache_root = cache_dir(home)
    if dismiss is not None or undismiss:
        try:
            private_dir(cache_root)
            sessions = {} if undismiss else load_dismissed(cache_root)
            if dismiss is not None:
                sessions[dismiss] = int(time.time() * 1000)
            save_dismissed(cache_root, sessions)
            result = {"ok": True, "message": "Removed from the list" if dismiss is not None else "Shown again"}
        except OSError as exc:
            result = {"ok": False, "message": str(exc)}
    else:
        try:
            result = collect(home, cache_root, config_dirs, with_tokens=with_tokens, keep_done_hours=done_hours,
                             recent=recent)
            try:
                add_vscode(result, home, config_dirs, remote)
            except Exception as exc:
                result["errors"].append(f"VS Code: {exc}")
            if remote:
                result["host"] = os.uname().nodename
                add_remote_commands(result, home, config_dirs)
        except Exception as exc:  # the widget must always get parseable output
            result = {"ok": False, "error": f"{type(exc).__name__}: {exc}", "generatedAt": int(time.time() * 1000)}
    if remote:
        # Login scripts on the host may print things first: the JSON follows a marker
        sys.stdout.write("\n" + REMOTE_MARK + " ")
    json.dump(result, sys.stdout, indent=2 if pretty and not remote else None, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
