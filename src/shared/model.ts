// The dashboard's derived values, shared by the extension (status bar,
// notifications) and the webview. Ported from the widget's main.qml.

import type { Agent, ChangeSummary, ChatRef, ChatStats, ClaudeCodeInfo, Counts, Group, HostState, Limits, LimitWindow, Overall, Overlap, PlanItem, QueuedTask, RecentChat, ReopenIn, Session, SharedPointer, SshUsage, StatsDay, Status, Stop, TaskProgress, UsageStats, ViewState } from "./types";

// This computer's accounts and the hosts', for the counts, the badge and
// what needs you. A host whose last check failed still shows what it said
// before (dimmed), but that doesn't count here: you can't reach its chats.
export function allGroups(status: Status | null, hosts: HostState[]): Group[] {
  const out: Group[] = status ? status.groups.slice() : [];
  for (const h of hosts) {
    if (h.result && !h.error) for (const g of h.result.groups) out.push({ ...g, host: h.name });
  }
  return out;
}

// ---------------------------------------------------------------- the chat a click means

// What the webview says when you click a chat (the extension does the work)
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
    state: s.state,
    tmux: !!s.tmux,
    jobId: s.jobId,
    openCommand: s.openCommand ?? null,
    stopCommand: s.stopCommand ?? null,
    vscodeTerminal: s.vscodeTerminal ?? null,
    // a fork of a shared chat is a chat of its own
    shared: !!s.shared && !s.shared.forkOf,
    plan: s.plan ? { slug: s.plan.slug, path: s.plan.path } : null,
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

// The chat a click from the webview means, as the extension knows it now:
// found by host and row key, so the commands it runs are its own (from the
// status), never ones the page sent. null when it's gone (or never was).
export function findChatRef(status: Status | null, hosts: HostState[], host: unknown, key: unknown): ChatRef | null {
  if (typeof key !== "string" || !key || (host !== undefined && host !== null && typeof host !== "string")) return null;
  const where = host ? hosts.find((h) => h.name === host)?.result : status;
  for (const g of where?.groups ?? []) {
    const h = host ? (host as string) : undefined;
    for (const s of g.sessions ?? []) if (s.key === key) return chatRefOf(s, h);
    for (const c of g.recent ?? []) if (c.key === key) return recentRef(c, h);
    for (const p of g.sharedHere ?? []) if (p.key === key) return sharedRef(p, h);
  }
  return null;
}

// A host's answer on this computer's clock: its times ("since", "last
// active", resets) are its own clock's, which may be off from ours
export function toLocalClock(result: Status, offset: number): Status {
  if (Math.abs(offset) < 5000) return result; // network delay, or close enough
  const at = (t: unknown) => (typeof t === "number" ? t + offset : t);
  const shift = (o: Record<string, unknown> | null | undefined, keys: string[]) => {
    if (o) for (const k of keys) o[k] = at(o[k]);
  };
  const out = JSON.parse(JSON.stringify(result)) as Status;
  out.generatedAt = at(out.generatedAt) as number;
  for (const g of out.groups ?? []) {
    for (const s of g.sessions ?? []) {
      shift(s as unknown as Record<string, unknown>, ["since", "startedAt"]);
      shift(s.peek as unknown as Record<string, unknown>, ["at"]);
      shift(s.peek?.recap as unknown as Record<string, unknown>, ["at"]);
      shift(s.stopped as unknown as Record<string, unknown>, ["at", "resetsAt"]);
      shift(s.plan as unknown as Record<string, unknown>, ["updatedAt"]);
      shift(s.stats as unknown as Record<string, unknown>, ["startedAt", "lastAt"]);
      for (const a of s.agents?.tree ?? []) shift(a as unknown as Record<string, unknown>, ["started", "updated"]);
    }
    for (const c of g.recent ?? []) {
      shift(c as unknown as Record<string, unknown>, ["lastActive"]);
      shift(c.recap as unknown as Record<string, unknown>, ["at"]);
      shift(c.stopped as unknown as Record<string, unknown>, ["at", "resetsAt"]);
    }
    for (const c of g.sharedHere ?? []) shift(c as unknown as Record<string, unknown>, ["lastActive", "since"]);
    for (const p of g.plans ?? []) shift(p as unknown as Record<string, unknown>, ["updatedAt"]);
    if (g.limits) {
      shift(g.limits as unknown as Record<string, unknown>, ["updatedAt"]);
      for (const w of g.limits.windows ?? []) {
        shift(w as unknown as Record<string, unknown>, ["resetsAt"]);
        shift(w.forecast as unknown as Record<string, unknown>, ["fullAt"]);
      }
    }
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

// The status of the machine a chat is on: this computer's, or an SSH host's
// last good answer
export function machineStatus(state: Pick<ViewState, "status" | "hosts">, host?: string): Status | null | undefined {
  return host ? state.hosts.find((h) => h.name === host)?.result : state.status;
}

// The accounts a chat can move between: those of its own machine (this
// computer, or the SSH host it's on), when that machine can share
export function shareAccounts(status: Pick<Status, "canShare" | "groups"> | null | undefined): Group[] {
  return status?.canShare ? status.groups.filter((g) => !!g.shareProfile) : [];
}

// The Claude Code extension can reopen this account's chats: it's in this
// window, on the account its settings give it (an SSH host's: the host's
// ~/.claude, through Remote-SSH)
export function claudeCodeHere(g: Pick<Group, "host" | "vscodeHere" | "profileKeys">, info: ClaudeCodeInfo): boolean {
  if (!info.available) return false;
  return g.host ? !!g.vscodeHere : !!info.profileKey && (g.profileKeys ?? []).includes(info.profileKey);
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
      : `Claude Code on ${g.host} runs on another account: a new chat in its Claude Code chat tab on this one switches it, in a window connected to ${g.host}.`;
  if (!claudeCodeHere(g, info)) {
    const on = groups.find((o) => !o.host && !!info.profileKey && (o.profileKeys ?? []).includes(info.profileKey));
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
// hostsAnswered: SSH hosts' chats count while this computer's status is missing
// held: idle chats that wait for a usage limit to reset, not for you (heldByLimits)
export function headlineText(state: Pick<ViewState, "status" | "errorText">, counts: Counts, hostsAnswered = false, held = 0): string {
  if (!state.status && !hostsAnswered && state.errorText) return "Status unavailable";
  if (!state.status && !hostsAnswered) return "Looking for your chats…";
  if (counts.waiting) return plural(counts.waiting, "%1 chat needs you", "%1 chats need you");
  if (counts.working) return plural(counts.working, "%1 chat working", "%1 chats working");
  if (counts.idle > held) return plural(counts.idle - held, "Your turn in %1 chat", "Your turn in %1 chats");
  if (held) return plural(held, "%1 chat waits for its usage limit", "%1 chats wait for their usage limit");
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
  const answered = !!state.status || groups.length > 0; // a host's chats count too
  if (!answered && state.errorText) return "error";
  if (!answered) return "loading";
  if (overall === "waiting") return "waving";
  if (overall === "working") return agentsRunning(groups) > 0 ? "working-juggling" : "working-typing";
  if (overall === "idle") return "idle-living";
  return "sleeping";
}

// Plan usage is the account's, whichever machine it's used on. An account on
// several (this computer and SSH hosts: the same id) shows it once, where
// it's listed first, with the newest numbers of them all ("once"); "all"
// shows each machine's own, "none" no host's. As the widget (main.qml: withUsage).
export function shareUsage(
  status: Status | null,
  hosts: HostState[],
  mode: SshUsage,
): { status: Status | null; hosts: HostState[] } {
  if (mode === "all") return { status, hosts };
  const owners = new Map<string, { host: string; limits: Limits | null; from: string }>();
  const note = (g: Group, host: string) => {
    let o = owners.get(g.id);
    if (!o) owners.set(g.id, (o = { host, limits: null, from: "" }));
    if (g.limits && (!o.limits || g.limits.updatedAt > o.limits.updatedAt)) {
      o.limits = g.limits;
      o.from = host;
    }
  };
  for (const g of status?.groups ?? []) note(g, "");
  for (const h of hosts) for (const g of h.result?.groups ?? []) note(g, h.name);
  // limitsHidden where it shows elsewhere (or no host's does), limitsFrom
  // when the numbers come from another machine
  const shown = (g: Group, host: string): Group => {
    const o = owners.get(g.id);
    if (host && (mode === "none" || (o && o.host !== host))) return { ...g, limits: null, limitsHidden: true };
    return !o || o.from === host ? g : { ...g, limits: o.limits, limitsFrom: o.from };
  };
  return {
    status: status && { ...status, groups: status.groups.map((g) => shown(g, "")) },
    hosts: hosts.map((h) => (h.result ? { ...h, result: { ...h.result, groups: h.result.groups.map((g) => shown(g, h.name)) } } : h)),
  };
}

// The account VS Code's Claude runs on in this window: this computer's, or
// in a Remote-SSH window the host's (what its VS Code server's settings say)
export function claudeCodeGroup(groups: Group[], hosts: HostState[], info: ClaudeCodeInfo): Group | undefined {
  const current = hosts.find((h) => h.current);
  return current
    ? groups.find((g) => g.host === current.name && g.vscodeHere)
    : groups.find((g) => !g.host && claudeCodeHere(g, info));
}

// The 5-hour window shown next to the status bar item: the account VS Code's
// Claude runs on (preferId, from claudeCodeGroup: its numbers may show on
// another machine's copy, shareUsage), else the account with an active
// session, else the one with the freshest numbers.
export function panelWindow(groups: Group[], preferId?: string): { window: LimitWindow; group: Group } | null {
  const preferred = preferId ? groups.find((g) => g.id === preferId && g.limits?.windows.length) : undefined;
  if (preferred) return { window: preferred.limits!.windows[0], group: preferred };
  let best: { window: LimitWindow; group: Group } | null = null;
  let bestScore = -1;
  for (const g of groups) {
    if (!g.limits || !g.limits.windows.length) continue;
    const active = g.sessions.some((s) => s.state === "working" || s.state === "waiting");
    const score = (active ? 1e15 : 0) + (Number.isFinite(g.limits.updatedAt) ? g.limits.updatedAt : 0);
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
// Why NAME can't be a new account (~/.claude-NAME; accounts.py says the same
// and checks again), or "". folders: the accounts' folders now (~/.claude-work)
export function accountNameProblem(name: string, folders: string[]): string {
  if (!name) return "Give the account a name";
  if (name === "default" || name === "main") return `${name} is taken: main is what ~/.claude is called, default marks the default account`;
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name)) return "Up to 32 letters, digits, - and _, starting with a letter";
  if (folders.includes(`~/.claude-${name}`)) return `There's an account called ${name} already`;
  return "";
}

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

// A chat's key: its account and conversation, so its pet, its notifications
// and whether you've seen it stay the same while its row changes (e.g. a
// background session's row from running to finished, …/live to …/job). A
// chat shared with two accounts is two chats here.
export function petKeyOf(session: Pick<Session, "chatId" | "sessionId" | "key"> & { profileDir?: string }, host?: string): string {
  return `${host ? `ssh:${host}|` : ""}${session.profileDir ?? ""}/${session.chatId || session.sessionId || session.key}`;
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

export function stateText(s: Pick<Session, "state" | "reason" | "since"> & { stopped?: Stop | null }, now: number): string {
  const since = s.since ? ` · ${duration(now - s.since)}` : "";
  const reason = s.reason ? ` · ${s.reason}` : "";
  if (s.stopped && (s.state === "idle" || s.state === "done")) {
    if (s.stopped.kind === "login") return "Login expired";
    if (s.stopped.over) return "Limit reset · go on";
    return s.stopped.resetsAt
      ? `Limit · resets in ${s.stopped.resetsAt - now < 60000 ? "<1m" : duration(s.stopped.resetsAt - now)}`
      : "Hit a usage limit";
  }
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
  s: Pick<Session, "state" | "detail" | "reason" | "peek" | "tasks"> & { stopped?: Stop | null },
): { kind: "activity" | "needs" | "result" | "reply" | "recap" | "stopped"; text: string } | null {
  const peek = s.peek;
  if (s.state === "working") {
    const what = peek?.activity || s.tasks?.current || "";
    return what ? { kind: "activity", text: `▸ ${what}` } : null;
  }
  if (s.state === "waiting") return { kind: "needs", text: s.detail || peek?.activity || reasonText(s.reason) };
  // what stopped it (a usage limit), then a background session's result,
  // Claude's recap of the chat, what Claude said last
  if (s.stopped) return { kind: "stopped", text: stopText(s.stopped) };
  if (s.state === "done" && s.detail) return { kind: "result", text: s.detail };
  if (peek?.recap?.text) return { kind: "recap", text: `Recap: ${peek.recap.text.split("\n")[0]}` };
  return peek?.replyLine ? { kind: "reply", text: `Claude: ${peek.replyLine}` } : null;
}

// Something to unfold under the row: the last exchange, tasks or changed files
export function hasPeek(s: Pick<Session, "peek" | "tasks" | "changes"> & { stats?: Session["stats"] }): boolean {
  return !!(s.peek && (s.peek.prompt || s.peek.reply || s.peek.recap)) || !!s.tasks?.items.length || !!s.changes || !!s.stats;
}

// ---------------------------------------------------------------- what stopped a chat

// The line under a chat that something stopped
export function stopText(stop: Stop): string {
  if (stop.kind === "login") return "Claude's login expired. Log in again (/login), then tell it to go on.";
  if (stop.over) return "The limit it hit has reset: open it and tell Claude to go on.";
  return stop.text;
}

// Idle chats a usage limit stopped (until it resets): they wait for the
// limit, not for you
export function heldByLimits(groups: Group[]): number {
  let n = 0;
  for (const g of groups)
    for (const s of g.sessions) if (s.state === "idle" && s.stopped?.kind === "limit" && !s.stopped.over) n += 1;
  return n;
}

// Another account of the chat's machine with room left in the limit that
// stopped it (the most, where known), to continue it there; null when there's
// none, or the chat can't move now. Not for a chat open in a Claude Code tab
// (the tab would start it again here with your next message), one that's at
// work again, or a session that continues another chat (the one with the
// chat's own id would be ended, not this one).
export function handoverTarget(
  s: Pick<Session, "stopped" | "chatId" | "sessionId" | "pid" | "entrypoint" | "state" | "profileDir">,
  accounts: Group[],
): { title: string; shareProfile: string; pct: number | null; label: string } | null {
  const stop = s.stopped;
  if (!stop || stop.kind !== "limit" || stop.over || !s.chatId) return null;
  if (s.pid !== null && (s.entrypoint === "claude-vscode" || s.state !== "idle" || s.sessionId !== s.chatId)) return null;
  let best: { title: string; shareProfile: string; pct: number | null; label: string } | null = null;
  for (const g of accounts) {
    if (!g.shareProfile || (g.profileKeys ?? []).includes(s.profileDir)) continue;
    const w = g.limits?.windows.find((x) => x.key === (stop.window || "five_hour"));
    const pct = w ? w.pct : null;
    if (pct !== null && pct >= 95) continue;
    if (!best || (pct !== null && (best.pct === null || pct < best.pct)))
      best = { title: g.title, shareProfile: g.shareProfile, pct, label: w ? w.label : "" };
  }
  return best;
}

// When a chat a usage limit stopped can go on by itself (a minute after the
// limit resets: jump.py --queue-continue), in ms, or 0. Not one open in
// VS Code's Claude (its tab can't be ended), nor one at work again.
export function goOnAt(s: { stopped?: Stop | null; chatId?: string; sessionId: string; pid?: number | null; entrypoint?: string; state?: string }): number {
  const stop = s.stopped;
  if (!stop || stop.kind !== "limit" || stop.over || !stop.resetsAt || !(s.chatId || s.sessionId)) return 0;
  if (s.pid != null && (s.entrypoint === "claude-vscode" || s.state !== "idle" || s.sessionId !== s.chatId)) return 0;
  return stop.resetsAt + 60_000;
}

// The queued task that goes on with this chat (here, or on host), or null
export function queuedChat(status: Status | null, chatId: string, host?: string): QueuedTask | null {
  return (status?.queue ?? []).find((t) => !!t.chat && t.chat === chatId && (t.host || "") === (host || "")) ?? null;
}

// What a queued task does, in a line
export function queuedWhat(t: QueuedTask): string {
  return t.chat ? `Go on with “${t.name || t.chat.slice(0, 8)}”` : t.planTitle ? `Carry out “${t.planTitle}”${t.prompt ? `: ${t.prompt}` : ""}` : t.prompt;
}

export function clockText(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// When the usage limit an account is at resets (the latest of its full
// windows, else of the chats a limit stopped), or null
export function limitReset(g: Pick<Group, "limits" | "sessions">, now: number): { at: number; label: string } | null {
  let best: { at: number; label: string } | null = null;
  for (const w of g.limits?.windows ?? []) if (w.pct >= 95 && w.resetsAt && (!best || w.resetsAt > best.at)) best = { at: w.resetsAt, label: w.label };
  if (!best)
    for (const s of g.sessions)
      if (s.stopped?.kind === "limit" && !s.stopped.over && s.stopped.resetsAt && (!best || s.stopped.resetsAt > best.at))
        best = { at: s.stopped.resetsAt, label: "" };
  return best && best.at > now ? best : null;
}

// An account's queued tasks (on this computer, or on its SSH host)
export function queuedFor(status: Pick<Status, "queue"> | null | undefined, g: Pick<Group, "host" | "profileKeys">): QueuedTask[] {
  return (status?.queue ?? []).filter((t) => (t.host || "") === (g.host || "") && (g.profileKeys ?? []).includes(t.profile));
}

// "Also changed by “Renames”: src/parser.py", one line per other chat
export function overlapText(overlaps: Overlap[]): string {
  return overlaps
    .map((o) => `Also changed by “${o.name}”${o.count > 1 ? ` (${o.count} files)` : ""}: ${o.files.join(", ")}${o.count > o.files.length ? " …" : ""}`)
    .join("\n");
}

// ---------------------------------------------------------------- permission mode

// A chat's permission mode as its tag says it ("" for the default)
export function modeText(mode: string | null | undefined): string {
  switch (mode) {
    case "plan":
      return "plan mode";
    case "acceptEdits":
      return "accept edits";
    case "auto":
      return "auto mode";
    case "bypassPermissions":
      return "bypass permissions";
    case "dontAsk":
      return "don't ask";
    case "default":
    case "":
    case null:
    case undefined:
      return "";
    default:
      return mode;
  }
}

export function modeHint(mode: string | null | undefined): string {
  switch (mode) {
    case "plan":
      return "Plan mode: Claude looks around and writes a plan, and changes nothing until you approve it.";
    case "acceptEdits":
      return "Claude edits files without asking; other actions still ask you.";
    case "auto":
      return "Auto mode: Claude goes ahead with what it judges safe, and asks you about the rest.";
    case "bypassPermissions":
      return "Claude runs everything without asking.";
    case "dontAsk":
      return "What isn't allowed already is refused, without asking you.";
    default:
      return "Shift+Tab in the chat changes it.";
  }
}

// ---------------------------------------------------------------- plans

// One of an account's plans, found by its key, as the extension knows it now
// (never what the page sent): {plan, group}, or null when it's gone
export function findPlan(status: Status | null, hosts: HostState[], host: unknown, groupId: unknown, key: unknown): { plan: PlanItem; group: Group } | null {
  if (typeof key !== "string" || !key || typeof groupId !== "string" || (host !== undefined && host !== null && typeof host !== "string")) return null;
  const where = host ? hosts.find((h) => h.name === host)?.result : status;
  const group = where?.groups.find((g) => g.id === groupId);
  const plan = group?.plans?.find((p) => p.key === key);
  return plan && group ? { plan, group: host ? { ...group, host: host as string } : group } : null;
}

// "~/repos/app · 2d ago"
export function planWhere(p: Pick<PlanItem, "cwdShort" | "updatedAt">, now: number): string {
  return p.cwdShort ? `${p.cwdShort} · ${ago(now - p.updatedAt)}` : ago(now - p.updatedAt);
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

// A chat's key as the transition tracker keeps it ("ssh:<host>|…" for a host's)
export function trackKey(s: Pick<Session, "chatId" | "sessionId" | "key"> & { profileDir?: string }, host?: string): string {
  return petKeyOf(s, host);
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
  const seen = new Set<string>();
  for (const g of groups)
    for (const s of g.sessions) {
      const spot = { id: trackKey(s, g.host), session: s, host: g.host };
      if (seen.has(spot.id)) continue; // the chat's most urgent row came first
      seen.add(spot.id);
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

// ---------------------------------------------------------------- stats

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A local YYYY-MM-DD as a Date at local midnight
function localDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function weekdayShort(day: string): string {
  return WEEKDAYS[localDate(day).getDay()];
}

// "Tue 15 Oct"
export function dayLabel(day: string): string {
  const d = localDate(day);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// A part of a whole as a percentage: "99%", "<1%"
export function sharePercent(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "0%";
  const pct = (100 * part) / whole;
  return pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

// A bar's tooltip: "Tue 15 Oct: 446.8M tokens (1.7M out) · 6 chats · 73 prompts"
export function dayTitle(d: StatsDay): string {
  if (!d.total && !d.prompts) return `${dayLabel(d.day)}: nothing`;
  return (
    `${dayLabel(d.day)}: ${formatTokens(d.total)} tokens (${formatTokens(d.output)} out)` +
    ` · ${plural(d.chats, "%1 chat", "%1 chats")} · ${plural(d.prompts, "%1 prompt", "%1 prompts")}`
  );
}

// "14 days: 997.4M tokens (3.2M out) · 15 chats · 253 prompts · 5 active days"
export function statsSummary(s: UsageStats): string {
  const sum = s.sum;
  return (
    `${s.days.length} days: ${formatTokens(sum.total)} tokens (${formatTokens(sum.output)} out)` +
    ` · ${plural(sum.chats, "%1 chat", "%1 chats")} · ${plural(sum.prompts, "%1 prompt", "%1 prompts")}` +
    ` · ${plural(sum.activeDays, "%1 active day", "%1 active days")}`
  );
}

// "Opus 5.5 99% · Sonnet 5.5 <1%"
export function modelShares(models: UsageStats["models"]): string {
  const whole = models.reduce((n, m) => n + m.total, 0);
  return models.map((m) => `${m.model} ${sharePercent(m.total, whole)}`).join(" · ");
}

// Bars that get a weekday under them: every other one, counted back from
// today (the last), so today always has its label
export function labeledBar(index: number, count: number): boolean {
  return (count - 1 - index) % 2 === 0;
}

// The recap under a chat's peek: "3 prompts · worked 51m · 278 tool calls
// (Bash 236, Read 23, Write 5) · 85.3M tokens (249.0k out) · $12.40 at API prices"
export function recapText(st: ChatStats, costUsd?: number | null): string {
  const parts = [plural(st.prompts, "%1 prompt", "%1 prompts")];
  if (st.workedMs > 0) parts.push(`worked ${duration(st.workedMs)}`);
  if (st.toolCalls) {
    const top = (st.tools ?? []).slice(0, 3).map(([name, n]) => `${name} ${n}`).join(", ");
    parts.push(plural(st.toolCalls, "%1 tool call", "%1 tool calls") + (top ? ` (${top})` : ""));
  }
  if (st.tokens.total) parts.push(`${formatTokens(st.tokens.total)} tokens (${formatTokens(st.tokens.output)} out)`);
  if (costUsd) parts.push(`$${costUsd.toFixed(2)} at API prices`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------- a subagent unfolded

// Its open state, kept by row and agent ("[host|]row key|agent id")
export function agentDetailKey(rowKey: string, agentId: string): string {
  return `${rowKey}|${agentId}`;
}

// "12 tool calls · 45.2k tokens", leaving out what isn't known
export function agentSummary(a: Pick<Agent, "toolCalls" | "tokens">): string {
  const parts = [];
  if (typeof a.toolCalls === "number") parts.push(plural(a.toolCalls, "%1 tool call", "%1 tool calls"));
  if (typeof a.tokens === "number" && a.tokens > 0) parts.push(`${formatTokens(a.tokens)} tokens`);
  return parts.join(" · ");
}

// The tooltip of "Open the whole run"
export function agentRunTitle(host?: string): string {
  return (
    "Its task, every step with the start of each result, and its report, as Markdown. Claude Code itself can't open a subagent from outside." +
    (host ? ` Fetched from ${host} over ssh.` : "")
  );
}

function clock(ms: number, now: number): string {
  const d = new Date(ms);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return now - ms < 20 * 3600000 ? time : `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
}

export function recapTitle(st: ChatStats, now: number): string {
  const t = st.tokens;
  const lines = [];
  if (st.startedAt) lines.push(`Started ${clock(st.startedAt, now)}`);
  if (st.lastAt) lines.push(`Last activity ${clock(st.lastAt, now)} (${ago(now - st.lastAt)})`);
  if (st.workedMs) lines.push(`Claude worked ${duration(st.workedMs)}: each turn from your prompt to its last step`);
  if (st.tools.length) lines.push(`Tools: ${st.tools.map(([name, n]) => `${name} ${n}`).join(", ")}`);
  lines.push(
    `Tokens (subagents included): input ${formatTokens(t.input)} · output ${formatTokens(t.output)} · ` +
      `cache read ${formatTokens(t.cacheRead)} · cache write ${formatTokens(t.cacheWrite)}`,
  );
  return lines.join("\n");
}
