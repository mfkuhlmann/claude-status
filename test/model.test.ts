import assert from "node:assert/strict";
import { test } from "node:test";
import { demoState } from "../src/shared/demo";
import {
  allGroups,
  countStates,
  duration,
  formatTokens,
  headlineText,
  heroMood,
  overallState,
  panelWindow,
  petKeyOf,
  resetText,
  shellQuote,
  stateText,
  summaryText,
} from "../src/shared/model";

const NOW = 1_800_000_000_000;

test("hosts' accounts come after this computer's, marked with their host", () => {
  const s = demoState(NOW);
  const groups = allGroups(s.status, s.hosts);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].host, undefined);
  assert.equal(groups[1].host, "build-server");
});

test("counts, overall state, headline and mood follow the most urgent chat", () => {
  const s = demoState(NOW);
  const groups = allGroups(s.status, s.hosts);
  const counts = countStates(groups);
  assert.deepEqual(counts, { waiting: 1, working: 2, idle: 0, done: 1 });
  assert.equal(overallState(groups, counts), "waiting");
  assert.equal(headlineText(s, counts), "1 chat needs you");
  assert.equal(heroMood(s, "waiting", groups), "waving");
  assert.equal(heroMood(s, "working", groups), "working-juggling"); // a demo chat runs subagents
  assert.equal(summaryText(counts), "1 needs input · 2 working · 1 done");
  assert.equal(heroMood({ status: null, errorText: "" }, "none", []), "loading");
  assert.equal(heroMood({ status: null, errorText: "broken" }, "none", []), "error");
});

test("finished jobs without a process don't count as running", () => {
  const s = demoState(NOW);
  const g = { ...s.status!.groups[0], sessions: s.status!.groups[0].sessions.filter((x) => x.state === "done") };
  const counts = countStates([g]);
  assert.equal(overallState([g], counts), "none");
  assert.equal(headlineText(s, counts), "1 finished chat to look at");
});

test("the status bar shows the 5-hour usage of the account with an active chat", () => {
  const s = demoState(NOW);
  const best = panelWindow(allGroups(s.status, s.hosts));
  assert.equal(best?.window.key, "five_hour");
  assert.equal(best?.group.id, "demo-personal"); // active, and fresher than the host's
});

test("shellQuote quotes like Python's shlex.quote", () => {
  assert.equal(shellQuote(""), "''");
  assert.equal(shellQuote("/home/alice/projects"), "/home/alice/projects");
  assert.equal(shellQuote("a b"), "'a b'");
  assert.equal(shellQuote("it's"), "'it'\"'\"'s'");
});

test("formatting", () => {
  assert.equal(duration(59 * 60000), "59m");
  assert.equal(duration(61 * 60000), "1h 1m");
  assert.equal(duration(25 * 3600000), "1d 1h");
  assert.equal(formatTokens(1500), "1.5k");
  assert.equal(formatTokens(2_500_000), "2.5M");
  assert.equal(stateText({ state: "done", reason: "failed", since: NOW - 120000 }, NOW), "Failed · 2m");
  const window = { key: "five_hour", label: "5h", pct: 99, reset: false };
  assert.equal(resetText({ ...window, resetsAt: NOW + 30000 }, NOW), "resets in <1m", "the last minute doesn't read 0m");
  assert.equal(resetText({ ...window, resetsAt: NOW + 90 * 60000 }, NOW), "resets in 1h 30m");
  assert.equal(resetText({ ...window, resetsAt: null }, NOW), "");
  assert.equal(resetText({ ...window, resetsAt: NOW - 1000, reset: true }, NOW), "reset");
  assert.equal(petKeyOf({ chatId: "c", sessionId: "s", key: "k" }, "build-server"), "ssh:build-server|c");
});
