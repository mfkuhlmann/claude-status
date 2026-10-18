// What clicks do: open a chat, stop or remove one, share it, start a new one,
// pick SSH hosts. Opening happens in VS Code's terminal by default (on the
// machine the chat is on); claudeStatus.openIn = "system" keeps the widget's
// way (jump.py / remote.py: your desktop's terminal app; window raising on
// KDE, and on GNOME with the widget's GNOME Shell extension).

import * as os from "node:os";
import * as vscode from "vscode";
import type { Answer, Backend } from "./backend";
import { configDirArgs, setSshHosts, settings } from "./config";
import { openComparison } from "./changes";
import { claudePanelAvailable, localPanelProfileKey, openPanelChat } from "./claudePanel";
import type { Dashboard } from "./dashboard";
import { canRaiseWindows, isGnome } from "./desktop";
import { chatRef } from "./notify";
import { allGroups, canEndChat, cliInstalled, groupLabel, hasTurn, nextChatIndex, shellQuote } from "./shared/model";
import type { ChatRef, Group } from "./shared/types";
import { localAncestors, type Place, type Terminals } from "./terminals";

const CHAT_LINK = "vscode://anthropic.claude-code/open?session=";

// The plain chat command inside "cd FOLDER 2>/dev/null; COMMAND" (how the
// backend's in_folder() writes a command for a folder)
export function chatCommandOf(command: string): string | null {
  const sep = " 2>/dev/null; ";
  const i = command.indexOf(sep);
  return command.startsWith("cd ") && i > 0 ? command.slice(i + sep.length) : null;
}

export function inFolder(folder: string, command: string): string {
  return folder.startsWith("/") ? `cd ${shellQuote(folder)} 2>/dev/null; ${command}` : command;
}

// "cd /home/someone 2>/dev/null; …" → "/home/someone"
export function folderOf(command: string): string | null {
  const m = /^cd ('(?:[^']|'"'"')*'|\S+) 2>\/dev\/null; /.exec(command);
  if (!m) return null;
  const word = m[1];
  return word.startsWith("'") ? word.slice(1, -1).replace(/'"'"'/g, "'") : word;
}

const AGAIN_MS = 30000; // pressing the shortcut again this soon goes on to the next chat

export class Actions {
  private lastNext: { id: string; at: number } | null = null;
  private visited = new Set<string>(); // chats the shortcut went to in this round

  constructor(
    private backend: Backend,
    private dash: Dashboard,
    private terminals: Terminals,
    private log: vscode.LogOutputChannel,
  ) {}

  private place(host?: string): Place {
    if (!host) return { kind: "local" };
    return host === this.dash.currentHost ? { kind: "windowHost" } : { kind: "ssh", host };
  }

  private fail(message: string): void {
    this.log.warn(message);
    this.dash.setActionError(message);
    if (!this.dash.isVisible()) void vscode.window.showErrorMessage(message);
  }

  private report(answer: Answer, failurePrefix: string): boolean {
    if (!answer.ok) this.fail(`${failurePrefix}: ${answer.message}`);
    return answer.ok;
  }

  private demoOnly(): boolean {
    if (!this.dash.demo) return false;
    void vscode.window.showInformationMessage("Demo mode: these chats are made up. Run “Claude Status: Toggle Demo Data” to go back.");
    return true;
  }

  // ---------------------------------------------------------------- open

  async open(chat: ChatRef): Promise<void> {
    if (this.demoOnly()) return;
    if (settings.openIn() === "system") return this.openSystem(chat);
    const host = chat.host;
    const onWindowHost = !!host && host === this.dash.currentHost;
    // Already running in one of this window's terminals: show that one
    if (chat.pid) {
      const ancestors = host ? (onWindowHost ? await this.remoteAncestors(host, chat.pid) : new Set<number>()) : localAncestors(chat.pid);
      const t = await this.terminals.find(ancestors, onWindowHost);
      if (t) {
        t.show();
        return;
      }
    }
    // A chat in the Claude Code extension: its link reveals it
    if (chat.entrypoint === "claude-vscode" && chat.pid !== null) {
      const thisWindow = host ? onWindowHost : !vscode.env.remoteName;
      if (!thisWindow && canRaiseWindows()) return this.openSystem(chat); // raises the window it's in
      await vscode.env.openExternal(vscode.Uri.parse(CHAT_LINK + encodeURIComponent(chat.sessionId)));
      return;
    }
    // A command opens it: a background job attaches, a finished chat resumes
    if (chat.openCommand) {
      await this.terminals.run(`${host ?? ""}|${chat.key}`, chat.name, chat.openCommand, this.place(host));
      return;
    }
    // It runs in a terminal outside VS Code
    if (canRaiseWindows()) return this.openSystem(chat);
    this.fail(`${chat.name} runs in a terminal outside this VS Code window${host ? ` on ${host}` : ""}.`);
  }

  // The widget's way: jump.py raises the terminal tab or window it runs in
  private async openSystem(chat: ChatRef): Promise<void> {
    const host = chat.host;
    let answer: Answer;
    if (!host) {
      const profile = chat.profileDir ? ["--profile", chat.profileDir] : [];
      answer = await this.backend.action("jump.py", [chat.sessionId, ...profile, ...configDirArgs()]);
    } else if (chat.openCommand) {
      answer = await this.backend.action("remote.py", ["--open", host, chat.openCommand]);
    } else if (chat.entrypoint === "claude-vscode") {
      answer = await this.backend.action("jump.py", ["--remote-vscode", host, chat.sessionId, ...(chat.cwd ? ["--cwd", chat.cwd] : [])]);
    } else {
      answer = await this.backend.action("jump.py", ["--remote-terminal", host, "--name", chat.name || ""]);
    }
    // jump.py's "is the Claude Status extension enabled?" means GNOME's, not this one
    if (!answer.ok && isGnome()) answer.message = answer.message.replace("Claude Status extension", "Claude Status GNOME Shell extension");
    this.report(answer, "Couldn't open the chat");
  }

  // A recent chat, reopened in a Claude Code tab (the switch above the recent
  // chats). This window does it when it has the chat's folder open, on the
  // chat's machine and account; else VS Code opens that folder (the window
  // that has it, or a new one; a host's through Remote-SSH) and the chat
  // there (jump.py, which also refuses an account Claude Code isn't on).
  async openInClaudeCode(chat: ChatRef): Promise<void> {
    if (this.demoOnly()) return;
    const id = chat.chatId || chat.sessionId;
    const host = chat.host;
    const here = host ? true : chat.profileDir === localPanelProfileKey();
    if (here && chat.cwd && this.windowHasFolder(chat.cwd, host)) {
      await vscode.env.openExternal(vscode.Uri.parse(CHAT_LINK + encodeURIComponent(id)));
      return;
    }
    const answer = host
      ? await this.backend.action("jump.py", ["--remote-resume-vscode", host, id, ...(chat.cwd ? ["--cwd", chat.cwd] : [])])
      : await this.backend.action("jump.py", ["--resume", id, "--profile", chat.profileDir, "--vscode", ...configDirArgs()]);
    this.report(answer, "Couldn't open the chat in Claude Code");
  }

  // This window is on the machine of a chat (here, or the host it's connected
  // to) and has its folder open
  private windowHasFolder(folder: string, host?: string): boolean {
    const sameMachine = host ? host === this.dash.currentHost : !vscode.env.remoteName;
    const want = folder.replace(/\/+$/, "");
    return sameMachine && (vscode.workspace.workspaceFolders ?? []).some((f) => f.uri.path.replace(/\/+$/, "") === want);
  }

  // The process ids from pid up to init on the host (to find its terminal here)
  private async remoteAncestors(host: string, pid: number): Promise<Set<number>> {
    const script = `p=${Math.trunc(pid)}; out=; while [ -n "$p" ] && [ "$p" -gt 1 ]; do out="$out $p"; p=$(ps -o ppid= -p "$p" | tr -d ' '); done; echo $out`;
    const answer = await this.backend.action("remote.py", ["--run", host, script], 20000);
    const out = new Set<number>();
    if (answer.ok) for (const w of answer.message.split(/\s+/)) if (/^\d+$/.test(w)) out.add(Number(w));
    return out;
  }

  // ---------------------------------------------------------------- stop / remove

  // A background session (`claude stop`), or a chat with a process of its
  // own. A working chat can be interrupted, as if Ctrl+C were pressed (what
  // the stop button of the Claude Code tab does: the turn and its subagents
  // stop, the chat stays), where that can be done: in a terminal of this
  // window (typed into it) or in tmux (the backend sends it to the pane; Esc
  // would leave background subagents running). Else, and when you choose to,
  // it's stopped: its claude quits as when its terminal closes; in a Claude
  // Code tab the tab shows it as interrupted and goes on with your next
  // message. The backend looks again first and leaves an idle chat that got
  // back to work alone.
  async stop(chat: ChatRef): Promise<void> {
    if (this.demoOnly()) return;
    const chatProcess = canEndChat(chat);
    const busy = chat.state !== "idle";
    const inTab = chat.entrypoint === "claude-vscode";
    let terminal: vscode.Terminal | undefined;
    if (chatProcess && hasTurn(chat) && !inTab && chat.pid) {
      const onWindowHost = !!chat.host && chat.host === this.dash.currentHost;
      const ancestors = chat.host
        ? onWindowHost ? await this.remoteAncestors(chat.host, chat.pid) : new Set<number>()
        : localAncestors(chat.pid);
      terminal = await this.terminals.find(ancestors, onWindowHost);
    }
    const interruptible = !!terminal || (chatProcess && hasTurn(chat) && !inTab && !!chat.tmux);
    const detail = !chatProcess
      ? "It's interrupted; its conversation is kept, and `claude attach` resumes it."
      : interruptible
        ? `Interrupt: like Ctrl+C in its ${terminal ? "terminal" : "tmux pane"}, or the stop button of a Claude Code tab; the current step and its subagents stop, and the chat stays open there.\n\nStop: Claude quits (the current step is cut off) and its terminal stays open; the chat is kept and shows under Recent chats.`
        : inTab
          ? chat.state === "working"
            ? "It's working right now: the current step is interrupted, as with the stop button in its tab, and anything it was running stops. The tab keeps the chat and goes on with your next message."
            : chat.state === "waiting"
              ? "It's waiting for you: what it asks is refused, as with the stop button in its tab. The tab keeps the chat and goes on with your next message."
              : "It's idle, so nothing is interrupted: its Claude process quits. The tab keeps the chat and goes on with your next message."
          : chat.state === "working"
            ? "It's working right now: the current step is cut off and anything it was running stops. Claude quits and its terminal stays open; the chat is kept and shows under Recent chats."
            : chat.state === "waiting"
              ? "It's waiting for you: Claude quits without your answer and its terminal stays open. The chat is kept and shows under Recent chats."
              : "It's idle, so nothing is interrupted: Claude quits and its terminal stays open. The chat is kept and shows under Recent chats.";
    const choice = await vscode.window.showWarningMessage(
      interruptible ? `Interrupt or stop “${chat.name}”?` : `Stop “${chat.name}”?`,
      { modal: true, detail },
      ...(interruptible ? ["Interrupt", "Stop"] : ["Stop"]),
    );
    if (choice === "Interrupt") {
      if (terminal) {
        terminal.sendText("\x03", false); // Ctrl+C, as if pressed in it (Claude's terminal is raw: a key, not a signal)
        return;
      }
      const profile = chat.profileDir ? [chat.profileDir] : [];
      const answer = chat.host
        ? await this.backend.action("remote.py", ["--interrupt", chat.host, chat.sessionId, ...profile])
        : await this.backend.action("jump.py", ["--interrupt", chat.sessionId, ...(chat.profileDir ? ["--profile", chat.profileDir] : []), ...configDirArgs()]);
      this.report(answer, "Couldn't interrupt the chat");
      this.refresh(chat.host);
      return;
    }
    if (choice !== "Stop") return;
    let answer: Answer;
    if (chat.host && chatProcess) {
      answer = await this.backend.action("remote.py", ["--end", chat.host, chat.sessionId, ...(chat.profileDir ? [chat.profileDir] : []), ...(busy ? ["--busy"] : [])]);
    } else if (chat.host) {
      if (!chat.stopCommand) return this.fail(`${chat.name} can't be stopped from here.`);
      answer = await this.backend.action("remote.py", ["--run", chat.host, chat.stopCommand]);
    } else {
      const profile = chat.profileDir ? ["--profile", chat.profileDir] : [];
      answer = await this.backend.action("jump.py", ["--stop", chat.sessionId, ...profile, ...(busy ? ["--busy"] : []), ...configDirArgs()]);
    }
    if (this.report(answer, "Couldn't stop the chat") && /killed|ended/.test(answer.message)) this.dash.setActionInfo(answer.message);
    this.refresh(chat.host);
  }

  async dismiss(chat: ChatRef): Promise<void> {
    if (this.demoOnly()) return;
    const answer = chat.host
      ? await this.backend.action("remote.py", ["--dismiss", chat.host, chat.sessionId])
      : await this.backend.action("jump.py", ["--dismiss", chat.sessionId, ...configDirArgs()]);
    this.report(answer, "Couldn't remove it");
    this.refresh(chat.host);
  }

  async showRemoved(host?: string | null): Promise<void> {
    if (this.demoOnly()) return;
    if (host === undefined) {
      // From the command palette: where?
      const state = this.dash.state();
      const items = [
        { label: "This computer", description: `${state.status?.dismissed ?? 0} removed`, host: null as string | null },
        ...state.hosts.map((h) => ({ label: h.name, description: `${h.result?.dismissed ?? 0} removed`, host: h.name as string | null })),
      ];
      const pick = items.length > 1 ? await vscode.window.showQuickPick(items, { placeHolder: "Show removed chats again on…" }) : items[0];
      if (!pick) return;
      host = pick.host;
    }
    const answer = host
      ? await this.backend.action("remote.py", ["--undismiss-all", host])
      : await this.backend.action("jump.py", ["--undismiss-all", ...configDirArgs()]);
    if (this.report(answer, "Couldn't show them again")) this.dash.setActionInfo(answer.message || "Shown again");
    this.refresh(host ?? undefined);
  }

  private refresh(host?: string): void {
    if (host) void this.dash.pollHost(host);
    else void this.dash.refresh();
  }

  // ---------------------------------------------------------------- shared chats

  // Share a chat with your other accounts, continue it on one, or keep it on
  // one only (jump.py does it, through the widget's sharing.py; the view
  // offers this with two or more accounts on this computer).
  async share(chat: ChatRef): Promise<void> {
    if (this.demoOnly()) return;
    const groups = this.dash.state().status?.groups ?? [];
    const shareAccounts = groups.filter((g) => !!g.shareProfile);
    const here = groups.find((g) => g.profileKeys.includes(chat.profileDir));
    type Item = vscode.QuickPickItem & { kind2?: "continue" | "share" | "keeponly"; group?: Group };
    const items: Item[] = [];
    for (const g of shareAccounts) {
      if (g === here) continue;
      items.push({ label: chat.shared ? `Continue on ${g.title}` : `Share and continue on ${g.title}`, kind2: "continue", group: g });
    }
    if (!chat.shared) items.push({ label: "Share with all accounts", kind2: "share" });
    else {
      items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
      for (const g of shareAccounts) items.push({ label: `Keep only on ${g.title}…`, kind2: "keeponly", group: g });
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder: chat.name });
    if (!pick?.kind2) return;
    if (pick.kind2 === "keeponly") {
      const others = shareAccounts.filter((g) => g !== pick.group).map((g) => g.title).join(", ");
      const ok = await vscode.window.showWarningMessage(
        `Keep “${chat.name}” only on ${pick.group!.title}?`,
        { modal: true, detail: `It's removed from ${others || "the other accounts"}.` },
        "Keep Only There",
      );
      if (ok !== "Keep Only There") return;
    }
    const flag = { continue: "--continue", share: "--share", keeponly: "--unshare" }[pick.kind2];
    // the account it goes to; for "all accounts", the one whose copy is shared
    const profile = pick.group?.shareProfile ? ["--profile", pick.group.shareProfile]
      : chat.profileDir ? ["--profile", chat.profileDir] : [];
    const id = chat.chatId || chat.sessionId;
    // Continuing it opens it like any chat: in VS Code's terminal, unless
    // openIn says the desktop's (then jump.py opens that itself)
    const vscodeTerminal = pick.kind2 === "continue" && settings.openIn() !== "system";
    const answer = await this.backend.action("jump.py", [flag, id, ...profile, ...(vscodeTerminal ? ["--print-command"] : []), ...configDirArgs()]);
    if (this.report(answer, "Couldn't share it")) {
      if (answer.command) await this.terminals.run(`|${id}|${pick.group?.shareProfile ?? ""}`, chat.name, answer.command, { kind: "local" });
      else if (pick.kind2 !== "continue") this.dash.setActionInfo(answer.message);
    }
    void this.dash.refresh();
  }

  // ---------------------------------------------------------------- new chat

  async newChat(groupId?: string, host?: string): Promise<void> {
    if (this.demoOnly()) return;
    const state = this.dash.state();
    const groups = allGroups(state.status, state.hosts);
    let group = groupId !== undefined ? groups.find((g) => g.id === groupId && (g.host ?? "") === (host ?? "")) : undefined;
    if (!group) {
      if (!groups.length) return this.fail("No Claude Code account found yet: run `claude` once in a terminal.");
      group =
        groups.length === 1
          ? groups[0]
          : (
              await vscode.window.showQuickPick(
                groups.map((g) => ({ label: groupLabel(g), description: g.plan ?? "", group: g })),
                { placeHolder: "New chat on which account?" },
              )
            )?.group;
      if (!group) return;
    }
    host = group.host;
    if (!this.cliOn(host)) return this.newChatWithoutCli(group);
    if (settings.openIn() === "system" && !host) return this.newChatSystem(group);
    const home = group.homeChatCommand ?? "";
    const chat = chatCommandOf(home);
    if (!home || !chat) return this.fail(`Can't start a chat on ${groupLabel(group)} from here.`);
    // Here: recent folders, then any folder you pick. A host's folders can't be
    // browsed unless this window is connected to it: its home folder is listed.
    const folders = host ? group.projects.slice() : group.projects.filter((f) => f.short !== "~");
    if (host && !folders.some((f) => f.short === "~")) folders.push({ path: "", short: "~", newChatCommand: home });
    type Item = vscode.QuickPickItem & { command?: string; choose?: "dialog" | "type"; panel?: true };
    const items: Item[] = folders.map((f) => ({
      label: `$(${f.short === "~" ? "home" : "folder"}) ${f.short === "~" ? "Home folder (~)" : f.short}`,
      command: f.newChatCommand ?? inFolder(f.path, chat),
    }));
    items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
    const canBrowse = !host || host === this.dash.currentHost;
    items.push(canBrowse ? { label: "$(folder-opened) Choose folder…", choose: "dialog" } : { label: "$(edit) Type a folder…", choose: "type" });
    const panel = await this.panelChoice(group);
    if (panel.length) items.unshift({ label: "In a terminal", kind: vscode.QuickPickItemKind.Separator });
    items.push(...panel);
    const where = host ? `${group.title} on ${host}` : group.title;
    const pick = await vscode.window.showQuickPick(items, { placeHolder: `New chat on ${where} in…` });
    if (!pick) return;
    if (pick.panel) return this.panelChat();
    let command = pick.command;
    if (pick.choose === "dialog") {
      const remoteHome = host ? folderOf(home) : null;
      const defaultUri = host
        ? remoteHome && vscode.workspace.workspaceFolders?.[0]
          ? vscode.workspace.workspaceFolders[0].uri.with({ path: remoteHome })
          : undefined
        : vscode.Uri.file(os.homedir());
      const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, defaultUri, openLabel: "Start Chat Here" });
      if (!picked?.length) return;
      command = inFolder(host ? picked[0].path : picked[0].fsPath, chat);
    } else if (pick.choose === "type") {
      const folder = await vscode.window.showInputBox({ prompt: `Folder on ${host}`, placeHolder: "/home/you/project" });
      if (!folder) return;
      command = inFolder(folder.trim(), chat);
    }
    if (command) await this.terminals.run(`new|${Date.now()}`, "new chat", command, this.place(host));
  }

  // There's a claude command on the machine (here, or that host) for chats in a terminal
  private cliOn(host?: string): boolean {
    const state = this.dash.state();
    return cliInstalled(host ? state.hosts.find((h) => h.name === host)?.result : state.status);
  }

  // No claude command there: a terminal can't start one, so the menu says so
  // and offers the Claude Code chat tab where that works
  private async newChatWithoutCli(group: Group): Promise<void> {
    const where = group.host ? `on ${group.host}` : "on this computer";
    const why = `Claude Code's claude command isn't installed ${where}: it isn't on PATH, in ~/.local/bin, npm's or nvm's folders, nor on the login shell's PATH.`;
    const panel = await this.panelChoice(group);
    if (!panel.length) return this.fail(`Can't start a chat in a terminal: ${why}`);
    type Item = vscode.QuickPickItem & { panel?: true };
    const items: Item[] = [
      { label: "In a terminal", kind: vscode.QuickPickItemKind.Separator },
      { label: "$(warning) No claude command", description: where, detail: why },
      ...panel,
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: `New chat on ${group.title} in…` });
    if (pick?.panel) return this.panelChat();
  }

  private async newChatSystem(group: Group): Promise<void> {
    type Item = vscode.QuickPickItem & { folder?: string | null; panel?: true };
    const items: Item[] = [
      ...group.projects.filter((f) => f.short !== "~").map((f) => ({ label: `$(folder) ${f.short}`, folder: f.path as string | null })),
      { label: "$(folder-opened) Choose folder…", folder: null },
    ];
    const panel = await this.panelChoice(group);
    if (panel.length) items.unshift({ label: "In a terminal", kind: vscode.QuickPickItemKind.Separator });
    items.push(...panel);
    const pick = await vscode.window.showQuickPick(items, { placeHolder: `New chat on ${group.title} in…` });
    if (!pick) return;
    if (pick.panel) return this.panelChat();
    const args = ["--new-chat", group.chatProfile, ...(pick.folder ? ["--cwd", pick.folder] : ["--choose-folder"]), ...configDirArgs()];
    this.report(await this.backend.action("jump.py", args, 600000), "Couldn't open a new chat");
  }

  // The Claude Code extension's chat, offered for an account on this window's
  // machine: it starts in the window's folder, on the account its own
  // settings give it, which the menu names when it isn't the one picked.
  private async panelChoice(group: Group): Promise<(vscode.QuickPickItem & { panel?: true })[]> {
    const host = group.host;
    const sameMachine = host ? host === this.dash.currentHost : !vscode.env.remoteName;
    if (!sameMachine || !(await claudePanelAvailable())) return [];
    const folder = vscode.workspace.workspaceFolders?.[0]?.name;
    let note = folder ? `in ${folder}` : "in this window";
    if (host) {
      note += ` · the account Claude Code has on ${host}`;
    } else {
      const key = localPanelProfileKey();
      if (!group.profileKeys.includes(key)) {
        const other = (this.dash.state().status?.groups ?? []).find((g) => g.profileKeys.includes(key));
        note += ` · it uses ${other ? other.title : key}, not ${group.title}`;
      }
    }
    return [
      { label: "In VS Code", kind: vscode.QuickPickItemKind.Separator },
      { label: "$(comment-discussion) Claude Code chat tab", description: note, panel: true },
    ];
  }

  private async panelChat(): Promise<void> {
    try {
      await openPanelChat();
    } catch (e) {
      this.fail(`Couldn't open a Claude Code chat: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---------------------------------------------------------------- SSH hosts

  async pickHosts(): Promise<void> {
    const known = await this.backend.sshHosts();
    const picked = settings.sshHosts();
    const current = this.dash.currentHost;
    type Item = vscode.QuickPickItem & { host: string };
    const items: Item[] = known.map((h) => {
      const target = (h.user ? h.user + "@" : "") + (h.hostname || h.name) + (h.jump ? ` via ${h.jump}` : "");
      return {
        label: h.name,
        description: [target !== h.name ? target : "", h.name === current ? "this window's host" : ""].filter(Boolean).join(" · "),
        picked: picked.includes(h.name),
        host: h.name,
      };
    });
    for (const h of picked) if (!known.some((k) => k.name === h)) items.push({ label: h, description: "not in ~/.ssh/config", picked: true, host: h });
    if (!items.length) {
      void vscode.window.showInformationMessage("No hosts in ~/.ssh/config. Add a Host entry there, then pick it here.");
      return;
    }
    const chosen = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: "Show Claude on these SSH hosts (key-based login and python3 needed there; nothing is installed)",
    });
    if (!chosen) return;
    await setSshHosts(chosen.map((c) => c.host));
  }

  // ---------------------------------------------------------------- the chat that needs you

  // The shortcut (claudeStatus.nextChat): the chat waiting longest, then the
  // other waiting ones and the ones that finished while you weren't looking,
  // one per press; with none, the view. Chats it went to count as seen once
  // a round of presses is over.
  async nextChat(): Promise<void> {
    const now = Date.now();
    if (!this.lastNext || now - this.lastNext.at > AGAIN_MS) {
      for (const id of this.visited) this.dash.seen(id);
      this.visited.clear();
    }
    const list = this.dash.needingYou();
    const i = nextChatIndex(list, this.lastNext, now, AGAIN_MS);
    if (i < 0) {
      this.lastNext = null;
      await vscode.commands.executeCommand("claudeStatus.view.focus");
      return;
    }
    const spot = list[i];
    this.lastNext = { id: spot.id, at: now };
    this.visited.add(spot.id);
    await this.open(chatRef(spot.session, spot.host));
  }

  // ---------------------------------------------------------------- what a chat changed

  // Side by side in VS Code's changes view: each file as it was before the
  // chat (or before its last turn) and now (src/changes.ts)
  async compareChanges(chat: ChatRef, turn: boolean): Promise<void> {
    if (this.demoOnly()) return;
    if (chat.host) {
      this.fail(`${chat.name} runs on ${chat.host}: its files are there.`);
      return;
    }
    const answer = await this.backend.changes(chat.chatId || chat.sessionId, chat.profileDir, turn, configDirArgs());
    if (!answer.comparison) {
      // "No changed files in its last turn" is news, not a failure
      if (/^No changed files/.test(answer.message)) this.dash.setActionInfo(`${chat.name}: ${answer.message}.`);
      else this.fail(`Couldn't compare ${chat.name}'s changes: ${answer.message}`);
      return;
    }
    const error = await openComparison(answer.comparison);
    if (error) this.fail(`Couldn't show ${chat.name}'s changes: ${error}`);
  }

  async hideHost(host: string): Promise<void> {
    const picked = settings.sshHosts();
    if (picked.includes(host)) await setSshHosts(picked.filter((h) => h !== host));
    if (host === this.dash.currentHost && settings.includeCurrentRemote()) {
      void vscode.window.showInformationMessage(
        `${host} is this window's host, so it stays shown. Turn off “Claude Status: Include Current Remote” to hide it.`,
      );
    }
  }
}
