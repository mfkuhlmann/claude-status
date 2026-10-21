import { duration, queuedFor } from "../../src/shared/model";
import type { Group } from "../../src/shared/types";
import { post } from "../env";
import { useView } from "./context";
import { IconButton } from "./IconButton";

// Tasks waiting for this account's usage limit to reset (the queue is
// this computer's, an SSH host's tasks included): when each starts, or why
// it didn't; start one now, or cancel it
export function QueuedTasks({ group }: { group: Group }) {
  const view = useView();
  const tasks = queuedFor(view.status, group);
  if (!tasks.length) return null;
  const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <ul class="queued">
      {tasks.map((t) => {
        const what = t.planTitle ? `Carry out “${t.planTitle}”${t.prompt ? `: ${t.prompt}` : ""}` : t.prompt;
        const when = t.error ? "didn't start" : t.due || t.startAt <= view.now ? "starting…" : `starts in ${duration(t.startAt - view.now)}`;
        return (
          <li key={t.id} class={"queued-item" + (t.error ? " failed" : "")}>
            <span class="queued-mark" aria-hidden="true">
              {t.error ? "⚠" : "⏱"}
            </span>
            <span class="queued-what" title={`${what}\n\nWaits for the usage limit, then starts in the background in ${t.folderShort || "~"}, at ${clock(t.startAt)}.`}>
              {what.split("\n")[0]}
            </span>
            <div class="queued-actions">
              <IconButton icon="play" label="Start it now" title="Start it now, in the background, without waiting for the limit to reset." onClick={() => post({ type: "startQueued", id: t.id })} />
              <IconButton icon="close" label="Cancel it" title="Cancel it: it doesn't start." onClick={() => post({ type: "unqueue", id: t.id })} />
            </div>
            <span class="small muted queued-when" title={t.error || undefined}>
              {t.folderShort || "~"} · {when}
            </span>
            {t.error ? <div class="queued-error small">{t.error}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}
