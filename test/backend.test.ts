// The vendored backend on a stock machine: just ~/.claude (no ~/.claude-*
// profiles, no profile-switching tools, no shared-chats tool), and with a
// custom CLAUDE_CONFIG_DIR. Runs the real Python against made-up files.

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, test } from "node:test";
import { Backend } from "../src/backend";

const children: ChildProcess[] = [];
after(() => children.forEach((c) => c.kill()));

function fakeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-status-test-"));
  process.env.HOME = home;
  process.env.XDG_CACHE_HOME = path.join(home, ".cache");
  delete process.env.CLAUDE_CONFIG_DIR;
  return home;
}

// A process standing in for a running claude: its environment says which
// config dir it uses, like a real session's.
function liveSession(configDir: string, env: NodeJS.ProcessEnv, entry: Record<string, unknown>) {
  const child = spawn("sleep", ["60"], { env: { PATH: process.env.PATH, ...env }, stdio: "ignore" });
  children.push(child);
  const stat = fs.readFileSync(`/proc/${child.pid}/stat`, "utf8");
  const procStart = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  fs.mkdirSync(path.join(configDir, "sessions"), { recursive: true });
  fs.mkdirSync(path.join(configDir, "projects"), { recursive: true });
  const now = Date.now();
  fs.writeFileSync(
    path.join(configDir, "sessions", `${child.pid}.json`),
    JSON.stringify({ pid: child.pid, procStart, kind: "interactive", entrypoint: "cli", startedAt: now - 60000, statusUpdatedAt: now - 30000, ...entry }),
  );
}

const linux = process.platform === "linux";

test("a stock ~/.claude is all it takes", { skip: !linux && "sessions are detected through /proc" }, async () => {
  const home = fakeHome();
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({ oauthAccount: { accountUuid: "00000000-0000-4000-8000-000000000001", displayName: "Alice", organizationType: "claude_max" } }),
  );
  liveSession(path.join(home, ".claude"), { HOME: home }, {
    sessionId: "11111111-1111-4111-8111-111111111111",
    cwd: path.join(home, "project"),
    status: "busy",
    name: "Fix the parser",
  });
  const backend = new Backend(path.resolve("."), () => "python3");
  assert.equal(await backend.checkPython(), "");
  const { status, error } = await backend.status(["--done-hours", "24", "--recent", "5"]);
  assert.equal(error, undefined);
  assert.ok(status);
  assert.equal(status.canShare, false, "no shared-chats tool, no sharing");
  assert.equal(status.groups.length, 1);
  const g = status.groups[0];
  assert.equal(g.profiles.length, 1);
  assert.match(g.title, /Alice/);
  assert.equal(g.sessions.length, 1);
  assert.equal(g.sessions[0].state, "working");
  assert.equal(g.sessions[0].name, "Fix the parser");
  assert.ok(g.homeChatCommand, "--remote mode gives the command that starts a chat");
});

test("a custom CLAUDE_CONFIG_DIR is found when passed along", { skip: !linux && "sessions are detected through /proc" }, async () => {
  const home = fakeHome();
  const custom = path.join(home, "config", "claude");
  liveSession(custom, { HOME: home, CLAUDE_CONFIG_DIR: custom }, {
    sessionId: "22222222-2222-4222-8222-222222222222",
    cwd: home,
    status: "waiting",
    waitingFor: "permission prompt",
    name: "Release notes",
  });
  const backend = new Backend(path.resolve("."), () => "python3");
  const without = await backend.status([]);
  assert.equal(without.status?.groups.flatMap((g) => g.sessions).length ?? 0, 0);
  const { status } = await backend.status(["--config-dir", custom]);
  const sessions = status!.groups.flatMap((g) => g.sessions);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].state, "waiting");
  assert.equal(sessions[0].reason, "permission");
});

test("a missing Python is explained", async () => {
  const backend = new Backend(path.resolve("."), () => "python3-that-does-not-exist");
  assert.match(await backend.checkPython(), /Install Python 3\.7 or newer/);
});
