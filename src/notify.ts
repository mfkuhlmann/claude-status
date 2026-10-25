// Notifications and sounds. Every VS Code window runs its own copy of the
// extension and sees the same changes, so only one of them speaks up: the
// window focused last (it notes itself in a small file in the cache folder).

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { Backend } from "./backend";
import type { ChatPanes } from "./chatPane";
import { cacheDir, settings } from "./config";
import { gnomeSoundTheme } from "./desktop";
import type { Digest } from "./away";
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
    vscodeTerminal: s.vscodeTerminal ?? null,
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
  panes?: ChatPanes; // the chats' tabs: replies and answers go through them (set once they're there)

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
  isLeader(): boolean {
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

  // holdDone: you're away; finished (and stopped) chats wait for the digest (away.ts)
  handle(changes: Changes, opts: { holdDone?: boolean } = {}): void {
    const notices = opts.holdDone ? changes.notices.filter((n) => n.kind === "waiting") : changes.notices;
    if (!notices.length || !this.isLeader()) return;
    for (const n of notices) {
      const text = `${n.title} — ${n.body}`;
      const show = n.kind === "done" ? vscode.window.showInformationMessage : vscode.window.showWarningMessage;
      const chat = chatRef(n.session, n.host);
      const p = n.kind === "waiting" ? n.session.permission : null;
      const asks = !!p && (p.answer === "hook" || p.answer === "keys") && !!this.panes;
      // a permission prompt: answer it here, in Claude's own order (Yes, Yes
      // and don't ask again, No); a chat that waits or finished: reply here
      const buttons = asks
        ? ["Allow once", ...(p!.answer === "keys" || p!.always ? ["Always allow"] : []), "Deny", "Deny with a note…", "Open"]
        : this.panes && (n.kind === "done" || (n.kind === "waiting" && !p)) ? ["Reply…", "Open"] : ["Open"];
      void show(text, ...buttons).then(async (choice) => {
        const panes = this.panes;
        if (choice === "Open") {
          if (panes && settings.clickOpensPane()) panes.open(chat, "chat");
          else this.open(chat);
        } else if (panes && (choice === "Allow once" || choice === "Always allow" || choice === "Deny")) {
          await panes.answer(chat, choice === "Allow once" ? "allow" : choice === "Always allow" ? "always" : "deny");
        } else if (panes && choice === "Deny with a note…") {
          const note = await vscode.window.showInputBox({ title: `Deny ${n.session.name}`, prompt: "What should Claude do instead? (optional)", ignoreFocusOut: true });
          if (note !== undefined) await panes.answer(chat, "deny", note.trim());
        } else if (panes && choice === "Reply…") {
          const reply = await vscode.window.showInputBox({ title: `Reply to ${n.session.name}`, prompt: "Sent the way the chat takes it", ignoreFocusOut: true });
          if (reply?.trim()) await panes.reply(chat, reply);
        }
      });
    }
    const sound = opts.holdDone && changes.sound !== "waiting" ? "" : changes.sound;
    if (sound && settings.notifySound()) {
      const file =
        sound === "waiting" ? settings.soundWaiting() : sound === "failed" ? settings.soundFailed() : settings.soundDone();
      if (file) void gnomeSoundTheme().then((theme) => this.backend.sound(file, settings.soundVolume(), theme));
    }
  }

  // What happened while you were away, in one notification
  digest(d: Digest, showView: () => void): void {
    if (!this.isLeader()) return;
    const action = d.first ? `Open ${d.first.session.name}` : "Show Chats";
    void vscode.window.showInformationMessage(d.message, action).then((choice) => {
      if (choice !== action) return;
      if (d.first) this.open(chatRef(d.first.session, d.first.host));
      else showView();
    });
  }
}
