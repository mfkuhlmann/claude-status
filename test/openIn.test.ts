// Stopping idle chats, and where recent chats reopen: a terminal or a Claude
// Code tab, whichever is there (no claude command, Claude Code missing or on
// another account).

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  canEndChat,
  claudeCodeHere,
  hasTurn,
  claudeCodeReopenHint,
  cliInstalled,
  reopensInClaudeCode,
  terminalReopenHint,
} from "../src/shared/model";
import type { Group, PlanItem } from "../src/shared/types";
import * as vscode from "vscode";
import type { AccountSwitch } from "../src/accountSwitch";
import { Actions, typedFolder } from "../src/actions";
import type { Backend } from "../src/backend";
import type { Dashboard } from "../src/dashboard";
import type { Terminals } from "../src/terminals";

const chat = { kind: "interactive", entrypoint: "cli", state: "idle", pid: 42 };

test("a chat with a process can be stopped, whatever it's doing; a working one interrupted", () => {
  assert.equal(canEndChat(chat), true);
  assert.equal(canEndChat({ ...chat, state: "working" }), true, "it asks first");
  assert.equal(canEndChat({ ...chat, entrypoint: "claude-vscode" }), true, "its Claude Code tab goes on");
  assert.equal(canEndChat({ ...chat, kind: "bg" }), false, "background sessions: claude stop");
  assert.equal(canEndChat({ ...chat, pid: null }), false, "no process");
  assert.equal(canEndChat({ kind: "chat", pid: null }), false, "a recent chat's reference");
  assert.deepEqual(["working", "waiting", "idle", "done"].map((state) => hasTurn({ state })), [true, true, false, false]);
});

test("the claude command counts as there unless the backend says it isn't", () => {
  assert.equal(cliInstalled(null), true);
  assert.equal(cliInstalled({}), true, "an older backend");
  assert.equal(cliInstalled({ cli: { installed: true } }), true);
  assert.equal(cliInstalled({ cli: { installed: false } }), false);
});

const work = { title: "work · Team", profileKeys: [".claude-work"] } as Pick<Group, "title" | "profileKeys"> as Group;
const personal = { title: "personal · Pro", profileKeys: [".claude-personal"] } as Group;
const onWork = { available: true, profileKey: ".claude-work" };

test("Claude Code reopens the chats of the account it runs on (a host's: the host's ~/.claude)", () => {
  assert.equal(claudeCodeHere(work, onWork), true);
  assert.equal(claudeCodeHere(personal, onWork), false);
  assert.equal(claudeCodeHere(work, { available: false, profileKey: null }), false, "not installed");
  assert.equal(claudeCodeHere({ ...personal, host: "lab", vscodeHere: true }, onWork), true);
  assert.equal(claudeCodeHere({ ...work, host: "lab", vscodeHere: false }, onWork), false);
});

test("recent chats reopen where you picked, or in Claude Code without a claude command", () => {
  assert.equal(reopensInClaudeCode("terminal", true, true), false);
  assert.equal(reopensInClaudeCode("claudeCode", true, true), true);
  assert.equal(reopensInClaudeCode("terminal", false, true), true, "no claude command");
  assert.equal(reopensInClaudeCode("claudeCode", true, false), false, "Claude Code isn't on this account");
});

test("each half says what it does, or why it's greyed out", () => {
  assert.equal(terminalReopenHint(undefined, true), "Reopens the chat in a terminal (claude --resume).");
  assert.match(terminalReopenHint("lab", false), /^Claude Code's claude command isn't installed on lab/);
  assert.match(claudeCodeReopenHint(personal, onWork, [work, personal]), /^Claude Code runs on work · Team, not personal · Pro/);
  assert.match(claudeCodeReopenHint(work, { available: false, profileKey: null }, []), /isn't installed or enabled/);
  assert.match(claudeCodeReopenHint(work, onWork, [work]), /^Opens the chat in a Claude Code tab/);
});

test("a plan's chat reopens in a Claude Code tab only when Claude Code is on the chat's account", async () => {
  // (the plan is shared with work, Claude Code's account; the chat that made it is personal's)
  const stub = vscode as unknown as typeof import("./vscode-stub");
  const getConfiguration = stub.workspace.getConfiguration;
  stub.workspace.getConfiguration = () => ({
    get: <T>(key: string, fallback: T) => (key === "reopenIn" ? "claudeCode" : fallback) as T,
    update: async () => undefined,
  });
  try {
    const work = { id: "w", title: "work", profileKeys: ["work"], sessions: [], vscodeHere: true } as unknown as Group;
    const personal = { id: "p", title: "personal", profileKeys: ["personal"], sessions: [] } as unknown as Group;
    const plan = {
      slug: "s", title: "Plan", path: "/p.md", updatedAt: 0, key: "work/s", profileDir: "work", profile: "work", shared: true,
      chatId: "c1", chatProfileDir: "personal", cwd: "/proj", cwdShort: "~/proj", openCommand: "cd /proj 2>/dev/null; claude --resume c1",
    } as PlanItem;
    const helpers: string[][] = [];
    const runs: string[] = [];
    const dash = {
      demo: false,
      state: () => ({ status: { groups: [work, personal], cli: { installed: true } }, hosts: [] }),
      claudeCodeInfo: () => ({ available: true, profileKey: "work" }),
      setActionError: () => undefined,
      isVisible: () => true,
    };
    const actions = new Actions(
      { action: async (_script: string, args: string[]) => (helpers.push(args), { ok: false, message: "Claude Code isn't on personal" }) } as unknown as Backend,
      dash as unknown as Dashboard,
      { run: async (_key: string, _name: string, command: string) => void runs.push(command) } as unknown as Terminals,
      { warn: () => undefined } as unknown as vscode.LogOutputChannel,
      {} as AccountSwitch,
    );
    await actions.continuePlanChat(plan, work);
    assert.deepEqual(helpers, [], "not jump.py --resume --vscode on an account Claude Code isn't on");
    assert.deepEqual(runs, [plan.openCommand], "in a terminal, on personal");
  } finally {
    stub.workspace.getConfiguration = getConfiguration;
  }
});

test("a folder typed for an SSH host: its full path, or one in its home folder", () => {
  assert.equal(typedFolder(" /srv/app ", "/home/me"), "/srv/app");
  assert.equal(typedFolder("~/project", "/home/me"), "/home/me/project", "not the home folder itself");
  assert.equal(typedFolder("~", "/home/me/"), "/home/me");
  assert.equal(typedFolder("project", "/home/me"), null, "it would start in the home folder");
  assert.equal(typedFolder("~other/x", "/home/me"), null);
  assert.equal(typedFolder("~/project", null), null, "the host's home isn't known");
});

test("a recent chat reopens in this window when it has the chat's project open", async () => {
  // (Claude's `cd`s move a chat's folder into subfolders, or out of the
  // folder it started in, which Claude Code files it under)
  const stub = vscode as unknown as typeof import("./vscode-stub");
  const config = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "claude-status-test-")), ".claude-work");
  fs.mkdirSync(path.join(config, "projects", "-proj"), { recursive: true });
  fs.writeFileSync(path.join(config, "projects", "-proj", "c2.jsonl"), "");
  const saved = { env: process.env.CLAUDE_CONFIG_DIR, openExternal: stub.env.openExternal, folders: stub.workspace.workspaceFolders };
  process.env.CLAUDE_CONFIG_DIR = config; // Claude Code's account here
  const links: string[] = [];
  (stub.env as { openExternal: unknown }).openExternal = async (uri: { path: string }) => (links.push(uri.path), true);
  const setFolders = (...paths: string[]) =>
    void ((stub.workspace as { workspaceFolders: unknown }).workspaceFolders = paths.map((p) => ({ uri: stub.Uri.file(p) })));
  try {
    const helpers: string[][] = [];
    const actions = new Actions(
      { action: async (_script: string, args: string[]) => (helpers.push(args), { ok: true, message: "" }) } as unknown as Backend,
      { demo: false, currentHost: undefined } as unknown as Dashboard,
      {} as Terminals,
      { warn: () => undefined } as unknown as vscode.LogOutputChannel,
      {} as AccountSwitch,
    );
    const reopen = (id: string, cwd: string) => actions.openInClaudeCode({ key: id, sessionId: id, profileDir: ".claude-work", name: id, cwd });
    setFolders("/proj/");
    await reopen("c1", "/proj/source"); // went into a subfolder
    await reopen("c2", "/home/me"); // started in /proj, then went out of it
    await reopen("c3", "/projector"); // another folder, that only starts the same
    setFolders("/proj/source");
    await reopen("c4", "/proj"); // this window has only a part of it
    assert.deepEqual(links, ["vscode://anthropic.claude-code/open?session=c1", "vscode://anthropic.claude-code/open?session=c2"]);
    assert.deepEqual(helpers.map((args) => args[1]), ["c3", "c4"], "VS Code opens the others' folders (jump.py)");
  } finally {
    if (saved.env === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved.env;
    stub.env.openExternal = saved.openExternal;
    (stub.workspace as { workspaceFolders: unknown }).workspaceFolders = saved.folders;
  }
});
