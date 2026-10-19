import { canEndChat, changesTitle, hasPeek, hasTurn, peekLine, petKeyOf, plural, stateText, tasksTitle, usageLevel } from "../../src/shared/model";
import type { Session } from "../../src/shared/types";
import { post } from "../env";
import { pets } from "../pets";
import { canRemove, canShare, canStop, chatRefOf, isBackground, openHint, rowKeyOf, sharedTagTitle } from "../util/chat";
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
  return kind === "needs" ? "What it needs: " : kind === "result" ? "Result: " : kind === "activity" ? "Doing: " : "";
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

  const share = canShare(s, host, view.status);
  const remove = canRemove(s);
  const stop = canStop(s, host);

  return (
    <div class={`session ${stateClass(s.state, s.reason)}`}>
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
              title={`Subagents: ${agents.done} done, ${agents.running} running, ${agents.stopped} stopped. Click to ${showAgents ? "hide" : "show"} what each one is doing.`}
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
          {s.context !== null ? (
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

        {showPeek ? <PeekPanel session={s} host={host} chat={chat} /> : null}

        {showAgents && agents ? <AgentTree tree={agents.tree} now={now} rowKey={rowKey} chat={chat} host={host} /> : null}
      </div>

      {share || remove || stop ? (
        <div class="row-actions">
          {share ? (
            <IconButton
              icon="share"
              label="Continue on another account…"
              title="Continue on another account: share this chat with your other accounts and pick it up there, or keep it on one account only."
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
