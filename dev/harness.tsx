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
  send({ type: "state", state: demoState(Date.now(), phase) });
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
