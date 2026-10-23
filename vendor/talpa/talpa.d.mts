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
    setHeld(held: boolean): void;
    land(height: number, done?: ((ok: boolean) => void) | null): void;
    pose(step?: Record<string, unknown>): void;
    tick(now: number): void;
    draw(ctx: unknown): void;
}
