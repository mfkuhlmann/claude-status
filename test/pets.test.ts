// The pets (webview/pets) are DOM code. Their sources are bundled here and run
// in a fresh vm context (one per test) with just enough of a fake DOM: the
// observers are triggered by hand, timers and tweens are fired and stepped by
// hand, nothing waits.

import assert from "node:assert/strict";
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
        contents: 'export { Stage } from "./webview/pets/stage";\nexport { petFields } from "./webview/util/petStage";\n',
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
  attachShadow(): FakeEl {
    return new FakeEl("#shadow-root");
  }
  animate() {
    return { play() {}, pause() {}, cancel() {}, currentTime: 0, onfinish: null };
  }
}

// A page with the pets' code loaded; a stage made in it is the only one, so its
// observers are the first (and only) ones
function load() {
  const resize: ((entries: unknown[]) => void)[] = [];
  const intersect: ((entries: unknown[]) => void)[] = [];
  let frames = 0;
  const sandbox: Record<string, unknown> = {
    document: {
      createElement: (tag: string) => new FakeEl(tag),
      addEventListener() {},
      visibilityState: "visible",
      body: new FakeEl("body"),
    },
    window: { CLAUDE_STATUS: { petsBase: "/pets", editorTab: false }, addEventListener() {} },
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
    requestAnimationFrame: () => ++frames,
    cancelAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    CSSStyleSheet: class {
      replaceSync() {}
    },
    fetch: () => Promise.reject(new Error("offline")),
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
  return { Stage: exports.Stage as Any, petFields: exports.petFields as Any, resize, intersect };
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
    lay: (width = 400) => t.resize[0]([{ contentRect: { width, height: 80 } }]),
    show: (on = true) => t.intersect[0]([{ isIntersecting: on }]),
    give: (chats: unknown[]) => stage.update({ chats, maxPets, fiveHour: 0 }),
  };
}

// A chat's pet on a stage in view, whose chat has just left the list
function leaving() {
  const s = account();
  s.give([chat("p/1")]);
  s.lay();
  s.show();
  const pet = s.stage.petFor("p/1");
  s.give([]);
  assert.equal(pet.leaving, true);
  return { ...s, pet };
}

test("the pets are told when a usage limit has reset", () => {
  // They get a chat's row only when what they show of it changed (petFields):
  // the limit's end changes nothing else, and the chat's pet went on waiting
  // for it ("battery-low") with a tooltip that said "resets in <1m"
  const { petFields } = load();
  const rows = (over: boolean) =>
    JSON.stringify({ chats: [chat("p/1", "idle", { stopped: { kind: "limit", over, resetsAt: 5 } })] }, petFields);
  assert.notEqual(rows(false), rows(true));
  assert.notEqual(rows(false), JSON.stringify({ chats: [chat("p/1", "idle")] }, petFields));
});

test("a stage that can't be seen makes no particles", () => {
  // An event ("done", "waiting"...) reaches the pets of a hidden or scrolled
  // away stage too; the particles would pile up, paused, until it's shown
  const { stage, lay, show, give } = account();
  give([chat("p/1")]);
  lay();
  const pet = stage.petFor("p/1");
  assert.equal(stage.live, false);
  stage.burst(pet, "✦", "red", 4);
  assert.equal(stage.fxLayer.children.length, 0, "particles pile up in a stage nobody sees");
  show();
  assert.equal(stage.live, true);
  stage.burst(pet, "✦", "red", 4);
  assert.equal(stage.fxLayer.children.length, 4);
  stage.destroy();
});

test("a pet you grab on its way off the stage is held, not removed", () => {
  const { stage, pet } = leaving();
  pet.leaveTimer.fire(); // the wave is over: off he goes
  assert.equal(pet.moving, true);
  pet.pickUp();
  assert.ok(stage.pets.includes(pet), "the pet vanished under the pointer");
  assert.equal(pet.held, true);
  stage.destroy();
});

test("a held pet whose chat left stays in your hand and goes once it is put down", () => {
  const { stage, pet } = leaving();
  pet.pickUp();
  pet.leaveTimer.fire(); // its time is up
  assert.equal(pet.moving, false, "walks off while you hold it");
  assert.ok(stage.pets.includes(pet));
  pet.drop();
  pet.faller.step(1e15); // the fall is over: landed
  assert.equal(pet.leaveTimer.running, true, "nothing sends it off once it is put down");
  pet.leaveTimer.fire();
  assert.equal(pet.moving, true);
  pet.stride.step(1e15); // the walk is over
  assert.ok(!stage.pets.includes(pet), "it walked off");
  stage.destroy();
});

test("a chat that comes back doesn't walk the pet you hold", () => {
  const { stage, pet, give } = leaving();
  pet.pickUp();
  pet.px = 200; // dragged away from its spot
  give([chat("p/1")]);
  assert.equal(pet.leaving, false);
  assert.equal(pet.moving, false, "walks home while you hold it");
  stage.destroy();
});

test("a pet still walking in goes to where its spot is now", () => {
  const { stage, lay, show, give } = account();
  lay(240);
  show();
  stage.firstShownTimer.fire(); // from now on newcomers walk in
  give([chat("p/1")]);
  const first = stage.petFor("p/1");
  first.enterTimer.fire(); // it steps in from the edge
  assert.equal(first.moving, true);
  assert.equal(first.offstage, true);
  const spot = first.homeX;
  give([chat("p/1"), chat("p/2")]); // the row is spaced anew
  assert.notEqual(first.homeX, spot);
  assert.equal(first.stride.to, first.homeX, "walks to where its spot was");
  stage.destroy();
});
