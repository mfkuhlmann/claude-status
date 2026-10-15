import { ago } from "../../src/shared/model";
import type { Group } from "../../src/shared/types";
import { post } from "../env";
import { canShareRecent, groupKeyOf, recentRef } from "../util/chat";
import { Icon } from "../util/icons";
import { useStore } from "../util/store";
import { toggleRecent, uiState } from "../util/ui";
import { useView } from "./context";
import { Elided } from "./Elided";
import { IconButton } from "./IconButton";

// The account's latest other chats, to pick one up again. Folded by default:
// the running chats come first.
export function RecentChats({ group }: { group: Group }) {
  const view = useView();
  const ui = useStore(uiState);
  const key = groupKeyOf(group);
  const items = (group.recent ?? []).slice(0, Math.max(0, view.settings.recentChats));
  if (!items.length) return null;
  const open = !!ui.recent[key];
  const share = canShareRecent(group.host, view.status);
  const reopen = group.host ? `Reopens it on ${group.host} in a terminal (ssh, claude --resume).` : "Reopens it in a terminal (claude --resume).";

  return (
    <div class="recent">
      <button
        type="button"
        class="recent-toggle small"
        aria-expanded={open}
        title="This account's latest chats that aren't listed above. Click one to reopen it."
        onClick={() => toggleRecent(key)}
      >
        <Icon name="chevron" class={open ? "open" : ""} />
        Recent chats ({items.length})
      </button>
      {open ? (
        <ul class="recent-list">
          {items.map((c) => {
            const chat = recentRef(c, group.host);
            return (
              <li key={c.key} class="recent-item">
                <button
                  type="button"
                  class="link recent-name"
                  title={`${c.name}\n${reopen}` + (c.shared ? `\nShared between accounts; last used on ${c.profile}.` : "")}
                  onClick={() => post({ type: "open", chat })}
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
      ) : null}
    </div>
  );
}
