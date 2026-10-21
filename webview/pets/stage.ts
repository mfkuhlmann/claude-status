// A stage where pets (pet.ts) live, ported from the widget's PetStrip.qml.
// Two kinds:
//
// hero: the big Clawd at the top of the view, on a little stage whose light
// follows the whole dashboard (warm when a chat needs you, blue while chats
// work, green when they wait for your next message, a starry night once
// everything is done), with a headline and the session counts beside him.
//
// an account's stage: one pet per chat of that account in the list, up to a
// few. A pet wears the chat's name on a tag in the chat's color (the chat's
// row gets a bar in the same color), acts the chat out, opens it when
// clicked, and stays the same pet, on the same spot, until the chat leaves the
// list; then it waves and walks off.
//
// Everything stops while a stage isn't shown: no animation frame, no timer,
// paused CSS animations.

import { editorTab, isDark } from "../env";
import { plural } from "../../src/shared/model";
import type { AccountInput, HeroInput, PetStage, StageCallbacks, StageChat } from "./api";
import type { ChatRef, Counts } from "../../src/shared/types";
import { PALETTE, allPetColors, freeColor, setPetColors } from "./colors";
import { Clock, Timer, Tween, cssEase, reducedMotion, type Animator } from "./motion";
import { Pet, SMALL } from "./pet";

export const allStages = new Set<Stage>();

const world = {
  dark: isDark(),
  shownOnce: false, // pets have been on screen: from now on newcomers walk in
};

export function setDarkAll(dark: boolean): void {
  world.dark = dark;
  for (const s of allStages) s.root.classList.toggle("cs-dark", dark);
}

function pageVisible(): boolean {
  return document.visibilityState !== "hidden";
}

document.addEventListener("visibilitychange", () => {
  for (const s of allStages) s.applyLive();
});

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  parent?.append(e);
  return e;
}

// The starry night: where the stars twinkle (fractions of the stage)
const STAR_SPOTS = [[0.55, 0.14], [0.64, 0.36], [0.71, 0.1], [0.8, 0.3], [0.88, 0.12], [0.94, 0.4], [0.6, 0.56],
  [0.97, 0.66], [0.5, 0.42]];

// The hero's light: what the whole dashboard is up to
function lightOf(mood: string): string {
  return mood === "waving" ? "waiting"
    : mood.startsWith("working") ? "working"
    : mood === "idle-living" ? "idle"
    : mood === "error" ? "error"
    : "night";
}

export class Stage implements PetStage, Animator {
  readonly hero: boolean;
  readonly colorKey: string; // names this stage's colors in the shared registry
  readonly clock = new Clock();
  readonly root: HTMLDivElement;
  readonly petLayer: HTMLDivElement;
  private readonly fxLayer: HTMLDivElement;
  private readonly bubbleEl: HTMLDivElement;
  private readonly floorEl: HTMLDivElement | null = null;
  private readonly moreEl: HTMLDivElement | null = null;
  private readonly starsEl: HTMLDivElement | null = null;
  private readonly stars: HTMLSpanElement[] = [];
  private readonly headlineEl: HTMLDivElement | null = null;
  private readonly countsEl: HTMLDivElement | null = null;
  private readonly textEl: HTMLDivElement | null = null;
  private readonly cb: StageCallbacks;

  // All pets share the viewBox -15 -25 45 45: the character is the middle
  // third of the image, ~11 of its 45 units tall
  readonly gu: number;
  readonly imageSize: number;
  readonly bodyWidth: number;
  readonly bodyHeight: number;
  private readonly tagHeight: number;
  private readonly margin: number;
  width = 0;
  height = 0;
  tagWidth = 0;

  live = false;
  hovering = false;
  heroInput: HeroInput | null = null;
  pets: Pet[] = []; // in the order they came (later ones in front)
  private chats: StageChat[] = [];
  private maxPets = 0;
  private order: string[] = []; // the shown chats' keys, in the order their pets came
  private readonly slots = new Map<string, number>(); // pet key → where it stands; a leaving pet keeps its spot

  private wantLive = true; // what the UI says (setLive)
  private onScreen = false; // what the IntersectionObserver says
  private hiddenSince = 0;
  private everLive = false;
  private destroyed = false;
  private frame = 0;
  private renderQueued = false;
  private readonly tweens = new Set<Tween>();
  private readonly waapi = new Set<Animation>(); // particles: paused with the stage
  private starAnims: Animation[] = [];
  private hoverClientX = -1;
  private bubbleOwner: Pet | null = null;
  private bubbleSize = { w: 0, h: 0 };
  private bubbleAt = "";
  private readonly bubbleTimer: Timer;
  private readonly firstShownTimer: Timer;
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private drawn: Record<string, string> = {};

  constructor(container: HTMLElement, hero: boolean, colorKey: string, cb: StageCallbacks) {
    this.hero = hero;
    this.colorKey = colorKey;
    this.cb = cb;
    this.root = el("div", `cs-stage ${hero ? "cs-stage--hero" : "cs-stage--account"}`);
    this.root.classList.toggle("cs-dark", world.dark);
    this.root.classList.toggle("cs-in-editor", editorTab);
    this.root.classList.add("cs-paused");
    container.append(this.root);

    const gu = parseFloat(getComputedStyle(this.root).getPropertyValue("--cs-gu"));
    this.gu = gu > 0 ? gu : 16;
    this.imageSize = this.gu * (hero ? 10 : 6.2);
    this.bodyWidth = this.imageSize / 3;
    this.bodyHeight = (this.imageSize * 11) / 45;
    this.tagHeight = this.gu * 1.05;
    this.margin = this.bodyWidth * 0.8;
    this.tagWidth = this.gu * 3.5;

    if (hero) {
      el("div", "cs-stage-light", this.root); // a soft card lit in the dashboard's mood
      this.starsEl = el("div", "cs-stage-stars", this.root);
      this.starsEl.setAttribute("aria-hidden", "true");
      this.starsEl.hidden = true;
      STAR_SPOTS.forEach(([x, y], i) => {
        const star = el("span", "cs-star", this.starsEl!);
        star.textContent = i % 3 === 0 ? "✦" : "·";
        star.style.left = `${x * 100}%`;
        star.style.top = `${y * 100}%`;
        star.style.fontSize = `${this.gu * (i % 3 === 0 ? 0.6 : 1)}px`;
        this.stars.push(star);
      });
      // The headline (what needs you, what works) and the session counts,
      // left of where he stands
      this.textEl = el("div", "cs-hero-text", this.root);
      this.headlineEl = el("div", "cs-hero-headline", this.textEl);
      this.headlineEl.addEventListener("click", () => this.openCalling());
      this.headlineEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.openCalling();
        }
      });
      this.countsEl = el("div", "cs-hero-counts", this.textEl);
    } else {
      // An account's floor; the stage itself is barely there, just a place to stand
      this.floorEl = el("div", "cs-stage-floor", this.root);
      this.moreEl = el("div", "cs-stage-more", this.root);
      this.moreEl.hidden = true;
    }
    this.petLayer = el("div", "cs-stage-pets", this.root);
    this.petLayer.setAttribute("aria-hidden", "true");
    this.fxLayer = el("div", "cs-stage-fx", this.root);
    this.fxLayer.setAttribute("aria-hidden", "true");
    this.bubbleEl = el("div", "cs-bubble", this.root);
    this.bubbleEl.hidden = true;

    this.bubbleTimer = new Timer(this.clock, 4500, () => {
      this.bubbleOwner = null;
      this.bubbleEl.hidden = true;
    });
    // Shown and laid out: from now on pets walk where they go
    this.firstShownTimer = new Timer(this.clock, 500, () => (world.shownOnce = true));

    this.root.addEventListener("pointerenter", (e) => this.hover(e.clientX));
    this.root.addEventListener("pointermove", (e) => this.hover(e.clientX));
    this.root.addEventListener("pointerleave", () => this.hover(-1));

    this.resizeObserver = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1].contentRect;
      this.resized(r.width, r.height);
    });
    this.resizeObserver.observe(this.root);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.onScreen = entries[entries.length - 1].isIntersecting;
      this.applyLive();
    });
    this.intersectionObserver.observe(this.root);
    allStages.add(this);
  }

  // ------------------------------------------------------------ PetStage

  update(input: HeroInput | AccountInput): void {
    if (this.destroyed) return;
    if (this.hero) {
      this.heroInput = input as HeroInput;
      this.updateHero();
    } else {
      const a = input as AccountInput;
      this.chats = a.chats ?? [];
      this.maxPets = Math.max(0, Math.floor(a.maxPets || 0));
    }
    this.sync();
  }

  setLive(live: boolean): void {
    this.wantLive = live;
    this.applyLive();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    allStages.delete(this);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.clock.dispose();
    this.tweens.clear();
    for (const a of this.waapi) a.cancel();
    this.waapi.clear();
    for (const a of this.starAnims) a.cancel();
    for (const p of this.pets) p.destroy();
    this.pets = [];
    if (!this.hero) setPetColors(this.colorKey, {});
    this.root.remove();
  }

  // ------------------------------------------------------------ live or not

  // Live: the UI wants it, it's on screen and the page is visible
  applyLive(): void {
    const live = !this.destroyed && this.wantLive && this.onScreen && pageVisible() && this.width > 0;
    if (live === this.live) return;
    this.live = live;
    this.root.classList.toggle("cs-paused", !live);
    let offFor = 0;
    if (live) {
      offFor = this.everLive ? performance.now() - this.hiddenSince : Infinity;
      this.everLive = true;
      this.clock.resume();
      if (!world.shownOnce) this.firstShownTimer.start();
    } else {
      this.hiddenSince = performance.now();
      this.clock.pause();
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    for (const a of this.waapi) {
      if (live) a.play();
      else a.pause();
    }
    this.updateStars();
    for (const p of [...this.pets]) p.liveChanged(offFor);
    this.invalidate();
  }

  shownOnce(): boolean {
    return world.shownOnce;
  }

  // ------------------------------------------------------------ geometry

  get chatGround(): number {
    return this.height - this.tagHeight - SMALL;
  }

  get loneGround(): number {
    return this.height - this.gu * 0.55;
  }

  // Pets stand in a row from the left, spaced so their tags fit
  private spacingFor(n: number): number {
    return Math.max(0, Math.min(this.gu * 7.5, (this.width - 2 * this.margin) / Math.max(1, n)));
  }

  // Where a pet stands: the hero on the right of his stage (under the stars),
  // a chat's pet on its spot in the row
  slotX(key: string): number {
    if (key === "") return this.width * 0.76;
    return this.slots.get(key) ?? this.width / 2;
  }

  // A pointer event in stage coordinates
  local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // The mouse's x while it hovers the stage, else -1
  cursorX(): number {
    if (this.hoverClientX < 0) return -1;
    return this.hoverClientX - this.root.getBoundingClientRect().left;
  }

  private hover(clientX: number): void {
    this.hoverClientX = clientX;
    const hovering = clientX >= 0;
    if (hovering === this.hovering) return;
    this.hovering = hovering;
    for (const p of this.pets) if (p.lone) p.changed();
  }

  private resized(width: number, height: number): void {
    if (this.destroyed || (width === this.width && height === this.height)) return;
    this.width = width;
    this.height = height;
    if (this.floorEl) this.floorEl.style.transform = `translateY(${this.chatGround}px)`;
    if (this.textEl)
      this.textEl.style.width = `${Math.max(this.gu * 8, this.slotX("") - this.bodyWidth / 2 - this.gu - this.gu * 0.8)}px`;
    this.sync();
    this.applyLive();
    this.invalidate();
  }

  // ------------------------------------------------------------ pets

  petFor(key: string): Pet | null {
    return this.pets.find((p) => p.key === key) ?? null;
  }

  private sync(): void {
    if (this.destroyed || this.width <= 0) return; // laid out first
    if (this.hero) {
      if (!this.pets.length) this.pets.push(new Pet(this, "", null, -1, this.slotX("")));
      const hero = this.pets[0];
      hero.setHome(this.slotX(""));
      hero.checkMood();
      hero.changed();
      return;
    }
    const shown = this.chats.slice(0, this.maxPets);
    const byKey = new Map(shown.map((c) => [c.key, c]));
    // Spots: a pet keeps its place in the row while its chat changes state
    // (the colors tie pets to rows); newcomers line up on the right
    const keys = this.order.filter((k) => byKey.has(k));
    for (const c of shown) if (!keys.includes(c.key)) keys.push(c.key);
    this.order = keys;
    const spacing = this.spacingFor(keys.length);
    this.tagWidth = Math.max(this.gu * 3.5, spacing - SMALL * 2);
    keys.forEach((k, i) => this.slots.set(k, this.margin + (i + 0.5) * spacing));
    for (const k of [...this.slots.keys()]) if (!byKey.has(k) && !this.petFor(k)) this.slots.delete(k);
    for (const p of [...this.pets]) p.setChat(byKey.get(p.key) ?? null);
    for (const c of shown) {
      if (this.petFor(c.key)) continue;
      const here = new Set(this.pets.filter((p) => !p.leaving).map((p) => p.colorIndex));
      this.pets.push(new Pet(this, c.key, c, freeColor(c.key, here), this.slotX(c.key)));
    }
    for (const p of this.pets) p.setHome(this.slotX(p.key));
    this.publishColors();
    // More chats than pets: say how many
    const hidden = Math.max(0, this.chats.length - shown.length);
    if (this.moreEl && this.drawn.more !== `${hidden}/${this.maxPets}`) {
      this.drawn.more = `${hidden}/${this.maxPets}`;
      this.moreEl.hidden = hidden === 0;
      this.moreEl.textContent = `+${hidden}`;
      this.moreEl.title = `${plural(hidden, "%1 more chat", "%1 more chats")}\n` +
        `Up to ${this.maxPets} pets per account, the chats that need you or work first; the list shows them all.`;
    }
    this.invalidate();
  }

  // A leaving pet walked off the stage
  removePet(pet: Pet): void {
    if (!pet.leaving) return;
    this.pets = this.pets.filter((p) => p !== pet);
    this.slots.delete(pet.key);
    if (this.bubbleOwner === pet) {
      this.bubbleOwner = null;
      this.bubbleEl.hidden = true;
    }
    pet.destroy();
    this.publishColors();
  }

  // The list shows a bar in each pet's color next to its chat
  private publishColors(): void {
    if (this.hero) return;
    const colors: Record<string, string> = {};
    for (const p of this.pets) if (!p.leaving && p.colorIndex >= 0) colors[p.key] = PALETTE[p.colorIndex];
    setPetColors(this.colorKey, colors);
  }

  open(chat: ChatRef): void {
    this.cb.open(chat);
  }

  // Events go to the chat's own pet; the hero takes the ones about everything
  // (and the ones for a chat that has no pet)
  petEvent(kind: string, text: string, key: string): void {
    let pet: Pet | null = null;
    if (this.hero) pet = !key || !Object.hasOwn(allPetColors(), key) ? (this.pets[0] ?? null) : null;
    else if (key) pet = this.petFor(key);
    pet?.event(kind, text);
  }

  // ------------------------------------------------------------ the hero's stage

  private updateHero(): void {
    const input = this.heroInput;
    if (!input) return;
    const mood = input.mood || "loading";
    this.root.dataset.light = lightOf(mood);
    // The light pulses while a chat needs you
    this.root.classList.toggle("cs-glowing", mood === "waving");
    this.updateStars();

    const h = this.headlineEl!;
    if (h.textContent !== input.headline) h.textContent = input.headline;
    const calling = input.waiting;
    h.classList.toggle("cs-calling", mood === "waving");
    h.classList.toggle("cs-clickable", !!calling);
    // "1 chat needs you": click to go there
    const title = calling ? `Open ${calling.name}${calling.host ? `\n${calling.host}` : ""}` : "";
    if (h.title !== title) h.title = title;
    if (calling) {
      h.setAttribute("role", "button");
      h.tabIndex = 0;
    } else {
      h.removeAttribute("role");
      h.removeAttribute("tabindex");
    }

    // No status yet (looking, or it failed): no counts
    const counts: Counts = input.counts;
    const shown = mood !== "loading" && mood !== "error";
    const key = shown ? JSON.stringify(counts) : "";
    if (this.drawn.counts !== key) {
      this.drawn.counts = key;
      this.renderCounts(shown ? counts : null);
    }
  }

  private renderCounts(counts: Counts | null): void {
    const box = this.countsEl!;
    box.replaceChildren();
    box.hidden = !counts;
    if (!counts) return;
    const items: [string, number, string][] = [
      ["waiting", counts.waiting, plural(counts.waiting, "%1 needs input", "%1 need input")],
      ["working", counts.working, `${counts.working} working`],
      ["idle", counts.idle, `${counts.idle} idle`],
      ["limit", counts.limit, `${counts.limit} at the usage limit`],
      ["done", counts.done, `${counts.done} done`],
    ];
    for (const [state, n, text] of items) {
      if (n <= 0) continue;
      const item = el("span", "cs-count", box);
      el("span", `cs-count-dot cs-dot-${state}`, item);
      el("span", "cs-count-text", item).textContent = text;
    }
    if (!box.childElementCount) el("span", "cs-count-none", box).textContent = "No sessions running";
  }

  private openCalling(): void {
    const c = this.heroInput?.waiting;
    if (c) this.cb.open(c);
  }

  // A starry night once everything is done
  private updateStars(): void {
    if (!this.starsEl) return;
    const night = this.heroInput?.mood === "sleeping";
    this.starsEl.hidden = !night;
    const twinkle = night && !reducedMotion();
    if (twinkle && !this.starAnims.length) {
      this.starAnims = this.stars.map((star, i) => {
        const up = 900 + 260 * i,
          down = 1100 + 190 * i;
        const a = star.animate(
          [
            { opacity: 0.15, easing: cssEase.inOutSine },
            { opacity: 0.9, offset: up / (up + down), easing: cssEase.inOutSine },
            { opacity: 0.15 },
          ],
          { duration: up + down, iterations: Infinity },
        );
        a.currentTime = up * 0.48; // from 0.5 on the way up, like the widget
        return a;
      });
    } else if (!twinkle && this.starAnims.length) {
      for (const a of this.starAnims) a.cancel();
      this.starAnims = [];
    }
    for (const a of this.starAnims) {
      if (this.live) a.play();
      else a.pause();
    }
  }

  // ------------------------------------------------------------ shared by the pets

  // Speech bubble above whoever speaks, or beside him when there's no room above
  say(pet: Pet, text: string): void {
    if (this.destroyed || !text) return;
    this.bubbleOwner = pet;
    this.bubbleEl.textContent = text;
    this.bubbleEl.hidden = false;
    this.bubbleSize = { w: this.bubbleEl.offsetWidth, h: this.bubbleEl.offsetHeight };
    this.bubbleAt = "";
    this.bubbleTimer.restart();
    this.invalidate();
  }

  // Floating hearts, notes, sparkles and z's
  burst(pet: Pet, symbol: string, color: string, count: number): void {
    if (this.destroyed || reducedMotion()) return;
    const gu = this.gu;
    for (let i = 0; i < count; i++) {
      const x = pet.px - gu * 0.4 + (Math.random() - 0.5) * this.bodyWidth;
      const y = pet.ground - pet.lift - this.bodyHeight - gu * 0.6 - Math.random() * gu * 0.5;
      const drift = (Math.random() - 0.5) * gu * 2;
      const bit = el("span", "cs-particle", this.fxLayer);
      bit.style.color = color;
      bit.style.transform = `translate(${x}px, ${y}px)`;
      const glyph = el("span", "cs-particle-glyph", bit);
      glyph.textContent = symbol;
      const timing = { duration: 1500, fill: "forwards" as FillMode };
      const anims = [
        bit.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: `translate(${x + drift}px, ${y}px)` }], timing),
        glyph.animate([{ transform: "translateY(0)" }, { transform: `translateY(${-gu * 2.4}px)` }], {
          ...timing,
          easing: cssEase.outQuad,
        }),
        glyph.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, easing: cssEase.inQuad }),
      ];
      for (const a of anims) {
        this.waapi.add(a);
        if (!this.live) a.pause();
      }
      anims[2].onfinish = () => {
        for (const a of anims) {
          this.waapi.delete(a);
          a.cancel();
        }
        bit.remove();
      };
    }
  }

  // ------------------------------------------------------------ frames

  animate(t: Tween): void {
    this.tweens.add(t);
    this.invalidate();
  }

  unanimate(t: Tween): void {
    this.tweens.delete(t);
  }

  // Something changed: draw it on the next frame (or right away while hidden,
  // where nothing moves anyway)
  invalidate(): void {
    if (this.destroyed) return;
    if (this.live) {
      if (!this.frame) this.frame = requestAnimationFrame(this.loop);
    } else if (!this.renderQueued) {
      this.renderQueued = true;
      queueMicrotask(() => {
        this.renderQueued = false;
        if (!this.live && !this.destroyed) this.render();
      });
    }
  }

  // One loop per live stage, running only while something moves
  private readonly loop = (): void => {
    this.frame = 0;
    if (!this.live || this.destroyed) return;
    const now = this.clock.now();
    for (const t of [...this.tweens]) t.step(now);
    this.render();
    if (this.tweens.size && !this.frame) this.frame = requestAnimationFrame(this.loop);
  };

  private render(): void {
    if (this.width <= 0) return;
    for (const p of this.pets) p.render();
    this.renderBubble();
  }

  private renderBubble(): void {
    const o = this.bubbleOwner;
    if (!o || this.bubbleEl.hidden) return;
    const { w, h } = this.bubbleSize;
    const headTop = o.ground - o.lift - this.bodyHeight;
    const roomAbove = headTop - h - SMALL >= 0;
    const rightSide = o.px + this.bodyWidth / 2 + w + SMALL <= this.width;
    const x = roomAbove ? Math.max(0, Math.min(this.width - w, o.px - w / 2))
      : rightSide ? o.px + this.bodyWidth / 2 + SMALL
      : Math.max(0, o.px - this.bodyWidth / 2 - w - SMALL);
    const y = roomAbove ? headTop - h - SMALL : Math.max(0, headTop);
    const at = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (at !== this.bubbleAt) {
      this.bubbleAt = at;
      this.bubbleEl.style.transform = at;
    }
  }
}
