// Runs the widget's Python backend (vendor/code): claude_status.py for this
// computer, remote.py for SSH hosts, jump.py for actions, notify_sound.py for
// sounds. Every call is a plain argument list (no shell).

import { spawn } from "node:child_process";
import * as path from "node:path";
import { isComparison, type Comparison } from "./changes";
import type { Status } from "./shared/types";

export const REMOTE_MARK = "@@claude-status@@";

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError?: NodeJS.ErrnoException;
  timedOut?: boolean;
}

export interface SshHost {
  name: string;
  hostname: string;
  user: string;
  port: string;
  jump: string;
}

export interface Answer {
  ok: boolean;
  message: string;
  command?: string; // jump.py --print-command: the shell command to run instead
}

// The environment for helpers: VS Code's own variables would leak into the
// terminals and programs they start.
export function helperEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (k.startsWith("VSCODE_") || k.startsWith("ELECTRON_") || k === "APPLICATION_INSIGHTS_NO_DIAGNOSTIC_CHANNEL") continue;
    env[k] = v;
  }
  return env;
}

export function runProcess(
  command: string,
  args: string[],
  opts: { input?: string; timeoutMs?: number; cwd?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, { cwd: opts.cwd, env: helperEnv(), stdio: ["pipe", "pipe", "pipe"] });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, opts.timeoutMs)
      : undefined;
    const done = (result: RunResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", (err: NodeJS.ErrnoException) => done({ code: null, stdout, stderr, spawnError: err }));
    child.on("close", (code) => done({ code, stdout, stderr, timedOut }));
    child.stdin.on("error", () => undefined); // the child may exit before reading
    child.stdin.end(opts.input ?? "");
  });
}

function lastLine(text: string): string {
  const lines = text.trim().split("\n");
  return lines[lines.length - 1] || "";
}

export class Backend {
  readonly codeDir: string;
  private pythonChecked = "";

  constructor(
    extensionPath: string,
    private python: () => string,
  ) {
    this.codeDir = path.join(extensionPath, "vendor", "code");
  }

  private script(name: string): string {
    return path.join(this.codeDir, name);
  }

  // Why Python can't be used, or "" when it can (checked once per path)
  async checkPython(): Promise<string> {
    const python = this.python();
    if (this.pythonChecked === python) return "";
    const r = await runProcess(python, ["-I", "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 7) else 3)"], {
      timeoutMs: 15000,
    });
    if (r.spawnError)
      return `Can't run "${python}" (${r.spawnError.code ?? r.spawnError.message}). Install Python 3.7 or newer, or set claudeStatus.pythonPath.`;
    if (r.code === 3) return `"${python}" is older than Python 3.7; set claudeStatus.pythonPath to a newer one.`;
    if (r.code !== 0) return `"${python}" doesn't work: ${lastLine(r.stderr) || `exit ${r.code}`}`;
    this.pythonChecked = python;
    return "";
  }

  // This computer's status. Run in --remote mode too: then every row carries
  // the shell command that opens it, which the extension runs in a terminal.
  async status(args: string[]): Promise<{ status?: Status; error?: string }> {
    const r = await runProcess(this.python(), ["-I", this.script("claude_status.py"), "--remote", ...args], { timeoutMs: 60000 });
    if (r.spawnError) return { error: `Can't run Python: ${r.spawnError.message}` };
    if (r.timedOut) return { error: "The status check took longer than a minute." };
    const mark = r.stdout.lastIndexOf(REMOTE_MARK);
    if (mark < 0) return { error: `Status script failed: ${lastLine(r.stderr) || "no output"}` };
    try {
      const parsed = JSON.parse(r.stdout.slice(mark + REMOTE_MARK.length));
      if (!parsed.ok) return { error: `Status unavailable: ${parsed.error}` };
      return { status: parsed as Status };
    } catch {
      return { error: "The status script's answer couldn't be read." };
    }
  }

  // The hosts with a name of their own in ~/.ssh/config
  async sshHosts(): Promise<SshHost[]> {
    const r = await this.json(["remote.py", "--hosts"], 15000);
    return r && r.ok && Array.isArray(r.hosts) ? (r.hosts as SshHost[]) : [];
  }

  async hostStatus(host: string, args: string[]): Promise<{ ok: boolean; result?: Status; error?: string }> {
    const r = await this.json(["remote.py", "--status", host, ...args], 70000);
    if (!r) return { ok: false, error: `${host}: no answer from the SSH helper` };
    if (r.ok && r.result) return { ok: true, result: r.result as Status };
    return { ok: false, error: String(r.error || r.message || "no answer") };
  }

  // jump.py / remote.py actions; they print {"ok": bool, "message": str}
  async action(scriptName: "jump.py" | "remote.py" | "claude_status.py", args: string[], timeoutMs = 90000): Promise<Answer> {
    const r = await this.json([scriptName, ...args], timeoutMs);
    if (!r) return { ok: false, message: "the helper gave no answer" };
    return { ok: !!r.ok, message: String(r.message ?? r.error ?? ""), ...(typeof r.command === "string" ? { command: r.command } : {}) };
  }

  // What a chat changed (jump.py --changes --list): the files, with copies of
  // what they were before it (or before its last turn)
  async changes(chatId: string, profileDir: string, turn: boolean, extra: string[] = []): Promise<{ message: string; comparison?: Comparison }> {
    const args = ["jump.py", "--changes", chatId, ...(profileDir ? ["--profile", profileDir] : []), ...(turn ? ["--turn"] : []), "--list", ...extra];
    const r = await this.json(args, 60000);
    if (!r) return { message: "the helper gave no answer" };
    const message = String(r.message ?? r.error ?? "");
    return r.ok && isComparison(r.comparison) ? { message, comparison: r.comparison } : { message: message || "no answer" };
  }

  // theme: the sound theme when the desktop keeps it elsewhere (GNOME)
  sound(sound: string, volume: number, theme?: string): void {
    const args = ["-I", this.script("notify_sound.py"), sound, "--volume", String(volume)];
    if (theme) args.push("--theme", theme);
    void runProcess(this.python(), args, { timeoutMs: 30000 });
  }

  private async json(argv: string[], timeoutMs: number): Promise<Record<string, any> | null> {
    const [name, ...args] = argv;
    const r = await runProcess(this.python(), ["-I", this.script(name), ...args], { timeoutMs });
    if (r.spawnError || r.timedOut) return { ok: false, message: r.timedOut ? "timed out" : r.spawnError!.message };
    try {
      return JSON.parse(r.stdout.trim().split("\n").pop() || "");
    } catch {
      return { ok: false, message: lastLine(r.stderr) || "the helper gave no answer" };
    }
  }
}
