// The chat tab (src/chatPane.ts, webview/chat.tsx): one chat's conversation
// as the widget's pane.py reads it, a box to reply, what it asks while it
// waits for a permission, and its review (what it changed, Undo, Commit,
// Mark reviewed). Shared by the extension and the tab's page.

import type { Decision, PermissionAsk, QueuedTask, RecentChat, Review, Session, SessionState, Status } from "./types";

// One item of a chat's conversation (pane.py: conversation_items)
export interface PaneItem {
  kind: "you" | "claude" | "tool" | "note";
  key: string; // the same in the next answer, while it's listed
  text?: string; // you, claude (markdown), note
  name?: string; // tool: its name, e.g. "Bash"
  line?: string; // tool: one line, e.g. "Bash: npm test"
  status?: "ok" | "error" | "open"; // tool: how it went ("open": no result yet)
  input?: string; // tool: what it ran or changed
  output?: string; // tool: what came back
  summary?: string; // tool: what came of it, in a line ("3 lines", "1 failed", …)
  error?: boolean; // note: an API error (a usage limit…)
  at: number | null;
}

export interface Conversation {
  ok: boolean;
  message?: string;
  unchanged?: boolean; // as in the last answer (--if-changed)
  chatId?: string;
  profileDir?: string;
  name?: string;
  cwd?: string;
  items?: PaneItem[];
  more?: boolean; // there are older items
  stamp?: string;
  mode?: string | null;
}

// One file a chat changed (pane.py: chat_review)
export interface ReviewFile {
  label: string;
  path: string;
  added: number | null;
  removed: number | null;
  diff: string[];
  created: boolean;
  deleted: boolean;
  binary: boolean;
  unknown: boolean; // no earlier version is kept: it can't be undone
}

export interface ReviewAnswer {
  ok: boolean;
  message: string; // the commit message it suggests (or why it failed)
  files: ReviewFile[];
  tests: Review["tests"];
  editedAt: number | null;
  repos: string[];
  reviewedAt?: number | null;
}

// The chat as the tab shows it: its row now (or what the tab was opened with)
export interface PaneChat {
  host: string;
  chatId: string;
  sessionId: string;
  profileDir: string;
  name: string;
  cwd: string;
  state: SessionState;
  stateText: string;
  route: Session["reply"] | "vscodeTerminal"; // vscodeTerminal: one of this window's terminals (it types it in)
  busy: boolean; // working or waiting
  activity: string; // what it does now
  permission: PermissionAsk | null;
  changes: number; // files it changed
  reviewPending: boolean;
  review: Review | null;
  queued: { id: string; prompt: string; error: string } | null; // a reply waiting for its turn to end
}

// extension -> tab
export type PaneHostMessage =
  | { type: "chat"; chat: PaneChat }
  | { type: "conversation"; answer: Conversation }
  | { type: "review"; answer: ReviewAnswer | null; error: string }
  | { type: "result"; kind: string; ok: boolean; message: string; ask?: boolean } // ask: its terminal takes no text: choose
  | { type: "textSize"; scale: number }; // claudeStatus.chatTextScale

// tab -> extension
export type PaneMessage =
  | { type: "ready" }
  | { type: "more" } // older items too
  | { type: "send"; text: string; how: "auto" | "background" | "copy"; afterTurn: boolean }
  | { type: "unqueue" } // the reply waiting for the turn to end
  | { type: "answer"; decision: Decision; note: string }
  | { type: "review" }
  | { type: "diff"; path: string } // a file's change in VS Code's diff editor
  | { type: "undo"; path: string } // "*": all of them
  | { type: "commit"; message: string }
  | { type: "reviewed"; on: boolean }
  | { type: "openWindow" }
  | { type: "copy"; text: string } // a code block of a reply, to the clipboard
  | { type: "textSize"; scale: number }; // A− / A+: claudeStatus.chatTextScale

// The tab's text size, times VS Code's font size (claudeStatus.chatTextScale)
export const TEXT_SCALES = [0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];
export function textScale(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(2, Math.max(0.8, value)) : 1.15;
}

// The key of a chat's mark in status.reviewed
export function reviewKey(chatId: string, host?: string): string {
  return host ? `${host}|${chatId}` : chatId;
}

// Finished, changed files, not marked reviewed since (0: marked not
// reviewed); what chats changed before the widget first looked isn't to review
export function reviewPending(
  item: { review?: Review | null; state?: SessionState; chatId?: string; sessionId: string },
  status: Status | null | undefined,
  host?: string,
): boolean {
  const edited = item.review?.editedAt;
  if (!edited || item.state === "working" || item.state === "waiting") return false;
  const mark = status?.reviewed?.[reviewKey(item.chatId || item.sessionId, host)];
  const seen = mark === 0 ? 0 : Math.max(mark ?? 0, status?.reviewedSince ?? 0);
  return seen < edited;
}

// The reply waiting for a chat's turn to end (pane.py --send --after-turn)
export function queuedReply(status: Status | null | undefined, chatId: string, host?: string): QueuedTask | null {
  return status?.queue?.find((t) => t.afterTurn && t.chat === chatId && (t.host || "") === (host || "")) ?? null;
}

// The tests badge: "tests ✓", "tests ✗" or "not tested" (since the last edit)
export function testsText(review: Review | null | undefined): { text: string; title: string; ok: boolean | null } | null {
  if (!review) return null;
  const run = review.tests;
  if (!run) return { text: "not tested", title: "Claude ran no test command (pytest, npm test, cargo test, …) after it last changed a file.", ok: null };
  return run.ok
    ? { text: "tests ✓", title: `Tests passed after its last edit: ${run.command}`, ok: true }
    : { text: "tests ✗", title: `Tests failed after its last edit: ${run.command}`, ok: false };
}

// How a reply reaches the chat, in a sentence
export function routeHint(route: PaneChat["route"], hasProcess: boolean, kind: string, host: string): string {
  const where = host ? ` (on ${host})` : "";
  switch (route) {
    case "tmux":
      return `Typed into its tmux pane.${where}`;
    case "vscodeTerminal":
      return "Typed into its terminal in this window.";
    case "vscode":
      return `Goes into the chat's input in its Claude Code tab: press Enter there.${where}`;
    case "terminal":
      return `Its terminal takes no text from outside: send it, and Claude there quits and the chat goes on in the background, or copy it and open its terminal.${where}`;
    default:
      return hasProcess && kind === "bg"
        ? `Its background session stops, then goes on with your message.${where}`
        : `The chat goes on in the background with your message.${where}`;
  }
}

// A recent chat as a row the tab can show (it has no process: finished)
export function recentAsRow(c: RecentChat): Pick<Session, "sessionId" | "chatId" | "profileDir" | "name" | "cwd" | "state" | "pid" | "kind"> & {
  review?: Review | null;
  changes?: RecentChat["changes"];
} {
  return { sessionId: c.sessionId, chatId: c.sessionId, profileDir: c.profileDir, name: c.name, cwd: c.cwd, state: "done", pid: null,
           kind: "chat", review: c.review ?? null, changes: c.changes ?? null };
}
