// Middle elision ("~/projects/…/webapp"): CSS can only cut the end, and the
// end of a path is the part that tells folders apart.

// Keep this much of the kept text from the start, the rest from the end
const HEAD_SHARE = 0.4;

function cut(text: string, keep: number): string {
  const head = Math.floor(keep * HEAD_SHARE);
  return text.slice(0, head) + "…" + text.slice(text.length - (keep - head));
}

export function elideMiddle(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (maxWidth <= 0 || measure(text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(cut(text, mid)) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return cut(text, lo);
}

let canvas: CanvasRenderingContext2D | null = null;

// Measures text in the element's own font
export function textMeasurer(el: Element): (s: string) => number {
  canvas ??= document.createElement("canvas").getContext("2d");
  const ctx = canvas;
  if (!ctx) return (s) => s.length * 7;
  const cs = getComputedStyle(el);
  // the shorthand isn't always serialized (Firefox), so build it
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  return (s) => ctx.measureText(s).width;
}

// One ResizeObserver for every elided label: there's one per row
const watchers = new Map<Element, (width: number) => void>();
let observer: ResizeObserver | null = null;

export function observeWidth(el: Element, onWidth: (width: number) => void): () => void {
  observer ??= new ResizeObserver((entries) => {
    for (const e of entries) watchers.get(e.target)?.(e.contentRect.width);
  });
  watchers.set(el, onWidth);
  observer.observe(el);
  return () => {
    watchers.delete(el);
    observer?.unobserve(el);
  };
}
