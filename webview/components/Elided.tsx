import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { elideMiddle, observeWidth, textMeasurer } from "../util/elide";

// A label cut in the middle when it doesn't fit. The full text stays in the
// layout (invisible) so the label's width never depends on its cut text.
export function Elided({ text, class: cls, title }: { text: string; class?: string; title?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // now, not on the observer's first call a frame later: no flash of the
    // end-cut text
    setWidth(el.getBoundingClientRect().width);
    return observeWidth(el, setWidth);
  }, []);

  // Cut again only when the text or the room changed: most polls change
  // neither, and measuring reads the element's styles
  const last = useRef({ text: "", width: 0, shown: "" });
  const el = ref.current;
  let shown = text;
  if (el && width > 0) {
    if (last.current.text !== text || last.current.width !== width)
      // a pixel of slack: layout widths are fractional, the observer's too
      last.current = { text, width, shown: elideMiddle(text, width - 1, textMeasurer(el)) };
    shown = last.current.shown;
  }
  return (
    <span ref={ref} class={"elided" + (cls ? " " + cls : "")} title={title ?? text}>
      <span class="elided-full" aria-hidden="true">
        {text}
      </span>
      <span class="elided-shown">{shown}</span>
    </span>
  );
}
