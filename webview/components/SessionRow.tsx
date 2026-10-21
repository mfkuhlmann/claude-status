import {
  canEndChat,
  changesTitle,
  handoverTarget,
  hasPeek,
  hasTurn,
  machineStatus,
  modeHint,
  modeText,
  overlapText,
  peekLine,
  petKeyOf,
  plural,
  shareAccounts,
  stateText,
  tasksTitle,
  usageLevel,
} from "../../src/shared/model";
import type { Session } from "../../src/shared/types";
import { post } from "../env";
import { pets } from "../pets";
import { canRemove, canShare, canStop, chatRefOf, isBackground, openHint, rowKeyOf, sharedTagTitle, shareTitle } from "../util/chat";
import { useStore } from "../util/store";
import { toggleAgents, togglePeek, uiState } from "../util/ui";
import { AgentTree } from "./AgentTree";
import { useView } from "./context";
import { Elided } from "./Elided";
import { IconButton } from "./IconButton";
import { PeekPanel } from "./PeekPanel";
import { Tag } from "./Tag";

// The color class of a chat's state; a failed chat stands out from done ones
export function stateClass(state: string, reason: string): string {
  return reason === "failed" ? "st-failed" : `st-${state}`;
}

function lineTitle(kind: string): string {
  return kind === "needs"
    ? "What it needs: "
    : kind === "result"
      ? "Result: "
      : kind === "activity"
        ? "Doing: "
        : kind === "stopped"
          ? "What stopped it: "
          : kind === "recap"
            ? "Claude's recap of the chat, written when you came back to it:\n"
            : "";
}

// One chat: state, name (click to open), tags, folder, model, context fill,
// what it's doing or needs or said last (click it for more), and its
// subagents. With `host`, the chat is on that SSH host.
export function SessionRow({ session: s, host, showProfile }: { session: Session; host?: string; showProfile: boolean }) {
  const view = useView();
  const ui = useStore(uiState);
  const now = view.now;
  const rowKey = rowKeyOf(s, host);
  const chat = chatRefOf(s, host);
  const petColor = pets.petColor(petKeyOf(s, host));
  const agents = s.agents;
  const showAgents = !!agents && !!ui.agents[rowKey];
  const tag = s.entrypoint === "claude-vscode" ? "VS Code" : isBackground(s) ? "background" : "";
  const line = peekLine(s);
  const canPeek = hasPeek(s);
  const showPeek = canPeek && !!ui.peek[rowKey];
  const tasks = s.tasks;
  const changes = s.changes;

  const share = canShare(s, machineStatus(view, host));
  const remove = canRemove(s);
  const stop = canStop(s, host);
  const mode = modeText(s.peek?.mode);
  // A usage limit stopped it: it can go on on another account with room left
  const handover = handoverTarget(s, shareAccounts(machineStatus(view, host)));
  const stopped = s.stopped && !s.stopped.over ? " stopped" : s.stopped ? " freed" : "";

  return (
    <div class={`session ${stateClass(s.state, s.reason)}${stopped}`}>
      {/* A bar in the color of the chat's pet, to spot which pet is which */}
      <span class="pet-bar" style={{ background: petColor || "transparent" }} aria-hidden="true" />
      <span class="state-dot" aria-hidden="true" />
      <div class="session-main">
        <div class="session-line">
          <button type="button" class="link session-name" title={openHint(s, host)} onClick={() => post({ type: "open", chat })}>
            {s.name}
          </button>
          {showProfile && s.profile ? <Tag text={s.profile} title="The Claude profile (config folder) this chat runs in" /> : null}
          {tag ? (
            <Tag
              text={tag}
              title={
                s.entrypoint === "claude-vscode"
                  ? "Runs in VS Code's Claude panel. Click the name to open the conversation there."
                  : "A background session: Claude's background service runs it, with no terminal of its own. Click the name to open it in a terminal (claude attach)."
              }
            />
          ) : null}
          {s.shared ? <Tag text={s.shared.forkOf ? "⇄ shared copy" : "⇄ shared"} title={sharedTagTitle(s)} /> : null}
          {agents ? (
            <Tag
              text={`agents ${agents.done}/${agents.total}`}
              active={agents.running > 0}
              pressed={showAgents}
              title={`Subagents: ${agents.done} done, ${agents.running} running, ${agents.stopped} stopped${agents.failed ? `, ${agents.failed} failed` : ""}. Click to ${showAgents ? "hide" : "show"} what each one is doing.`}
              onClick={() => toggleAgents(rowKey)}
            />
          ) : null}
          {tasks ? (
            <Tag
              text={`${tasks.done}/${tasks.total}`}
              fill={tasks.total ? tasks.done / tasks.total : 0}
              active={!!tasks.current}
              pressed={showPeek}
              title={`${tasksTitle(tasks)}\n\nClick to ${showPeek ? "hide" : "show"} the chat's tasks and last exchange.`}
              onClick={() => togglePeek(rowKey)}
            />
          ) : null}
          {s.overlaps?.length ? (
            <Tag
              text="⚠ same files"
              warning
              title={`${overlapText(s.overlaps)}\n\nTwo chats changing the same files can overwrite each other's work. Click to go to the other chat.`}
              onClick={() => post({ type: "openOverlap", chat })}
            />
          ) : null}
          {mode ? (
            <Tag text={mode} warning={s.peek?.mode === "bypassPermissions"} title={`Permission mode: ${mode}\n${modeHint(s.peek?.mode)}`} />
          ) : null}
          {s.plan ? (
            <Tag
              text="plan ↗"
              title={`${s.plan.title}\nThe plan this chat made. Click to open it${host && host !== view.hosts.find((h) => h.current)?.name ? ` (a copy, fetched from ${host})` : ""}.`}
              onClick={() => post({ type: "openPlan", chat })}
            />
          ) : null}
          {changes ? (
            <Tag
              text={`± ${plural(changes.count, "%1 file", "%1 files")}`}
              title={changesTitle(changes, host)}
              onClick={host ? undefined : () => post({ type: "compareChanges", chat, turn: false })}
            />
          ) : null}
          <span class="state-text" title={stateText(s, now)}>
            {stateText(s, now)}
          </span>
        </div>

        <div class="session-line small">
          <Elided text={s.cwdShort || s.cwd || "~"} class="folder muted" title={s.cwd || s.cwdShort} />
          {s.model ? (
            <span class="muted nowrap" title={s.effort ? `${s.model}\nEffort: ${s.effort} (how hard it thinks; /effort changes it)` : s.model}>
              {s.effort ? `${s.model} · ${s.effort}` : s.model}
            </span>
          ) : null}
          {s.context != null ? (
            <>
              {/* Context window fill */}
              <span
                class={`meter ctx-meter lvl-${usageLevel(s.context)}`}
                role="meter"
                aria-label="Context window"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(s.context)}
              >
                <span style={{ width: `${Math.min(100, Math.max(0, s.context))}%` }} />
              </span>
              <span class="muted nowrap" title="How full the chat's context window is">
                ctx {Math.round(s.context)}%
              </span>
            </>
          ) : null}
        </div>

        {line ? (
          canPeek ? (
            <button
              type="button"
              class={`session-detail small peek-line pk-${line.kind}`}
              aria-expanded={showPeek}
              title={`${lineTitle(line.kind)}${line.text}\n\nClick to ${showPeek ? "hide" : "show"} your last prompt and Claude's reply${tasks ? ", the tasks" : ""}${changes ? " and the changed files" : ""}.`}
              onClick={() => togglePeek(rowKey)}
            >
              {line.text}
            </button>
          ) : (
            <div class={`session-detail small pk-${line.kind}`} title={lineTitle(line.kind) + line.text}>
              {line.text}
            </div>
          )
        ) : null}

        {handover ? (
          <div class="handover small">
            <button
              type="button"
              class="link"
              title={
                (handover.pct !== null
                  ? `${handover.title} has used ${Math.round(handover.pct)}% of its ${handover.label} limit.`
                  : `${handover.title}'s plan usage isn't known here.`) +
                (s.pid !== null
                  ? s.kind === "bg"
                    ? ` This background session is stopped first (claude stop); then the chat is shared with ${handover.title} and reopens there in a terminal.`
                    : ` Claude here quits first (its terminal stays open); then the chat is shared with ${handover.title} and reopens there in a terminal.`
                  : ` The chat is shared with ${handover.title} and reopens there in a terminal.`)
              }
              onClick={() => post({ type: "handOver", chat, profile: handover.shareProfile })}
            >
              Continue on {handover.title}
            </button>
          </div>
        ) : null}

        {showPeek ? <PeekPanel session={s} host={host} chat={chat} /> : null}

        {showAgents && agents ? <AgentTree tree={agents.tree} now={now} rowKey={rowKey} chat={chat} host={host} /> : null}
      </div>

      {share || remove || stop ? (
        <div class="row-actions">
          {share ? (
            <IconButton
              icon="share"
              label="Continue on another account…"
              title={shareTitle(host)}
              onClick={() => post({ type: "share", chat })}
            />
          ) : null}
          {remove ? (
            <IconButton
              icon="close"
              label="Remove from the list"
              title="Remove from the list. Only hides it here; nothing is deleted. It comes back if the chat runs again, or with Show Removed Chats Again."
              onClick={() => post({ type: "dismiss", chat })}
            />
          ) : null}
          {stop ? (
            canEndChat(s) ? (
              <IconButton
                icon="stop"
                label={hasTurn(s) ? "Interrupt or stop this chat…" : "Stop this chat…"}
                title={
                  s.entrypoint === "claude-vscode"
                    ? "Stop this chat. Asks first; its Claude Code tab shows it as interrupted and goes on with your next message."
                    : hasTurn(s)
                      ? "Interrupt or stop this chat. Asks first. Interrupting is like Ctrl+C or the stop button of a Claude Code tab (where it runs in a terminal of this window, or in tmux): its subagents stop too and the chat stays open. Stopping cuts off the current step, Claude quits and its terminal stays open."
                      : "Stop this chat. Asks first; Claude quits and its terminal stays open. The chat is kept and shows under Recent chats."
                }
                onClick={() => post({ type: "stop", chat })}
              />
            ) : (
              <IconButton
                icon="stop"
                label="Stop this background session…"
                title="Stop this background session. Asks first; the conversation is kept and claude attach resumes it."
                onClick={() => post({ type: "stop", chat })}
              />
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
