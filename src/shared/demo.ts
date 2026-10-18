// Made-up data for the demo mode (README screenshots, trying the view without
// Claude Code) and for the webview's dev harness. Nothing here is real: the
// accounts, folders, hosts and chats are invented, times are relative to now.

import type { Agent, ChatStats, Group, HostState, Session, Status, UsageStats, ViewState } from "./types";

const MIN = 60000;
const HOUR = 60 * MIN;

function session(now: number, partial: Partial<Session> & Pick<Session, "key" | "name" | "state">): Session {
  return {
    profileDir: ".claude",
    sessionId: partial.key,
    chatId: partial.key,
    pid: 4242,
    cwd: "/home/alice/projects/webapp",
    cwdShort: "~/projects/webapp",
    profile: "personal",
    kind: "interactive",
    entrypoint: "cli",
    reason: "",
    waitingFor: "",
    detail: "",
    since: now - 5 * MIN,
    startedAt: now - HOUR,
    context: 34,
    model: "Opus",
    costUsd: 1.42,
    agents: null,
    shared: null,
    jobId: null,
    jobSessionId: null,
    openCommand: "echo 'Demo mode: nothing to open'",
    stopCommand: null,
    ...partial,
  };
}

function agents(now: number): Session["agents"] {
  const tree: Agent[] = [
    { id: "a1", parent: null, depth: 0, type: "Explore", description: "Find the date parsing code", status: "done", activity: "", started: now - 9 * MIN, updated: now - 6 * MIN },
    { id: "a2", parent: null, depth: 0, type: "general-purpose", description: "Write tests for the parser", status: "running", activity: "Running the test suite", started: now - 4 * MIN, updated: now - 10000 },
    { id: "a3", parent: "a2", depth: 1, type: "Explore", description: "Look for existing fixtures", status: "running", activity: "Reading tests/fixtures", started: now - 2 * MIN, updated: now - 5000 },
  ];
  return { running: 2, done: 1, stopped: 0, total: 3, tree };
}

function totals(scale: number) {
  return {
    input: 120000 * scale,
    output: 340000 * scale,
    cacheRead: 9800000 * scale,
    cacheWrite: 410000 * scale,
    total: 10670000 * scale,
    messages: Math.round(180 * scale),
    shared: 0,
  };
}

// The last 14 days of an account: a busy week, a quiet weekend, today
function usageStats(now: number, scale: number, folders: [string, string][]): UsageStats {
  const shape = [0, 0.2, 0.9, 1.6, 2.4, 1.1, 0, 0, 0.7, 1.9, 3.1, 2.2, 1.4, 1];
  const days = shape.map((f, i) => {
    const d = new Date(now - (shape.length - 1 - i) * 24 * HOUR);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const total = Math.round(f * 21_000_000 * scale);
    return { day, total, output: Math.round(total / 31), messages: Math.round(f * 160 * scale), chats: f ? Math.max(1, Math.round(f * 2.4)) : 0, prompts: Math.round(f * 18 * scale) };
  });
  const total = days.reduce((n, d) => n + d.total, 0);
  const prompts = days.reduce((n, d) => n + d.prompts, 0);
  const shares = [0.58, 0.27, 0.1, 0.05];
  return {
    days,
    projects: folders.map(([name, path], i) => ({
      name,
      path,
      total: Math.round(total * shares[i]),
      output: Math.round((total * shares[i]) / 31),
      prompts: Math.round(prompts * shares[i]),
    })),
    models: [
      { model: "Opus 5.5", total: Math.round(total * 0.86) },
      { model: "Sonnet 5.5", total: Math.round(total * 0.13) },
      { model: "Haiku 5.5", total: Math.round(total * 0.01) },
    ],
    sum: { total, output: Math.round(total / 31), chats: 23, prompts, activeDays: days.filter((d) => d.total).length },
  };
}

function chatStats(now: number, prompts: number, minutes: number, tools: [string, number][], total: number): ChatStats {
  return {
    prompts,
    toolCalls: tools.reduce((n, [, c]) => n + c, 0),
    tools,
    tokens: { input: Math.round(total * 0.004), output: Math.round(total / 30), cacheRead: Math.round(total * 0.9), cacheWrite: Math.round(total * 0.06), total },
    workedMs: minutes * MIN,
    startedAt: now - 3 * HOUR,
    lastAt: now - 20000,
  };
}

function personal(now: number, phase: number): Group {
  const parserState = phase % 3 === 2 ? "idle" : "working";
  return {
    id: "demo-personal",
    name: "personal",
    plan: "Max",
    title: "personal · Max",
    profiles: ["personal"],
    profileKeys: [".claude"],
    sessions: [
      session(now, {
        key: "demo-1",
        name: "Fix the date parser",
        state: parserState,
        since: now - (parserState === "working" ? 7 : 1) * MIN,
        agents: parserState === "working" ? agents(now) : null,
        context: 62,
        peek:
          parserState === "working"
            ? { activity: "Bash: npm test -- parser", prompt: "The date parser breaks on ISO weeks; fix it and add tests.", reply: "Found it: week 53 wraps to the next year. Fixing the year rollover now.", replyLine: "Found it: week 53 wraps to the next year. Fixing the year rollover now.", at: now - 20000 }
            : { activity: "", prompt: "The date parser breaks on ISO weeks; fix it and add tests.", reply: "Fixed: ISO week 53 no longer rolls over into the next year.\n\n• parseIsoWeek() takes the year from the week's Thursday\n• 12 new tests in date.test.ts, all passing\n\nWant me to open a pull request?", replyLine: "Fixed: ISO week 53 no longer rolls over into the next year.", at: now - 60000 },
        changes: { count: 3, files: ["src/date/parse.ts", "src/date/week.ts", "test/date.test.ts"] },
        stats: chatStats(now, 4, 38, [["Bash", 41], ["Read", 18], ["Edit", 9], ["Grep", 6], ["Agent", 3]], 18_400_000),
        tasks: {
          done: parserState === "working" ? 2 : 4,
          total: 4,
          current: parserState === "working" ? "Writing tests for week 53" : "",
          items: [
            { subject: "Reproduce the week-53 bug", status: "completed" },
            { subject: "Fix the year rollover", status: "completed" },
            { subject: "Write tests for week 53", status: parserState === "working" ? "in_progress" : "completed" },
            { subject: "Run the whole test suite", status: parserState === "working" ? "pending" : "completed" },
          ],
        },
      }),
      session(now, {
        key: "demo-2",
        name: "Release notes for 2.0",
        state: "waiting",
        reason: "permission",
        waitingFor: "permission prompt",
        detail: "Wants to run: git tag v2.0.0",
        cwd: "/home/alice/projects/api-server",
        cwdShort: "~/projects/api-server",
        since: now - 2 * MIN,
        context: 18,
        model: "Sonnet",
        peek: { activity: "Bash: git tag v2.0.0", prompt: "Write the release notes for 2.0 and tag it.", reply: "The notes are in CHANGELOG.md. Tagging v2.0.0 next.", replyLine: "The notes are in CHANGELOG.md. Tagging v2.0.0 next.", at: now - 2 * MIN },
        changes: { count: 1, files: ["CHANGELOG.md"] },
        stats: chatStats(now, 2, 6, [["Bash", 7], ["Read", 4], ["Write", 1]], 2_100_000),
      }),
      session(now, {
        key: "demo-3",
        name: "Nightly dependency check",
        state: "done",
        kind: "bg",
        pid: null,
        jobId: "demo-job",
        cwd: "/home/alice/notes",
        cwdShort: "~/notes",
        since: now - 3 * HOUR,
        context: 9,
        detail: "All dependencies are up to date",
      }),
    ],
    limits: {
      updatedAt: now - 3 * MIN,
      windows: [
        {
          key: "five_hour",
          label: "5h",
          pct: 63,
          resetsAt: now + 2 * HOUR + 14 * MIN,
          reset: false,
          forecast: { evenPct: 55, rate: 24, atReset: 116, fullAt: now + HOUR + 32 * MIN, basis: "hour" },
        },
        {
          key: "seven_day",
          label: "7d",
          pct: 41,
          resetsAt: now + 3 * 24 * HOUR,
          reset: false,
          forecast: { evenPct: 57, rate: 0.4, atReset: 70, fullAt: null, basis: "window" },
        },
      ],
    },
    tokens: { today: totals(1), week: totals(5.3), models: [{ model: "Opus", total: 8100000 }, { model: "Sonnet", total: 2570000 }] },
    stats: usageStats(now, 1, [
      ["webapp", "~/projects/webapp"],
      ["api-server", "~/projects/api-server"],
      ["notes", "~/notes"],
      ["~", "~"],
    ]),
    chatProfile: ".claude",
    shareProfile: null,
    projects: [
      { path: "/home/alice/projects/webapp", short: "~/projects/webapp", newChatCommand: "echo 'Demo mode'" },
      { path: "/home/alice/projects/api-server", short: "~/projects/api-server", newChatCommand: "echo 'Demo mode'" },
      { path: "/home/alice", short: "~", newChatCommand: "echo 'Demo mode'" },
    ],
    sharedHere: [],
    recent: [
      { key: "demo-r1", sessionId: "demo-r1", name: "Explain the build pipeline", cwd: "/home/alice/projects/webapp", cwdShort: "~/projects/webapp", lastActive: now - 5 * HOUR, profile: "personal", profileDir: ".claude", shared: false, openCommand: "echo 'Demo mode'" },
      { key: "demo-r2", sessionId: "demo-r2", name: "Rename the config module", cwd: "/home/alice/projects/api-server", cwdShort: "~/projects/api-server", lastActive: now - 26 * HOUR, profile: "personal", profileDir: ".claude", shared: false, openCommand: "echo 'Demo mode'" },
    ],
    homeChatCommand: "echo 'Demo mode'",
  };
}

function buildServer(now: number, phase: number): Status {
  const state = phase % 2 === 0 ? "working" : "idle";
  return {
    ok: true,
    generatedAt: now,
    overall: state,
    counts: { waiting: 0, working: state === "working" ? 1 : 0, idle: state === "idle" ? 1 : 0, done: 0 },
    dismissed: 0,
    canShare: false,
    errors: [],
    host: "build-server",
    groups: [
      {
        id: "demo-team",
        name: "team",
        plan: "Team",
        title: "team · Team",
        profiles: ["team"],
        profileKeys: [".claude"],
        sessions: [
          session(now, {
            key: "demo-4",
            name: "Train the ranking model",
            state,
            cwd: "/home/alice/experiments/ranking",
            cwdShort: "~/experiments/ranking",
            since: now - (state === "working" ? 24 : 2) * MIN,
            context: 87,
            model: "Opus",
            peek: {
              activity: state === "working" ? "Bash: python train.py --epochs 20" : "",
              prompt: "Train the ranking model on the new click data.",
              reply: state === "working" ? "Epoch 7/20: validation NDCG 0.412." : "Done: NDCG 0.431 on validation, up from 0.398.",
              replyLine: state === "working" ? "Epoch 7/20: validation NDCG 0.412." : "Done: NDCG 0.431 on validation, up from 0.398.",
              at: now - MIN,
            },
            changes: { count: 2, files: ["configs/ranking.yaml", "train.py"] },
            stats: chatStats(now, 3, 24, [["Bash", 22], ["Read", 9], ["Edit", 4]], 9_700_000),
          }),
        ],
        limits: {
          updatedAt: now - 9 * MIN,
          windows: [
            {
              key: "five_hour",
              label: "5h",
              pct: 92,
              resetsAt: now + 41 * MIN,
              reset: false,
              forecast: { evenPct: 86, rate: 11, atReset: 99.5, fullAt: null, basis: "hour" },
            },
            { key: "seven_day", label: "7d", pct: 55, resetsAt: now + 5 * 24 * HOUR, reset: false },
          ],
        },
        tokens: { today: totals(0.6), week: totals(2.2), models: [{ model: "Opus", total: 6400000 }] },
        stats: usageStats(now, 0.6, [["ranking", "~/experiments/ranking"]]),
        chatProfile: ".claude",
        shareProfile: null,
        projects: [{ path: "/home/alice/experiments/ranking", short: "~/experiments/ranking", newChatCommand: "echo 'Demo mode'" }],
        sharedHere: [],
        recent: [],
        homeChatCommand: "echo 'Demo mode'",
      },
    ],
  };
}

// phase moves the story on (a chat finishes, the host's chat starts again…)
export function demoState(now: number, phase = 0): ViewState {
  const groups = [personal(now, phase)];
  const status: Status = {
    ok: true,
    generatedAt: now,
    overall: "waiting",
    counts: { waiting: 1, working: 1, idle: 0, done: 1 },
    groups,
    dismissed: 0,
    canShare: false,
    errors: [],
  };
  const hosts: HostState[] = [
    { name: "build-server", loading: false, ok: true, error: "", result: buildServer(now, phase), updatedAt: now - 12000, current: true },
    { name: "gpu-box", loading: false, ok: false, error: "Can't reach gpu-box: Connection timed out", result: null, updatedAt: 0, current: false },
  ];
  return {
    status,
    errorText: "",
    hosts,
    settings: { showPet: true, chatPets: 5, showTokens: true, recentChats: 5, reopenIn: "terminal" },
    demo: true,
    platformNote: "",
    claudeCode: { available: true, profileKey: ".claude" },
    actionError: "",
    actionInfo: "",
    now,
  };
}
