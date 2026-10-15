// What the view and the status bar show: this computer's status and the SSH
// hosts', polled with the widget's backend. This computer is checked every
// pollInterval while the view is open (every 10 s while it's hidden: the
// status bar and notifications still need it), hosts every remotePollSeconds.

import * as vscode from "vscode";
import type { Backend } from "./backend";
import { settings, statusArgs, configDirArgs, viewSettings } from "./config";
import type { Notifier } from "./notify";
import { currentRemoteHost } from "./remoteHost";
import { demoState } from "./shared/demo";
import type { HostState, PetEventKind, Status, ViewState } from "./shared/types";
import { TransitionTracker, type Changes, type PetEvent } from "./transitions";

const HIDDEN_POLL_MS = 10000;
const DEMO_STEP_MS = 8000;
const MESSAGE_MS = { error: 10000, info: 12000 };

export class Dashboard implements vscode.Disposable {
  private status: Status | null = null;
  private errorText = "";
  private hosts = new Map<string, HostState>();
  private actionError = "";
  private actionInfo = "";
  private messageTimers: { error?: NodeJS.Timeout; info?: NodeJS.Timeout } = {};
  private visible = false;
  private localBusy = false;
  private hostBusy = new Set<string>();
  private localTimer?: NodeJS.Timeout;
  private hostTimer?: NodeJS.Timeout;
  private demoTimer?: NodeJS.Timeout;
  private demoPhase: number | null = null;
  private tracker = new TransitionTracker();
  private disposables: vscode.Disposable[] = [];
  private disposed = false;
  private windowHost: string | undefined;
  private readonly onStateEmitter = new vscode.EventEmitter<ViewState>();
  private readonly onPetEventEmitter = new vscode.EventEmitter<PetEvent>();
  readonly onState = this.onStateEmitter.event;
  readonly onPetEvent = this.onPetEventEmitter.event;

  constructor(
    private backend: Backend,
    private notifier: Notifier,
    private log: vscode.LogOutputChannel,
  ) {
    this.windowHost = currentRemoteHost(vscode);
    this.disposables.push(
      this.onStateEmitter,
      this.onPetEventEmitter,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("claudeStatus")) return;
        this.syncHosts();
        this.scheduleLocal(0);
        this.scheduleHosts(0);
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        const host = currentRemoteHost(vscode);
        if (host !== this.windowHost) {
          this.windowHost = host;
          this.syncHosts();
          this.scheduleHosts(0);
        }
      }),
    );
  }

  // The host this window is connected to (Remote-SSH), if any
  get currentHost(): string | undefined {
    return this.windowHost;
  }

  get demo(): boolean {
    return this.demoPhase !== null;
  }

  async start(): Promise<void> {
    const problem = await this.backend.checkPython();
    if (problem) {
      this.errorText = problem;
      this.log.error(problem);
      this.emit();
      // try again later: the setting may get fixed
      this.localTimer = setTimeout(() => void this.start(), 30000);
      return;
    }
    this.syncHosts();
    this.scheduleLocal(0);
    this.scheduleHosts(0);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.localTimer);
    clearTimeout(this.hostTimer);
    clearInterval(this.demoTimer);
    clearTimeout(this.messageTimers.error);
    clearTimeout(this.messageTimers.info);
    for (const d of this.disposables) d.dispose();
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    // Just opened: show fresh numbers now, then poll at the faster pace
    if (visible) this.scheduleLocal(0);
  }

  isVisible(): boolean {
    return this.visible;
  }

  // The hosts to check: the window's own host first, then the picked ones
  shownHosts(): string[] {
    const list = settings.sshHosts();
    if (this.windowHost && settings.includeCurrentRemote() && !list.includes(this.windowHost)) list.unshift(this.windowHost);
    return list;
  }

  private syncHosts(): void {
    const shown = this.shownHosts();
    for (const name of [...this.hosts.keys()]) {
      if (!shown.includes(name)) {
        this.hosts.delete(name);
        this.tracker.forget("ssh:" + name); // a host that comes back starts over
      }
    }
    for (const name of shown) {
      const h = this.hosts.get(name);
      if (h) h.current = name === this.windowHost;
      else
        this.hosts.set(name, { name, loading: false, ok: false, error: "", result: null, updatedAt: 0, current: name === this.windowHost });
    }
    this.emit();
  }

  private scheduleLocal(delay?: number): void {
    if (this.disposed) return;
    clearTimeout(this.localTimer);
    const wait = delay ?? (this.visible ? settings.pollInterval() : HIDDEN_POLL_MS);
    this.localTimer = setTimeout(() => void this.refresh().finally(() => this.scheduleLocal()), wait);
  }

  private scheduleHosts(delay?: number): void {
    if (this.disposed) return;
    clearTimeout(this.hostTimer);
    const wait = delay ?? settings.remotePollSeconds() * 1000;
    this.hostTimer = setTimeout(() => {
      for (const host of this.shownHosts()) void this.pollHost(host);
      this.scheduleHosts();
    }, wait);
  }

  // Check this computer now (a check still running isn't doubled)
  async refresh(): Promise<void> {
    if (this.localBusy || this.demo || this.disposed) return;
    this.localBusy = true;
    try {
      const { status, error } = await this.backend.status([...configDirArgs(), ...statusArgs()]);
      if (status) {
        this.errorText = status.errors.length ? status.errors.join("\n") : "";
        const changes = this.tracker.track("", status.groups, status.generatedAt, undefined, this.notifyOptions());
        const resets = this.tracker.resets("", status.groups);
        this.status = status;
        this.react(changes, resets);
      } else {
        this.errorText = error ?? "Status unavailable";
        this.log.warn(this.errorText);
      }
    } finally {
      this.localBusy = false;
    }
    this.emit();
  }

  refreshAll(): void {
    void this.refresh();
    for (const host of this.shownHosts()) void this.pollHost(host);
  }

  async pollHost(host: string): Promise<void> {
    if (this.hostBusy.has(host) || this.demo || this.disposed) return;
    const h = this.hosts.get(host);
    if (!h) return;
    this.hostBusy.add(host);
    h.loading = true;
    this.emit();
    try {
      const answer = await this.backend.hostStatus(host, statusArgs());
      const now = this.hosts.get(host);
      if (!now) return; // unpicked while it was being checked
      if (answer.ok && answer.result) {
        const result = answer.result;
        const changes = this.tracker.track("ssh:" + host, result.groups, result.generatedAt, host, this.notifyOptions());
        const resets = this.tracker.resets("ssh:" + host, result.groups);
        Object.assign(now, { loading: false, ok: true, error: "", result, updatedAt: Date.now() });
        this.react(changes, resets);
      } else {
        // keep the last answer to show (dimmed) with the error
        Object.assign(now, { loading: false, ok: false, error: answer.error || "no answer" });
        this.log.warn(`${host}: ${now.error}`);
      }
    } finally {
      this.hostBusy.delete(host);
      const h2 = this.hosts.get(host);
      if (h2) h2.loading = false;
      this.emit();
    }
  }

  private notifyOptions() {
    return {
      notifyWaiting: settings.notifyWaiting(),
      notifyDone: settings.notifyDone(),
      notifyDoneMinSeconds: settings.notifyDoneMinSeconds(),
    };
  }

  // Pets and notifications, once the new status is stored: a reaction that
  // fails can't hold the dashboard back (the widget froze that way once, at
  // every plan-limit reset).
  private react(changes: Changes, resets: PetEvent[]): void {
    try {
      this.petEvents([...changes.petEvents, ...resets]);
      if (!this.demo) this.notifier.handle(changes);
    } catch (e) {
      this.log.error(`A reaction to the new status failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private petEvents(events: PetEvent[]): void {
    for (const e of events) this.onPetEventEmitter.fire(e);
  }

  petEvent(kind: PetEventKind, text: string, key = ""): void {
    this.onPetEventEmitter.fire({ kind, text, key });
  }

  setActionError(message: string): void {
    this.actionError = message;
    clearTimeout(this.messageTimers.error);
    this.messageTimers.error = setTimeout(() => {
      this.actionError = "";
      this.emit();
    }, MESSAGE_MS.error);
    if (message) this.petEvent("oops", "Hmm, that didn't work.");
    this.emit();
  }

  setActionInfo(message: string): void {
    this.actionInfo = message;
    clearTimeout(this.messageTimers.info);
    this.messageTimers.info = setTimeout(() => {
      this.actionInfo = "";
      this.emit();
    }, MESSAGE_MS.info);
    this.emit();
  }

  // Demo mode: made-up chats whose story moves on every few seconds, for
  // screenshots and for trying the view without Claude Code.
  toggleDemo(): boolean {
    if (this.demo) {
      clearInterval(this.demoTimer);
      this.demoPhase = null;
      this.tracker.forget("demo");
      this.scheduleLocal(0);
      this.scheduleHosts(0);
    } else {
      this.demoPhase = 0;
      const step = () => {
        const state = demoState(Date.now(), this.demoPhase ?? 0);
        const groups = [...(state.status?.groups ?? []), ...state.hosts.flatMap((h) => h.result?.groups ?? [])];
        this.petEvents(this.tracker.track("demo", groups, Date.now(), undefined, this.notifyOptions()).petEvents);
      };
      step();
      this.demoTimer = setInterval(() => {
        this.demoPhase = (this.demoPhase ?? 0) + 1;
        step();
        this.emit();
      }, DEMO_STEP_MS);
    }
    this.emit();
    return this.demo;
  }

  state(): ViewState {
    const now = Date.now();
    if (this.demoPhase !== null) {
      const demo = demoState(now, this.demoPhase);
      return { ...demo, settings: viewSettings(), actionError: this.actionError, actionInfo: this.actionInfo };
    }
    return {
      status: this.status,
      errorText: this.errorText,
      hosts: this.shownHosts().map((name) => this.hosts.get(name)).filter((h): h is HostState => !!h),
      settings: viewSettings(),
      demo: false,
      platformNote:
        process.platform === "linux"
          ? ""
          : "Running chats on this computer are only detected on Linux for now; SSH hosts still work.",
      actionError: this.actionError,
      actionInfo: this.actionInfo,
      now,
    };
  }

  emit(): void {
    if (!this.disposed) this.onStateEmitter.fire(this.state());
  }
}
