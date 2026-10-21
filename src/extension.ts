// Claude Status for VS Code. Runs on this computer only ("extensionKind":
// ["ui"]), also in Remote-SSH windows: it reads this computer's Claude Code
// files and reaches SSH hosts with this computer's ssh, so one view shows them
// all, whichever machine the window is connected to.

import * as vscode from "vscode";
import { Accounts } from "./accounts";
import { AccountSwitch } from "./accountSwitch";
import { Actions } from "./actions";
import { Backend } from "./backend";
import { openChangesLink } from "./changes";
import { extraConfigDirs, settings } from "./config";
import { markdownLinkFile, openAgentRunFile } from "./agentRun";
import { Dashboard } from "./dashboard";
import { Notifier } from "./notify";
import { allGroups, countStates } from "./shared/model";
import { StatusBar } from "./statusBar";
import { registerPreview, setUpUsageBars } from "./statusline";
import { terminalLinkOf, Terminals } from "./terminals";
import { ViewHost } from "./view";

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel("Claude Status", { log: true });
  const backend = new Backend(context.extensionPath, settings.python);
  const terminals = new Terminals();
  // Notifications open chats through the actions, which need the dashboard
  let actions: Actions | undefined;
  const notifier = new Notifier(backend, (chat) => void actions?.open(chat));
  const dash = new Dashboard(backend, notifier, log);
  const statusBar = new StatusBar(); // (first: the main status bar item)
  const account = new AccountSwitch(dash, backend);
  actions = new Actions(backend, dash, terminals, log, account);
  const accounts = new Accounts(backend, dash, terminals, account, log);
  const view = new ViewHost(context.extensionUri, dash, actions);
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
    vscode.commands.registerCommand("claudeStatus.accounts", () => accounts.manage()),
    vscode.commands.registerCommand("claudeStatus.addAccount", () => accounts.add()),
    vscode.commands.registerCommand("claudeStatus.nextChat", () => a.nextChat()),
    // the Plasma and GNOME widgets hand over what a chat changed (changes.ts)
    // and which terminal a chat runs in (terminals.ts)
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        if (uri.path.replace(/\/+$/, "") === "/markdown") {
          // a plan or a subagent's run, in the Markdown preview
          const file = markdownLinkFile(uri, undefined, extraConfigDirs());
          if (!file) {
            log.warn(`Ignored a link that isn't a plan or a run of the Claude Status widget: ${uri.toString()}`);
            return;
          }
          const error = await openAgentRunFile(file);
          if (error) void vscode.window.showErrorMessage(`Claude Status: couldn't show ${file}: ${error}`);
          return;
        }
        const link = terminalLinkOf(uri);
        if (!link) return openChangesLink(uri, log);
        if (await terminals.showLinked(link, dash.currentHost)) return;
        log.warn(`No terminal of this window runs that chat: ${uri.toString()}`);
        void vscode.window.showWarningMessage("Claude Status: this window has no terminal running that chat.");
      },
    }),
    vscode.commands.registerCommand("claudeStatus.refresh", () => dash.refreshAll()),
    vscode.commands.registerCommand("claudeStatus.pickHosts", () => a.pickHosts()),
    vscode.commands.registerCommand("claudeStatus.openInEditor", () => view.openInEditor()),
    vscode.commands.registerCommand("claudeStatus.newChat", () => a.newChat()),
    vscode.commands.registerCommand("claudeStatus.findChat", () => a.findChat()),
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
