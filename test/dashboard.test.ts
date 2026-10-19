// A reaction that fails (a pet, a notification) must not stop the dashboard
// from taking in new status: the widget froze at every plan-limit reset when
// its reset reaction threw before the status was stored.

import assert from "node:assert/strict";
import { mock, test } from "node:test";
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

test("opening the view doesn't cancel the next try of a Python that didn't work", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let checks = 0;
    const backend = {
      checkPython: async () => (++checks === 1 ? "python3 doesn't work" : ""),
      status: async () => ({ status: demoState(NOW).status! }),
    } as unknown as Backend;
    const log = { warn() {}, info() {}, error() {} } as unknown as vscode.LogOutputChannel;
    const dash = new Dashboard(backend, { handle() {} } as unknown as Notifier, log);
    await dash.start();
    dash.setVisible(true); // polls right away (its timer used to be the retry's too)
    mock.timers.tick(30000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(checks, 2, "Python is checked again");
    dash.dispose();
  } finally {
    mock.timers.reset();
  }
});
