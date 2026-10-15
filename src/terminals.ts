// VS Code terminals for chats: on this computer, on the host this window is
// connected to (Remote-SSH), or on another host through ssh -t. The extension
// runs on this computer even in a Remote-SSH window ("extensionKind": ["ui"]):
// a terminal created with a file: cwd runs here, one without a cwd runs on
// the window's host.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { cacheDir } from "./config";
import { shellQuote } from "./shared/model";

export type Place = { kind: "local" } | { kind: "windowHost" } | { kind: "ssh"; host: string };

// The same connection sharing as remote.py, without batch mode: ssh may ask
// for a password or a host key in the terminal.
export function sshCommand(host: string, command: string): string {
  const control = path.join(cacheDir(), "ssh", "%C");
  const opts = ["-o", "ControlMaster=auto", "-o", `ControlPath=${control}`, "-o", "ControlPersist=300", "-o", "ServerAliveInterval=10"];
  return ["ssh", ...opts, "-t", host, command].map(shellQuote).join(" ");
}

// Parent of a process here, from /proc (Linux); null when unknown
export function parentPid(pid: number): number | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    // pid (comm) state ppid …; comm may hold spaces and parentheses
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ppid = Number(fields[1]);
    return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
  } catch {
    return null;
  }
}

export function localAncestors(pid: number): Set<number> {
  const out = new Set<number>();
  for (let p: number | null = pid; p && p > 1 && !out.has(p) && out.size < 64; p = parentPid(p)) out.add(p);
  return out;
}

function hasChildren(pid: number): boolean {
  try {
    for (const task of fs.readdirSync(`/proc/${pid}/task`)) {
      if (fs.readFileSync(`/proc/${pid}/task/${task}/children`, "utf8").trim()) return true;
    }
  } catch {
    // not Linux, or gone
  }
  return false;
}

export class Terminals implements vscode.Disposable {
  private local = new WeakSet<vscode.Terminal>(); // the ones made here on this computer
  private byKey = new Map<string, vscode.Terminal>();
  private subscription: vscode.Disposable;

  constructor() {
    this.subscription = vscode.window.onDidCloseTerminal((t) => {
      for (const [k, v] of this.byKey) if (v === t) this.byKey.delete(k);
    });
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private isLocal(t: vscode.Terminal): boolean {
    return !vscode.env.remoteName || this.local.has(t);
  }

  // The terminal of this window that the process runs in (one of its ancestors
  // is the terminal's shell); ancestors are this computer's or the window host's.
  async find(ancestors: Set<number>, onWindowHost: boolean): Promise<vscode.Terminal | undefined> {
    if (!ancestors.size) return undefined;
    for (const t of vscode.window.terminals) {
      if (t.exitStatus) continue;
      if (this.isLocal(t) === onWindowHost) continue;
      const pid = await t.processId;
      if (pid && ancestors.has(pid)) return t;
    }
    return undefined;
  }

  // Run command in a new terminal, or show the one still running it for key
  // (a local terminal whose command hasn't finished: its shell has a child).
  async run(key: string, name: string, command: string, place: Place): Promise<vscode.Terminal> {
    const existing = this.byKey.get(key);
    if (existing && !existing.exitStatus && this.local.has(existing)) {
      const pid = await existing.processId;
      if (pid && hasChildren(pid)) {
        existing.show();
        return existing;
      }
    }
    const line = place.kind === "ssh" ? sshCommand(place.host, command) : command;
    // Ctrl+C belongs to Claude, not to the wrapper; the shell stays afterwards.
    const script = `trap : INT; ${line}; exec "\${SHELL:-/bin/sh}"`;
    const options: vscode.TerminalOptions = {
      name: `Claude: ${name}`.slice(0, 48),
      iconPath: new vscode.ThemeIcon("sparkle"),
      shellPath: "/bin/sh",
      shellArgs: ["-c", script],
    };
    if (place.kind !== "windowHost") options.cwd = vscode.Uri.file(os.homedir());
    const t = vscode.window.createTerminal(options);
    if (place.kind !== "windowHost") this.local.add(t);
    this.byKey.set(key, t);
    t.show();
    return t;
  }
}
