// What a chat waiting for a permission asks, with Allow once / Always allow /
// Deny (with a note), or Claude's questions to answer: in its row and in its
// chat tab; and the lines of a diff (+ green, - red).

import { useState } from "preact/hooks";
import type { Answers, Decision, PermissionAsk, Question } from "../../src/shared/types";

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

// What a waiting chat asks, with Allow once / Always allow / Deny (a note);
// Claude's questions: each with its options, Send answers / Decline (a note)
export function AskBox({ ask, onAnswer, busy = false, max = 12, compact = false }: {
  ask: PermissionAsk;
  onAnswer: (d: Decision, note: string, answers?: Answers) => void;
  busy?: boolean;
  max?: number;
  compact?: boolean; // (in a row: the options' descriptions in tooltips)
}) {
  const [denying, setDenying] = useState(false);
  const [note, setNote] = useState("");
  const canAnswer = ask.answer === "hook" || ask.answer === "keys";
  const questions = ask.questions ?? [];
  const title = questions.length
    ? questions.length > 1 ? `Claude asks you ${questions.length} questions:` : "Claude asks you:"
    : ask.command ? "Claude asks to run:" : ask.file ? `Claude asks to change ${ask.file}:` : `Claude asks: ${ask.line}`;
  const deny = () => {
    onAnswer("deny", note);
    setDenying(false);
    setNote("");
  };
  return (
    <div class="ask-box">
      <div class="ask-title">{title}</div>
      {ask.command ? <pre class="ask-command">{ask.command}</pre> : null}
      {ask.diff.length ? <Diff lines={ask.diff} max={max} /> : null}
      {questions.length ? (
        <QuestionForm
          key={ask.request ?? ask.line}
          questions={questions}
          enabled={canAnswer && !busy}
          buttons={canAnswer && !denying}
          compact={compact}
          onSend={(answers) => onAnswer("answer", "", answers)}
          onDecline={() => setDenying(true)}
        />
      ) : null}
      {canAnswer && !denying && !questions.length ? (
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
              if (e.key === "Enter") deny();
            }}
          />
          <button type="button" class="btn" disabled={busy} onClick={deny}>{questions.length ? "Decline" : "Deny"}</button>
          <button type="button" class="btn secondary" onClick={() => setDenying(false)}>Cancel</button>
        </div>
      ) : null}
      {!canAnswer ? (
        <div class="muted small">
          {questions.length
            ? "Answer it in the chat, or run “Claude Status: Answer Permission Prompts from Claude Status…” (it answers Claude's questions too) to answer them here."
            : "Answer it in the chat, or run “Claude Status: Answer Permission Prompts from Claude Status…” to answer them here."}
        </div>
      ) : null}
    </div>
  );
}

interface Chosen {
  labels: string[];
  text: string;
}

// Claude's questions (AskUserQuestion): each with its options, one to pick
// (or any, for a multiSelect one), and a field to answer in your own words
// instead (as "Type something." in Claude's dialog); then Send answers
function QuestionForm({ questions, enabled, buttons, compact, onSend, onDecline }: {
  questions: Question[];
  enabled: boolean;
  buttons: boolean;
  compact: boolean;
  onSend: (answers: Answers) => void;
  onDecline: () => void;
}) {
  const [chosen, setChosen] = useState<Record<number, Chosen>>({});
  const stateOf = (i: number): Chosen => chosen[i] ?? { labels: [], text: "" };
  // a click on an option: the one answer (instead of what you typed), or one more of several
  const choose = (i: number, label: string) => {
    const q = questions[i];
    const was = stateOf(i);
    const labels = q.multiSelect ? (was.labels.includes(label) ? was.labels.filter((l) => l !== label) : [...was.labels, label]) : [label];
    setChosen({ ...chosen, [i]: { labels, text: q.multiSelect ? was.text : "" } });
  };
  // what you typed: the answer instead of an option (or one more of several)
  const type = (i: number, text: string) => {
    const was = stateOf(i);
    setChosen({ ...chosen, [i]: { labels: questions[i].multiSelect || !text.trim() ? was.labels : [], text } });
  };
  const answers = (): Answers => {
    const out: Answers = {};
    questions.forEach((q, i) => {
      const s = stateOf(i);
      const values = q.options.map((o) => o.label).filter((l) => s.labels.includes(l));
      if (s.text.trim()) values.push(s.text.trim());
      if (values.length) out[q.question] = values;
    });
    return out;
  };
  const complete = questions.every((_, i) => stateOf(i).labels.length > 0 || stateOf(i).text.trim() !== "");
  return (
    <div class="ask-questions">
      {questions.map((q, i) => (
        <div key={i} class="ask-question">
          {q.header && questions.length > 1 ? <div class="ask-question-header muted">{q.header}</div> : null}
          <div class="ask-question-text">
            {q.question}
            {q.multiSelect ? <span class="muted"> (choose any)</span> : null}
          </div>
          {q.options.map((o) => (
            <label key={o.label} class="ask-option" title={compact && o.description ? o.description : undefined}>
              <input
                type={q.multiSelect ? "checkbox" : "radio"}
                disabled={!enabled}
                checked={stateOf(i).labels.includes(o.label)}
                onChange={() => choose(i, o.label)}
              />
              <span>
                {o.label}
                {!compact && o.description ? <span class="ask-option-desc muted">{o.description}</span> : null}
              </span>
            </label>
          ))}
          <input
            type="text"
            class="ask-note ask-own"
            placeholder="Or answer in your own words…"
            disabled={!enabled}
            value={stateOf(i).text}
            onInput={(e) => type(i, (e.target as HTMLInputElement).value)}
          />
        </div>
      ))}
      {buttons ? (
        <div class="ask-buttons">
          <button type="button" class="btn" disabled={!enabled || !complete} onClick={() => onSend(answers())}>Send answers</button>
          <button type="button" class="btn secondary" disabled={!enabled} onClick={onDecline}>Decline…</button>
        </div>
      ) : null}
    </div>
  );
}
