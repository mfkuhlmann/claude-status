import { duration } from "../../src/shared/model";
import type { Agent } from "../../src/shared/types";

function statusText(a: Agent, now: number): string {
  switch (a.status) {
    case "running":
      return `running · ${duration(now - (a.started ?? now))}`;
    case "done":
      return "done";
    case "failed":
      return "failed";
    default:
      return "stopped";
  }
}

// A chat's subagents as a tree: what each one is doing
export function AgentTree({ tree, now }: { tree: Agent[]; now: number }) {
  return (
    <ul class="agents" aria-label="Subagents">
      {tree.map((a) => {
        const title = a.description || a.type;
        return (
          <li key={a.id} class={`agent ag-${a.status}`} style={{ paddingLeft: `calc(var(--cs-gu) * 0.9 * ${a.depth})` }}>
            <span class="agent-branch" aria-hidden="true">
              └
            </span>
            <span class="agent-dot" aria-hidden="true" />
            <div class="agent-main">
              <div class="agent-line">
                <span class="agent-desc" title={title}>
                  {title}
                </span>
                {a.description && a.type ? (
                  <span class="agent-type" title={a.model ? `${a.type} on ${a.model}` : a.type}>
                    {a.model ? `${a.type} · ${a.model}` : a.type}
                  </span>
                ) : null}
                <span class="agent-status">{statusText(a, now)}</span>
              </div>
              {a.activity ? (
                <div class="agent-activity" title={a.activity}>
                  {a.activity}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
