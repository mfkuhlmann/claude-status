#!/usr/bin/env python3
"""Your week with Claude, for the widget's Week tab: how long you spent with
Claude and how long it worked, what the same work would cost at API prices,
where it went, and what would make it use less of your plan.

All of it comes from the chat transcripts Claude Code keeps on this computer
(and on the SSH hosts shown): nothing here starts Claude, calls a model or
goes online. Each run reads only what the transcripts added since the last
one (~/.cache/claude-widget/week-1.json), and the widget runs it only while
its Week tab is open, never in its status checks.

    python3 -I week.py [--back N] [--account ID] [--host HOST]... [--config-dir DIR]... [--pretty]

    --back N      the 7 days N weeks before the last 7 (BACK_MAX at most)
    --account ID  one account's chats (an id of claude_status.py's groups)
    --host HOST   an SSH host's chats too: remote.py runs this file there
                  (python3 -I - with claude_status.py loaded first) with
    --data        that host's chats of those days, for the computer asking
    --remote      the JSON after a marker line (login scripts may print first)

What it reads, per turn of a chat: your prompt, Claude's own count of its
work (the turn_duration record Claude Code writes when a turn ends, which
leaves out the time it waited for you), the tool calls you had to allow or
answer (permissionDecision), and each reply's token usage. A chat forked from
another starts with a copy of its entries: those count once.
"""

import json
import os
import re
import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ inside the installed widget...
if os.path.isfile(globals().get("__file__") or ""):  # (on an SSH host it comes on stdin, after claude_status.py)
    if sys.version_info >= (3, 8):  # ...but claude_status.py compiled in the cache, as poll.py does
        _cache = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "claude-widget"
        if _cache.is_dir():
            sys.pycache_prefix = str(_cache / "pycache")
            sys.dont_write_bytecode = False
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script dir off sys.path
import claude_status as cs  # noqa: E402

CACHE_FILE = "week-1.json"  # (a new layout gets a new name: an older copy of this file keeps its own)
CACHE_LOCK = "week.lock"
LOCK_WAIT_S = 30  # another run reading the transcripts: wait for it this long, then use the cache as it is
KEEP_DAYS = 35  # what the cache keeps: this week and the four before it
BACK_MAX = 4  # weeks you can step back
DAY_MS = 86_400_000
HOUR_MS = 3_600_000
BUCKET_MS = 300_000  # 5 minutes: how Claude's /usage counts the chats running at once
IDLE_MS = 15 * 60_000  # a longer gap between your prompts and Claude's replies: you were away
PROMPT_LEAD_MS = 60_000  # a prompt takes at least this much of your time (writing it)
GAP_MS = 30_000  # a pause in a turn worth noting (waiting for you, a long tool, a limit)
SLEEP_MS = 30 * 60_000  # this long with nothing written while Claude answers: it wasn't working (a sleep, a limit)
JOIN_MS = 60_000  # the timeline joins stretches this close
TOOLS_KEPT = 50  # tool calls a transcript's reading remembers until their results come
GAPS_KEPT = 200
USER_TOOLS = ("AskUserQuestion", "ExitPlanMode")  # tools that wait for your answer
TOP_PROJECTS, TOP_CHATS = 6, 5

# What Claude Code's /usage lists as "contributing to your limits usage" (a
# scan of local transcripts like this one), with its thresholds: a request
# with this many input tokens sent without the cache, with this much
# context; a chat that starts with this much context before your prompt; a
# tool result this big (bytes / 2.5); chats with this many subagent
# requests or more than this share of their usage in subagents; this many
# chats in one 5-minute stretch; a chat active in this many clock hours. A
# behavior gets a tip from this share of the week's usage, the largest first.
USAGE_CACHE_MISS = 100_000
USAGE_LONG_CONTEXT = 150_000
USAGE_ALWAYS_ON = 40_000
USAGE_LARGE_RESULT = 10_000
USAGE_SUBAGENT_REQUESTS = 3
USAGE_SUBAGENT_SHARE = 0.5
USAGE_PARALLEL = 4
USAGE_LONG_HOURS = 8
USAGE_TIP_PCT = 10
TIPS_SHOWN = 5
WAIT_TIP_MS = 15 * 60_000  # Claude waited this long for your answers in a week: a tip
LIMIT_TIP = 2  # usage limits hit in a week: a tip
LIMIT_EPISODE_MS = 60 * 60_000  # hits of a usage limit this close (on one account) are one time you hit it

# API list prices (https://platform.claude.com/docs/en/about-claude/pricing),
# in $ per million tokens: input, 5-minute cache write, 1-hour cache write,
# cache read, output. Claude Code prices its own /usage cost the same way.
PRICES_AS_OF = "2026-10-24"
PRICES = {
    "fable-5-1": (10, 12.5, 20, 0.25, 50), "mythos-5-1": (10, 12.5, 20, 0.25, 50),
    "fable-5": (10, 12.5, 20, 1, 50), "mythos-5": (10, 12.5, 20, 1, 50),
    "opus-5-5": (4, 5, 8, 0.2, 20), "opus-5": (5, 6.25, 10, 0.5, 25), "opus-4-8": (5, 6.25, 10, 0.5, 25),
    "opus-4-7": (5, 6.25, 10, 0.5, 25), "opus-4-6": (5, 6.25, 10, 0.5, 25), "opus-4-5": (5, 6.25, 10, 0.5, 25),
    "opus-4-1": (15, 18.75, 30, 1.5, 75), "opus-4": (15, 18.75, 30, 1.5, 75),
    "sonnet-5-5": (2, 2.5, 4, 0.1, 10), "sonnet-5": (2, 2.5, 4, 0.2, 10), "sonnet-4-6": (3, 3.75, 6, 0.3, 15),
    "sonnet-4-5": (3, 3.75, 6, 0.3, 15), "sonnet-4": (3, 3.75, 6, 0.3, 15), "3-7-sonnet": (3, 3.75, 6, 0.3, 15),
    "haiku-5-5": (0.1, 0.125, 0.2, 0.01, 0.5), "haiku-4-5": (1, 1.25, 2, 0.1, 5), "3-5-haiku": (0.8, 1, 1.6, 0.08, 4),
}
LONG_PROMPT = 100_000  # a prompt over this many tokens costs more on these models:
LONG_PRICES = {"haiku-5-5": (0.5, 0.625, 1, 0.05, 2.5)}
FAST_PRICES = {"opus-5-5": (8, 40), "opus-5": (10, 50), "opus-4-8": (10, 50)}  # fast mode: input, output
US_ONLY = 1.1  # inference_geo "us"
WEB_SEARCH = 0.01  # $ per web search
# A model the list doesn't know yet: priced as the newest of its family (marked as a guess)
FAMILY_NOW = (("fable", "fable-5-1"), ("mythos", "mythos-5-1"), ("opus", "opus-5-5"), ("sonnet", "sonnet-5-5"),
              ("haiku", "haiku-5-5"))

# An hour's usage of a chat ("w"): its weight (how much it counts toward the
# plan's limits, the way /usage weighs it), its subagents' weight and
# requests, the weight of each behavior, the requests and the requests of
# two behaviors
W_ALL, W_SUB, N_SUB, W_MISS, W_LONG, W_MAX, W_FLOW, W_ON, W_BIG, N_ALL, N_MISS, N_LONG = range(12)
W_SIZE = 12
F_SUB, F_MISS, F_LONG, F_MAX, F_FLOW = 1, 2, 4, 8, 16
USAGE_KEYS = ("input", "output", "cacheRead", "cacheWrite5m", "cacheWrite1h", "webSearches")


# ---------------------------------------------------------------- prices


def price_model(model):
    """claude-opus-5-5 -> ("opus-5-5", False); a model the list doesn't know:
    the newest of its family and True (a guess); not a Claude model: (None, True)."""
    m = (model or "").lower().split("[")[0]
    m = re.sub(r"-\d{8}$", "", cs.strip_prefix(m, "claude-"))
    if m in PRICES:
        return m, False
    for family, key in FAMILY_NOW:
        if family in m:
            return key, True
    return None, True


def model_tier(model):
    m = (model or "").lower()
    return 10 if "fable" in m else 5 if "opus" in m else 1 if "haiku" in m else 3


def usage_weight(model, inp, out, read, write):
    """How much a request counts toward a plan's limits, as Claude Code's
    /usage weighs it: its tokens by kind (a cache read 1, input 10, a cache
    write 12.5, output 50) times its model's tier."""
    return (read + inp * 10 + write * 12.5 + out * 50) * model_tier(model)


def price_key(model, usage, prompt):
    """The model and what changes its price: fast mode (f), US-only inference
    (u), a long prompt (l)."""
    flags = ("f" if usage.get("speed") == "fast" else "") + ("u" if usage.get("inference_geo") == "us" else "")
    flags += "l" if prompt > LONG_PROMPT else ""
    return model + ("|" + flags if flags else "")


def prices_of(key):
    """(the prices of a price key, a guess) or (None, True)."""
    model, _, flags = key.partition("|")
    name, guessed = price_model(model)
    if name is None:
        return None, True
    p = LONG_PRICES.get(name, PRICES[name]) if "l" in flags else PRICES[name]
    if "f" in flags and name in FAST_PRICES:  # (the cache multipliers apply on top)
        fast_in, fast_out = FAST_PRICES[name]
        k = fast_in / p[0]
        p = (fast_in, p[1] * k, p[2] * k, p[3] * k, fast_out)
    return p, guessed


def request_cost(key, t):
    """$ of tokens t ([input, output, cache read, 5-minute write, 1-hour write,
    web searches, requests]) at the API price of key."""
    p, _ = prices_of(key)
    if p is None:
        return 0.0
    cost = (t[0] * p[0] + t[3] * p[1] + t[4] * p[2] + t[2] * p[3] + t[1] * p[4]) / 1e6
    if "u" in key.partition("|")[2]:
        cost *= US_ONLY
    return cost + t[5] * WEB_SEARCH


def cache_saving(key, t):
    """What the cache reads of t saved: the same tokens as plain input."""
    p, _ = prices_of(key)
    return t[2] * (p[0] - p[3]) / 1e6 if p else 0.0


# ---------------------------------------------------------------- reading the transcripts


def transcript_kind(parts):
    """(chat id, subagent, workflow agent) of the transcript at
    projects/<parts...>, or None: <project>/<chat>.jsonl, a subagent's
    <project>/<chat>/subagents/agent-*.jsonl, a workflow's agents in
    <project>/<chat>/subagents/workflows/<run>/agent-*.jsonl."""
    if len(parts) == 2 and parts[1].endswith(".jsonl"):
        return parts[1][:-6], False, False
    if len(parts) >= 4 and parts[2] == "subagents" and parts[-1].startswith("agent-") and parts[-1].endswith(".jsonl"):
        return parts[1], True, len(parts) > 4 and parts[3] == "workflows"
    return None


def found_transcripts(profiles):
    """{path: {"profiles", "st", "kind", "aliases"}}: every transcript of the
    profiles once (a chat shared by hard links is one file under each
    profile: the profiles holding it, its other paths)."""
    out, by_inode = {}, {}
    for p in profiles:
        root = p.real / "projects"
        for path, _linked in cs.transcript_files(p):
            try:
                kind = transcript_kind(path.relative_to(root).parts)
                st = path.stat()
            except (ValueError, OSError):
                continue
            if kind is None:
                continue
            key, ident = str(path), (st.st_dev, st.st_ino)
            first = by_inode.get(ident)
            if first is None:
                by_inode[ident] = key
                out[key] = {"profiles": [p.key], "st": st, "kind": kind, "aliases": []}
            else:
                f = out[first]
                if p.key not in f["profiles"]:
                    f["profiles"].append(p.key)
                f["aliases"].append(key)
    return out


def new_record(kind, st):
    chat, sub, flow = kind
    return {"ino": st.st_ino, "offset": 0, "chat": chat, "sub": sub, "flow": flow,
            "state": {"turn": None, "timed": False, "tools": {}, "msg": None,
                      "ctx": {"last": None, "ctx": 0, "carried": 0, "first": 0, "start": None, "pending": 0,
                              "large": 0}},
            "data": {"turns": [], "prompts": [], "limits": [], "hours": {}, "names": {}, "folder": "",
                     "prompt": "", "startTokens": None}}


def reply_id(mid):
    """A reply's id as the cache keeps it (its random end)."""
    return mid[-12:]


def scan(profiles, cache, now_ms):
    """Read what the profiles' transcripts added since the last run into the
    cache (by path: {"ino", "offset", "chat", "sub", "state", "data"}).

    A reply can be in several transcripts: a forked chat starts with a copy
    of its original, a chat continued in another folder gets the same entries
    in both for a while, a forked subagent starts with a copy of the call that
    started it. Each reply counts once, in the first transcript read that has
    it (the ids of the counted ones are kept with their hour)."""
    cutoff = now_ms - KEEP_DAYS * DAY_MS
    old = cache.get("files") if isinstance(cache.get("files"), dict) else {}
    found = found_transcripts(profiles)
    for key in list(found):  # a file reached through another of its paths now keeps its record
        f = found[key]
        if not (old.get(key) or {}).get("ino") == f["st"].st_ino:
            alias = next((a for a in f["aliases"] if (old.get(a) or {}).get("ino") == f["st"].st_ino), None)
            if alias:
                found[alias] = dict(f, aliases=[a for a in f["aliases"] if a != alias] + [key])
                del found[key]
    files = {}
    for key in sorted(found):
        f, st = found[key], found[key]["st"]
        rec = old.get(key)
        if (not isinstance(rec, dict) or rec.get("ino") != st.st_ino or rec.get("offset", 0) > st.st_size
                or "state" not in rec):
            rec = new_record(f["kind"], st)
            if st.st_mtime * 1000 < cutoff:
                rec["offset"] = st.st_size  # untouched for longer than the cache keeps
        rec["profiles"] = f["profiles"]
        files[key] = rec
    counted = {i for rec in files.values() for agg in rec["data"]["hours"].values() for i in agg.get("m", [])}
    for key in sorted(files):
        rec = files[key]
        if rec["offset"] < found[key]["st"].st_size:
            read_transcript(Path(key), rec, counted)
        prune_record(rec, cutoff)
    cache["files"] = files
    cache["scannedAt"] = now_ms
    return cache


def read_transcript(path, rec, counted):
    try:
        with open(path, "rb") as f:
            f.seek(rec["offset"])
            for line in f:
                if not line.endswith(b"\n"):
                    break  # never a half-written last line
                rec["offset"] += len(line)
                try:
                    take_line(line, rec, counted)
                except (KeyError, TypeError, ValueError, AttributeError, IndexError):
                    continue  # an entry of a shape this doesn't know
    except OSError:
        pass


TITLE_FIELDS = dict(cs.TITLE_KINDS)
TITLE_LINES = tuple(('"type":"%s"' % k).encode() for k in TITLE_FIELDS)


def take_line(line, rec, counted):
    state = rec["state"]
    if line.startswith(b'{"type":"api-request'):  # (Claude Code writes its JSON without spaces)
        return
    if b'"type":"assistant"' in line:
        kind = "assistant"
    elif b'"type":"user"' in line:
        kind = "user"
    elif b'"subtype":"turn_duration"' in line:
        kind = "system"
    elif not rec["sub"] and any(t in line for t in TITLE_LINES):
        kind = "title"
    else:
        if state["ctx"]["last"] is None and b'"attachment":{"type":"file"' in line:
            state["ctx"]["first"] += len(line)  # (what /usage counts as your first prompt)
        return
    e = json.loads(line)
    if not isinstance(e, dict):
        return
    data = rec["data"]
    if not rec["sub"] and not data["folder"] and isinstance(e.get("cwd"), str) and e["cwd"].startswith("/"):
        data["folder"] = e["cwd"]  # (the folder it started in: Claude may cd elsewhere)
    if kind == "title":
        field = TITLE_FIELDS.get(e.get("type"))
        if field and isinstance(e.get(field), str) and e[field].strip():
            rec["data"]["names"][e["type"]] = cs.clean_text(e[field], 80)
        return
    ts = cs.to_ms(e.get("timestamp"))
    if ts is None or e.get("type") not in ("assistant", "user", "system"):
        return
    if e["type"] == "assistant":
        take_reply(e, ts, rec, counted)
    elif e["type"] == "user":
        take_user(e, ts, rec, line)
    elif e.get("subtype") == "turn_duration" and not rec["sub"]:
        worked = cs.number(e.get("durationMs"))
        if worked is not None and worked >= 0:
            state["timed"] = True
            if state["turn"] is None:  # (its prompt came before what was read: a fork's copy, a bg session's start)
                state["turn"] = {"start": ts - int(worked), "last": ts, "gaps": []}
            close_turn(state, data, ts, int(worked))


def note_gap(turn, start, end, kind):
    if end - start > GAP_MS:
        turn["gaps"].append([start, end, kind])
        if len(turn["gaps"]) > GAPS_KEPT:
            turn["gaps"].sort(key=lambda g: g[0] - g[1])
            del turn["gaps"][GAPS_KEPT:]
            turn["gaps"].sort()


def turn_activity(state, ts, kind="o"):
    """Something written during a turn: the stretch since the last entry is
    Claude answering (o), a tool running (t), a prompt you sent meanwhile (q)."""
    turn = state["turn"]
    if turn is None:
        return
    note_gap(turn, turn["last"], ts, kind)
    turn["last"] = max(turn["last"], ts)


def close_turn(state, data, end, worked=None):
    """Note the turn going on as ended at end. worked: Claude's own count of
    its work (turn_duration); without it, the whole turn but the waits for you.
    What a turn's wall time has beyond its work goes to where it can have
    been: waiting for your answers (y), a prompt you sent while it worked (q),
    then the longest pauses (o); a stretch of SLEEP_MS with nothing written
    is never work. waits: [[from, to, kind]], y = waiting for you, p = paused."""
    turn = state["turn"]
    state["turn"] = None
    state["tools"] = {}
    if turn is None:
        return
    start = turn["start"]
    end = max(end, start)
    wall = end - start
    gaps = [g for g in turn["gaps"] if start <= g[0] < g[1] <= end]
    asleep = [g for g in gaps if g[2] == "o" and g[1] - g[0] >= SLEEP_MS]
    waits = [[f, t, "p"] for f, t, _ in asleep]
    paused = sum(t - f for f, t, _ in asleep)
    if worked is None:
        waits += [[f, t, "y"] for f, t, k in gaps if k == "y"]
        worked = max(0, wall - covered(waits))
    else:
        worked = max(0, min(worked, wall - paused))
        left = wall - paused - worked
        for kind in ("y", "q", "o"):
            if left <= GAP_MS:
                break
            parts = sorted((g for g in gaps if g[2] == kind and (kind != "o" or g[1] - g[0] < SLEEP_MS)),
                           key=lambda g: g[0] - g[1])
            total = sum(t - f for f, t, _ in parts)
            if total <= 0:
                continue
            share = min(1.0, left / total) if kind == "y" else 1.0  # your answers share it, pauses the longest first
            for f, t, _ in parts:
                take = min(int((t - f) * share), left)
                if take <= 0:
                    break
                waits.append([f, f + take, "y" if kind == "y" else "p"])
                left -= take
    waits = sorted(w for w in waits if w[1] - w[0] >= 1000)
    if end - start > 0 or worked > 0:
        data["turns"].append([start, end, int(worked), waits])


def tool_detail(name, inp):
    """What a tool call was about, for a tip: a file read, a command run."""
    if not isinstance(inp, dict):
        return ""
    if name in ("Read", "NotebookRead") and isinstance(inp.get("file_path") or inp.get("notebook_path"), str):
        return inp.get("file_path") or inp.get("notebook_path")
    if name == "Bash" and isinstance(inp.get("command"), str):
        return cs.clean_text(inp["command"].split("\n")[0], 60)
    return ""


def hour_agg(data, ts):
    h = str(ts // HOUR_MS)
    agg = data["hours"].get(h)
    if agg is None:
        agg = data["hours"][h] = {"t": {}, "w": [0] * W_SIZE, "b": {}, "a": {}, "g": {}, "m": []}
    return h, agg


def usage_values(u):
    """[input, output, cache read, 5-minute write, 1-hour write, web searches] of a reply's usage."""
    num = lambda v: int(cs.number(v) or 0)  # noqa: E731
    write = num(u.get("cache_creation_input_tokens"))
    split = u.get("cache_creation") if isinstance(u.get("cache_creation"), dict) else {}
    hour = min(write, num(split.get("ephemeral_1h_input_tokens")))
    tools = u.get("server_tool_use") if isinstance(u.get("server_tool_use"), dict) else {}
    return [num(u.get("input_tokens")), num(u.get("output_tokens")), num(u.get("cache_read_input_tokens")),
            write - hour, hour, num(tools.get("web_search_requests"))]


def track_context(c, mid, inp, out, read, write, sub):
    """Claude Code's /usage reading of a transcript: how much of a request's
    context the chat had from its start (CLAUDE.md, tools, skills: on for
    every request) and how much is large tool results still in it ->
    (always-on tokens, large-result tokens)."""
    o = read + write + inp
    if mid == c["last"]:
        c["carried"] = max(c["carried"], o + out)
    else:
        if c["last"] is None:
            c["start"] = o - round(c["first"] / 2.5)
        elif o < c["ctx"]:  # (compacted)
            c["large"] = max(0, c["large"] - (c["ctx"] - o))
        else:
            added = min(o - c["carried"], c["pending"] / 2.5)
            if added > USAGE_LARGE_RESULT:
                c["large"] += added
        c["start"] = min(c["start"], o)
        c["last"], c["ctx"], c["carried"], c["pending"] = mid, o, o + out, 0
    on = c["start"] if not sub and c["start"] > USAGE_ALWAYS_ON else 0
    return on, int(c["large"])


def take_reply(e, ts, rec, counted):
    state, data = rec["state"], rec["data"]
    msg = e.get("message") if isinstance(e.get("message"), dict) else {}
    blocks = [c for c in msg.get("content") or [] if isinstance(c, dict)] if isinstance(msg.get("content"), list) else []
    if not rec["sub"]:
        if e.get("isApiErrorMessage") is True:
            text = " ".join(cs.message_text(msg).split())
            if text.startswith(cs.LIMIT_STARTS) or text.startswith(cs.OUT_OF_USAGE):
                data["limits"].append(ts)
        turn_activity(state, ts)
    tools = state["tools"]
    for c in blocks:
        if c.get("type") == "tool_use" and isinstance(c.get("id"), str) and isinstance(c.get("name"), str):
            tools[c["id"]] = [ts, c["name"], tool_detail(c["name"], c.get("input"))]
    if len(tools) > TOOLS_KEPT:
        for k in sorted(tools, key=lambda k: tools[k][0])[:len(tools) - TOOLS_KEPT]:
            del tools[k]
    usage, model = msg.get("usage"), msg.get("model")
    if not isinstance(usage, dict) or not isinstance(model, str) or not model or model.startswith("<"):
        return
    vals = usage_values(usage)
    inp, out, read, write = vals[0], vals[1], vals[2], vals[3] + vals[4]
    if not (inp or out or read or write):
        return
    mid = msg.get("id") or e.get("requestId") or e.get("uuid")
    sub = rec["sub"] or e.get("isSidechain") is True
    last = state["msg"]
    if last and last[0] == mid:  # another block of the same reply: its usage again, maybe grown
        track_context(state["ctx"], mid, inp, out, read, write, sub)
        if last[1] is None:
            return  # (a reply counted in another transcript)
        delta = [max(0, a - b) for a, b in zip(vals, last[3])]
        if any(delta):
            agg = rec["data"]["hours"].get(last[1])
            if agg is not None:
                t = agg["t"].setdefault(last[2], [0] * 7)
                for i, v in enumerate(delta):
                    t[i] += v
                w = usage_weight(model, delta[0], delta[1], delta[2], delta[3] + delta[4])
                flags = last[4]
                agg["w"][W_ALL] += w
                for flag, i in ((F_SUB, W_SUB), (F_MISS, W_MISS), (F_LONG, W_LONG), (F_MAX, W_MAX), (F_FLOW, W_FLOW)):
                    if flags & flag:
                        agg["w"][i] += w
                agg["b"][last[5]] = agg["b"].get(last[5], 0) + w
            last[3] = [max(a, b) for a, b in zip(vals, last[3])]
        return
    on, large = track_context(state["ctx"], mid, inp, out, read, write, sub)
    if not isinstance(mid, str) or reply_id(mid) in counted:  # counted in another transcript
        state["msg"] = [mid, None]
        return
    counted.add(reply_id(mid))
    if not sub:
        start = state["ctx"]["start"]
        data["startTokens"] = start if data["startTokens"] is None else min(data["startTokens"], start)
    prompt = inp + read + write
    key = price_key(model, usage, prompt)
    h, agg = hour_agg(data, ts)
    agg["m"].append(reply_id(mid))
    t = agg["t"].setdefault(key, [0] * 7)
    for i, v in enumerate(vals):
        t[i] += v
    t[6] += 1
    w = usage_weight(model, inp, out, read, write)
    input_w = w - out * 50 * model_tier(model)
    flags = ((F_SUB if sub else 0) | (F_MISS if inp > USAGE_CACHE_MISS else 0)
             | (F_LONG if prompt > USAGE_LONG_CONTEXT else 0) | (F_MAX if e.get("effort") == "max" else 0)
             | (F_FLOW if rec["flow"] else 0))
    a = agg["w"]
    a[W_ALL] += w
    a[N_ALL] += 1
    if flags & F_SUB:
        a[W_SUB] += w
        a[N_SUB] += 1
    if flags & F_MISS:
        a[W_MISS] += w
        a[N_MISS] += 1
    if flags & F_LONG:
        a[W_LONG] += w
        a[N_LONG] += 1
    if flags & F_MAX:
        a[W_MAX] += w
    if flags & F_FLOW:
        a[W_FLOW] += w
    if on and prompt:
        a[W_ON] += input_w * min(1.0, on / prompt)
    if large and prompt:
        a[W_BIG] += input_w * min(1.0, large / prompt)
    bucket = str((ts // BUCKET_MS) % (HOUR_MS // BUCKET_MS))
    agg["b"][bucket] = agg["b"].get(bucket, 0) + w
    for field, prefix in (("attributionPlugin", "plugin:"), ("attributionMcpServer", "mcp:")):
        if isinstance(e.get(field), str) and 0 < len(e[field]) <= 64:
            agg["a"][prefix + e[field]] = agg["a"].get(prefix + e[field], 0) + w
    agent, skill = e.get("attributionAgent"), e.get("attributionSkill")
    name = (skill or agent) if isinstance(agent, str) and agent else skill
    if isinstance(name, str) and 0 < len(name) <= 64:
        k = ("agent:" if isinstance(agent, str) and agent else "skill:") + name
        agg["a"][k] = agg["a"].get(k, 0) + w
    state["msg"] = [mid, h, key, vals, flags, bucket]


RESULT_FIELD = b'"type":"tool_result"'


def take_user(e, ts, rec, line):
    state, data = rec["state"], rec["data"]
    msg = e.get("message") if isinstance(e.get("message"), dict) else {}
    content = msg.get("content")
    results = [c for c in content if isinstance(c, dict) and c.get("type") == "tool_result"] if isinstance(content, list) else []
    main = not rec["sub"]
    if results:
        at = line.find(RESULT_FIELD)
        end = line.find(b'"toolUseResult":', at)
        size = (end if end > at else len(line)) - at  # (as /usage measures it)
        large = size / 2.5 > USAGE_LARGE_RESULT
        if large:
            state["ctx"]["pending"] += size
        pd = e.get("permissionDecision") if isinstance(e.get("permissionDecision"), dict) else {}
        yours = isinstance(pd.get("source"), str) and pd["source"].startswith("user")
        asked = None
        for r in results:
            tool = state["tools"].pop(r.get("tool_use_id"), None) if isinstance(r.get("tool_use_id"), str) else None
            if tool is None:
                continue
            if large:
                _, agg = hour_agg(data, ts)
                k = tool[1] + "|" + tool[2]
                g = agg["g"].setdefault(k, [0, 0])
                g[0] += 1
                g[1] = max(g[1], int(size / 2.5))
            if yours or tool[1] in USER_TOOLS:
                asked = tool[0] if asked is None else min(asked, tool[0])
        turn = state["turn"]
        if main and turn is not None:
            if asked is not None and ts - asked > 1000:  # Claude waited for you to allow it, or answer
                note_gap(turn, max(asked, turn["start"]), ts, "y")
                turn["last"] = max(turn["last"], ts)
            else:
                turn_activity(state, ts, "t")
        return
    if state["ctx"]["last"] is None:
        state["ctx"]["first"] += len(line)
    if not main:
        return
    text = cs.human_prompt(e)
    turn = state["turn"]
    if text is None:
        if cs.message_text(msg).lstrip().startswith("[Request interrupted"):
            if turn is not None:
                turn["stopped"] = ts  # (a turn_duration may still come)
                turn_activity(state, ts)
        else:
            turn_activity(state, ts)
        return
    data["prompts"].append(ts)
    if not data["prompt"]:
        data["prompt"] = cs.clean_text(text, 80)
    if turn is not None:
        # Sent while Claude works (it waits in Claude's queue), unless the
        # turn ended without a record of it (stopped, or a version that
        # doesn't write them): then it starts a new turn
        if state["timed"] and "stopped" not in turn and ts - turn["last"] <= IDLE_MS:
            turn_activity(state, ts, "q")
            return
        close_turn(state, data, turn.get("stopped", turn["last"]))
    state["turn"] = {"start": ts, "last": ts, "gaps": []}


def prune_record(rec, cutoff):
    data = rec.get("data")
    if not isinstance(data, dict):
        return
    data["turns"] = [t for t in data["turns"] if t[1] >= cutoff]
    data["prompts"] = [p for p in data["prompts"] if p >= cutoff]
    data["limits"] = [p for p in data["limits"] if p >= cutoff]
    first_hour = cutoff // HOUR_MS
    data["hours"] = {h: a for h, a in data["hours"].items() if int(h) >= first_hour}


# ---------------------------------------------------------------- the cache


def cache_path(cache_root):
    return cache_root / CACHE_FILE


def load_cache(cache_root):
    data = cs.read_json(cache_path(cache_root))
    return data if isinstance(data, dict) and isinstance(data.get("files"), dict) else {"files": {}}


def updated_cache(cache_root, profiles, now_ms):
    """The cache with what the transcripts added since; while another run is
    reading them (another widget, the VS Code extension), the cache it writes."""
    import fcntl
    cs.private_dir(cache_root)
    fd = os.open(str(cache_root / CACHE_LOCK), os.O_CREAT | os.O_RDWR, 0o600)
    try:
        held, waited = False, 0.0
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                held = True
                break
            except OSError:
                if waited >= LOCK_WAIT_S:
                    break
                time.sleep(0.2)
                waited += 0.2
        cache = load_cache(cache_root)
        if held:
            scan(profiles, cache, now_ms)
            try:
                cs.write_json_atomic(cache_path(cache_root), cache)
            except OSError:
                pass
        return cache
    finally:
        os.close(fd)


# ---------------------------------------------------------------- one machine's chats of some days


def merge_hour(into, agg):
    for key, t in agg.get("t", {}).items():
        mine = into["t"].setdefault(key, [0] * 7)
        for i, v in enumerate(t[:7]):
            mine[i] += v
    for i, v in enumerate(agg.get("w", [])[:W_SIZE]):
        into["w"][i] += v
    for field in ("b", "a"):
        for k, v in agg.get(field, {}).items():
            into[field][k] = into[field].get(k, 0) + v
    for k, (n, size) in agg.get("g", {}).items():
        g = into["g"].setdefault(k, [0, 0])
        g[0] += n
        g[1] = max(g[1], size)


def live_turn(state):
    """The turn going on now, as far as it went: [start, last, work, waits]."""
    turn = state.get("turn") if isinstance(state, dict) else None
    if not isinstance(turn, dict):
        return None
    start, last = turn["start"], turn.get("stopped", turn["last"])
    waits = [[f, t, "y"] for f, t, k in turn.get("gaps", []) if k == "y" and t <= last]
    waits += [[f, t, "p"] for f, t, k in turn.get("gaps", []) if k == "o" and t - f >= SLEEP_MS and t <= last]
    return [start, last, max(0, last - start - covered(waits)), sorted(waits)]


def account_ids(profiles):
    """{profile key: account id}, [{"id", "name"}] (claude_status.py's groups)."""
    by_profile, accounts = {}, []
    for gid, members in cs.group_profiles(profiles):
        named = next((p for p in members if not p.is_default), members[0])
        aid = cs.short_id(gid)
        accounts.append({"id": aid, "name": named.label, "plan": next((p.plan for p in members if p.plan), None)})
        for p in members:
            by_profile[p.key] = aid
    return by_profile, accounts


def project_of(folder, home, roots):
    """The project a chat's folder belongs to: its git repository's folder
    (a chat started in a subfolder counts for it), else the folder itself."""
    if folder not in roots:
        try:
            root = cs.git_root(Path(folder)) if folder.startswith("/") else None
        except OSError:
            root = None
        roots[folder] = str(root) if root is not None and root != home and root.parent != root else folder
    return roots[folder]


def chats_between(cache, profiles, since, until, home):
    """{chat id: {"profiles", "accounts", "folder", "project", "name",
    "turns", "prompts", "limits", "hours", "startTokens"}}: what the cache has
    of the profiles' chats between since and until (ms), with the turns going on."""
    by_profile, _ = account_ids(profiles)
    roots = {}
    first_hour, last_hour = since // HOUR_MS, until // HOUR_MS
    chats = {}
    for rec in cache.get("files", {}).values():
        data = rec.get("data") if isinstance(rec, dict) else None
        if not isinstance(data, dict):
            continue
        c = chats.get(rec["chat"])
        if c is None:
            c = chats[rec["chat"]] = {"profiles": [], "folder": "", "name": "", "turns": [], "prompts": [],
                                      "limits": [], "hours": {}, "startTokens": None}
        for p in rec.get("profiles", []):
            if p not in c["profiles"]:
                c["profiles"].append(p)
        for h, agg in data["hours"].items():
            if first_hour <= int(h) <= last_hour:
                merge_hour(c["hours"].setdefault(h, {"t": {}, "w": [0] * W_SIZE, "b": {}, "a": {}, "g": {}}), agg)
        if rec.get("sub"):
            continue
        turns = list(data["turns"])
        live = live_turn(rec.get("state"))
        if live:
            turns.append(live)
        c["turns"] += [t for t in turns if t[1] >= since and t[0] < until]
        c["prompts"] += [p for p in data["prompts"] if since <= p < until]
        c["limits"] += [p for p in data["limits"] if since <= p < until]
        names = data.get("names") or {}
        c["name"] = next((names[k] for k, _ in cs.TITLE_KINDS if names.get(k)), c["name"] or data.get("prompt") or "")
        c["folder"] = c["folder"] or data.get("folder") or ""
        if data.get("startTokens") is not None:
            c["startTokens"] = data["startTokens"] if c["startTokens"] is None else min(c["startTokens"], data["startTokens"])
    for c in chats.values():
        c["accounts"] = sorted({by_profile[p] for p in c["profiles"] if p in by_profile})
        c["project"] = project_of(c["folder"], home, roots) if c["folder"] else ""
        c["turns"].sort()
        c["prompts"].sort()
    return {k: c for k, c in chats.items() if c["turns"] or c["prompts"] or c["hours"]}


# ---------------------------------------------------------------- the recap


def midnight(day):
    """Local midnight starting day (a date), in ms."""
    return int(time.mktime(day.timetuple()) * 1000)


def week_days(back, now_ms):
    """The 7 days ending today, back weeks before: [(day, start ms, end ms)]."""
    end = date.fromtimestamp(now_ms / 1000) - timedelta(days=7 * back)
    days = [end - timedelta(days=i) for i in range(6, -1, -1)]
    return [(d.isoformat(), midnight(d), midnight(d + timedelta(days=1))) for d in days]


def merged(intervals, join=0):
    """Sorted intervals [[start, end], ...] joined where they overlap (or come within join)."""
    out = []
    for s, e in sorted([i[0], i[1]] for i in intervals if i[1] > i[0]):
        if out and s <= out[-1][1] + join:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out


def covered(intervals):
    return sum(e - s for s, e in merged(intervals))


def clipped(intervals, start, end):
    return [[max(s, start), min(e, end)] + list(rest) for s, e, *rest in intervals if e > start and s < end]


def minus(span, holes):
    """span [start, end] without the holes: the stretches left."""
    out, at = [], span[0]
    for s, e in merged([h[:2] for h in holes]):
        if e <= at or s >= span[1]:
            continue
        if s > at:
            out.append([at, min(s, span[1])])
        at = max(at, e)
    if at < span[1]:
        out.append([at, span[1]])
    return out


def at_once(stretches):
    """Stretches [[start, end, chat], ...] of several chats -> [[start, end,
    how many at once]], where at least one goes on."""
    points = sorted([(s, 1, c) for s, e, c in stretches] + [(e, -1, c) for s, e, c in stretches])
    out, running, at = [], {}, None
    for t, step, chat in points:
        if running and at is not None and t > at:
            n = len(running)
            if out and out[-1][1] == at and out[-1][2] == n:
                out[-1][1] = t
            else:
                out.append([at, t, n])
        running[chat] = running.get(chat, 0) + step
        if running[chat] <= 0:
            del running[chat]
        at = t
    return out


def your_time(prompts, handovers):
    """When you were at it: from each prompt back to the last thing before it
    and from each thing Claude gave you (a finished turn, a question) on to
    your next prompt or answer, where the gap is under IDLE_MS, and the minute
    you spent writing each prompt. prompts and answers are yours; handovers
    (a turn's end, Claude asking) are Claude's."""
    events = sorted([(t, 1) for t in prompts] + [(t, 0) for t in handovers])
    spans = [[t - PROMPT_LEAD_MS, t] for t, yours in events if yours]
    for (a, a_yours), (b, b_yours) in zip(events, events[1:]):
        if (a_yours or b_yours) and 0 < b - a <= IDLE_MS:
            spans.append([a, b])
    return merged(spans)


def overlap(intervals, start, end):
    return sum(max(0, min(e, end) - max(s, start)) for s, e, *_ in intervals)


def first_time(seen, key):
    if key in seen:
        return False
    seen.add(key)
    return True


def chat_label(chat):
    return chat["name"] or (os.path.basename(chat["folder"].rstrip("/")) if chat["folder"] else "")


def day_of(starts, ms):
    """Index of the day (by their start ms) holding ms, or None."""
    for i in range(len(starts) - 1, -1, -1):
        if ms >= starts[i]:
            return i if i < len(starts) - 1 else None
    return None


def recap(sources, back, account, now_ms, home):
    """The Week tab: sources = [{"host", "chats" (chats_between), "accounts"}]."""
    days = week_days(back, now_ms)
    starts = [d[1] for d in days] + [days[-1][2]]
    w0, w1 = starts[0], min(starts[-1], now_ms)
    p0 = midnight(date.fromisoformat(days[0][0]) - timedelta(days=7))
    chats, accounts = [], {}
    for src in sources:
        host = src.get("host") or ""
        for a in src.get("accounts") or []:
            accounts.setdefault(a["id"], dict(a, hosts=[]))["hosts"].append(host)
        for cid, c in (src.get("chats") or {}).items():
            if account and account not in c.get("accounts", []):
                continue
            chats.append(dict(c, id=cid, host=host, key=host + "|" + cid))
    # A turn, prompt or limit two transcripts both have (a fork's copy, a
    # chat written to two folders for a while) counts once, in the first
    chats.sort(key=lambda c: c["key"])
    seen = set()
    for c in chats:
        c["turns"] = [t for t in c["turns"] if first_time(seen, (c["host"], "turn", t[1], t[2]))]
        c["prompts"] = [p for p in c["prompts"] if first_time(seen, (c["host"], "prompt", p))]
        c["limits"] = [p for p in c["limits"] if first_time(seen, (c["host"], "limit", p))]

    def period(lo, hi, full):
        """The numbers of [lo, hi): full = with the timeline and the lists."""
        stretches, waits, handovers, answers, turns, limits = [], [], [], [], 0, []
        worked = {}
        longest = None
        near = lo - IDLE_MS  # (what came just before still joins your time at the start)
        for c in chats:
            for s, e, work, gaps in c["turns"]:
                if e < near or s >= hi:
                    continue
                parts = minus([s, e], gaps)
                length = sum(b - a for a, b in parts) or 1
                inside = sum(max(0, min(b, hi) - max(a, lo)) for a, b in parts)
                worked[c["key"]] = worked.get(c["key"], 0) + (work * inside / length if parts else 0)
                stretches += [[a, b, c["key"], work / length] for a, b in parts]
                for f, t, kind in gaps:
                    if kind == "y":
                        waits.append([f, t])
                        handovers.append(f)
                        answers.append(t)
                handovers.append(e)
                if lo <= e < hi:
                    turns += 1
                    if longest is None or work > longest["workedMs"]:
                        longest = {"workedMs": int(work), "startedAt": s, "name": chat_label(c), "host": c["host"]}
            limits += [(",".join(c["accounts"]) or c["key"], t) for t in c["limits"] if lo <= t < hi]
        prompts = [p for c in chats for p in c["prompts"] if near <= p < hi]
        yours = clipped(your_time(prompts + answers, handovers), lo, hi)
        own_prompts = sum(1 for p in prompts if p >= lo)
        cost, tokens = 0.0, dict.fromkeys(USAGE_KEYS, 0)
        for c in chats:
            for h, agg in c["hours"].items():
                if lo <= int(h) * HOUR_MS < hi:
                    for key, t in agg["t"].items():
                        cost += request_cost(key, t)
                        for i, name in enumerate(USAGE_KEYS):
                            tokens[name] += t[i]
        out = {"youMs": int(covered(yours)), "workedMs": int(sum(worked.values())),
               "busyMs": int(covered([s[:2] for s in clipped(stretches, lo, hi)])),
               "waitMs": int(covered(clipped(waits, lo, hi))), "prompts": own_prompts, "cost": round(cost, 4)}
        if not full:
            return out
        out.update(turns=turns, limits=limit_episodes(limits), tokens=tokens, longestTurn=longest,
                   chats=sum(1 for c in chats if worked.get(c["key"]) or any(lo <= p < hi for p in c["prompts"])
                             or any(lo <= int(h) * HOUR_MS < hi for h in c["hours"])))
        return out, {"stretches": stretches, "waits": waits, "yours": yours, "worked": worked}

    total, parts = period(w0, w1, True)
    previous = period(p0, w0, False)
    running = at_once([s[:3] for s in clipped(parts["stretches"], w0, w1)])
    total["peakAtOnce"] = max((n for _, _, n in running), default=0)

    # The timeline, a day per row
    day_rows = []
    for i, (day, ds, de) in enumerate(days):
        if ds >= now_ms:
            break
        de = min(de, now_ms) if i == len(days) - 1 else de
        work = [[s, e, n] for s, e, n in clipped(running, ds, de)]
        row = {"day": day, "start": ds, "end": days[i][2],
               "you": [s[:2] for s in merged(clipped(parts["yours"], ds, de), JOIN_MS)],
               "work": join_running(work),
               # (only while no chat worked: then Claude was idle, waiting for you)
               "wait": [w for span in merged(clipped(parts["waits"], ds, de), JOIN_MS) for w in minus(span, work)]}
        row["youMs"] = int(overlap(parts["yours"], ds, de))
        row["busyMs"] = int(overlap(work, ds, de))
        row["workedMs"] = int(sum(w * max(0, min(b, de) - max(a, ds)) for a, b, _, w in parts["stretches"]))
        row["waitMs"] = int(covered(clipped(parts["waits"], ds, de)))
        row["prompts"] = sum(1 for c in chats for p in c["prompts"] if ds <= p < de)
        row["cost"] = round(sum(request_cost(k, t) for c in chats for h, a in c["hours"].items()
                                if ds <= int(h) * HOUR_MS < de for k, t in a["t"].items()), 4)
        day_rows.append(row)
    total["busiestDay"] = max(day_rows, key=lambda r: r["workedMs"])["day"] if any(r["workedMs"] for r in day_rows) else None

    # Where it went: folders, chats, models
    folders, models, guessed, saved = {}, {}, set(), 0.0
    chat_rows = []
    for c in chats:
        cost = 0.0
        for h, agg in c["hours"].items():
            if w0 <= int(h) * HOUR_MS < w1:
                for key, t in agg["t"].items():
                    cost += request_cost(key, t)
                    saved += cache_saving(key, t)
                    model = key.partition("|")[0]
                    label = (cs.model_label(model) or model) + (" (fast)" if "f" in key.partition("|")[2] else "")
                    m = models.setdefault(label, {"model": label, "cost": 0.0, "tokens": 0, "requests": 0})
                    m["cost"] += request_cost(key, t)
                    m["tokens"] += sum(t[:5])
                    m["requests"] += t[6]
                    if prices_of(key)[1]:
                        guessed.add(label)
        work = parts["worked"].get(c["key"], 0)
        prompts = sum(1 for p in c["prompts"] if w0 <= p < w1)
        if work < 60_000 and cost < 0.01:
            continue  # (nothing worth a line)
        folder = c.get("project") or c["folder"] or ""
        fkey = c["host"] + "|" + folder
        f = folders.setdefault(fkey, {"name": ("~" if cs.short_path(folder, home) == "~" else os.path.basename(folder.rstrip("/")))
                                      or folder or "?", "path": cs.short_path(folder, home) if not c["host"] else folder,
                                      "host": c["host"], "workedMs": 0, "cost": 0.0, "prompts": 0, "chats": 0})
        f["workedMs"] += work
        f["cost"] += cost
        f["prompts"] += prompts
        f["chats"] += 1
        chat_rows.append({"name": chat_label(c) or c["id"][:8], "chatId": c["id"], "host": c["host"],
                          "profileDir": c["profiles"][0] if c["profiles"] else "", "folder": f["path"], "cwd": c["folder"],
                          "workedMs": int(work), "cost": round(cost, 4), "prompts": prompts})
    for f in folders.values():
        f["workedMs"] = int(f["workedMs"])
        f["cost"] = round(f["cost"], 4)
    for m in models.values():
        m["cost"] = round(m["cost"], 4)
        m["share"] = round(m["cost"] / total["cost"], 4) if total["cost"] else 0

    return {
        "ok": True,
        "generatedAt": now_ms,
        "back": back,
        "backMax": BACK_MAX,
        "account": account or "",
        "accounts": sorted(accounts.values(), key=lambda a: a["name"]),
        "from": days[0][0],
        "to": days[-1][0],
        "days": day_rows,
        "sum": total,
        "previous": previous,
        "projects": sorted(folders.values(), key=lambda f: (-f["workedMs"], -f["cost"]))[:TOP_PROJECTS],
        "chats": sorted(chat_rows, key=lambda r: (-r["workedMs"], -r["cost"]))[:TOP_CHATS],
        "models": sorted(models.values(), key=lambda m: -m["cost"]),
        "cacheSaved": round(saved, 2),
        "tips": tips(chats, w0, w1, total, parts["waits"]),
        "prices": {"asOf": PRICES_AS_OF, "guessed": sorted(guessed)},
        "sources": [{"host": s.get("host") or "", "ok": s.get("ok", True), "error": s.get("error") or ""}
                    for s in sources],
    }


def limit_episodes(hits):
    """How many times hits [(account, ms)] of usage limits stopped you: the
    chats hitting one limit, and their tries again, are one time."""
    n, last = 0, {}
    for account, t in sorted(hits, key=lambda h: h[1]):
        if account not in last or t - last[account] > LIMIT_EPISODE_MS:
            n += 1
        last[account] = t
    return n


def join_running(work):
    """The timeline's working stretches, joined where the same number of
    chats goes on within JOIN_MS of each other."""
    out = []
    for s, e, n in work:
        if out and out[-1][2] == n and s - out[-1][1] <= JOIN_MS:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e, n])
    return out


# ---------------------------------------------------------------- tips


def tips(chats, w0, w1, total, waits):
    """What would use less of your plan, from the week's usage: Claude Code's
    /usage behaviors (each with its share of the usage, from USAGE_TIP_PCT),
    then how long Claude waited for you and the usage limits you hit."""
    weight, sums = 0.0, [0.0] * W_SIZE
    heavy = long_running = 0.0
    heavy_n = long_n = 0
    buckets, attrs, big = {}, {}, {}
    starts = []
    for c in chats:
        mine, hours = [0.0] * W_SIZE, set()
        for h, agg in c["hours"].items():
            hm = int(h) * HOUR_MS
            if not (w0 <= hm < w1):
                continue
            for i, v in enumerate(agg["w"][:W_SIZE]):
                mine[i] += v
            if agg["w"][W_ALL]:
                hours.add(h)
            for b, v in agg["b"].items():
                buckets.setdefault(int(h) * 12 + int(b), {})[c["key"]] = v
            for k, v in agg["a"].items():
                attrs[k] = attrs.get(k, 0) + v
            for k, (n, size) in agg["g"].items():
                g = big.setdefault(k, [0, 0])
                g[0] += n
                g[1] = max(g[1], size)
        if not mine[W_ALL]:
            continue
        weight += mine[W_ALL]
        sums = [a + b for a, b in zip(sums, mine)]
        if mine[N_SUB] >= USAGE_SUBAGENT_REQUESTS or mine[W_SUB] / mine[W_ALL] > USAGE_SUBAGENT_SHARE:
            heavy += mine[W_ALL]
            heavy_n += 1
        if len(hours) >= USAGE_LONG_HOURS:
            long_running += mine[W_ALL]
            long_n += 1
        if c.get("startTokens"):
            starts.append(c["startTokens"])
    out = []
    if weight > 0:
        parallel, peak = 0.0, 0
        for chats_then in buckets.values():
            peak = max(peak, len(chats_then))
            if len(chats_then) >= USAGE_PARALLEL:
                parallel += sum(chats_then.values())

        def tip(key, w, title, detail, command=""):
            pct = 100 * w / weight
            if pct >= USAGE_TIP_PCT:
                out.append({"key": key, "pct": round(pct), "title": title, "detail": detail, "command": command})

        tip("max_effort", sums[W_MAX], "Save max effort for hard tasks",
            "{}% of your usage ran at max effort".format(round(100 * sums[W_MAX] / weight)), "/effort xhigh")
        tip("workflow", sums[W_FLOW], "Save workflows for big tasks",
            "{}% of your usage was workflow agents".format(round(100 * sums[W_FLOW] / weight)))
        biggest_start = max(starts) if starts else 0
        tip("always_on_context", sums[W_ON], "See what fills your context",
            "chats start with up to {} tokens before your first prompt".format(short_count(biggest_start))
            if biggest_start else "", "/context")
        tip("large_tool_results", sums[W_BIG], *big_result_tip(big))
        tip("cache_miss", sums[W_MISS], "Compact before you step away",
            "{} requests sent over 100k tokens the cache had let go".format(int(sums[N_MISS])), "/compact")
        tip("long_context", sums[W_LONG], "Start fresh when you switch tasks",
            "{} requests carried over 150k tokens of context".format(int(sums[N_LONG])), "/clear")
        tip("subagent_heavy", heavy, "Give simple subagents a cheaper model",
            "subagents did most of the work in {} chats".format(heavy_n))
        tip("high_parallel", parallel, "Run fewer chats at once", "up to {} at once".format(peak))
        tip("long_running", long_running, "Stop chats you no longer need",
            "{} ran for 8 hours or more".format(long_n))
        if not any(t["key"] == "subagent_heavy" for t in out):
            agent = top_attribution(attrs, "agent:")
            if agent:
                tip("agent", agent[1], 'Give "{}" subagents a cheaper model'.format(agent[0]),
                    "{}% of your usage".format(round(100 * agent[1] / weight)))
        skill = top_attribution(attrs, "skill:")
        if skill:
            tip("skill", skill[1], "Run /{} on a cheaper model".format(skill[0]),
                "{}% of your usage".format(round(100 * skill[1] / weight)))
        for prefix, key, title in (("plugin:", "plugin", 'Review the "{}" plugin'),
                                   ("mcp:", "mcp_server", "Turn off {} when you don't need it")):
            found = top_attribution(attrs, prefix)
            if found:
                tip(key, found[1], title.format(found[0]), "{}% of your usage".format(round(100 * found[1] / weight)))
        out.sort(key=lambda t: -t["pct"])
        del out[TIPS_SHOWN:]
    waited = covered(clipped(waits, w0, w1))
    if waited >= WAIT_TIP_MS:
        n = sum(1 for f, t in waits if w0 <= f < w1)
        out.append({"key": "waits", "pct": None, "title": "Let Claude go on without asking",
                    "detail": "it waited {} for your answers, {} times · auto mode, or allow what you always allow"
                              .format(cs.spoken_duration(waited), n), "command": "/permissions"})
    if total.get("limits", 0) >= LIMIT_TIP:
        out.append({"key": "limits", "pct": None, "title": "Let chats go on after a usage limit",
                    "detail": "chats hit a usage limit {} times · Keep going after usage limits, or Go on at…"
                              .format(total["limits"]), "command": ""})
    return out


def top_attribution(attrs, prefix):
    found = [(k[len(prefix):], v) for k, v in attrs.items() if k.startswith(prefix)]
    return max(found, key=lambda kv: kv[1]) if found else None


def big_result_tip(big):
    """(title, detail, command) about the largest tool results, by what made them."""
    if not big:
        return "Ask for narrower reads and searches", "some results were over 10k tokens", ""
    (key, (n, size)) = max(big.items(), key=lambda kv: kv[1][0] * kv[1][1])
    tool, _, what = key.partition("|")
    detail = "up to {} tokens{}".format(short_count(size), ", {} times".format(n) if n > 1 else "")
    if tool == "Read" and what:
        return "Read {} in parts".format(os.path.basename(what)), detail, ""
    if tool == "Bash" and what:
        return 'Shorten the output of "{}"'.format(what), detail, ""
    if tool.startswith("mcp__"):
        return "Ask {} for smaller results".format(tool.split("__")[1] if tool.count("__") >= 2 else tool), detail, ""
    return "Ask {} for less".format(tool), detail, ""


def short_count(n):
    return "{}k".format(round(n / 1000)) if n >= 1000 else str(int(n))


# ---------------------------------------------------------------- SSH hosts


def host_chats(host, back):
    """A host's chats of the days asked for (this file run there), as a source."""
    import remote
    answer = remote.host_answer(host, ["--data", "--back", str(back)], name="week.py")
    if not answer.get("ok"):
        return {"host": host, "ok": False, "error": answer.get("message") or answer.get("error") or "no answer",
                "chats": {}, "accounts": []}
    shift = int(time.time() * 1000) - int(cs.number(answer.get("now")) or 0)
    chats = answer.get("chats") if isinstance(answer.get("chats"), dict) else {}
    if abs(shift) > 5000:  # its clock differs from this one's
        for c in chats.values():
            c["turns"] = [[s + shift, e + shift, w, [[f + shift, t + shift, k] for f, t, k in g]]
                          for s, e, w, g in c.get("turns", [])]
            c["prompts"] = [p + shift for p in c.get("prompts", [])]
            c["limits"] = [p + shift for p in c.get("limits", [])]
    return {"host": host, "ok": True, "chats": chats, "accounts": answer.get("accounts") or []}


def main(argv=None):
    args = sys.argv[1:] if argv is None else list(argv)
    back, account, hosts, config_dirs = 0, "", [], []
    pretty = remote = data = False
    while args:
        arg = args.pop(0)
        if arg == "--back" and args and args[0].isdigit():
            back = min(BACK_MAX, int(args.pop(0)))
        elif arg == "--account" and args:
            account = args.pop(0)
        elif arg == "--host" and args:
            hosts.append(args.pop(0))
        elif arg == "--config-dir" and args:
            config_dirs.append(args.pop(0))
        elif arg == "--pretty":
            pretty = True
        elif arg == "--remote":
            remote = True
        elif arg == "--data":
            data = True
        else:
            sys.exit(__doc__)
    os.umask(0o077)  # cache files are private to the user
    home = Path.home()
    now_ms = int(time.time() * 1000)
    try:
        profiles = cs.discover_profiles(home, config_dirs)
        cache = updated_cache(cs.cache_dir(home), profiles, now_ms)
        days = week_days(back, now_ms)
        since = midnight(date.fromisoformat(days[0][0]) - timedelta(days=7))
        chats = chats_between(cache, profiles, since, days[-1][2], home)
        _, accounts = account_ids(profiles)
        if data:  # ("now" as it answers: the computer asking sets this one's clock against its own)
            result = {"ok": True, "now": int(time.time() * 1000), "chats": chats, "accounts": accounts,
                      "host": os.uname().nodename}
        else:
            sources = [{"host": "", "chats": chats, "accounts": accounts}]
            if hosts:
                from concurrent.futures import ThreadPoolExecutor
                with ThreadPoolExecutor(max_workers=min(8, len(hosts))) as pool:
                    sources += list(pool.map(lambda h: host_chats(h, back), hosts))
            result = recap(sources, back, account, now_ms, home)
    except Exception as exc:  # the widget must always get parseable output
        result = {"ok": False, "error": "{}: {}".format(type(exc).__name__, exc), "generatedAt": now_ms}
    text = json.dumps(result, indent=2 if pretty and not remote else None)
    if remote:
        sys.stdout.write("\n" + cs.REMOTE_MARK + " ")
    sys.stdout.write(text + "\n")


if __name__ == "__main__":
    main()
