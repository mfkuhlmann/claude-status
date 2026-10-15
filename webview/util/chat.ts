// Keys, chat references and per-row rules shared by the components. The
// extension does the work (open, stop, share, menus); the webview only says
// which chat, as a ChatRef.

import { petKeyOf } from "../../src/shared/model";
import type { ChatRef, Group, RecentChat, Session, SharedPointer, Status } from "../../src/shared/types";
import type { StageChat } from "../pets/api";

// An account's key: ids are only unique per machine
export function groupKeyOf(g: Group): string {
  return (g.host ? g.host + "/" : "") + g.id;
}

// A row's key, for UI state kept across polls (open subagent trees)
export function rowKeyOf(s: Pick<Session, "key">, host?: string): string {
  return (host ? host + "|" : "") + s.key;
}

export function chatRefOf(s: Session, host?: string): ChatRef {
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
    // a fork of a shared chat is a chat of its own
    shared: !!s.shared && !s.shared.forkOf,
  };
}

export function recentRef(c: RecentChat, host?: string): ChatRef {
  return {
    host,
    key: c.key,
    sessionId: c.sessionId,
    chatId: c.sessionId,
    profileDir: c.profileDir,
    name: c.name,
    cwd: c.cwd,
    kind: "chat",
    openCommand: c.openCommand ?? null,
    shared: c.shared,
  };
}

export function sharedRef(p: SharedPointer, host?: string): ChatRef {
  return {
    host,
    key: p.key,
    sessionId: p.sessionId,
    chatId: p.sessionId,
    profileDir: p.profileDir,
    name: p.name,
    openCommand: p.openCommand ?? null,
    shared: true,
  };
}

// The account's chats for its pet stage: the ones that need you or work
// first, one per conversation (a chat can have a running and a finished row)
export function stageChats(g: Group): StageChat[] {
  const rank: Record<string, number> = { waiting: 0, working: 1, idle: 2, done: 3 };
  const seen = new Set<string>();
  const out: { chat: StageChat; order: number }[] = [];
  for (const s of g.sessions) {
    const key = petKeyOf(s, g.host);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ chat: g.host ? { key, session: s, host: g.host } : { key, session: s }, order: out.length });
  }
  out.sort((a, b) => (rank[a.chat.session.state] ?? 4) - (rank[b.chat.session.state] ?? 4) || a.order - b.order);
  return out.map((o) => o.chat);
}

export function fiveHourOf(g: Group): number {
  const w = g.limits?.windows.find((w) => w.key === "five_hour");
  return w ? w.pct : 0;
}

// A working chat whose context is nearly full and that has no pet of its own
// to show it; the hero says it now and then
export function contextFullText(groups: Group[], petColor: (key: string) => string): string {
  for (const g of groups)
    for (const s of g.sessions)
      if (s.state === "working" && s.context !== null && s.context >= 85 && petColor(petKeyOf(s, g.host)) === "")
        return `${s.name}: context ${Math.round(s.context)}% full`;
  return "";
}

// A finished chat on this computer can be shared, continued on another
// account or kept on one; not while a session has it open.
export function canShare(s: Session, host: string | undefined, status: Status | null): boolean {
  return (
    !!status?.canShare &&
    !host &&
    s.pid === null &&
    s.state === "done" &&
    !!s.chatId &&
    status.groups.filter((g) => !!g.shareProfile).length >= 2
  );
}

export function canShareRecent(host: string | undefined, status: Status | null): boolean {
  return !!status?.canShare && !host && status.groups.filter((g) => !!g.shareProfile).length >= 2;
}

// Removing only hides a finished row; a running one would come right back
export function canRemove(s: Session): boolean {
  return s.state === "done" && s.pid === null;
}

// Background jobs with a running process (`claude stop`); a host's come with
// the command that stops them there
export function canStop(s: Session, host?: string): boolean {
  return !!s.stopCommand || (!host && !!s.jobId && s.pid !== null);
}

export function isBackground(s: Session): boolean {
  return s.kind === "bg" || s.kind === "job";
}

export function openHint(s: Session, host?: string): string {
  if (host) {
    if (s.entrypoint === "claude-vscode" && !s.openCommand) return `Show this conversation in VS Code (connected to ${host})`;
    if (!s.openCommand) return `Switch to the terminal with the ssh session to ${host}`;
    if (s.kind === "chat") return `Reopen this chat on ${host} in a terminal (ssh)`;
    return `Open this background session on ${host} in a terminal (ssh)`;
  }
  if (s.entrypoint === "claude-vscode") return "Open this conversation in VS Code";
  if (s.kind === "chat") return "Reopen this chat in a terminal (claude --resume)";
  if (isBackground(s) && s.pid === null) return "Reopen this background session in a terminal";
  if (isBackground(s)) return "Show this background session in a terminal";
  return "Switch to the terminal running this session";
}

export function sharedTagTitle(s: Session): string {
  const info = s.shared;
  if (!info) return "";
  const profiles = info.profiles.join(" + ");
  const stopped = info.stoppedCopies?.length
    ? `\nIts background session on ${info.stoppedCopies.join(", ")} was stopped; ${info.stoppedCopies.join(", ")} shows a link to this ${info.forkOf ? "copy" : "chat"}.`
    : "";
  if (info.forkOf)
    return (
      `Copy of a shared chat\nA copy of a chat shared between the ${profiles} profiles: Claude forked it into a chat of its own on ${s.profile}, so new messages here are only on ${s.profile}.` +
      (info.movedHere ? "\nThe shared chat continued here, so it isn't listed itself." : "") +
      stopped
    );
  return (
    `Shared chat\nThis chat is shared between the ${profiles} profiles: it continues on whichever account you open it with. Only one session can have it open at a time.` +
    (s.kind === "chat" ? `\nListed here because it was used on ${s.profile} last.` : "") +
    (info.openIn ? `\nOpen in ${info.openIn} right now.` : "") +
    stopped
  );
}
