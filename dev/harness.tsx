// Feeds the webview demo data, the way the extension would: a state after
// "ready", then a new one every few seconds with the story moved on.

import "../webview/main";
import { demoState, demoWeek } from "../src/shared/demo";
import type { HostMessage } from "../src/shared/types";
import { toggleStarred, uiState } from "../webview/util/ui";

const params = new URLSearchParams(location.search);
let phase = Number(params.get("phase")) || 0;

function send(message: HostMessage): void {
  window.postMessage(message, "*");
}

function sendState(): void {
  const state = demoState(Date.now(), phase);
  // ?digest=1: the card that sums up what happened while you were away
  if (params.get("digest") === "1")
    state.digest = {
      title: "While you were away (1h 12m)",
      lines: ["Needs you: Release notes for 2.0 (waiting 22m)", "Finished: Fix the date parser, Nightly dependency check", "5h limit reset"],
      at: Date.now(),
      first: { key: "demo-2", sessionId: "demo-2", profileDir: ".claude", name: "Release notes for 2.0" },
    };
  // ?rules=0: the Recap tab's rule suggestions left out (the recapRules setting)
  if (params.get("rules") === "0") state.settings.recapRules = false;
  // ?loggedOut=1: the last account isn't logged in (Log in…)
  const groups = state.status?.groups ?? [];
  if (params.get("loggedOut") === "1" && groups.length)
    groups[groups.length - 1] = { ...groups[groups.length - 1], loggedOut: true, loginCommand: "claude auth login", limits: null };
  // ?default=1: a second account here, and the first one marked the default
  if (params.get("default") === "1" && groups.length)
    groups.splice(1, 0, { ...groups[0], id: "demo-second", name: "work", title: "work · Team", plan: "Team", defaultHere: false, sessions: [] }),
      (groups[0] = { ...groups[0], defaultHere: true });
  // ?stopped=1: two chats here a usage limit stopped, one queued to go on that keeps going
  const hostStopped = state.hosts.flatMap((h) => h.result?.groups ?? []).flatMap((g) => g.sessions).find((s) => s.stopped);
  if (params.get("stopped") === "1" && hostStopped && groups.length && state.status) {
    const copy = (id: string, name: string) => ({ ...hostStopped, key: id, sessionId: id, chatId: id, name, overlaps: [] });
    const later = copy("demo-stopped-2", "Port the importer");
    groups[0].sessions.push(copy("demo-stopped-1", "Migrate the schema"), later);
    state.status.keep = [{ chat: later.chatId, profile: ".claude", name: later.name, since: Date.now(), wentOnAt: null, tries: 0, note: "", error: "" }];
    state.status.queue = [...(state.status.queue ?? []), {
      id: "q-later", host: "", profile: ".claude", account: groups[0].title, folder: later.cwd, folderShort: later.cwdShort, prompt: "",
      plan: null, planProfile: null, planTitle: "", startAt: (later.stopped?.resetsAt ?? Date.now()) + 60000, createdAt: Date.now(),
      error: "", due: false, chat: later.chatId, name: later.name, scheduled: false,
    }];
  }
  // ?stars=1: a chat at work, a recent chat and a plan starred, and an old chat and plan under Starred
  const first = groups[0];
  if (params.get("stars") === "1" && first) {
    const DAY = 86400_000;
    if (first.sessions[0]) first.sessions[0].starred = true;
    const recent = first.recent?.[0];
    if (recent) {
      recent.starred = true;
      first.starred = [
        { ...recent, key: recent.key + "|starred" },
        { ...recent, key: "demo-old|starred", sessionId: "demo-old", name: "Rate limiter design", lastActive: Date.now() - 9 * DAY, stopped: null, recap: null },
      ];
    }
    const plan = first.plans?.[0];
    if (plan) {
      plan.starred = true;
      first.starredPlans = [
        { ...plan, key: plan.key + "|starred" },
        { ...plan, key: "demo-old-plan|starred", slug: "old-plan", title: "Cache the API answers", updatedAt: Date.now() - 9 * DAY, chatId: null },
      ];
    }
  }
  // (?stars=1&open=1: the starred lists unfolded too)
  if (params.get("stars") === "1" && params.get("open") === "1" && first)
    for (const fold of ["|chats", "|plans"]) if (!uiState.get().starred[first.id + fold]) toggleStarred(first.id + fold);
  // ?banner=0: without the "Demo data" line, for the README's screenshots
  if (params.get("banner") === "0") state.demo = false;
  // ?keep=1: the first chat at work keeps going (after each usage limit), and one gave up
  if (params.get("keep") === "1" && state.status) {
    const chats = groups.flatMap((g) => g.sessions);
    const working = chats.find((s) => s.state === "working");
    const other = chats.find((s) => s !== working && s.state !== "working");
    const kept = (chat: string, error = "") => ({ chat, profile: ".claude", name: "", since: Date.now(), wentOnAt: null, tries: 0, note: "", error });
    state.status.keep = [
      ...(working ? [kept(working.chatId || working.sessionId)] : []),
      ...(other ? [kept(other.chatId || other.sessionId, "Gave up after 5 tries: it didn't go on")] : []),
    ];
  }
  send({ type: "state", state });
}

setTimeout(() => {
  sendState();
  send({ type: "visible", visible: true });
  // ?week=1: the Week tab, its days there from the start (a screenshot doesn't wait)
  if (params.get("week") === "1") send({ type: "week", back: 0, account: "", recap: demoWeek(Date.now()), error: "" });
  // ?scroll=N: to see the top stay put over the list
  const scroll = Number(params.get("scroll"));
  if (scroll) setTimeout(() => window.scrollTo(0, scroll), 300);
}, 0);

setInterval(() => {
  phase += 1;
  sendState();
}, 4000);

setTimeout(() => send({ type: "petEvent", kind: "done", text: "Fix the date parser is done!", key: "demo-1" }), 2000);

// The Week tab asks for its days: the made-up ones
window.addEventListener("harness-post", (event) => {
  const m = (event as CustomEvent).detail as { type: string; back?: number; account?: string };
  if (m.type !== "week") return;
  const back = m.back ?? 0;
  const account = m.account ?? "";
  send({ type: "week", back, account, recap: demoWeek(Date.now(), back, account), error: "" });
});
