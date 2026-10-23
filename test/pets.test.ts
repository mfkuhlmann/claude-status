// The pets (webview/pets) are DOM code. Their sources are bundled here and run
// in a fresh vm context (one per test) with just enough of a fake DOM: the
// observers are triggered by hand, timers and tweens are fired and stepped by
// hand, nothing waits.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { test } from "node:test";
import * as vm from "node:vm";

type Any = any; // (the pets' private parts are reached at run time)

const repo = path.resolve(__dirname, "..", "..");
let bundled = "";

function bundle(): string {
  if (!bundled) {
    const { buildSync } = createRequire(__filename)("esbuild") as Any; // (not bundled into this test)
    bundled = buildSync({
      stdin: {
        contents: 'export { Stage } from "./webview/pets/stage";\nexport { petFields } from "./webview/util/petStage";\n' +
          'export { ACTIONS, MOODS } from "./vendor/talpa/actions.mjs";\n',
        resolveDir: repo,
        loader: "ts",
      },
      bundle: true,
      write: false,
      format: "cjs",
      platform: "browser",
      target: "es2022",
      logLevel: "silent",
    }).outputFiles[0].text;
  }
  return bundled;
}

class FakeEl {
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  style: Record<string, unknown> = { setProperty() {} };
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  classes = new Set<string>();
  classList = {
    toggle: (c: string, on?: boolean) => void ((on ?? !this.classes.has(c)) ? this.classes.add(c) : this.classes.delete(c)),
    add: (c: string) => void this.classes.add(c),
    contains: (c: string) => this.classes.has(c),
  };
  adoptedStyleSheets: unknown[] = [];
  hidden = false;
  textContent = "";
  className = "";
  title = "";
  tabIndex = 0;
  offsetWidth = 40;
  offsetHeight = 16;
  constructor(readonly tag: string) {}
  get childElementCount(): number {
    return this.children.length;
  }
  append(...nodes: FakeEl[]): void {
    for (const n of nodes) {
      n.parent = this;
      this.children.push(n);
    }
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  replaceChildren(...nodes: FakeEl[]): void {
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  removeAttribute(k: string): void {
    delete this.attrs[k];
  }
  addEventListener(): void {}
  setPointerCapture(): void {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 400, height: 80 };
  }
  width = 300;
  height = 150;
  drawn: string[] = []; // a canvas: what was drawn on it
  getContext() {
    const drawn = this.drawn;
    // A 2D context that takes every call (and a gradient's color stops)
    return new Proxy({} as Record<string | symbol, unknown>, {
      get: (target, k) => (k in target ? target[k] : (...args: unknown[]) => {
        drawn.push(String(k));
        void args;
        return { addColorStop() {} };
      }),
      set: (target, k, v) => ((target[k] = v), true),
    });
  }
}

// A page with the pets' code loaded; a stage made in it is the only one, so its
// observers are the first (and only) ones
function load() {
  const resize: ((entries: unknown[]) => void)[] = [];
  const intersect: ((entries: unknown[]) => void)[] = [];
  const frames = { asked: 0 };
  const sandbox: Record<string, unknown> = {
    document: {
      createElement: (tag: string) => new FakeEl(tag),
      addEventListener() {},
      visibilityState: "visible",
      body: new FakeEl("body"),
    },
    window: { CLAUDE_STATUS: { editorTab: false }, addEventListener() {} },
    acquireVsCodeApi: () => ({ postMessage() {}, getState: () => undefined, setState() {} }),
    ResizeObserver: class {
      constructor(cb: (entries: unknown[]) => void) {
        resize.push(cb);
      }
      observe() {}
      disconnect() {}
    },
    IntersectionObserver: class {
      constructor(cb: (entries: unknown[]) => void) {
        intersect.push(cb);
      }
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: () => ++frames.asked,
    cancelAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => "", color: "rgb(204, 204, 204)" }),
    devicePixelRatio: 2,
    queueMicrotask,
    performance,
    setTimeout: (fn: () => void, ms: number) => {
      const handle = setTimeout(fn, ms);
      handle.unref();
      return handle;
    },
    clearTimeout,
    module: { exports: {} },
  };
  vm.runInNewContext(bundle(), sandbox);
  const exports = (sandbox.module as { exports: Any }).exports;
  return {
    Stage: exports.Stage as Any, petFields: exports.petFields as Any, ACTIONS: exports.ACTIONS as Any,
    MOODS: exports.MOODS as Any, resize, intersect, frames,
  };
}

function chat(key: string, state = "working", extra: Record<string, unknown> = {}) {
  const [profileDir, chatId] = key.split("/");
  const session = {
    key, chatId, sessionId: `s-${chatId}`, profileDir, name: `chat ${chatId}`, state, reason: "", since: 1,
    context: null, agents: null, stopped: null, ...extra,
  };
  return { key, session };
}

// An account's stage with room for maxPets pets, still unseen until show()
function account(maxPets = 3) {
  const t = load();
  const stage: Any = new t.Stage(new FakeEl("div"), false, "account:test", { open() {} });
  return {
    stage,
    frames: t.frames,
    lay: (width = 400) => t.resize[0]([{ contentRect: { width, height: 80 } }]),
    show: (on = true) => t.intersect[0]([{ isIntersecting: on }]),
    give: (chats: unknown[]) => stage.update({ chats, maxPets, fiveHour: 0 }),
  };
}

// Talpa's time goes on by ms (it ticks every 50 ms, as on a stage in view)
function wait(pet: Any, ms: number) {
  const from = pet.talpa.now;
  for (let t = from + 50; t <= from + ms; t += 50) pet.talpa.tick(t);
}

// A chat's pet on a stage in view, up out of the ground, whose chat has just
// left the list
function leaving() {
  const s = account();
  s.give([chat("p/1")]);
  s.lay();
  s.show();
  const pet = s.stage.petFor("p/1");
  wait(pet, 3000);
  s.give([]);
  assert.equal(pet.leaving, true);
  return { ...s, pet };
}

test("the pets are told when a usage limit has reset", () => {
  // They get a chat's row only when what they show of it changed (petFields):
  // the limit's end changes nothing else, and the chat's pet went on waiting
  // for it (out of steam) with a tooltip that said "resets in <1m"
  const { petFields } = load();
  const rows = (over: boolean) =>
    JSON.stringify({ chats: [chat("p/1", "idle", { stopped: { kind: "limit", over, resetsAt: 5 } })] }, petFields);
  assert.notEqual(rows(false), rows(true));
  assert.notEqual(rows(false), JSON.stringify({ chats: [chat("p/1", "idle")] }, petFields));
});

test("every mood and action a pet asks Talpa for is one it knows", () => {
  const { ACTIONS, MOODS } = load();
  for (const mood of ["error", "loading", "needs", "agents", "working", "idle", "done", "failed", "limit"])
    assert.ok(mood in MOODS, mood);
  // what the pets react with: react("…"), the events' actions and the usage limit's
  const source = readFileSync(path.join(repo, "webview", "pets", "pet.ts"), "utf8");
  const reacts = [...source.matchAll(/react\(([^;]*)\);/g)].map((m) => m[1]);
  const events = /\{ done: "finished"[^}]*\}/.exec(source)![0];
  const names = new Set([...reacts, events].flatMap((s) => [...s.matchAll(/"(\w+)"/g)].map((m) => m[1])));
  assert.ok(names.has("dig") && names.has("charged") && names.has("mindblown"), [...names].join(" "));
  for (const name of names) assert.ok(name in ACTIONS, `Talpa has no "${name}"`);
});

test("a pet on a stage in view draws itself, the canvas as sharp as the screen", () => {
  const { stage, lay, show, give } = account();
  give([chat("p/1")]);
  lay();
  show();
  stage.render();
  const pet = stage.petFor("p/1");
  const canvas = pet.canvas;
  assert.equal(canvas.width, Math.round(stage.canvasW * 2)); // devicePixelRatio 2
  assert.ok(canvas.drawn.includes("fill"), "nothing drawn");
  assert.equal(canvas.style.width, `${stage.canvasW}px`);
  stage.destroy();
});

test("a stage in view with pets keeps drawing them; a hidden one asks for no frames", () => {
  const { stage, frames, lay, show, give } = account();
  give([chat("p/1")]);
  lay();
  assert.equal(frames.asked, 0, "frames for a stage nobody sees");
  show();
  assert.equal(frames.asked, 1);
  stage.loop(); // a frame: nothing walks, but Talpa is always up to something
  assert.equal(frames.asked, 2);
  show(false);
  stage.loop();
  assert.equal(frames.asked, 2);
  stage.destroy();
});

test("a pet whose chat left waves, digs away and is gone", () => {
  const { stage, pet } = leaving();
  assert.equal(pet.talpa.run.name, "leave");
  wait(pet, 6000);
  assert.ok(!stage.pets.includes(pet), "it stayed");
  stage.destroy();
});

test("news of a chat that left doesn't keep its pet on the stage", () => {
  const { stage, pet } = leaving();
  stage.petEvent("done", "Done!", "p/1"); // (a reaction would stop it digging away)
  wait(pet, 6000);
  assert.ok(!stage.pets.includes(pet), "it stayed");
  stage.destroy();
});

test("a pet you grab on its way off the stage is held, not removed", () => {
  const { stage, pet } = leaving();
  wait(pet, 300); // waving
  pet.pickUp();
  wait(pet, 6000);
  assert.ok(stage.pets.includes(pet), "the pet vanished under the pointer");
  assert.equal(pet.held, true);
  assert.equal(pet.talpa.held, true);
  stage.destroy();
});

test("a held pet whose chat left stays in your hand and goes once it is put down", () => {
  const s = account();
  s.give([chat("p/1")]);
  s.lay();
  s.show();
  const pet = s.stage.petFor("p/1");
  wait(pet, 3000);
  pet.pickUp();
  s.give([]); // its chat left
  wait(pet, 6000);
  assert.ok(s.stage.pets.includes(pet), "it left your hand");
  pet.lift = s.stage.gu * 2;
  pet.drop();
  pet.faller.step(1e15); // the fall is over: landed
  assert.equal(pet.held, false);
  assert.ok(s.stage.pets.includes(pet), "gone before it got its bearings");
  wait(pet, 10000); // it lands, then digs away
  assert.ok(!s.stage.pets.includes(pet), "nothing sends it off once it is put down");
  s.stage.destroy();
});

test("while you hold a pet nothing moves it", () => {
  const { stage, pet, give } = leaving();
  pet.pickUp();
  pet.px = 200; // dragged away from its spot
  give([chat("p/1")]); // its chat came back: it would pop up again
  assert.equal(pet.leaving, false);
  const spot = pet.homeX;
  give([chat("p/1"), chat("p/2"), chat("p/3")]); // the row is spaced anew
  assert.notEqual(pet.homeX, spot);
  stage.petEvent("done", "Done!", "p/1");
  wait(pet, 6000);
  assert.equal(pet.stride.active, false, "it digs home while you hold it");
  assert.equal(pet.px, 200);
  assert.equal(pet.talpa.held, true);
  assert.equal(pet.talpa.run, null, "it acts while you hold it");
  stage.destroy();
});

test("a pet dropped away from its spot digs back to it", () => {
  const s = account();
  s.give([chat("p/1")]);
  s.lay();
  s.show();
  const pet = s.stage.petFor("p/1");
  wait(pet, 3000);
  pet.pickUp();
  pet.px = pet.homeX + s.stage.gu * 6;
  pet.drop();
  pet.faller.step(1e15);
  let dug = false;
  for (let i = 0; i < 200 && !dug; i++) {
    wait(pet, 50);
    dug = pet.stride.active;
  }
  assert.ok(dug, "it stays where it was dropped");
  assert.equal(pet.stride.to, pet.homeX);
  s.stage.destroy();
});

test("a pet still popping up goes to where its spot is now", () => {
  const { stage, lay, show, give } = account();
  lay(240);
  show();
  stage.firstShownTimer.fire();
  give([chat("p/1")]);
  const first = stage.petFor("p/1");
  assert.equal(first.arriving, true);
  const spot = first.homeX;
  give([chat("p/1"), chat("p/2")]); // the row is spaced anew
  assert.notEqual(first.homeX, spot);
  assert.equal(first.px, first.homeX, "pops up where its spot was");
  stage.destroy();
});
