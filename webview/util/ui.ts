// UI state kept across reloads of the webview (VS Code drops a hidden view's
// page): which subagent trees and recent-chat lists are open. Kept by row and
// account key, since every poll brings new objects.

import { savedState, saveState } from "../env";
import { createStore } from "./store";

interface UiState {
  agents: Record<string, true>;
  recent: Record<string, true>;
}

// Our part of the webview's saved state; other parts (the pets) keep theirs
const KEY = "ui";
// Keys of chats long gone would pile up otherwise
const MAX_KEYS = 100;

function load(): UiState {
  const saved = savedState<Record<string, unknown>>()[KEY] as Partial<UiState> | undefined;
  return { agents: { ...(saved?.agents ?? {}) }, recent: { ...(saved?.recent ?? {}) } };
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

export function toggleAgents(rowKey: string): void {
  const s = uiState.get();
  persist({ ...s, agents: toggled(s.agents, rowKey) });
}

export function toggleRecent(groupKey: string): void {
  const s = uiState.get();
  persist({ ...s, recent: toggled(s.recent, groupKey) });
}
