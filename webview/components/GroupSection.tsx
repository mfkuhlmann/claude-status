import { duration, formatTokens, stateText } from "../../src/shared/model";
import type { Group, TokenTotals, Tokens } from "../../src/shared/types";
import { post } from "../env";
import { fiveHourOf, groupKeyOf, sharedRef, stageChats } from "../util/chat";
import { Icon } from "../util/icons";
import { useStore } from "../util/store";
import { toggleStats, uiState } from "../util/ui";
import { AccountStage } from "./AccountStage";
import { useView } from "./context";
import { IconButton } from "./IconButton";
import { RecentChats } from "./RecentChats";
import { SessionRow, stateClass } from "./SessionRow";
import { StatsPanel } from "./StatsPanel";
import { UsageBar } from "./UsageBar";

function modelName(model: string): string {
  return model.replace(/^claude-/, "");
}

function tokenTitle(t: Tokens): string {
  const fmt = (b: TokenTotals) =>
    `input ${formatTokens(b.input)} · output ${formatTokens(b.output)} · cache read ${formatTokens(b.cacheRead)} · cache write ${formatTokens(b.cacheWrite)} · ${b.messages} replies`;
  const models = t.models.map((m) => `${modelName(m.model)}: ${formatTokens(m.total)}`);
  return (
    "Tokens (this machine's transcripts only)\n" +
    `Today: ${fmt(t.today)}\nLast 7 days: ${fmt(t.week)}` +
    (models.length ? `\nBy model (7 days): ${models.join(", ")}` : "") +
    (t.week.shared > 0
      ? `\nIncludes ${formatTokens(t.today.shared)} today (${formatTokens(t.week.shared)} in 7 days) from chats shared with another profile. A transcript doesn't say which account paid, so shared chats count on both.`
      : "")
  );
}

function TokenLine({ tokens, topModels }: { tokens: Tokens; topModels: Tokens["models"] }) {
  return (
    <span class="token-line">
      <span class="muted">Tokens today </span>
      {formatTokens(tokens.today.total)}
      <span class="muted"> · 7 days </span>
      {formatTokens(tokens.week.total)}
      {topModels.map((m) => (
        <span key={m.model} class="muted">
          {" · "}
          {modelName(m.model)} {formatTokens(m.total)}
        </span>
      ))}
    </span>
  );
}

// One Claude account: its pets, plan limits, token totals, chats (from every
// config folder logged into it) and recent chats. With group.host set, the
// account is on that SSH host and its actions run there.
export function GroupSection({ group: g }: { group: Group }) {
  const view = useView();
  const now = view.now;
  const host = g.host;
  const key = groupKeyOf(g);
  const settings = view.settings;
  const multiProfile = g.profiles.length > 1;
  const limits = g.limits;
  const usageAge = !limits ? "" : now - limits.updatedAt < 60000 ? "just now" : `${duration(now - limits.updatedAt)} ago`;
  const tokens = settings.showTokens ? g.tokens : null;
  const topModels = tokens ? tokens.models.slice(0, 2) : [];
  const ui = useStore(uiState);
  const stats = tokens && g.stats ? g.stats : null;
  const statsOpen = !!stats && !!ui.stats[key];

  return (
    <section class="group" aria-label={(host ? host + ": " : "") + g.title}>
      <div class="group-head">
        <h3 class="group-title" title={(host ? host + ": " : "") + g.title}>
          {host ? <span class="group-host muted">{host}: </span> : null}
          {g.title}
        </h3>
        <IconButton
          icon="add"
          label={`New chat on ${g.title}`}
          title={
            host
              ? `New chat on ${g.title}: opens a terminal with a new Claude chat on this account on ${host} (over ssh), in the folder you pick.`
              : `New chat on ${g.title}: opens a terminal with a new Claude chat on this account, in the folder you pick.`
          }
          onClick={() => post(host ? { type: "newChat", groupId: g.id, host } : { type: "newChat", groupId: g.id })}
        />
        <span class="spacer" />
        {usageAge ? <span class="usage-age small muted">usage updated {usageAge}</span> : null}
        {multiProfile ? <span class="small muted nowrap">{g.profiles.join(" + ")}</span> : null}
      </div>

      {settings.showPet ? (
        <AccountStage
          stageKey={key}
          input={{ chats: stageChats(g), maxPets: settings.showPet ? settings.chatPets : 0, fiveHour: fiveHourOf(g) }}
        />
      ) : null}

      {/* Plan limits (from the status line) */}
      {limits && limits.windows.length ? (
        <div class="usage" title={`Plan usage as of ${usageAge}`}>
          {limits.windows.map((w) => (
            <UsageBar key={w.key} window={w} now={now} />
          ))}
        </div>
      ) : (
        <div class="no-usage small muted">
          <span title="Plan limits come from Claude Code's status line. They update whenever a chat of this account gets a reply.">
            No plan usage yet: shows after this account's next reply.
          </span>
          {!host ? (
            <>
              {" "}
              <button
                type="button"
                class="link"
                title="Adds the snippet that reports plan usage to Claude Code's status line"
                onClick={() => post({ type: "setupUsageBars" })}
              >
                Set up…
              </button>
            </>
          ) : null}
        </div>
      )}

      {/* Token totals (from local transcripts) */}
      {tokens ? (
        stats ? (
          <button
            type="button"
            class="tokens small stats-toggle"
            aria-expanded={statsOpen}
            title={`${tokenTitle(tokens)}\n\nClick to ${statsOpen ? "hide" : "show"} the last ${stats.days.length} days.`}
            onClick={() => toggleStats(key)}
          >
            <Icon name="chevron" class={statsOpen ? "open" : ""} />
            <TokenLine tokens={tokens} topModels={topModels} />
          </button>
        ) : (
          <div class="tokens small" title={tokenTitle(tokens)}>
            <TokenLine tokens={tokens} topModels={topModels} />
          </div>
        )
      ) : null}
      {statsOpen && stats ? <StatsPanel stats={stats} /> : null}

      <div class="sessions">
        {g.sessions.map((s) => (
          <SessionRow key={s.key} session={s} host={host} showProfile={multiProfile} />
        ))}
        {g.sessions.length === 0 ? <div class="no-sessions muted">No running chats</div> : null}
      </div>

      {/* Chats shared with this account that are in use on another one:
          they're listed there, once, so here only a line points to them */}
      {(g.sharedHere ?? []).map((p) => (
        <div key={p.key} class="shared-line">
          <span class={`shared-glyph ${stateClass(p.state, p.reason)}`} aria-hidden="true">
            ⇄
          </span>
          <button
            type="button"
            class="link shared-name"
            title={
              (p.copy
                ? `Shared chat, continued on ${p.profile} as a copy.\nNew messages are only in that copy. Click to go to it.`
                : p.state === "done"
                  ? `Shared chat, last used on ${p.profile}.\nIt's listed once, under the account it's used on. Click to go to it.`
                  : `Shared chat, open on ${p.profile}.\nIt's listed once, under the account it's used on. Click to go to it.`) +
              (p.stoppedHere ? "\nIts background session on this account was stopped." : "")
            }
            onClick={() => post({ type: "open", chat: sharedRef(p, host) })}
          >
            {p.name}
          </button>
          <span class="shared-where small muted">
            {p.copy ? `copy on ${p.profile}` : `on ${p.profile}`} · {stateText(p, now)}
          </span>
        </div>
      ))}

      <RecentChats group={g} />
    </section>
  );
}
