// Types for talpa.mjs, for the VS Code extension's webview (TypeScript)

export interface TalpaColors {
    skin: string;
    shade: string;
}

export interface TalpaTheme {
    fx: string;    // particles, z's, notes
    text: string;  // the words it says
}

export const BOX: number;
export const FLOOR: number;
export const TOP: number;
export const LILAC: TalpaColors;
export function calmColors(tint: string): TalpaColors;
export function drawHole(ctx: unknown, hole: number): void;   // an empty hole in the 64 × 64 box (hole: 0 to 1.1, as it opens or closes)

export class Talpa {
    constructor(opts?: { colors?: TalpaColors; theme?: TalpaTheme; words?: (s: string) => string; travels?: boolean; brain?: boolean });
    onTravel: ((ms: number) => void) | null;
    facingLeft: boolean;
    travels: boolean;
    readonly busy: boolean;
    readonly frameMs: number;   // how often a picture is worth drawing now: 40 (quick moves), 80 (slow) or 200 (at rest)
    readonly run: unknown;
    setColors(colors: TalpaColors): void;
    setTheme(theme: TalpaTheme): void;
    setMood(mood: string): void;
    react(name: string, done?: ((ok: boolean) => void) | null): void;
    setHeld(held: boolean): number;   // how much of its hole it leaves behind (0 to 1): draw that where it was, drawHole
    land(height: number, done?: ((ok: boolean) => void) | null): "sick" | "dizzy" | "fine";   // height in box units
    pose(step?: Record<string, unknown>): void;
    tick(now: number): void;
    draw(ctx: unknown): void;
    // a picture instead of every frame: what it shows ("pose#details": fade over to a new pose), and the picture
    stillKey(): string;
    drawStill(ctx: unknown): void;
}
