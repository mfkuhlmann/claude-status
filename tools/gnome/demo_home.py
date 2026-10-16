#!/usr/bin/env python3
"""Fill a home folder with made-up Claude Code profiles and sessions, for
trying the GNOME extension in tools/gnome/shell.sh (it runs this inside the
container). Each "running" session is a sleeping process, so the status
script sees it alive. Nothing here is real data.

    python3 demo_home.py HOME
"""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

home = Path(sys.argv[1])
now = time.time()
day = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now - 3600)) + ".000Z"


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data if isinstance(data, str) else json.dumps(data))


def alive(profile):
    """(pid, procStart) of a new process that sleeps for good, on profile (its
    CLAUDE_CONFIG_DIR, as a claude started there has)."""
    env = dict(os.environ, CLAUDE_CONFIG_DIR=str(home / profile))
    p = subprocess.Popen(["sleep", "infinity"], start_new_session=True, env=env)
    stat = Path(f"/proc/{p.pid}/stat").read_text()
    return p.pid, stat[stat.rfind(")") + 2:].split()[19]


def session(profile, sid, name, folder, status, minutes_ago, **extra):
    pid, start = alive(profile)
    cwd = str(home / folder)
    os.makedirs(cwd, exist_ok=True)
    write(home / profile / "sessions" / f"{pid}.json", {
        "pid": pid, "procStart": start, "sessionId": sid, "cwd": cwd, "name": name,
        "kind": "interactive", "status": status, "startedAt": int((now - 3600) * 1000),
        "statusUpdatedAt": int((now - minutes_ago * 60) * 1000), **extra})
    transcript(profile, sid, folder, name, minutes_ago)
    return sid


def transcript(profile, sid, folder, title, minutes_ago, tokens=4000):
    cwd = str(home / folder)
    os.makedirs(cwd, exist_ok=True)
    project = home / profile / "projects" / cwd.replace("/", "-")
    lines = [{"type": "ai-title", "aiTitle": title},
             {"type": "user", "cwd": cwd, "timestamp": day, "message": {"content": title}},
             {"type": "assistant", "cwd": cwd, "timestamp": day, "requestId": f"req-{sid}",
              "message": {"id": f"msg-{sid}", "model": "claude-opus-5-5",
                          "usage": {"input_tokens": 1200, "output_tokens": tokens,
                                    "cache_read_input_tokens": tokens * 30, "cache_creation_input_tokens": 900}}}]
    path = project / f"{sid}.jsonl"
    write(path, "\n".join(json.dumps(line) for line in lines) + "\n")
    os.utime(path, (now - minutes_ago * 60, now - minutes_ago * 60))


def account(profile, label, uuid, org, display):
    write(home / profile / ".profile-name", label)
    write(home / profile / ".claude.json", {"oauthAccount": {"accountUuid": uuid, "organizationType": org,
                                                              "displayName": display}})


def history(profile, folders):
    lines = [json.dumps({"project": str(home / f), "timestamp": int((now - i * 600) * 1000)})
             for i, f in enumerate(folders)]
    write(home / profile / "history.jsonl", "\n".join(lines) + "\n")


def limits(profile, sid, five, week, context, model="Opus 5.5"):
    write(home / ".cache/claude-widget/statusline" / profile / f"{sid}.json", {
        "session_id": sid,
        "rate_limits": {"five_hour": {"used_percentage": five, "resets_at": int(now + 2 * 3600 + 900)},
                        "seven_day": {"used_percentage": week, "resets_at": int(now + 4 * 86400)}},
        "context_window": {"used_percentage": context},
        "model": {"display_name": model}})


account(".claude-work", "work", "acct-work", "claude_team", "Sam")
account(".claude-personal", "personal", "acct-pro", "claude_max", "Sam")

fix = session(".claude-work", "9a1c7e2b-0000-4000-8000-000000000001", "fix parser", "repos/parser", "busy", 4)
rel = session(".claude-work", "9a1c7e2b-0000-4000-8000-000000000002", "release notes", "repos/site", "waiting", 1,
              waitingFor="permission")
session(".claude-work", "9a1c7e2b-0000-4000-8000-000000000003", "api tests", "repos/api", "idle", 12)
blog = session(".claude-personal", "9a1c7e2b-0000-4000-8000-000000000004", "blog draft", "notes/blog", "idle", 25,
               entrypoint="claude-vscode")
transcript(".claude-personal", "9a1c7e2b-0000-4000-8000-000000000005", "notes/garden", "garden planner", 300)
transcript(".claude-personal", "9a1c7e2b-0000-4000-8000-000000000006", "notes/trip", "trip to Lisbon", 1500)
transcript(".claude-work", "9a1c7e2b-0000-4000-8000-000000000007", "repos/site", "landing page copy", 2900)

# A background job working with two subagents, and one that failed
deploy = session(".claude-work", "9a1c7e2b-0000-4000-8000-000000000008", "deploy docs", "repos/site", "busy", 2,
                 kind="bg", jobId="job-deploy")
write(home / ".claude-work/jobs/job-deploy/state.json", {"state": "working", "sessionId": deploy,
                                                         "cwd": str(home / "repos/site")})
agents = home / ".claude-work/projects" / str(home / "repos/site").replace("/", "-") / deploy / "subagents"
step = lambda kind, content, stop=None: {"type": kind, "timestamp": day, "isSidechain": True,
                                         "message": {"role": kind, "content": content, "stop_reason": stop}}
tool = lambda name, inp: [{"type": "tool_use", "id": "toolu_" + name, "name": name, "input": inp}]
for agent_id, description, lines in [
        ("a1", "Check the links", [step("user", "check links"),
                                   step("assistant", [{"type": "text", "text": "All 214 links work."}], "end_turn")]),
        ("a2", "Build the site", [step("user", "build"), step("assistant", tool("Bash", {"command": "npm run build"}),
                                                              "tool_use")])]:
    write(agents / f"agent-{agent_id}.meta.json", {"agentType": "general-purpose", "description": description,
                                                    "spawnDepth": 1, "toolUseId": "toolu_" + agent_id})
    write(agents / f"agent-{agent_id}.jsonl", "\n".join(json.dumps(line) for line in lines) + "\n")
iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t)) + ".000Z"
write(home / ".claude-work/jobs/job-lint/state.json", {
    "state": "failed", "tempo": "idle", "name": "lint everything", "cwd": str(home / "repos/api"),
    "sessionId": "9a1c7e2b-0000-4000-8000-000000000009", "detail": "eslint: 3 errors in src/routes.ts",
    "createdAt": iso(now - 1800), "updatedAt": iso(now - 600)})

history(".claude-work", ["repos/parser", "repos/site", "repos/api"])
history(".claude-personal", ["notes/blog", "notes/garden"])
limits(".claude-work", fix, 64, 31, 42)
limits(".claude-work", rel, 64, 31, 88)
limits(".claude-personal", blog, 12, 7, 23, "Sonnet 5.5")
write(home / ".ssh/config", "Host lab\n  HostName lab.example.com\n  User sam\n\nHost gpu\n  ProxyJump lab\n")
print("demo home ready:", home)
