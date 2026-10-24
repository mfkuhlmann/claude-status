// What vendor/code/claude_status.py prints (its collect(), plus the --remote
// additions), and the messages between the extension and its webview.

export type SessionState = "waiting" | "working" | "idle" | "done";

export interface Agent {
  id: string;
  parent: string | null;
  depth: number;
  type: string;
  description: string;
  background?: boolean;
  status: string; // running | done | stopped | failed
  activity: string;
  started: number | null;
  updated: number | null;
  model?: string | null; // e.g. "Haiku 4.5", from its replies
  task?: string; // what it was asked to do (plain text, may have newlines)
  steps?: string[]; // its last tool calls, oldest first, e.g. "Bash: npm test"
  report?: string; // what it handed back (plain text); "" until it's done
  toolCalls?: number | null; // tool calls so far
  tokens?: number | null; // tokens so far
}

export interface SharedInfo {
  profiles: string[];
  openIn: string | null;
  stoppedCopies?: string[];
  forkOf?: string;
  movedHere?: boolean;
}

// What a chat is doing, from the end of its transcript
export interface Peek {
  activity: string; // its newest step, e.g. "Bash: npm test"; "" once its reply is finished
  prompt: string; // your last prompt
  reply: string; // Claude's last reply (up to 1500 characters, several lines)
  replyLine: string; // its first line
  at: number | null;
  // Claude's recap of the chat, while nothing was said after it (Claude Code
  // writes one when you come back to a chat after a while). Older backends leave it out.
  recap?: { text: string; at: number | null } | null;
  mode?: string | null; // its permission mode: default, plan, auto, acceptEdits, bypassPermissions, dontAsk
  slug?: string | null; // its plan's name, <config>/plans/<slug>.md
  stopped?: Stop | null; // (as read; the row's own `stopped` says when the limit resets)
}

// What stopped a chat: a usage limit (window: the plan window it hit, e.g.
// "five_hour", when Claude named it) or an expired login
export interface Stop {
  kind: "limit" | "login";
  window: string | null;
  text: string; // Claude's message, e.g. "You've hit your session limit · resets 7:10pm (Europe/Berlin)"
  at: number | null;
  resetsAt?: number | null; // when that limit resets
  over?: boolean; // it has reset since: the chat can go on
}

// Another chat with a process that changed some of the same files as this one
export interface Overlap {
  key: string; // its row
  name: string;
  sessionId: string;
  profileDir: string;
  count: number;
  files: string[]; // relative to this chat's folder, at most 8
}

// A background task waiting for its account's usage limit to reset
// (claude_status.py: queued_tasks); an SSH host's starts from here, over ssh
export interface QueuedTask {
  id: string;
  host: string; // "" for this computer
  profile: string;
  account: string;
  folder: string;
  folderShort: string;
  prompt: string;
  plan: string | null;
  planProfile: string | null;
  planTitle: string;
  startAt: number;
  createdAt: number;
  error: string; // why it didn't start (it waits for you then)
  due: boolean;
  chat?: string | null; // goes on with this chat (one a usage limit stopped) instead
  name?: string; // that chat's name
  scheduled?: boolean; // it starts at a time you picked, not when a limit resets
  why?: string; // a chat's go-on: "retry" (its turn broke off) or "cap" (the usage cap stopped it), else ""
  model?: string | null; // a new chat's model and effort (claude --model, --effort)
  effort?: string | null;
}

// A chat of this computer that keeps going until it's done: after each usage
// limit that stops it, it goes on by itself (claude_status.py: look_after_kept)
export interface KeptChat {
  chat: string;
  profile: string;
  name: string;
  since: number;
  wentOnAt: number | null; // when it last went on by itself
  tries: number; // how often it went on again after a go-on that didn't take, or a turn that broke off
  note: string; // why it can't go on right now (open in a Claude Code tab, its login expired)
  error: string; // it gave up: why
}

// The plan a chat made (claude_status.py: plan_of)
export interface ChatPlan {
  slug: string;
  title: string;
  path: string; // on the machine the chat is on
  updatedAt: number;
  edited?: boolean; // changed since its chat last did anything: by you (claude_status.py: plan_edited)
}

// One of an account's plans (claude_status.py: account_plans)
export interface PlanItem extends ChatPlan {
  key: string;
  profileDir: string; // the profile whose plans/ it's in
  profile: string;
  shared: boolean; // linked into another profile's plans/ too
  chatId: string | null; // the chat that made it, where it's still there
  chatProfileDir: string | null;
  cwd: string; // that chat's folder
  cwdShort: string;
  openCommand?: string | null; // --remote: reopens that chat there
}

// One of Claude's memories on an account (claude_status.py: account_memories):
// a note it keeps in <config>/projects/<folder>/memory
export interface Memory {
  key: string;
  name: string;
  description: string;
  type: string; // user, feedback, project, reference ("" when it doesn't say)
  path: string; // on the machine the account is on
  folder: string; // the project folder it's for ("" when that's gone)
  folderShort: string;
  profileDir: string;
  profile: string;
  updatedAt: number;
}

// The files a chat changed (labels relative to its folder)
export interface ChangeSummary {
  count: number;
  files: string[];
}

export type TaskStatus = "pending" | "in_progress" | "completed";

// A chat's task list (Claude's TaskCreate/TaskUpdate)
export interface TaskProgress {
  done: number;
  total: number;
  current: string; // what it's on now, e.g. "Running the tests"
  items: { subject: string; status: TaskStatus | string }[];
}

export interface Session {
  key: string;
  profileDir: string;
  sessionId: string;
  chatId: string;
  pid: number | null;
  name: string;
  cwd: string;
  cwdShort: string;
  profile: string;
  kind: string; // interactive | bg | job | chat
  entrypoint: string;
  state: SessionState;
  reason: string;
  waitingFor: string;
  detail: string;
  since: number | null;
  startedAt: number | null;
  context: number | null;
  model: string | null;
  effort?: string | null; // reasoning effort, from the status line (low … max)
  costUsd: number | null;
  agents: { running: number; done: number; stopped: number; failed?: number; total: number; tree: Agent[] } | null;
  shared: SharedInfo | null;
  jobId: string | null;
  jobSessionId: string | null;
  tmux?: boolean; // runs in a tmux pane: a working one can be interrupted (Ctrl+C)
  peek?: Peek | null;
  changes?: ChangeSummary | null;
  tasks?: TaskProgress | null;
  stats?: ChatStats | null;
  plan?: ChatPlan | null; // the plan it made
  stopped?: Stop | null; // a usage limit (or an expired login) stopped it
  // other chats with a process that changed some of the same files
  overlaps?: Overlap[] | null;
  // --remote: shell commands, run on the machine the session is on
  openCommand?: string | null;
  stopCommand?: string | null;
  // --remote: the process of the VS Code terminal it runs in (that terminal's
  // processId, on the machine the session is on), if it does
  vscodeTerminal?: number | null;
}

// A chat's numbers (claude_status.py: stats_summary): your prompts, its tool
// calls by name, tokens (subagents included), how long Claude worked
export interface ChatStats {
  prompts: number;
  toolCalls: number;
  tools: [string, number][]; // most used first, at most 5
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  workedMs: number; // each turn from your prompt to its last step
  startedAt: number | null;
  lastAt: number | null;
}

// An account's last days (claude_status.py: token_stats)
export interface StatsDay {
  day: string; // YYYY-MM-DD, local
  total: number;
  output: number;
  messages: number;
  chats: number;
  prompts: number;
}

export interface UsageStats {
  days: StatsDay[]; // oldest first, today last
  projects: { name: string; path: string; total: number; output: number; prompts: number }[]; // busiest first
  models: { model: string; total: number }[];
  sum: { total: number; output: number; chats: number; prompts: number; activeDays: number };
}

// Where a plan window is heading at your pace
export interface Forecast {
  evenPct: number; // where an even pace through the window would be by now
  rate: number; // percent per hour
  atReset: number; // where it would be when the window resets
  fullAt: number | null; // when it would run out, if that's before it resets
  basis: "hour" | "window"; // the last hour's pace, or the window's so far
}

export interface LimitWindow {
  key: string;
  label: string;
  pct: number;
  resetsAt: number | null;
  reset: boolean;
  forecast?: Forecast | null;
}

export interface Limits {
  updatedAt: number;
  windows: LimitWindow[];
}

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  messages: number;
  shared: number;
}

export interface Tokens {
  today: TokenTotals;
  week: TokenTotals;
  models: { model: string; total: number }[];
}

export interface Project {
  path: string;
  short: string;
  newChatCommand?: string;
  trusted?: boolean; // Claude trusts the folder: a task can start there in the background
}

export interface RecentChat {
  key: string;
  sessionId: string;
  name: string;
  cwd: string;
  cwdShort: string;
  lastActive: number;
  profile: string;
  profileDir: string;
  shared: boolean;
  openCommand?: string | null;
  recap?: { text: string; at: number | null } | null;
  stopped?: Stop | null;
}

// A chat "Find a Chat" found (claude_status.py: find_chats)
export interface FoundChat {
  key: string;
  sessionId: string;
  name: string;
  cwd: string;
  cwdShort: string;
  lastActive: number;
  profile: string;
  profileDir: string;
  groupId: string;
  account: string; // e.g. "work · Team"
  shared: boolean;
  match: string; // the prompt of yours that has the words, around them ("" when the name or folder did)
  openCommand?: string | null; // an SSH host's: reopens it there
}

// What the search found besides chats (claude_status.py: find_more)
export interface FoundProject {
  folder: string;
  folderShort: string;
  lastActive: number;
  chats: number;
  profile: string;
  profileDir: string;
  groupId: string;
  account: string;
}

export interface FoundPlan {
  key: string;
  slug: string;
  title: string;
  path: string;
  profile: string;
  profileDir: string;
  groupId: string;
  account: string;
  updatedAt: number;
}

export type FoundMemory = Memory & { groupId: string; account: string };

export interface SharedPointer {
  key: string;
  sessionId: string;
  name: string;
  cwdShort: string;
  state: SessionState;
  reason: string;
  since: number | null;
  profile: string;
  profileDir: string;
  copy: boolean;
  stoppedHere: boolean;
  openCommand?: string | null;
}

export interface Group {
  id: string;
  name: string;
  plan: string | null;
  title: string;
  profiles: string[];
  profileKeys: string[];
  sessions: Session[];
  limits: Limits | null;
  tokens: Tokens | null;
  stats?: UsageStats | null;
  chatProfile: string;
  shareProfile: string | null;
  projects: Project[];
  sharedHere: SharedPointer[];
  recent: RecentChat[];
  plans?: PlanItem[]; // newest first. Older backends leave it out.
  memories?: Memory[]; // newest first. Older backends leave it out.
  homeChatCommand?: string;
  // VS Code's Claude runs on this account (the backend's view of it; an SSH
  // host's: what its VS Code server's settings say, else its ~/.claude)
  vscodeHere?: boolean;
  // plain `claude` runs on it (~/.claude, or the one it links to), and the
  // default account (VS Code's Claude's where VS Code is, else plain claude's;
  // listed first). Older backends leave them out.
  plainHere?: boolean;
  defaultHere?: boolean;
  // On an SSH host: the CLAUDE_CONFIG_DIR VS Code's Claude there needs to run
  // on this account (null: none, a plain ~/.claude). Older backends leave it out.
  configDir?: string | null;
  // Not logged in to an account (a new one, or logged out): loginCommand runs
  // Claude's own login on it (`claude auth login`). Older backends leave them out.
  loggedOut?: boolean;
  loginCommand?: string | null;
  // Set by the extension for an SSH host's accounts
  host?: string;
  // Set by shareUsage: its plan usage shows on another machine's copy of
  // the account (or no host's shows), or comes from that host
  limitsHidden?: boolean;
  limitsFrom?: string;
  // With limitsHidden: the account's numbers all the same (the newest of its
  // machines'), for what weighs them (handoverTarget, limitReset)
  accountLimits?: Limits | null;
  // One of its plan windows is at the usage cap (claudeStatus.usageCap): until
  // it resets, queued tasks wait. Older backends leave it out.
  cap?: { pct: number; label: string; key: string; resetsAt: number } | null;
}

export interface Status {
  ok: true;
  generatedAt: number;
  overall: string;
  counts: Counts;
  groups: Group[];
  dismissed: number;
  canShare: boolean;
  errors: string[];
  host?: string;
  claude?: string;
  // Whether the claude command is on this machine (missing when unsure)
  cli?: { installed: boolean };
  queue?: QueuedTask[]; // this computer's status only: tasks waiting for a usage limit
  keep?: KeptChat[]; // this computer's status only: the chats that keep going
}

export interface Counts {
  waiting: number;
  working: number;
  idle: number;
  done: number;
  limit: number; // a usage limit stopped them (idle or done): they wait for it, not for you
}

export type Overall = "waiting" | "working" | "idle" | "none";

// One SSH host as the extension sees it
export interface HostState {
  name: string;
  loading: boolean;
  ok: boolean;
  error: string;
  result: Status | null; // the last good answer, kept (dimmed) after an error
  updatedAt: number;
  current: boolean; // the host this VS Code window is connected to
  // It wants a password (or a passphrase, a code, its host key confirmed):
  // Log in… opens a terminal where ssh asks for it (remote.py --login-here)
  login?: boolean;
  loggedIn?: boolean; // the checks go through a connection you logged in with: Disconnect closes it
}

export interface ViewSettings {
  showPet: boolean;
  chatPets: number;
  showTokens: boolean;
  recentChats: number;
  reopenIn: ReopenIn; // where recent chats reopen (the switch above them)
}

export type ReopenIn = "terminal" | "claudeCode";

// Plan usage on SSH hosts' accounts (shareUsage): once per account, on every host, or on none
export type SshUsage = "once" | "all" | "none";

// The Claude Code extension in this window: whether it's there, and the
// account (profile key) it runs on for this computer's chats
export interface ClaudeCodeInfo {
  available: boolean;
  profileKey: string | null;
}

// What happened while you were away (away.ts), as a card at the top of the view
export interface DigestCard {
  title: string; // "While you were away (1h 12m)"
  lines: string[]; // "Needs you: Deploy (waiting 22m)", "Finished: a, b", …
  at: number;
  first: ChatRef | null; // the chat waiting longest, to open
}

// Everything the webview draws
export interface ViewState {
  status: Status | null;
  errorText: string; // why this computer's status is missing or partial
  hosts: HostState[];
  settings: ViewSettings;
  demo: boolean;
  platformNote: string; // e.g. local sessions need Linux
  claudeCode: ClaudeCodeInfo;
  actionError: string;
  actionInfo: string;
  digest?: DigestCard | null;
  now: number;
}

export type PetEventKind = "waiting" | "done" | "failed" | "stopped" | "reset" | "oops";

// The Week tab: your last 7 days with Claude (the widget's week.py, read
// from the chats' transcripts when the tab asks, never in the status checks)
export interface WeekDay {
  day: string; // "2026-10-24"
  start: number; // its local midnight
  end: number; // the next one
  you: [number, number][]; // when you were at it
  work: [number, number, number][]; // when Claude worked: [from, to, chats at once]
  wait: [number, number][]; // when it waited for your answer (and no chat worked)
  youMs: number;
  workedMs: number;
  busyMs: number;
  waitMs: number;
  prompts: number;
  cost: number;
}

export interface WeekNumbers {
  youMs: number;
  workedMs: number; // Claude's own count of its turns, all chats added up
  busyMs: number; // that on the clock: chats at once count once
  waitMs: number; // Claude waiting for your answers
  prompts: number;
  cost: number; // $ at API prices
}

export interface WeekSum extends WeekNumbers {
  turns: number;
  limits: number; // times a usage limit stopped you
  chats: number;
  peakAtOnce: number;
  busiestDay: string | null;
  longestTurn: { workedMs: number; startedAt: number; name: string; host: string } | null;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number; webSearches: number };
}

export interface WeekProject {
  name: string;
  path: string;
  host: string;
  workedMs: number;
  cost: number;
  prompts: number;
  chats: number;
}

export interface WeekChat {
  name: string;
  chatId: string;
  host: string;
  profileDir: string;
  folder: string; // short, e.g. "~/repos/app"
  cwd?: string; // where it started
  workedMs: number;
  cost: number;
  prompts: number;
}

export interface WeekModel {
  model: string; // "Opus 5.5"
  cost: number;
  tokens: number;
  requests: number;
  share: number; // of the cost, 0-1
}

// What would use less of your plan: Claude Code's /usage rules (pct: the
// share of the week's usage it touches), how long Claude waited for you, the limits hit
export interface WeekTip {
  key: string;
  pct: number | null;
  title: string;
  detail: string;
  command: string; // e.g. "/compact", or ""
}

export interface WeekRecap {
  ok: true;
  generatedAt: number;
  back: number; // weeks before the last 7 days
  backMax: number;
  account: string; // an account's id, or "" for all
  accounts: { id: string; name: string; plan: string | null; hosts: string[] }[];
  from: string;
  to: string;
  days: WeekDay[];
  sum: WeekSum;
  previous: WeekNumbers; // the 7 days before
  projects: WeekProject[];
  chats: WeekChat[];
  models: WeekModel[];
  cacheSaved: number;
  tips: WeekTip[];
  prices: { asOf: string; guessed: string[] };
  sources: { host: string; ok: boolean; error: string }[];
}

export interface ChatRef {
  host?: string;
  key: string;
  sessionId: string;
  chatId?: string;
  profileDir: string;
  name: string;
  entrypoint?: string;
  pid?: number | null;
  cwd?: string;
  kind?: string;
  state?: SessionState;
  tmux?: boolean;
  jobId?: string | null;
  openCommand?: string | null;
  stopCommand?: string | null;
  vscodeTerminal?: number | null;
  shared?: boolean;
  plan?: { slug: string; path: string } | null; // the plan it made
}

// webview -> extension
export type WebviewMessage =
  | { type: "ready" }
  | { type: "open"; chat: ChatRef }
  | { type: "openInClaudeCode"; chat: ChatRef }
  | { type: "setReopenIn"; where: ReopenIn }
  | { type: "stop"; chat: ChatRef }
  | { type: "dismiss"; chat: ChatRef }
  | { type: "share"; chat: ChatRef }
  | { type: "compareChanges"; chat: ChatRef; turn: boolean }
  | { type: "openAgentRun"; chat: ChatRef; agentId: string }
  | { type: "dismissDigest" }
  | { type: "newChat"; groupId: string; host?: string }
  | { type: "handOver"; chat: ChatRef; profile: string }
  | { type: "openPlan"; chat?: ChatRef; groupId?: string; host?: string; plan?: string; edit?: boolean } // a chat's plan, or an account's (edit: its file, to change it)
  | { type: "sendPlanFeedback"; chat?: ChatRef; groupId?: string; host?: string; plan?: string } // your changes and comments, to the chat that made it
  | { type: "openMemory"; groupId: string; host?: string; memory: string; edit?: boolean } // to read, or (edit) its file
  | { type: "carryOutPlan"; groupId: string; host?: string; plan: string }
  | { type: "continuePlanChat"; groupId: string; host?: string; plan: string }
  | { type: "sharePlan"; groupId: string; host?: string; plan: string }
  | { type: "findChat" }
  | { type: "startQueued"; id: string }
  | { type: "openOverlap"; chat: ChatRef } // the first other chat changing the same files
  | { type: "unqueue"; id: string }
  | { type: "queueContinue"; chat: ChatRef } // go on by itself once the limit resets
  | { type: "keepGoing"; chat: ChatRef; on: boolean } // keep going after each usage limit (or not any more)
  | { type: "loginHost"; host: string }
  | { type: "disconnectHost"; host: string }
  | { type: "login"; groupId: string; host?: string }
  | { type: "refresh"; host?: string }
  | { type: "showRemoved"; host?: string }
  | { type: "hideHost"; host: string }
  | { type: "pickHosts" }
  | { type: "setupUsageBars" }
  | { type: "openUsagePage" }
  | { type: "week"; back: number; account: string } // the Week tab wants these days' recap
  | { type: "openWeekChat"; chatId: string; profileDir: string; name: string; cwd?: string } // one of the week's chats here
  | { type: "copy"; text: string }; // a tip's command, to the clipboard

// extension -> webview
export type HostMessage =
  | { type: "state"; state: ViewState }
  | { type: "petEvent"; kind: PetEventKind; text: string; key: string }
  | { type: "visible"; visible: boolean }
  | { type: "week"; back: number; account: string; recap: WeekRecap | null; error: string };
