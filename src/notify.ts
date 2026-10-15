// Notifications and sounds. Every VS Code window runs its own copy of the
// extension and sees the same changes, so only one of them speaks up: the
// window focused last (it notes itself in a small file in the cache folder).

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { Backend } from "./backend";
import { cacheDir, settings } from "./config";
import { gnomeSoundTheme } from "./desktop";
import type { ChatRef, Session } from "./shared/types";
import type { Changes } from "./transitions";

export function chatRef(s: Session, host?: string): ChatRef {
  return {
    host,
    key: s.key,
    sessionId: s.sessionId,
    chatId: s.chatId,
    profileDir: s.profileDir,
    name: s.name,
    entrypoint: s.entrypoint,
    pid: s.pid,
    cwd: s.cwd,
    kind: s.kind,
    jobId: s.jobId,
    openCommand: s.openCommand ?? null,
    stopCommand: s.stopCommand ?? null,
    shared: !!s.shared,
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class Notifier implements vscode.Disposable {
  private leaderFile = path.join(cacheDir(), "vscode-notify.json");
  private subscription: vscode.Disposable;

  constructor(
    private backend: Backend,
    private open: (chat: ChatRef) => void,
  ) {
    if (vscode.window.state.focused) this.claim();
    this.subscription = vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) this.claim();
    });
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private claim(): void {
    try {
      fs.mkdirSync(path.dirname(this.leaderFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.leaderFile, JSON.stringify({ pid: process.pid, at: Date.now() }), { mode: 0o600 });
    } catch {
      // without the file every window notifies; still better than none
    }
  }

  // This window speaks for all: it was focused last, or the one that was is gone
  private isLeader(): boolean {
    try {
      const { pid } = JSON.parse(fs.readFileSync(this.leaderFile, "utf8"));
      if (pid === process.pid) return true;
      if (typeof pid === "number" && pidAlive(pid)) return false;
    } catch {
      // no file yet
    }
    this.claim();
    return true;
  }

  handle(changes: Changes): void {
    if (!changes.notices.length || !this.isLeader()) return;
    for (const n of changes.notices) {
      const text = `${n.title} — ${n.body}`;
      const show = n.kind === "waiting" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
      void show(text, "Open").then((choice) => {
        if (choice === "Open") this.open(chatRef(n.session, n.host));
      });
    }
    if (changes.sound && settings.notifySound()) {
      const sound =
        changes.sound === "waiting" ? settings.soundWaiting() : changes.sound === "failed" ? settings.soundFailed() : settings.soundDone();
      if (sound) void gnomeSoundTheme().then((theme) => this.backend.sound(sound, settings.soundVolume(), theme));
    }
  }
}
