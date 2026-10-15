import { summaryText, tooltipLines } from "../../src/shared/model";
import type { Counts, Group, HostState, Overall } from "../../src/shared/types";
import { editorTab, post } from "../env";
import { useViewVisible } from "../util/petStage";
import { IconButton } from "./IconButton";
import { SparkIcon } from "./SparkIcon";

// The spark and the summary. In the sidebar the view's title bar has the
// buttons; opened as an editor tab there's no title bar, so they're here.
// With the big Clawd shown the summary is left out: his headline says it.
export function Header(props: {
  overall: Overall;
  counts: Counts;
  groups: Group[];
  hosts: HostState[];
  answered: boolean; // this computer's status came, or a host's
  unavailable: boolean; // no status, and the reason is known
  heroShown: boolean;
}) {
  const visible = useViewVisible();
  const { overall, counts, groups, hosts } = props;
  // "No sessions running" only once something answered; until then the list
  // says it's looking
  const summary = props.answered ? summaryText(counts) : props.unavailable ? "Status unavailable" : "";

  function newChat() {
    // one account: no need to ask which; else the extension asks
    const only = groups.length === 1 ? groups[0] : null;
    if (only?.host) post({ type: "newChat", groupId: only.id, host: only.host });
    else post({ type: "newChat", groupId: only ? only.id : "" });
  }

  return (
    <header class="header">
      <SparkIcon state={overall} spinning={overall === "working" && visible} />
      <h1 class="title" title={tooltipLines(groups, counts, hosts).join("\n")}>
        Claude Code
      </h1>
      <span class="summary" title={tooltipLines(groups, counts, hosts).join("\n")}>
        {props.heroShown ? "" : summary}
      </span>
      {editorTab ? (
        <div class="header-actions">
          <IconButton icon="add" label="New chat…" onClick={newChat} />
          <IconButton
            icon="server"
            label="SSH hosts…"
            title={
              hosts.length
                ? `SSH hosts: showing Claude on ${hosts.map((h) => h.name).join(", ")}. Click to pick hosts from ~/.ssh/config.`
                : "SSH hosts: show the Claude chats of your SSH hosts (from ~/.ssh/config) here too."
            }
            class={hosts.length ? "with-count" : ""}
            onClick={() => post({ type: "pickHosts" })}
          >
            {hosts.length ? <span class="count">{hosts.length}</span> : null}
          </IconButton>
          <IconButton icon="refresh" label="Refresh" onClick={() => post({ type: "refresh" })} />
        </div>
      ) : null}
    </header>
  );
}
