import { planWhere, shareAccounts, machineStatus } from "../../src/shared/model";
import type { Group } from "../../src/shared/types";
import { post } from "../env";
import { groupKeyOf } from "../util/chat";
import { Icon } from "../util/icons";
import { useStore } from "../util/store";
import { togglePlans, uiState } from "../util/ui";
import { useView } from "./context";
import { IconButton } from "./IconButton";

// The plans this account's chats wrote in plan mode (<config>/plans), newest
// first. Folded by default. A plan opens in an editor tab (an SSH host's: a
// copy, unless this window is connected to it); ▶ carries it out in a new
// chat, ◀ goes back to the chat that made it, and the share button shares it
// with the machine's other accounts.
export function PlansList({ group }: { group: Group }) {
  const view = useView();
  const ui = useStore(uiState);
  const key = groupKeyOf(group);
  const plans = group.plans ?? [];
  if (!plans.length) return null;
  const open = !!ui.plans[key];
  const host = group.host;
  const share = shareAccounts(machineStatus(view, host)).length >= 2;
  const copy = !!host && host !== view.hosts.find((h) => h.current)?.name;
  const ref = (plan: string) => (host ? { groupId: group.id, host, plan } : { groupId: group.id, plan });

  return (
    <div class="recent plans">
      <button
        type="button"
        class="recent-toggle small"
        aria-expanded={open}
        title="The plans this account's chats wrote in plan mode, newest first. Open one, carry it out in a new chat, go back to the chat that made it, or share it with your other accounts."
        onClick={() => togglePlans(key)}
      >
        <Icon name="chevron" class={open ? "open" : ""} />
        Plans ({plans.length})
      </button>
      {open ? (
        <ul class="recent-list">
          {plans.map((p) => (
            <li key={p.key} class="recent-item">
              <button
                type="button"
                class="link recent-name"
                title={
                  `${p.title}\n` +
                  (copy ? `Click to open it: a copy, fetched from ${host}.` : "Click to open it in an editor tab: what you change there is the plan.") +
                  (p.cwd ? `\nFolder: ${host ? `${host}:` : ""}${p.cwd}` : "") +
                  (p.shared ? "\nShared with your other accounts." : "") +
                  (p.chatId ? "" : "\nThe chat that made it isn't here any more.")
                }
                onClick={() => post({ type: "openPlan", ...ref(p.key) })}
              >
                {p.title}
              </button>
              {p.shared ? (
                <span class="muted" title="Shared with your other accounts">
                  ⇄
                </span>
              ) : null}
              <span class="small muted nowrap recent-folder" title={p.cwd || p.path}>
                {planWhere(p, view.now)}
              </span>
              <div class="row-actions">
                <IconButton
                  icon="play"
                  label="Carry it out…"
                  title="Carry it out in a new chat: the plan is the chat's first message, with what you add; in a terminal, in the background or in a Claude Code tab, in the plan's folder or another one."
                  onClick={() => post({ type: "carryOutPlan", ...ref(p.key) })}
                />
                {p.chatId ? (
                  <IconButton
                    icon="back"
                    label="Continue the chat that made it"
                    title="Continue the chat that made it, to change the plan with Claude: it comes up, or reopens (in a terminal or a Claude Code tab, as the switch of Recent chats says)."
                    onClick={() => post({ type: "continuePlanChat", ...ref(p.key) })}
                  />
                ) : null}
                {share ? (
                  <IconButton
                    icon="share"
                    label="Share this plan…"
                    title="Share this plan with your other accounts: one file on each of them, so a change shows on all of them. Sharing a chat shares its plan too."
                    onClick={() => post({ type: "sharePlan", ...ref(p.key) })}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
