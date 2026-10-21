// Tasks waiting for the usage limit, chats changing the same files, and the
// widgets' link to a plan or a subagent's run in the Markdown preview.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { markdownLinkFile } from "../src/agentRun";
import { demoState } from "../src/shared/demo";
import { limitReset, overlapText, queuedFor } from "../src/shared/model";
import type { Group, QueuedTask, Session } from "../src/shared/types";
import { TransitionTracker } from "../src/transitions";

const NOW = 1_800_000_000_000;
const OPTS = { notifyWaiting: true, notifyDone: true, notifyDoneMinSeconds: 30 };

function group(pct: number, resetsAt: number, sessions: Session[] = []): Group {
  const g = demoState(NOW).status!.groups[0];
  return { ...g, sessions, limits: { updatedAt: NOW, windows: [{ key: "five_hour", label: "5h", pct, resetsAt, reset: false }] } };
}

test("a task can wait for the limit of an account that's at it", () => {
  assert.deepEqual(limitReset(group(100, NOW + 3600000), NOW), { at: NOW + 3600000, label: "5h" });
  assert.equal(limitReset(group(60, NOW + 3600000), NOW), null);
  assert.equal(limitReset(group(100, NOW - 1000), NOW), null); // reset already
  // no numbers, but a chat the limit stopped says when
  const s = { ...demoState(NOW).status!.groups[0].sessions[0], stopped: { kind: "limit" as const, window: "five_hour", text: "", at: NOW, resetsAt: NOW + 60000, over: false } };
  assert.equal(limitReset({ ...group(0, NOW + 1), limits: null, sessions: [s] }, NOW)!.at, NOW + 60000);
});

test("an account's queued tasks: on its machine, by its profiles", () => {
  const task = (id: string, host: string, profile: string): QueuedTask => ({
    id, host, profile, account: "", folder: "/srv", folderShort: "/srv", prompt: "go", plan: null, planProfile: null,
    planTitle: "", startAt: NOW, createdAt: NOW, error: "", due: false,
  });
  const status = { queue: [task("a", "", ".claude"), task("b", "lab", ".claude"), task("c", "", ".claude-work")] };
  assert.deepEqual(queuedFor(status, { profileKeys: [".claude"] }).map((t) => t.id), ["a"]);
  assert.deepEqual(queuedFor(status, { host: "lab", profileKeys: [".claude"] }).map((t) => t.id), ["b"]);
  assert.deepEqual(queuedFor(null, { profileKeys: [".claude"] }), []);
});

test("two chats changing the same files: a notice once per pair", () => {
  const base = demoState(NOW).status!.groups[0];
  const row = (key: string, name: string, other: string): Session => ({
    ...base.sessions[0], key, name, chatId: key, sessionId: key,
    overlaps: [{ key: other, name: other.toUpperCase(), sessionId: other, profileDir: ".claude", count: 1, files: ["src/x.py"] }],
  });
  const groups = (overlap: boolean): Group[] => [{ ...base, sessions: overlap ? [row("a", "A", "b"), row("b", "B", "a")] : [] }];
  const t = new TransitionTracker();
  assert.deepEqual(t.overlaps("", groups(false), undefined, OPTS).notices, []);
  const r = t.overlaps("", groups(true), undefined, OPTS);
  assert.equal(r.notices.length, 1);
  assert.equal(r.notices[0].title, "Two chats change the same files");
  assert.equal(r.notices[0].body, "A and B: src/x.py");
  assert.deepEqual(t.overlaps("", groups(true), undefined, OPTS).notices, []);
  assert.equal(overlapText(groups(true)[0].sessions[0].overlaps!), "Also changed by “B”: src/x.py");
});

test("the widgets' Markdown link opens only their runs and Claude's plans", () => {
  const link = (file: string) => ({ path: "/markdown", query: new URLSearchParams({ path: file }).toString() });
  const home = "/home/me";
  // (a run must be there: its real path is checked, links included)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runs-"));
  fs.writeFileSync(path.join(root, "run (ab12).md"), "# Run\n");
  assert.equal(markdownLinkFile(link(`${root}/run (ab12).md`), home, [], root), `${root}/run (ab12).md`);
  assert.equal(markdownLinkFile(link(`${root}/gone.md`), home, [], root), null);
  fs.rmSync(root, { recursive: true });
  assert.equal(markdownLinkFile(link("/home/me/.claude-work/plans/calm-red-owl.md"), home, [], root), "/home/me/.claude-work/plans/calm-red-owl.md");
  assert.equal(markdownLinkFile(link("/home/me/.claude/plans/x.md"), home, [], root), "/home/me/.claude/plans/x.md");
  assert.equal(markdownLinkFile(link("/srv/cfg/plans/x.md"), home, ["/srv/cfg"], root), "/srv/cfg/plans/x.md");
  for (const bad of ["/home/me/notes/x.md", "/home/me/.claude-work/plans/x.txt", "/home/me/.claude-work/plans/../secrets.md",
                     "relative/plans/x.md", "/etc/plans/x.md", "/home/me/.claude-work/x/plans/y.md"])
    assert.equal(markdownLinkFile(link(bad), home, [], root), null, bad);
  assert.equal(markdownLinkFile({ path: "/changes", query: "" }, home, [], root), null);
});
