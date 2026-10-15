// The dashboard's derived values, shared by the extension (status bar,
// notifications) and the webview. Ported from the widget's main.qml.

import type { Counts, Group, HostState, LimitWindow, Overall, Session, Status, ViewState } from "./types";

// This computer's accounts, then the hosts' (each marked with its host).
export function allGroups(status: Status | null, hosts: HostState[]): Group[] {
  const out: Group[] = status ? status.groups.slice() : [];
  for (const h of hosts) {
    if (h.result) for (const g of h.result.groups) out.push({ ...g, host: h.name });
  }
  return out;
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
  return w.resetsAt ? `resets in ${duration(w.resetsAt - now)}` : "";
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
