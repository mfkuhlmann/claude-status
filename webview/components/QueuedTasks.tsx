import { clockText, duration, queuedFor, queuedWhat } from "../../src/shared/model";
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
  return (
    <ul class="queued">
      {tasks.map((t) => {
        const what = queuedWhat(t);
        const folder = (t.host ? `${t.host}:` : "") + (t.folder || "~");
        const how = t.chat
          ? `The chat goes on in the background in ${folder}, at ${clockText(t.startAt)}, telling Claude that the limit has reset. A session that still has it open (in a terminal, or in the background) ends first; if it went on before then, nothing happens.`
          : `Waits for the usage limit, then starts in the background in ${folder}, at ${clockText(t.startAt)}.`;
        const when = t.error ? "didn't start" : t.due || t.startAt <= view.now ? "starting…" : `starts in ${duration(t.startAt - view.now)}`;
        return (
          <li key={t.id} class={"queued-item" + (t.error ? " failed" : "")}>
            <span class="queued-mark" aria-hidden="true">
              {t.error ? "⚠" : "⏱"}
            </span>
            <span class="queued-what" title={`${what}\n\n${how}`}>
              {what.split("\n")[0]}
            </span>
            <div class="queued-actions">
              <IconButton icon="play" label="Start it now" title="Start it now, in the background, without waiting for the limit to reset. While the limit lasts, Claude stops again at once." onClick={() => post({ type: "startQueued", id: t.id })} />
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
