// The chat tab's page (src/chatPane.ts): a chat's conversation as it goes,
// a box to reply, what it asks while it waits for a permission, and its
// review. It shows what the extension sends and says what you clicked.

import { render } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { routeHint, testsText, type Conversation, type PaneChat, type PaneHostMessage, type PaneItem, type PaneMessage, type ReviewAnswer } from "../src/shared/pane";
import { AskBox, Diff } from "./components/AskBox";
import { Tag } from "./components/Tag";
import { Markdown } from "./util/markdown";

declare global {
  interface Window {
    CLAUDE_CHAT: { tab: "chat" | "review"; local: boolean };
  }
}

const api = acquireVsCodeApi();
const post = (m: PaneMessage) => api.postMessage(m);
const config = window.CLAUDE_CHAT;

function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

function ToolLine({ item, open, onToggle, pending }: { item: PaneItem; open: boolean; onToggle: () => void; pending: string }) {
  const mark = item.status === "ok" ? "✓" : item.status === "error" ? "✗" : pending;
  return (
    <div class="pane-tool">
      <button type="button" class="pane-tool-line" aria-expanded={open} onClick={onToggle}>
        <span class="pane-fold">{open ? "▾" : "▸"}</span>
        <span class="pane-tool-text">{item.line}</span>
        <span class={`pane-tool-mark ${item.status ?? ""}`}>{mark}</span>
      </button>
      {open && (item.input || item.output) ? (
        <pre class="pane-tool-detail">
          {item.input}
          {item.input && item.output ? "\n──\n" : ""}
          {item.output}
        </pre>
      ) : null}
    </div>
  );
}

function ChatApp() {
  const [chat, setChat] = useState<PaneChat | null>(null);
  const [items, setItems] = useState<PaneItem[]>([]);
  const [more, setMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<"chat" | "review">(config.tab);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [text, setText] = useState("");
  const [askHow, setAskHow] = useState(false);
  const [info, setInfo] = useState<{ ok: boolean; message: string } | null>(null);
  const [answering, setAnswering] = useState(0);
  const [review, setReview] = useState<ReviewAnswer | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({});
  const [undoAsk, setUndoAsk] = useState("");
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitText, setCommitText] = useState("");
  const [commitEdited, setCommitEdited] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const m = event.data as PaneHostMessage | null;
      if (!m || typeof m !== "object") return;
      if (m.type === "chat") setChat(m.chat);
      else if (m.type === "conversation") {
        const a: Conversation = m.answer;
        if (!a.ok) setLoadError(a.message || "Can't read this chat");
        else if (!a.unchanged) {
          const el = list.current;
          follow.current = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          setLoadError("");
          setItems(a.items ?? []);
          setMore(!!a.more);
          setLoaded(true);
        }
      } else if (m.type === "review") {
        setReviewLoading(false);
        setReview(m.answer);
        setReviewError(m.error);
      } else if (m.type === "result") {
        if (m.kind.startsWith("tab:")) {
          setTab(m.kind.slice(4) as "chat" | "review");
          return;
        }
        if (m.kind === "draft") {
          setText(m.message);
          setAskHow(true);
          return;
        }
        if (m.kind === "answer") setAnswering((n) => Math.max(0, n - 1));
        if (m.kind === "send" && m.ask) {
          setAskHow(true);
          return;
        }
        if ((m.kind === "send" || m.kind === "later") && m.ok) {
          setText("");
          setAskHow(false);
        }
        if (m.kind === "commit" && m.ok) {
          setCommitOpen(false);
          setCommitEdited(false);
        }
        setInfo(m.message ? { ok: m.ok, message: m.message } : null);
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    if (config.tab === "review") {
      setReviewLoading(true);
      post({ type: "review" });
    }
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => setInfo(null), 12000);
    return () => clearTimeout(t);
  }, [info]);

  useEffect(() => {
    if (review && !commitEdited) setCommitText(review.message || "");
  }, [review]);

  // A new edit: compare again (while the tab shows the review)
  const editedAt = chat?.review?.editedAt ?? 0;
  useEffect(() => {
    if (tab === "review") {
      setReviewLoading(true);
      post({ type: "review" });
    }
  }, [tab, editedAt]);

  useLayoutEffect(() => {
    const el = list.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [items, chat?.activity]);

  const send = (how: "auto" | "background" | "copy", afterTurn: boolean) => {
    if (!text.trim()) return;
    post({ type: "send", text, how, afterTurn });
  };
  const answer = (decision: "allow" | "always" | "deny", note: string) => {
    setAnswering((n) => n + 1);
    post({ type: "answer", decision, note });
  };

  const terminal = chat?.route === "terminal" || askHow;
  const lastIndex = items.length - 1;
  const pending = chat?.permission ? "?" : chat?.busy ? "…" : "–";
  const sums = (review?.files ?? []).reduce((a, f) => [a[0] + (f.added ?? 0), a[1] + (f.removed ?? 0)], [0, 0]);
  const tests = testsText(chat?.review ?? (review ? { editedAt: review.editedAt, tests: review.tests } : null));
  const marked = !!chat && !chat.reviewPending && !!chat.review;

  return (
    <div class="pane">
      <div class="pane-head">
        <span class={`state-dot st-${chat?.state ?? "done"}`} aria-hidden="true" />
        <h2 class="pane-name">{chat?.name ?? ""}</h2>
        {chat?.host ? <Tag text={chat.host} title={`This chat runs on the SSH host ${chat.host}.`} /> : null}
        <span class={`pane-state${chat?.state === "waiting" ? " waiting" : ""}`}>{chat?.stateText ?? ""}</span>
        <button type="button" class="btn secondary small" title="The terminal or Claude Code tab the chat runs in; a chat that isn't open reopens." onClick={() => post({ type: "openWindow" })}>
          Open its window
        </button>
      </div>
      <div class="pane-folder muted small">{(chat?.host ? chat.host + ":" : "") + (chat?.cwd ?? "")}</div>
      <div class="pane-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "chat"} class={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>
          Chat
        </button>
        <button type="button" role="tab" aria-selected={tab === "review"} class={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>
          {chat?.changes ? `Review ±${chat.changes}${chat.reviewPending ? " •" : ""}` : "Review"}
        </button>
      </div>
      {info ? <div class={info.ok ? "pane-info" : "pane-info bad"}>{info.message}</div> : null}

      {tab === "chat" ? (
        <>
          <div class="pane-list" ref={list}>
            {more ? (
              <button type="button" class="btn secondary small pane-more" onClick={() => post({ type: "more" })}>
                Show earlier
              </button>
            ) : null}
            {!loaded || loadError ? <div class={`muted center${loadError ? " bad" : ""}`}>{loadError || "Reading the chat…"}</div> : null}
            {items.map((it, i) =>
              it.kind === "you" ? (
                <div key={it.key} class="pane-you">{it.text}</div>
              ) : it.kind === "claude" ? (
                <div key={it.key} class="pane-claude">
                  <Markdown text={it.text ?? ""} />
                </div>
              ) : it.kind === "tool" ? (
                <ToolLine
                  key={it.key}
                  item={it}
                  open={!!open[it.key]}
                  pending={i === lastIndex ? pending : "–"}
                  onToggle={() => setOpen({ ...open, [it.key]: !open[it.key] })}
                />
              ) : (
                <div key={it.key} class={`pane-note${it.error ? " bad" : ""}`}>— {it.text} —</div>
              ),
            )}
            {chat?.state === "working" ? (
              <div class="pane-activity muted">
                <span class="spinner" aria-hidden="true" /> {chat.activity || "working…"}
              </div>
            ) : null}
          </div>
          {chat?.permission ? <AskBox ask={chat.permission} onAnswer={answer} busy={answering > 0} /> : null}
          {chat?.queued ? (
            <div class="pane-queued">
              <span>Sent when this turn ends: {chat.queued.prompt}{chat.queued.error ? ` (${chat.queued.error})` : ""}</span>
              <button type="button" class="btn secondary small" onClick={() => post({ type: "unqueue" })}>Cancel</button>
            </div>
          ) : null}
          <textarea
            class="pane-reply"
            rows={3}
            placeholder={chat?.permission ? "It's asking you something: answer that first" : "Reply to Claude… (Ctrl+Enter sends)"}
            value={text}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send(terminal ? "background" : "auto", false);
              }
            }}
          />
          <div class="muted small">{chat ? routeHint(chat.route, chat.state !== "done" || !!chat.busy, "", chat.host) : ""}</div>
          <div class="pane-buttons">
            {terminal ? (
              <button type="button" class="btn secondary" disabled={!text.trim()} onClick={() => send("copy", false)}>
                Copy and open its terminal
              </button>
            ) : null}
            {chat?.busy ? (
              <button
                type="button"
                class="btn secondary"
                disabled={!text.trim()}
                title="Kept, and sent once Claude's turn is over."
                onClick={() => send(terminal ? "background" : "auto", true)}
              >
                Send when this turn ends
              </button>
            ) : null}
            <button
              type="button"
              class="btn"
              disabled={!text.trim() || (terminal && !!chat?.busy) || (!!chat?.permission && chat.route === "tmux")}
              onClick={() => send(terminal ? "background" : "auto", false)}
            >
              {terminal ? "Send, go on in the background" : "Send"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div class="pane-list">
            {!review ? (
              <div class={`muted${reviewError ? " bad" : ""}`}>
                {reviewLoading ? "Comparing its files with how they were before the chat…" : reviewError || "Nothing to review yet"}
              </div>
            ) : review.files.length === 0 ? (
              <div class="muted">No changed files: they're as they were before this chat.</div>
            ) : (
              <>
                <div class="review-head">
                  <strong>
                    {plural(review.files.length, "file")} changed since the chat started +{sums[0]} −{sums[1]}
                  </strong>
                  {tests ? <Tag text={tests.text} title={tests.title} active={tests.ok === true} warning={tests.ok === false} /> : null}
                </div>
                {review.files.map((f) => (
                  <div key={f.path} class="review-file">
                    <div class="review-line">
                      <button type="button" class="pane-tool-line" aria-expanded={!!openFiles[f.path]} onClick={() => setOpenFiles({ ...openFiles, [f.path]: !openFiles[f.path] })}>
                        <span class="pane-fold">{openFiles[f.path] ? "▾" : "▸"}</span>
                        <span class="pane-tool-text mono">
                          {f.label}
                          {f.created ? " (new)" : ""}
                          {f.deleted ? " (removed)" : ""}
                        </span>
                      </button>
                      {f.added !== null ? <span class="add mono">+{f.added}</span> : null}
                      {f.removed !== null ? <span class="del mono">−{f.removed}</span> : null}
                      {f.binary || f.unknown ? <span class="muted small">{f.unknown ? "no earlier version kept" : "binary"}</span> : null}
                      {config.local ? (
                        <button type="button" class="btn secondary small" title="In VS Code's diff editor" onClick={() => post({ type: "diff", path: f.path })}>
                          Diff
                        </button>
                      ) : null}
                      {!f.unknown ? (
                        <button type="button" class="btn secondary small" title="Asks first. Puts it back as it was before this chat." onClick={() => setUndoAsk(f.path)}>
                          Undo
                        </button>
                      ) : null}
                    </div>
                    {undoAsk === f.path ? (
                      <div class="confirm">
                        <span>{f.created ? `Remove ${f.label}? The chat made it.` : `Put ${f.label} back as it was before this chat? Later changes to it are lost too.`}</span>
                        <button type="button" class="btn small" onClick={() => { setUndoAsk(""); post({ type: "undo", path: f.path }); }}>Undo</button>
                        <button type="button" class="btn secondary small" onClick={() => setUndoAsk("")}>Cancel</button>
                      </div>
                    ) : null}
                    {openFiles[f.path] ? <Diff lines={f.diff} /> : null}
                  </div>
                ))}
              </>
            )}
            {commitOpen && review ? (
              <div class="commit-box">
                <div>
                  {review.repos.length
                    ? `Commit only these files in ${review.repos.join(", ")} (yours that aren't this chat's stay as they are):`
                    : "None of these files is in a git repository."}
                </div>
                <textarea
                  class="pane-reply mono"
                  rows={6}
                  value={commitText}
                  onInput={(e) => {
                    setCommitText((e.target as HTMLTextAreaElement).value);
                    setCommitEdited(true);
                  }}
                />
                <div class="pane-buttons">
                  <button type="button" class="btn secondary" onClick={() => setCommitOpen(false)}>Cancel</button>
                  <button type="button" class="btn" disabled={!commitText.trim() || !review.repos.length} onClick={() => post({ type: "commit", message: commitText })}>
                    Commit
                  </button>
                </div>
              </div>
            ) : null}
            {undoAsk === "*" ? (
              <div class="confirm">
                <span>Put all of them back as they were before this chat? Files it made are removed; later changes to them are lost too.</span>
                <button type="button" class="btn small" onClick={() => { setUndoAsk(""); post({ type: "undo", path: "*" }); }}>Undo all</button>
                <button type="button" class="btn secondary small" onClick={() => setUndoAsk("")}>Cancel</button>
              </div>
            ) : null}
          </div>
          <div class="pane-buttons">
            <button type="button" class="btn secondary" onClick={() => { setReviewLoading(true); post({ type: "review" }); }}>Compare again</button>
            <span class="spacer" />
            <button type="button" class="btn secondary" disabled={!review?.files.length} onClick={() => setUndoAsk("*")}>Undo all…</button>
            <button type="button" class="btn secondary" disabled={!review?.files.length || !review.repos.length} onClick={() => setCommitOpen(!commitOpen)}>
              Commit these files…
            </button>
            <button
              type="button"
              class="btn"
              title={marked ? "Click to mark it not reviewed." : "Its row stops saying “to review”, until it changes files again."}
              onClick={() => post({ type: "reviewed", on: !marked })}
            >
              {marked ? "Reviewed ✓" : "Mark reviewed"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function start(): void {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  render(<ChatApp />, root);
}

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start, { once: true });
