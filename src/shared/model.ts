// The dashboard's derived values, shared by the extension (status bar,
// notifications) and the webview. Ported from the widget's main.qml.

import type { ChangeSummary, ClaudeCodeInfo, Counts, Group, HostState, LimitWindow, Overall, ReopenIn, Session, Status, TaskProgress, ViewState } from "./types";

// This computer's accounts, then the hosts' (each marked with its host).
export function allGroups(status: Status | null, hosts: HostState[]): Group[] {
  const out: Group[] = status ? status.groups.slice() : [];
  for (const h of hosts) {
    if (h.result) for (const g of h.result.groups) out.push({ ...g, host: h.name });
  }
  return out;
}

// A chat with a process of its own can be stopped too (besides background
// sessions), whatever it's doing: in a terminal its claude quits (the chat is
// kept), in a Claude Code tab the tab shows it as interrupted and goes on with
// the next message (the widget's backend: stopping and interrupting chats).
export function canEndChat(s: { kind?: string; pid?: number | null; state?: string; entrypoint?: string }): boolean {
  return s.kind === "interactive" && s.pid != null;
}

// A chat that's working or waiting has something to interrupt (Ctrl+C), where
// it can be pressed: in a terminal of this window, or a tmux pane
export function hasTurn(s: { state?: string }): boolean {
  return s.state === "working" || s.state === "waiting";
}

// The claude command is on the machine a status came from (when unsure: no
// answer yet, or an older backend, it counts as there)
export function cliInstalled(status: Pick<Status, "cli"> | null | undefined): boolean {
  return status?.cli?.installed !== false;
}

// The Claude Code extension can reopen this account's chats: it's in this
// window, on the account its settings give it (an SSH host's: the host's
// ~/.claude, through Remote-SSH)
export function claudeCodeHere(g: Pick<Group, "host" | "vscodeHere" | "profileKeys">, info: ClaudeCodeInfo): boolean {
  if (!info.available) return false;
  return g.host ? !!g.vscodeHere : !!info.profileKey && g.profileKeys.includes(info.profileKey);
}

// Where recent chats reopen: in a Claude Code tab when you picked that, or
// when there's no claude command for a terminal
export function reopensInClaudeCode(prefer: ReopenIn, cliHere: boolean, codeHere: boolean): boolean {
  return codeHere && (prefer === "claudeCode" || !cliHere);
}

// The recent chats' switch: what each half does, or why it's greyed out
export function terminalReopenHint(host: string | undefined, cliHere: boolean): string {
  if (!cliHere)
    return `Claude Code's claude command isn't installed ${host ? `on ${host}` : "here"}: it isn't on PATH, in ~/.local/bin, npm's or nvm's folders, nor on the login shell's PATH.`;
  return host ? `Reopens the chat on ${host} in a terminal (ssh, claude --resume).` : "Reopens the chat in a terminal (claude --resume).";
}

export function claudeCodeReopenHint(g: Pick<Group, "host" | "vscodeHere" | "profileKeys" | "title">, info: ClaudeCodeInfo, groups: Group[]): string {
  if (!info.available) return "The Claude Code extension isn't installed or enabled in this window.";
  if (g.host)
    return g.vscodeHere
      ? `Opens the chat in a Claude Code tab, in a VS Code window connected to ${g.host} (Remote-SSH) on the chat's folder.`
      : `Claude Code on ${g.host} runs on another account (the host's ~/.claude).`;
  if (!claudeCodeHere(g, info)) {
    const on = groups.find((o) => !o.host && !!info.profileKey && o.profileKeys.includes(info.profileKey));
    return `Claude Code runs on ${on ? on.title : info.profileKey || "another account"}, not ${g.title}: switch it with “Use Account for VS Code's Claude…” to reopen this account's chats there.`;
  }
  return "Opens the chat in a Claude Code tab, in the VS Code window that has the chat's folder (opened if it isn't).";
}

export function countStates(groups: Group[]): Counts {
  const c: Counts = { waiting: 0, working: 0, idle: 0, done: 0 };
  for (const g of groups) for (const s of g.sessions) if (s.state in c) c[s.state] += 1;
  return c;
}

export function overallState(groups: Group[], counts: Counts): Overall {
  if (counts.waiting) return "waiting";
  if (counts.working) return "working";
  // finished jobs kept for the record don't count as running
  return groups.some((g) => g.sessions.some((s) => (s.state === "idle" || s.state === "done") && s.pid !== null))
    ? "idle"
    : "none";
}

export function plural(n: number, one: string, many: string): string {
  return (n === 1 ? one : many).replace("%1", String(n));
}

// The hero's headline: the most important thing on the dashboard
export function headlineText(state: Pick<ViewState, "status" | "errorText">, counts: Counts): string {
  if (!state.status && state.errorText) return "Status unavailable";
  if (!state.status) return "Looking for your chats…";
  if (counts.waiting) return plural(counts.waiting, "%1 chat needs you", "%1 chats need you");
  if (counts.working) return plural(counts.working, "%1 chat working", "%1 chats working");
  if (counts.idle) return plural(counts.idle, "Your turn in %1 chat", "Your turn in %1 chats");
  if (counts.done) return plural(counts.done, "%1 finished chat to look at", "%1 finished chats to look at");
  return "All quiet";
}

export function summaryText(counts: Counts): string {
  const parts: string[] = [];
  if (counts.waiting) parts.push(plural(counts.waiting, "%1 needs input", "%1 need input"));
  if (counts.working) parts.push(`${counts.working} working`);
  if (counts.idle) parts.push(`${counts.idle} idle`);
  if (counts.done) parts.push(`${counts.done} done`);
  return parts.length ? parts.join(" · ") : "No sessions running";
}

export function agentsRunning(groups: Group[]): number {
  let n = 0;
  for (const g of groups) for (const s of g.sessions) if (s.agents && s.state !== "done") n += s.agents.running;
  return n;
}

// Clawd's mood for the whole dashboard
export function heroMood(state: Pick<ViewState, "status" | "errorText">, overall: Overall, groups: Group[]): string {
  if (!state.status && state.errorText) return "error";
  if (!state.status) return "loading";
  if (overall === "waiting") return "waving";
  if (overall === "working") return agentsRunning(groups) > 0 ? "working-juggling" : "working-typing";
  if (overall === "idle") return "idle-living";
  return "sleeping";
}

// The 5-hour window shown next to the status bar item: the account with an
// active session, else the one with the freshest numbers.
export function panelWindow(groups: Group[]): { window: LimitWindow; group: Group } | null {
  let best: { window: LimitWindow; group: Group } | null = null;
  let bestScore = -1;
  for (const g of groups) {
    if (!g.limits || !g.limits.windows.length) continue;
    const active = g.sessions.some((s) => s.state === "working" || s.state === "waiting");
    const score = (active ? 1e15 : 0) + g.limits.updatedAt;
    if (score > bestScore) {
      bestScore = score;
      best = { window: g.limits.windows[0], group: g };
    }
  }
  return best;
}

export function maxFiveHour(groups: Group[]): number {
  let m = 0;
  for (const g of groups) for (const w of g.limits ? g.limits.windows : []) if (w.key === "five_hour") m = Math.max(m, w.pct);
  return m;
}

// "work · Team", or "lab: work" for an SSH host's account
export function groupLabel(g: Group): string {
  return g.host ? `${g.host}: ${g.name}` : g.name;
}

// Accounts close to their 5-hour limit, e.g. "work: 100% of the 5-hour limit!"
export function highUsageText(groups: Group[]): string {
  const parts: string[] = [];
  for (const g of groups)
    for (const w of g.limits ? g.limits.windows : [])
      if (w.key === "five_hour" && w.pct >= 90) parts.push(`${groupLabel(g)}: ${Math.round(w.pct)}% of the 5-hour limit!`);
  return parts.join(" ");
}

// A chat's pet key: its conversation, so the pet stays while the row changes
export function petKeyOf(session: Pick<Session, "chatId" | "sessionId" | "key">, host?: string): string {
  return (host ? `ssh:${host}|` : "") + (session.chatId || session.sessionId || session.key);
}

export function firstWaiting(groups: Group[]): { session: Session; group: Group } | null {
  for (const g of groups) for (const s of g.sessions) if (s.state === "waiting") return { session: s, group: g };
  return null;
}

export function reasonText(reason: string): string {
  switch (reason) {
    case "permission":
      return "Asks for permission";
    case "question":
      return "Has a question for you";
    case "network access":
      return "Asks for network access";
    case "goal approval":
      return "Proposes a goal";
    case "":
      return "Waiting for you";
    default:
      return reason;
  }
}

export function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function resetText(w: LimitWindow, now: number): string {
  if (w.reset) return "reset";
  if (!w.resetsAt) return "";
  // The last minute reads "<1m": a rounded "0m" looked stuck
  return `resets in ${w.resetsAt - now < 60000 ? "<1m" : duration(w.resetsAt - now)}`;
}

export function stateText(s: Pick<Session, "state" | "reason" | "since">, now: number): string {
  const since = s.since ? ` · ${duration(now - s.since)}` : "";
  const reason = s.reason ? ` · ${s.reason}` : "";
  switch (s.state) {
    case "waiting":
      return "Needs input" + reason;
    case "working":
      return "Working" + reason + since;
    case "done":
      return (s.reason === "failed" ? "Failed" : s.reason === "stopped" ? "Stopped" : "Done") + since;
    default:
      return "Idle" + since;
  }
}

export function formatTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "just now";
  return `${duration(ms)} ago`;
}

// "high" ≥ 90 %, "medium" ≥ 70 %, else "low" (red / orange / accent)
export function usageLevel(pct: number): "high" | "medium" | "low" {
  return pct >= 90 ? "high" : pct >= 70 ? "medium" : "low";
}

// The same quoting as Python's shlex.quote, so commands built here match the
// backend's.
export function shellQuote(s: string): string {
  if (s === "") return "''";
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\"'\"'") + "'";
}

// Tooltip lines: the summary, then each account's limits
export function tooltipLines(groups: Group[], counts: Counts, hosts: HostState[]): string[] {
  const lines = [summaryText(counts)];
  for (const g of groups) {
    if (!g.limits) continue;
    lines.push(
      (g.host ? g.host + ": " : "") + g.title + ": " + g.limits.windows.map((w) => `${w.label} ${Math.round(w.pct)}%`).join(" · "),
    );
  }
  for (const h of hosts) if (h.error) lines.push(`${h.name}: not reachable`);
  return lines;
}

// ---------------------------------------------------------------- a peek at a chat

// The line under a chat's folder: what it's doing (working), what it needs
// (waiting), its result (a finished background session) or what Claude said
// last (your turn, done)
export function peekLine(
  s: Pick<Session, "state" | "detail" | "reason" | "peek" | "tasks">,
): { kind: "activity" | "needs" | "result" | "reply"; text: string } | null {
  const peek = s.peek;
  if (s.state === "working") {
    const what = peek?.activity || s.tasks?.current || "";
    return what ? { kind: "activity", text: `▸ ${what}` } : null;
  }
  if (s.state === "waiting") return { kind: "needs", text: s.detail || peek?.activity || reasonText(s.reason) };
  if (s.state === "done" && s.detail) return { kind: "result", text: s.detail };
  return peek?.replyLine ? { kind: "reply", text: `Claude: ${peek.replyLine}` } : null;
}

// Something to unfold under the row: the last exchange, tasks or changed files
export function hasPeek(s: Pick<Session, "peek" | "tasks" | "changes">): boolean {
  return !!(s.peek && (s.peek.prompt || s.peek.reply)) || !!s.tasks?.items.length || !!s.changes;
}

export function taskMark(status: string): string {
  return status === "completed" ? "✓" : status === "in_progress" ? "▸" : "○";
}

export function tasksTitle(t: TaskProgress): string {
  const head = `Tasks: ${t.done} of ${t.total} done` + (t.current ? ` · now: ${t.current}` : "");
  return [head, ...t.items.map((i) => `${taskMark(i.status)} ${i.subject}`)].join("\n");
}

export function changesTitle(c: ChangeSummary, host?: string): string {
  const more = c.count > c.files.length ? `\n…and ${c.count - c.files.length} more` : "";
  const what = host
    ? `\nThey're on ${host}: compare them there.`
    : "\nClick to compare them with what they were before the chat, side by side (VS Code's changes view).";
  return `Files this chat changed (${c.count}):\n${c.files.join("\n")}${more}${what}`;
}

// ---------------------------------------------------------------- usage forecast

function percent(n: number): string {
  return `${Math.round(n * 10) / 10}%`;
}

// "At this pace: full in 1h 20m (resets in 2h 5m)", when a plan window would
// run out before it resets
export function forecastWarning(w: LimitWindow, now: number): string {
  const f = w.forecast;
  if (!f || f.fullAt === null || !w.resetsAt || w.reset) return "";
  return `At this pace: full in ${duration(f.fullAt - now)} (resets in ${duration(w.resetsAt - now)})`;
}

export function forecastTitle(w: LimitWindow, now: number): string {
  const f = w.forecast;
  if (!f || w.reset) return "";
  const pace = f.basis === "hour" ? `${percent(f.rate)} an hour over the last hour` : `${percent(f.rate)} an hour so far in this window`;
  const where =
    f.fullAt !== null && w.resetsAt
      ? `full in ${duration(f.fullAt - now)}, ${duration(w.resetsAt - f.fullAt)} before it resets`
      : `about ${Math.round(f.atReset)}% when it resets${w.resetsAt ? ` in ${duration(w.resetsAt - now)}` : ""}`;
  return `At this pace (${pace}): ${where}.\nAn even pace through the window would be at ${Math.round(f.evenPct)}% by now.`;
}

// ---------------------------------------------------------------- the chat that needs you

// A row's key as the transition tracker keeps it ("ssh:<host>|<key>" for a host's)
export function trackKey(s: Pick<Session, "key" | "sessionId">, host?: string): string {
  return (host ? `ssh:${host}|` : "") + (s.key || s.sessionId);
}

export interface ChatSpot {
  id: string; // trackKey
  session: Session;
  host?: string;
}

// The chats that need you, most urgent first: the waiting ones (the one
// waiting longest first), then the ones that finished a turn you haven't
// looked at yet (unseen: trackKey -> when; newest first)
export function chatsNeedingYou(groups: Group[], unseen: ReadonlyMap<string, number>): ChatSpot[] {
  const waiting: ChatSpot[] = [];
  const finished: { spot: ChatSpot; at: number }[] = [];
  for (const g of groups)
    for (const s of g.sessions) {
      const spot = { id: trackKey(s, g.host), session: s, host: g.host };
      if (s.state === "waiting") waiting.push(spot);
      else if (unseen.has(spot.id) && (s.state === "idle" || s.state === "done")) finished.push({ spot, at: unseen.get(spot.id)! });
    }
  waiting.sort((a, b) => (a.session.since ?? 0) - (b.session.since ?? 0));
  finished.sort((a, b) => b.at - a.at);
  return [...waiting, ...finished.map((f) => f.spot)];
}

// Which one a press of the shortcut goes to: the first, or (pressed again
// soon) the one after the last it went to
export function nextChatIndex(list: ChatSpot[], last: { id: string; at: number } | null, now: number, againMs = 30000): number {
  if (!list.length) return -1;
  if (!last || now - last.at > againMs) return 0;
  const i = list.findIndex((c) => c.id === last.id);
  return i < 0 ? 0 : (i + 1) % list.length;
}
