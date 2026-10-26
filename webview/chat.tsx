// The chat tab's page (src/chatPane.ts): a chat's conversation as it goes,
// drawn the way Claude's terminal draws it (a dot before each reply and tool
// call, a tool call's outcome under it, your prompts set off), a box to
// reply, what it asks while it waits for a permission, and its review. It
// shows what the extension sends and says what you clicked.

import { render } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { picturesIn, PICTURE_TYPES, routeHint, testsText, TEXT_SCALES, withoutPicture, type Conversation, type PaneChat, type PaneHostMessage, type PaneItem, type PaneMessage, type ReviewAnswer } from "../src/shared/pane";
import { AskBox, Diff } from "./components/AskBox";
import type { Answers, Decision } from "../src/shared/types";
import { Tag } from "./components/Tag";
import { Markdown } from "./util/markdown";

declare global {
  interface Window {
    CLAUDE_CHAT: { tab: "chat" | "review"; local: boolean; scale?: number };
  }
}

const api = acquireVsCodeApi();
const post = (m: PaneMessage) => api.postMessage(m);
const config = window.CLAUDE_CHAT;

function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Claude's spinner, as in its terminal
const SPIN = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

function Spinner() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), 120);
    return () => clearInterval(t);
  }, []);
  return <span class="pane-spin" aria-hidden="true">{SPIN[n % SPIN.length]}</span>;
}

// A tool call: ● Bash(npm test) in green, red, or (still going) blinking, and
// under it ⎿ what came of it; click for what it ran and got
function ToolLine({ item, open, onToggle, asking, going, gap }: { item: PaneItem; open: boolean; onToggle: () => void; asking: boolean; going: boolean; gap: string }) {
  const name = item.name ?? "";
  const line = item.line ?? "";
  const args = name && line.startsWith(name + ": ") ? line.slice(name.length + 2) : "";
  const tone = item.status === "ok" ? "ok" : item.status === "error" ? "error" : asking ? "asking" : going ? "going" : "open";
  const summary = item.summary || (asking ? "Waiting for your answer" : "");
  return (
    <div class={`pane-item pane-tool ${tone} ${gap}`}>
      <button type="button" class="pane-tool-line" aria-expanded={open} title="Click for what it ran and what came back" onClick={onToggle}>
        <span class="pane-gutter" aria-hidden="true">
          <span class="pane-dot" />
        </span>
        <span class="pane-tool-body">
          <span class="pane-tool-call">
            <strong>{args ? name : line}</strong>
            {args ? (
              <span class="pane-tool-args">
                <span class="paren">(</span>
                {args}
                <span class="paren">)</span>
              </span>
            ) : null}
          </span>
          {summary ? <span class="pane-tool-summary">⎿&nbsp;&nbsp;{summary}</span> : null}
        </span>
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

// More room before your prompt (a new turn) than between the steps of a turn
function gapOf(kind: PaneItem["kind"], prev: PaneItem["kind"] | undefined): string {
  if (!prev) return "first";
  if (kind === "you") return "turn";
  return kind === "tool" && prev === "tool" ? "close" : "";
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
  const [scale, setScale] = useState(config.scale ?? 1.15);
  const list = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const reply = useRef<HTMLTextAreaElement>(null);

  // Pictures pasted into the reply: saved by the extension (an SSH host's chat
  // gets a copy there once you say so), then named in it as [Image: path]
  const [thumbs, setThumbs] = useState<Record<string, string>>({}); // path -> the picture, to show
  const [offer, setOffer] = useState<{ id: string; mime: string; data: string; url: string; at: number } | null>(null);
  const [saving, setSaving] = useState(0);
  const pending = useRef<Record<string, { at: number; url: string }>>({});
  const pasted = (e: ClipboardEvent) => {
    const items = [...(e.clipboardData?.items ?? [])];
    const file = items.find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
    if (!file || e.clipboardData?.getData("text/plain")) return; // (text pastes as text)
    e.preventDefault();
    if (!PICTURE_TYPES.includes(file.type)) {
      setInfo({ ok: false, message: "Claude takes PNG, JPEG, WebP and GIF pictures" });
      return;
    }
    const at = reply.current?.selectionStart ?? text.length;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const picture = { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, mime: file.type, data: url.slice(url.indexOf(",") + 1), url, at };
      if (chat?.host) setOffer(picture);
      else savePicture(picture);
    };
    reader.readAsDataURL(file);
  };
  const savePicture = (p: { id: string; mime: string; data: string; url: string; at: number }) => {
    pending.current[p.id] = { at: p.at, url: p.url };
    setSaving((n) => n + 1);
    post({ type: "picture", id: p.id, mime: p.mime, data: p.data });
  };

  // A− / A+ and Ctrl+wheel: the text size, kept in claudeStatus.chatTextScale
  const zoom = (step: number) => {
    const i = TEXT_SCALES.findIndex((v) => v >= scale - 0.001);
    const at = i < 0 ? TEXT_SCALES.length - 1 : i;
    const next = TEXT_SCALES[Math.max(0, Math.min(TEXT_SCALES.length - 1, at + step))];
    setScale(next);
    post({ type: "textSize", scale: next });
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const m = event.data as PaneHostMessage | null;
      if (!m || typeof m !== "object") return;
      if (m.type === "chat") setChat(m.chat);
      else if (m.type === "textSize") setScale(m.scale);
      else if (m.type === "picture") {
        const p = pending.current[m.id];
        delete pending.current[m.id];
        setSaving((n) => Math.max(0, n - 1));
        if (!m.path) setInfo({ ok: false, message: m.error || "Couldn't save the picture" });
        else if (p) {
          setThumbs((t) => ({ ...t, [m.path]: p.url }));
          setText((t) => {
            const at = Math.min(p.at, t.length);
            return t.slice(0, at) + (at > 0 && t.charAt(at - 1).trim() ? " " : "") + `[Image: ${m.path}] ` + t.slice(at);
          });
          reply.current?.focus();
        }
      }
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
  const answer = (decision: Decision, note: string, answers?: Answers) => {
    setAnswering((n) => n + 1);
    post({ type: "answer", decision, note, answers });
  };

  const terminal = chat?.route === "terminal" || askHow;
  const lastIndex = items.length - 1;
  const last = items[lastIndex];
  const activity = (chat?.activity ?? "").replace(/[….\s]+$/, "");
  const sums = (review?.files ?? []).reduce((a, f) => [a[0] + (f.added ?? 0), a[1] + (f.removed ?? 0)], [0, 0]);
  const tests = testsText(chat?.review ?? (review ? { editedAt: review.editedAt, tests: review.tests } : null));
  const marked = !!chat && !chat.reviewPending && !!chat.review;

  return (
    <div class="pane" style={{ "--pane-scale": String(scale) }}>
      <div class="pane-head">
        <span class={`state-dot st-${chat?.state ?? "done"}`} aria-hidden="true" />
        <h2 class="pane-name">{chat?.name ?? ""}</h2>
        {chat?.host ? <Tag text={chat.host} title={`This chat runs on the SSH host ${chat.host}.`} /> : null}
        <span class={`pane-state st-${chat?.state ?? "done"}`}>{chat?.stateText ?? ""}</span>
        <span class="pane-sizes">
          <button type="button" class="pane-size" title="Smaller text (Ctrl+wheel)" disabled={scale <= TEXT_SCALES[0] + 0.001} onClick={() => zoom(-1)}>
            A−
          </button>
          <button type="button" class="pane-size big" title="Larger text (Ctrl+wheel)" disabled={scale >= TEXT_SCALES[TEXT_SCALES.length - 1] - 0.001} onClick={() => zoom(1)}>
            A+
          </button>
        </span>
        {chat?.canMove ? (
          <button
            type="button"
            class="btn secondary small"
            title="Go on with it in a Claude Code tab: Claude quits in its terminal (the terminal stays open) and the chat reopens in a Claude Code tab. Asks first; a chat that's working or waiting for you is stopped only once you say so."
            onClick={() => post({ type: "moveToClaudeCode" })}
          >
            Move to Claude Code
          </button>
        ) : null}
        <button
          type="button"
          class="btn secondary small"
          title="The terminal or Claude Code tab the chat runs in; a chat that isn't open reopens, in a terminal or a Claude Code tab as the switch of Recent chats says."
          onClick={() => post({ type: "openWindow" })}
        >
          Open its window
        </button>
      </div>
      <div class="pane-folder">{(chat?.host ? chat.host + ":" : "") + (chat?.cwd ?? "")}</div>
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
          <div
            class="pane-list"
            ref={list}
            onWheel={(e) => {
              if (!e.ctrlKey) return;
              e.preventDefault();
              zoom(e.deltaY < 0 ? 1 : -1);
            }}
          >
            {more ? (
              <button type="button" class="btn secondary small pane-more" onClick={() => post({ type: "more" })}>
                Show earlier
              </button>
            ) : null}
            {!loaded || loadError ? <div class={`muted center${loadError ? " bad" : ""}`}>{loadError || "Reading the chat…"}</div> : null}
            {items.map((it, i) => {
              const gap = gapOf(it.kind, items[i - 1]?.kind);
              return it.kind === "you" ? (
                <div key={it.key} class={`pane-item pane-you ${gap}`}>
                  <span class="pane-gutter" aria-hidden="true">›</span>
                  <div class="pane-you-text">{it.text}</div>
                </div>
              ) : it.kind === "claude" ? (
                <div key={it.key} class={`pane-item pane-claude ${gap}`}>
                  <span class="pane-gutter" aria-hidden="true">
                    <span class="pane-dot" />
                  </span>
                  <div class="pane-body">
                    <Markdown text={it.text ?? ""} onCopy={(code) => post({ type: "copy", text: code })} />
                  </div>
                </div>
              ) : it.kind === "tool" ? (
                <ToolLine
                  key={it.key}
                  item={it}
                  gap={gap}
                  open={!!open[it.key]}
                  asking={!!chat?.permission && i === lastIndex && it.status === "open"}
                  going={!!chat?.busy && it.status === "open"}
                  onToggle={() => setOpen({ ...open, [it.key]: !open[it.key] })}
                />
              ) : (
                <div key={it.key} class={`pane-item pane-note${it.error ? " bad" : ""} ${gap}`}>
                  <span>{it.text}</span>
                </div>
              );
            })}
            {chat?.state === "working" ? (
              <div class="pane-item pane-working">
                <span class="pane-gutter">
                  <Spinner />
                </span>
                <span>{activity && !(last?.kind === "tool" && last.status === "open") ? activity : "Working"}…</span>
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
          <div class="pane-replybox">
          <span class="pane-prompt" aria-hidden="true">›</span>
          <textarea
            class="pane-reply"
            rows={3}
            ref={reply}
            placeholder={chat?.permission ? "It's asking you something: answer that first" : "Reply to Claude… (Enter sends, Shift+Enter: new line, Ctrl+V: a picture too)"}
            value={text}
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            onPaste={pasted}
            onKeyDown={(e) => {
              // Enter sends, as in Claude's own prompt (Shift+Enter: a new line). For a
              // terminal that takes no text from outside, the first Enter asks how.
              if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                send(askHow ? "background" : "auto", false);
              }
            }}
          />
          </div>
          {picturesIn(text).length ? (
            <div class="pane-pictures">
              {picturesIn(text).map((path) => (
                <span key={path} class="pane-picture" title={`A picture for Claude\n${chat?.host ? `${path}, on ${chat.host}` : path}`}>
                  {thumbs[path] ? <img src={thumbs[path]} alt="" /> : <span class="pane-picture-name">{path.split("/").pop()}</span>}
                  <button type="button" class="pane-picture-x" title="Take it out of your reply" onClick={() => setText((t) => withoutPicture(t, path))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {offer ? (
            <div class="confirm pane-offer">
              <img src={offer.url} alt="" />
              <span>Copy this picture to {chat?.host}? Claude there can only open it there.</span>
              <button type="button" class="btn small" onClick={() => { savePicture(offer); setOffer(null); }}>Copy</button>
              <button type="button" class="btn secondary small" onClick={() => setOffer(null)}>Cancel</button>
            </div>
          ) : null}
          {saving ? <div class="pane-hint">{chat?.host ? `Copying the picture to ${chat.host}…` : "Saving the picture…"}</div> : null}
          <div class="pane-hint">{chat ? routeHint(chat.route, chat.state !== "done" || !!chat.busy, "", chat.host) : ""}</div>
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
