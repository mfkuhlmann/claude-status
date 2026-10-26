// Answer Permission Prompts from Claude Status…: the widget's hook
// (pane.py --relay on|off) in each Claude profile's settings.json, here and
// on the SSH hosts shown. With it, a chat that asks for a permission shows
// Allow once, Always allow and Deny in its row, its tab and its notification;
// Claude still asks in the chat too, and the first answer counts. Chats in
// tmux can be answered without it (with their dialog's keys).

import * as vscode from "vscode";
import type { Backend } from "./backend";
import { configDirArgs } from "./config";
import type { Dashboard } from "./dashboard";

export async function answerPermissionsHere(backend: Backend, dash: Dashboard): Promise<void> {
  const status = await backend.pane(["--relay", "status", ...configDirArgs()], 30000);
  const on = !!status.on;
  const hosts = dash.shownHosts();
  const where = hosts.length ? ` (and on ${hosts.join(", ")})` : "";
  const items: (vscode.QuickPickItem & { on: boolean })[] = [
    {
      label: `${on ? "$(check) " : ""}Answer them from Claude Status too`,
      description: on ? "on now" : "",
      detail: `Adds a hook to each Claude profile's settings.json${where}: a chat that asks for a permission shows Allow once, Always allow and Deny in its row, its tab and its notification, and Claude's questions show their options there to answer. Claude still asks in the chat; the first answer counts.`,
      on: true,
    },
    {
      label: `${!on ? "$(check) " : ""}Only in the chats`,
      description: !on ? "on now" : "",
      detail: `Takes the hook out again${where}. Chats in tmux can still be answered from here, with their dialog's keys.`,
      on: false,
    },
  ];
  const pick = await vscode.window.showQuickPick(items, { title: "Permission prompts", placeHolder: "Where can you answer them?" });
  if (!pick) return;
  const flag = pick.on ? "on" : "off";
  const results: Record<string, any>[] = await Promise.all([
    backend.pane(["--relay", flag, ...configDirArgs()], 30000),
    ...hosts.map((h) => backend.pane(["--relay", flag, "--host", h], 90000).then((r) => ({ ...r, host: h }))),
  ]);
  const failed = results.filter((r) => !r.ok);
  if (failed.length)
    void vscode.window.showErrorMessage(
      `Claude Status: ${failed.map((r) => `${r.host ? `${r.host}: ` : ""}${String(r.message ?? "no answer")}`).join("; ")}`,
    );
  else void vscode.window.showInformationMessage(`Claude Status: ${String(results[0].message ?? "")}${where}.`);
}
