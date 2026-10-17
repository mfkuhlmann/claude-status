import {
  ago,
  claudeCodeHere,
  claudeCodeReopenHint,
  cliInstalled,
  reopensInClaudeCode,
  terminalReopenHint,
} from "../../src/shared/model";
import type { Group, ReopenIn } from "../../src/shared/types";
import { post } from "../env";
import { canShareRecent, groupKeyOf, recentRef } from "../util/chat";
import { Icon } from "../util/icons";
import { useStore } from "../util/store";
import { toggleRecent, uiState } from "../util/ui";
import { useView } from "./context";
import { Elided } from "./Elided";
import { IconButton } from "./IconButton";

// The account's latest other chats, to pick one up again. Folded by default:
// the running chats come first. A switch above them says where they reopen:
// in a terminal, or in a Claude Code tab (kept in claudeStatus.reopenIn). A
// half is greyed out where it can't work: no claude command on the chat's
// machine, or Claude Code not here or on another account.
export function RecentChats({ group }: { group: Group }) {
  const view = useView();
  const ui = useStore(uiState);
  const key = groupKeyOf(group);
  const items = (group.recent ?? []).slice(0, Math.max(0, view.settings.recentChats));
  if (!items.length) return null;
  const open = !!ui.recent[key];
  const share = canShareRecent(group.host, view.status);
  const cliHere = cliInstalled(group.host ? view.hosts.find((h) => h.name === group.host)?.result : view.status);
  const codeHere = claudeCodeHere(group, view.claudeCode);
  const inCode = reopensInClaudeCode(view.settings.reopenIn, cliHere, codeHere);
  const groups = view.status?.groups ?? [];
  const terminalHint = terminalReopenHint(group.host, cliHere);
  const codeHint = claudeCodeReopenHint(group, view.claudeCode, groups);
  const canOpen = inCode || cliHere;
  const reopen = !canOpen ? `${terminalHint}\n${codeHint}` : inCode ? codeHint : terminalHint;

  const half = (where: ReopenIn, text: string, available: boolean, checked: boolean, title: string) => (
    <button
      type="button"
      class={"tag open-in-half" + (available ? " clickable" : " unavailable")}
      aria-pressed={checked}
      aria-disabled={!available}
      title={title}
      onClick={() => available && post({ type: "setReopenIn", where })}
    >
      {text}
    </button>
  );

  return (
    <div class="recent">
      <button
        type="button"
        class="recent-toggle small"
        aria-expanded={open}
        title="This account's latest chats that aren't listed above. Click one to reopen it, in a terminal or in a Claude Code tab (the switch at the top of the list)."
        onClick={() => toggleRecent(key)}
      >
        <Icon name="chevron" class={open ? "open" : ""} />
        Recent chats ({items.length})
      </button>
      {open ? (
        <>
          <div class="open-in small" role="group" aria-label="Where recent chats reopen">
            <span class="muted">Open in:</span>
            {half("terminal", "Terminal", cliHere, cliHere && !inCode, (cliHere ? "Reopen chats in a terminal\n" : "No claude command\n") + terminalHint)}
            {half("claudeCode", "Claude Code tab", codeHere, inCode, (codeHere ? "Reopen chats in a Claude Code tab\n" : "Not here\n") + codeHint)}
          </div>
          {!cliHere && !codeHere ? <div class="open-in-why small muted">{`${terminalHint} ${codeHint}`}</div> : null}
          <ul class="recent-list">
            {items.map((c) => {
              const chat = recentRef(c, group.host);
              return (
                <li key={c.key} class={"recent-item" + (canOpen ? "" : " unavailable")}>
                  <button
                    type="button"
                    class="link recent-name"
                    aria-disabled={!canOpen}
                    title={`${c.name}\n${reopen}` + (c.shared ? `\nShared between accounts; last used on ${c.profile}.` : "")}
                    onClick={() => canOpen && post(inCode ? { type: "openInClaudeCode", chat } : { type: "open", chat })}
                  >
                    {c.name}
                  </button>
                  {c.shared ? (
                    <span class="muted" title="Shared between accounts">
                      ⇄
                    </span>
                  ) : null}
                  <Elided text={c.cwdShort || "~"} class="recent-folder small muted" title={c.cwd} />
                  <span class="small muted nowrap">· {ago(view.now - c.lastActive)}</span>
                  {share ? (
                    <div class="row-actions">
                      <IconButton
                        icon="share"
                        label="Continue on another account…"
                        title="Continue on another account: share this chat with your other accounts and pick it up there, or keep it on one account only."
                        onClick={() => post({ type: "share", chat })}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
