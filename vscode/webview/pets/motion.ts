// Time, timers and tweens for one stage. A stage's clock only runs while the
// stage is live: a hidden stage's timers and walks stand still and carry on
// where they were once it shows again (Qt Timers and NumberAnimations in the
// widget; here nothing may tick while the view is hidden).

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
};

// The same curves for CSS and the Web Animations API
export const cssEase = {
  inQuad: "cubic-bezier(0.11, 0, 0.5, 0)",
  outQuad: "cubic-bezier(0.5, 1, 0.89, 1)",
  inOutSine: "cubic-bezier(0.37, 0, 0.63, 1)",
};

const motionQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

// No digging about for people who asked for less motion
export function reducedMotion(): boolean {
  return motionQuery?.matches ?? false;
}

export class Clock {
  private base = 0; // clock time when last paused
  private since = -1; // performance.now() when resumed; -1 while paused
  readonly timers = new Set<Timer>();

  get running(): boolean {
    return this.since >= 0;
  }

  now(): number {
    return this.since < 0 ? this.base : this.base + performance.now() - this.since;
  }

  pause(): void {
    if (this.since < 0) return;
    this.base = this.now();
    this.since = -1;
    for (const t of this.timers) t.disarm();
  }

  resume(): void {
    if (this.since >= 0) return;
    this.since = performance.now();
    for (const t of this.timers) t.arm();
  }

  dispose(): void {
    for (const t of [...this.timers]) t.stop();
  }
}

// A QML Timer on a stage's clock: start() is a no-op while running, a
// repeating one picks up a new interval set in its callback.
export class Timer {
  private due = -1; // clock time of the next trigger; -1 while stopped
  private handle: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly clock: Clock,
    public interval: number,
    private readonly fn: () => void,
    private readonly repeat = false,
    private readonly triggeredOnStart = false,
  ) {}

  get running(): boolean {
    return this.due >= 0;
  }

  start(): void {
    if (this.running) return;
    this.due = this.clock.now() + this.interval;
    this.clock.timers.add(this);
    this.arm();
    if (this.triggeredOnStart) this.fn();
  }

  restart(): void {
    this.stop();
    this.start();
  }

  stop(): void {
    this.disarm();
    this.due = -1;
    this.clock.timers.delete(this);
  }

  // Like QML's `running: <condition>`
  setRunning(on: boolean): void {
    if (on) this.start();
    else this.stop();
  }

  arm(): void {
    this.disarm();
    if (this.due < 0 || !this.clock.running) return;
    this.handle = setTimeout(() => this.fire(), Math.max(0, this.due - this.clock.now()));
  }

  disarm(): void {
    if (this.handle !== undefined) clearTimeout(this.handle);
    this.handle = undefined;
  }

  private fire(): void {
    this.handle = undefined;
    if (!this.repeat) this.stop();
    this.fn();
    if (this.repeat && this.running) {
      this.due = this.clock.now() + this.interval;
      this.arm();
    }
  }
}

// What drives tweens: the stage's requestAnimationFrame loop
export interface Animator {
  readonly clock: Clock;
  animate(t: Tween): void;
  unanimate(t: Tween): void;
}

// One number animated from -> to (a QML NumberAnimation)
export class Tween {
  private from = 0;
  private to = 0;
  private start = 0;
  private ms = 0;
  private curve: Ease = ease.linear;
  private done: (() => void) | undefined;
  active = false;

  constructor(
    private readonly animator: Animator,
    private readonly set: (v: number) => void,
  ) {}

  run(from: number, to: number, ms: number, curve: Ease, done?: () => void): void {
    this.from = from;
    this.to = to;
    this.ms = ms;
    this.curve = curve;
    this.done = done;
    this.start = this.animator.clock.now();
    this.active = true;
    this.animator.animate(this);
  }

  // Stopped halfway: stays where it is, without `done`
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.animator.unanimate(this);
  }

  step(now: number): void {
    if (!this.active) return;
    const t = this.ms > 0 ? Math.min(1, Math.max(0, (now - this.start) / this.ms)) : 1;
    this.set(this.from + (this.to - this.from) * this.curve(t));
    if (t < 1) return;
    this.active = false;
    this.animator.unanimate(this);
    this.done?.();
  }
}
