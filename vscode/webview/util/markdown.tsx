// Claude's replies, rendered: the Markdown it writes (headings, lists, code
// blocks, tables, quotes, bold, italics, strikethrough, inline code, links),
// made into elements here, never into HTML text, so nothing in a reply can
// run or load anything in the page. What isn't understood shows as written.
// A code block has its language and a Copy button (onCopy).

import type { ComponentChildren, JSX } from "preact";

const FENCE = /^(\s*)(```+|~~~+)\s*([^\s`]*)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const SAFE_LINK = /^(https?:|mailto:)/i;

// Inline Markdown: `code`, **bold**, *italics* / _italics_, [links](url)
export function inline(text: string, key = "i"): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  const pattern = /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)|~~(.+?)~~/g;
  let last = 0;
  let n = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>);
    else if (m[2] !== undefined || m[3] !== undefined) out.push(<strong key={k}>{inline(m[2] ?? m[3], k)}</strong>);
    else if (m[4] !== undefined || m[5] !== undefined) out.push(<em key={k}>{inline(m[4] ?? m[5], k)}</em>);
    else if (m[6] !== undefined) {
      const href = m[7];
      out.push(SAFE_LINK.test(href) ? <a key={k} href={href} title={href}>{inline(m[6], k)}</a> : <span key={k}>{inline(m[6], k)}</span>);
    } else if (m[8] !== undefined) out.push(<s key={k}>{inline(m[8], k)}</s>);
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

// Block Markdown: the reply as paragraphs, headings, lists, code blocks, …
export function Markdown({ text, onCopy }: { text: string; onCopy?: (code: string) => void }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: JSX.Element[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: { depth: number; text: string }[]; start: number } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "), `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const l = list;
    const items = l.items.map((it, i) => (
      <li key={i} style={it.depth ? { marginLeft: `${it.depth * 1.2}em` } : undefined}>
        {inline(it.text, `l${blocks.length}-${i}`)}
      </li>
    ));
    blocks.push(l.ordered ? <ol key={`l${blocks.length}`} start={l.start}>{items}</ol> : <ul key={`l${blocks.length}`}>{items}</ul>);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flushPara();
      flushList();
      const body: string[] = [];
      for (i++; i < lines.length && !(lines[i].trim().startsWith(fence[2]) && !lines[i].trim().replace(/[`~]/g, "")); i++) body.push(lines[i]);
      const code = body.join("\n");
      blocks.push(
        <div key={`c${blocks.length}`} class="md-codeblock">
          <div class="md-code-head">
            <span>{fence[3]}</span>
            {onCopy ? (
              <button type="button" class="md-copy" title="Copy this code" onClick={() => onCopy(code)}>
                Copy
              </button>
            ) : null}
          </div>
          <pre class="md-code">
            <code>{code}</code>
          </pre>
        </div>,
      );
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      flushList();
      const level = Math.min(6, heading[1].length + 2); // (smaller than the tab's own heading)
      const H = `h${level}` as "h3";
      blocks.push(<H key={`h${blocks.length}`} class={`md-heading md-h${heading[1].length}`}>{inline(heading[2], `h${blocks.length}`)}</H>);
      continue;
    }
    if (RULE.test(line) && !para.length) {
      flushList();
      blocks.push(<hr key={`r${blocks.length}`} />);
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      flushPara();
      flushList();
      const head = cells(line);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) rows.push(cells(lines[i]));
      i--;
      const t = blocks.length;
      blocks.push(
        <div key={`t${t}`} class="md-table">
          <table>
            <thead>
              <tr>{head.map((c, j) => <th key={j}>{inline(c, `t${t}h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c, `t${t}r${k}c${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      flushPara();
      flushList();
      const body = [quote[1]];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1])) body.push(QUOTE.exec(lines[++i])![1]);
      blocks.push(<blockquote key={`q${blocks.length}`}>{inline(body.join(" "), `q${blocks.length}`)}</blockquote>);
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushPara();
      const m = (bullet ?? numbered)!;
      const ordered = !!numbered;
      if (list && list.ordered !== ordered && Math.floor(m[1].length / 2) === 0) flushList();
      if (!list) list = { ordered, items: [], start: numbered ? Number(numbered[2]) : 1 };
      list.items.push({ depth: Math.floor(m[1].replace(/\t/g, "  ").length / 2), text: m[3] });
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // (a list item that goes on on the next line)
      list.items[list.items.length - 1].text += " " + line.trim();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return <div class="md">{blocks}</div>;
}
