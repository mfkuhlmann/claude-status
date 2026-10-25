// Feeds the chat tab's page made-up data, the way src/chatPane.ts would: the
// chat, its conversation, and its review when the page asks for it.

import "../webview/chat";
import type { PaneChat, PaneHostMessage, PaneItem, ReviewAnswer } from "../src/shared/pane";

const params = new URLSearchParams(location.search);
const now = Date.now();
const ask = params.get("ask");

function send(message: PaneHostMessage): void {
  window.postMessage(message, "*");
}

const chat: PaneChat = {
  host: "",
  chatId: "demo-chat",
  sessionId: "demo-chat",
  profileDir: ".claude",
  name: "Fix the date parser",
  cwd: "/home/alice/projects/webapp",
  state: ask ? "waiting" : "working",
  stateText: ask ? "Needs input · 1m" : "Working · 6m",
  route: params.get("route") === "terminal" ? "terminal" : "tmux",
  busy: true,
  activity: "Bash: npm test -- parser",
  permission: ask
    ? {
        tool: "Edit",
        line: "Edit: src/parse.ts",
        command: "",
        file: "src/parse.ts",
        diff: ["@@ -12,3 +12,3 @@", "   const week = isoWeek(date);", "-  if (week > 52) return 1;", "+  if (week > weeksInYear(date)) return 1;", "   return week;"],
        always: ask === "hook" ? "Edit(src/**)" : "",
        request: ask === "hook" ? "1-abcdef01" : null,
        answer: ask === "none" ? "" : (ask as "hook" | "keys"),
      }
    : null,
  changes: 2,
  reviewPending: false,
  review: { editedAt: now - 60_000, tests: { command: "npm test -- parser", ok: true, at: now - 30_000 } },
  queued: params.get("queued") === "1" ? { id: "q1", prompt: "Then update the changelog.", error: "" } : null,
};

const items: PaneItem[] = [
  { kind: "you", key: "u1", text: "Week 53 dates come out as week 1. Find out why and fix it, with a test.", at: now - 400_000 },
  { kind: "claude", key: "m1", text: "I'll look at how **week numbers** are computed in `src/parse.ts` first.", at: now - 390_000 },
  { kind: "tool", key: "t1", name: "Read", line: "Read: parse.ts", status: "ok", input: "file_path: /home/alice/projects/webapp/src/parse.ts", output: "1\timport { isoWeek } from './dates';\n2\t…", at: now - 380_000 },
  { kind: "tool", key: "t2", name: "Bash", line: "Bash: npm test -- parser", status: "error", input: "$ npm test -- parser", output: "FAIL src/parse.test.ts\n  ✕ week 53 of 2026 (4 ms)", at: now - 300_000 },
  {
    kind: "claude",
    key: "m2",
    text: "Found it: `isoWeek` caps weeks at 52.\n\n## What changes\n\n1. Use `weeksInYear(date)` instead of `52`\n2. Add a test for 2026-12-31\n\n```ts\nif (week > weeksInYear(date)) return 1;\n```\n\nSee [the ISO week rules](https://en.wikipedia.org/wiki/ISO_week_date).",
    at: now - 200_000,
  },
  { kind: "tool", key: "t3", name: "Edit", line: "Edit: parse.ts", status: "ok", input: "/home/alice/projects/webapp/src/parse.ts\n-  if (week > 52) return 1;\n+  if (week > weeksInYear(date)) return 1;", output: "", at: now - 100_000 },
  { kind: "note", key: "n1", text: "Interrupted", at: now - 90_000 },
  { kind: "you", key: "u2", text: "Go on, and run the parser tests again.", at: now - 80_000 },
  { kind: "tool", key: "t4", name: "Bash", line: "Bash: npm test -- parser", status: "open", input: "$ npm test -- parser", output: "", at: now - 10_000 },
];

const review: ReviewAnswer = {
  ok: true,
  message: "Fix the date parser\n\nWeek 53 dates came out as week 1: isoWeek capped weeks at 52.",
  files: [
    { label: "src/parse.ts", path: "/home/alice/projects/webapp/src/parse.ts", added: 1, removed: 1, created: false, deleted: false, binary: false, unknown: false,
      diff: ["@@ -12,3 +12,3 @@", "   const week = isoWeek(date);", "-  if (week > 52) return 1;", "+  if (week > weeksInYear(date)) return 1;", "   return week;"] },
    { label: "src/parse.test.ts", path: "/home/alice/projects/webapp/src/parse.test.ts", added: 6, removed: 0, created: true, deleted: false, binary: false, unknown: false,
      diff: ["@@ -0,0 +1,6 @@", "+import { parse } from './parse';", "+", "+test('week 53 of 2026', () => {", "+  expect(parse('2026-12-31').week).toBe(53);", "+});", "+"] },
  ],
  tests: { command: "npm test -- parser", ok: true, at: now - 30_000 },
  editedAt: now - 60_000,
  repos: ["/home/alice/projects/webapp"],
};

// what the page sends, answered as the extension would
window.addEventListener("harness-post", (e: Event) => {
  const m = (e as CustomEvent).detail as { type: string };
  if (m.type === "ready") {
    send({ type: "chat", chat });
    send({ type: "conversation", answer: { ok: true, items, more: true, stamp: "1" } });
  } else if (m.type === "review") {
    send({ type: "review", answer: review, error: "" });
  }
});
