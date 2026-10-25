// The chat tab and what rows and notifications do with it: a click on a
// chat opens its tab; answers and replies go to pane.py with what the
// extension's own state says (the chat's request, its process), never with
// what the page claims; to-review and the tests badge; Claude's Markdown made
// into elements only (no link that runs anything).

import assert from "node:assert/strict";
import { test } from "node:test";
import * as vscode from "vscode";
import { ChatPanes } from "../src/chatPane";
import { demoState } from "../src/shared/demo";
import { chatRefOf } from "../src/shared/model";
import { queuedReply, reviewPending, routeHint, testsText } from "../src/shared/pane";
import type { ViewState } from "../src/shared/types";
import { ViewHost } from "../src/view";
import { clipboardWrites, overrides } from "./vscode-stub";
import { inline } from "../webview/util/markdown";

const NOW = 1_800_000_000_000;

function waitingState(answer: "hook" | "keys" | ""): ViewState {
  const state = demoState(NOW);
  const s = state.status!.groups.flatMap((g) => g.sessions).find((x) => x.state === "waiting")!;
  s.permission = { tool: "Bash", line: "Bash: git tag v2.0.0", command: "git tag v2.0.0", file: "", diff: [], always: "Bash(git tag:*)",
                   request: answer === "hook" ? "1792957203525-37d298fb" : null, answer };
  return state;
}

// (without the --config-dir of the folders this test runs with)
const own = (args: string[]) => (args.includes("--config-dir") ? args.slice(0, args.indexOf("--config-dir")) : args);

function panes(state: ViewState, answers: Record<string, unknown> = {}) {
  const calls: string[][] = [];
  const backend = { pane: async (args: string[]) => (calls.push(own(args)), { ok: true, message: "Allowed", ...answers }) };
  const dash = { state: () => state, refresh: async () => undefined, pollHost: async () => undefined, setActionError() {}, setActionInfo() {} };
  const opened: unknown[] = [];
  const actions = { open: async (c: unknown) => void opened.push(c), unqueue: async () => undefined };
  const terminals = { find: async () => undefined };
  const p = new ChatPanes(vscode.Uri.file("/ext") as never, backend as never, dash as never, actions as never, terminals as never, {} as never);
  return { p, calls, opened };
}

test("an answer goes to the hook's request the state names, else to the chat's keys in tmux", async () => {
  const state = waitingState("hook");
  const row = state.status!.groups.flatMap((g) => g.sessions).find((x) => x.state === "waiting")!;
  const { p, calls } = panes(state);
  assert.deepEqual(await p.answer(chatRefOf(row), "deny", " use make "), { ok: true, message: "Allowed" });
  assert.deepEqual(calls[0], ["--answer", "1792957203525-37d298fb", "--decision", "deny", "--note", "use make"]);

  const keys = waitingState("keys");
  const row2 = keys.status!.groups.flatMap((g) => g.sessions).find((x) => x.state === "waiting")!;
  const two = panes(keys);
  await two.p.answer(chatRefOf(row2), "always");
  assert.deepEqual(two.calls[0], ["--keys", row2.sessionId, "--profile", row2.profileDir, "--decision", "always"]);
});

test("nothing is answered for a chat that doesn't ask, or that only its own dialog can answer", async () => {
  const state = waitingState("");
  const rows = state.status!.groups.flatMap((g) => g.sessions);
  const { p, calls } = panes(state);
  assert.equal((await p.answer(chatRefOf(rows.find((x) => x.state === "waiting")!), "allow")).ok, false);
  assert.equal((await p.answer(chatRefOf(rows.find((x) => x.state !== "waiting")!), "allow")).ok, false);
  assert.deepEqual(calls, []);
});

test("a reply goes to pane.py --send; copy goes to the clipboard and opens the chat; a Claude Code tab gets its link", async () => {
  const state = demoState(NOW);
  const row = state.status!.groups.flatMap((g) => g.sessions)[0];
  const { p, calls, opened } = panes(state);
  assert.equal((await p.send(chatRefOf(row), "  and the docs  ", "auto", false)).ok, true);
  assert.deepEqual(calls[0].slice(0, 6), ["--send", row.chatId, "--text", "and the docs", "--how", "auto"]);
  assert.ok(calls[0].includes("--session"));
  await p.send(chatRefOf(row), "later on", "background", true);
  assert.deepEqual(calls[1].slice(calls[1].indexOf("--after-turn"), calls[1].indexOf("--after-turn") + 3), ["--after-turn", "--name", row.name]);
  await p.send(chatRefOf(row), "copy me", "copy", false);
  assert.equal(clipboardWrites.at(-1), "copy me");
  assert.equal(opened.length, 1);
  assert.equal(calls.length, 2);
  assert.equal((await p.send(chatRefOf(row), "   ", "auto", false)).ok, false);
  const ask = panes(state, { how: "ask" });
  assert.equal((await ask.p.send(chatRefOf(row), "hi", "auto", false)).ask, true);
});

test("a click on a chat opens its tab, unless clicks open the chat itself; answers use the extension's chat", () => {
  const state = waitingState("hook");
  const calls: { name: string; args: unknown[] }[] = [];
  const record = (name: string) => (...args: unknown[]) => void calls.push({ name, args });
  const actions = new Proxy({}, { get: (_t, name: string) => record(name) });
  const dash = { onState: () => ({ dispose() {} }), onPetEvent: () => ({ dispose() {} }), state: () => state, setVisible() {} };
  const host = new ViewHost(vscode.Uri.file("/ext") as never, dash as never, actions as never);
  host.panes = { open: record("panes.open"), answer: record("panes.answer") } as never;
  const receive = (m: unknown) => (host as unknown as { receive(w: unknown, m: unknown): void }).receive({ postMessage: async () => true }, m);
  const row = state.status!.groups.flatMap((g) => g.sessions).find((x) => x.state === "waiting")!;
  receive({ type: "open", chat: { key: row.key, sessionId: "forged", profileDir: "x", name: "x" } });
  assert.equal(calls[0].name, "panes.open");
  assert.equal((calls[0].args[0] as { sessionId: string }).sessionId, row.sessionId); // (the state's chat, not the page's)
  overrides.set("clickOpensPane", false);
  try {
    receive({ type: "open", chat: { key: row.key } });
    assert.equal(calls[1].name, "open");
  } finally {
    overrides.delete("clickOpensPane");
  }
  receive({ type: "answerPermission", chat: { key: row.key }, decision: "always", note: "" });
  assert.equal(calls[2].name, "panes.answer");
  assert.equal(calls[2].args[1], "always");
  receive({ type: "answerPermission", chat: { key: row.key }, decision: "rm -rf", note: "" });
  receive({ type: "openPane", chat: { key: "not-a-row" } });
  assert.equal(calls.length, 3);
});

test("to review: finished, changed files after the first look, not marked since (0: marked not reviewed)", () => {
  const status = { ...demoState(NOW).status!, reviewed: { a: NOW, "gpu|b": NOW, c: 0 }, reviewedSince: NOW - 10_000 };
  const item = (id: string, editedAt: number, state: "done" | "working" = "done") =>
    ({ sessionId: id, chatId: id, state, review: { editedAt, tests: null } });
  assert.equal(reviewPending(item("x", NOW - 5_000), status), true);
  assert.equal(reviewPending(item("x", NOW - 20_000), status), false); // (before the first look)
  assert.equal(reviewPending(item("x", NOW - 5_000, "working"), status), false);
  assert.equal(reviewPending(item("a", NOW - 1), status), false);
  assert.equal(reviewPending(item("a", NOW + 1), status), true); // (changed files again)
  assert.equal(reviewPending(item("b", NOW - 1), status, "gpu"), false);
  assert.equal(reviewPending(item("c", NOW - 20_000), status), true);
  assert.equal(reviewPending({ sessionId: "y", review: null }, status), false);
});

test("a chat waiting for a permission is told with its question, once more when the hook's request comes a poll late", async () => {
  const { TransitionTracker } = await import("../src/transitions");
  const t = new TransitionTracker();
  const opts = { notifyWaiting: true, notifyDone: true, notifyDoneMinSeconds: 0 };
  const g = demoState(NOW).status!.groups[0];
  const row = (state: "working" | "waiting", permission: unknown) => [{ ...g, sessions: [{ ...g.sessions[0], key: "k", chatId: "k", sessionId: "k", name: "k", state, permission } as never] }];
  t.track("", row("working", null), NOW, undefined, opts);
  const first = t.track("", row("waiting", null), NOW + 2000, undefined, opts);
  assert.deepEqual(first.notices.map((n) => n.title), ["k needs your input"]);
  const ask = { tool: "Bash", line: "Bash: make", command: "make deploy", file: "", diff: [], always: "", request: "1-a", answer: "hook" };
  const late = t.track("", row("waiting", ask), NOW + 4000, undefined, opts);
  assert.deepEqual(late.notices.map((n) => [n.title, n.body.split(" · ")[0]]), [["k asks for a permission", "make deploy"]]);
  assert.deepEqual(t.track("", row("waiting", ask), NOW + 6000, undefined, opts).notices, []); // (told once)
});

test("the tests badge, a queued reply and how a reply goes", () => {
  assert.equal(testsText({ editedAt: 1, tests: null })!.text, "not tested");
  assert.equal(testsText({ editedAt: 1, tests: { command: "npm test", ok: true, at: 2 } })!.text, "tests ✓");
  assert.equal(testsText({ editedAt: 1, tests: { command: "npm test", ok: false, at: 2 } })!.ok, false);
  assert.equal(testsText(null), null);
  const status = { ...demoState(NOW).status!, queue: [{ id: "q1", afterTurn: true, chat: "c1", host: "" } as never] };
  assert.equal(queuedReply(status, "c1")?.id, "q1");
  assert.equal(queuedReply(status, "c1", "gpu"), null);
  assert.match(routeHint("terminal", true, "interactive", ""), /takes no text from outside/);
  assert.match(routeHint("tmux", true, "interactive", "gpu"), /tmux pane\. \(on gpu\)/);
});

test("every file a page loads from dist/ is packaged (.vscodeignore names each one)", async () => {
  const fs = await import("node:fs");
  const shipped = fs.readFileSync(".vscodeignore", "utf8").split("\n").filter((l) => l.startsWith("!dist/")).map((l) => l.slice(6).trim());
  const loaded = new Set<string>();
  for (const f of fs.readdirSync("src").filter((n) => n.endsWith(".ts")))
    for (const m of fs.readFileSync(`src/${f}`, "utf8").matchAll(/asset\("dist", "([^"]+)"\)/g)) loaded.add(m[1]);
  assert.ok(loaded.has("chat.js") && loaded.has("webview.js"), [...loaded].join(", "));
  for (const name of loaded) assert.ok(shipped.includes(name), `${name} isn't in .vscodeignore`);
});

test("Claude's Markdown: links only to the web or mail; the rest stays text", () => {
  const out = inline("see **[the docs](https://example.org/x)** and [this](javascript:alert(1)) and `rm -rf /`");
  const flat = (nodes: unknown[]): { type: unknown; href?: string }[] =>
    nodes.flatMap((n) => {
      if (!n || typeof n !== "object") return [];
      const v = n as { type: unknown; props: { href?: string; children?: unknown } };
      const kids = Array.isArray(v.props.children) ? v.props.children : [v.props.children];
      return [{ type: v.type, href: v.props.href }, ...flat(kids)];
    });
  const nodes = flat(out);
  assert.deepEqual(nodes.filter((n) => n.type === "a").map((n) => n.href), ["https://example.org/x"]);
  assert.ok(nodes.some((n) => n.type === "span")); // (the javascript: link, as text)
  assert.ok(nodes.some((n) => n.type === "code"));
  assert.ok(nodes.some((n) => n.type === "strong"));
});
