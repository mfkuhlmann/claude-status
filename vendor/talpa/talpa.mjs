// Talpa: the pet that lives in a burrow. One creature for the Plasma widget,
// the GNOME extension and the VS Code extension: each host calls tick(now)
// and draw(ctx) on its own 2D canvas (QML Canvas, Cairo through an adapter,
// an HTML canvas) and moves it around its stage.
//
//   const t = new Talpa({ colors, words: s => i18n(s), travels: true });
//   t.setMood('working');          // idle working agents needs done failed limit error loading
//   t.react('pet');                // an action now (see actions.mjs)
//   t.onTravel = ms => { ... };    // it dug in: move it to its new spot within ms
//   every frame: t.tick(Date.now()); then draw(ctx) in a 64 × 64 box, floor at y = 57
//
// While you hold it (setHeld) nothing else moves it; land() drops it, and it
// digs back in where it landed.
//
// Plain ES2017 (see paths.mjs).

import { tracePath } from './paths.mjs';
import * as art from './art.mjs';
import { ACTIONS, MOODS, dirt, random } from './actions.mjs';

export const BOX = 64;
export const FLOOR = 57;     // where the stage's floor is, in the box
export const TOP = 2;        // the lamp's top (highest pose), for room above
export const LILAC = art.LILAC;
export const calmColors = art.calmColors;

const KEYS = ['eyes', 'mouth', 'arms', 'plume', 'body', 'prop', 'tail', 'blush', 'think', 'orbit', 'walk', 'held', 'sip',
              'fail', 'depth', 'tunnel', 'hole', 'lamp', 'gum'];
const DEPTH = { out: -0.5, high: 6, half: 10, low: 13, peek: 19, hidden: 42, gone: 74 };
const ARMS = { rest: [16, -16], up: [150, -150], hold: [16, 35], sip: [16, 62], both: [-50, 50], chin: [16, 60], scratch: [16, -165],
               ear: [16, 153], scope: [16, -164], sign: [16, -150], balloon: [150, -16], cover: [-101, 101], juggle: [-20, 20],
               type: [-38, 38], held: [60, -60], wave: [16, -145], waveboth: [145, -145], dance: [90, -90], flail: [70, -70], throw: [16, -140] };
const BLINKING = { open: 1, wide: 1, sad: 1, tired: 1, wink: 1 };
// How often a picture is worth drawing (frameMs): quick moves want 25 a
// second, slow ones 12; at rest (breathing, the lamp's glow) 5 show it all.
// What's eased towards where it's going, and how much it moves in a tick
// (40 ms) to count as a quick move (a twentieth of it: a slow one). Sleepy
// z's float up slowly enough for 5, and a sleepy slump too.
const EASED = { depth: 0.3, hole: 0.02, armL: 1.5, armR: 1.5, armLy: 0.1, armRy: 0.1, plume: 3, lx: 0.08, ly: 0.08, sip: 0.05 };
const QUICK_BODY = { hop: 1, jump: 1, bounce: 1, wiggle: 1, shake: 1, spin: 1, jolt: 1, shiver: 1, tumble: 1, land: 1, bob: 1 };
const RESTING_BODY = { slump: 1 };   // (as slow as breathing)
const QUICK_PROPS = { phone: 1, juggle: 1 };
const SLOW_PROPS = { gum: 1, magnifier: 1 };

// ---------------------------------------------------------------- easing

const clamp01 = x => Math.max(0, Math.min(1, x));
const lerp = (a, b, p) => a + (b - a) * p;
const sine = p => 0.5 - 0.5 * Math.cos(Math.PI * p);           // ease in-out
const alt = (ms, period) => sine((ms / period) % 2 > 1 ? 2 - (ms / period) % 2 : (ms / period) % 2);
const outBack = p => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};
// value at p along [[pos, value], ...] (eased between frames)
function kf(p, frames) {
    if (p <= frames[0][0])
        return frames[0][1];
    for (let i = 1; i < frames.length; i++) {
        if (p <= frames[i][0]) {
            const a = frames[i - 1], b = frames[i];
            return lerp(a[1], b[1], sine((p - a[0]) / Math.max(1e-6, b[0] - a[0])));
        }
    }
    return frames[frames.length - 1][1];
}
const ease = (kind, p) => kind === 'in' ? p * p : kind === 'linear' ? p : 1 - (1 - p) * (1 - p);

// ---------------------------------------------------------------- body moves

// What a body move does at ms into it: whole (x, y, rotation about an
// origin) and torso (scale, rotation about its base). null: it's over.
function bodyMove(name, ms, it) {
    const once = (T, n) => ms < T * (n || 1) ? (ms % T) / T : null;
    const m = { wx: 0, wy: 0, wr: 0, ox: 32, oy: 57, sx: 1, sy: 1, tr: 0, ty: 0, torso: false };
    let p;
    switch (name) {
    case 'hop': case 'jump':
        p = once(name === 'hop' ? 550 : 800, it);
        if (p === null)
            return null;
        m.wy = kf(p, [[0, 0], [0.45, name === 'hop' ? -8 : -14], [0.8, 0], [1, 0]]);
        m.sx = kf(p, [[0, 1.06], [0.2, 0.95], [0.7, 1], [0.85, 1.07], [1, 1]]);
        m.sy = kf(p, [[0, 0.94], [0.2, 1.06], [0.7, 1], [0.85, 0.93], [1, 1]]);
        m.torso = true;
        return m;
    case 'bounce': m.wy = kf((ms % 420) / 420, [[0, 0], [0.5, -4], [1, 0]]); return m;
    case 'wiggle': m.wr = lerp(-6, 6, alt(ms, 180)); return m;
    case 'shake': m.wr = lerp(-6, 6, alt(ms, 90)); return m;
    case 'sway': m.wr = lerp(-10, 10, alt(ms, 500)); return m;
    case 'spin':
        p = once(1100);
        if (p === null)
            return null;
        if (ms < 700)
            m.wy = kf(ms / 700, [[0, 0], [0.45, -8], [0.8, 0], [1, 0]]);
        m.sx = kf(p, [[0, 1], [0.3, 1.04], [0.6, 0.98], [1, 1]]);
        m.sy = kf(p, [[0, 1], [0.3, 0.97], [0.6, 1.03], [1, 1]]);
        m.torso = true;
        m.turn = p;
        return m;
    case 'stretch':
        p = Math.min(1, ms / 1300);
        m.sx = kf(p, [[0, 1], [0.35, 0.92], [0.8, 0.92], [1, 1]]);
        m.sy = kf(p, [[0, 1], [0.35, 1.13], [0.8, 1.13], [1, 1]]);
        m.torso = true;
        return m;
    case 'inhale':
        p = sine(Math.min(1, ms / 450));
        m.sx = lerp(1, 0.95, p);
        m.sy = lerp(1, 1.08, p);
        m.torso = true;
        return m;
    case 'jolt':
        p = once(400);
        if (p === null)
            return null;
        m.sx = kf(p, [[0, 0.95], [0.25, 1.14], [1, 1]]);
        m.sy = kf(p, [[0, 1.08], [0.25, 0.85], [1, 1]]);
        m.wx = kf(p, [[0, 0], [0.25, -3], [1, 0]]);
        m.torso = true;
        return m;
    case 'shiver': m.wx = lerp(-0.7, 0.7, alt(ms, 70)); return m;
    case 'nod':
        p = (ms % 1700) / 1700;
        m.tr = kf(p, [[0, 0], [0.45, 0], [0.72, 7], [0.8, 1], [1, 0]]);
        m.ty = kf(p, [[0, 0], [0.45, 0], [0.72, 1], [0.8, 0], [1, 0]]);
        m.torso = true;
        return m;
    case 'slump':
        p = (ms % 3600) / 3600;
        m.sx = kf(p, [[0, 1.05], [0.5, 1.07], [1, 1.05]]);
        m.sy = kf(p, [[0, 0.92], [0.5, 0.9], [1, 0.92]]);
        m.wy = 1;
        m.torso = true;
        return m;
    case 'tumble':
        p = once(1000);
        if (p === null)
            return null;
        m.oy = 40;
        m.wy = kf(p, [[0, 0], [0.25, -12], [0.75, -6], [1, 0]]);
        m.wr = kf(p, [[0, 0], [0.25, 0], [0.75, 340], [1, 360]]);
        return m;
    case 'float':
        m.wy = lerp(-6, -12, alt(ms, 1400));
        m.wr = lerp(-3, 3, alt(ms, 1400));
        m.shadow = 0.6;
        return m;
    case 'trip':
        p = Math.min(1, ms / 1500);
        m.ox = 47;
        m.wr = kf(p, [[0, 0], [0.12, -8], [0.32, 82], [0.7, 82], [1, 0]]);
        return m;
    case 'land':
        p = once(400);
        if (p === null)
            return null;
        m.sx = lerp(1.14, 1, sine(p));
        m.sy = lerp(0.84, 1, sine(p));
        m.torso = true;
        return m;
    case 'bob':
        p = (ms % 460) / 460;
        m.wr = kf(p, [[0, -2.5], [0.5, 2.5], [1, -2.5]]);
        m.wy = kf(p, [[0, 0], [0.5, -1.8], [1, 0]]);
        return m;
    default:
        return null;
    }
}

// The arms' angles for poses that move by themselves (null: a still pose)
function armMove(name, ms) {
    switch (name) {
    case 'wave': return [16, lerp(-120, -170, alt(ms, 380)), 0, 0];
    case 'waveboth': return [lerp(120, 170, alt(ms + 170, 340)), lerp(-120, -170, alt(ms, 340)), 0, 0];
    case 'sign': return [16, lerp(-138, -160, alt(ms, 500)), 0, 0];
    case 'type': {
        const l = alt(ms, 130), r = alt(ms + 130, 130);
        return [lerp(-38, -31, l), lerp(38, 31, r), -1.4 * l, -1.4 * r];
    }
    case 'juggle': return [lerp(-20, -6, alt(ms, 375)), lerp(20, 6, alt(ms + 190, 375)), -2 * alt(ms, 375), -2 * alt(ms + 190, 375)];
    case 'dance': return [lerp(30, 145, alt(ms, 500)), lerp(-145, -30, alt(ms, 500)), 0, 0];
    case 'flail': return [lerp(50, 95, alt(ms, 180)), lerp(-50, -95, alt(ms, 180)), 0, 0];
    case 'scratch': return [16, lerp(-158, -172, alt(ms, 160)), 0, 0];
    case 'throw': return [16, kf(Math.min(1, ms / 550), [[0, -16], [0.35, 30], [0.75, -175], [1, -140]]), 0, 0];
    default: return null;
    }
}

function plumeAngle(name, ms, it) {
    switch (name) {
    case 'up': return -22;
    case 'droop': return 66;
    case 'bob': return kf((ms % 1100) / 1100, [[0, -9], [0.5, 11], [1, -9]]);
    case 'twirl': return ms < 800 * (it || 1) ? ((ms % 800) / 800) * 360 : 0;
    case 'flick': return ms < 400 ? kf(ms / 400, [[0, 0], [0.4, -45], [1, 0]]) : 0;
    case 'wild': return lerp(-24, 14, alt(ms, 160));
    default: return 0;
    }
}

// ---------------------------------------------------------------- the creature

export class Talpa {
    constructor(opts) {
        opts = opts || {};
        this.colors = opts.colors || art.LILAC;
        this.theme = opts.theme || { fx: '#7d87a3', text: '#161a24' };
        this.words = opts.words || (s => s);
        this.travels = !!opts.travels;    // may dig over to another spot (the host moves it: onTravel)
        this.onTravel = null;
        this.facingLeft = false;
        this.mood = 'idle';
        this.base = Object.assign({}, MOODS.idle.base);
        this.st = {};
        this.since = {};          // when each part last changed (ms)
        this.now = 0;
        this.last = 0;
        this.run = null;          // the action under way: {name, steps, i, until, done, auto}
        this.lastAuto = '';
        this.nextBrain = 0;
        this.brainOn = opts.brain !== false;
        this.held = false;
        this.heldAt = 0;
        this.frameMs = 40;        // see tick()
        this.away = false;        // it left (leave): it stays down there until it arrives again
        this.fx = [];
        this.v = { depth: DEPTH.half, depthFrom: DEPTH.half, depthTo: DEPTH.half, depthAt: -1e9, hole: 1, holeFrom: 1, holeTo: 1,
                   holeAt: -1e9, armL: 16, armR: -16, plume: 0, lx: 0, ly: 0, sip: 0 };
        this.blinkUntil = 0;
        this.nextBlink = 0;
        this.glance = [0, 0];
        this.nextGlance = 0;
        this.apply({}, true);
    }

    // ------------------------------------------------------------ what the host calls

    setColors(colors) {
        this.colors = colors || art.LILAC;
    }

    setTheme(theme) {
        this.theme = theme;
    }

    setMood(mood) {
        if (!MOODS[mood] || mood === this.mood)
            return;
        this.mood = mood;
        this.base = Object.assign({}, MOODS[mood].base);
        this.lastAuto = '';
        if (this.held)
            return;
        if (!this.run || this.run.auto)
            this.cancel();
        if (!this.run)
            this.apply({});
        this.nextBrain = this.now + random.rnd(200, 700);
    }

    // An action now: a reaction to you or to an event (done(true) when it ran to the end)
    react(name, done) {
        if (this.held || !ACTIONS[name]) {
            if (done)
                done(false);
            return;
        }
        this.play(name, done, false);
    }

    get busy() {
        return this.run !== null || this.held;
    }

    // Grabbed: out of the burrow, flailing; nothing else moves it until land()
    setHeld(held) {
        if (!held)
            return;
        this.cancel();
        this.held = true;
        this.heldAt = this.now;
        this.apply({ depth: 'out', hole: 0, held: 1, arms: 'flail', eyes: 'wide', mouth: 'o', body: '', fx: dirt(8, 16) });
        // pulled out at once (a creature half in a hole that closes would show where there's no hole)
        const v = this.v;
        v.depth = v.depthFrom = v.depthTo = DEPTH.out;
    }

    // Dropped from `height` box units: lands, maybe dizzy, then digs in right there
    land(height, done) {
        this.held = false;
        const high = height > 40;
        this.play({ steps: () => [
            { depth: 'out', hole: 0, body: 'land', eyes: high ? 'spiral' : 'happy', mouth: high ? 'wavy' : 'smile', orbit: high ? 1 : 0,
              t: high ? 1800 : 700 },
            { depth: 'out', hole: 1, eyes: 'open', mouth: 'flat', look: [-1.5, 0.5], t: 500 },   // the hole opens under it first
            { body: 'spin', eyes: 'squint', fx: dirt(10), t: 700 },
            { eyes: 'happy', t: 500 }] }, done, false);
    }

    // Shown at rest in a pose right away, no motion in between (icons, previews)
    pose(step) {
        this.cancel();
        this.apply(step || {}, true);
        this.nextBlink = this.now + 1e9;   // eyes open for a still picture
        this.nextGlance = this.now + 1e9;
        this.glance = [0, 0];
        const look = this.st.look || [0, 0];
        this.v.lx = look[0];
        this.v.ly = look[1];
    }

    // ------------------------------------------------------------ steps

    play(nameOrDef, done, auto) {
        const def = typeof nameOrDef === 'string' ? ACTIONS[nameOrDef] : nameOrDef;
        this.cancel();
        if (nameOrDef === 'arrive')
            this.away = false;
        if (!def) {
            if (done)
                done(false);
            return;
        }
        const keep = def.keep || {};
        const steps = def.steps(this.words).map(s => Object.assign({}, keep, s));
        this.run = { name: typeof nameOrDef === 'string' ? nameOrDef : '', steps: steps, i: -1, until: 0, done: done || null, auto: !!auto };
        this.next();
    }

    cancel() {
        const r = this.run;
        this.run = null;
        if (r && r.done)
            r.done(false);
    }

    next() {
        const r = this.run;
        r.i += 1;
        if (r.i >= r.steps.length) {
            this.run = null;
            if (r.name === 'leave')
                this.away = true;
            this.apply({});
            const p = (MOODS[this.mood] || MOODS.idle).pause;
            this.nextBrain = this.now + random.rnd(p[0], p[1]);
            if (r.done)
                r.done(true);
            return;
        }
        const step = r.steps[r.i];
        r.until = this.now + (step.t || 600);
        this.apply(step, step.snap === 1);
        if (step.travel && this.onTravel)
            this.onTravel(step.t || 1500);
    }

    apply(step, snap) {
        const prev = this.st, st = {};
        for (const k of KEYS) {
            const v = step[k] !== undefined ? step[k] : this.base[k];
            st[k] = v === undefined || v === null ? '' : String(v);
            if (st[k] !== prev[k] || (step[k] !== undefined && (k === 'body' || k === 'plume' || k === 'arms')))
                this.since[k] = this.now;
        }
        if (this.away && step.depth === undefined) {
            st.depth = 'gone';   // (left: not back up by itself)
            st.hole = '0';
        }
        st.it = step.it || 1;
        st.look = step.look || this.base.look || null;
        if (step.gum)
            st.gum = String(step.gum);
        this.st = st;
        const depth = DEPTH[st.depth] !== undefined ? DEPTH[st.depth] : DEPTH.half;
        // (out for a moment, a jump or a sneeze, its hole stays: only held or
        // tunnelling it has none)
        const hole = st.hole === '0' ? 0 : 1;
        const v = this.v;
        if (snap) {
            v.depth = v.depthFrom = v.depthTo = depth;
            v.hole = v.holeFrom = v.holeTo = hole;
            const a = ARMS[st.arms] || ARMS.rest;
            v.armL = a[0];
            v.armR = a[1];
            v.plume = plumeAngle(st.plume, 0, 1);
        } else {
            if (depth !== v.depthTo) {
                v.depthFrom = v.depth;
                v.depthTo = depth;
                v.depthAt = this.now;
            }
            if (hole !== v.holeTo) {
                v.holeFrom = v.hole;
                v.holeTo = hole;
                v.holeAt = this.now;
            }
        }
        for (const f of (step.fx || [])) {
            const o = f[3] || {};
            this.fx.push({ kind: f[0], x: f[1], y: f[2], o: o, born: this.now + (o.delay || 0) * 1000 });
        }
    }

    // ------------------------------------------------------------ time

    tick(now) {
        const dt = this.last ? Math.min(100, Math.max(0, now - this.last)) : 0;
        this.last = now;
        this.now = now;
        if (this.run && now >= this.run.until)
            this.next();
        if (!this.run && !this.held && this.brainOn && now >= this.nextBrain)
            this.think();
        if (this.held && now - this.heldAt > 2200 && this.st.eyes !== 'tiny') {
            this.st.eyes = 'tiny';     // held up for long: scared
            this.st.mouth = 'wavy';
        }
        const v = this.v, st = this.st;
        const before = {};
        for (const key in EASED)
            before[key] = v[key] || 0;
        // the burrow depth: pops up with a little overshoot, sinks smoothly
        const dp = clamp01((now - v.depthAt) / 450);
        v.depth = lerp(v.depthFrom, v.depthTo, v.depthTo > v.depthFrom && v.depthTo >= DEPTH.hidden ? dp * dp : outBack(dp));
        const hp = clamp01((now - v.holeAt) / 350);
        v.hole = lerp(v.holeFrom, v.holeTo, v.holeTo > v.holeFrom ? outBack(hp) : hp);
        // arms, lamp stalk, eyes: eased towards where they're going
        const k = tau => 1 - Math.exp(-dt / tau);
        const moving = armMove(st.arms, now - (this.since.arms || 0));
        const target = moving || ARMS[st.arms] || ARMS.rest;
        v.armL += (target[0] - v.armL) * k(moving ? 40 : 70);
        v.armR += (target[1] - v.armR) * k(moving ? 40 : 70);
        v.armLy = moving ? moving[2] : 0;
        v.armRy = moving ? moving[3] : 0;
        const plumeTarget = st.tunnel === '1' ? plumeAngle('wild', now, 1) : plumeAngle(st.plume, now - (this.since.plume || 0), Number(st.it));
        v.plume = st.plume === 'twirl' || st.plume === 'wild' || st.tunnel === '1' ? plumeTarget : v.plume + (plumeTarget - v.plume) * k(70);
        v.sip += ((st.sip === '1' ? 1 : 0) - v.sip) * k(90);
        // glances and blinks of its own
        if (now >= this.nextGlance) {
            this.glance = st.prop || Math.random() < 0.4 ? [0, 0] : [random.rnd(-1.6, 1.6), random.rnd(-1, 0.8)];
            this.nextGlance = now + random.rnd(900, 3200);
        }
        const look = st.look || this.glance;
        v.lx += (look[0] - v.lx) * k(90);
        v.ly += (look[1] - v.ly) * k(90);
        if (!this.nextBlink)
            this.nextBlink = now + random.rnd(1200, 4000);   // not straight away
        if (now >= this.nextBlink && BLINKING[st.eyes]) {
            this.blinkUntil = now + 110;
            this.nextBlink = now + (Math.random() < 0.22 ? 250 : random.rnd(1800, 5200));
        }
        this.fx = this.fx.filter(p => now - p.born < (p.o.dur || 1.6) * 1000);
        // How often the host should draw it now (each picture costs)
        let quick = false, slow = false;
        for (const key in EASED) {
            const moved = Math.abs((v[key] || 0) - before[key]) * 40 / Math.max(dt, 1);
            quick = quick || moved > EASED[key];
            slow = slow || moved > EASED[key] / 20;
        }
        const body = st.body === '' ? null : st.body === 'fast' ? true : bodyMove(st.body, now - (this.since.body || 0), Number(st.it));
        quick = quick || this.held || st.walk === '1' || QUICK_PROPS[st.prop] === 1 || (body !== null && QUICK_BODY[st.body] === 1)
            || (BLINKING[st.eyes] === 1 && now >= this.nextBlink - 45) || now < this.blinkUntil + 45;
        slow = slow || (body !== null && RESTING_BODY[st.body] !== 1) || this.fx.some(p => p.kind !== 'z') || st.tunnel === '1' || st.orbit === '1'
            || st.think === '1' || SLOW_PROPS[st.prop] === 1;
        this.frameMs = quick ? 40 : slow ? 80 : 200;
    }

    think() {
        if (this.away) {
            this.nextBrain = this.now + 2000;
            return;
        }
        const pool = Object.assign({}, (MOODS[this.mood] || MOODS.idle).pool);
        if (!this.travels || !this.onTravel)
            delete pool.dig;
        delete pool[this.lastAuto];
        const names = Object.keys(pool);
        if (!names.length) {
            this.nextBrain = this.now + 2000;
            return;
        }
        let r = Math.random() * names.reduce((s, n) => s + pool[n], 0);
        let name = names[0];
        for (const n of names) {
            r -= pool[n];
            if (r < 0) {
                name = n;
                break;
            }
        }
        this.lastAuto = name;
        this.play(name, null, true);
    }

    // ------------------------------------------------------------ drawing

    // Draws the 64 × 64 box at the context's current transform
    draw(ctx) {
        const now = this.now, st = this.st, v = this.v, pal = this.colors;
        const ms = key => now - (this.since[key] || 0);
        const move = bodyMove(st.body, ms('body'), Number(st.it)) || {};
        ctx.save();
        if (this.facingLeft) {
            ctx.translate(BOX, 0);
            ctx.scale(-1, 1);
        }
        // its shadow when it's out on the floor
        if (st.depth === 'out' && v.depth < 3) {
            ctx.save();
            art.about(ctx, 32, 57.6, 0, st.held === '1' ? 0.5 : move.shadow || 1, 1);
            art.ellipse(ctx, 32, 57.6, 15, 2.1, 'rgba(20,25,45,0.16)');
            ctx.restore();
        }
        const tunneling = st.tunnel === '1';
        if (!tunneling && v.hole > 0.02) {
            ctx.save();
            art.about(ctx, 32, 56, 0, lerp(0.05, 1, Math.min(1.1, v.hole)), lerp(0.2, 1, Math.min(1.1, v.hole)));
            ctx.globalAlpha = clamp01(v.hole);
            art.holeBack(ctx);
            ctx.restore();
        }
        // the creature, cut along the burrow (art.traceCut) while it's in it or
        // its hole is there (out for a moment, its feet would hang in the hole)
        ctx.save();
        const holed = !tunneling && v.hole > 0.02;
        if (st.depth !== 'out' || v.depth > 0 || holed) {
            const h = holed ? Math.min(1.1, v.hole) : 1;
            ctx.beginPath();
            art.traceCut(ctx, lerp(0.05, 1, h), lerp(0.2, 1, h));
            ctx.clip();
        }
        ctx.translate(0, v.depth);
        this.drawCreature(ctx, now, st, v, pal, move, ms);
        ctx.restore();
        if (tunneling) {
            ctx.save();
            const p = alt(now, 260);
            art.about(ctx, 32, 61.4, 0, lerp(1, 1.08, p), lerp(0.9, 1.1, p));
            art.tunnel(ctx);
            ctx.restore();
        } else if (v.hole > 0.02) {
            ctx.save();
            art.about(ctx, 32, 56, 0, lerp(0.05, 1, Math.min(1.1, v.hole)), lerp(0.2, 1, Math.min(1.1, v.hole)));
            ctx.globalAlpha = clamp01(v.hole);
            art.holeFront(ctx);
            ctx.restore();
        }
        ctx.restore();
        this.drawParticles(ctx, now);
    }

    drawCreature(ctx, now, st, v, pal, move, ms) {
        // the whole creature: hops, sways, tumbles
        ctx.save();
        ctx.translate(move.wx || 0, move.wy || 0);
        if (st.walk === '1')
            ctx.translate(0, -1.3 * alt(now, 250));
        if (move.wr)
            art.about(ctx, move.ox || 32, move.oy || 57, move.wr);
        if (st.depth === 'out')
            this.drawTail(ctx, now, st, pal, ms);
        let feet = null;
        if (st.held === '1')
            feet = [lerp(-18, 18, alt(now, 450)), lerp(-18, 18, alt(now + 225, 450)), 0, 0];
        else if (st.walk === '1')
            feet = [0, 0, kf((now % 500) / 500, [[0, 0], [0.25, -2.4], [0.5, 0], [1, 0]]), kf(((now + 250) % 500) / 500, [[0, 0], [0.25, -2.4], [0.5, 0], [1, 0]])];
        // feet stand on the ground: over its hole they'd hang in it (unless it jumps clear)
        if (st.tunnel === '1' || v.hole <= 0.02 || (move.wy || 0) < -3)
            art.feet(ctx, pal, feet);
        // the torso: breathing, squash and stretch
        ctx.save();
        if (move.torso) {
            ctx.translate(0, move.ty || 0);
            art.about(ctx, 32, 55, move.tr || 0, move.sx, move.sy);
        } else {
            const p = (now % (st.body === 'fast' ? 600 : 2800)) / (st.body === 'fast' ? 600 : 2800);
            art.about(ctx, 32, 55, 0, kf(p, [[0, 1], [0.5, 1.022], [1, 1]]), kf(p, [[0, 1], [0.5, 0.978], [1, 1]]));
        }
        this.drawLamp(ctx, now, st, v, pal, move);
        art.body(ctx, pal);
        if (st.prop === 'headphones') {
            ctx.save();
            ctx.translate(0, art.PLUME_Y);
            art.headphones(ctx);
            ctx.restore();
        }
        this.drawFace(ctx, now, st, v, pal, move, ms);
        art.propBack(ctx, st.prop, now, this.theme.fx, v.sip, art.FACE_Y);
        this.drawArm(ctx, 14.5, v.armL, v.armLy || 0, pal, st.prop === 'balloon' ? 'balloon' : '', now);
        this.drawArm(ctx, 49.5, v.armR, v.armRy || 0, pal, st.prop === 'sign' ? 'sign' : '', now);
        art.propFront(ctx, st.prop, now, ms('prop'), { fail: st.fail === '1', gum: Number(st.gum) || 2000 });
        if (st.think === '1')
            art.think(ctx, now, this.theme.fx);
        ctx.restore();
        if (st.prop === 'juggle')
            art.juggle(ctx, now);
        if (st.prop === 'battery')
            art.battery(ctx, now, this.theme.fx);
        if (st.orbit === '1') {
            ctx.save();
            ctx.translate(0, art.PLUME_Y);
            art.orbit(ctx, now);
            ctx.restore();
        }
        ctx.restore();
    }

    drawTail(ctx, now, st, pal, ms) {
        let a = lerp(-6, 9, alt(now, 2400));
        if (st.tail === 'wag')
            a = lerp(-16, 22, alt(now, 200));
        else if (st.tail === 'droop')
            a = 38;
        else if (st.tail === 'up')
            a = -30;
        ctx.save();
        art.about(ctx, 48.5, 50.5, a);
        art.tail(ctx, pal);
        ctx.restore();
    }

    drawLamp(ctx, now, st, v, pal, move) {
        const lamp = art.LAMP[st.lamp] || art.LAMP.idle;
        let glow = alt(now, st.lamp === 'needs' ? 700 : 2400), flicker = 1;
        if (st.lamp === 'limit') {
            glow = 0;
            const p = (now % 1600) / 1600;
            flicker = p < 0.75 ? 1 : p < 0.85 ? 0.3 : p < 0.9 ? 0.9 : 0.2;
        }
        ctx.save();
        ctx.translate(0, art.PLUME_Y);
        art.about(ctx, 31.4, 25.6, v.plume);
        if (move.turn !== undefined)
            art.about(ctx, 31.4, 25.6, 0, kf(move.turn, [[0, 1], [0.32, -1], [0.46, -1], [0.8, 1], [1, 1]]), 1);
        art.plume(ctx, pal, lamp, glow, flicker);
        ctx.restore();
    }

    drawFace(ctx, now, st, v, pal, move, ms) {
        ctx.save();
        ctx.beginPath();
        tracePath(ctx, art.BODY);
        ctx.clip();
        ctx.translate(0, art.FACE_Y);
        if (move.turn !== undefined) {
            const p = move.turn;
            const tx = p < 0.22 ? lerp(0, 13, p / 0.22) : p < 0.32 ? lerp(13, 27, (p - 0.22) / 0.1)
                     : p < 0.46 ? -27 : p < 0.58 ? lerp(-27, -13, (p - 0.46) / 0.12) : p < 0.8 ? lerp(-13, 0, sine((p - 0.58) / 0.22)) : 0;
            const sx = p < 0.22 ? lerp(1, 0.55, p / 0.22) : p < 0.32 ? lerp(0.55, 0.3, (p - 0.22) / 0.1)
                     : p < 0.46 ? 0.3 : p < 0.58 ? lerp(0.3, 0.55, (p - 0.46) / 0.12) : p < 0.8 ? lerp(0.55, 1, sine((p - 0.58) / 0.22)) : 1;
            ctx.translate(tx, 0);
            art.about(ctx, 32, 40, 0, sx, 1);
        }
        if (st.blush === '1')
            art.blush(ctx);
        const blink = now < this.blinkUntil ? 0.08 : 1;
        // a magnifier or telescope covers the right eye with its own
        art.eyes(ctx, pal, st.eyes || 'open', [v.lx, v.ly], blink, now);
        art.mouth(ctx, st.mouth);
        ctx.restore();
    }

    drawArm(ctx, x, angle, dy, pal, holds, now) {
        ctx.save();
        ctx.translate(x, 41 + dy);
        ctx.rotate(angle * Math.PI / 180);
        art.arm(ctx, pal);
        if (holds === 'balloon')
            art.balloon(ctx, lerp(-6, 6, alt(now, 1600)));
        else if (holds === 'sign')
            art.sign(ctx);
        ctx.restore();
    }

    drawParticles(ctx, now) {
        for (const p of this.fx) {
            const o = p.o, life = (o.dur || 1.6) * 1000, q = (now - p.born) / life;
            if (q < 0 || q > 1)
                continue;
            let x = p.x, y = p.y, s = 1, rot = 0, a = 1;
            if (o.path === 'fly') {
                const pts = [[0, 0], [-14, -9], [-4, -19], [9, -7], [1, -15], [-8, -26]];
                const seg = Math.min(4.999, q * 5), i = Math.floor(seg), f = sine(seg - i);
                x += lerp(pts[i][0], pts[i + 1][0], f);
                y += lerp(pts[i][1], pts[i + 1][1], f);
                a = q < 0.08 ? q / 0.08 : q > 0.85 ? (1 - q) / 0.15 : 1;
            } else if (o.path === 'plane') {
                const pts = [[0, 0, 0, 0], [0.4, 28, -14, -10], [0.7, 50, -5, 14], [1, 78, -20, -6]];
                let i = 1;
                while (i < 3 && q > pts[i][0])
                    i++;
                const f = sine((q - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]));
                x += lerp(pts[i - 1][1], pts[i][1], f);
                y += lerp(pts[i - 1][2], pts[i][2], f);
                rot = lerp(pts[i - 1][3], pts[i][3], f);
                a = q > 0.7 ? (1 - q) / 0.3 : 1;
            } else if (o.path === 'crawl') {
                x -= 14 * q;
                y -= q < 0.5 ? 2 * q : 2 * (1 - q);
                a = q < 0.15 ? q / 0.15 : q > 0.85 ? (1 - q) / 0.15 : 1;
            } else if (o.path === 'pop') {
                s = lerp(0.4, 1.5, q);
                a = 1 - q;
            } else if (o.path === 'bulb') {
                s = q < 0.25 ? lerp(0, 1.25, q / 0.25) : q < 0.4 ? lerp(1.25, 1, (q - 0.25) / 0.15) : 1;
                a = q > 0.85 ? (1 - q) / 0.15 : 1;
            } else if (p.kind === 'clod') {
                const dx = o.dx || 0;
                x += q < 0.45 ? dx * 0.55 * (q / 0.45) : lerp(dx * 0.55, dx, (q - 0.45) / 0.55);
                y += q < 0.45 ? -9 * (1 - (1 - q / 0.45) * (1 - q / 0.45)) : lerp(-9, 3, ((q - 0.45) / 0.55) * ((q - 0.45) / 0.55));
                a = 1 - q;
            } else {
                const e = ease(o.ease, q);
                x += (o.dx || 0) * e;
                y += (o.dy === undefined ? -12 : o.dy) * e;
                s = lerp(o.s0 === undefined ? 0.6 : o.s0, o.s1 === undefined ? 1 : o.s1, e);
                rot = (o.rot || 0) * e;
                a = q < 0.15 ? q / 0.15 : q > 0.7 ? (1 - q) / 0.3 : 1;
            }
            ctx.save();
            ctx.globalAlpha = ctx.globalAlpha * clamp01(a);
            ctx.translate(this.facingLeft ? BOX - x : x, y);
            if (rot)
                ctx.rotate((this.facingLeft ? -rot : rot) * Math.PI / 180);
            const k = s * (o.scale || 1);
            ctx.scale(this.facingLeft && p.kind !== 'text' && p.kind !== 'z' ? -k : k, k);
            art.particle(ctx, p.kind, o, now, this.theme);
            ctx.restore();
        }
    }
}
