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

  const el = ref.current;
  // a pixel of slack: layout widths are fractional, the observer's too
  const shown = el && width > 0 ? elideMiddle(text, width - 1, textMeasurer(el)) : text;
  return (
    <span ref={ref} class={"elided" + (cls ? " " + cls : "")} title={title ?? text}>
      <span class="elided-full" aria-hidden="true">
        {text}
      </span>
      <span class="elided-shown">{shown}</span>
    </span>
  );
}
