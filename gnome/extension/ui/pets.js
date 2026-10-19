// The pets (port of the Plasma widget's PetStrip.qml and Pet.qml).
//
// The hero: the big Clawd at the top of the popup, on a stage lit in the
// whole dashboard's mood (orange and pulsing when a chat needs you, the
// accent while chats work, green when it's your turn, a starry night once
// everything is done), with a headline and the session counts.
//
// An account's stage: one pet per chat in its list (up to `chat-pets`). A pet
// wears the chat's name on a tag in the chat's color (the chat's row gets a
// bar in that color), acts the chat out, opens it when clicked, and keeps its
// spot until the chat leaves the list; then it waves and walks off.
//
// The poses are still images here (St draws SVGs without their animations);
// the pets live through moving, hopping, breathing and their reactions.
// Nothing moves while the popup is closed.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import * as L from '../logic.js';
import {box, dot, label, link} from './widgets.js';

// Colors that stay apart from each other on light and dark themes
const PALETTE = ['#e5534b', '#e8913a', '#c9a227', '#4caf50', '#26a69a', '#42a5f5', '#7e57c2', '#ec407a'];
// All poses share the viewBox -15 -25 45 45: the character is centred, 15
// units wide and ~11 tall, standing 41/45 down the image.
const FEET = 41 / 45;
const MOOD_COLORS = {waving: [245, 121, 0], error: [232, 68, 58], 'idle-living': [51, 184, 108]};
const NIGHT = [99, 113, 200];

const WORK_POSES = ['working-typing', 'working-thinking', 'coding', 'working-testing', 'working-reviewing',
    'working-debugger', 'working-building', 'working-tool-calling', 'working-deploying', 'working-rubber-duck',
    'working-wizard'];
const AGENT_POSES = ['working-juggling', 'working-conducting', 'working-pairing'];
const WAIT_POSES = ['waving', 'working-oncall', 'notification', 'mail', 'working-beacon', 'praying'];
const HOBBIES = [
    ['reading', 'Reading the docs…'], ['music', '♪'], ['gaming', ''], ['meditating', 'Ommm…'], ['yoga', ''],
    ['eating', 'Snack time!'], ['ice-cream', ''], ['painting', ''], ['gardening', ''],
    ['studying', 'Learning new tricks.'], ['singing', '♪ ♫'], ['telescope', 'Any bugs out there?'], ['peeking', ''],
    ['photography', 'Say cheese!'], ['drumming', ''], ['magic', 'Ta-da!'], ['chef', ''], ['idea', 'I have an idea!'],
    ['cool', ''], ['bored', 'So quiet…'], ['shrug', ''], ['hopeful', ''], ['flexing', ''], ['skeptical', ''],
    ['going-away', 'Brb!'],
];

function pick(list, last) {
    const choices = list.length > 1 ? list.filter(x => x !== last) : list;
    return choices[Math.floor(Math.random() * choices.length)];
}

// Seasons (northern hemisphere, by month) and a few days of the year
function seasonPose() {
    const m = new Date().getMonth();
    return m === 11 || m <= 1 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn';
}

function holidayGreeting() {
    const d = new Date(), m = d.getMonth() + 1, day = d.getDate();
    if ((m === 12 && day === 31) || (m === 1 && day === 1))
        return ['new-year', 'Happy New Year!'];
    if (m === 12 && day >= 24 && day <= 26)
        return ['christmas', 'Merry Christmas!'];
    if (m === 10 && day === 31)
        return ['halloween', 'Boo! Happy Halloween!'];
    if (m === 2 && day === 14)
        return ['valentine', "Happy Valentine's Day!"];
    return ['', ''];
}

function colorHash(key) {
    let h = 0;
    for (let i = 0; i < key.length; i++)
        h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return h;
}

// GLib timers that all stop together
class Timers {
    constructor() {
        this._ids = new Map();
    }

    after(name, ms, fn) {
        this.stop(name);
        this._ids.set(name, GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, Math.round(ms)), () => {
            this._ids.delete(name);
            fn();
            return GLib.SOURCE_REMOVE;
        }));
    }

    every(name, ms, fn) {
        this.stop(name);
        this._ids.set(name, GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            fn();
            return GLib.SOURCE_CONTINUE;
        }));
    }

    running(name) {
        return this._ids.has(name);
    }

    stop(name) {
        const id = this._ids.get(name);
        if (id) {
            GLib.source_remove(id);
            this._ids.delete(name);
        }
    }

    stopAll() {
        for (const id of this._ids.values())
            GLib.source_remove(id);
        this._ids.clear();
    }
}

// ---------------------------------------------------------------- one pet

class Pet {
    constructor(stage, key, opts) {
        this.stage = stage;
        this.key = key;                  // the chat's pet key ("" for the hero)
        this.lone = key === '';
        this.tint = opts.tint || '';
        this.label = opts.label || '';
        this.host = opts.host || '';
        this.chat = null;
        this.lastChat = null;
        this.leaving = false;
        this.offstage = false;
        this.moving = false;
        this.running = false;
        this.facingLeft = false;
        this.action = '';
        this.reaction = '';
        this.reactionUntil = 0;
        this.clicks = 0;
        this.lastMood = '';
        this.lastHobby = '';
        this.workPose = pick(WORK_POSES, '');
        this.agentPose = 'working-juggling';
        this.waitPose = 'working-oncall';   // the alert sign first: it reads best
        this.timers = new Timers();
        this._pose = '';

        const s = stage.size;
        this.actor = new St.Widget({reactive: true, track_hover: true, width: s.slot, height: s.image + s.tag});
        this.shadow = new St.Widget({style_class: 'claude-pet-shadow'});
        this.actor.add_child(this.shadow);
        this.image = new St.Icon({icon_size: s.imageLogical, width: s.image, height: s.image,
            x: (s.slot - s.image) / 2, pivot_point: new Graphene.Point({x: 0.5, y: FEET})});
        this.actor.add_child(this.image);
        if (!this.lone) {
            const dark = this.tint && this._luma(this.tint) < 0.6;
            this._tagStyle = `background-color: ${this.tint}; color: ${dark ? 'white' : 'black'};`;
            this.tag = new St.Label({text: this.label, style_class: 'claude-pet-tag'});
            this.setTagWidth(s.slot - 4);
            this.tag.clutter_text.ellipsize = 3;   // Pango.EllipsizeMode.END
            this.actor.add_child(this.tag);
            this.tag.connect('notify::width', () => this._placeTag());
        }
        const ring = this.lone ? [s.body * 1.25, s.gu * 0.5] : [s.body * 1.15, s.gu * 0.42];
        this.shadow.set_size(ring[0], ring[1]);
        this.shadow.set_position((s.slot - ring[0]) / 2, s.image * FEET - ring[1] / 2);
        this.shadow.style = this.lone ? 'background-color: rgba(127,127,127,0.25);'
            : `background-color: ${this.tint}; border-radius: ${ring[1] / 2}px;`;
        this.shadow.opacity = this.lone ? 255 : 115;

        this.actor.connect('destroy', () => {
            this.gone = true;   // with the popup (or the whole shell)
            this.timers.stopAll();
        });
        this.actor.connect('button-press-event', (a, event) => {
            this._clickCount = event.get_click_count();
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('button-release-event', () => {
            if (this._clickCount === 2 && this.lone)
                this.dance();
            else
                this.clicked();
            return Clutter.EVENT_STOP;
        });
        if (!this.lone) {
            stage.ctx.tips.add(this.actor, () => this.lastChat
                ? [(this.host ? `${this.host}: ` : '') + this.lastChat.name,
                    `${L.stateText(this.lastChat, stage.ctx.now)}\nClick to open this chat`] : '');
        }
    }

    _luma(hex) {
        const n = parseInt(hex.slice(1), 16);
        return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
    }

    // The name tag fits the room between pets
    setTagWidth(width) {
        width = Math.round(width);
        if (!this.tag || width === this._tagWidth)
            return;
        this._tagWidth = width;
        this.tag.style = `${this._tagStyle} max-width: ${width}px;`;
    }

    _placeTag() {
        const s = this.stage.size;
        this.tag.set_position(Math.round((s.slot - this.tag.width) / 2), Math.round(s.image * FEET + 2));
    }

    get px() {
        return this.actor.x + this.stage.size.slot / 2;
    }

    set px(x) {
        this.actor.x = Math.round(x - this.stage.size.slot / 2);
    }

    get live() {
        return this.stage.live;
    }

    get mood() {
        if (this.lone)
            return this.stage.ctxMood;
        const c = this.chat;
        if (!c)
            return this.leaving ? 'waving' : 'sleeping';   // its chat left the list: bye
        if (c.state === 'waiting')
            return 'waving';
        if (c.state === 'working')
            return c.agents && c.agents.running > 0 ? 'working-juggling' : 'working-typing';
        if (c.state === 'idle')
            return 'idle-living';                         // ready for your next message
        return c.reason === 'failed' ? 'sad' : 'sleeping';   // done: results to look at
    }

    get pose() {
        if (this.reaction)
            return this.reaction;
        if (this.moving)
            return this.running ? 'running' : 'crab-walking';
        if (this.action)
            return this.action;
        const mood = this.mood;
        return mood === 'working-typing' ? this.workPose : mood === 'working-juggling' ? this.agentPose
            : mood === 'waving' ? this.waitPose : mood;
    }

    // Shows the pose, direction and height off the ground
    sync() {
        if (this.gone)
            return;
        const pose = this.pose;
        if (pose !== this._pose) {
            this._pose = pose;
            this.image.gicon = this.stage.icon(pose);
        }
        this.image.scale_x = this.facingLeft ? -1 : 1;
        const mood = this.mood;
        if (mood !== this.lastMood) {
            if (!this.offstage)
                this.stopMoving();
            this.action = '';
            const woken = this.lastMood === 'sleeping' && mood !== 'sleeping' && mood !== 'waving';
            // noted before doAction(), whose sync() would otherwise see the same change again
            this.lastMood = mood;
            this._breathe();
            if (woken)
                this.doAction('yawning', 1800);   // woken up by work
        }
    }

    setChat(chat, label) {
        this.chat = chat;
        if (chat)
            this.lastChat = chat;
        if (this.tag && label !== undefined && label !== this.label) {
            this.label = label;
            this.tag.text = label;
        }
        this.sync();
    }

    // ------------------------------------------------------------ actions

    clampX(x) {
        const s = this.stage.size;
        const min = s.body / 2 + 4, max = Math.max(min, this.stage.width - s.body / 2 - 4);
        return Math.max(min, Math.min(max, x));
    }

    // Walk (or run) to x; anywhere: x may be off the stage (entering, leaving)
    moveTo(x, fast, anywhere = false) {
        if (!anywhere)
            x = this.clampX(x);
        if (Math.abs(x - this.px) < 4)
            return;
        // stop the last walk first: its end mustn't undo this one
        this.actor.remove_transition('x');
        this.facingLeft = x < this.px;
        this.running = fast;
        this.action = '';
        this.moving = true;
        this.sync();
        const s = this.stage.size;
        this.actor.ease({
            x: Math.round(x - s.slot / 2),
            duration: Math.abs(x - this.px) / (s.gu * (fast ? 6 : 2)) * 1000,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            onStopped: () => {
                if (this.gone)
                    return;
                this.moving = false;
                this.running = false;
                if (this.leaving && this.offstage) {
                    this.stage.removePet(this.key);
                    return;
                }
                this.offstage = false;
                this.sync();
            },
        });
    }

    stopMoving() {
        this.actor.remove_transition('x');
    }

    react(pose, text, ms = 2500) {
        if (!this.offstage)
            this.stopMoving();
        this.action = '';
        this.reaction = pose;
        this.reactionUntil = Date.now() + ms;
        this.timers.after('reaction', ms, () => {
            this.reaction = '';
            this.sync();
        });
        if (text)
            this.say(text);
        this.sync();
    }

    doAction(pose, ms) {
        this.action = pose;
        this.timers.after('action', ms, () => {
            this.action = '';
            this.sync();
        });
        this.sync();
    }

    say(text) {
        this.stage.say(this, text);
    }

    burst(symbol, color, count) {
        this.stage.burst(this, symbol, color, count);
    }

    hop(height) {
        if (this.image.translation_y < 0)
            return;
        const s = this.stage.size;
        this.image.ease({
            translation_y: -(height || s.gu * 0.8), duration: 170, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.image.ease({
                translation_y: 0, duration: 230, mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => this._land(),
            }),
        });
    }

    // squash on landing, then a little stretch back
    _land() {
        this.image.remove_transition('scale-y');
        this.image.ease({scale_y: 0.75, duration: 80, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this.image.ease({scale_y: 1.1, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => this.image.ease({scale_y: 1, duration: 150, mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    onComplete: () => this._breathe()})})});
    }

    // Breathing: slow when idle or asleep, quick while he works
    _breathe() {
        this.image.remove_transition('scale-y');
        this.image.scale_y = 1;
        if (!this.live)
            return;
        const mood = this.mood;
        this.image.ease({
            scale_y: 0.95, duration: mood.startsWith('working') ? 260 : mood === 'sleeping' ? 1600 : 1100,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE, repeatCount: -1, autoReverse: true,
        });
    }

    // Clicked: the hero gets petted, a chat's pet opens its chat
    clicked() {
        if (this.lone) {
            this.petHim();
            return;
        }
        const c = this.lastChat;
        if (!c)
            return;
        if (this.host)
            this.stage.ctx.remoteShow(this.host, c);
        else
            this.stage.ctx.jumpTo(c.sessionId, c.profileDir);
    }

    petHim() {
        this.clicks += 1;
        this.timers.after('tickle', 1500, () => {
            this.clicks = 0;
        });
        if (this.mood === 'sleeping') {
            if (this.clicks >= 3) {
                this.clicks = 0;
                this.react('angry', 'I said let me SLEEP!', 2500);
                this.burst('!', '#e8443a', 2);
            } else {
                this.react('grumpy', 'Zzz… let me sleep.', 2500);
            }
            return;
        }
        if (this.clicks >= 4) {
            this.clicks = 0;
            this.react('laughing', 'Hehe, that tickles!', 2500);
            this.burst('♥', '#ff6b8a', 4);
        } else if (this.clicks === 3) {
            this.react('embarrassed', 'Aww, stop it…', 2000);
            this.burst('♥', '#ff6b8a', 3);
        } else {
            this.react(Math.random() < 0.7 ? 'love' : 'happy', this.petLine(), 2000);
            this.burst('♥', '#ff6b8a', 2);
        }
        this.hop();
    }

    dance() {
        if (this.mood === 'sleeping') {
            this.react('yawning', '…five more minutes.', 2500);
            return;
        }
        this.react(pick(['dancing', 'dancing', 'dj', 'music', 'singing']), '♪ ♫', 3500);
        this.burst('♪', this.stage.accent, 3);
    }

    petLine() {
        const ctx = this.stage.ctx, mood = this.mood;
        if (mood === 'waving')
            return L.fmt('%1 needs you!', L.firstWaitingName(ctx.allGroups));
        if (mood === 'working-juggling') {
            const n = L.agentsRunning(ctx.allGroups);
            return L.fmt(n === 1 ? 'Juggling %1 agent!' : 'Juggling %1 agents!', n);
        }
        if (mood === 'working-typing')
            return 'Busy coding… thanks!';
        return pick(['Hi!', '♥', 'Ship it!', 'All quiet here.', 'Pet me more!'], '');
    }

    doHobby(quiet) {
        let h = HOBBIES[Math.floor(Math.random() * HOBBIES.length)];
        if (h[0] === this.lastHobby)
            h = HOBBIES[(HOBBIES.indexOf(h) + 1) % HOBBIES.length];
        this.lastHobby = h[0];
        this.doAction(h[0], 5000);
        if (!quiet && h[1] && Math.random() < 0.5)
            this.say(h[1]);
    }

    // What the hero does by himself when nothing in particular is going on
    idleChoice() {
        const cursor = this.stage.cursorX, s = this.stage.size;
        if (cursor >= 0 && Math.abs(cursor - this.px) > s.body * 0.8) {
            this.moveTo(cursor, Math.abs(cursor - this.px) > this.stage.width / 3);   // follow the mouse
            return;
        }
        const r = Math.random();
        const anywhere = this.clampX(Math.random() * this.stage.width);
        if (r < 0.26) {
            this.moveTo(anywhere, false);
        } else if (r < 0.32) {
            this.moveTo(anywhere, true);
        } else if (r < 0.42) {
            this.facingLeft = !this.facingLeft;
            this.sync();
            this.timers.after('lookBack', 900, () => {
                this.facingLeft = !this.facingLeft;
                this.sync();
            });
        } else if (r < 0.48) {
            this.hop();
        } else if (r < 0.53) {
            this.doAction('smile', 2500);
        } else if (r < 0.58) {
            this.doAction('coffee', 4500);
        } else if (r < 0.61) {
            this.doAction('dancing', 2500);
            this.burst('♪', this.stage.accent, 2);
        } else if (r < 0.64) {
            this.doAction('yawning', 2500);
        } else if (r < 0.80) {
            this.doHobby(false);
        } else if (r < 0.85) {
            // dressed for the day or the season
            const [holiday] = holidayGreeting();
            const season = seasonPose();
            this.doAction(holiday || (season === 'winter' && Math.random() < 0.3 ? 'snow' : season), 5000);
        }
        // otherwise: just stand there for a bit
    }

    // What a chat's pet does: stays near its spot and acts its chat out
    chatChoice() {
        const s = this.stage.size, home = this.stage.slotX(this.key);
        if (Math.abs(this.px - home) > s.body * 0.7) {
            this.moveTo(home, false);
            return;
        }
        const r = Math.random(), mood = this.mood;
        if (mood === 'waving') {
            this.hop(s.gu * 0.9);
            if (r < 0.3)
                this.say(L.fmt('%1 needs you!', this.label));
            else if (r < 0.6)
                this.burst('!', '#f57900', 1);
        } else if (mood === 'sleeping') {
            if (r < 0.5)
                this.burst('z', '#9a9996', 1);
        } else if (mood === 'idle-living') {
            // awake and relaxed, waiting for your next message (quietly: the
            // speech bubble is for things that matter)
            if (r < 0.15) {
                this.facingLeft = !this.facingLeft;
                this.sync();
            } else if (r < 0.25) {
                this.moveTo(home + (Math.random() - 0.5) * s.body * 0.8, false);
            } else if (r < 0.32) {
                this.doAction('smile', 2500);
            } else if (r < 0.38) {
                this.doAction('coffee', 4000);
            } else if (r < 0.50) {
                this.doHobby(true);
            }
        } else if (mood !== 'sad') {
            if (r < 0.2) {
                this.facingLeft = !this.facingLeft;   // busy, but glances around
                this.sync();
            } else if (r < 0.3) {
                this.moveTo(home + (Math.random() - 0.5) * s.body * 0.6, false);
            }
        }
    }

    _think() {
        if (this.reaction || this.moving || this.action || this.leaving || this.offstage)
            return;
        const mood = this.mood, ctx = this.stage.ctx;
        if (!this.lone) {
            this.chatChoice();
        } else if (mood === 'idle-living') {
            this.idleChoice();
        } else if (mood === 'waving') {
            this.hop(this.stage.size.gu * 0.9);
            const name = L.firstWaitingName(ctx.allGroups);
            if (Math.random() < 0.25 && name)
                this.say(L.fmt('%1 needs you!', name));
        } else if (mood === 'sleeping') {
            this.burst('z', '#9a9996', 1);
        } else if (Math.random() < 0.2) {
            this.facingLeft = !this.facingLeft;   // busy, but glances around
            this.sync();
        }
    }

    // Something happened to his chat (or, for the hero, to an account)
    event(kind, text) {
        const s = this.stage.size;
        if (kind === 'done') {
            this.react(pick(['celebrating', 'celebrating', 'clapping', 'trophy', 'shipping', 'rocket', '200', 'star',
                'happy', 'flexing'], ''), text, 3000);
            this.burst('✦', '#f57900', 4);
            this.hop(s.gu);
        } else if (kind === 'failed') {
            this.react(pick(['facepalm', 'sad', 'crying', 'working-firefighting'], ''), text, 3500);
            this.burst('✗', '#e8443a', 2);
        } else if (kind === 'stopped') {
            this.react('shrug', text, 2500);
        } else if (kind === 'oops') {
            this.react('confused', text, 3000);
            this.burst('?', '#f57900', 2);
        } else if (kind === 'reset') {
            this.react(pick(['charging', 'celebrating'], ''), text, 3000);
            this.burst('⚡', '#f57900', 3);
            this.hop(s.gu);
        } else {
            this.say(text);
            this.burst('!', '#f57900', 1);
            this.hop();
        }
    }

    // Shown or hidden with the popup
    setLive(live) {
        if (this.gone)
            return;
        this.timers.stopAll();
        this.image.remove_all_transitions();
        this.image.translation_y = 0;
        this.image.scale_y = 1;
        this.stopMoving();
        this.moving = false;
        if (!live) {
            this.reaction = '';
            this.action = '';
            this.sync();
            return;
        }
        this.sync();
        this._breathe();
        const tick = () => {
            this._think();
            this.timers.after('brain', 2000 + Math.random() * 3000, tick);
        };
        this.timers.after('brain', 1500 + Math.random() * 1500, tick);
        // a different pose now and then while Claude works, or waits for you
        this.timers.every('poses', 6000, () => {
            if (this.reaction)
                return;
            const mood = this.mood;
            if (mood === 'waving')
                this.waitPose = pick(WAIT_POSES, this.waitPose);
            else if (mood === 'working-juggling' && Math.random() < 0.5)
                this.agentPose = pick(AGENT_POSES, this.agentPose);
            else if (mood === 'working-typing' && Math.random() < 0.5)
                this.workPose = pick(WORK_POSES, this.workPose);
            this.sync();
        });
        // a working chat whose context is nearly full, or a limit close by
        this.timers.every('worries', 25000, () => this._worry());
        this.timers.after('firstWorry', 2500, () => this._worry());
    }

    _worry() {
        if (this.reaction || this.leaving)
            return;
        const ctx = this.stage.ctx, mood = this.mood;
        const contextFull = !this.lone
            ? this.chat && this.chat.state === 'working' && this.chat.context !== null && this.chat.context >= 85
                ? L.fmt('%1: context %2% full', this.label, Math.round(this.chat.context)) : ''
            : L.contextFullText(ctx.allGroups, ctx.petColors);
        if (contextFull && mood.startsWith('working')) {
            this.react('working-context-full', contextFull, 3500);
            return;
        }
        const high = this.lone ? L.highUsageText(ctx.allGroups) : '';
        if (high && mood !== 'sleeping') {
            this.react(L.maxFiveHour(ctx.allGroups) >= 100 ? '429'
                : pick(['mindblown', 'mindblown', 'working-overheated', 'battery-low'], ''), high, 3500);
        }
    }

    leave() {
        this.leaving = true;
        this.timers.after('leave', Math.max(300, this.reactionUntil - Date.now() + 300), () => {
            this.reaction = '';
            this.offstage = true;
            if (!this.live) {
                this.stage.removePet(this.key);
                return;
            }
            const s = this.stage.size;
            this.moveTo(this.px < this.stage.width / 2 ? -s.image / 2 : this.stage.width + s.image / 2, true, true);
        });
        this.sync();
    }

    comeBack() {
        this.leaving = false;
        this.offstage = false;
        this.timers.stop('leave');
        this.moveTo(this.stage.slotX(this.key), true);
    }

    destroy() {
        this.timers.stopAll();
        this.actor.destroy();
    }
}

// ---------------------------------------------------------------- a stage

class Stage {
    constructor(pets, key, hero) {
        this.pets = pets;
        this.ctx = pets.ctx;
        this.key = key;
        this.hero = hero;
        this.live = false;
        this.cursorX = -1;
        this.chats = [];
        this.order = [];      // the shown chats' keys, in the order their pets came
        this.list = new Map();   // pet key -> Pet
        this.colors = {};     // pet key -> palette index
        this.timers = new Timers();
        this.firstShown = false;

        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const gu = 16 * scale;
        const image = (hero ? 10 : 6.2) * gu;
        this.size = {
            gu, scale, image, imageLogical: Math.round(image / scale), body: image / 3,
            tag: gu * 1.1, slot: Math.round(hero ? image : Math.max(image, gu * 7)),
        };
        this.actor = new St.Widget({
            style_class: hero ? 'claude-hero' : 'claude-stage', reactive: true, track_hover: true,
            x_expand: true, height: Math.round((hero ? 6 : 4.5) * gu), clip_to_allocation: true,
        });
        this._width = 0;   // as last allocated
        this.actor.connect('notify::width', () => {
            this._width = this.actor.get_allocation_box().get_width();
            this.layout();
        });
        this.actor.connect('destroy', () => {
            this.gone = true;
            this.timers.stopAll();
        });
        this.actor.connect('motion-event', (a, event) => {
            const [x, y] = event.get_coords();
            const [ok, lx] = this.actor.transform_stage_point(x, y);
            this.cursorX = ok ? lx : -1;
            return Clutter.EVENT_PROPAGATE;
        });
        this.actor.connect('leave-event', () => {
            this.cursorX = -1;
            return Clutter.EVENT_PROPAGATE;
        });

        if (hero) {
            this.glow = new St.Widget({style_class: 'claude-hero-glow', x_expand: true, y_expand: true});
            this.actor.add_child(this.glow);
            this.stars = [[0.55, 0.14], [0.64, 0.36], [0.71, 0.10], [0.80, 0.30], [0.88, 0.12], [0.94, 0.40],
                [0.60, 0.56], [0.97, 0.66], [0.50, 0.42]].map(([x, y], i) => {
                const star = new St.Label({text: i % 3 === 0 ? '✦' : '·',
                    style_class: `claude-star${i % 3 === 0 ? '' : ' claude-star-dot'}`, opacity: 128});
                star._spot = [x, y];
                this.actor.add_child(star);
                return star;
            });
            // the headline (what needs you, what works) and the counts
            this.info = new St.BoxLayout({style_class: 'claude-hero-info', orientation: Clutter.Orientation.VERTICAL});
            this.headline = link('', () => this._openCalling(), 'claude-headline');
            this.ctx.tips.add(this.headline, () => {
                const c = this._calling();
                return c ? [L.fmt('Open %1', c.session.name),
                    (c.host ? `${c.host} · ` : '') + L.stateText(c.session, this.ctx.now)] : '';
            });
            this.chips = box('claude-chips');
            this.info.add_child(this.headline);
            this.info.add_child(this.chips);
            this.actor.add_child(this.info);
        } else {
            this.floor = new St.Widget({style_class: 'claude-stage-floor', height: 1});
            this.actor.add_child(this.floor);
            this.more = new St.Label({style_class: 'claude-small claude-dim claude-stage-more', visible: false});
            this.actor.add_child(this.more);
            this.ctx.tips.add(this.more, () => [L.fmt('%1 more chats', this.hidden),
                L.fmt('Up to %1 pets per account, the chats that need you or work first; the list shows them all.',
                    this.pets.maxPets)]);
        }
        this.bubble = new St.Label({style_class: 'claude-bubble', visible: false});
        this.bubble.clutter_text.ellipsize = 3;
        this.actor.add_child(this.bubble);
    }

    get width() {
        return this._width;
    }

    get ctxMood() {
        return this.pets.mood;
    }

    get accent() {
        return '#3584e4';
    }

    icon(pose) {
        return this.pets.icon(pose);
    }

    get petCount() {
        return this.list.size;
    }

    // Where a pet stands: the hero on the right of his stage (under the
    // stars), a chat's pet on its spot in the row
    slotX(key) {
        if (key === '')
            return this.width * 0.76;
        const keys = this.order;
        const at = keys.indexOf(key);
        return at >= 0 ? this.size.body * 0.8 + (at + 0.5) * this.spacing : this.list.get(key)?.px ?? this.width / 2;
    }

    // Room per pet in the row
    get spacing() {
        const margin = this.size.body * 0.8;
        return Math.max(0, Math.min(this.size.gu * 7.5, (this.width - 2 * margin) / Math.max(1, this.order.length)));
    }

    // A color for a chat: its own (from its key) unless another pet wears it,
    // here or, while there are colors left, on another account's stage
    _freeColor(key) {
        const h = colorHash(key);
        const here = new Set(Object.values(this.colors));
        const anywhere = new Set(Object.values(this.pets.colors).map(c => PALETTE.indexOf(c)));
        for (const used of [new Set([...here, ...anywhere]), here]) {
            let c = h % PALETTE.length;
            for (let n = 0; n < PALETTE.length; n++, c = (c + 1) % PALETTE.length) {
                if (!used.has(c))
                    return c;
            }
        }
        return h % PALETTE.length;
    }

    // An account's chats as [{key, session, host}], the ones that get a pet first
    setChats(chats) {
        const shown = chats.slice(0, this.pets.maxPets);
        this.hidden = chats.length - shown.length;
        const byKey = new Map(shown.map(c => [c.key, c]));
        for (const [key, pet] of this.list) {
            const c = byKey.get(key);
            if (!c && !pet.leaving) {
                pet.setChat(null);
                pet.leave();
            } else if (c && pet.leaving) {
                pet.comeBack();
            }
            if (c)
                pet.setChat(c.session, (c.session.name || '').trim());
        }
        // spots: a pet keeps its place in the row while its chat changes state;
        // newcomers line up on the right
        this.order = this.order.filter(k => byKey.has(k));
        for (const c of shown) {
            if (!this.order.includes(c.key))
                this.order.push(c.key);
        }
        for (const c of shown) {
            if (this.list.has(c.key))
                continue;
            this.colors[c.key] = this._freeColor(c.key);
            const pet = new Pet(this, c.key, {tint: PALETTE[this.colors[c.key]], label: (c.session.name || '').trim(),
                host: c.host});
            this.list.set(c.key, pet);
            this.actor.insert_child_below(pet.actor, this.bubble);
            pet.setChat(c.session);
            this._enter(pet);
        }
        if (this.more) {
            this.more.text = L.fmt('+%1', this.hidden);
            this.more.visible = this.hidden > 0;
        }
        this.layout();
    }

    _enter(pet) {
        const s = this.size, home = this.slotX(pet.key);
        if (!this.firstShown || !this.live || this.width <= 0) {
            pet.px = home;   // the first time the popup opens they're just there
            pet.setLive(this.live);
            return;
        }
        // walk in from the nearest edge
        const fromLeft = home < this.width / 2;
        pet.px = fromLeft ? -s.image / 2 : this.width + s.image / 2;
        pet.offstage = true;
        pet.setLive(true);
        pet.moveTo(home, true, true);
    }

    removePet(key) {
        const pet = this.list.get(key);
        if (!pet)
            return;
        this.list.delete(key);
        delete this.colors[key];
        pet.destroy();
        if (!this.hero && this.list.size === 0 && this.chats.length === 0)
            this.pets.ctx.rerender();   // the stage folds away
    }

    get colorsByPet() {
        const out = {};
        for (const [key, pet] of this.list) {
            if (!pet.leaving && key in this.colors)
                out[key] = PALETTE[this.colors[key]];
        }
        return out;
    }

    // Places what isn't animated: the floor, stars, headline, standing pets
    layout() {
        const w = this.width, h = this.actor.height, s = this.size;
        if (w <= 0 || this.gone || !this.actor.get_stage())   // detached while the list is rebuilt
            return;
        const ground = this.hero ? h - s.gu * 0.55 : h - s.tag - 4;
        const tagWidth = Math.max(s.gu * 3.5, this.spacing - 8);
        for (const pet of this.list.values()) {
            pet.setTagWidth(tagWidth);
            pet.actor.y = Math.round(ground - s.image * FEET);
            if (!pet.moving && !pet.offstage && !pet.leaving)
                pet.px = this.hero ? this.slotX('') : this.slotX(pet.key);
        }
        if (this.hero) {
            this.glow.set_size(w, h);
            for (const star of this.stars)
                star.set_position(Math.round(w * star._spot[0]), Math.round(h * star._spot[1]));
            this.info.set_position(Math.round(s.gu * 0.8), Math.round(s.gu * 0.55));
            this.info.width = Math.round(Math.max(s.gu * 8, this.slotX('') - s.body / 2 - s.gu - s.gu * 0.8));
        } else {
            this.floor.set_position(Math.round(s.gu * 0.6), Math.round(ground));
            this.floor.width = Math.round(w - s.gu * 1.2);
            this.more.set_position(Math.round(w - this.more.width - 6), 4);
        }
    }

    // ------------------------------------------------------------ the hero

    _calling() {
        for (const g of this.ctx.allGroups) {
            for (const s of g.sessions) {
                if (s.state === 'waiting')
                    return {session: s, host: g.host || ''};
            }
        }
        return null;
    }

    _openCalling() {
        const c = this._calling();
        if (c && c.host)
            this.ctx.remoteShow(c.host, c.session);
        else if (c)
            this.ctx.jumpTo(c.session.sessionId, c.session.profileDir);
    }

    updateHero(headline, counts, status) {
        if (this.gone)
            return;
        const mood = this.pets.mood;
        this.headline.child.text = headline;
        if (mood === 'waving')
            this.headline.add_style_class_name('claude-fg-waiting');
        else
            this.headline.remove_style_class_name('claude-fg-waiting');
        this.chips.destroy_all_children();
        if (status) {
            const chips = [['waiting', counts.waiting, counts.waiting === 1 ? '%1 needs input' : '%1 need input'],
                ['working', counts.working, '%1 working'], ['ok', counts.idle, '%1 idle'], ['ok', counts.done, '%1 done']]
                .filter(c => c[1] > 0);
            for (const [cls, n, text] of chips) {
                const chip = box('claude-chip');
                chip.add_child(dot(cls, 'claude-dot claude-dot-small'));
                chip.add_child(label(L.fmt(text, n), 'claude-small'));
                this.chips.add_child(chip);
            }
            if (!chips.length)
                this.chips.add_child(label('No sessions running', 'claude-small claude-dim'));
        }
        // the light: what the whole dashboard is up to
        const [r, g, b] = mood.startsWith('working') ? this.pets.accentRgb : MOOD_COLORS[mood] || NIGHT;
        this.actor.style = `background-gradient-direction: vertical; background-gradient-start: rgba(${r},${g},${b},0.22);` +
            ` background-gradient-end: rgba(${r},${g},${b},0.05); border-color: rgba(${r},${g},${b},0.35);`;
        this.glow.style = `background-color: rgba(${r},${g},${b},0.12);`;
        const night = mood === 'sleeping';
        for (const star of this.stars)
            star.visible = night;
        if (mood !== this._heroMood) {
            this._heroMood = mood;
            this._animateLight();
        }
        for (const pet of this.list.values())
            pet.sync();
    }

    // pulsing while a chat needs you, twinkling stars at night
    _animateLight() {
        if (!this.hero)
            return;
        this.glow.remove_all_transitions();
        this.glow.opacity = 0;
        for (const star of this.stars) {
            star.remove_all_transitions();
            star.opacity = 128;
        }
        if (!this.live)
            return;
        if (this._heroMood === 'waving') {
            this.glow.ease({opacity: 255, duration: 900, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                repeatCount: -1, autoReverse: true});
        } else if (this._heroMood === 'sleeping') {
            this.stars.forEach((star, i) => star.ease({opacity: 230, duration: 900 + 260 * i,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE, repeatCount: -1, autoReverse: true}));
        }
    }

    // ------------------------------------------------------------ shared by the pets

    say(pet, text) {
        if (!this.live || !text || this.gone)
            return;
        const s = this.size;
        this.bubble.text = text;
        this.bubble.set_width(-1);   // measure the new text, not the last width
        this.bubble.show();
        const [, natWidth] = this.bubble.get_preferred_width(-1);
        const width = Math.min(natWidth, this.width - 8);
        this.bubble.width = width;
        const headTop = pet.actor.y + s.image * FEET - s.image * 11 / 45 + pet.image.translation_y;
        const above = headTop - this.bubble.height - 4 >= 0;
        let x = above ? pet.px - width / 2
            : pet.px + s.body / 2 + width + 4 <= this.width ? pet.px + s.body / 2 + 4 : pet.px - s.body / 2 - width - 4;
        x = Math.max(0, Math.min(this.width - width, x));
        this.bubble.set_position(Math.round(x), Math.round(above ? headTop - this.bubble.height - 4 : Math.max(0, headTop)));
        this.actor.set_child_above_sibling(this.bubble, null);
        this.timers.after('bubble', 4500, () => this.bubble.hide());
    }

    // Floating hearts, notes, sparkles and z's
    burst(pet, symbol, color, count) {
        if (!this.live || this.gone)
            return;
        const s = this.size;
        for (let i = 0; i < count; i++) {
            const bit = new St.Label({text: symbol, style_class: 'claude-particle', style: `color: ${color};`});
            this.actor.add_child(bit);
            const x = pet.px - s.gu * 0.4 + (Math.random() - 0.5) * s.body;
            const y = pet.actor.y + s.image * FEET - s.image * 11 / 45 - s.gu * 0.6 - Math.random() * s.gu * 0.5;
            bit.set_position(Math.round(x), Math.round(y));
            bit.ease({y: Math.round(y - s.gu * 2.4), x: Math.round(x + (Math.random() - 0.5) * s.gu * 2), opacity: 0,
                duration: 1500, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onStopped: () => bit.destroy()});
        }
    }

    // Events go to the chat's own pet; the hero takes the ones about
    // everything (and the ones for a chat that has no pet)
    event(kind, text, key) {
        const pet = this.hero ? (!key || !(key in this.pets.colors) ? this.list.get('') : null)
            : key ? this.list.get(key) : null;
        if (pet && this.live)
            pet.event(kind, text);
    }

    setLive(live) {
        if (this.gone)
            return;
        this.live = live;
        if (!live) {
            this.timers.stopAll();
            this.bubble.hide();
            for (const child of this.actor.get_children()) {
                if (child.has_style_class_name?.('claude-particle'))
                    child.destroy();
            }
        }
        // shown and laid out: from now on pets walk in
        if (live && !this.firstShown)
            this.timers.after('firstShown', 500, () => {
                this.firstShown = true;
            });
        for (const [key, pet] of this.list) {
            if (pet.leaving && !live) {
                this.removePet(key);
                continue;
            }
            pet.setLive(live);
        }
        this.layout();
        if (this.hero) {
            this._animateLight();
            if (live)
                this._greet();
        }
    }

    // Opening the popup: the hero says hi now and then (or happy holidays)
    _greet() {
        const hero = this.list.get('');
        const mood = this.pets.mood;
        if (!hero || mood === 'sleeping' || mood === 'loading')
            return;
        const [pose, text] = holidayGreeting();
        if (text) {
            hero.react(pose, text, 3500);
            hero.hop(this.size.gu * 0.6);
        } else if (Math.random() < 0.6) {
            hero.hop(this.size.gu * 0.6);
            hero.say('Hi!');
        }
    }

    destroy() {
        this.timers.stopAll();
        for (const pet of this.list.values())
            pet.timers.stopAll();
        this.list.clear();
        this.actor.destroy();
    }
}

// ---------------------------------------------------------------- the director

export class Pets {
    constructor(ctx) {
        this.ctx = ctx;
        this._icons = new Map();
        this._stages = new Map();   // group key -> Stage
        this.mood = 'loading';
        this.accentRgb = [53, 132, 228];   // "working" blue (stylesheet.css)
        this.hero = new Stage(this, 'hero', true);
        const clawd = new Pet(this.hero, '', {});
        this.hero.list.set('', clawd);
        this.hero.actor.insert_child_below(clawd.actor, this.hero.bubble);
        clawd.sync();
        this._heroShown = null;
    }

    get settings() {
        return this.ctx._settings;
    }

    get maxPets() {
        return Math.max(0, this.settings.get_int('chat-pets'));
    }

    get heroShown() {
        return this.settings.get_boolean('show-pet');
    }

    icon(pose) {
        if (!this._icons.has(pose)) {
            this._icons.set(pose, new Gio.FileIcon({
                file: Gio.File.new_for_path(GLib.build_filenamev([this.ctx.petsDir, `clawd-${pose}.svg`])),
            }));
        }
        return this._icons.get(pose);
    }

    // An account's stage with its chats' pets, or null when it has none
    stageFor(groupKey, chats) {
        if (!this.heroShown || this.maxPets === 0)
            return null;
        let stage = this._stages.get(groupKey);
        if (!stage && chats.length === 0)
            return null;
        if (!stage) {
            stage = new Stage(this, groupKey, false);
            this._stages.set(groupKey, stage);
            stage.setLive(this.ctx.menu.isOpen);
        }
        stage.chats = chats;
        stage.setChats(chats);
        stage.used = true;
        if (chats.length === 0 && stage.petCount === 0)
            return null;
        return stage.actor;
    }

    // Before the list is rebuilt: keep the stages (their pets live on)
    detachStages() {
        for (const stage of this._stages.values()) {
            stage.used = false;
            stage.actor.get_parent()?.remove_child(stage.actor);
        }
    }

    // After: stages of accounts that are gone go too
    pruneStages() {
        for (const [key, stage] of this._stages) {
            if (!stage.used) {
                stage.destroy();
                this._stages.delete(key);
            }
        }
    }

    // Each chat pet's color by pet key (the bar next to its chat in the list)
    get colors() {
        const all = {};
        for (const stage of this._stages.values())
            Object.assign(all, stage.colorsByPet);
        return all;
    }

    // Every poll: the hero's mood and headline
    update() {
        const ctx = this.ctx;
        const groups = ctx.allGroups;
        const counts = L.counts(groups);
        this.mood = L.petMood(ctx._status, ctx._errorText, L.overall(groups, counts), L.agentsRunning(groups));
        const shown = this.heroShown;
        if (shown !== this._heroShown) {
            this._heroShown = shown;
            ctx._heroBin.child = shown ? this.hero.actor : null;
        }
        if (shown)
            this.hero.updateHero(L.headline(ctx._status, ctx._errorText, counts), counts, ctx._status);
    }

    event({kind, text, key}) {
        this.hero.event(kind, text, key);
        for (const stage of this._stages.values())
            stage.event(kind, text, key);
    }

    setActive(open) {
        this.hero.setLive(open);
        for (const stage of this._stages.values())
            stage.setLive(open);
    }

    destroy() {
        for (const stage of this._stages.values())
            stage.destroy();
        this._stages.clear();
        this.ctx._heroBin.child = null;
        this.hero.destroy();
    }
}
