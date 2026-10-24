// The Week tab's words and numbers (webview/components/WeekView.tsx), from
// the recap of the widget's week.py; here, so the tests can read them.

import { clockText, dayLabel, plural } from "./model";
import type { WeekDay, WeekNumbers, WeekRecap, WeekSum } from "./types";

const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];

// A local YYYY-MM-DD as a Date at local midnight
function localDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// 3h 5m, 45m: a week of work reads better in hours than in days
export function hoursText(ms: number): string {
  const m = Math.round(Math.max(0, ms) / 60000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function moneyText(usd: number): string {
  if (!usd) return "$0";
  if (usd < 0.01) return "<$0.01";
  return "$" + usd.toLocaleString("en-US", { minimumFractionDigits: usd >= 100 ? 0 : 2, maximumFractionDigits: usd >= 100 ? 0 : 2 });
}

// "24 Oct"
export function shortDay(day: string): string {
  const d = localDate(day);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function longDay(day: string): string {
  const d = localDate(day);
  return `${WEEKDAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}

// "24 October 2026"
export function dateText(day: string): string {
  const d = localDate(day);
  return `${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

// "Sat 24": a timeline row's day
export function rowDay(day: string): string {
  return dayLabel(day).split(" ").slice(0, 2).join(" ");
}

export function periodText(recap: WeekRecap): string {
  const span = `${shortDay(recap.from)} – ${shortDay(recap.to)}`;
  return recap.back === 0 ? `Last 7 days · ${span}` : span;
}

// The 7 days before, when there was anything in them
export function previousOf(recap: WeekRecap): WeekNumbers | null {
  const p = recap.previous;
  return p && (p.workedMs || p.prompts || p.cost) ? p : null;
}

// The change against the 7 days before: "+4h 44m", "−$12"
export function deltaText(now: number, before: number | null, kind: "time" | "money" | "count"): string {
  if (before === null) return "";
  const d = now - before;
  const abs = Math.abs(d);
  if (kind === "time" ? abs < 60000 : kind === "money" ? abs < 0.01 : d === 0) return "same as before";
  return (d > 0 ? "+" : "−") + (kind === "time" ? hoursText(abs) : kind === "money" ? moneyText(abs) : String(abs));
}

export interface WeekTile {
  label: string;
  value: string;
  delta: string;
  tip: string;
}

export function weekTiles(recap: WeekRecap): WeekTile[] {
  const s = recap.sum;
  const p = previousOf(recap);
  const before = (v: number, kind: "time" | "money" | "count") =>
    p ? `\nThe 7 days before: ${kind === "time" ? hoursText(v) : kind === "money" ? moneyText(v) : String(v)}` : "";
  return [
    {
      label: "You",
      value: hoursText(s.youMs),
      delta: deltaText(s.youMs, p ? p.youMs : null, "time"),
      tip:
        "The time you spent writing to Claude, reading its replies and answering its questions, in all your chats and " +
        "accounts: the time between your prompts and its replies counts when it's under 15 minutes." + before(p ? p.youMs : 0, "time"),
    },
    {
      label: "Claude worked",
      value: hoursText(s.workedMs),
      delta: deltaText(s.workedMs, p ? p.workedMs : null, "time"),
      tip:
        "Claude's own count of its turns (its “Worked for …”), all chats added up: chats working at the same time each " +
        `count. On the clock it worked ${hoursText(s.busyMs)}, and it waited ${hoursText(s.waitMs)} for your answers.` +
        before(p ? p.workedMs : 0, "time"),
    },
    {
      label: "At API prices",
      value: moneyText(s.cost),
      delta: deltaText(s.cost, p ? p.cost : null, "money"),
      tip:
        `What the same tokens would cost on Claude's API, at its list prices of ${dateText(recap.prices.asOf)}. ` +
        "Your plan isn't billed this way: this is the value of what you used." + before(p ? p.cost : 0, "money"),
    },
    {
      label: "Prompts",
      value: String(s.prompts),
      delta: deltaText(s.prompts, p ? p.prompts : null, "count"),
      tip: `${plural(s.chats, "In %1 chat", "In %1 chats")} · ${plural(s.turns, "%1 turn of Claude's", "%1 turns of Claude's")}` + before(p ? p.prompts : 0, "count"),
    },
  ];
}

export function factsText(s: WeekSum): string {
  const parts: string[] = [];
  if (s.longestTurn && s.longestTurn.workedMs >= 60000) parts.push(`longest turn ${hoursText(s.longestTurn.workedMs)} (${s.longestTurn.name || "?"})`);
  if (s.peakAtOnce > 1) parts.push(`up to ${s.peakAtOnce} chats at once`);
  if (s.busiestDay) parts.push(`busiest day ${WEEKDAYS_LONG[localDate(s.busiestDay).getDay()]}`);
  if (s.limits) parts.push(s.limits === 1 ? "a usage limit stopped you once" : `usage limits stopped you ${s.limits} times`);
  return parts.join(" · ");
}

// What went on at ms, on its day's row. px: a pixel's ms, so a mark a pixel
// or two wide can be hit
export function hoverText(d: WeekDay, ms: number, now: number, px: number): string {
  const when = `${dayLabel(d.day)}, ${clockText(ms)}: `;
  if (ms > now) return when + "still to come";
  const at = <T extends number[]>(list: T[]): T | undefined =>
    list.find((s) => s[0] <= ms && ms < s[1]) ?? list.find((s) => s[1] - s[0] < 3 * px && s[0] - 2 * px <= ms && ms < s[1] + 2 * px);
  const span = (s: number[]) => `${clockText(s[0])}–${clockText(s[1])}`;
  const work = at(d.work);
  const wait = at(d.wait);
  const you = at(d.you);
  const parts: string[] = [];
  if (work) parts.push(work[2] > 1 ? `Claude worked ${span(work)}, ${work[2]} chats at once` : `Claude worked ${span(work)}`);
  else if (wait) parts.push(`Claude waited for your answer ${span(wait)}`);
  if (you) parts.push(`you were at it ${span(you)}`);
  return when + (parts.length ? parts.join(" · ") : "nothing went on");
}

export function dayTip(d: WeekDay): string {
  return (
    `${longDay(d.day)}\nYou: ${hoursText(d.youMs)} · Claude worked ${hoursText(d.workedMs)} (on the clock ${hoursText(d.busyMs)}) · ` +
    `it waited ${hoursText(d.waitMs)} for you\n${plural(d.prompts, "%1 prompt", "%1 prompts")} · ${moneyText(d.cost)} at API prices`
  );
}

export function cacheText(recap: WeekRecap): string {
  const t = recap.sum.tokens;
  const input = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
  if (!t.cacheRead) return "";
  const pct = Math.round((100 * t.cacheRead) / Math.max(1, input));
  return `${pct}% of the ${shortCount(input)} input tokens came from the cache: it saved ${moneyText(recap.cacheSaved)}. Claude wrote ${shortCount(t.output)} tokens.`;
}

function shortCount(n: number): string {
  return n >= 999.95e6 ? `${(n / 1e9).toFixed(1)}B` : n >= 999.95e3 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
}

export function shareText(share: number): string {
  return share < 0.01 ? "<1%" : `${Math.round(share * 100)}%`;
}

export function footText(recap: WeekRecap): string {
  const hosts = recap.sources.filter((s) => s.host && s.ok).map((s) => s.host);
  const guessed = recap.prices.guessed.length ? ` (${recap.prices.guessed.join(", ")} at the price of its family's newest model)` : "";
  const lines = [
    `Read from the chats on this computer${hosts.length ? ` and on ${hosts.join(", ")}` : ""}, without using any tokens. ` +
      `Prices: Claude's API list prices of ${dateText(recap.prices.asOf)}${guessed}.`,
  ];
  for (const s of recap.sources) if (!s.ok) lines.push(`${s.host} couldn't be read: ${s.error}`);
  return lines.join("\n");
}

// Week messages from the page, as the extension takes them: weeks back
// within what's kept, an account id or all
export function weekAsked(back: unknown, account: unknown): { back: number; account: string } {
  const b = typeof back === "number" && Number.isInteger(back) ? Math.min(4, Math.max(0, back)) : 0;
  const a = typeof account === "string" && /^[0-9a-f]{12}$/.test(account) ? account : "";
  return { back: b, account: a };
}
