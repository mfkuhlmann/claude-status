// UI state kept across reloads of the webview (VS Code drops a hidden view's
// page): which subagent trees (and subagents), peeks, recent-chat lists and stats
// are open. Kept by row and account key, since every poll brings new objects.

import { savedState, saveState } from "../env";
import { createStore } from "./store";

export type Tab = "chats" | "week" | "perms";

interface UiState {
  tab: Tab; // the view's tab: your chats now, your last 7 days, or the permissions you gave
  agents: Record<string, true>;
  agentDetail: Record<string, true>; // by agentDetailKey(): row key + "|" + agent id
  peek: Record<string, true>;
  recent: Record<string, true>;
  plans: Record<string, true>;
  starred: Record<string, true>; // an account's starred chats or plans unfolded: its key + "|chats" or "|plans"
  memories: Record<string, true>;
  stats: Record<string, true>;
}

// Our part of the webview's saved state; other parts (the pets) keep theirs
const KEY = "ui";
// Keys of chats long gone would pile up otherwise
const MAX_KEYS = 100;

function load(): UiState {
  const saved = savedState<Record<string, unknown>>()[KEY] as Partial<UiState> | undefined;
  return {
    tab: saved?.tab === "week" || saved?.tab === "perms" ? saved.tab : "chats",
    agents: { ...(saved?.agents ?? {}) },
    agentDetail: { ...(saved?.agentDetail ?? {}) },
    peek: { ...(saved?.peek ?? {}) },
    recent: { ...(saved?.recent ?? {}) },
    plans: { ...(saved?.plans ?? {}) },
    starred: { ...(saved?.starred ?? {}) },
    memories: { ...(saved?.memories ?? {}) },
    stats: { ...(saved?.stats ?? {}) },
  };
}

export const uiState = createStore<UiState>(load());

function toggled(map: Record<string, true>, key: string): Record<string, true> {
  const next = { ...map };
  if (next[key]) delete next[key];
  else next[key] = true;
  const keys = Object.keys(next);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_KEYS))) delete next[old];
  return next;
}

function persist(next: UiState): void {
  uiState.set(next);
  saveState({ ...savedState<Record<string, unknown>>(), [KEY]: next });
}

export function setTab(tab: Tab): void {
  const s = uiState.get();
  if (s.tab !== tab) persist({ ...s, tab });
}

export function toggleAgents(rowKey: string): void {
  const s = uiState.get();
  persist({ ...s, agents: toggled(s.agents, rowKey) });
}

export function toggleAgentDetail(key: string): void {
  const s = uiState.get();
  persist({ ...s, agentDetail: toggled(s.agentDetail, key) });
}

export function togglePeek(rowKey: string): void {
  const s = uiState.get();
  persist({ ...s, peek: toggled(s.peek, rowKey) });
}

export function toggleRecent(groupKey: string): void {
  const s = uiState.get();
  persist({ ...s, recent: toggled(s.recent, groupKey) });
}

export function togglePlans(groupKey: string): void {
  const s = uiState.get();
  persist({ ...s, plans: toggled(s.plans, groupKey) });
}

export function toggleStarred(key: string): void {
  const s = uiState.get();
  persist({ ...s, starred: toggled(s.starred, key) });
}

export function toggleMemories(groupKey: string): void {
  const s = uiState.get();
  persist({ ...s, memories: toggled(s.memories, groupKey) });
}

export function toggleStats(groupKey: string): void {
  const s = uiState.get();
  persist({ ...s, stats: toggled(s.stats, groupKey) });
}
