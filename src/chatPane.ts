// A chat in an editor tab: its conversation as it goes (Claude's replies
// rendered, each tool call one line), a box to reply, what it asks while it
// waits for a permission (Allow once, Always allow, Deny), and its review:
// the files it changed against how they were before the chat, Undo, Commit
// only its files, Mark reviewed. The widget's pane.py does the work; the
// tab's page (webview/chat.tsx) only shows it and says what you clicked.
//
// What runs is decided here, from the extension's own state: the page names
// nothing but the tab's own chat, and what you typed.

import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { Actions } from "./actions";
import type { Backend } from "./backend";
import { openComparison } from "./changes";
import { configDirArgs } from "./config";
import type { Dashboard } from "./dashboard";
import { chatRefOf, recentRef, stateText } from "./shared/model";
import { answersOf, queuedReply, reviewPending, textScale, type PaneChat, type PaneHostMessage, type PaneMessage } from "./shared/pane";
import type { Answers, ChatRef, Decision, RecentChat, Session, ViewState } from "./shared/types";
import { localAncestors, type Terminals } from "./terminals";

const TEXT_MAX = 100_000; // (as a queued task's prompt may be)
const LIMIT = 120;
const LIMIT_MAX = 2000;

// The chat's row now: a listed session, else one of its account's recent chats
export function findPaneRow(state: Pick<ViewState, "status" | "hosts">, host: string, chatId: string): { session?: Session; recent?: RecentChat } {
  const where = host ? state.hosts.find((h) => h.name === host)?.result : state.status;
  for (const g of where?.groups ?? []) {
    const s = (g.sessions ?? []).find((x) => (x.chatId || x.sessionId) === chatId || x.sessionId === chatId);
    if (s) return { session: s };
  }
  for (const g of where?.groups ?? []) {
    const c = [...(g.recent ?? []), ...(g.starred ?? [])].find((x) => x.sessionId === chatId);
    if (c) return { recent: c };
  }
  return {};
}

export class ChatPanes implements vscode.Disposable {
  private panes = new Map<string, Pane>(); // "<host>|<chat id>" -> its tab

  constructor(
    private extensionUri: vscode.Uri,
    private backend: Backend,
    private dash: Dashboard,
    private actions: Actions,
    private terminals: Terminals,
    private log: vscode.LogOutputChannel,
  ) {}

  open(chat: ChatRef, tab: "chat" | "review" = "chat"): void {
    const chatId = chat.chatId || chat.sessionId;
    const key = `${chat.host ?? ""}|${chatId}`;
    const pane = this.panes.get(key);
    if (pane) return pane.reveal(tab);
    const created = new Pane(this, chat, tab);
    this.panes.set(key, created);
    created.onClosed(() => this.panes.delete(key));
  }

  // An answer to what a waiting chat asks (its row, the tab, a notification):
  // through the hook's request, or with keys in its tmux pane; Claude's
  // questions: decision "answer" with the answers
  async answer(chat: ChatRef, decision: Decision, note = "", answers?: Answers): Promise<{ ok: boolean; message: string }> {
    const host = chat.host ?? "";
    const { session } = findPaneRow(this.dash.state(), host, chat.chatId || chat.sessionId);
    const p = session?.state === "waiting" ? session.permission : null;
    if (!session || !p || (p.answer !== "hook" && p.answer !== "keys")) return { ok: false, message: "It isn't asking anything you can answer from here" };
    const args =
      p.answer === "hook" && p.request
        ? ["--answer", p.request]
        : ["--keys", session.sessionId, ...(session.profileDir ? ["--profile", session.profileDir] : [])];
    const given = decision === "answer" ? answersOf(answers) : null;
    if (decision === "answer" && !given) return { ok: false, message: "Choose your answers first" };
    const r = await this.backend.pane([...args, "--decision", decision, ...(note.trim() ? ["--note", note.trim()] : []),
                                        ...(given ? ["--answers", JSON.stringify(given)] : []),
                                        ...(host ? ["--host", host] : configDirArgs())], 60000);
    const answer = { ok: !!r.ok, message: String(r.message ?? "") };
    if (!answer.ok) this.dash.setActionError(`Couldn't answer ${session.name}: ${answer.message}`);
    this.refresh(host);
    return answer;
  }

  // A reply from a notification: sent the way the chat takes one; a chat in a
  // terminal that takes no text opens in its tab with it, to choose there
  async reply(chat: ChatRef, text: string): Promise<void> {
    const answer = await this.send(chat, text, "auto", false);
    if (answer.ask) {
      this.open(chat, "chat");
      this.panes.get(`${chat.host ?? ""}|${chat.chatId || chat.sessionId}`)?.draft(text);
    } else if (!answer.ok) this.dash.setActionError(answer.message);
    else if (answer.message) this.dash.setActionInfo(answer.message);
  }

  // Your message to a chat: typed into this window's terminal it runs in, or
  // as pane.py --send does (tmux, its Claude Code tab's input, the background)
  async send(chat: ChatRef, text: string, how: "auto" | "background" | "copy", afterTurn: boolean): Promise<{ ok: boolean; message: string; ask?: boolean }> {
    text = text.trim();
    if (!text) return { ok: false, message: "Write your message first" };
    if (text.length > TEXT_MAX) return { ok: false, message: "That message is too long" };
    const host = chat.host ?? "";
    const chatId = chat.chatId || chat.sessionId;
    const { session } = findPaneRow(this.dash.state(), host, chatId);
    if (!afterTurn && how === "copy") {
      await vscode.env.clipboard.writeText(text);
      if (session) await this.actions.open(chatRefOf(session, host || undefined));
      return { ok: true, message: "Your message is in the clipboard: paste it into the chat" };
    }
    // in one of this window's terminals: typed in, as a paste, then Enter
    const terminal = !afterTurn ? await this.windowTerminal(session, host) : undefined;
    if (terminal && session) {
      if (session.state === "waiting") return { ok: false, message: "It's asking you something: answer that first" };
      terminal.sendText(`\x1b[200~${text}\x1b[201~`, false);
      await new Promise((r) => setTimeout(r, 300));
      terminal.sendText("\r", false);
      this.refresh(host);
      return { ok: true, message: "Sent (typed into its terminal)" };
    }
    const sid = session?.sessionId ?? chat.sessionId;
    const args = ["--send", chatId, "--text", text, "--how", how, ...(sid ? ["--session", sid] : []),
                  ...(chat.profileDir ? ["--profile", chat.profileDir] : []), ...(afterTurn ? ["--after-turn", "--name", chat.name || ""] : []),
                  ...(host ? ["--host", host] : configDirArgs())];
    const r = await this.backend.pane(args, 180000);
    if (r.ok && r.how === "ask") return { ok: true, message: String(r.message ?? ""), ask: true };
    if (r.ok && r.how === "vscode" && typeof r.link === "string" && r.link.startsWith("vscode://anthropic.claude-code/open?"))
      await vscode.env.openExternal(vscode.Uri.parse(r.link));
    this.refresh(host);
    return { ok: !!r.ok, message: String(r.message ?? "") };
  }

  // The terminal of this window a chat of this computer (or of the host this
  // window is on) runs in, if one does
  private async windowTerminal(session: Session | undefined, host: string): Promise<vscode.Terminal | undefined> {
    if (!session?.pid || session.entrypoint === "claude-vscode" || session.kind === "bg" || session.tmux) return undefined;
    if (host) return undefined; // (an SSH host's: only its pid is known, not its ancestors here)
    return this.terminals.find(localAncestors(session.pid), false);
  }

  refresh(host: string): void {
    void this.dash.refresh();
    if (host) void this.dash.pollHost(host);
  }

  // (for the panes)
  get ext() {
    return { uri: this.extensionUri, backend: this.backend, dash: this.dash, actions: this.actions, log: this.log, panes: this };
  }

  async routeHere(session: Session | undefined, host: string): Promise<boolean> {
    return !!(await this.windowTerminal(session, host));
  }

  dispose(): void {
    for (const p of [...this.panes.values()]) p.dispose();
    this.panes.clear();
  }
}

class Pane implements vscode.Disposable {
  private panel: vscode.WebviewPanel;
  private host: string;
  private chatId: string;
  private chat: ChatRef;
  private stamp = "";
  private limit = LIMIT;
  private loading = false;
  private timer: NodeJS.Timeout | undefined;
  private disposables: vscode.Disposable[] = [];
  private closed = new vscode.EventEmitter<void>();
  readonly onClosed = this.closed.event;
  private ready = false;
  private pendingDraft = "";
  private terminalHere = false;

  constructor(
    private owner: ChatPanes,
    chat: ChatRef,
    tab: "chat" | "review",
  ) {
    this.chat = chat;
    this.host = chat.host ?? "";
    this.chatId = chat.chatId || chat.sessionId;
    const { uri } = owner.ext;
    this.panel = vscode.window.createWebviewPanel("claudeStatus.chat", chat.name || this.chatId.slice(0, 8), vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(uri, "dist")],
    });
    this.panel.iconPath = vscode.Uri.joinPath(uri, "media", "talpa.svg");
    this.panel.webview.html = this.html(tab);
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((m: unknown) => void this.receive(m)),
      this.panel.onDidChangeViewState(() => this.schedule()),
      this.panel.onDidDispose(() => this.dispose()),
      owner.ext.dash.onState(() => void this.pushChat()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("claudeStatus.chatTextScale")) this.post({ type: "textSize", scale: Pane.textScale() });
      }),
    );
  }

  private static textScale(): number {
    return textScale(vscode.workspace.getConfiguration("claudeStatus").get("chatTextScale"));
  }

  reveal(tab: "chat" | "review"): void {
    this.panel.reveal();
    if (tab === "review") void this.loadReview();
    this.post({ type: "result", kind: "tab:" + tab, ok: true, message: "" });
  }

  draft(text: string): void {
    if (this.ready) this.post({ type: "result", kind: "draft", ok: true, message: text, ask: true });
    else this.pendingDraft = text;
  }

  private post(m: PaneHostMessage): void {
    void this.panel.webview.postMessage(m);
  }

  // The chat as the tab shows it, from the extension's state now
  private async pushChat(): Promise<void> {
    const state = this.owner.ext.dash.state();
    const { session, recent } = findPaneRow(state, this.host, this.chatId);
    if (session) this.chat = chatRefOf(session, this.host || undefined);
    else if (recent) this.chat = recentRef(recent, this.host || undefined);
    this.terminalHere = session ? await this.owner.routeHere(session, this.host) : false;
    const item = session ?? (recent ? { ...recent, chatId: recent.sessionId, state: "done" as const } : undefined);
    const queued = queuedReply(state.status, this.chatId, this.host || undefined);
    const chat: PaneChat = {
      host: this.host,
      chatId: this.chatId,
      sessionId: session?.sessionId ?? this.chat.sessionId,
      profileDir: session?.profileDir ?? recent?.profileDir ?? this.chat.profileDir,
      name: session?.name ?? recent?.name ?? this.chat.name,
      cwd: session?.cwd ?? recent?.cwd ?? this.chat.cwd ?? "",
      state: session?.state ?? "done",
      stateText: session ? stateText(session, state.now) : "not running",
      route: this.terminalHere ? "vscodeTerminal" : (session?.reply ?? "background"),
      busy: session?.state === "working" || session?.state === "waiting",
      activity: session?.peek?.activity ?? "",
      permission: session?.state === "waiting" ? (session.permission ?? null) : null,
      changes: (session?.changes ?? recent?.changes)?.count ?? 0,
      reviewPending: item ? reviewPending(item, state.status, this.host || undefined) : false,
      review: session?.review ?? recent?.review ?? null,
      queued: queued ? { id: queued.id, prompt: queued.prompt, error: queued.error } : null,
    };
    this.panel.title = chat.name || this.chatId.slice(0, 8);
    if (this.ready) this.post({ type: "chat", chat });
  }

  // The conversation, again while the tab shows (often for this computer's chats)
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.panel.visible) return;
    this.timer = setTimeout(() => void this.load().finally(() => this.schedule()), this.host ? 5000 : 1500);
  }

  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const r = await this.owner.ext.backend.pane([
        "--conversation", this.chatId, "--limit", String(this.limit), ...(this.stamp ? ["--if-changed", this.stamp] : []),
        ...(this.chat.profileDir ? ["--profile", this.chat.profileDir] : []), ...(this.host ? ["--host", this.host] : configDirArgs()),
      ], this.host ? 60000 : 30000);
      if (r.ok && r.unchanged) return;
      if (r.ok && typeof r.stamp === "string") this.stamp = r.stamp;
      this.post({ type: "conversation", answer: r as never });
    } finally {
      this.loading = false;
    }
  }

  private async loadReview(): Promise<void> {
    const r = await this.owner.ext.backend.pane([
      "--review", this.chatId, ...(this.chat.profileDir ? ["--profile", this.chat.profileDir] : []),
      ...(this.host ? ["--host", this.host] : configDirArgs()),
    ], this.host ? 90000 : 60000);
    this.post({ type: "review", answer: r.ok ? (r as never) : null, error: r.ok ? "" : String(r.message ?? "") });
  }

  private result(kind: string, r: { ok: boolean; message: string; ask?: boolean }): void {
    this.post({ type: "result", kind, ok: r.ok, message: r.message, ...(r.ask ? { ask: true } : {}) });
  }

  private async receive(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== "object") return;
    const m = raw as PaneMessage;
    const { backend, actions } = this.owner.ext;
    const where = this.host ? ["--host", this.host] : configDirArgs();
    const profile = this.chat.profileDir ? ["--profile", this.chat.profileDir] : [];
    switch (m.type) {
      case "ready":
        this.ready = true;
        await this.pushChat();
        await this.load();
        this.schedule();
        if (this.pendingDraft) {
          this.draft(this.pendingDraft);
          this.pendingDraft = "";
        }
        break;
      case "more":
        this.limit = Math.min(LIMIT_MAX, this.limit * 2);
        this.stamp = "";
        await this.load();
        break;
      case "send": {
        if (typeof m.text !== "string" || !["auto", "background", "copy"].includes(m.how)) break;
        const r = await this.owner.send(this.chat, m.text, m.how, m.afterTurn === true);
        this.result(m.afterTurn ? "later" : "send", r);
        this.stamp = "";
        await this.load();
        break;
      }
      case "unqueue": {
        const q = queuedReply(this.owner.ext.dash.state().status, this.chatId, this.host || undefined);
        if (q) await actions.unqueue(q.id);
        break;
      }
      case "answer":
        if (m.decision === "allow" || m.decision === "always" || m.decision === "deny" || m.decision === "answer")
          this.result("answer", await this.owner.answer(this.chat, m.decision, typeof m.note === "string" ? m.note : "",
                                                        answersOf(m.answers) ?? undefined));
        break;
      case "review":
        await this.loadReview();
        break;
      case "diff":
        if (typeof m.path === "string" && !this.host) await this.diff(m.path);
        break;
      case "undo": {
        if (typeof m.path !== "string") break;
        const r = await backend.pane(["--undo", this.chatId, ...(m.path !== "*" ? ["--file", m.path] : []), ...profile, ...where]);
        this.result("undo", { ok: !!r.ok, message: String(r.message ?? "") });
        await this.loadReview();
        this.owner.refresh(this.host);
        break;
      }
      case "commit": {
        if (typeof m.message !== "string" || !m.message.trim()) break;
        const r = await backend.pane(["--commit", this.chatId, "--message", m.message, ...profile, ...where], 180000);
        this.result("commit", { ok: !!r.ok, message: String(r.message ?? "") });
        await this.loadReview();
        break;
      }
      case "reviewed": {
        // (kept on this computer, for a host's chat too)
        const r = await backend.pane(["--reviewed", this.chatId, ...(m.on ? [] : ["--off"]), ...(this.host ? ["--host", this.host] : [])]);
        this.result("reviewed", { ok: !!r.ok, message: String(r.message ?? "") });
        this.owner.refresh(this.host);
        break;
      }
      case "openWindow":
        await actions.open(this.chat);
        break;
      case "copy":
        if (typeof m.text !== "string") break;
        await vscode.env.clipboard.writeText(m.text);
        this.result("copy", { ok: true, message: "Copied" });
        break;
      case "textSize":
        if (typeof m.scale === "number" && Number.isFinite(m.scale))
          await vscode.workspace.getConfiguration("claudeStatus").update("chatTextScale", textScale(m.scale), vscode.ConfigurationTarget.Global);
        break;
    }
  }

  // One file's change, in VS Code's diff editor (this computer's chats)
  private async diff(file: string): Promise<void> {
    const { backend } = this.owner.ext;
    const answer = await backend.changes(this.chatId, this.chat.profileDir, false, configDirArgs());
    const item = answer.comparison?.items.find((i) => i.path === file);
    if (!answer.comparison || !item) {
      this.result("diff", { ok: false, message: answer.message || "No earlier version of that file to compare with" });
      return;
    }
    const error = await openComparison({ ...answer.comparison, title: `${answer.comparison.title}: ${item.label}`, items: [item] });
    if (error) this.result("diff", { ok: false, message: error });
  }

  private html(tab: "chat" | "review"): string {
    const webview = this.panel.webview;
    const { uri } = this.owner.ext;
    const nonce = crypto.randomBytes(16).toString("base64");
    const asset = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(uri, ...p)).toString();
    const config = JSON.stringify({ tab, local: !this.host, scale: Pane.textScale() });
    const csp = [
      "default-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset("dist", "webview-style.css")}">
<title>Claude chat</title>
</head>
<body class="chat-page">
<script nonce="${nonce}">window.CLAUDE_CHAT = ${config.replace(/</g, "\\u003c")};</script>
<script nonce="${nonce}" src="${asset("dist", "chat.js")}"></script>
</body>
</html>`;
  }

  private disposed = false;

  dispose(): void {
    if (this.disposed) return; // (closing the panel calls this again)
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.closed.fire();
    this.closed.dispose();
    this.panel.dispose();
  }
}
