// Feeds the webview demo data, the way the extension would: a state after
// "ready", then a new one every few seconds with the story moved on.

import "../webview/main";
import { demoState } from "../src/shared/demo";
import type { HostMessage } from "../src/shared/types";

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
  // ?loggedOut=1: the last account isn't logged in (Log in…)
  const groups = state.status?.groups ?? [];
  if (params.get("loggedOut") === "1" && groups.length)
    groups[groups.length - 1] = { ...groups[groups.length - 1], loggedOut: true, loginCommand: "claude auth login", limits: null };
  // ?default=1: a second account here, and the first one marked the default
  if (params.get("default") === "1" && groups.length)
    groups.splice(1, 0, { ...groups[0], id: "demo-second", name: "work", title: "work · Team", plan: "Team", defaultHere: false, sessions: [] }),
      (groups[0] = { ...groups[0], defaultHere: true });
  send({ type: "state", state });
}

setTimeout(() => {
  sendState();
  send({ type: "visible", visible: true });
  // ?scroll=N: to see the top stay put over the list
  const scroll = Number(params.get("scroll"));
  if (scroll) setTimeout(() => window.scrollTo(0, scroll), 300);
}, 0);

setInterval(() => {
  phase += 1;
  sendState();
}, 4000);

setTimeout(() => send({ type: "petEvent", kind: "done", text: "Fix the date parser is done!", key: "demo-1" }), 2000);
