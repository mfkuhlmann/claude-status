// Made-up data for the demo mode (README screenshots, trying the view without
// Claude Code) and for the webview's dev harness. Nothing here is real: the
// accounts, folders, hosts and chats are invented, times are relative to now.

import type { Agent, Group, HostState, Session, Status, ViewState } from "./types";

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
        { key: "five_hour", label: "5h", pct: 63, resetsAt: now + 2 * HOUR + 14 * MIN, reset: false },
        { key: "seven_day", label: "7d", pct: 41, resetsAt: now + 3 * 24 * HOUR, reset: false },
      ],
    },
    tokens: { today: totals(1), week: totals(5.3), models: [{ model: "Opus", total: 8100000 }, { model: "Sonnet", total: 2570000 }] },
    chatProfile: ".claude",
    shareProfile: null,
    shareName: null,
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
          }),
        ],
        limits: {
          updatedAt: now - 9 * MIN,
          windows: [
            { key: "five_hour", label: "5h", pct: 92, resetsAt: now + 41 * MIN, reset: false },
            { key: "seven_day", label: "7d", pct: 55, resetsAt: now + 5 * 24 * HOUR, reset: false },
          ],
        },
        tokens: { today: totals(0.6), week: totals(2.2), models: [{ model: "Opus", total: 6400000 }] },
        chatProfile: ".claude",
        shareProfile: null,
        shareName: null,
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
    settings: { showPet: true, chatPets: 5, showTokens: true, recentChats: 5 },
    demo: true,
    platformNote: "",
    actionError: "",
    actionInfo: "",
    now,
  };
}
