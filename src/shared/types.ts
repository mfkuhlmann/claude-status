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
  agents: { running: number; done: number; stopped: number; total: number; tree: Agent[] } | null;
  shared: SharedInfo | null;
  jobId: string | null;
  jobSessionId: string | null;
  tmux?: boolean; // runs in a tmux pane: a working one can be interrupted (Ctrl+C)
  peek?: Peek | null;
  changes?: ChangeSummary | null;
  tasks?: TaskProgress | null;
  // --remote: shell commands, run on the machine the session is on
  openCommand?: string | null;
  stopCommand?: string | null;
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
}

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
  chatProfile: string;
  shareProfile: string | null;
  projects: Project[];
  sharedHere: SharedPointer[];
  recent: RecentChat[];
  homeChatCommand?: string;
  // VS Code's Claude runs on this account (the backend's view of it; an SSH
  // host's: its ~/.claude)
  vscodeHere?: boolean;
  // Set by the extension for an SSH host's accounts
  host?: string;
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
}

export interface Counts {
  waiting: number;
  working: number;
  idle: number;
  done: number;
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
}

export interface ViewSettings {
  showPet: boolean;
  chatPets: number;
  showTokens: boolean;
  recentChats: number;
  reopenIn: ReopenIn; // where recent chats reopen (the switch above them)
}

export type ReopenIn = "terminal" | "claudeCode";

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
  shared?: boolean;
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
  | { type: "dismissDigest" }
  | { type: "newChat"; groupId: string; host?: string }
  | { type: "refresh"; host?: string }
  | { type: "showRemoved"; host?: string }
  | { type: "hideHost"; host: string }
  | { type: "pickHosts" }
  | { type: "setupUsageBars" }
  | { type: "openUsagePage" };

// extension -> webview
export type HostMessage =
  | { type: "state"; state: ViewState }
  | { type: "petEvent"; kind: PetEventKind; text: string; key: string }
  | { type: "visible"; visible: boolean };
