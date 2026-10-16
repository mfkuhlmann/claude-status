// Claude Status for VS Code. Runs on this computer only ("extensionKind":
// ["ui"]), also in Remote-SSH windows: it reads this computer's Claude Code
// files and reaches SSH hosts with this computer's ssh, so one view shows them
// all, whichever machine the window is connected to.

import * as vscode from "vscode";
import { AccountSwitch } from "./accountSwitch";
import { Actions } from "./actions";
import { Backend } from "./backend";
import { settings } from "./config";
import { Dashboard } from "./dashboard";
import { Notifier } from "./notify";
import { allGroups, countStates } from "./shared/model";
import { StatusBar } from "./statusBar";
import { registerPreview, setUpUsageBars } from "./statusline";
import { Terminals } from "./terminals";
import { ViewHost } from "./view";

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("Claude Status", { log: true });
  const backend = new Backend(context.extensionPath, settings.python);
  const terminals = new Terminals();
  // Notifications open chats through the actions, which need the dashboard
  let actions: Actions | undefined;
  const notifier = new Notifier(backend, (chat) => void actions?.open(chat));
  const dash = new Dashboard(backend, notifier, log);
  actions = new Actions(backend, dash, terminals, log);
  const view = new ViewHost(context.extensionUri, dash, actions);
  const statusBar = new StatusBar();
  const account = new AccountSwitch(dash);
  const a = actions;

  context.subscriptions.push(
    log,
    terminals,
    notifier,
    dash,
    view,
    statusBar,
    account,
    registerPreview(),
    vscode.window.registerWebviewViewProvider(ViewHost.viewId, view, { webviewOptions: { retainContextWhenHidden: true } }),
    dash.onState((state) => {
      statusBar.update(state);
      account.update(state);
      view.setBadge(countStates(allGroups(state.status, state.hosts)).waiting);
    }),
    vscode.commands.registerCommand("claudeStatus.switchAccount", () => account.switch()),
    vscode.commands.registerCommand("claudeStatus.refresh", () => dash.refreshAll()),
    vscode.commands.registerCommand("claudeStatus.pickHosts", () => a.pickHosts()),
    vscode.commands.registerCommand("claudeStatus.openInEditor", () => view.openInEditor()),
    vscode.commands.registerCommand("claudeStatus.newChat", () => a.newChat()),
    vscode.commands.registerCommand("claudeStatus.showRemoved", () => a.showRemoved()),
    vscode.commands.registerCommand("claudeStatus.setupUsageBars", () => setUpUsageBars(context.extensionUri)),
    vscode.commands.registerCommand("claudeStatus.removeUsageBars", () => setUpUsageBars(context.extensionUri, true)),
    vscode.commands.registerCommand("claudeStatus.openUsagePage", () =>
      vscode.env.openExternal(vscode.Uri.parse("https://claude.ai/settings/usage")),
    ),
    vscode.commands.registerCommand("claudeStatus.toggleDemo", () => {
      const on = dash.toggleDemo();
      void vscode.window.showInformationMessage(on ? "Claude Status shows made-up demo chats now." : "Claude Status shows your chats again.");
    }),
    vscode.commands.registerCommand("claudeStatus.showLog", () => log.show()),
  );
  statusBar.update(dash.state());
  void dash.start();
}

export function deactivate(): void {
  // everything is in context.subscriptions
}
