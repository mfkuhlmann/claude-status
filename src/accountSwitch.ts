// VS Code's Claude, the Claude Code extension's panel: which account it runs
// on (a status bar item) and switching it, through VS Code's own setting
// (vscodeAccount.ts). In a Remote-SSH window the panel runs on the host: the
// setting is a machine setting, which VS Code keeps per host (its Remote
// Settings, written from a window connected to it), so the host's accounts
// are listed and switched there, and this computer's setting stays as it is.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { localPanelProfileKey, panelConfigDir, profileKey } from "./claudePanel";
import type { Dashboard } from "./dashboard";
import { machineStatus } from "./shared/model";
import type { Group, ViewState } from "./shared/types";
import { profileDirs } from "./statusline";
import { configDirFor, withConfigDir } from "./vscodeAccount";

const RELOAD = "workbench.action.reloadWindow";

function tildify(p: string): string {
  const home = os.homedir();
  return p === home || p.startsWith(home + "/") ? "~" + p.slice(home.length) : p;
}

function realOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

function panelDir(): string {
  return panelConfigDir(vscode.workspace.getConfiguration("claudeCode").get("environmentVariables"));
}

export class AccountSwitch implements vscode.Disposable {
  private item = vscode.window.createStatusBarItem("claudeStatus.account", vscode.StatusBarAlignment.Right, 99);
  private startedOn = realOr(panelDir()); // the folder this window's panel started on
  private switching = false;
  private told = "";

  constructor(private dash: Dashboard) {
    this.item.name = "Claude Status: VS Code's Claude account";
    this.item.command = "claudeStatus.switchAccount";
  }

  dispose(): void {
    this.item.dispose();
  }

  update(state: ViewState): void {
    if (vscode.env.remoteName) return this.updateOnHost(state);
    const groups = state.status?.groups ?? [];
    if (state.demo || groups.length < 2) {
      this.item.hide();
      return;
    }
    const key = localPanelProfileKey();
    const group = groups.find((g) => g.profileKeys.includes(key));
    const dir = panelDir();
    this.item.text = `$(account) Claude: ${group ? group.name : key}`;
    this.item.tooltip = `VS Code's Claude runs on ${group ? group.title : key} (${tildify(dir)}). Click to switch.`;
    this.item.show();
    // Switched elsewhere (another window, or by hand): this window's panel
    // runs on the old account until the window reloads
    const now = realOr(dir);
    if (now !== this.startedOn && !this.switching && this.told !== now) {
      this.told = now;
      void vscode.window
        .showInformationMessage(
          `VS Code's Claude runs on ${group ? group.name : path.basename(now)} now. Reload this window so its Claude panel does too.`,
          "Reload Window",
        )
        .then((c) => c && vscode.commands.executeCommand(RELOAD));
    }
  }

  // A Remote-SSH window: the host's accounts, and which one Claude Code there
  // runs on (its backend reads the VS Code server's settings)
  private updateOnHost(state: ViewState): void {
    const host = this.dash.currentHost;
    const groups = host ? (machineStatus(state, host)?.groups ?? []) : [];
    if (!host || state.demo || groups.length < 2) {
      this.item.hide();
      return;
    }
    const on = groups.find((g) => g.vscodeHere);
    this.item.text = `$(account) Claude: ${on ? on.name : "?"}`;
    this.item.tooltip = `Claude Code on ${host} runs on ${on ? on.title : "an account the widget can't tell"}. Click to switch.`;
    this.item.show();
  }

  async switch(): Promise<void> {
    if (vscode.env.remoteName) return this.switchOnHost();
    if (!vscode.extensions.getExtension("anthropic.claude-code")) {
      void vscode.window.showInformationMessage("The Claude Code extension isn't installed, so there's no VS Code Claude to switch.");
      return;
    }
    const groups = this.dash.state().status?.groups ?? [];
    if (groups.length < 2) {
      void vscode.window.showInformationMessage(
        "There's one Claude account on this computer. Add another with `CLAUDE_CONFIG_DIR=~/.claude-work claude` and log in there with the other account.",
      );
      return;
    }
    const key = localPanelProfileKey();
    const pick = await vscode.window.showQuickPick(
      groups.map((g) => ({
        label: g.title,
        description: g.profileKeys.includes(key) ? "$(check) VS Code's Claude runs on it" : undefined,
        group: g,
      })),
      { title: "Account for VS Code's Claude", placeHolder: "The window reloads, so its Claude panel uses the account you pick" },
    );
    if (pick) await this.switchTo(pick.group);
  }

  private async switchTo(group: Group): Promise<void> {
    if (group.profileKeys.includes(localPanelProfileKey())) {
      void vscode.window.showInformationMessage(`VS Code's Claude already runs on ${group.name}.`);
      return;
    }
    const dir = profileDirs().find((d) => profileKey(d) === group.chatProfile);
    if (!dir) return this.fail(`Can't find the Claude folder of ${group.name}.`);
    const value = configDirFor(dir);
    if (value === null && process.env.CLAUDE_CONFIG_DIR) {
      // A plain ~/.claude runs without the variable, but VS Code itself has
      // one: its Claude would stay on that
      return this.fail(
        `VS Code was started with CLAUDE_CONFIG_DIR=${process.env.CLAUDE_CONFIG_DIR}, so its Claude keeps using that. ` +
          `Start VS Code without it to use ${group.name}.`,
      );
    }
    const ok = await vscode.window.showWarningMessage(
      `Use ${group.name} for VS Code's Claude?`,
      {
        modal: true,
        detail:
          "This window reloads: a chat running in its Claude panel stops (resume it afterwards). Other windows switch when they reload. " +
          "Plain `claude` in a terminal isn't affected." +
          (value
            ? "\n\nRemote-SSH windows read this setting too: on a host that doesn't have this folder, set \"claudeCode.environmentVariables\": [] in its Remote Settings."
            : ""),
      },
      "Switch",
    );
    if (ok !== "Switch") return;
    const cc = vscode.workspace.getConfiguration("claudeCode");
    const next = withConfigDir(cc.get("environmentVariables"), value);
    this.switching = true;
    try {
      await cc.update("environmentVariables", next.length ? next : undefined, vscode.ConfigurationTarget.Global);
    } catch (err) {
      this.switching = false;
      return this.fail(`Couldn't change VS Code's Claude settings: ${(err as Error).message}`);
    }
    setTimeout(() => void vscode.commands.executeCommand(RELOAD), 300);
    // the reload can be declined (unsaved files): then other switches count again
    setTimeout(() => (this.switching = false), 15000);
  }

  private async switchOnHost(): Promise<void> {
    const host = this.dash.currentHost;
    if (!host) {
      void vscode.window.showInformationMessage(
        "This window isn't connected to an SSH host (Remote-SSH), so there's no Claude account here to switch.",
      );
      return;
    }
    const groups = machineStatus(this.dash.state(), host)?.groups ?? [];
    if (groups.length < 2) {
      void vscode.window.showInformationMessage(`There's one Claude account on ${host}, so there's nothing to switch to.`);
      return;
    }
    const pick = await vscode.window.showQuickPick(
      groups.map((g) => ({
        label: g.title,
        description: g.vscodeHere ? `$(check) Claude Code on ${host} runs on it` : undefined,
        group: g,
      })),
      { title: `Account for Claude Code on ${host}`, placeHolder: "Its new chats start on the account you pick, in its other windows too" },
    );
    if (!pick) return;
    if (pick.group.vscodeHere) {
      void vscode.window.showInformationMessage(`Claude Code on ${host} already runs on ${pick.group.name}.`);
      return;
    }
    if (await this.switchHost(pick.group))
      void vscode.window.showInformationMessage(
        `Claude Code on ${host} runs on ${pick.group.name} now: new chats start there. Chats already open keep their account.`,
      );
  }

  // Claude Code on this window's SSH host runs on group's account from now
  // on (its new chats, its other windows there too). Written as a user
  // setting from a window connected to the host, VS Code puts this machine
  // setting into the host's Remote Settings; the Claude extension follows it.
  async switchHost(group: Group): Promise<boolean> {
    if (group.configDir === undefined) {
      this.fail(`Can't tell which folder ${group.name} has on ${group.host}: that host's status comes from an older Claude Status.`);
      return false;
    }
    const cc = vscode.workspace.getConfiguration("claudeCode");
    const next = withConfigDir(cc.get("environmentVariables"), group.configDir);
    try {
      await cc.update("environmentVariables", next.length ? next : undefined, vscode.ConfigurationTarget.Global);
    } catch (err) {
      this.fail(`Couldn't change Claude Code's settings on ${group.host}: ${(err as Error).message}`);
      return false;
    }
    void this.dash.refreshAll(); // the host's accounts and this item follow
    return true;
  }

  private fail(message: string): void {
    void vscode.window.showErrorMessage(message);
  }
}
