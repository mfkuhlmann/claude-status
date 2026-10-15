import importlib.util
import json
import ast
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True  # keep __pycache__ out of the plasmoid package
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("claude_status", ROOT / "package/contents/code/claude_status.py")
cs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cs)

PID = os.getpid()
PROC_START = cs.proc_start_time(PID)
DEAD_PID = 4194304 + 4242  # above the kernel's pid_max ceiling


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data if isinstance(data, str) else json.dumps(data))


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z")


def session(sid, **kw):
    return {"pid": PID, "procStart": PROC_START, "sessionId": sid, "cwd": "/tmp/proj-" + sid,
            "kind": "interactive", "status": "idle", "statusUpdatedAt": 1000, **kw}


def assistant(msg_id, ts, output, model="claude-opus-5-5"):
    return json.dumps({"type": "assistant", "timestamp": iso(ts), "requestId": "req_" + msg_id,
                       "message": {"id": msg_id, "model": model, "usage": {
                           "input_tokens": 2, "output_tokens": output,
                           "cache_read_input_tokens": 100, "cache_creation_input_tokens": 10}}})


class Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name) / "home"
        self.cache = Path(self.tmp.name) / "cache"
        self.now = time.time()
        h = self.home
        # ~/.claude: default dir whose .claude.json lacks the account (Claude
        # Code keeps it in ~/.claude.json for the default dir)
        write(h / ".claude/.claude.json", {"machineID": "x"})
        write(h / ".claude.json", {"oauthAccount": {"accountUuid": "acct-pro", "organizationType": "claude_pro"}})
        write(h / ".claude/sessions/1.json", session("vscode", entrypoint="claude-vscode", status="busy"))
        write(h / ".claude-work/sessions/9.json", session("spare", kind="bg", spare=True))
        # ~/.claude-personal: same account as ~/.claude
        write(h / ".claude-personal/.profile-name", "personal\n")
        write(h / ".claude-personal/.claude.json", {"oauthAccount": {"accountUuid": "acct-pro", "organizationType": "claude_pro"}})
        write(h / ".claude-personal/sessions/2.json", session("perso-idle", statusUpdatedAt=2000))
        # ~/.claude-work: Team account
        w = h / ".claude-work"
        write(w / ".profile-name", "work")
        write(w / ".claude.json", {"oauthAccount": {"accountUuid": "acct-team", "organizationType": "claude_team"}})
        write(w / "sessions/10.json", session("waiting", status="waiting", waitingFor="Bash"))
        write(w / "sessions/11.json", session("busy", status="busy"))
        write(w / "sessions/12.json", session("dead", pid=DEAD_PID))
        write(w / "sessions/13.json", session("reused", procStart="1"))
        write(w / "sessions/14.json", session("spare", spare=True))
        write(w / "sessions/15.json", session("parked", parkedJobId="job1"))
        write(w / "sessions/16.json", session("bgdone", kind="bg", jobId="job2"))
        write(w / "jobs/job2/state.json", {"state": "done", "detail": "All tests\n pass."})
        write(w / "sessions/17.json", session("bgworking", kind="bg", status="busy", jobId="job3"))
        write(w / "jobs/job3/state.json", {"state": "working", "detail": "old question"})
        # Real case: record still "blocked" from an answered question while busy
        write(w / "sessions/18.json", session("bgstale", kind="bg", status="busy", jobId="job4"))
        write(w / "jobs/job4/state.json", {"state": "blocked", "tempo": "active", "detail": "my last reply"})
        # Real case: background job waiting for a permission
        write(w / "sessions/19.json", session("bgperm", kind="bg", status="waiting",
                                              waitingFor="permission prompt", jobId="job5"))
        write(w / "jobs/job5/state.json", {"state": "blocked", "tempo": "blocked",
                                           "needs": "approve Write: /tmp/x", "detail": "my last reply"})
        # Interactive session with the user's own /effort dialog open
        write(w / "sessions/20.json", session("dialog", status="waiting", waitingFor="dialog open"))
        write(w / "sessions/notjson.json", "{broken")
        # Unrelated dir without sessions/projects is ignored
        (h / ".claude-backup").mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def collect(self, **kw):
        return cs.collect(self.home, self.cache, now=kw.pop("now", self.now), **kw)

    def group(self, result, name):
        return next(g for g in result["groups"] if g["name"] == name)


class SessionTests(Fixture):
    def test_groups_by_account(self):
        r = self.collect(with_tokens=False)
        self.assertEqual([(g["title"], g["profiles"]) for g in r["groups"]],
                         [("personal · Pro", ["default", "personal"]), ("work · Team", ["work"])])

    def test_lone_default_dir_named_after_account(self):
        h = Path(self.tmp.name) / "lone"
        write(h / ".claude/sessions/1.json", session("solo"))
        write(h / ".claude.json", {"oauthAccount": {"accountUuid": "a", "organizationType": "claude_max",
                                                     "displayName": "Ada"}})
        (h / ".claude-backup").mkdir()  # not a profile: no sessions/projects

        def title():
            groups = cs.collect(h, self.cache, with_tokens=False, now=self.now)["groups"]
            return [(g["title"], g["profiles"]) for g in groups]
        self.assertEqual(title(), [("Ada · Max", ["Ada"])])
        write(h / ".claude.json", {"oauthAccount": {"accountUuid": "a", "organizationType": "claude_max"}})
        self.assertEqual(title(), [("Claude · Max", ["Claude"])])
        write(h / ".claude/.profile-name", "mine")
        self.assertEqual(title(), [("mine · Max", ["mine"])])

    def test_parked_and_finished_jobs_listed(self):
        w = self.home / ".claude-work"
        now = self.now
        write(w / "jobs/parkedq/state.json", {"state": "blocked", "tempo": "blocked", "needs": "Which DB should I use?",
                                               "name": "db choice", "cwd": "/w/db", "sessionId": "s-parked",
                                               "updatedAt": iso(now - 7200)})
        write(w / "jobs/finished/state.json", {"state": "done", "tempo": "idle", "detail": "Report written.",
                                                "intent": "write report", "cwd": "/w/r", "updatedAt": iso(now - 3600)})
        write(w / "jobs/ancient/state.json", {"state": "done", "tempo": "idle", "updatedAt": iso(now - 3 * 86400)})
        write(w / "sessions/30.json", session("daemon-proc", kind="daemon"))
        work = self.group(self.collect(with_tokens=False), "work")
        by_id = {s["sessionId"]: s for s in work["sessions"]}
        self.assertEqual((by_id["s-parked"]["state"], by_id["s-parked"]["detail"], by_id["s-parked"]["pid"]),
                         ("waiting", "Which DB should I use?", None))
        self.assertEqual(by_id["s-parked"]["name"], "db choice")
        self.assertEqual((by_id["finished"]["state"], by_id["finished"]["name"], by_id["finished"]["detail"]),
                         ("done", "write report", "Report written."))
        self.assertNotIn("ancient", by_id)
        self.assertNotIn("daemon-proc", by_id)
        self.assertNotIn("job4", by_id)  # live sessions' jobs aren't listed twice
        none = self.group(self.collect(with_tokens=False, keep_done_hours=0), "work")
        self.assertNotIn("finished", {s["sessionId"] for s in none["sessions"]})

    def test_finished_history_alone_is_not_running(self):
        for f in (self.home / ".claude-work/sessions").glob("*.json"):
            f.unlink()
        for f in (self.home / ".claude/sessions").glob("*.json"):
            f.unlink()
        for f in (self.home / ".claude-personal/sessions").glob("*.json"):
            f.unlink()
        for d in (self.home / ".claude-work/jobs").iterdir():
            write(d / "state.json", {"state": "done", "tempo": "idle", "updatedAt": iso(self.now - 60)})
        r = self.collect(with_tokens=False)
        self.assertEqual(r["counts"]["done"], 4)  # job2..job5
        self.assertEqual(r["overall"], "none")

    def test_no_raw_account_ids_in_output(self):
        r = self.collect(with_tokens=False)
        text = json.dumps(r)
        self.assertNotIn("acct-pro", text)
        self.assertNotIn("acct-team", text)
        self.assertEqual(len({g["id"] for g in r["groups"]}), 2)

    def test_cache_dir_is_private(self):
        self.cache.mkdir(mode=0o755)
        self.collect(with_tokens=False)
        self.assertEqual(self.cache.stat().st_mode & 0o777, 0o700)

    def test_session_states_and_filtering(self):
        r = self.collect(with_tokens=False)
        work = self.group(r, "work")
        states = {s["sessionId"]: s["state"] for s in work["sessions"]}
        self.assertEqual(states, {"waiting": "waiting", "busy": "working", "bgworking": "working", "bgdone": "done",
                                  "bgstale": "working", "bgperm": "waiting", "dialog": "idle"})
        # sorted: waiting first, then working, ...
        self.assertEqual({s["state"] for s in work["sessions"][:2]}, {"waiting"})
        by_id = {s["sessionId"]: s for s in work["sessions"]}
        self.assertEqual((by_id["waiting"]["waitingFor"], by_id["waiting"]["reason"]), ("Bash", "Bash"))
        self.assertEqual((by_id["bgperm"]["reason"], by_id["bgperm"]["detail"]), ("permission", "approve Write: /tmp/x"))
        self.assertEqual((by_id["dialog"]["reason"], by_id["dialog"]["waitingFor"]), ("", "dialog open"))
        self.assertEqual(by_id["bgdone"]["detail"], "All tests pass.")
        self.assertEqual(by_id["bgworking"]["detail"], "")
        self.assertEqual(by_id["bgstale"]["detail"], "")
        self.assertEqual(r["counts"], {"waiting": 2, "working": 4, "idle": 2, "done": 1})
        self.assertEqual(r["overall"], "waiting")
        self.assertEqual(r["errors"], [])

    def test_rows_have_unique_keys(self):
        write(self.home / ".claude-personal/sessions/40.json", session("busy", status="idle"))   # same id twice
        r = self.collect(with_tokens=False)
        keys = [s["key"] for g in r["groups"] for s in g["sessions"]]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertIn(".claude-personal/busy/live", keys)
        self.assertIn(".claude-work/busy/live", keys)

    def test_overall_without_waiting(self):
        os.remove(self.home / ".claude-work/sessions/10.json")
        os.remove(self.home / ".claude-work/sessions/19.json")
        os.remove(self.home / ".claude-work/jobs/job5/state.json")  # else it's parked, still waiting
        self.assertEqual(self.collect(with_tokens=False)["overall"], "working")

    def test_liveness(self):
        self.assertTrue(cs.is_alive({"pid": PID, "procStart": PROC_START}))
        self.assertTrue(cs.is_alive({"pid": PID}))
        self.assertFalse(cs.is_alive({"pid": PID, "procStart": "1"}))
        self.assertFalse(cs.is_alive({"pid": DEAD_PID}))
        self.assertFalse(cs.is_alive({"pid": "12"}))

    def test_short_path(self):
        self.assertEqual(cs.short_path("/h/u", "/h/u"), "~")
        self.assertEqual(cs.short_path("/h/u/repos/x", "/h/u"), "~/repos/x")
        self.assertEqual(cs.short_path("/h/u/a/b/c/d", "/h/u"), "…/c/d")


class StateMappingTests(unittest.TestCase):
    """Cases seen on real sessions; expectations follow Claude Code 2.1."""

    def state(self, entry, job=None):
        return cs.session_state(entry, job)

    def test_interactive(self):
        self.assertEqual(self.state({"status": "busy"}), "working")
        self.assertEqual(self.state({"status": "idle"}), "idle")
        self.assertEqual(self.state({"status": "shell"}), "working")  # background shell after the turn
        self.assertEqual(self.state({"status": "waiting", "waitingFor": "permission prompt"}), "waiting")
        self.assertEqual(self.state({"status": "waiting", "waitingFor": "input needed"}), "waiting")
        self.assertEqual(self.state({"status": "waiting"}), "waiting")

    def test_own_dialog_is_not_waiting(self):
        # /effort, /model, ... opened by the user
        self.assertEqual(self.state({"status": "waiting", "waitingFor": "dialog open"}), "idle")

    def test_background_job_live_status_beats_stale_record(self):
        # job record still says blocked after the user answered; session is busy
        self.assertEqual(self.state({"status": "busy"}, {"state": "blocked", "tempo": "active"}), "working")
        self.assertEqual(self.state({"status": "idle"}, {"state": "blocked", "tempo": "active"}), "working")

    def test_background_job_needs_input(self):
        self.assertEqual(self.state({"status": "waiting", "waitingFor": "permission prompt"},
                                    {"state": "blocked", "tempo": "blocked"}), "waiting")
        self.assertEqual(self.state({"status": "idle"}, {"state": "blocked", "tempo": "blocked"}), "waiting")

    def test_background_job_not_started(self):
        # dispatched from the agent view without a prompt
        job = {"state": "blocked", "tempo": "blocked", "needs": cs.NOT_STARTED}
        self.assertEqual(self.state({"status": "idle"}, job), "idle")

    def test_background_job_finished(self):
        self.assertEqual(self.state({"status": "idle"}, {"state": "done", "tempo": "idle"}), "done")
        self.assertEqual(self.state({"status": "idle"}, {"state": "failed", "tempo": "idle"}), "done")
        self.assertEqual(self.state({"status": "idle"}, {"state": "done", "tempo": "active"}), "working")
        self.assertEqual(self.state({"status": "idle"}, {"state": "done", "tempo": "idle", "routine": {}}), "working")


class ParkedJobTests(unittest.TestCase):
    """Job records whose session process is gone (`claude agents --all`)."""

    NOW = 1_800_000_000_000
    DAY = 24 * 3600_000

    def parked(self, job, present=False, keep=DAY):
        return cs.parked_job_state(job, present, self.NOW, keep)

    def iso(self, ms_ago):
        return iso((self.NOW - ms_ago) / 1000)

    def test_blocked_job_still_needs_you(self):
        job = {"state": "blocked", "tempo": "blocked", "needs": "approve Bash", "updatedAt": self.iso(9 * self.DAY)}
        self.assertEqual(self.parked(job), ("waiting", ""))

    def test_finished_jobs_kept_for_a_day(self):
        self.assertEqual(self.parked({"state": "done", "tempo": "idle", "updatedAt": self.iso(3600_000)}), ("done", ""))
        self.assertEqual(self.parked({"state": "failed", "tempo": "idle", "updatedAt": self.iso(60_000)}), ("done", "failed"))
        self.assertIsNone(self.parked({"state": "done", "tempo": "idle", "updatedAt": self.iso(25 * 3600_000)}))
        self.assertIsNone(self.parked({"state": "done", "tempo": "idle", "updatedAt": self.iso(60_000)}, keep=0))

    def test_died_mid_task(self):
        job = {"state": "working", "tempo": "active", "createdAt": self.iso(600_000), "updatedAt": self.iso(300_000)}
        self.assertEqual(self.parked(job), ("done", "failed"))
        self.assertEqual(self.parked(job, present=True), ("working", ""))  # daemon still has it
        self.assertIsNone(self.parked(job, keep=0))
        fresh = {**job, "createdAt": self.iso(1000)}
        self.assertEqual(self.parked(fresh), ("working", ""))  # just dispatched

    def test_not_started_hidden(self):
        self.assertIsNone(self.parked({"state": "blocked", "tempo": "blocked", "needs": cs.NOT_STARTED}))


class LimitTests(Fixture):
    def snapshot(self, profile, sid, data, age=0):
        path = self.cache / "statusline" / profile / f"{sid}.json"
        write(path, data)
        os.utime(path, (self.now - age, self.now - age))

    def test_limits_and_context(self):
        self.snapshot(".claude-work", "busy", {
            "session_id": "busy",
            "model": {"display_name": "Opus 5.5"},
            "context_window": {"used_percentage": 34.4},
            "cost": {"total_cost_usd": 1.25},
            "rate_limits": {
                "seven_day": {"used_percentage": 50, "resets_at": self.now - 60},  # already reset
                "five_hour": {"used_percentage": 42.5, "resets_at": self.now + 3600},
            },
        })
        r = self.collect(with_tokens=False)
        work = self.group(r, "work")
        busy = next(s for s in work["sessions"] if s["sessionId"] == "busy")
        self.assertEqual((busy["context"], busy["model"], busy["costUsd"]), (34.4, "Opus 5.5", 1.25))
        five, seven = work["limits"]["windows"]
        self.assertEqual((five["label"], five["pct"], five["reset"]), ("5h", 42.5, False))
        self.assertEqual(five["resetsAt"], int((self.now + 3600) * 1000))
        self.assertEqual((seven["label"], seven["pct"], seven["reset"]), ("7d", 0.0, True))
        self.assertIsNone(self.group(r, "personal")["limits"])

    def test_newest_snapshot_across_group_profiles(self):
        self.snapshot(".claude", "a", {"rate_limits": {"five_hour": {"used_percentage": 10}}}, age=300)
        self.snapshot(".claude-personal", "b", {"rate_limits": {"five_hour": {"used_percentage": 20}}}, age=10)
        self.snapshot(".claude-personal", "c", {"session_id": "c"}, age=0)  # no limits yet
        limits = self.group(self.collect(with_tokens=False), "personal")["limits"]
        self.assertEqual(limits["windows"][0]["pct"], 20)

    def test_old_snapshots_pruned(self):
        self.snapshot(".claude-work", "old", {"rate_limits": {"five_hour": {"used_percentage": 99}}}, age=9 * 86400)
        self.collect()
        self.assertFalse((self.cache / "statusline/.claude-work/old.json").exists())

    def test_iso_resets_at(self):
        self.assertEqual(cs.to_ms("2026-01-01T00:00:00Z"), 1767225600000)
        self.assertEqual(cs.to_ms(1767225600), 1767225600000)
        self.assertEqual(cs.to_ms(1767225600000), 1767225600000)
        self.assertIsNone(cs.to_ms("soon"))


class TokenTests(Fixture):
    def transcript(self):
        return self.home / ".claude-work/projects/-tmp-proj/abc.jsonl"

    def test_dedupe_partial_line_and_rescan(self):
        now = self.now
        lines = [
            assistant("m1", now - 60, 16),
            assistant("m1", now - 60, 305),  # same message, final output count
            assistant("old", now - 10 * 86400, 999),
            json.dumps({"type": "assistant", "timestamp": iso(now), "message": {
                "id": "syn", "model": "<synthetic>", "usage": {"input_tokens": 0, "output_tokens": 0}}}),
            json.dumps({"type": "user", "message": {"content": "hi"}}),
        ]
        partial = assistant("m2", now - 30, 7)
        write(self.transcript(), "\n".join(lines) + "\n" + partial[:40])

        today = self.group(self.collect(now=now), "work")["tokens"]["today"]
        self.assertEqual((today["messages"], today["output"]), (1, 305))
        self.assertEqual(today["total"], 2 + 305 + 100 + 10)

        # Finish the half-written line; within the scan interval nothing changes
        with open(self.transcript(), "a") as f:
            f.write(partial[40:] + "\n")
        self.assertEqual(self.group(self.collect(now=now + 5), "work")["tokens"]["today"]["messages"], 1)

        tokens = self.group(self.collect(now=now + cs.TOKEN_SCAN_INTERVAL + 1), "work")["tokens"]
        self.assertEqual((tokens["today"]["messages"], tokens["today"]["output"]), (2, 312))
        self.assertEqual(tokens["week"]["messages"], 2)
        self.assertEqual(tokens["models"][0]["model"], "claude-opus-5-5")

        # Another scan with nothing new must not double count
        tokens = self.group(self.collect(now=now + 2 * cs.TOKEN_SCAN_INTERVAL + 2), "work")["tokens"]
        self.assertEqual(tokens["today"]["messages"], 2)

    def test_group_sums_profiles(self):
        write(self.home / ".claude/projects/p/a.jsonl", assistant("x1", self.now - 5, 1) + "\n")
        write(self.home / ".claude-personal/projects/p/b.jsonl", assistant("x2", self.now - 5, 2) + "\n")
        today = self.group(self.collect(), "personal")["tokens"]["today"]
        self.assertEqual((today["messages"], today["output"]), (2, 3))

    def test_truncated_file_rescanned(self):
        write(self.transcript(), assistant("a1", self.now - 5, 5) + "\n" + assistant("a2", self.now - 5, 6) + "\n")
        self.collect()
        write(self.transcript(), assistant("a3", self.now - 5, 7) + "\n")  # rewritten, shorter
        work = next(p for p in cs.discover_profiles(self.home) if p.label == "work")
        path = cs.token_cache_path(self.cache, work)
        cache = json.loads(path.read_text())
        cache["scannedAt"] = 0
        write(path, cache)
        today = self.group(self.collect(), "work")["tokens"]["today"]
        self.assertEqual(today["messages"], 3)


@unittest.skipUnless(shutil.which("jq"), "the status-line snippet needs jq")
class SnippetTests(unittest.TestCase):
    def run_snippet(self, payload, cfg):
        with tempfile.TemporaryDirectory() as tmp:
            script = 'input=$(cat)\n' + (ROOT / "statusline-snippet.sh").read_text() + 'echo ok\n'
            env = {**os.environ, "HOME": tmp, "XDG_CACHE_HOME": tmp + "/cache", "CLAUDE_CONFIG_DIR": cfg}
            out = subprocess.run(["bash", "-c", script], input=json.dumps(payload), env=env,
                                 capture_output=True, text=True, check=True)
            files = sorted((str(p.relative_to(tmp)), p.stat().st_mode & 0o777)
                           for p in Path(tmp).rglob("*") if p.is_file())
            return out.stdout, out.stderr, files

    def test_writes_snapshot_per_profile(self):
        out, err, files = self.run_snippet({"session_id": "abc-123", "rate_limits": {}}, "/x/.claude-work/")
        self.assertEqual((out, err), ("ok\n", ""))
        self.assertEqual(files, [("cache/claude-widget/statusline/.claude-work/abc-123.json", 0o600)])

    def test_profile_from_transcript_path(self):
        payload = {"session_id": "s1",
                   "transcript_path": "/h/projects/.claude-personal/projects/-h-repo/s1/subagents/a.jsonl"}
        out, err, files = self.run_snippet(payload, "/x/.claude-work")
        self.assertEqual([f for f, _ in files], ["cache/claude-widget/statusline/.claude-personal/s1.json"])

    def test_link_filed_under_the_real_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            real = Path(tmp) / ".claude-personal"
            real.mkdir()
            (Path(tmp) / ".claude").symlink_to(real)
            payload = {"session_id": "s2", "transcript_path": f"{tmp}/.claude/projects/-h-repo/s2.jsonl"}
            out, err, files = self.run_snippet(payload, "/x/.claude-work")
            self.assertEqual([f for f, _ in files], ["cache/claude-widget/statusline/.claude-personal/s2.json"])

    def test_rejects_unsafe_session_id(self):
        out, err, files = self.run_snippet({"session_id": "../../evil"}, "/x/.claude")
        self.assertEqual((out, err, files), ("ok\n", "", []))


class AgentTests(Fixture):
    """Subagents: status and current step from each agent's transcript, nested as a tree."""

    def agent(self, sid, agent_id, lines, depth=1, tool_use_id="toolu_x", description="", shape="sync"):
        d = self.home / ".claude-work/projects/-w-proj" / sid / "subagents"
        write(d / f"agent-{agent_id}.meta.json", {"agentType": "Explore", "description": description,
                                                  "spawnDepth": depth, "toolUseId": tool_use_id,
                                                  "requestShape": shape})
        write(d / f"agent-{agent_id}.jsonl", "\n".join(json.dumps(l) for l in lines) + "\n")
        return d

    def line(self, kind, content, stop=None):
        return {"type": kind, "timestamp": iso(self.now), "isSidechain": True,
                "message": {"role": kind, "content": content, "stop_reason": stop}}

    def setUp(self):
        super().setUp()
        tool = lambda i, name, inp: {"type": "tool_use", "id": i, "name": name, "input": inp}
        self.agent("busy", "a1", [self.line("user", "find the parser"),
                                  self.line("assistant", [{"type": "text", "text": "Found it in parser.py\nmore"}], "end_turn")],
                   description="Find the parser")
        self.agent("busy", "a2", [self.line("user", "run tests"),
                                  self.line("assistant", [tool("toolu_child", "Agent", {"description": "check flaky test"})], "tool_use"),
                                  self.line("assistant", [tool("toolu_b", "Bash", {"command": "pytest -x tests/\necho"})], "tool_use")],
                   description="Run the tests")
        self.agent("busy", "a3", [self.line("user", "look at flaky test"),
                                  self.line("assistant", [tool("toolu_r", "Read", {"file_path": "/w/proj/tests/test_io.py"})], "tool_use"),
                                  self.line("user", [{"type": "tool_result", "tool_use_id": "toolu_r", "content": "..."}])],
                   depth=2, tool_use_id="toolu_child", description="Check flaky test")

    def test_counts_tree_and_activity(self):
        work = self.group(self.collect(with_tokens=False), "work")
        a = next(s for s in work["sessions"] if s["sessionId"] == "busy")["agents"]
        self.assertEqual((a["total"], a["done"], a["running"], a["stopped"]), (3, 1, 2, 0))
        rows = [(t["id"], t["depth"], t["status"], t["activity"]) for t in a["tree"]]
        self.assertEqual(rows, [
            ("a1", 0, "done", "Found it in parser.py"),
            ("a2", 0, "running", "Bash: pytest -x tests/ echo"),
            ("a3", 1, "running", "Read: test_io.py (thinking about the result)"),
        ])
        self.assertIsNone(next(s for s in work["sessions"] if s["sessionId"] == "waiting")["agents"])

    def test_handback_means_done(self):
        # Current Claude Code agents finish by handing their report back through a tool call
        tool = {"type": "tool_use", "id": "toolu_h", "name": "SubagentHandback",
                "input": {"message": "**Summary**\nThere are 10 .qml files"}}
        self.agent("busy", "a4", [self.line("user", "list files"),
                                  self.line("assistant", [tool]),
                                  self.line("user", [{"type": "tool_result", "tool_use_id": "toolu_h", "content": [{"type": "text", "text": "ok"}]}])],
                   description="List files")
        a = next(s for s in self.group(self.collect(with_tokens=False), "work")["sessions"] if s["sessionId"] == "busy")["agents"]
        a4 = next(t for t in a["tree"] if t["id"] == "a4")
        self.assertEqual((a4["status"], a4["activity"]), ("done", "Summary"))
        self.assertEqual(cs.report_line("| Lines | File |\n|--|"), "Lines | File |")

    def test_agents_of_an_ended_session_are_stopped(self):
        cache = cs.AgentCache(self.cache / "agents.json")
        profile = next(p for p in cs.discover_profiles(self.home) if p.label == "work")
        a = cache.session_agents(profile, "busy", alive=False)
        self.assertEqual((a["done"], a["running"], a["stopped"]), (1, 0, 2))

    def test_unchanged_transcripts_are_not_read_again(self):
        self.collect(with_tokens=False)
        calls = []
        real = cs.agent_progress
        cs.agent_progress = lambda path: calls.append(path) or real(path)
        try:
            self.collect(with_tokens=False)
            self.assertEqual(calls, [])
            with open(self.home / ".claude-work/projects/-w-proj/busy/subagents/agent-a2.jsonl", "a") as f:
                f.write(json.dumps(self.line("assistant", [{"type": "text", "text": "All 12 pass"}], "end_turn")) + "\n")
            work = self.group(self.collect(with_tokens=False), "work")
        finally:
            cs.agent_progress = real
        self.assertEqual([p.name for p in calls], ["agent-a2.jsonl"])
        a = next(s for s in work["sessions"] if s["sessionId"] == "busy")["agents"]
        self.assertEqual((a["done"], a["running"]), (2, 1))

    def test_describe_tool(self):
        self.assertEqual(cs.describe_tool({"name": "Edit", "input": {"file_path": "/a/b/parser.py"}}), "Edit: parser.py")
        self.assertEqual(cs.describe_tool({"name": "mcp__github__create_issue", "input": {}}), "github: create_issue")
        self.assertEqual(cs.describe_tool({"name": "TodoWrite", "input": {"todos": []}}), "TodoWrite")


class RecentProjectTests(Fixture):
    def test_newest_first_skipping_gone_and_scratch_folders(self):
        real_a, real_b = self.home / "repos/a", self.home / "repos/b"
        real_a.mkdir(parents=True)
        real_b.mkdir(parents=True)
        scratch = self.home / ".claude-work/jobs/x/tmp/proj"
        scratch.mkdir(parents=True)
        lines = [{"project": str(real_a), "timestamp": 1000}, {"project": str(real_b), "timestamp": 3000},
                 {"project": str(self.home / "gone"), "timestamp": 4000}, {"project": str(scratch), "timestamp": 5000},
                 {"project": str(real_a), "timestamp": 2000}]
        write(self.home / ".claude-work/history.jsonl", "\n".join(json.dumps(l) for l in lines) + "\n")
        work = self.group(self.collect(with_tokens=False), "work")
        self.assertEqual([p["short"] for p in work["projects"]], ["~/repos/b", "~/repos/a"])
        self.assertEqual(work["chatProfile"], ".claude-work")


class DismissTests(Fixture):
    def test_hidden_while_done_back_when_active(self):
        cs.private_dir(self.cache)
        cs.save_dismissed(self.cache, {"bgdone": 1, "busy": 2, "gone": 3})
        r = self.collect(with_tokens=False)
        shown = {s["sessionId"] for g in r["groups"] for s in g["sessions"]}
        self.assertNotIn("bgdone", shown)              # finished: hidden
        self.assertIn("busy", shown)                   # working: never hidden
        self.assertEqual((r["dismissed"], r["counts"]["done"]), (1, 0))
        # sessions that are gone or active again are forgotten
        self.assertEqual(set(cs.load_dismissed(self.cache)), {"bgdone"})


class SharedChatTests(Fixture):
    """A chat shared across profiles = one transcript hard-linked into each."""

    def setUp(self):
        super().setUp()
        work = self.home / ".claude-work/projects/-w-proj"
        personal = self.home / ".claude-personal/projects/-w-proj"
        write(work / "busy.jsonl", assistant("m-shared", self.now - 30, 7) + "\n")
        personal.mkdir(parents=True)
        os.link(work / "busy.jsonl", personal / "busy.jsonl")
        write(work / "waiting.jsonl", assistant("m-own", self.now - 30, 5) + "\n")   # not shared
        self.state = Path(self.tmp.name) / "state"
        os.environ["XDG_STATE_HOME"] = str(self.state)
        self.addCleanup(os.environ.pop, "XDG_STATE_HOME")

    def sessions(self):
        r = self.collect()
        return {s["sessionId"]: s for s in self.group(r, "work")["sessions"]}, r

    def test_shared_flag_and_holder(self):
        write(self.state / "claude-shared-chats" / "lock-busy",
              f"{os.getpid()}-{cs.proc_start_time(os.getpid())} {self.home / '.claude-personal'}\n")
        by_id, _ = self.sessions()
        self.assertEqual(by_id["busy"]["shared"], {"profiles": ["work", "personal"], "openIn": "personal"})
        self.assertIsNone(by_id["waiting"]["shared"])

    def test_dead_holder_is_ignored(self):
        write(self.state / "claude-shared-chats" / "lock-busy", "4194311-1 /nowhere\n")
        by_id, _ = self.sessions()
        self.assertEqual(by_id["busy"]["shared"]["openIn"], None)

    def test_tokens_report_the_shared_part(self):
        _, r = self.sessions()
        today = self.group(r, "work")["tokens"]["today"]
        self.assertEqual((today["messages"], today["shared"]), (2, 2 + 7 + 100 + 10))


class SharedCopiesTests(Fixture):
    def setUp(self):
        super().setUp()
        work = self.home / ".claude-work/projects/-w-proj"
        personal = self.home / ".claude-personal/projects/-w-proj"
        write(personal / "chat1.jsonl", assistant("m1", self.now - 30, 1) + "\n")
        work.mkdir(parents=True, exist_ok=True)
        os.link(personal / "chat1.jsonl", work / "chat1.jsonl")              # a shared chat
        os.environ["XDG_STATE_HOME"] = str(Path(self.tmp.name) / "state")
        self.addCleanup(os.environ.pop, "XDG_STATE_HOME")

    def test_stopped_copy_left_out_when_listed_elsewhere(self):
        write(self.home / ".claude-personal/sessions/50.json", session("chat1", status="busy"))
        write(self.home / ".claude-work/jobs/chat1/state.json",
              {"state": "stopped", "tempo": "idle", "sessionId": "chat1", "updatedAt": iso(self.now - 600)})
        r = self.collect(with_tokens=False)
        rows = [(g["name"], s["sessionId"]) for g in r["groups"] for s in g["sessions"] if s["sessionId"] == "chat1"]
        self.assertEqual(rows, [("personal", "chat1")])
        kept = next(s for s in self.group(r, "personal")["sessions"] if s["sessionId"] == "chat1")
        self.assertEqual(kept["shared"]["stoppedCopies"], ["work"])
        # work points to it instead
        here = self.group(r, "work")["sharedHere"]
        self.assertEqual([(c["sessionId"], c["profile"], c["state"], c["stoppedHere"]) for c in here],
                         [("chat1", "personal", "working", True)])
        self.assertEqual(self.group(r, "personal")["sharedHere"], [])

    def test_shared_chat_points_from_the_other_account(self):
        write(self.home / ".claude-personal/sessions/50.json", session("chat1", status="busy"))
        r = self.collect(with_tokens=False)
        self.assertNotIn("chat1", [s["sessionId"] for s in self.group(r, "work")["sessions"]])
        here = self.group(r, "work")["sharedHere"]
        self.assertEqual([(c["sessionId"], c["profileDir"], c["stoppedHere"]) for c in here],
                         [("chat1", ".claude-personal", False)])

    def test_background_session_continuing_the_chat_is_that_chat(self):
        # Resumed as a background session on work: new id, but it wrote into the
        # shared transcript; its own file only got a title
        write(self.home / ".claude-personal/sessions/50.json", session("chat1", status="busy"))
        write(self.home / ".claude-work/projects/-w-proj/cont1.jsonl",
              json.dumps({"type": "ai-title", "aiTitle": "t", "sessionId": "cont1"}) + "\n")
        write(self.home / ".claude-work/jobs/cont1/state.json",
              {"state": "stopped", "tempo": "idle", "sessionId": "cont1", "resumeSessionId": "chat1",
               "updatedAt": iso(self.now - 600)})
        r = self.collect(with_tokens=False)
        self.assertNotIn("cont1", [s["sessionId"] for s in self.group(r, "work")["sessions"]])
        kept = next(s for s in self.group(r, "personal")["sessions"] if s["sessionId"] == "chat1")
        self.assertEqual(kept["shared"]["stoppedCopies"], ["work"])
        self.assertEqual([c["sessionId"] for c in self.group(r, "work")["sharedHere"]], ["chat1"])

    def continued_in(self, new_id):
        with open(self.home / ".claude-personal/projects/-w-proj/chat1.jsonl", "a") as f:
            f.write(json.dumps({"type": "continued-in", "sessionId": "chat1", "continuedInSessionId": new_id},
                               separators=(",", ":")) + "\n")

    def test_continuation_found_by_the_chats_continued_in_record(self):
        # The job names itself in resumeSessionId; only the chat's transcript links them
        write(self.home / ".claude-work/jobs/chat1/state.json",
              {"state": "stopped", "tempo": "idle", "sessionId": "chat1", "updatedAt": iso(self.now - 3000)})
        write(self.home / ".claude-personal/projects/-w-proj/cont1.jsonl",
              json.dumps({"type": "ai-title", "aiTitle": "t", "sessionId": "cont1"}) + "\n")
        write(self.home / ".claude-personal/jobs/cont1/state.json",
              {"state": "stopped", "tempo": "idle", "sessionId": "cont1", "resumeSessionId": "cont1",
               "updatedAt": iso(self.now - 240)})
        self.continued_in("cont1")
        r = self.collect(with_tokens=False)
        kept = [(g["name"], s["sessionId"]) for g in r["groups"] for s in g["sessions"] if s["sessionId"] in ("chat1", "cont1")]
        self.assertEqual(kept, [("personal", "cont1")])   # one row for the chat, the newest
        cont = next(s for s in self.group(r, "personal")["sessions"] if s["sessionId"] == "cont1")
        self.assertEqual((cont["shared"]["continues"], cont["shared"]["stoppedCopies"]), ("chat1", ["work"]))
        self.assertEqual([c["sessionId"] for c in self.group(r, "work")["sharedHere"]], ["cont1"])
        self.assertEqual(self.group(r, "personal")["sharedHere"], [])

    def test_continuation_that_started_a_new_conversation_is_its_own_chat(self):
        write(self.home / ".claude-work/projects/-w-proj/new1.jsonl", assistant("m2", self.now - 30, 1) + "\n")
        write(self.home / ".claude-work/jobs/job1/state.json",
              {"state": "stopped", "tempo": "idle", "sessionId": "job1", "resumeSessionId": "new1",
               "updatedAt": iso(self.now - 60)})
        write(self.home / ".claude-work/sessions/60.json", {**session("new1", status="busy"), "kind": "bg", "jobId": "job1"})
        self.continued_in("job1")
        r = self.collect(with_tokens=False)
        new = next(s for s in self.group(r, "work")["sessions"] if s["sessionId"] == "new1")
        self.assertIsNone(new["shared"])

    def test_no_pointer_where_a_fork_is_listed(self):
        write(self.home / ".claude-personal/sessions/50.json", session("chat1", status="busy"))
        write(self.home / ".claude-work/projects/-w-proj/fork1.jsonl", assistant("m2", self.now - 30, 1) + "\n")
        write(self.home / ".claude-work/jobs/fork1/state.json",
              {"state": "stopped", "tempo": "idle", "sessionId": "fork1", "resumeSessionId": "chat1",
               "updatedAt": iso(self.now - 600)})
        r = self.collect(with_tokens=False)
        self.assertEqual(self.group(r, "work")["sharedHere"], [])
        self.assertEqual(self.group(r, "personal")["sharedHere"], [])   # a fork isn't shared itself

    def test_fork_of_shared_chat_is_marked(self):
        write(self.home / ".claude-work/projects/-w-proj/fork1.jsonl", assistant("m2", self.now - 30, 1) + "\n")
        write(self.home / ".claude-work/jobs/fork1/state.json",
              {"state": "stopped", "tempo": "idle", "sessionId": "fork1", "resumeSessionId": "chat1",
               "updatedAt": iso(self.now - 600)})
        r = self.collect(with_tokens=False)
        fork = next(s for s in self.group(r, "work")["sessions"] if s["sessionId"] == "fork1")
        self.assertEqual((fork["shared"]["forkOf"], fork["shared"]["forkOn"]), ("chat1", "work"))


class OldPythonTests(unittest.TestCase):
    """claude_status.py also runs on SSH hosts, whose python3 may be as old as 3.7."""

    def test_no_syntax_or_calls_newer_than_37(self):
        source = (ROOT / "package/contents/code/claude_status.py").read_text()
        # no := or f"{x=}" (3.7 itself parses only what it supports)
        tree = ast.parse(source, feature_version=(3, 7)) if sys.version_info >= (3, 8) else ast.parse(source)
        newer_methods = {"removeprefix", "removesuffix", "is_relative_to", "with_stem", "readlink", "hardlink_to"}
        newer_calls = {("shlex", "join"), ("functools", "cache"), ("functools", "cached_property"),
                       ("math", "prod"), ("math", "isqrt")}
        for node in ast.walk(tree):
            if isinstance(node, ast.keyword):
                self.assertNotIn(node.arg, {"missing_ok", "strict"}, f"line {node.value.lineno}: {node.arg}= needs a newer Python")
            if isinstance(node, ast.Attribute):
                self.assertNotIn(node.attr, newer_methods, f"line {node.lineno}: .{node.attr} needs a newer Python")
                owner = getattr(node.value, "id", "")
                self.assertNotIn((owner, node.attr), newer_calls, f"line {node.lineno}: {owner}.{node.attr} needs a newer Python")

if __name__ == "__main__":
    unittest.main()
