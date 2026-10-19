// One Clawd on a stage (stage.ts; artwork: clawd-pet, MIT). Ported from the
// widget's Pet.qml.
//
// The hero (key "") mirrors all your sessions and has a life of his own: he
// wanders, follows your mouse, has hobbies, naps, dresses for the season and
// reacts to you. Click to pet him (many quick clicks tickle), double-click to
// make him dance, drag him to pick him up and drop him.
//
// A chat's pet stands for one chat in the list: it acts that chat out (works,
// calls you, rests while it's idle, sleeps once it's done, looks sad if it
// failed), wears its name and color, walks in when the chat shows up and off
// when it leaves the list, and opens the chat when clicked (drag him for fun).

import type { ChatRef, Session } from "../../src/shared/types";
import { stateText } from "../../src/shared/model";
import type { StageChat } from "./api";
import { PetArt } from "./art";
import { PALETTE, textOn } from "./colors";
import { Timer, Tween, ease, reducedMotion } from "./motion";
import type { Stage } from "./stage";

// Kirigami's small and large spacing at gridUnit 16
export const SMALL = 4;
export const LARGE = 8;
// All pets share the viewBox -15 -25 45 45: the character is centred, 15
// units wide and ~11 tall, standing on y = 16 (41/45 down the image)
export const FEET = 41 / 45;

// Theme roles for particles (the widget's neutral/negative/focus/disabled text colors)
export const tone = {
  neutral: "var(--cs-waiting)",
  negative: "var(--cs-failed)",
  focus: "var(--cs-working)",
  disabled: "var(--cs-muted)",
  heart: "#ff6b8a",
};

// What he does while Claude works, waits for you, or runs subagents:
// switched now and then so he isn't stuck in one pose.
const WORK_POSES = ["working-typing", "working-thinking", "coding", "working-testing", "working-reviewing",
  "working-debugger", "working-building", "working-tool-calling", "working-deploying", "working-rubber-duck",
  "working-wizard"];
const AGENT_POSES = ["working-juggling", "working-conducting", "working-pairing"];
const WAIT_POSES = ["waving", "working-oncall", "notification", "mail", "working-beacon", "praying"];

// Hobbies for quiet moments (with what he says, sometimes)
const HOBBIES: { pose: string; text: string }[] = [
  { pose: "reading", text: "Reading the docs…" },
  { pose: "music", text: "♪" },
  { pose: "gaming", text: "" },
  { pose: "meditating", text: "Ommm…" },
  { pose: "yoga", text: "" },
  { pose: "eating", text: "Snack time!" },
  { pose: "ice-cream", text: "" },
  { pose: "painting", text: "" },
  { pose: "gardening", text: "" },
  { pose: "studying", text: "Learning new tricks." },
  { pose: "singing", text: "♪ ♫" },
  { pose: "telescope", text: "Any bugs out there?" },
  { pose: "peeking", text: "" },
  { pose: "photography", text: "Say cheese!" },
  { pose: "drumming", text: "" },
  { pose: "magic", text: "Ta-da!" },
  { pose: "chef", text: "" },
  { pose: "idea", text: "I have an idea!" },
  { pose: "cool", text: "" },
  { pose: "bored", text: "So quiet…" },
  { pose: "shrug", text: "" },
  { pose: "hopeful", text: "" },
  { pose: "flexing", text: "" },
  { pose: "skeptical", text: "" },
  { pose: "going-away", text: "Brb!" },
];

// A random element of list, not the same as last if there's a choice
function pick(list: readonly string[], last = ""): string {
  const choices = list.length > 1 ? list.filter((x) => x !== last) : list;
  return choices[Math.floor(Math.random() * choices.length)];
}

// Seasons (northern hemisphere, by month) and a few days of the year
function seasonPose(): string {
  const m = new Date().getMonth();
  return m === 11 || m <= 1 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn";
}

function holidayGreeting(): { pose: string; text: string } {
  const d = new Date(),
    m = d.getMonth() + 1,
    day = d.getDate();
  if ((m === 12 && day === 31) || (m === 1 && day === 1)) return { pose: "new-year", text: "Happy New Year!" };
  if (m === 12 && day >= 24 && day <= 26) return { pose: "christmas", text: "Merry Christmas!" };
  if (m === 10 && day === 31) return { pose: "halloween", text: "Boo! Happy Halloween!" };
  if (m === 2 && day === 14) return { pose: "valentine", text: "Happy Valentine's Day!" };
  return { pose: "", text: "" };
}

// What the UI opens for a chat (the extension finds its terminal or tab)
export function chatRef(c: StageChat): ChatRef {
  const s = c.session;
  return {
    host: c.host || undefined,
    key: s.key,
    sessionId: s.sessionId,
    chatId: s.chatId,
    profileDir: s.profileDir,
    name: s.name,
    entrypoint: s.entrypoint,
    pid: s.pid,
    cwd: s.cwd,
    kind: s.kind,
    jobId: s.jobId,
    openCommand: s.openCommand,
    stopCommand: s.stopCommand,
  };
}

function div(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

export class Pet {
  readonly stage: Stage;
  readonly key: string; // the chat's key ("" for the hero)
  readonly lone: boolean;
  readonly colorIndex: number; // -1 for the hero
  chat: Session | null = null; // the chat's session, null once it left the list
  lastChat: StageChat | null = null; // the last one seen (opened when clicked)
  label = ""; // short name on his tag
  homeX: number;
  leaving = false;

  // Where he is: px = horizontal centre, lift = height above the ground
  px: number;
  lift = 0;
  squash = 1; // < 1 squashed (landing), > 1 stretched
  facingLeft = false;
  held = false;
  moving = false;
  running = false;
  offstage = false; // walking in from / out to the edge
  action = ""; // something he chose to do (smile, coffee…)
  reaction = ""; // a reaction to you or an event (love, dizzy…)
  private reactionUntil = 0;
  private quickClicks = 0;
  private sleepyClicks = 0;
  private lastMood: string;
  private heldLong = false;
  private workPose = pick(WORK_POSES);
  private agentPose = "working-juggling";
  private waitPose = "working-oncall"; // the alert sign first: it reads best
  private lastHobby = "";

  private readonly ring: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly tag: HTMLDivElement | null;
  private readonly grab: HTMLDivElement;
  private readonly art: PetArt;
  private readonly drawn: Record<string, string> = {};

  private readonly stride: Tween;
  private readonly hopper: Tween;
  private readonly faller: Tween;
  private readonly lander: Tween;

  private readonly enterTimer: Timer;
  private readonly leaveTimer: Timer;
  private readonly brain: Timer;
  private readonly lookTimer: Timer;
  private readonly lookBack: Timer;
  private readonly reactionTimer: Timer;
  private readonly actionTimer: Timer;
  private readonly tickleTimer: Timer;
  private readonly heldTimer: Timer;
  private readonly workTimer: Timer;
  private readonly waitTimer: Timer;
  private readonly contextTimer: Timer;
  private readonly usageTimer: Timer;

  private pressedAt: { x: number; y: number } | null = null;
  private dragging = false;
  private lastClick = 0;
  private destroyed = false;

  constructor(stage: Stage, key: string, chat: StageChat | null, colorIndex: number, homeX: number) {
    this.stage = stage;
    this.key = key;
    this.lone = key === "";
    this.colorIndex = colorIndex;
    this.homeX = homeX;
    this.px = homeX;
    if (chat) this.takeChat(chat);
    this.lastMood = this.mood;

    const clock = stage.clock;
    this.stride = new Tween(stage, (v) => (this.px = v));
    this.hopper = new Tween(stage, (v) => (this.lift = v));
    this.faller = new Tween(stage, (v) => (this.lift = v));
    this.lander = new Tween(stage, (v) => (this.squash = v));

    this.enterTimer = new Timer(clock, 60, () => this.moveTo(this.homeX, true, true));
    this.leaveTimer = new Timer(clock, 300, () => {
      this.reaction = "";
      this.offstage = true;
      const w = this.stage.width, size = this.stage.imageSize;
      this.moveTo(this.px < w / 2 ? -size / 2 : w + size / 2, true, true);
    });
    this.brain = new Timer(clock, 3000, () => this.think(), true);
    // The hero turns towards the mouse while it hovers the stage
    this.lookTimer = new Timer(clock, 350, () => {
      const x = this.stage.cursorX();
      if (x >= 0 && Math.abs(x - this.px) > this.stage.bodyWidth * 0.4) {
        this.facingLeft = x < this.px;
        this.changed();
      }
    }, true);
    this.lookBack = new Timer(clock, 900, () => {
      this.facingLeft = !this.facingLeft;
      this.changed();
    });
    this.reactionTimer = new Timer(clock, 2500, () => {
      this.reaction = "";
      this.changed();
    });
    this.actionTimer = new Timer(clock, 2500, () => {
      this.action = "";
      this.changed();
    });
    this.tickleTimer = new Timer(clock, 1500, () => {
      this.quickClicks = 0;
      this.sleepyClicks = 0;
    });
    // Held up in the air for a while: he gets scared
    this.heldTimer = new Timer(clock, 2200, () => {
      if (!this.held) return;
      this.heldLong = true;
      this.changed();
    });
    // A different work pose now and then while Claude works...
    this.workTimer = new Timer(clock, 14000, () => {
      this.workTimer.interval = 10000 + Math.random() * 10000;
      if (this.mood === "working-juggling") this.agentPose = pick(AGENT_POSES, this.agentPose);
      else this.workPose = pick(WORK_POSES, this.workPose);
      this.changed();
    }, true);
    // ...and while a session waits for you
    this.waitTimer = new Timer(clock, 6000, () => {
      this.waitPose = pick(WAIT_POSES, this.waitPose);
      this.changed();
    }, true);
    // A working session's context window is nearly full: point it out now and
    // then (a chat's pet for its own chat, the hero for chats without a pet)
    this.contextTimer = new Timer(clock, 40000, () => {
      if (!this.held && this.reaction === "") this.react("working-context-full", this.contextFullText, 3500);
    }, true, true);
    // Close to a usage limit: look mind-blown (or overheated, or low on
    // battery) now and then, then carry on. At the limit: 429.
    this.usageTimer = new Timer(clock, 25000, () => {
      if (this.held || this.reaction !== "") return;
      const input = this.stage.heroInput;
      const pose = (input?.maxFiveHour ?? 0) >= 100 ? "429" : pick(["mindblown", "mindblown", "working-overheated", "battery-low"]);
      this.react(pose, input?.highUsageText ?? "", 3500);
    }, true, true);

    // Drawing: under him the chat's color as a soft ring (or the hero's
    // shadow), his pose, his name tag, and a grab area around his body
    const gu = stage.gu, size = stage.imageSize;
    this.ring = div("cs-pet-ring");
    this.ring.style.width = `${stage.bodyWidth * (this.lone ? 1.25 : 1.15)}px`;
    this.ring.style.height = `${gu * (this.lone ? 0.5 : 0.42)}px`;
    if (!this.lone) this.ring.style.background = PALETTE[colorIndex];
    this.body = div("cs-pet-body");
    this.body.style.width = this.body.style.height = `${size}px`;
    const breath = div("cs-pet-breath");
    this.art = new PetArt();
    breath.append(this.art.el);
    this.body.append(breath);
    this.grab = div("cs-pet-grab");
    this.grab.style.width = `${stage.bodyWidth + LARGE}px`;
    this.grab.style.height = `${stage.bodyHeight + LARGE}px`;
    this.tag = null;
    if (!this.lone) {
      this.tag = div("cs-pet-tag");
      this.tag.style.background = PALETTE[colorIndex];
      this.tag.style.color = textOn(PALETTE[colorIndex]);
      this.tag.addEventListener("click", () => this.clicked());
    }
    stage.petLayer.append(...[this.ring, this.body, this.tag, this.grab].filter((e): e is HTMLDivElement => !!e));
    this.listen();
    this.describe();

    if (!stage.shownOnce()) {
      this.px = homeX; // laid out before anyone saw him: he's just there
    } else {
      // walk in from the nearest edge
      const fromLeft = homeX < stage.width / 2;
      this.px = fromLeft ? -size / 2 : stage.width + size / 2;
      this.facingLeft = !fromLeft;
      this.offstage = true;
      this.enterTimer.start();
    }
    this.art.setPlaying(stage.live);
    this.changed();
  }

  // ------------------------------------------------------------ state

  get isMain(): boolean {
    return this.stage.hero; // shows the account-wide things (usage limits)
  }

  get ground(): number {
    return this.lone ? this.stage.loneGround : this.stage.chatGround;
  }

  get mood(): string {
    if (this.lone) return this.stage.heroInput?.mood || "loading";
    const c = this.chat;
    if (!c) return this.leaving ? "waving" : "sleeping"; // its chat left the list: bye
    if (c.state === "waiting") return "waving";
    if (c.state === "working") return c.agents && c.agents.running > 0 ? "working-juggling" : "working-typing";
    if (c.state === "idle") return "idle-living"; // ready for your next message
    if (c.reason === "failed") return "sad";
    return "sleeping"; // done: results to look at
  }

  private get moodPose(): string {
    const mood = this.mood;
    if (mood === "working-typing") return this.workPose;
    if (mood === "working-juggling") return this.agentPose;
    if (mood === "waving") return !this.lone && !this.chat ? "waving" : this.waitPose; // leaving: a real wave
    return mood;
  }

  get pose(): string {
    if (this.held) return this.heldLong ? "scared" : "surprised";
    if (this.reaction) return this.reaction;
    if (this.moving) return this.running ? "running" : "crab-walking";
    if (this.action) return this.action;
    return this.moodPose;
  }

  private get contextFullText(): string {
    if (this.lone) return this.stage.heroInput?.contextFullText ?? "";
    const c = this.chat;
    return c && c.state === "working" && c.context !== null && c.context >= 85
      ? `${this.label}: context ${Math.round(c.context)}% full`
      : "";
  }

  private get minX(): number {
    return this.stage.bodyWidth / 2 + SMALL;
  }

  private get maxX(): number {
    return Math.max(this.minX, this.stage.width - this.stage.bodyWidth / 2 - SMALL);
  }

  private clampX(x: number): number {
    return Math.max(this.minX, Math.min(this.maxX, x));
  }

  // The timers that only run in some states (QML `running:` bindings)
  private updateTimers(): void {
    const live = this.stage.live,
      mood = this.mood;
    this.brain.setRunning(live && !this.held && !this.leaving && !this.offstage);
    this.lookTimer.setRunning(live && this.lone && this.stage.hovering && !this.moving && !this.held && mood !== "sleeping");
    this.workTimer.setRunning(live && mood.startsWith("working") && this.reaction === "");
    this.waitTimer.setRunning(live && mood === "waving" && this.reaction === "");
    this.contextTimer.setRunning(live && this.contextFullText !== "" && mood.startsWith("working") && !this.leaving);
    this.usageTimer.setRunning(
      live && this.isMain && (this.stage.heroInput?.highUsageText ?? "") !== "" && mood !== "sleeping" && !this.leaving,
    );
  }

  changed(): void {
    if (this.destroyed) return;
    this.updateTimers();
    this.stage.invalidate();
  }

  // ------------------------------------------------------------ from the stage

  private takeChat(c: StageChat): void {
    this.chat = c.session;
    this.lastChat = c;
    this.label = (c.session.name || "").trim();
  }

  // The chat's new row (or null: it left the list)
  setChat(c: StageChat | null): void {
    if (c) this.takeChat(c);
    else this.chat = null;
    this.describe();
    this.checkMood();
    const leaving = !c;
    if (leaving !== this.leaving) {
      this.leaving = leaving;
      if (leaving) {
        // a wave first (or the end of a reaction), then off he goes
        this.leaveTimer.interval = Math.max(900, this.reactionUntil - this.stage.clock.now() + 300);
        this.leaveTimer.restart();
      } else {
        this.leaveTimer.stop();
        this.offstage = false;
        this.moveTo(this.homeX, true);
      }
    }
    this.changed();
  }

  // The hero's mood (or a chat's state) may have changed
  checkMood(): void {
    const mood = this.mood;
    if (mood === this.lastMood) return;
    if (!this.offstage) this.stopMoving();
    this.action = "";
    if (this.lastMood === "sleeping" && mood !== "sleeping" && mood !== "waving") this.doAction("yawning", 1800); // woken up by work
    this.lastMood = mood;
    this.changed();
  }

  setHome(x: number): void {
    if (x === this.homeX) return;
    this.homeX = x;
    if (!this.stage.shownOnce()) {
      this.px = x; // laid out before anyone saw him: he's just there
      this.changed();
    } else if (!this.leaving && !this.held && !this.offstage) {
      this.moveTo(x, true);
    }
  }

  // The stage was shown or hidden (offFor: ms it was hidden)
  liveChanged(offFor: number): void {
    this.art.setPlaying(this.stage.live);
    this.changed();
    const mood = this.mood;
    if (!this.stage.live || !this.lone || mood === "sleeping" || mood === "loading" || offFor < 1500) return;
    const holiday = holidayGreeting();
    if (holiday.text) {
      this.react(holiday.pose, holiday.text, 3500);
      this.hop(this.stage.gu * 0.6);
    } else if (Math.random() < 0.6) {
      this.hop(this.stage.gu * 0.6);
      this.say("Hi!");
    }
  }

  // Tooltip: which chat this is, and what clicking does
  private describe(): void {
    const c = this.lastChat;
    const title = this.lone || !c
      ? ""
      : `${c.host ? c.host + ": " : ""}${c.session.name}\n${stateText(c.session, Date.now())}\nClick to open this chat`;
    if (this.drawn.title !== title) {
      this.drawn.title = title;
      this.grab.title = title;
      if (this.tag) this.tag.title = title;
    }
    if (this.tag && this.tag.textContent !== this.label) {
      this.tag.textContent = this.label;
      this.tag.hidden = this.label === "";
    }
  }

  // ------------------------------------------------------------ actions

  // Walk (or run) to x; anywhere: x may be off the stage (entering, leaving)
  moveTo(x: number, fast: boolean, anywhere = false): void {
    if (!anywhere) x = this.clampX(x);
    if (Math.abs(x - this.px) < SMALL) return;
    this.facingLeft = x < this.px;
    this.running = fast;
    this.action = "";
    if (reducedMotion()) {
      this.px = x; // no walking: he's just there
      this.strideStopped();
      return;
    }
    this.moving = true;
    const ms = (Math.abs(x - this.px) / (this.stage.gu * (fast ? 6 : 2))) * 1000;
    this.stride.run(this.px, x, ms, ease.inOutSine, () => this.strideStopped());
    this.changed();
  }

  private stopMoving(): void {
    if (!this.stride.active) return;
    this.stride.stop();
    this.strideStopped();
  }

  private strideStopped(): void {
    this.moving = false;
    this.running = false;
    if (this.leaving && this.offstage) {
      this.stage.removePet(this);
      return;
    }
    this.offstage = false;
    this.changed();
  }

  react(pose: string, text: string, ms = 2500): void {
    if (!this.offstage) this.stopMoving();
    this.action = "";
    this.reaction = pose;
    this.reactionTimer.interval = ms;
    this.reactionUntil = this.stage.clock.now() + ms;
    this.reactionTimer.restart();
    if (text) this.say(text);
    this.changed();
  }

  private doAction(pose: string, ms: number): void {
    this.action = pose;
    this.actionTimer.interval = ms;
    this.actionTimer.restart();
    this.changed();
  }

  say(text: string): void {
    this.stage.say(this, text);
  }

  private burst(symbol: string, color: string, count: number): void {
    this.stage.burst(this, symbol, color, count);
  }

  hop(height = this.stage.gu * 0.8): void {
    if (this.held || this.lift > 0 || reducedMotion()) return;
    this.hopper.run(0, height, 170, ease.outQuad, () =>
      this.hopper.run(height, 0, 230, ease.inQuad, () => this.land()));
  }

  // squash on landing, then a little stretch back
  private land(): void {
    if (reducedMotion()) return;
    this.lander.run(this.squash, 0.72, 80, ease.outQuad, () =>
      this.lander.run(0.72, 1.12, 120, ease.outQuad, () =>
        this.lander.run(1.12, 1, 150, ease.inOutQuad)));
  }

  // Clicked: the hero gets petted, a chat's pet opens its chat
  private clicked(): void {
    if (this.lone) {
      this.petHim();
      return;
    }
    if (this.lastChat) this.stage.open(chatRef(this.lastChat));
  }

  private petHim(): void {
    if (this.mood === "sleeping") {
      this.sleepyClicks += 1;
      this.tickleTimer.restart();
      if (this.sleepyClicks >= 3) {
        this.sleepyClicks = 0;
        this.react("angry", "I said let me SLEEP!", 2500);
        this.burst("!", tone.negative, 2);
      } else {
        this.react("grumpy", "Zzz… let me sleep.", 2500);
      }
      return;
    }
    this.quickClicks += 1;
    this.tickleTimer.restart();
    if (this.quickClicks >= 4) {
      this.quickClicks = 0;
      this.react("laughing", "Hehe, that tickles!", 2500);
      this.burst("♥", tone.heart, 4);
    } else if (this.quickClicks === 3) {
      this.react("embarrassed", "Aww, stop it…", 2000);
      this.burst("♥", tone.heart, 3);
    } else {
      this.react(Math.random() < 0.7 ? "love" : "happy", this.petLine(), 2000);
      this.burst("♥", tone.heart, 2);
    }
    this.hop();
  }

  private dance(): void {
    if (this.mood === "sleeping") {
      this.react("yawning", "…five more minutes.", 2500);
      return;
    }
    this.react(pick(["dancing", "dancing", "dj", "music", "singing"]), "♪ ♫", 3500);
    this.burst("♪", tone.focus, 3);
  }

  private pickUp(): void {
    this.stopMoving();
    this.reaction = "";
    this.action = "";
    this.hopper.stop();
    this.faller.stop();
    this.lander.stop();
    this.squash = 1;
    this.held = true;
    this.heldLong = false;
    this.heldTimer.restart();
    this.say("Whoa!");
    this.changed();
  }

  private drop(): void {
    this.held = false;
    this.heldTimer.stop();
    const from = this.lift;
    this.faller.run(from, 0, Math.max(160, Math.sqrt(from / this.stage.gu) * 230), ease.inQuad, () => this.landed(from));
    this.changed();
  }

  private landed(fromHeight: number): void {
    const gu = this.stage.gu;
    this.land();
    if (fromHeight > gu * 2.6) this.react("sick", "Ugh… I don't feel so good.", 2600);
    else if (fromHeight > gu * 1.5) this.react("dizzy", "Ouch… the room is spinning.", 2200);
    this.heldLong = false;
    this.changed();
  }

  private petLine(): string {
    const mood = this.mood;
    const waiting = this.stage.heroInput?.waiting?.name ?? "";
    if (mood === "waving" && waiting) return `${waiting} needs you!`;
    if (mood === "working-juggling") return "Juggling subagents!";
    if (mood === "working-typing") return "Busy coding… thanks!";
    const lines = ["Hi!", "♥", "Ship it!", "All quiet here.", "Pet me more!"];
    return lines[Math.floor(Math.random() * lines.length)];
  }

  private doHobby(quiet = false): void {
    let h = HOBBIES[Math.floor(Math.random() * HOBBIES.length)];
    if (h.pose === this.lastHobby) h = HOBBIES[(HOBBIES.indexOf(h) + 1) % HOBBIES.length];
    this.lastHobby = h.pose;
    this.doAction(h.pose, 5000);
    if (!quiet && h.text && Math.random() < 0.5) this.say(h.text);
  }

  // Every few seconds: what next?
  private think(): void {
    this.brain.interval = 2000 + Math.random() * 3000;
    if (this.reaction !== "" || this.moving || this.action !== "") return;
    const mood = this.mood;
    if (!this.lone) this.chatChoice();
    else if (mood === "idle-living") this.idleChoice();
    else if (mood === "waving") {
      this.hop(this.stage.gu * 0.9);
      const name = this.stage.heroInput?.waiting?.name ?? "";
      if (Math.random() < 0.25 && name) this.say(`${name} needs you!`);
    } else if (mood === "sleeping") {
      this.burst("z", tone.disabled, 1);
    } else if (Math.random() < 0.2) {
      this.facingLeft = !this.facingLeft; // busy, but glances around
      this.changed();
    }
  }

  // What the hero does by himself when nothing in particular is going on
  private idleChoice(): void {
    const still = reducedMotion(); // no wandering, then
    const cursorX = this.stage.cursorX();
    if (!still && cursorX >= 0 && Math.abs(cursorX - this.px) > this.stage.bodyWidth * 0.8) {
      this.moveTo(cursorX, Math.abs(cursorX - this.px) > this.stage.width / 3); // follow the mouse
      return;
    }
    const r = Math.random();
    const anywhere = this.minX + Math.random() * (this.maxX - this.minX);
    if (r < 0.26) {
      if (!still) this.moveTo(anywhere, false);
    } else if (r < 0.32) {
      if (!still) this.moveTo(anywhere, true);
    } else if (r < 0.42) {
      this.facingLeft = !this.facingLeft;
      this.lookBack.restart();
      this.changed();
    } else if (r < 0.48) this.hop();
    else if (r < 0.53) this.doAction("smile", 2500);
    else if (r < 0.58) this.doAction("coffee", 4500);
    else if (r < 0.61) {
      this.doAction("dancing", 2500);
      this.burst("♪", tone.focus, 2);
    } else if (r < 0.64) this.doAction("yawning", 2500);
    else if (r < 0.8) this.doHobby();
    else if (r < 0.85) {
      // dressed for the day or the season
      const holiday = holidayGreeting();
      const season = seasonPose();
      this.doAction(holiday.pose || (season === "winter" && Math.random() < 0.3 ? "snow" : season), 5000);
    }
    // otherwise: just stand there for a bit
  }

  // What a chat's pet does: stays near its spot and acts its chat out
  private chatChoice(): void {
    const bw = this.stage.bodyWidth;
    if (Math.abs(this.px - this.homeX) > bw * 0.7) {
      this.moveTo(this.homeX, false); // dragged away: back to its spot
      return;
    }
    const still = reducedMotion();
    const r = Math.random();
    const mood = this.mood;
    if (mood === "waving") {
      this.hop(this.stage.gu * 0.9);
      if (r < 0.3) this.say(`${this.label} needs you!`);
      else if (r < 0.6) this.burst("!", tone.neutral, 1);
    } else if (mood === "sleeping") {
      if (r < 0.5) this.burst("z", tone.disabled, 1);
    } else if (mood === "idle-living") {
      // awake and relaxed, waiting for your next message (quietly: the
      // speech bubble is for things that matter)
      if (r < 0.15) {
        this.facingLeft = !this.facingLeft;
        this.changed();
      } else if (r < 0.25) {
        if (!still) this.moveTo(this.homeX + (Math.random() - 0.5) * bw * 0.8, false);
      } else if (r < 0.32) this.doAction("smile", 2500);
      else if (r < 0.38) this.doAction("coffee", 4000);
      else if (r < 0.5) this.doHobby(true);
    } else if (mood !== "sad") {
      if (r < 0.2) {
        this.facingLeft = !this.facingLeft; // busy, but glances around
        this.changed();
      } else if (r < 0.3) {
        if (!still) this.moveTo(this.homeX + (Math.random() - 0.5) * bw * 0.6, false);
      }
    }
  }

  // Something happened to his chat (or, for the hero, to an account)
  event(kind: string, text: string): void {
    if (this.held) return;
    const gu = this.stage.gu;
    if (kind === "done") {
      this.react(pick(["celebrating", "celebrating", "clapping", "trophy", "shipping", "rocket", "200", "star", "happy",
        "flexing"]), text, 3000);
      this.burst("✦", tone.neutral, 4);
      this.hop(gu);
    } else if (kind === "failed") {
      this.react(pick(["facepalm", "sad", "crying", "working-firefighting"]), text, 3500);
      this.burst("✗", tone.negative, 2);
    } else if (kind === "stopped") {
      this.react("shrug", text, 2500);
    } else if (kind === "oops") {
      this.react("confused", text, 3000);
      this.burst("?", tone.neutral, 2);
    } else if (kind === "reset") {
      this.react(pick(["charging", "celebrating"]), text, 3000);
      this.burst("⚡", tone.neutral, 3);
      this.hop(gu);
    } else {
      if (text) this.say(text);
      this.burst("!", tone.neutral, 1);
      this.hop();
    }
  }

  // ------------------------------------------------------------ input

  private listen(): void {
    const g = this.grab;
    g.addEventListener("pointerenter", () => this.describe()); // its "Working · 3m" as of now
    g.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // no text selection or native drag
      g.setPointerCapture(e.pointerId);
      this.pressedAt = this.stage.local(e);
      this.dragging = false;
    });
    g.addEventListener("pointermove", (e) => {
      if (!this.pressedAt) return;
      const p = this.stage.local(e);
      if (!this.dragging && Math.hypot(p.x - this.pressedAt.x, p.y - this.pressedAt.y) > this.stage.gu * 0.5) {
        this.dragging = true;
        this.pickUp();
      }
      if (this.dragging) {
        const ground = this.ground,
          bh = this.stage.bodyHeight;
        this.px = this.clampX(p.x);
        this.lift = Math.max(0, Math.min(ground - bh, ground - p.y - bh / 2));
        this.changed();
      }
    });
    g.addEventListener("pointerup", () => {
      if (!this.pressedAt) return;
      this.pressedAt = null;
      if (this.dragging) {
        this.dragging = false;
        this.drop();
        return;
      }
      // Like Qt: a click, then a double-click instead of the second click
      const now = performance.now();
      const second = now - this.lastClick < 400;
      this.lastClick = second ? 0 : now;
      if (!second) this.clicked();
      else if (this.lone) this.dance();
    });
    const cancel = (): void => {
      if (!this.pressedAt) return;
      this.pressedAt = null;
      if (this.dragging) {
        this.dragging = false;
        this.drop();
      }
    };
    g.addEventListener("pointercancel", cancel);
    g.addEventListener("lostpointercapture", cancel);
  }

  // ------------------------------------------------------------ drawing

  private put(el: HTMLElement, name: string, prop: "transform" | "opacity" | "cursor" | "maxWidth", value: string): void {
    if (this.drawn[name] === value) return;
    this.drawn[name] = value;
    el.style[prop] = value;
  }

  // Transforms only: called from the stage's animation frame
  render(): void {
    const s = this.stage,
      gu = s.gu,
      size = s.imageSize,
      ground = this.ground;
    const pose = this.pose;
    if (pose !== this.art.wanted) this.art.setPose(pose);
    const px = Math.round(this.px * 10) / 10,
      lift = Math.round(this.lift * 10) / 10;
    const flip = this.facingLeft ? -1 : 1;
    const sq = Math.round(this.squash * 1000) / 1000;
    // Squash and stretch keep his volume, pivoting at his feet
    this.put(this.body, "body", "transform",
      `translate(${px - size / 2}px, ${ground - size * FEET - lift}px) scale(${flip * (2 - sq)}, ${sq})`);
    const breathing = !this.held && !this.moving && !reducedMotion();
    if (this.drawn.breathing !== String(breathing)) {
      this.drawn.breathing = String(breathing);
      this.body.classList.toggle("cs-breathing", breathing);
    }
    const half = this.mood.startsWith("working") ? 260 : this.mood === "sleeping" ? 1600 : 1100;
    if (this.drawn.half !== String(half)) {
      this.drawn.half = String(half);
      this.body.style.setProperty("--cs-breath", `${half}ms`);
    }
    const rw = s.bodyWidth * (this.lone ? 1.25 : 1.15),
      rh = gu * (this.lone ? 0.5 : 0.42);
    this.put(this.ring, "ring", "transform", `translate(${px - rw / 2}px, ${ground - rh / 2}px)`);
    const shadow = (this.lone ? 0.13 : 0.45) * (1 - Math.min(1, this.lift / (gu * 3)));
    this.put(this.ring, "ringOpacity", "opacity", shadow.toFixed(3));
    if (this.tag) {
      this.put(this.tag, "tag", "transform", `translate(${px}px, ${ground + 2}px) translateX(-50%)`);
      this.put(this.tag, "tagWidth", "maxWidth", `${s.tagWidth}px`);
    }
    const gw = s.bodyWidth + LARGE,
      gh = s.bodyHeight + LARGE;
    this.put(this.grab, "grab", "transform", `translate(${px - gw / 2}px, ${ground - lift - gh}px)`);
    this.put(this.grab, "cursor", "cursor", this.held ? "grabbing" : this.lone ? "grab" : "pointer");
  }

  destroy(): void {
    this.destroyed = true;
    for (const t of [this.stride, this.hopper, this.faller, this.lander]) t.stop();
    for (const t of [this.enterTimer, this.leaveTimer, this.brain, this.lookTimer, this.lookBack, this.reactionTimer,
      this.actionTimer, this.tickleTimer, this.heldTimer, this.workTimer, this.waitTimer, this.contextTimer,
      this.usageTimer]) t.stop();
    this.art.dispose();
    for (const el of [this.ring, this.body, this.tag, this.grab]) el?.remove();
  }
}
