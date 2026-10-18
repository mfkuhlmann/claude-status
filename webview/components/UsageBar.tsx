import { forecastTitle, forecastWarning, resetText, usageLevel } from "../../src/shared/model";
import type { LimitWindow } from "../../src/shared/types";

// One plan limit: label, bar, percent, when it resets. Its four cells sit in
// the account's usage grid, so the bars of all windows line up. The bar also
// shows where your pace leads by the reset (lighter) and where an even pace
// would be by now (a tick); a line under it warns when it runs out first.
export function UsageBar({ window: w, now }: { window: LimitWindow; now: number }) {
  const pct = Math.min(100, Math.max(0, w.pct));
  const reset = resetText(w, now);
  const f = w.reset ? null : (w.forecast ?? null);
  const ahead = f ? Math.min(100, Math.max(pct, f.atReset)) : pct;
  const warning = forecastWarning(w, now);
  const title = [`${w.label}: ${Math.round(w.pct)}% used` + (reset ? ` · ${reset}` : ""), forecastTitle(w, now)]
    .filter(Boolean)
    .join("\n");
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
        {f && ahead > pct ? (
          <span class={`meter-ahead lvl-${usageLevel(f.atReset)}`} style={{ left: `${pct}%`, width: `${ahead - pct}%` }} />
        ) : null}
        {f ? <span class="meter-even" style={{ left: `${Math.min(100, Math.max(0, f.evenPct))}%` }} /> : null}
      </span>
      <span class="usage-pct">{Math.round(w.pct)}%</span>
      <span class="usage-reset" title={reset}>
        {reset}
      </span>
      {warning ? (
        <span class="usage-warning" title={forecastTitle(w, now)}>
          {warning}
        </span>
      ) : null}
    </>
  );
}
