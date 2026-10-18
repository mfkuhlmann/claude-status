// Stopping idle chats, and where recent chats reopen: a terminal or a Claude
// Code tab, whichever is there (no claude command, Claude Code missing or on
// another account).

import assert from "node:assert/strict";
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
import type { Group } from "../src/shared/types";

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
