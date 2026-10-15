import { resetText, usageLevel } from "../../src/shared/model";
import type { LimitWindow } from "../../src/shared/types";

// One plan limit: label, bar, percent, when it resets. Its four cells sit in
// the account's usage grid, so the bars of all windows line up.
export function UsageBar({ window: w, now }: { window: LimitWindow; now: number }) {
  const pct = Math.min(100, Math.max(0, w.pct));
  const reset = resetText(w, now);
  const title = `${w.label}: ${Math.round(w.pct)}% used` + (reset ? ` · ${reset}` : "");
  return (
    <>
      <span class="usage-label" title={title}>
        {w.label}
      </span>
      <span
        class={`meter usage-meter lvl-${usageLevel(w.pct)}`}
        role="meter"
        aria-label={`${w.label} plan usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        title={title}
      >
        <span style={{ width: `${pct}%` }} />
      </span>
      <span class="usage-pct">{Math.round(w.pct)}%</span>
      <span class="usage-reset" title={reset}>
        {reset}
      </span>
    </>
  );
}
