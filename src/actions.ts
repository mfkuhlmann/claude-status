// What clicks do: open a chat, stop or remove one, share it, start a new one,
// pick SSH hosts. Opening happens in VS Code's terminal by default (on the
// machine the chat is on); claudeStatus.openIn = "system" keeps the widget's
// way (jump.py / remote.py: your desktop's terminal app; window raising on
// KDE, and on GNOME with the widget's GNOME Shell extension).

import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";
import type { AccountSwitch } from "./accountSwitch";
import type { Answer, Backend } from "./backend";
import { configDirArgs, setSshHosts, settings } from "./config";
import { agentRunArgs } from "./agentRun";
import { openComparison } from "./changes";
import { claudePanelAvailable, localPanelProfileKey, openPanelChat } from "./claudePanel";
import { isAgentRunFile, openAgentRunFile } from "./agentRun";
import type { Dashboard } from "./dashboard";
import { canRaiseWindows, isGnome } from "./desktop";
import { chatRef } from "./notify";
import {
  ago,
  allGroups,
  canEndChat,
  chatRefOf,
  claudeCodeHere,
  cliInstalled,
  groupLabel,
  hasTurn,
  machineStatus,
  nextChatIndex,
  reopensInClaudeCode,
  shareAccounts,
  shellQuote,
} from "./shared/model";
import type { ChatRef, FoundChat, Group, PlanItem, Project, Session } from "./shared/types";
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
    private account: AccountSwitch,
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
      // in a VS Code terminal there: the window connected to the host shows it
      const vscode = chat.vscodeTerminal ? ["--vscode-terminal", String(Math.trunc(chat.vscodeTerminal)), ...(chat.cwd ? ["--cwd", chat.cwd] : [])] : [];
      answer = await this.backend.action("jump.py", ["--remote-terminal", host, "--name", chat.name || "", ...vscode]);
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
  // one only, between the accounts of the chat's machine: this computer's
  // (jump.py does it, through the widget's sharing.py) or its SSH host's
  // (remote.py runs sharing.py there). The view offers this with two or more
  // accounts there.
  async share(chat: ChatRef): Promise<void> {
    if (this.demoOnly()) return;
    const host = chat.host;
    const accounts = shareAccounts(machineStatus(this.dash.state(), host));
    const here = accounts.find((g) => g.profileKeys.includes(chat.profileDir));
    type Item = vscode.QuickPickItem & { kind2?: "continue" | "share" | "keeponly"; group?: Group };
    const items: Item[] = [];
    for (const g of accounts) {
      if (g === here) continue;
      items.push({ label: chat.shared ? `Continue on ${g.title}` : `Share and continue on ${g.title}`, kind2: "continue", group: g });
    }
    if (!chat.shared) items.push({ label: "Share with all accounts", kind2: "share" });
    else {
      items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
      for (const g of accounts) items.push({ label: `Keep only on ${g.title}…`, kind2: "keeponly", group: g });
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder: host ? `${chat.name} on ${host}` : chat.name });
    if (!pick?.kind2) return;
    if (pick.kind2 === "keeponly") {
      const others = accounts.filter((g) => g !== pick.group).map((g) => g.title).join(", ");
      const ok = await vscode.window.showWarningMessage(
        `Keep “${chat.name}” only on ${pick.group!.title}?`,
        { modal: true, detail: `It's removed from ${others || "the other accounts"}.` },
        "Keep Only There",
      );
      if (ok !== "Keep Only There") return;
    }
    const flag = { continue: "--continue", share: "--share", keeponly: "--unshare" }[pick.kind2];
    // the account it goes to; for "all accounts", the one whose copy is shared
    const profile = pick.group?.shareProfile || chat.profileDir || "";
    const id = chat.chatId || chat.sessionId;
    // Continuing it opens it like any chat: in VS Code's terminal (a host's
    // through ssh), unless openIn says the desktop's (then jump.py or
    // remote.py opens that itself)
    const print = pick.kind2 === "continue" && settings.openIn() !== "system" ? ["--print-command"] : [];
    const answer = host
      ? await this.backend.action("remote.py", [flag, host, id, ...(profile ? [profile] : []), ...print])
      : await this.backend.action("jump.py", [flag, id, ...(profile ? ["--profile", profile] : []), ...print, ...configDirArgs()]);
    if (this.report(answer, "Couldn't share it")) {
      if (answer.command) await this.terminals.run(`${host ?? ""}|${id}|${pick.group?.shareProfile ?? ""}`, chat.name, answer.command, this.place(host));
      else if (pick.kind2 !== "continue") this.dash.setActionInfo(answer.message);
    }
    this.refresh(host);
  }

  // ---------------------------------------------------------------- chats a usage limit stopped

  // Continue a chat a usage limit stopped on another account of its machine
  // (profile: that account's shareProfile): it's shared with that account and
  // reopened there, in VS Code's terminal (the desktop's with openIn
  // "system"). An idle Claude that has it open here quits first (--end-first).
  async handOver(chat: ChatRef, profile: string): Promise<void> {
    if (this.demoOnly()) return;
    const host = chat.host;
    const id = chat.chatId || chat.sessionId;
    const endFirst = chat.pid != null ? ["--end-first"] : [];
    const print = settings.openIn() !== "system" ? ["--print-command"] : [];
    const answer = host
      ? await this.backend.action("remote.py", ["--continue", host, id, profile, ...endFirst, ...print])
      : await this.backend.action("jump.py", ["--continue", id, "--profile", profile, ...endFirst, ...print, ...configDirArgs()]);
    if (this.report(answer, "Couldn't continue it there") && answer.command)
      await this.terminals.run(`${host ?? ""}|${id}|${profile}`, chat.name, answer.command, this.place(host));
    this.refresh(host);
  }

  // ---------------------------------------------------------------- plans

  // A plan in an editor tab: yours to change, also one of the host this
  // window is connected to. Another SSH host's comes over ssh as a copy
  // (remote.py --plan), shown in the Markdown preview.
  async openPlan(plan: { slug: string; path: string; profileDir: string }, host?: string): Promise<void> {
    if (this.demoOnly()) return;
    if (host && host !== this.dash.currentHost) {
      const answer = await this.backend.action("remote.py", ["--plan", host, plan.slug, plan.profileDir, "--no-open"]);
      if (!this.report(answer, "Couldn't open the plan")) return;
      if (!isAgentRunFile(answer.file)) return this.fail("Couldn't open the plan: the helper saved it somewhere unexpected");
      const error = await openAgentRunFile(answer.file);
      if (error) this.fail(`Couldn't open the plan: ${error}`);
      return;
    }
    // (a file of this computer, in a Remote-SSH window: through vscode-local)
    const uri = !host && vscode.env.remoteName ? vscode.Uri.from({ scheme: "vscode-local", path: plan.path }) : vscode.Uri.file(plan.path);
    try {
      await vscode.window.showTextDocument(uri, { preview: false });
    } catch (e) {
      this.fail(`Couldn't open the plan: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // The chat that made a plan, to change the plan with Claude: its row's
  // chat comes up, or it reopens (in a terminal or a Claude Code tab, as the
  // switch of Recent chats says)
  async continuePlanChat(plan: PlanItem, group: Group): Promise<void> {
    if (this.demoOnly() || !plan.chatId) return;
    const host = group.host;
    const machine = machineStatus(this.dash.state(), host);
    for (const g of machine?.groups ?? [])
      for (const s of g.sessions)
        if (s.chatId === plan.chatId || s.sessionId === plan.chatId) return this.open(chatRefOf(s, host));
    const chat: ChatRef = {
      host,
      key: plan.key,
      sessionId: plan.chatId,
      chatId: plan.chatId,
      profileDir: plan.chatProfileDir ?? plan.profileDir,
      name: plan.title,
      cwd: plan.cwd,
      kind: "chat",
      pid: null,
      openCommand: plan.openCommand ?? null,
    };
    const codeHere = claudeCodeHere(group, this.dash.claudeCodeInfo());
    if (reopensInClaudeCode(settings.reopenIn(), this.cliOn(host), codeHere)) return this.openInClaudeCode(chat);
    if (!chat.openCommand && !host) {
      // (an older status has no command for it: the widget's jump.py reopens it)
      const answer = await this.backend.action("jump.py", [plan.chatId, "--profile", chat.profileDir, ...configDirArgs()]);
      this.report(answer, "Couldn't reopen the chat");
      return;
    }
    return this.open(chat);
  }

  // Share a plan with the machine's other accounts, or keep it on one: one
  // file on each of them (the widget's sharing.py; an SSH host's there)
  async sharePlan(plan: PlanItem, group: Group): Promise<void> {
    if (this.demoOnly()) return;
    const host = group.host;
    const accounts = shareAccounts(machineStatus(this.dash.state(), host));
    const here = accounts.find((g) => g.profileKeys.includes(plan.profileDir));
    type Item = vscode.QuickPickItem & { to?: string; keep?: string };
    const items: Item[] = [];
    for (const g of accounts) if (g !== here && g.shareProfile) items.push({ label: `Share with ${g.title}`, to: g.shareProfile });
    if (accounts.length > 2) items.push({ label: "Share with all accounts", to: "" });
    if (plan.shared) {
      items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });
      for (const g of accounts) if (g.shareProfile) items.push({ label: `Keep only on ${g.title}`, keep: g.shareProfile });
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder: host ? `${plan.title} on ${host}` : plan.title });
    if (!pick || (pick.to === undefined && pick.keep === undefined)) return;
    const answer =
      pick.keep !== undefined
        ? host
          ? await this.backend.action("remote.py", ["--unshare-plan", host, plan.slug, pick.keep])
          : await this.backend.action("jump.py", ["--unshare-plan", plan.slug, "--profile", pick.keep, ...configDirArgs()])
        : host
          ? await this.backend.action("remote.py", ["--share-plan", host, plan.slug, plan.profileDir, ...(pick.to ? [pick.to] : [])])
          : await this.backend.action("jump.py", ["--share-plan", plan.slug, "--profile", plan.profileDir, ...(pick.to ? ["--to", pick.to] : []), ...configDirArgs()]);
    if (this.report(answer, "Couldn't share the plan")) this.dash.setActionInfo(answer.message);
    this.refresh(host);
  }

  // ---------------------------------------------------------------- finding a chat

  // Every chat with all the words you type in its name, its folder or one of
  // your prompts, here and on the SSH hosts shown (claude_status.py --find,
  // remote.py --find), newest first; the one you pick comes up, or reopens.
  async findChat(): Promise<void> {
    if (this.demoOnly()) return;
    type Item = vscode.QuickPickItem & { found?: FoundChat; host?: string };
    const qp = vscode.window.createQuickPick<Item>();
    qp.title = "Find a Chat";
    qp.placeholder = "Words in its name, its folder or one of your prompts";
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    let asked = 0;
    let timer: NodeJS.Timeout | undefined;
    const search = async (query: string) => {
      const mine = ++asked;
      if (query.trim().length < 2) {
        qp.items = [];
        qp.busy = false;
        return;
      }
      qp.busy = true;
      const hosts = this.dash.shownHosts();
      const answers = await Promise.all([
        this.backend.find(query, undefined, configDirArgs()),
        ...hosts.map((h) => this.backend.find(query, h)),
      ]);
      if (mine !== asked) return; // you typed on meanwhile
      const items: Item[] = [];
      const now = Date.now();
      answers.forEach((answer, i) => {
        const host = i ? hosts[i - 1] : undefined;
        if (hosts.length) items.push({ label: host ?? "This computer", kind: vscode.QuickPickItemKind.Separator });
        if (!answer.ok) items.push({ label: `$(warning) ${answer.message}`, alwaysShow: true });
        for (const c of answer.results)
          items.push({
            label: (c.shared ? "$(link) " : "") + c.name,
            description: `${c.account} · ${c.cwdShort || "~"} · ${ago(now - c.lastActive)}`,
            detail: c.match || undefined,
            alwaysShow: true,
            found: c,
            host,
          });
        if (answer.more) items.push({ label: "$(info) More chats have these words: add a word to narrow it down", alwaysShow: true });
      });
      if (!items.some((it) => it.found)) items.push({ label: "No chat with all of these words in its name, folder or your prompts", alwaysShow: true });
      qp.items = items;
      qp.busy = false;
    };
    qp.onDidChangeValue((value) => {
      clearTimeout(timer);
      timer = setTimeout(() => void search(value), 300);
    });
    const pick = await new Promise<Item | undefined>((resolve) => {
      qp.onDidAccept(() => {
        resolve(qp.selectedItems[0]);
        qp.hide();
      });
      qp.onDidHide(() => resolve(undefined));
      qp.show();
    });
    clearTimeout(timer);
    qp.dispose();
    if (pick?.found) await this.openFound(pick.found, pick.host);
  }

  // A chat the search found: its row's chat when it's listed, else reopened
  // (in a terminal or a Claude Code tab, as the switch of Recent chats says)
  private async openFound(found: FoundChat, host?: string): Promise<void> {
    const machine = machineStatus(this.dash.state(), host);
    let other: { s: Session } | null = null;
    for (const g of machine?.groups ?? [])
      for (const s of g.sessions)
        if (s.chatId === found.sessionId || s.sessionId === found.sessionId) {
          if ((g.profileKeys ?? []).includes(found.profileDir)) return this.open(chatRefOf(s, host));
          other = other ?? { s };
        }
    if (other) return this.open(chatRefOf(other.s, host));
    const group = (machine?.groups ?? []).find((g) => g.id === found.groupId || (g.profileKeys ?? []).includes(found.profileDir));
    const chat: ChatRef = {
      host,
      key: found.key,
      sessionId: found.sessionId,
      chatId: found.sessionId,
      profileDir: found.profileDir,
      name: found.name,
      cwd: found.cwd,
      kind: "chat",
      pid: null,
      openCommand: found.openCommand ?? null,
      shared: found.shared,
    };
    if (group && reopensInClaudeCode(settings.reopenIn(), this.cliOn(host), claudeCodeHere({ ...group, host }, this.dash.claudeCodeInfo())))
      return this.openInClaudeCode(chat);
    return this.open(chat);
  }

  // ---------------------------------------------------------------- new chat

  // A new chat on an account, in one of its folders (or one you pick), in a
  // terminal, or in the Claude Code chat tab. "Start with a task…" asks what
  // Claude should do first: the chat starts with it (in a terminal at once,
  // in a chat tab typed in for you to send), and can run in the background
  // then (claude --bg: no window, listed right away; only in folders Claude
  // trusts, since it can't ask there). plan: carry out that plan of the
  // account (its text is the chat's first message, with what you add).
  async newChat(groupId?: string, host?: string, plan?: PlanItem, task?: string): Promise<void> {
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
    const where = host ? `${group.title} on ${host}` : group.title;
    if (plan && task === undefined) {
      task = await vscode.window.showInputBox({
        title: `Carry out “${plan.title}” on ${where}`,
        prompt: "The plan is the chat's first message. Anything to add? (optional)",
        placeHolder: "e.g. Only steps 1 and 2 for now",
      });
      if (task === undefined) return;
      task = task.trim();
    }
    const hasTask = !!task || !!plan;
    const cli = this.cliOn(host);
    const panel = await this.panelChoice(group);
    if (!cli && !panel.length) {
      const why = `Claude Code's claude command isn't installed ${host ? `on ${host}` : "on this computer"}: it isn't on PATH, in ~/.local/bin, npm's or nvm's folders, nor on the login shell's PATH.`;
      return this.fail(`Can't start a chat in a terminal: ${why}`);
    }
    const home = group.homeChatCommand ?? "";
    const chat = chatCommandOf(home);
    if (cli && (!home || !chat) && !hasTask) return this.fail(`Can't start a chat on ${groupLabel(group)} from here.`);
    // Here: recent folders, then any folder you pick. A host's folders can't be
    // browsed unless this window is connected to it: its home folder is listed.
    let folders: Project[] = host ? group.projects.slice() : group.projects.filter((f) => f.short !== "~");
    if (host && !folders.some((f) => f.short === "~")) folders.push({ path: "", short: "~", newChatCommand: home, trusted: false });
    if (plan?.cwd) {
      const own = folders.find((f) => f.path === plan.cwd);
      folders = [own ?? { path: plan.cwd, short: plan.cwdShort || plan.cwd }, ...folders.filter((f) => f.path !== plan.cwd)];
    }
    const label = (f: Project) =>
      `$(${f.short === "~" ? "home" : "folder"}) ${f.short === "~" ? "Home folder (~)" : f.short}` + (plan && f.path === plan.cwd ? "  (the plan's)" : "");
    type Item = vscode.QuickPickItem & { start?: "terminal" | "background" | "panel" | "task"; folder?: Project; choose?: "dialog" | "type" };
    const canBrowse = !host || host === this.dash.currentHost;
    const items: Item[] = [];
    if (cli && !hasTask)
      items.push({ label: "$(sparkle) Start with a task…", description: "say what Claude should do: it starts right away, also in the background", start: "task" });
    if (cli) {
      items.push({ label: "In a terminal", kind: vscode.QuickPickItemKind.Separator });
      for (const f of folders) items.push({ label: label(f), start: "terminal", folder: f });
      items.push(canBrowse ? { label: "$(folder-opened) Choose folder…", start: "terminal", choose: "dialog" } : { label: "$(edit) Type a folder…", start: "terminal", choose: "type" });
    }
    if (cli && hasTask) {
      items.push({ label: "In the background", kind: vscode.QuickPickItemKind.Separator });
      const trusted = folders.filter((f) => f.trusted !== false && f.path);
      for (const f of trusted) items.push({ label: label(f), description: "no window: listed right away", start: "background", folder: f });
      if (!host) items.push({ label: "$(folder-opened) Choose folder…", description: "one Claude trusts already", start: "background", choose: "dialog" });
      if (!trusted.length && host) items.push({ label: "$(info) No folder Claude trusts there yet", description: "start a chat in one in a terminal once" });
    }
    if (!cli) items.push({ label: "In a terminal", kind: vscode.QuickPickItemKind.Separator }, { label: "$(warning) No claude command", description: host ? `on ${host}` : "on this computer" });
    items.push(...panel.map((p) => ({ ...p, start: p.panel ? ("panel" as const) : undefined })));
    const pick = await vscode.window.showQuickPick(items, {
      title: plan ? `Carry out “${plan.title}” on ${where}` : task ? `“${task.length > 60 ? task.slice(0, 59) + "…" : task}” on ${where}` : undefined,
      placeHolder: plan || task ? "Start it in…" : `New chat on ${where} in…`,
    });
    if (!pick?.start) return;
    if (pick.start === "task") {
      const text = await vscode.window.showInputBox({
        title: `New chat on ${where}`,
        prompt: "What should Claude do? The chat starts with it.",
        placeHolder: "e.g. Fix the flaky test in tests/test_jump.py",
      });
      if (!text?.trim()) return;
      return this.newChat(group.id, host, undefined, text.trim());
    }
    if (pick.start === "panel") return this.panelChat(group, hasTask ? await this.taskText(task ?? "", plan, host) : undefined);
    let folder = pick.folder?.path ?? "";
    if (pick.choose === "dialog") {
      const remoteHome = host ? folderOf(home) : null;
      const defaultUri = host
        ? remoteHome && vscode.workspace.workspaceFolders?.[0]
          ? vscode.workspace.workspaceFolders[0].uri.with({ path: remoteHome })
          : undefined
        : vscode.Uri.file(os.homedir());
      const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, defaultUri, openLabel: "Start Chat Here" });
      if (!picked?.length) return;
      folder = host ? picked[0].path : picked[0].fsPath;
    } else if (pick.choose === "type") {
      const typed = await vscode.window.showInputBox({ prompt: `Folder on ${host}`, placeHolder: "/home/you/project" });
      if (!typed) return;
      folder = typed.trim();
    }
    const taskArgs = [...(task ? ["--prompt", task] : []), ...(plan ? ["--plan", plan.slug, "--plan-profile", plan.profileDir] : [])];
    if (pick.start === "background") {
      const answer = host
        ? await this.backend.action("remote.py", ["--task", host, group.chatProfile, folder || "~", ...(task ? ["--prompt", task] : []), ...(plan ? ["--plan", plan.slug, plan.profileDir] : []), "--bg"], 120000)
        : await this.backend.action("jump.py", ["--new-chat", group.chatProfile, ...(folder ? ["--cwd", folder] : []), "--bg", ...taskArgs, ...configDirArgs()], 120000);
      if (this.report(answer, "Couldn't start it in the background")) this.dash.setActionInfo(answer.message);
      return this.refresh(host);
    }
    // In a terminal: the widget's way (your desktop's terminal), or VS Code's
    if (settings.openIn() === "system" && !host) {
      const args = ["--new-chat", group.chatProfile, ...(folder ? ["--cwd", folder] : ["--choose-folder"]), ...taskArgs, ...configDirArgs()];
      this.report(await this.backend.action("jump.py", args, 600000), "Couldn't open a new chat");
      return;
    }
    let command: string | undefined;
    if (hasTask) {
      const answer = host
        ? await this.backend.action("remote.py", ["--task", host, group.chatProfile, folder || "~", ...(task ? ["--prompt", task] : []), ...(plan ? ["--plan", plan.slug, plan.profileDir] : []), "--print-command"])
        : await this.backend.action("claude_status.py", ["--task-command", folder || os.homedir(), "--profile", group.chatProfile, ...taskArgs, ...configDirArgs()]);
      if (!this.report(answer, "Couldn't start it")) return;
      command = answer.command;
    } else {
      command = pick.folder?.newChatCommand ?? (chat ? inFolder(folder, chat) : undefined);
    }
    if (command) await this.terminals.run(`new|${Date.now()}`, plan ? plan.title : "new chat", command, this.place(host));
  }

  // A task's first prompt for a Claude Code chat tab (claude_status.py:
  // plan_prompt): what you wrote, and the plan's text (an SSH host's fetched
  // over ssh)
  private async taskText(task: string, plan?: PlanItem, host?: string): Promise<string> {
    if (!plan) return task;
    let file = plan.path;
    if (host) {
      const answer = await this.backend.action("remote.py", ["--plan", host, plan.slug, plan.profileDir, "--no-open"]);
      if (!answer.ok || !isAgentRunFile(answer.file)) return `${task || "Implement this plan."}\n\n(The plan is ${plan.path} on ${host}.)`;
      file = answer.file;
    }
    let body = "";
    try {
      body = fs.readFileSync(file, "utf8").slice(0, 100000);
    } catch {
      return `${task || "Implement this plan."}\n\n(The plan is ${plan.path}.)`;
    }
    const home = os.homedir();
    const where = !host && plan.path.startsWith(home + "/") ? "~" + plan.path.slice(home.length) : plan.path;
    return `${task || "Implement this plan."}\n\nThe plan (saved as ${where}):\n\n${body.trim()}\n`;
  }

  // Claude's own login for an account that isn't logged in (its loginCommand:
  // `claude auth login` on the account's folder), in a terminal on its machine
  async login(groupId?: string, host?: string): Promise<void> {
    if (this.demoOnly()) return;
    const state = this.dash.state();
    const group = allGroups(state.status, state.hosts).find((g) => g.id === groupId && (g.host ?? "") === (host ?? ""));
    if (!group?.loginCommand) return this.fail(`Can't log in to ${group ? groupLabel(group) : "that account"} from here.`);
    await this.terminals.run(`login|${host ?? ""}|${group.id}`, `log in to ${group.name}`, group.loginCommand, this.place(host), { private: true });
  }

  // There's a claude command on the machine (here, or that host) for chats in a terminal
  private cliOn(host?: string): boolean {
    const state = this.dash.state();
    return cliInstalled(host ? state.hosts.find((h) => h.name === host)?.result : state.status);
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
      // (its other account: Claude Code there switches to it, panelChat)
      note += group.vscodeHere || group.configDir === undefined
        ? ` · the account Claude Code has on ${host}`
        : ` · switches Claude Code on ${host} to ${group.title}`;
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

  // prompt: typed into the new chat, for you to send
  private async panelChat(group?: Group, prompt?: string): Promise<void> {
    // On this window's SSH host, for another account than Claude Code's
    // there: it switches to that one first, and stays on it
    if (group?.host && !group.vscodeHere && group.configDir !== undefined) {
      if (!(await this.account.switchHost(group))) return;
      await new Promise((r) => setTimeout(r, 1500)); // (the Claude extension follows the setting within a second)
    }
    try {
      await openPanelChat(prompt);
    } catch (e) {
      this.fail(`Couldn't open a Claude Code chat: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---------------------------------------------------------------- SSH hosts

  // A host that wants a password (or a passphrase, a code, its host key
  // confirmed): a terminal here where ssh asks for it itself, so the
  // extension never sees it (the widget's remote.py --login-here). The
  // connection it opens is the one the checks share then, until 30 minutes
  // after their last use, logging out, or Disconnect.
  async loginHost(host: string): Promise<void> {
    if (this.demoOnly()) return;
    const line = [settings.python(), "-I", `${this.backend.codeDir}/remote.py`, "--login-here", host].map(shellQuote).join(" ");
    // (closes once you're in; stays when it didn't work)
    await this.terminals.run(`ssh-login|${host}`, `log in to ${host}`, `${line} && exit`, { kind: "local" }, { private: true });
    this.dash.watchLogin(host);
  }

  async disconnectHost(host: string): Promise<void> {
    if (this.demoOnly()) return;
    const answer = await this.backend.action("remote.py", ["--disconnect", host], 30000);
    if (this.report(answer, `Couldn't disconnect from ${host}`)) this.dash.setActionInfo(answer.message);
    this.refresh(host);
  }

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

  // ---------------------------------------------------------------- a subagent's run

  // Its task, every step and its report, in the Markdown preview
  // (src/agentRun.ts); an SSH host's is fetched over ssh
  async openAgentRun(chat: ChatRef, agentId: string): Promise<void> {
    if (this.demoOnly()) return;
    const [script, args] = agentRunArgs(chat, agentId, chat.host ? [] : configDirArgs());
    const answer = await this.backend.action(script, args);
    if (!answer.ok) return this.fail(`Couldn't open the subagent's run: ${answer.message}`);
    if (!isAgentRunFile(answer.file)) return this.fail("Couldn't open the subagent's run: the helper saved it somewhere unexpected");
    const error = await openAgentRunFile(answer.file);
    if (error) this.fail(`Couldn't open the subagent's run: ${error}`);
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
