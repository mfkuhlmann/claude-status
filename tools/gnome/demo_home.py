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


def session(profile, sid, name, folder, status, minutes_ago, more=(), **extra):
    pid, start = alive(profile)
    cwd = str(home / folder)
    os.makedirs(cwd, exist_ok=True)
    write(home / profile / "sessions" / f"{pid}.json", {
        "pid": pid, "procStart": start, "sessionId": sid, "cwd": cwd, "name": name,
        "kind": "interactive", "status": status, "startedAt": int((now - 3600) * 1000),
        "statusUpdatedAt": int((now - minutes_ago * 60) * 1000), **extra})
    transcript(profile, sid, folder, name, minutes_ago, more=more)
    return sid


def transcript(profile, sid, folder, title, minutes_ago, tokens=4000, more=()):
    cwd = str(home / folder)
    os.makedirs(cwd, exist_ok=True)
    project = home / profile / "projects" / cwd.replace("/", "-")
    lines = [{"type": "ai-title", "aiTitle": title},
             {"type": "user", "cwd": cwd, "timestamp": day, "message": {"content": title}},
             {"type": "assistant", "cwd": cwd, "timestamp": day, "requestId": f"req-{sid}",
              "message": {"id": f"msg-{sid}", "model": "claude-opus-5-5",
                          "usage": {"input_tokens": 1200, "output_tokens": tokens,
                                    "cache_read_input_tokens": tokens * 30, "cache_creation_input_tokens": 900}}},
             *more]
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


# What the chats said last, what they're doing, their tasks and the files they changed
prompt = lambda text: {"type": "user", "timestamp": day, "message": {"role": "user", "content": text}}
said = lambda mid, blocks, stop=None: {"type": "assistant", "timestamp": day,
                                       "message": {"id": mid, "role": "assistant", "content": blocks, "stop_reason": stop}}
text = lambda t: {"type": "text", "text": t}
use = lambda name, inp: {"type": "tool_use", "id": "toolu_" + name, "name": name, "input": inp}
parser_work = [prompt("The parser crashes on an empty file. Fix it and add a test."),
               {"type": "file-history-snapshot", "messageId": "p1", "isSnapshotUpdate": False,
                "snapshot": {"messageId": "p1", "trackedFileBackups": {}}},
               said("m1", [text("Found it: `parse()` reads the first token before checking for one. Fixing that, then the tests.")]),
               said("m1", [use("Edit", {"file_path": str(home / "repos/parser/parser.py")})]),
               {"type": "file-history-delta", "snapshotMessageId": "p1", "trackingPath": "parser.py",
                "backup": {"backupFileName": "pp@v1", "version": 1, "realParentDir": str(home / "repos/parser")}},
               {"type": "file-history-delta", "snapshotMessageId": "p1", "trackingPath": "tests/test_empty.py",
                "backup": {"backupFileName": None, "version": 1, "realParentDir": str(home / "repos/parser/tests")}},
               {"type": "assistant", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now - 240)) + ".000Z",
                "message": {"id": "m2", "role": "assistant", "model": "claude-opus-5-5",
                            "content": [use("Bash", {"command": "pytest -x tests/"})],
                            "usage": {"input_tokens": 300, "output_tokens": 2400, "cache_read_input_tokens": 180000,
                                      "cache_creation_input_tokens": 4000}}}]
release_wait = [prompt("Write the release notes for 2.4 from the merged PRs."),
                said("m1", [text("Here's a draft. I'll put it in CHANGELOG.md.")]),
                said("m1", [use("Write", {"file_path": str(home / "repos/site/CHANGELOG.md")})])]
api_done = [prompt("Why do the API tests time out on CI?"),
            said("m1", [text("All 42 API tests pass now. The client waited 30 s for a server that never started on CI: "
                             "the fixture now starts it and waits until it answers.\n\nWant me to open a PR?")], "end_turn")]
blog_done = [prompt("Tighten the intro of the garden post."),
             said("m1", [text("Done: the intro is two sentences now, and the photo caption moved under the photo.")], "end_turn")]

account(".claude-work", "work", "acct-work", "claude_team", "Sam")
account(".claude-personal", "personal", "acct-pro", "claude_max", "Sam")

fix = session(".claude-work", "9a1c7e2b-0000-4000-8000-000000000001", "fix parser", "repos/parser", "busy", 4,
              more=parser_work)
rel = session(".claude-work", "9a1c7e2b-0000-4000-8000-000000000002", "release notes", "repos/site", "waiting", 1,
              waitingFor="permission", more=release_wait)
session(".claude-work", "9a1c7e2b-0000-4000-8000-000000000003", "api tests", "repos/api", "idle", 12, more=api_done)
blog = session(".claude-personal", "9a1c7e2b-0000-4000-8000-000000000004", "blog draft", "notes/blog", "idle", 25,
               entrypoint="claude-vscode", more=blog_done)
write(home / ".claude-work/file-history" / fix / "pp@v1", "def parse(tokens):\n    first = tokens[0]\n")
write(home / "repos/parser/parser.py", "def parse(tokens):\n    if not tokens:\n        return None\n    first = tokens[0]\n")
write(home / "repos/parser/tests/test_empty.py", "def test_empty():\n    assert parse([]) is None\n")
for n, subject, status, active in ((1, "Find where the parser fails", "completed", ""),
                                   (2, "Fix the empty-file case", "completed", ""),
                                   (3, "Add a test for empty files", "in_progress", "Running the parser tests"),
                                   (4, "Check the other entry points", "pending", "")):
    write(home / ".claude-work/tasks" / fix / f"{n}.json", {"id": str(n), "subject": subject, "status": status,
                                                            "activeForm": active, "blocks": [], "blockedBy": []})
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


# The last days, for the stats: earlier chats' replies (with their usage) and
# your prompts, spread over two weeks
def past_work(profile, folder, sid, days):
    """A finished chat in folder with a reply on each of days (days ago: output tokens)."""
    cwd = str(home / folder)
    os.makedirs(cwd, exist_ok=True)
    lines = []
    for n, (ago, output) in enumerate(days):
        t = now - ago * 86400 - 3600
        lines.append({"type": "assistant", "cwd": cwd, "timestamp": iso(t), "message": {
            "id": f"msg-{sid}-{n}", "model": "claude-haiku-5-5" if n % 5 == 4 else "claude-opus-5-5",
            "usage": {"input_tokens": 900, "output_tokens": output, "cache_read_input_tokens": output * 40,
                      "cache_creation_input_tokens": 700}}})
    path = home / profile / "projects" / cwd.replace("/", "-") / f"{sid}.jsonl"
    write(path, "\n".join(json.dumps(line) for line in lines) + "\n")


past_work(".claude-work", "repos/parser", "9a1c7e2b-0000-4000-8000-000000000011",
          [(13, 9000), (12, 30000), (9, 21000), (8, 52000), (6, 18000), (2, 41000), (1, 26000)])
past_work(".claude-work", "repos/site", "9a1c7e2b-0000-4000-8000-000000000012",
          [(12, 8000), (7, 15000), (5, 12000), (2, 9000)])
past_work(".claude-work", "repos/api", "9a1c7e2b-0000-4000-8000-000000000013", [(9, 6000), (3, 22000), (1, 14000)])
past_work(".claude-personal", "notes/garden", "9a1c7e2b-0000-4000-8000-000000000014", [(10, 5000), (4, 3000)])
with open(home / ".claude-work/history.jsonl", "a") as f:
    for ago, folder, n in ((13, "repos/parser", 3), (12, "repos/parser", 8), (12, "repos/site", 2), (9, "repos/api", 2),
                           (8, "repos/parser", 11), (7, "repos/site", 4), (6, "repos/parser", 5), (5, "repos/site", 3),
                           (3, "repos/api", 6), (2, "repos/parser", 9), (1, "repos/api", 4), (1, "repos/parser", 7)):
        for i in range(n):
            f.write(json.dumps({"project": str(home / folder), "timestamp": int((now - ago * 86400 - i * 300) * 1000)}) + "\n")
limits(".claude-work", fix, 64, 31, 42)
limits(".claude-work", rel, 64, 31, 88)
limits(".claude-personal", blog, 12, 7, 23, "Sonnet 5.5")
write(home / ".ssh/config", "Host lab\n  HostName lab.example.com\n  User sam\n\nHost gpu\n  ProxyJump lab\n")
print("demo home ready:", home)
