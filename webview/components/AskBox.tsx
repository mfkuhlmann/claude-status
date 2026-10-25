// What a chat waiting for a permission asks, with Allow once / Always allow /
// Deny (with a note): in its row and in its chat tab; and the lines of a
// diff (+ green, - red).

import { useState } from "preact/hooks";
import type { PermissionAsk } from "../../src/shared/types";

// The change a permission prompt asks for, or a file's diff: + green, - red
export function Diff({ lines, max }: { lines: string[]; max?: number }) {
  const shown = max && lines.length > max ? [...lines.slice(0, max), `… ${lines.length - max} more lines`] : lines;
  return (
    <pre class="pane-diff">
      {shown.map((l, i) => (
        <div key={i} class={l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hunk" : ""}>
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

// What a waiting chat asks, with Allow once / Always allow / Deny (a note)
export function AskBox({ ask, onAnswer, busy = false, max = 12 }: { ask: PermissionAsk; onAnswer: (d: "allow" | "always" | "deny", note: string) => void; busy?: boolean; max?: number }) {
  const [denying, setDenying] = useState(false);
  const [note, setNote] = useState("");
  const canAnswer = ask.answer === "hook" || ask.answer === "keys";
  const title = ask.command ? "Claude asks to run:" : ask.file ? `Claude asks to change ${ask.file}:` : `Claude asks: ${ask.line}`;
  return (
    <div class="ask-box">
      <div class="ask-title">{title}</div>
      {ask.command ? <pre class="ask-command">{ask.command}</pre> : null}
      {ask.diff.length ? <Diff lines={ask.diff} max={max} /> : null}
      {canAnswer && !denying ? (
        <div class="ask-buttons">
          <button type="button" class="btn" disabled={busy} onClick={() => onAnswer("allow", "")}>Allow once</button>
          {ask.answer === "keys" || ask.always ? (
            <button
              type="button"
              class="btn secondary"
              disabled={busy}
              title={ask.answer === "keys" ? "Like “Yes, and don't ask again” in its dialog."
                : `From now on, without asking: ${ask.always}. Saved in the project's .claude/settings.local.json, as Claude's own “don't ask again” does.`}
              onClick={() => onAnswer("always", "")}
            >
              Always allow
            </button>
          ) : null}
          <button type="button" class="btn secondary" disabled={busy} onClick={() => setDenying(true)}>Deny…</button>
        </div>
      ) : null}
      {canAnswer && denying ? (
        <div class="ask-buttons">
          <input
            type="text"
            class="ask-note"
            placeholder="What should Claude do instead? (optional)"
            value={note}
            onInput={(e) => setNote((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onAnswer("deny", note);
                setDenying(false);
                setNote("");
              }
            }}
          />
          <button type="button" class="btn" disabled={busy} onClick={() => { onAnswer("deny", note); setDenying(false); setNote(""); }}>Deny</button>
          <button type="button" class="btn secondary" onClick={() => setDenying(false)}>Cancel</button>
        </div>
      ) : null}
      {!canAnswer ? (
        <div class="muted small">
          Answer it in the chat, or run “Claude Status: Answer Permission Prompts from Claude Status…” to answer them here.
        </div>
      ) : null}
    </div>
  );
}
