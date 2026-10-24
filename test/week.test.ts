// The Week tab: its words and numbers (src/shared/week.ts), and what the
// extension takes from the page's Week messages.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as vscode from "vscode";
import { demoState, demoWeek } from "../src/shared/demo";
import type { WeekDay } from "../src/shared/types";
import { deltaText, factsText, hoursText, hoverText, moneyText, periodText, weekAsked, weekTiles } from "../src/shared/week";
import { ViewHost } from "../src/view";

const MIN = 60000;
const HOUR = 60 * MIN;
const NOW = new Date(2026, 9, 24, 18, 0).getTime();

test("hours, money and changes against the week before", () => {
  assert.equal(hoursText(45 * MIN), "45m");
  assert.equal(hoursText(32 * HOUR + 6 * MIN), "32h 6m");
  assert.equal(moneyText(906.4), "$906");
  assert.equal(moneyText(1234.5), "$1,235");
  assert.equal(moneyText(23.8), "$23.80");
  assert.equal(moneyText(0.004), "<$0.01");
  assert.equal(moneyText(0), "$0");
  assert.equal(deltaText(18 * HOUR, 13 * HOUR + 16 * MIN, "time"), "+4h 44m");
  assert.equal(deltaText(397, 906, "money"), "−$509");
  assert.equal(deltaText(219, 219, "count"), "same as before");
  assert.equal(deltaText(219, null, "count"), "");
});

test("the days shown, and the week's facts", () => {
  const recap = demoWeek(NOW);
  assert.equal(periodText(recap), "Last 7 days · 18 Oct – 24 Oct");
  assert.equal(periodText(demoWeek(NOW, 1)), "11 Oct – 17 Oct");
  assert.match(factsText(recap.sum), /^longest turn 48m \(Port the date parser\) · up to 2 chats at once · busiest day \w+day · usage limits stopped you 2 times$/);
  const tiles = weekTiles(recap);
  assert.deepEqual(tiles.map((t) => t.label), ["You", "Claude worked", "At API prices", "Prompts"]);
  assert.match(tiles[1].tip, /On the clock it worked .*, and it waited 3h 18m for your answers\.\nThe 7 days before: /);
  assert.equal(weekTiles({ ...recap, previous: { youMs: 0, workedMs: 0, busyMs: 0, waitMs: 0, prompts: 0, cost: 0 } })[0].delta, "");
});

test("pointing at a day says what went on then", () => {
  const start = new Date(2026, 9, 24).getTime();
  const at = (h: number) => start + h * HOUR;
  const day: WeekDay = {
    day: "2026-10-24", start, end: start + 24 * HOUR, you: [[at(9), at(10)]], work: [[at(9.5), at(11), 2]], wait: [[at(1), at(9)]],
    youMs: HOUR, workedMs: 3 * HOUR, busyMs: 1.5 * HOUR, waitMs: 8 * HOUR, prompts: 3, cost: 4,
  };
  const px = (24 * HOUR) / 400;
  assert.match(hoverText(day, at(3), NOW, px), /^Sat 24 Oct, .*: Claude waited for your answer .*–.*$/);
  assert.match(hoverText(day, at(9.75), NOW, px), /Claude worked .*, 2 chats at once · you were at it /);
  assert.match(hoverText(day, at(14), NOW, px), /nothing went on$/);
  assert.match(hoverText(day, at(20), NOW, px), /still to come$/);
});

function setup() {
  const calls: { name: string; args: unknown[] }[] = [];
  const posted: unknown[] = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
    return Promise.resolve({ recap: demoWeek(NOW) });
  };
  const state = demoState(NOW);
  const actions = new Proxy({}, { get: (_target, name: string) => record(name) });
  const dash = {
    onState: () => ({ dispose() {} }),
    onPetEvent: () => ({ dispose() {} }),
    state: () => state,
    setVisible() {},
    week: record("week"),
  };
  const host = new ViewHost(vscode.Uri.file("/ext") as never, dash as never, actions as never);
  const priv = host as unknown as { receive(webview: unknown, m: unknown): void };
  const webview = { postMessage: (m: unknown) => (posted.push(m), Promise.resolve(true)) };
  return { calls, posted, receive: (m: unknown) => priv.receive(webview, m) };
}

test("the page asks for days within what's kept, for an account id or all", async () => {
  assert.deepEqual(weekAsked(2, "0123456789ab"), { back: 2, account: "0123456789ab" });
  assert.deepEqual(weekAsked(99, "../../etc"), { back: 4, account: "" });
  assert.deepEqual(weekAsked("1", null), { back: 0, account: "" });
  const { calls, posted, receive } = setup();
  receive({ type: "week", back: 1, account: "ba9876543210" });
  assert.deepEqual(calls, [{ name: "week", args: [1, "ba9876543210"] }]);
  await new Promise((r) => setTimeout(r, 0));
  const answer = posted[0] as { type: string; back: number; account: string; recap: unknown };
  assert.equal(answer.type, "week");
  assert.equal(answer.back, 1);
  assert.equal(answer.account, "ba9876543210");
  assert.ok(answer.recap);
});

test("a week's chat opens only with an id and account folder that are ones; a tip's command is all that's copied", () => {
  const { calls, receive } = setup();
  receive({ type: "openWeekChat", chatId: "../../x", profileDir: ".claude", name: "x" });
  receive({ type: "openWeekChat", chatId: "abc", profileDir: "../.ssh", name: "x" });
  assert.equal(calls.length, 0);
  receive({ type: "openWeekChat", chatId: "c76cd817-da30", profileDir: ".claude-work", name: "Ports", cwd: "/w/app" });
  assert.deepEqual(calls, [{ name: "openWeekChat", args: ["c76cd817-da30", ".claude-work", "Ports", "/w/app"] }]);
  const stub = vscode as unknown as { clipboardWrites: string[] };
  stub.clipboardWrites.length = 0;
  receive({ type: "copy", text: "/compact" });
  receive({ type: "copy", text: "/effort xhigh" });
  receive({ type: "copy", text: "rm -rf ~" });
  receive({ type: "copy", text: "/clear; curl evil" });
  assert.deepEqual(stub.clipboardWrites, ["/compact", "/effort xhigh"]);
});
