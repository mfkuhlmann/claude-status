// Chats that keep going after each usage limit (the backend looks after them:
// this computer's check asks it to, in the window that notifies), the usage
// cap, the time a limit resets on hover, and the model and effort new chats
// start with.

import assert from "node:assert/strict";
import { test } from "node:test";
import type * as vscode from "vscode";
import { chatOptionsText } from "../src/actions";
import type { Backend } from "../src/backend";
import { chatOptionArgs } from "../src/config";
import { Dashboard } from "../src/dashboard";
import type { Notifier } from "../src/notify";
import { demoState } from "../src/shared/demo";
import { keptChat, keptTitle, limitReset, resetAtText } from "../src/shared/model";
import type { Group, KeptChat } from "../src/shared/types";

const NOW = new Date(2026, 9, 24, 10, 0).getTime();

test("an account at the usage cap waits for that window, like one at its limit", () => {
  const g = { limits: { windows: [{ label: "5h", pct: 60, resetsAt: NOW + 3600_000 }] }, sessions: [], cap: null } as unknown as Group;
  assert.equal(limitReset(g, NOW), null);
  const capped = { ...g, cap: { pct: 50, label: "5h", key: "five_hour", resetsAt: NOW + 3600_000 } };
  assert.deepEqual(limitReset(capped, NOW), { at: NOW + 3600_000, label: "5h" });
});

test("hovering over “resets in …” says when, with the day when that isn't today", () => {
  const at = new Date(2026, 9, 24, 14, 20).getTime();
  assert.match(resetAtText(at, NOW), /^Resets at \d\d:\d\d$/);
  assert.match(resetAtText(at + 86_400_000, NOW), /^Resets tomorrow at \d\d:\d\d$/);
  assert.match(resetAtText(at + 3 * 86_400_000, NOW), /^Resets on .+ at \d\d:\d\d$/);
});

test("the chats that keep going: found by their id, and what their tag says", () => {
  const k: KeptChat = { chat: "c1", profile: ".claude-work", name: "Fix it", since: NOW, wentOnAt: null, tries: 0, note: "", error: "" };
  assert.equal(keptChat({ keep: [k] }, "c1"), k);
  assert.equal(keptChat({ keep: [k] }, "c2"), null);
  assert.equal(keptChat({}, "c1"), null, "an older backend lists none");
  assert.match(keptTitle(k), /goes on by itself in the background a minute after the limit resets/);
  assert.match(keptTitle({ ...k, error: "Gave up after 5 tries: it didn't go on" }), /Gave up after 5 tries/);
  assert.match(keptTitle({ ...k, note: "Its account's login has expired" }), /login has expired/);
});

test("new chats start with the model and effort picked: Opus and extra high to begin with", async () => {
  const { overrides } = await import("./vscode-stub");
  try {
    assert.deepEqual(chatOptionArgs(), ["--model", "opus", "--effort", "xhigh"]);
    overrides.set("newChatModel", "sonnet");
    overrides.set("newChatEffort", "");
    assert.deepEqual(chatOptionArgs(), ["--model", "sonnet"], "Claude's own default effort");
    assert.equal(chatOptionsText("sonnet", ""), "Sonnet · Claude's default effort");
    assert.equal(chatOptionsText("opus", "xhigh"), "Opus · Extra high effort");
  } finally {
    overrides.clear();
  }
});

test("this computer's check has the usage cap, and the window that notifies looks after the chats that keep going", async () => {
  const { overrides } = await import("./vscode-stub");
  const calls: string[][] = [];
  const backend = { status: async (args: string[]) => (calls.push(args), { status: demoState(NOW).status! }) } as unknown as Backend;
  let leader = true;
  const notifier = { handle() {}, isLeader: () => leader } as unknown as Notifier;
  const log = { warn() {}, info() {}, error() {} } as unknown as vscode.LogOutputChannel;
  const dash = new Dashboard(backend, notifier, log);
  try {
    await dash.refresh();
    assert.ok(calls[0].includes("--keep-going"));
    assert.ok(!calls[0].includes("--usage-cap"), "no cap: none asked for");
    overrides.set("usageCap", 90);
    leader = false;
    await dash.refresh();
    const args = calls[1];
    assert.deepEqual(args.slice(args.indexOf("--usage-cap"), args.indexOf("--usage-cap") + 2), ["--usage-cap", "90"]);
    assert.ok(!args.includes("--keep-going"), "another window does it");
  } finally {
    overrides.clear();
    dash.dispose();
  }
});
