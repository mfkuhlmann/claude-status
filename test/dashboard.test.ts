// A reaction that fails (a pet, a notification) must not stop the dashboard
// from taking in new status: the widget froze at every plan-limit reset when
// its reset reaction threw before the status was stored.

import assert from "node:assert/strict";
import { test } from "node:test";
import type * as vscode from "vscode";
import type { Backend } from "../src/backend";
import { Dashboard } from "../src/dashboard";
import type { Notifier } from "../src/notify";
import { demoState } from "../src/shared/demo";
import type { Status } from "../src/shared/types";

const NOW = 1_800_000_000_000;

function withFiveHour(pct: number): Status {
  const status = structuredClone(demoState(NOW).status!);
  const windows = status.groups[0].limits!.windows;
  windows[0] = { ...windows[0], pct };
  return status;
}

test("the status keeps updating after a reaction to a limit reset throws", async () => {
  let next = withFiveHour(80);
  const backend = { status: async () => ({ status: next }) } as unknown as Backend;
  const notifier = { handle() {} } as unknown as Notifier;
  const errors: string[] = [];
  const log = { warn() {}, info() {}, error: (m: string) => errors.push(m) } as unknown as vscode.LogOutputChannel;
  const dash = new Dashboard(backend, notifier, log);
  const resets: string[] = [];
  dash.onPetEvent((e) => {
    resets.push(e.kind);
    throw new Error("a pet fell over");
  });
  const fiveHour = () => dash.state().status!.groups[0].limits!.windows[0].pct;

  await dash.refresh();
  assert.equal(fiveHour(), 80);
  next = withFiveHour(2); // the 5-hour limit resets: the pets celebrate, and one throws
  await dash.refresh();
  assert.deepEqual(resets, ["reset"]);
  assert.equal(fiveHour(), 2, "the reset's status is stored");
  assert.equal(errors.length, 1, "the failure is logged");
  next = withFiveHour(3);
  await dash.refresh();
  assert.equal(fiveHour(), 3, "later polls still update");
  dash.dispose();
});
