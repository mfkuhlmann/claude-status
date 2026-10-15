// Claude's ✳ glyph from rounded bars, so it stays crisp and takes the state's
// color. It spins in steps (~8 fps) like the widget's: cheap for hours.
export function SparkIcon({ state, spinning }: { state: string; spinning: boolean }) {
  return (
    <svg
      class={`spark ov-${state}` + (spinning ? " spinning" : "")}
      viewBox="-12 -12 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      {[0, 45, 90, 135].map((angle) => (
        <line key={angle} x1="-9.5" y1="0" x2="9.5" y2="0" transform={`rotate(${angle})`} />
      ))}
    </svg>
  );
}
