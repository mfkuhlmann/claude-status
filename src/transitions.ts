// Notifications, sounds and pet reactions when a session changes state.
// Ported from the widget's main.qml (trackTransitions, celebrateResets). A
// source is "" for this computer and "ssh:<host>" for an SSH host; each keeps
// its own memory, so one poll never decides for another.

import { duration, petKeyOf, plural, reasonText } from "./shared/model";
import type { Group, PetEventKind, Session, SessionState } from "./shared/types";

export interface Notice {
  key: string; // the row: one notification per row at a time
  kind: "waiting" | "done";
  title: string;
  body: string;
  session: Session;
  host?: string;
}

export interface PetEvent {
  kind: PetEventKind;
  text: string;
  key: string; // the chat's pet key, or "" for the main pet
}

export type SoundKind = "" | "done" | "failed" | "waiting";

// A chat that finished a turn this poll (for the away digest and the
// shortcut to the chat that needs you)
export interface Finished {
  id: string; // the row as tracked: "<source>|<key>"
  session: Session;
  host?: string;
  took: number; // how long the turn ran, ms
  at: number;
}

export interface Changes {
  notices: Notice[];
  petEvents: PetEvent[];
  sound: SoundKind; // the most urgent of this poll's notifications
  finished: Finished[];
}

export interface NotifyOptions {
  notifyWaiting: boolean;
  notifyDone: boolean;
  notifyDoneMinSeconds: number;
}

const SOUND_RANK: Record<SoundKind, number> = { "": 0, done: 1, failed: 2, waiting: 3 };
const WAITING_QUIET_MS = 60000;

// b's notices, pet events and finished chats after a's; the more urgent sound
export function mergeChanges(a: Changes, b: Changes): Changes {
  return {
    notices: [...a.notices, ...b.notices],
    petEvents: [...a.petEvents, ...b.petEvents],
    sound: SOUND_RANK[b.sound] > SOUND_RANK[a.sound] ? b.sound : a.sound,
    finished: [...a.finished, ...b.finished],
  };
}

export class TransitionTracker {
  private lastStops = new Map<string, Map<string, boolean>>(); // source -> chat key -> whether its limit has reset
  private lastOverlaps = new Map<string, Set<string>>(); // source -> pairs of rows changing the same files
  private lastStates = new Map<string, Map<string, SessionState>>();
  private turnStarts = new Map<string, Map<string, number>>();
  private lastWaitingAlert = new Map<string, number>();
  private lastWindows = new Map<string, number>();

  track(source: string, groups: Group[], nowMs: number, host: string | undefined, opts: NotifyOptions): Changes {
    const changes: Changes = { notices: [], petEvents: [], sound: "", finished: [] };
    const next = new Map<string, SessionState>();
    const starts = new Map<string, number>();
    const before = this.lastStates.get(source);
    const startedAt = this.turnStarts.get(source) ?? new Map<string, number>();
    const primed = before !== undefined; // the first poll of a source only learns
    const where = host ? ` · ${host}` : "";
    const queueSound = (kind: SoundKind) => {
      if (SOUND_RANK[kind] > SOUND_RANK[changes.sound]) changes.sound = kind;
    };
    for (const g of groups) {
      for (const s of g.sessions) {
        // Tracked by account and chat (petKeyOf), not the chat id alone: a
        // chat shared across profiles is listed once per profile with the same
        // id. A chat listed twice: its most urgent row (they come first) counts.
        const sid = petKeyOf(s, host);
        if (next.has(sid)) continue;
        const prev = before?.get(sid);
        next.set(sid, s.state);
        // A turn runs from leaving idle/done until coming back to it.
        if (s.state === "working" || s.state === "waiting") starts.set(sid, startedAt.get(sid) ?? s.since ?? nowMs);
        if (!primed || prev === s.state) continue;
        const pk = petKeyOf(s, host);
        if (s.state === "waiting") {
          // At most one "needs input" alert per session per minute
          if (nowMs - (this.lastWaitingAlert.get(sid) ?? 0) < WAITING_QUIET_MS) continue;
          this.lastWaitingAlert.set(sid, nowMs);
          changes.petEvents.push({ kind: "waiting", text: `${s.name} needs you!`, key: pk });
          if (opts.notifyWaiting) {
            changes.notices.push({
              key: sid,
              kind: "waiting",
              title: `${s.name} needs your input`,
              body: `${s.detail || reasonText(s.reason)} · ${s.cwdShort}${where}`,
              session: s,
              host,
            });
            queueSound("waiting");
          }
        } else if (prev === "working" && (s.state === "idle" || s.state === "done")) {
          if (s.reason === "failed") changes.petEvents.push({ kind: "failed", text: `${s.name} failed…`, key: pk });
          else if (s.reason === "stopped") changes.petEvents.push({ kind: "stopped", text: `${s.name} was stopped.`, key: pk });
          else changes.petEvents.push({ kind: "done", text: `${s.name} is done!`, key: pk });
          const took = (s.since ?? nowMs) - (startedAt.get(sid) ?? nowMs);
          changes.finished.push({ id: sid, session: s, host, took, at: nowMs });
          if (opts.notifyDone && took >= opts.notifyDoneMinSeconds * 1000) {
            const title =
              s.reason === "failed" ? `${s.name} failed` : s.reason === "stopped" ? `${s.name} was stopped` : `${s.name} finished`;
            changes.notices.push({
              key: sid,
              kind: "done",
              title,
              body: `${s.detail ? s.detail + " · " : ""}Took ${duration(took)} · ${s.cwdShort}${where}`,
              session: s,
              host,
            });
            queueSound(s.reason === "failed" ? "failed" : "done");
          }
        }
      }
    }
    for (const key of [...this.lastWaitingAlert.keys()])
      if ((source ? key.startsWith(source + "|") : !key.includes("|")) && !next.has(key)) this.lastWaitingAlert.delete(key);
    this.lastStates.set(source, next);
    this.turnStarts.set(source, starts);
    return changes;
  }

  // Chats a usage limit stopped whose limit has reset since the last poll:
  // their pets cheer, and one notice per account says which can go on (with
  // the "finished" notifications). The first poll of a source only learns.
  limitResets(source: string, groups: Group[], host: string | undefined, opts: NotifyOptions): Changes {
    const changes: Changes = { notices: [], petEvents: [], sound: "", finished: [] };
    const before = this.lastStops.get(source);
    const next = new Map<string, boolean>();
    for (const g of groups) {
      const freed: Session[] = [];
      for (const s of g.sessions) {
        if (s.stopped?.kind !== "limit") continue;
        const key = petKeyOf(s, host);
        if (next.has(key)) continue;
        next.set(key, !!s.stopped.over);
        if (before?.get(key) === false && s.stopped.over) freed.push(s);
      }
      if (!freed.length) continue;
      for (const s of freed) changes.petEvents.push({ kind: "reset", text: `${s.name} can go on!`, key: petKeyOf(s, host) });
      if (!opts.notifyDone) continue;
      const names = freed.slice(0, 4).map((s) => s.name).join(", ") + (freed.length > 4 ? ` +${freed.length - 4}` : "");
      changes.notices.push({
        key: `limit-reset|${source}|${g.id}`,
        kind: "done",
        title: `${host ? `${host}: ` : ""}${g.name}: the usage limit reset`,
        body: plural(freed.length, `${names} can go on`, `%1 chats can go on: ${names}`),
        session: freed[0],
        host,
      });
      changes.sound = "done";
    }
    this.lastStops.set(source, next);
    return changes;
  }

  // Two chats with a process that started changing the same files (each
  // row's overlaps): their pets wave, and a notice names both and the files
  // (with the "needs you" notifications). The first poll of a source only learns.
  overlaps(source: string, groups: Group[], host: string | undefined, opts: NotifyOptions): Changes {
    const changes: Changes = { notices: [], petEvents: [], sound: "", finished: [] };
    const before = this.lastOverlaps.get(source);
    const next = new Set<string>();
    for (const g of groups)
      for (const s of g.sessions)
        for (const o of s.overlaps ?? []) {
          const pair = [s.key, o.key].sort().join("|");
          if (next.has(pair)) continue;
          next.add(pair);
          if (!before || before.has(pair)) continue;
          changes.petEvents.push({ kind: "waiting", text: `${s.name} and ${o.name} change the same files!`, key: petKeyOf(s, host) });
          if (opts.notifyWaiting)
            changes.notices.push({
              key: `overlap|${source}|${pair}`,
              kind: "waiting",
              title: "Two chats change the same files",
              body: `${s.name} and ${o.name}: ${o.files.join(", ")}${o.count > o.files.length ? " …" : ""}${host ? ` · ${host}` : ""}`,
              session: s,
              host,
            });
        }
    this.lastOverlaps.set(source, next);
    return changes;
  }

  // A plan limit that dropped a lot since the last poll was reset: celebrate.
  resets(source: string, groups: Group[]): PetEvent[] {
    const events: PetEvent[] = [];
    for (const g of groups) {
      for (const w of g.limits ? g.limits.windows : []) {
        const key = `${source}|${g.id}/${w.key}`;
        const last = this.lastWindows.get(key);
        if (last !== undefined && last >= 25 && w.pct < last - 20) events.push({ kind: "reset", text: `${w.label} limit reset!`, key: "" });
        this.lastWindows.set(key, w.pct);
      }
    }
    return events;
  }

  // A host that was unpicked: start over if it comes back
  forget(source: string): void {
    this.lastStops.delete(source);
    this.lastOverlaps.delete(source);
    this.lastStates.delete(source);
    this.turnStarts.delete(source);
    const prefix = source + "|";
    for (const k of [...this.lastWindows.keys()]) if (k.startsWith(prefix)) this.lastWindows.delete(k);
  }
}
