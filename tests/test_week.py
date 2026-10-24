import importlib.util
import json
import os
import sys
import tempfile
import time
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True  # keep __pycache__ out of the plasmoid package
ROOT = Path(__file__).resolve().parent.parent
CODE = ROOT / "package/contents/code"
sys.path.insert(0, str(CODE))
spec = importlib.util.spec_from_file_location("week", CODE / "week.py")
week = importlib.util.module_from_spec(spec)
spec.loader.exec_module(week)
cs = week.cs

MIN = 60_000


def line(e):
    return json.dumps(e, separators=(",", ":")) + "\n"  # (as Claude Code writes them)


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat().replace("+00:00", "Z")


class Transcript:
    """Lines of a made-up transcript, the way Claude Code writes them."""

    def __init__(self, folder="/w/app"):
        self.lines, self.folder, self.n = [], folder, 0

    def uuid(self):
        self.n += 1
        return "%08d-0000-4000-8000-%012d" % (id(self) % 10 ** 8, self.n)

    def add(self, e):
        e.setdefault("uuid", self.uuid())
        e.setdefault("cwd", self.folder)
        self.lines.append(e)
        return self

    def prompt(self, ms, text="do it"):
        return self.add({"type": "user", "timestamp": iso(ms), "origin": {"kind": "human"},
                         "message": {"role": "user", "content": text}})

    def reply(self, ms, mid, output=100, model="claude-opus-5-5", read=1000, write=0, inp=5, tools=(), effort=None,
              hour_writes=False, **extra):
        usage = {"input_tokens": inp, "output_tokens": output, "cache_read_input_tokens": read,
                 "cache_creation_input_tokens": write}
        if hour_writes:
            usage["cache_creation"] = {"ephemeral_1h_input_tokens": write, "ephemeral_5m_input_tokens": 0}
        content = [{"type": "tool_use", "id": tid, "name": name, "input": inp_}
                   for tid, name, inp_ in tools] or [{"type": "text", "text": "ok"}]
        e = {"type": "assistant", "timestamp": iso(ms), "requestId": "req_" + mid,
             "message": {"id": "msg_" + mid, "model": model, "role": "assistant", "content": content, "usage": usage}}
        if effort:
            e["effort"] = effort
        e.update(extra)
        return self.add(e)

    def result(self, ms, tool_id, source="config", text="done"):
        return self.add({"type": "user", "timestamp": iso(ms),
                         "message": {"role": "user", "content": [{"tool_use_id": tool_id, "type": "tool_result",
                                                                  "content": text}]},
                         "toolUseResult": {"stdout": text},
                         "permissionDecision": {"decision": "accept", "source": source}})

    def duration(self, ms, worked):
        return self.add({"type": "system", "subtype": "turn_duration", "durationMs": worked, "timestamp": iso(ms)})

    def interrupted(self, ms):
        return self.add({"type": "user", "timestamp": iso(ms),
                         "message": {"role": "user", "content": [{"type": "text", "text": "[Request interrupted by user]"}]}})

    def limit(self, ms):
        return self.add({"type": "assistant", "timestamp": iso(ms), "isApiErrorMessage": True,
                         "message": {"id": "msg_err%d" % ms, "model": "<synthetic>", "role": "assistant",
                                     "content": [{"type": "text", "text": "You've hit your session limit · resets 7pm"}],
                                     "usage": {"input_tokens": 0, "output_tokens": 0}}})

    def title(self, text):
        return self.add({"type": "custom-title", "customTitle": text})

    def text(self):
        return "".join(line(e) for e in self.lines)


class Home(unittest.TestCase):
    """A made-up home: ~/.claude-work (a Team account) and ~/.claude-personal (a Pro one)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name) / "home"
        self.cache_root = Path(self.tmp.name) / "cache"
        for name, account in (("work", "acct-team"), ("personal", "acct-pro")):
            d = self.home / (".claude-" + name)
            (d / "projects/-w").mkdir(parents=True)
            (d / ".profile-name").write_text(name)
            (d / ".claude.json").write_text(json.dumps({"oauthAccount": {"accountUuid": account}}))
        # a fixed day, in the middle of the week shown: 7 days back from "now"
        self.now = int(datetime(2026, 10, 24, 18, 0).timestamp() * 1000)
        self.t0 = int(datetime(2026, 10, 24, 10, 0).timestamp() * 1000)

    def write(self, transcript, chat="chat-a", profile="work", sub=None):
        path = self.home / (".claude-" + profile) / "projects/-w" / (chat + ".jsonl")
        if sub:
            path = path.parent / chat / "subagents" / (sub + ".jsonl")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(transcript.text())
        return path

    def profiles(self):
        return cs.discover_profiles(self.home)

    def scan(self, cache=None):
        cache = cache if cache is not None else {"files": {}}
        week.scan(self.profiles(), cache, self.now)
        return cache

    def chats(self, cache=None):
        cache = self.scan(cache)
        return week.chats_between(cache, self.profiles(), self.now - 14 * week.DAY_MS, self.now + week.DAY_MS, self.home)

    def recap(self, account="", back=0, extra=()):
        chats = self.chats()
        _, accounts = week.account_ids(self.profiles())
        return week.recap([{"host": "", "chats": chats, "accounts": accounts}, *extra], back, account, self.now,
                          self.home)


class PriceTests(unittest.TestCase):
    def test_the_same_cost_as_claude_code(self):
        # a chat whose /usage said $5.678759 (its cost-state record)
        opus = week.request_cost("claude-opus-5-5", [88, 78252, 9536740, 0, 275735, 0, 1])
        haiku = week.request_cost("claude-haiku-5-5", [1289, 21, 0, 0, 0, 0, 1])
        self.assertAlmostEqual(opus + haiku, 5.6787594, places=6)

    def test_what_changes_a_price(self):
        mtok = [1_000_000, 0, 0, 0, 0, 0, 1]
        self.assertAlmostEqual(week.request_cost("claude-opus-5-5|f", mtok), 8)  # fast mode
        self.assertAlmostEqual(week.request_cost("claude-opus-5-5|f", [0, 0, 1_000_000, 0, 0, 0, 1]), 0.4)
        self.assertAlmostEqual(week.request_cost("claude-haiku-5-5|l", mtok), 0.5)  # a prompt over 100k tokens
        self.assertAlmostEqual(week.request_cost("claude-opus-5-5|u", mtok), 4.4)  # US-only inference
        self.assertAlmostEqual(week.request_cost("claude-sonnet-5-5", [0, 0, 0, 1_000_000, 0, 3, 1]), 2.53)
        self.assertEqual(week.price_key("claude-opus-5-5", {"speed": "fast"}, 10), "claude-opus-5-5|f")
        self.assertEqual(week.price_key("claude-haiku-5-5", {}, 150_000), "claude-haiku-5-5|l")

    def test_a_model_the_list_doesnt_know(self):
        self.assertEqual(week.price_model("claude-sonnet-4-5-20250929"), ("sonnet-4-5", False))
        self.assertEqual(week.price_model("claude-opus-5-5[1m]"), ("opus-5-5", False))
        self.assertEqual(week.price_model("claude-opus-9-9"), ("opus-5-5", True))  # the newest of its family
        self.assertEqual(week.price_model("gpt-9"), (None, True))
        self.assertEqual(week.request_cost("gpt-9", [1, 1, 1, 1, 1, 1, 1]), 0)

    def test_weights_as_claude_codes_usage(self):
        self.assertEqual(week.usage_weight("claude-opus-5-5", 1, 1, 1, 1), (1 + 10 + 12.5 + 50) * 5)
        self.assertEqual(week.usage_weight("claude-sonnet-5-5", 0, 0, 10, 0), 30)
        self.assertEqual(week.usage_weight("claude-haiku-5-5", 0, 0, 10, 0), 10)
        self.assertEqual(week.usage_weight("claude-fable-5-1", 0, 0, 10, 0), 100)


class TurnTests(Home):
    """A turn: Claude's own count of its work, and where the rest of it went."""

    def turns(self, transcript, chat="chat-a"):
        self.write(transcript, chat)
        return self.chats()[chat]["turns"]

    def test_waiting_for_your_permission_isnt_work(self):
        t0 = self.t0
        tr = (Transcript().prompt(t0).reply(t0 + 5000, "a", tools=[("T1", "Edit", {})])
              .result(t0 + 305_000, "T1", source="user_temporary").reply(t0 + 310_000, "b").duration(t0 + 320_000, 20_000))
        self.assertEqual(self.turns(tr), [[t0, t0 + 320_000, 20_000, [[t0 + 5000, t0 + 305_000, "y"]]]])

    def test_a_tool_allowed_by_your_settings_is_work(self):
        t0 = self.t0
        tr = (Transcript().prompt(t0).reply(t0 + 5000, "a", tools=[("T1", "Bash", {"command": "make"})])
              .result(t0 + 305_000, "T1").reply(t0 + 310_000, "b").duration(t0 + 320_000, 320_000))
        self.assertEqual(self.turns(tr), [[t0, t0 + 320_000, 320_000, []]])

    def test_a_question_waits_for_you(self):
        t0 = self.t0
        tr = (Transcript().prompt(t0).reply(t0 + 5000, "a", tools=[("Q", "AskUserQuestion", {})])
              .result(t0 + 125_000, "Q").reply(t0 + 130_000, "b"))  # (no turn_duration: VS Code's)
        self.assertEqual(self.turns(tr), [[t0, t0 + 130_000, 10_000, [[t0 + 5000, t0 + 125_000, "y"]]]])

    def test_without_turn_records_a_turn_ends_at_the_next_prompt(self):
        t0 = self.t0
        tr = Transcript().prompt(t0).reply(t0 + 60_000, "a").prompt(t0 + 600_000).reply(t0 + 660_000, "b")
        self.assertEqual(self.turns(tr), [[t0, t0 + 60_000, 60_000, []], [t0 + 600_000, t0 + 660_000, 60_000, []]])

    def test_a_sleep_is_not_work(self):
        t0 = self.t0
        tr = (Transcript().prompt(t0).reply(t0 + 10_000, "a").reply(t0 + 2 * 3600_000, "b")
              .duration(t0 + 2 * 3600_000 + 10_000, 2 * 3600_000 + 10_000))  # (Claude Code counted it)
        (turn,) = self.turns(tr)
        self.assertEqual(turn[2], 20_000)
        self.assertEqual(turn[3], [[t0 + 10_000, t0 + 2 * 3600_000, "p"]])

    def test_a_prompt_sent_while_claude_works_is_the_same_turn(self):
        t0 = self.t0
        tr = (Transcript().prompt(t0).reply(t0 + 5000, "a").duration(t0 + 6000, 6000)
              .prompt(t0 + 60_000).reply(t0 + 70_000, "b", tools=[("T", "Bash", {})]).prompt(t0 + 80_000, "and this")
              .result(t0 + 100_000, "T").reply(t0 + 110_000, "c").duration(t0 + 120_000, 60_000))
        self.write(tr)
        chat = self.chats()["chat-a"]
        self.assertEqual([t[:3] for t in chat["turns"]], [[t0, t0 + 6000, 6000], [t0 + 60_000, t0 + 120_000, 60_000]])
        self.assertEqual(len(chat["prompts"]), 3)

    def test_a_stopped_turn_ends_where_you_stopped_it(self):
        t0 = self.t0
        tr = (Transcript().prompt(t0).reply(t0 + 5000, "a").duration(t0 + 6000, 6000)
              .prompt(t0 + 60_000).reply(t0 + 70_000, "b").interrupted(t0 + 80_000).prompt(t0 + 100_000)
              .reply(t0 + 110_000, "c").duration(t0 + 120_000, 20_000))
        self.assertEqual([t[:3] for t in self.turns(tr)],
                         [[t0, t0 + 6000, 6000], [t0 + 60_000, t0 + 80_000, 20_000], [t0 + 100_000, t0 + 120_000, 20_000]])

    def test_the_turn_going_on(self):
        t0 = self.t0
        tr = (Transcript().prompt(t0).reply(t0 + 5000, "a", tools=[("T", "Edit", {})])
              .result(t0 + 65_000, "T", source="user_permanent").reply(t0 + 90_000, "b"))
        self.assertEqual(self.turns(tr), [[t0, t0 + 90_000, 30_000, [[t0 + 5000, t0 + 65_000, "y"]]]])


class UsageTests(Home):
    """Each reply's usage, counted once."""

    def test_a_reply_in_blocks_over_two_scans(self):
        t0 = self.t0
        tr = Transcript().prompt(t0).reply(t0 + 1000, "a", output=10)
        path = self.write(tr)
        cache = self.scan()
        with open(path, "a") as f:  # its next blocks, with the final count
            f.write(line(dict(tr.lines[-1], uuid="x2", timestamp=iso(t0 + 2000))))
            last = json.loads(json.dumps(tr.lines[-1]))
            last["message"]["usage"]["output_tokens"] = 50
            f.write(line(dict(last, uuid="x3", timestamp=iso(t0 + 3000))))
        chat = self.chats(cache)["chat-a"]
        (agg,) = chat["hours"].values()
        self.assertEqual(agg["t"], {"claude-opus-5-5": [5, 50, 1000, 0, 0, 0, 1]})
        self.assertEqual(agg["w"][week.W_ALL], week.usage_weight("claude-opus-5-5", 5, 50, 1000, 0))

    def test_copies_count_once(self):
        t0 = self.t0
        original = Transcript().title("original").prompt(t0).reply(t0 + 1000, "a").duration(t0 + 2000, 2000)
        self.write(original, "chat-a")
        copy = Transcript()
        copy.lines = [dict(e) for e in original.lines]  # (a fork keeps the uuids and ids)
        copy.prompt(t0 + 60_000).reply(t0 + 61_000, "b").duration(t0 + 62_000, 2000)
        self.write(copy, "chat-b")
        r = self.recap()
        self.assertAlmostEqual(r["sum"]["cost"], 2 * week.request_cost("claude-opus-5-5", [5, 100, 1000, 0, 0, 0, 1]), 4)
        self.assertEqual((r["sum"]["prompts"], r["sum"]["turns"], r["sum"]["workedMs"]), (2, 2, 4000))

    def test_a_forked_subagent_starts_with_a_copy_of_the_call(self):
        t0 = self.t0
        main = Transcript().prompt(t0).reply(t0 + 1000, "call", tools=[("A", "Agent", {})])
        self.write(main)
        sub = Transcript()
        sub.lines = [dict(main.lines[-1], isSidechain=True)]
        sub.prompt(t0 + 1500, "your directive").reply(t0 + 2000, "own", isSidechain=True)
        self.write(sub, sub="agent-x")
        (agg,) = self.chats()["chat-a"]["hours"].values()
        self.assertEqual(agg["w"][week.N_ALL], 2)
        self.assertEqual(agg["w"][week.N_SUB], 1)

    def test_a_chat_shared_by_hard_links(self):
        t0 = self.t0
        path = self.write(Transcript().prompt(t0).reply(t0 + 1000, "a").duration(t0 + 2000, 2000))
        os.link(path, self.home / ".claude-personal/projects/-w/chat-a.jsonl")
        self.assertEqual(len(self.scan()["files"]), 1)  # read once
        chat = self.chats()["chat-a"]
        self.assertEqual(sorted(chat["profiles"]), [".claude-personal", ".claude-work"])
        by_profile, _ = week.account_ids(self.profiles())
        for account in by_profile.values():  # on each account it's on, once in all
            self.assertEqual(self.recap(account)["sum"]["turns"], 1)
        self.assertEqual(self.recap()["sum"]["turns"], 1)

    def test_reading_on_gives_what_reading_once_gives(self):
        t0, tr = self.t0, Transcript()
        tr.prompt(t0).reply(t0 + 5000, "a", tools=[("T1", "Edit", {})]).result(t0 + 90_000, "T1", source="user_temporary")
        tr.reply(t0 + 95_000, "b", output=10).reply(t0 + 96_000, "b", output=30).duration(t0 + 100_000, 15_000)
        tr.prompt(t0 + 200_000).reply(t0 + 210_000, "c", tools=[("T2", "Bash", {"command": "ls"})])
        tr.result(t0 + 230_000, "T2", text="x" * 30_000).reply(t0 + 240_000, "d", read=200_000).limit(t0 + 250_000)
        tr.prompt(t0 + 5000_000).reply(t0 + 5010_000, "e").duration(t0 + 5020_000, 20_000)
        whole = Transcript()
        whole.lines = list(tr.lines)
        self.write(whole)
        once = self.chats()
        cache = {"files": {}}
        for n in range(1, len(tr.lines) + 1):  # each line written, then read
            part = Transcript()
            part.lines = tr.lines[:n]
            self.write(part)
            self.scan(cache)
        self.assertEqual(self.chats(cache), once)


class YourTimeTests(unittest.TestCase):
    def test_gaps_under_idle_count(self):
        m = MIN
        # your prompts at 0, 5 and 40 min; Claude's turns ended at 2, 10 and 60
        spans = week.your_time([0, 5 * m, 40 * m], [2 * m, 10 * m, 60 * m])
        self.assertEqual(spans, [[-1 * m, 10 * m], [39 * m, 40 * m]])

    def test_two_chats_ending_dont_make_your_time(self):
        self.assertEqual(week.your_time([], [0, 5 * MIN]), [])


class RecapTests(Home):
    def test_a_week_of_days(self):
        t0 = self.t0
        self.write(Transcript().prompt(t0).reply(t0 + 60_000, "a").duration(t0 + 120_000, 120_000))
        r = self.recap()
        self.assertEqual([d["day"] for d in r["days"]],
                         [(date(2026, 10, 24) - timedelta(days=6 - i)).isoformat() for i in range(7)])
        today = r["days"][-1]
        self.assertEqual(today["work"], [[t0, t0 + 120_000, 1]])
        self.assertEqual(today["you"], [[t0 - week.PROMPT_LEAD_MS, t0 + 120_000]])
        self.assertEqual((r["sum"]["workedMs"], r["sum"]["youMs"], r["sum"]["prompts"]), (120_000, 180_000, 1))
        self.assertEqual(r["projects"][0]["name"], "app")
        self.assertEqual((r["chats"][0]["chatId"], r["chats"][0]["cwd"]), ("chat-a", "/w/app"))
        self.assertEqual(r["models"][0]["model"], "Opus 5.5")
        self.assertEqual(self.recap(back=1)["sum"]["workedMs"], 0)
        self.assertEqual(self.recap(back=1)["to"], "2026-10-17")

    def test_the_week_before(self):
        before = self.t0 - 7 * week.DAY_MS
        self.write(Transcript().prompt(before).reply(before + 1000, "a").duration(before + 30_000, 30_000))
        r = self.recap()
        self.assertEqual((r["sum"]["workedMs"], r["previous"]["workedMs"]), (0, 30_000))

    def test_chats_at_once(self):
        t0 = self.t0
        for i, chat in enumerate(("a", "b")):
            s = t0 + i * 60_000
            self.write(Transcript().prompt(s).reply(s + 1000, chat).duration(s + 120_000, 120_000), "chat-" + chat)
        r = self.recap()
        self.assertEqual(r["days"][-1]["work"], [[t0, t0 + 60_000, 1], [t0 + 60_000, t0 + 120_000, 2],
                                                [t0 + 120_000, t0 + 180_000, 1]])
        self.assertEqual((r["sum"]["peakAtOnce"], r["sum"]["busyMs"], r["sum"]["workedMs"]), (2, 180_000, 240_000))

    def test_one_account(self):
        t0 = self.t0
        self.write(Transcript().prompt(t0).reply(t0 + 1000, "a").duration(t0 + 2000, 2000), "chat-a", "work")
        self.write(Transcript().prompt(t0).reply(t0 + 1000, "b").duration(t0 + 3000, 3000), "chat-b", "personal")
        by_profile, _ = week.account_ids(self.profiles())
        self.assertEqual(self.recap(by_profile[".claude-work"])["sum"]["workedMs"], 2000)
        self.assertEqual(self.recap(by_profile[".claude-personal"])["sum"]["workedMs"], 3000)
        self.assertEqual(self.recap()["sum"]["workedMs"], 5000)
        self.assertEqual(sorted(a["name"] for a in self.recap()["accounts"]), ["personal", "work"])

    def test_an_ssh_hosts_chats(self):
        t0 = self.t0
        host_chat = {"profiles": [".claude"], "accounts": ["x"], "folder": "/srv/job", "project": "/srv/job",
                     "name": "train", "turns": [[t0, t0 + 600_000, 600_000, []]], "prompts": [t0], "limits": [],
                     "hours": {}, "startTokens": None}
        r = self.recap(extra=[{"host": "gpu", "chats": {"c1": host_chat}, "accounts": [{"id": "x", "name": "lab"}]}])
        self.assertEqual(r["sum"]["workedMs"], 600_000)
        self.assertEqual((r["projects"][0]["name"], r["projects"][0]["host"]), ("job", "gpu"))

    def test_limits_hit_by_several_chats_are_one_time(self):
        t0, hour = self.t0, 3600_000
        self.write(Transcript().prompt(t0).limit(t0 + 1000).limit(t0 + 60_000), "chat-a")
        self.write(Transcript().prompt(t0).limit(t0 + 2000).limit(t0 + 5 * hour), "chat-b")
        self.assertEqual(self.recap()["sum"]["limits"], 2)


class TipTests(Home):
    def hour(self, **w):
        agg = {"t": {}, "w": [0] * week.W_SIZE, "b": {}, "a": {}, "g": {}}
        for name, v in w.items():
            agg["w"][getattr(week, name)] = v
        return agg

    def chat(self, hours, **kw):
        return dict({"key": kw.pop("key", "|c"), "hours": hours, "startTokens": None}, **kw)

    def test_a_behavior_from_a_tenth_of_the_usage(self):
        h = str(self.t0 // week.HOUR_MS)
        chats = [self.chat({h: self.hour(W_ALL=100, W_MAX=12, W_LONG=9, N_ALL=10)})]
        tips = week.tips(chats, self.t0 - week.DAY_MS, self.now, {}, [])
        self.assertEqual([(t["key"], t["pct"]) for t in tips], [("max_effort", 12)])  # not long context: 9%

    def test_many_chats_at_once(self):
        h = str(self.t0 // week.HOUR_MS)
        chats = [self.chat({h: dict(self.hour(W_ALL=10, N_ALL=1), b={"3": 10})}, key="|%d" % i) for i in range(4)]
        tips = week.tips(chats, self.t0 - week.DAY_MS, self.now, {}, [])
        self.assertEqual([(t["key"], t["pct"], t["detail"]) for t in tips], [("high_parallel", 100, "up to 4 at once")])

    def test_a_chat_running_for_hours(self):
        hours = {str(self.t0 // week.HOUR_MS - i): self.hour(W_ALL=10, N_ALL=1) for i in range(8)}
        tips = week.tips([self.chat(hours)], self.t0 - week.DAY_MS, self.now, {}, [])
        self.assertEqual([t["key"] for t in tips], ["long_running"])

    def test_subagents(self):
        h = str(self.t0 // week.HOUR_MS)
        heavy = self.chat({h: self.hour(W_ALL=10, W_SUB=8, N_SUB=1, N_ALL=2)}, key="|a")
        light = self.chat({h: self.hour(W_ALL=10, W_SUB=1, N_SUB=1, N_ALL=2)}, key="|b")
        self.assertEqual([(t["key"], t["pct"]) for t in week.tips([heavy, light], self.t0 - week.DAY_MS, self.now, {}, [])],
                         [("subagent_heavy", 50)])

    def test_what_made_the_large_results(self):
        self.assertEqual(week.big_result_tip({"Read|/w/app/data.csv": [3, 40_000], "Bash|ls": [1, 12_000]}),
                         ("Read data.csv in parts", "up to 40k tokens, 3 times", ""))
        self.assertEqual(week.big_result_tip({"Bash|pytest -v": [1, 12_000]})[0], 'Shorten the output of "pytest -v"')
        self.assertEqual(week.big_result_tip({"mcp__github__search|": [1, 12_000]})[0], "Ask github for smaller results")

    def test_waiting_and_limits(self):
        waits = [[self.t0, self.t0 + 20 * MIN]]
        tips = week.tips([], self.t0 - week.DAY_MS, self.now, {"limits": 3}, waits)
        self.assertEqual([t["key"] for t in tips], ["waits", "limits"])
        self.assertIn("20m 0s", tips[0]["detail"])

    def test_tips_from_transcripts(self):
        t0, tr = self.t0, Transcript()
        tr.prompt(t0).reply(t0 + 1000, "a", effort="max", inp=150_000, read=0)
        tr.duration(t0 + 2000, 2000)
        self.write(tr)
        keys = {t["key"] for t in self.recap()["tips"]}
        self.assertTrue({"max_effort", "cache_miss", "always_on_context"} <= keys, keys)
        self.assertNotIn("long_context", keys)  # (150k is the limit, not over it)


sys.path.insert(0, str(ROOT / "tests"))
from test_remote import FakeSSH  # noqa: E402  (a stand-in ssh: runs the command here, in a made-up home)


class HostTests(FakeSSH):
    """An SSH host's week: this file runs there (on python3's stdin, after
    claude_status.py) and sends its chats of those days back."""

    def test_an_ssh_hosts_chats(self):
        now = int(time.time() * 1000)
        t0 = now - 3600_000
        tr = Transcript("/srv/x").prompt(t0).reply(t0 + 1000, "r").duration(t0 + 60_000, 60_000)
        (self.fake_home / ".claude/projects/-p/chat-r.jsonl").write_text(tr.text())
        source = week.host_chats("lab", 0)
        self.assertTrue(source["ok"], source)
        self.assertEqual(list(source["chats"]), ["chat-r"])
        r = week.recap([{"host": "", "chats": {}, "accounts": []}, source], 0, "", now, Path(self.tmp.name))
        self.assertEqual((r["sum"]["workedMs"], r["projects"][0]["host"], r["sources"][1]["ok"]), (60_000, "lab", True))

    def test_a_host_that_turns_you_away(self):
        self.mode("denied")
        source = week.host_chats("lab", 0)
        self.assertFalse(source["ok"])
        self.assertIn("refused", source["error"])


class OutputTests(Home):
    def test_main_prints_the_recap(self):
        import io
        from contextlib import redirect_stdout
        t0 = self.t0
        self.write(Transcript().prompt(t0).reply(t0 + 1000, "a").duration(t0 + 2000, 2000))
        out = io.StringIO()
        saved = dict(os.environ)
        self.addCleanup(lambda: (os.environ.clear(), os.environ.update(saved)))
        os.environ["HOME"], os.environ["XDG_CACHE_HOME"] = str(self.home), str(self.cache_root)
        real_time = week.time.time
        week.time.time = lambda: self.now / 1000
        self.addCleanup(setattr, week.time, "time", real_time)
        with redirect_stdout(out):
            week.main([])
        result = json.loads(out.getvalue())
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["sum"]["turns"], 1)
        self.assertTrue((self.cache_root / "claude-widget" / week.CACHE_FILE).is_file())
        out = io.StringIO()
        with redirect_stdout(out):
            week.main(["--data", "--remote"])
        text = out.getvalue()
        answer = json.loads(text[text.rfind("\n" + cs.REMOTE_MARK) + 1 + len(cs.REMOTE_MARK):])
        self.assertEqual(list(answer["chats"]), ["chat-a"])


if __name__ == "__main__":
    unittest.main()
