// A pet's pose: the vendored SVG (vendor/pets/clawd-<pose>.svg) in a shadow
// root. The poses animate with CSS @keyframes in their own <style>, all with
// the same class and keyframe names: each pet gets its own shadow root so they
// don't collide, and its own animation timeline (a pose starts from its first
// frame when he switches to it). Browsers play these natively; the widget
// needed baked origins and fake breathing because Qt's renderer couldn't.

import { petsBase } from "../env";

export const FALLBACK_POSE = "idle-living";

interface PoseArt {
  svg: SVGSVGElement; // parsed once, cloned for every pet that wears it
  sheet: CSSStyleSheet; // the pose's <style>, shared by those pets
}

const poses = new Map<string, Promise<PoseArt | null>>();

function sheet(css: string): CSSStyleSheet {
  const s = new CSSStyleSheet();
  s.replaceSync(css);
  return s;
}

// The SVGs say width/height 500: fill the pet's box instead. Overflow shows
// what a pose draws outside its viewBox (the stage clips).
const baseSheet = sheet(
  ":host{display:block;width:100%;height:100%;pointer-events:none}" +
    "svg{display:block;width:100%;height:100%;overflow:visible}",
);
// A hidden stage: nothing animates (and nothing repaints)
const pausedSheet = sheet("*{animation-play-state:paused!important}");

// The <style> blocks and style="" attributes go into a constructed stylesheet:
// adopted sheets aren't inline styles, so a strict webview CSP can't block them.
function parse(text: string): PoseArt | null {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (root.localName !== "svg" || doc.querySelector("parsererror")) return null;
  for (const el of Array.from(root.querySelectorAll("script, foreignObject"))) el.remove();
  let css = "";
  for (const style of Array.from(root.querySelectorAll("style"))) {
    css += (style.textContent ?? "") + "\n";
    style.remove();
  }
  let n = 0;
  for (const el of Array.from(root.querySelectorAll("[style]"))) {
    const id = String(n++);
    css += `[data-cs-style="${id}"]{${el.getAttribute("style")}}\n`;
    el.setAttribute("data-cs-style", id);
    el.removeAttribute("style");
  }
  root.removeAttribute("width");
  root.removeAttribute("height");
  try {
    return { svg: document.importNode(root, true) as unknown as SVGSVGElement, sheet: sheet(css) };
  } catch {
    return null;
  }
}

function load(pose: string): Promise<PoseArt | null> {
  let art = poses.get(pose);
  if (!art) {
    art = fetch(`${petsBase}/clawd-${pose}.svg`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${r.status}`))))
      .then(parse)
      .catch(() => null);
    poses.set(pose, art);
  }
  return art;
}

export class PetArt {
  readonly el: HTMLElement;
  private readonly shadow: ShadowRoot;
  private poseSheet: CSSStyleSheet | null = null;
  private playing = true;
  private disposed = false;
  wanted = ""; // the pose asked for (shown once loaded; the old one stays until then)

  constructor() {
    this.el = document.createElement("div");
    this.el.className = "cs-pet-art";
    this.shadow = this.el.attachShadow({ mode: "open" });
    this.applySheets();
  }

  setPose(pose: string): void {
    if (pose === this.wanted) return;
    this.wanted = pose;
    void load(pose)
      .then((art) => art ?? load(FALLBACK_POSE)) // a missing pose: just Clawd
      .then((art) => {
        if (!art || this.disposed || this.wanted !== pose) return;
        this.shadow.replaceChildren(art.svg.cloneNode(true));
        this.poseSheet = art.sheet;
        this.applySheets();
      });
  }

  setPlaying(playing: boolean): void {
    if (playing === this.playing) return;
    this.playing = playing;
    this.applySheets();
  }

  dispose(): void {
    this.disposed = true;
    this.shadow.replaceChildren();
  }

  private applySheets(): void {
    const sheets = [baseSheet];
    if (this.poseSheet) sheets.push(this.poseSheet);
    if (!this.playing) sheets.push(pausedSheet);
    this.shadow.adoptedStyleSheets = sheets;
  }
}
