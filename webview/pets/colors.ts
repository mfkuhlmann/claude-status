// Chat pets' colors. Each stage publishes the colors of its pets (by pet key)
// so the list can draw a bar in the same color next to each chat's row
// (main.qml setPetColors / petColors, PetStrip.qml freeColor).

// Colors that stay apart from each other on light and dark themes
export const PALETTE = ["#e5534b", "#e8913a", "#c9a227", "#4caf50", "#26a69a", "#42a5f5", "#7e57c2", "#ec407a"];

const byStage = new Map<string, Record<string, string>>();
let merged: Record<string, string> | null = null;
const listeners = new Set<() => void>();
let notifying = false;

export function allPetColors(): Record<string, string> {
  if (!merged) {
    merged = {};
    for (const colors of byStage.values()) Object.assign(merged, colors);
  }
  return merged;
}

export function petColor(key: string): string {
  return allPetColors()[key] ?? "";
}

export function setPetColors(stage: string, colors: Record<string, string>): void {
  if (JSON.stringify(byStage.get(stage) ?? {}) === JSON.stringify(colors)) return; // unchanged: don't make every row look again
  if (Object.keys(colors).length) byStage.set(stage, colors);
  else byStage.delete(stage);
  merged = null;
  // Once per task, after the stages are done updating
  if (notifying) return;
  notifying = true;
  queueMicrotask(() => {
    notifying = false;
    for (const fn of [...listeners]) fn();
  });
}

export function onColorsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// A color for a chat: its own (from its key) unless another pet wears it,
// here or, while there are colors left, on another account's stage
export function freeColor(key: string, here: Set<number>): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const anywhere = new Set(Object.values(allPetColors()).map((c) => PALETTE.indexOf(c)));
  for (const used of [new Set([...here, ...anywhere]), here]) {
    let c = h % PALETTE.length;
    for (let n = 0; n < PALETTE.length; n++, c = (c + 1) % PALETTE.length) if (!used.has(c)) return c;
  }
  return h % PALETTE.length;
}

// Black or white text on a pet's color, by its brightness
export function textOn(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 255,
    g = (v >> 8) & 255,
    b = v & 255;
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255 < 0.6 ? "white" : "black";
}
