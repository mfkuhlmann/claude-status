// In a Remote-SSH window, the account switch shows and switches the host's
// Claude Code: VS Code keeps claudeCode.environmentVariables (a machine
// setting) per host, so the user setting written there is the host's.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as vscode from "vscode";
import { AccountSwitch } from "../src/accountSwitch";
import type { Dashboard } from "../src/dashboard";
import type { Group, ViewState } from "../src/shared/types";

const stub = vscode as unknown as typeof import("./vscode-stub");

function hostGroup(name: string, title: string, vscodeHere: boolean, configDir: string | null | undefined): Group {
  return { name, title, vscodeHere, configDir, host: "lab", id: name, plan: null, profiles: [], profileKeys: [], sessions: [],
           limits: null, tokens: null, chatProfile: `.claude-${name}`, shareProfile: null, projects: [], sharedHere: [], recent: [] };
}

test("a Remote-SSH window shows the host's account and switches it in the host's settings", async () => {
  const groups = [hostGroup("work", "work · Team", true, "/home/me/.claude"), hostGroup("personal", "personal · Pro", false, "/home/me/.claude-personal")];
  const state = { status: null, hosts: [{ name: "lab", result: { groups } }], demo: false } as unknown as ViewState;
  let refreshed = 0;
  const dash = { currentHost: "lab", state: () => state, refreshAll: () => void refreshed++ } as unknown as Dashboard;
  const updates: unknown[][] = [];
  const realConfig = stub.workspace.getConfiguration;
  stub.env.remoteName = "ssh-remote";
  stub.workspace.getConfiguration = (() => ({
    // what this window reads: the host's value (a machine setting), with a variable of its own
    get: () => [{ name: "FOO", value: "1" }, { name: "CLAUDE_CONFIG_DIR", value: "/home/me/.claude" }],
    update: async (...args: unknown[]) => void updates.push(args),
  })) as unknown as typeof stub.workspace.getConfiguration;
  try {
    const account = new AccountSwitch(dash);
    account.update(state);
    const item = stub.recorded.statusBarItems.at(-1)!;
    assert.equal(item.text, "$(account) Claude: work");
    assert.equal(await account.switchHost(groups[1]), true);
    assert.deepEqual(updates, [["environmentVariables",
      [{ name: "FOO", value: "1" }, { name: "CLAUDE_CONFIG_DIR", value: "/home/me/.claude-personal" }], stub.ConfigurationTarget.Global]]);
    assert.equal(refreshed, 1);
    // a plain ~/.claude runs without the variable; a host answer from an older backend can't be switched
    await account.switchHost(hostGroup("default", "default", false, null));
    assert.deepEqual(updates[1], ["environmentVariables", [{ name: "FOO", value: "1" }], stub.ConfigurationTarget.Global]);
    assert.equal(await account.switchHost(hostGroup("old", "old", false, undefined)), false);
    assert.equal(updates.length, 2);
    account.dispose();
  } finally {
    stub.env.remoteName = undefined;
    stub.workspace.getConfiguration = realConfig;
  }
});
