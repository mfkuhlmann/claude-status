import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { apply, MARK_START, patchScript, plan, unpatchScript, unwrapCommand, wrapperPath } from "../src/statusline";

const SNIPPET = fs.readFileSync(path.resolve("vendor/statusline-snippet.sh"), "utf8");
const SCRIPT = '#!/usr/bin/env bash\ninput=$(cat)\necho "$(jq -r .model.display_name <<<"$input")"\n';

function fakeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "claude-status-test-"));
  process.env.HOME = home;
  process.env.XDG_DATA_HOME = path.join(home, ".local", "share");
  process.env.XDG_CACHE_HOME = path.join(home, ".cache");
  delete process.env.CLAUDE_CONFIG_DIR;
  return home;
}

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test("the snippet goes right after input=$(cat), once, and comes out again", () => {
  const patched = patchScript(SCRIPT, SNIPPET)!;
  assert.ok(patched.indexOf(MARK_START) > patched.indexOf("input=$(cat)"));
  assert.ok(patched.indexOf(MARK_START) < patched.indexOf("echo"));
  assert.equal(patchScript(patched, SNIPPET), patched);
  assert.equal(unpatchScript(patched), SCRIPT);
  assert.equal(patchScript("#!/bin/sh\necho hi\n", SNIPPET), null);
  // an older copy (bash-only, say) is replaced by the current one
  const older = patched.replace(/^\(\n[\s\S]*?^\) 2>\/dev\/null(?: \|\| :)?\n/m, "(\n  echo old $'\\t'\n) 2>/dev/null\n");
  assert.notEqual(older, patched);
  assert.equal(patchScript(older, SNIPPET), patched);
});

test("wrapped commands give back the previous command", () => {
  const w = "/home/alice/.local/share/claude-status/statusline.sh";
  assert.equal(unwrapCommand(w, w), "");
  assert.equal(unwrapCommand(`${w} 'npx ccusage statusline'`, w), "npx ccusage statusline");
  assert.equal(unwrapCommand(`${w} 'echo it'"'"'s'`, w), "echo it's");
  assert.equal(unwrapCommand("bash ~/statusline.sh", w), null);
});

test("set up and remove on a machine with three kinds of profiles", () => {
  const home = fakeHome();
  // a stock profile without a status line
  fs.mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });
  // a profile with a status-line script
  write(path.join(home, ".claude-work", "statusline.sh"), SCRIPT);
  write(path.join(home, ".claude-work", "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "bash ~/.claude-work/statusline.sh" } }, null, 2));
  // a profile whose status line is some other command
  write(path.join(home, ".claude-other", "settings.json"), JSON.stringify({ model: "opus", statusLine: { type: "command", command: "echo other" } }, null, 4));

  const setup = plan(SNIPPET, false);
  const files = setup.changes.map((c) => path.relative(home, c.file)).sort();
  assert.deepEqual(files, [".claude-other/settings.json", ".claude-work/statusline.sh", ".claude/settings.json", ".local/share/claude-status/statusline.sh"]);
  apply(setup.changes);
  assert.equal(plan(SNIPPET, false).changes.length, 0, "a second setup changes nothing");

  const other = JSON.parse(fs.readFileSync(path.join(home, ".claude-other", "settings.json"), "utf8"));
  assert.equal(other.model, "opus");
  assert.equal(unwrapCommand(other.statusLine.command, wrapperPath()), "echo other");
  assert.ok(fs.readFileSync(path.join(home, ".claude-work", "statusline.sh"), "utf8").includes(MARK_START));
  assert.ok(fs.readdirSync(path.join(home, ".claude-work")).some((f) => f.startsWith("statusline.sh.bak.")), "backed up");

  // The wrapper keeps the previous status line's output and saves the snapshot
  const input = JSON.stringify({ session_id: "abc-123", transcript_path: path.join(home, ".claude-other", "projects", "p", "abc-123.jsonl") });
  const run = spawnSync("bash", ["-c", other.statusLine.command], { input, encoding: "utf8", env: { ...process.env, HOME: home } });
  assert.equal(run.stdout.trim(), "other");
  const hasJq = spawnSync("jq", ["--version"]).status === 0;
  if (hasJq) assert.ok(fs.existsSync(path.join(home, ".cache", "claude-widget", "statusline", ".claude-other", "abc-123.json")));

  apply(plan(SNIPPET, true).changes);
  assert.equal(fs.readFileSync(path.join(home, ".claude-work", "statusline.sh"), "utf8"), SCRIPT);
  const restored = JSON.parse(fs.readFileSync(path.join(home, ".claude-other", "settings.json"), "utf8"));
  assert.equal(restored.statusLine.command, "echo other");
  const stock = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(stock.statusLine, undefined);
});

test("the wrapper is written first, and put back when it's gone or old", () => {
  const home = fakeHome();
  fs.mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });
  const setup = plan(SNIPPET, false);
  assert.equal(setup.changes[0].file, wrapperPath(), "a status line never points at a script not written yet");
  apply(setup.changes);
  assert.equal(fs.statSync(wrapperPath()).mode & 0o777, 0o755);
  fs.rmSync(wrapperPath());
  const again = plan(SNIPPET, false);
  assert.deepEqual(again.changes.map((c) => c.file), [wrapperPath()], "settings stay, the wrapper comes back");
  apply(again.changes);
  fs.writeFileSync(wrapperPath(), "#!/bin/sh\n# an older wrapper\n");
  assert.deepEqual(plan(SNIPPET, false).changes.map((c) => c.file), [wrapperPath()]);
});

test("more ways to read the input, a last line without its newline, $HOME in the command", () => {
  for (const line of ['input="$(cat)"', "input=$(cat -)", "input=$(cat) # the JSON"]) {
    const patched = patchScript(`#!/bin/sh\n${line}`, SNIPPET)!;
    assert.ok(patched.startsWith(`#!/bin/sh\n${line}\n${MARK_START}`), line);
  }
  assert.equal(patchScript("#!/bin/sh\ninput=$(cat) &&\n  echo x\n", SNIPPET), null, "a line that goes on");
  const home = fakeHome();
  write(path.join(home, ".claude", "statusline.sh"), SCRIPT);
  write(path.join(home, ".claude", "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "bash $HOME/.claude/statusline.sh" } }));
  const files = plan(SNIPPET, false).changes.map((c) => path.relative(home, c.file));
  assert.deepEqual(files, [".claude/statusline.sh"], "the script itself is patched, not wrapped");
});
