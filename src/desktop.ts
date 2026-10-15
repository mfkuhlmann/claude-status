// What the desktop can do for us. KWin (Plasma) and the Claude Status GNOME
// Shell extension (from the widget's repository) let jump.py bring another
// window to the front; GNOME keeps its sound theme in its own settings.
// The checks match jump.py's, so both sides take the same path.

import { runProcess } from "./backend";

function desktops(env: NodeJS.ProcessEnv): string[] {
  return (env.XDG_CURRENT_DESKTOP ?? "").split(":");
}

export function isKde(env: NodeJS.ProcessEnv = process.env): boolean {
  return desktops(env).includes("KDE");
}

// jump.py's on_gnome(): Ubuntu's session says "ubuntu:GNOME"
export function isGnome(env: NodeJS.ProcessEnv = process.env): boolean {
  const d = desktops(env);
  return d.includes("GNOME") && !d.includes("KDE");
}

// jump.py can raise the window a chat runs in (on GNOME: if the Claude Status
// GNOME Shell extension is on; jump.py says so when it isn't)
export function canRaiseWindows(env: NodeJS.ProcessEnv = process.env): boolean {
  return isKde(env) || isGnome(env);
}

// GNOME's sound theme, for notify_sound.py --theme (elsewhere it finds the
// theme by itself)
export async function gnomeSoundTheme(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (!isGnome(env)) return undefined;
  const r = await runProcess("gsettings", ["get", "org.gnome.desktop.sound", "theme-name"], { timeoutMs: 5000 });
  const m = /^'(.+)'$/.exec(r.stdout.trim());
  return m ? m[1] : undefined;
}
