import { useEffect, useState } from "preact/hooks";
import type { WeekDay, WeekRecap } from "../../src/shared/types";
import {
  cacheText,
  dayTip,
  factsText,
  footText,
  hoursText,
  hoverText,
  moneyText,
  periodText,
  rowDay,
  shareText,
  weekTiles,
} from "../../src/shared/week";
import { post } from "../env";
import { Icon } from "../util/icons";
import { useViewVisible } from "../util/petStage";
import { useStore } from "../util/store";
import { weekAnswer } from "../util/stores";

const REFRESH_MS = 10 * 60000; // while the tab is in sight

// The Recap tab: your last 7 days with Claude. How long you were at it and
// how long Claude worked, a day per row on a timeline, what the same work
// would cost at API prices, where it went, and what would use less of your
// plan (the rules of Claude Code's own /usage). The extension runs the
// widget's week.py for it (only while this tab is open): read from the
// chats' transcripts, no tokens used, nothing sent anywhere.
export function WeekView({ hosts }: { hosts: string[] }) {
  const visible = useViewVisible();
  const answer = useStore(weekAnswer);
  const [back, setBack] = useState(answer?.back ?? 0);
  const [account, setAccount] = useState(answer?.account ?? "");
  const [busy, setBusy] = useState(true); // asked, and its answer hasn't come
  const [copied, setCopied] = useState("");
  const hostsKey = hosts.join(",");

  function ask() {
    setBusy(true);
    post({ type: "week", back, account });
  }

  // Ask for these days when the tab is in sight, again every 10 minutes
  useEffect(() => {
    if (!visible) return;
    ask();
    const timer = setInterval(ask, REFRESH_MS);
    return () => clearInterval(timer);
  }, [visible, back, account, hostsKey]);

  const mine = answer && answer.back === back && answer.account === account ? answer : null;
  useEffect(() => {
    if (mine) setBusy(false);
  }, [mine]);
  const recap: WeekRecap | null = mine?.recap ?? answer?.recap ?? null; // (the days before, dimmed, while these come)
  const error = mine?.error ?? "";
  const s = recap?.sum;
  const hasData = !!s && (s.workedMs > 0 || s.prompts > 0 || s.cost > 0);

  function copy(text: string) {
    post({ type: "copy", text });
    setCopied(text);
    setTimeout(() => setCopied((c) => (c === text ? "" : c)), 2000);
  }

  return (
    <div class={"week" + (busy && recap ? " busy" : "")}>
      <div class="week-period">
        <button type="button" class="icon-btn flip" title="The week before" aria-label="The week before"
          disabled={back >= (recap?.backMax ?? 0)} onClick={() => setBack(back + 1)}>
          <Icon name="chevron" />
        </button>
        <span class="week-span">{recap ? periodText({ ...recap, back }) : back === 0 ? "Last 7 days" : ""}</span>
        <button type="button" class="icon-btn" title="The week after" aria-label="The week after" disabled={back <= 0}
          onClick={() => setBack(back - 1)}>
          <Icon name="chevron" />
        </button>
        <button type="button" class="icon-btn" title="Read again" aria-label="Read again" onClick={ask}>
          <Icon name="refresh" />
        </button>
      </div>

      {recap && recap.accounts.length > 1 ? (
        <div class="week-accounts" role="radiogroup" aria-label="Whose chats">
          {[{ id: "", name: "All accounts", plan: null }, ...recap.accounts].map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={account === a.id} class={"chip" + (account === a.id ? " on" : "")}
              title={a.id ? "This account's chats (a chat shared with others counts on each account that has it)" : "All your chats"}
              onClick={() => setAccount(a.id)}>
              {a.name + (a.plan ? ` · ${a.plan}` : "")}
            </button>
          ))}
        </div>
      ) : null}

      {busy && !recap && !error ? (
        <div class="empty muted">
          Reading your chats of these days. The first time takes a few seconds; after that only what's new is read.
        </div>
      ) : null}
      {error ? <div class="msg error" role="alert">Couldn't read your week: {error}</div> : null}
      {recap && !hasData ? (
        <div class="empty muted">No Claude in these days: none of your chats here (or on the SSH hosts shown) has a prompt or a reply in them.</div>
      ) : null}

      {recap && s && hasData ? (
        <>
          <div class="week-tiles">
            {weekTiles(recap).map((t) => (
              <div key={t.label} class="week-tile" title={`${t.label}\n${t.tip}`}>
                <span class="week-tile-label muted">{t.label}</span>
                <span class="week-tile-value">{t.value}</span>
                {t.delta ? <span class="week-tile-delta muted">{t.delta}</span> : null}
              </div>
            ))}
          </div>
          {factsText(s) ? <div class="week-facts small muted">{factsText(s)}</div> : null}
          <Timeline recap={recap} />
          <Projects recap={recap} />
          <Chats recap={recap} />
          <Models recap={recap} />
          <Tips recap={recap} copied={copied} onCopy={copy} />
          <div class="week-foot small muted">{footText(recap)}</div>
        </>
      ) : null}
    </div>
  );
}

// A day per row: when you were at it, when Claude worked (darker where
// several chats worked at once), when it waited for your answer
function Timeline({ recap }: { recap: WeekRecap }) {
  const [hover, setHover] = useState<{ row: number; x: number; ms: number; px: number } | null>(null);
  const last = recap.days.length - 1;
  const pct = (d: WeekDay, ms: number) => `${Math.max(0, Math.min(100, (100 * (ms - d.start)) / Math.max(1, d.end - d.start)))}%`;
  const width = (d: WeekDay, a: number, b: number) =>
    `max(1px, ${Math.max(0, (100 * (Math.min(b, d.end) - Math.max(a, d.start))) / Math.max(1, d.end - d.start))}%)`;
  return (
    <section class="week-section">
      <div class="week-heading">
        <h2>Day by day</h2>
        <span class="week-legend small muted">
          <span class="swatch you" /> You <span class="swatch work" /> Claude working <span class="swatch wait" /> Waiting for you
        </span>
      </div>
      <div class="week-row week-axis small muted" aria-hidden="true">
        <span class="week-day" />
        <span class="week-hours">
          {[0, 6, 12, 18, 24].map((h) => (
            <span key={h} style={{ left: `${(100 * h) / 24}%` }}>{h}</span>
          ))}
        </span>
        <span class="week-num">You</span>
        <span class="week-num">Claude</span>
      </div>
      {recap.days.map((d, i) => (
        <div key={d.day} class={"week-row" + (i === last && recap.back === 0 ? " today" : "")} title={dayTip(d)}>
          <span class="week-day small">{rowDay(d.day)}</span>
          <span
            class="week-track"
            onMouseMove={(e) => {
              const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const x = Math.max(0, Math.min(box.width, e.clientX - box.left));
              const span = d.end - d.start;
              setHover({ row: i, x, ms: d.start + (x / Math.max(1, box.width)) * span, px: span / Math.max(1, box.width) });
            }}
            onMouseLeave={() => setHover((h) => (h && h.row === i ? null : h))}
          >
            {d.you.map(([a, b]) => <span key={"y" + a} class="week-you" style={{ left: pct(d, a), width: width(d, a, b) }} />)}
            {d.wait.map(([a, b]) => <span key={"w" + a} class="week-wait" style={{ left: pct(d, a), width: width(d, a, b) }} />)}
            {d.work.map(([a, b, n]) => (
              <span key={"c" + a} class={"week-work" + (n >= 3 ? " many" : n === 2 ? " two" : "")} style={{ left: pct(d, a), width: width(d, a, b) }} />
            ))}
            {i === last && recap.back === 0 ? <span class="week-now" style={{ left: pct(d, recap.generatedAt) }} /> : null}
            {hover && hover.row === i ? <span class="week-cross" style={{ left: `${hover.x}px` }} /> : null}
          </span>
          <span class="week-num small muted">{d.youMs >= 60000 ? hoursText(d.youMs) : "–"}</span>
          <span class="week-num small">{d.workedMs >= 60000 ? hoursText(d.workedMs) : "–"}</span>
        </div>
      ))}
      <div class={"week-readout small" + (hover ? "" : " muted")}>
        {hover ? hoverText(recap.days[hover.row], hover.ms, recap.generatedAt, hover.px) : "Point at a day to see what went on then."}
      </div>
    </section>
  );
}

// The project folders Claude worked in most (a chat started in a subfolder
// of a repository counts for the repository)
function Projects({ recap }: { recap: WeekRecap }) {
  if (!recap.projects.length) return null;
  const most = Math.max(1, ...recap.projects.map((p) => p.workedMs));
  return (
    <section class="week-section">
      <h2>Where Claude worked</h2>
      <ul class="week-bars">
        {recap.projects.map((p) => (
          <li key={p.host + p.path}
            title={`${p.host ? p.host + ": " : ""}${p.path}\nClaude worked ${hoursText(p.workedMs)} · ${moneyText(p.cost)} at API prices\n${p.prompts} prompts · ${p.chats} chats`}>
            <span class="week-bar-name">{(p.host ? p.host + ": " : "") + p.name}</span>
            <span class="week-bar-meter work"><span style={{ width: `${(100 * p.workedMs) / most}%` }} /></span>
            <span class="week-bar-value small muted">{hoursText(p.workedMs)} · {moneyText(p.cost)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The chats Claude worked on most: click one of this computer's to bring it up
function Chats({ recap }: { recap: WeekRecap }) {
  if (!recap.chats.length) return null;
  return (
    <section class="week-section">
      <h2>Chats it worked on most</h2>
      <ul class="week-chats">
        {recap.chats.map((c) => (
          <li key={c.host + c.chatId}>
            <button type="button" class="week-chat" disabled={!!c.host}
              title={c.host ? `${c.name} on ${c.host}: its row under ${c.host} opens it` : `Open “${c.name}”`}
              onClick={() => post({ type: "openWeekChat", chatId: c.chatId, profileDir: c.profileDir, name: c.name, cwd: c.cwd })}>
              <span class="week-chat-name">{c.name}</span>
              <span class="week-chat-folder small muted">{(c.host ? c.host + ": " : "") + c.folder}</span>
              <span class="week-chat-value small muted">{hoursText(c.workedMs)} · {moneyText(c.cost)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// What it'd cost on the API, by model, and what the cache saved
function Models({ recap }: { recap: WeekRecap }) {
  if (!recap.models.length) return null;
  return (
    <section class="week-section">
      <h2>At API prices</h2>
      <ul class="week-bars">
        {recap.models.map((m) => (
          <li key={m.model} title={`${m.model}: ${moneyText(m.cost)} · ${m.requests} requests`}>
            <span class="week-bar-name">{m.model}</span>
            <span class="week-bar-meter"><span style={{ width: `${100 * m.share}%` }} /></span>
            <span class="week-bar-value small muted">{moneyText(m.cost)} · {shareText(m.share)}</span>
          </li>
        ))}
      </ul>
      {cacheText(recap) ? <div class="small muted">{cacheText(recap)}</div> : null}
    </section>
  );
}

// What would use less of your plan (Claude Code's /usage rules)
function Tips({ recap, copied, onCopy }: { recap: WeekRecap; copied: string; onCopy: (text: string) => void }) {
  return (
    <section class="week-section">
      <h2>What could use less of your plan</h2>
      {!recap.tips.length ? <div class="muted">Nothing stands out: no habit takes a tenth of this week's usage.</div> : null}
      <ul class="week-tips">
        {recap.tips.map((t) => (
          <li key={t.key} class="week-tip">
            <span class="week-tip-text">
              <span class="week-tip-title">{t.title}</span>
              {t.detail ? <span class="small muted">{t.detail}</span> : null}
            </span>
            {t.pct !== null ? (
              <span class="week-tip-pct small"
                title={`${t.pct}% of this week's usage: of the usage of these 7 days, as Claude Code's /usage weighs it toward your plan's limits. A request can count for several of these.`}>
                {t.pct}%
              </span>
            ) : null}
            {t.command ? (
              <button type="button" class="chip code" title={`Copy ${t.command}, to type it in a chat of yours`} onClick={() => onCopy(t.command)}>
                {copied === t.command ? "Copied" : t.command}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
