// Tests for gnome/extension/logic.js (no GNOME Shell needed):
//   gjs -m gnome/tests/test_logic.js
import System from 'system';

import * as L from '../extension/logic.js';

let failures = 0, count = 0;

function test(name, fn) {
    count++;
    try {
        fn();
    } catch (e) {
        failures++;
        print(`FAIL ${name}: ${e.message}`);
    }
}

function eq(actual, expected, what = '') {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    if (a !== b)
        throw new Error(`${what} expected ${b}, got ${a}`);
}

const session = (key, state, extra = {}) => ({
    key, sessionId: key, chatId: key, name: `chat ${key}`, state, reason: '', pid: 1, since: 1000,
    cwdShort: '~/proj', detail: '', kind: 'interactive', entrypoint: 'cli', ...extra,
});
const group = (sessions, extra = {}) => ({id: 'g', name: 'work', title: 'work · Team', sessions,
    profileKeys: ['.claude-work'], projects: [], limits: null, ...extra});
const settings = {notifyWaiting: true, notifyDone: true, notifyDoneMinSeconds: 30};
const T = 1792060000000;   // a real time (ms): alerts are limited per minute

test('counts and overall state', () => {
    const groups = [group([session('a', 'waiting'), session('b', 'working'), session('c', 'done', {pid: null})])];
    eq(L.counts(groups), {waiting: 1, working: 1, idle: 0, done: 1});
    eq(L.overall(groups), 'waiting');
    eq(L.overall([group([session('c', 'done', {pid: null})])]), 'none', 'finished records only');
    eq(L.overall([group([session('c', 'done')])]), 'idle', 'finished but its process runs');
});

test('headline and summary', () => {
    eq(L.headline(null, 'boom', {}), 'Status unavailable');
    eq(L.headline(null, '', {}), 'Looking for your chats…');
    eq(L.headline({}, '', {waiting: 2, working: 1, idle: 0, done: 0}), '2 chats need you');
    eq(L.headline({}, '', {waiting: 0, working: 1, idle: 0, done: 0}), '1 chat working');
    eq(L.headline({}, '', {waiting: 0, working: 0, idle: 0, done: 0}), 'All quiet');
    eq(L.summaryText({waiting: 1, working: 2, idle: 0, done: 3}), '1 needs input · 2 working · 3 done');
    eq(L.summaryText({waiting: 0, working: 0, idle: 0, done: 0}), 'No sessions running');
});

test('durations, tokens, reset text', () => {
    eq([L.duration(0), L.duration(59 * 60000), L.duration(61 * 60000), L.duration(26 * 3600000)],
        ['0m', '59m', '1h 1m', '1d 2h']);
    eq([L.formatTokens(999), L.formatTokens(1500), L.formatTokens(2.5e6), L.formatTokens(3e9)],
        ['999', '1.5k', '2.5M', '3.0B']);
    eq(L.resetText({reset: true}, 0), 'reset');
    eq(L.resetText({reset: false, resetsAt: 7200000}, 0), 'resets in 2h 0m');
    // the last minute: "<1m", never a rounded "0m" that looks stuck
    eq([L.resetText({resetsAt: 15000}, 0), L.resetText({resetsAt: 59999}, 0), L.resetText({resetsAt: 60000}, 0),
        L.resetText({resetsAt: 0}, 0)], ['resets in <1m', 'resets in <1m', 'resets in 1m', '']);
    eq(L.fmt('%1 of %2', 'a', 'b'), 'a of b');
});

test('panel shows the active account first', () => {
    const quiet = group([session('a', 'idle')], {limits: {updatedAt: 9, windows: [{key: 'five_hour', pct: 10}]}});
    const busy = group([session('b', 'working')], {limits: {updatedAt: 1, windows: [{key: 'five_hour', pct: 70}]}});
    eq(L.panelWindow([quiet, busy]).pct, 70);
    eq(L.panelWindow([quiet]).pct, 10);
    eq(L.panelWindow([group([])]), null);
});

test('first poll primes, later changes notify', () => {
    const t = new L.Tracker();
    let out = t.track('', [group([session('a', 'working', {since: T})])], T + 1000, '', settings);
    eq(out.notify.length, 0, 'primed');
    out = t.track('', [group([session('a', 'waiting')])], T + 2000, '', settings);
    eq(out.notify.map(n => [n.key, n.kind]), [['a', 'waiting']]);
    eq(out.sound, 'waiting');
    eq(out.pets.map(p => p.kind), ['waiting']);
    // answered: the stale "needs input" goes; a long turn that ends notifies
    out = t.track('', [group([session('a', 'working')])], T + 3000, '', settings);
    eq(out.close, [{key: 'a', kind: 'waiting'}]);
    out = t.track('', [group([session('a', 'idle', {since: T + 100000})])], T + 100000, '', settings);
    eq(out.notify.map(n => [n.kind, n.title]), [['done', 'chat a finished']]);
    eq(out.sound, 'done');
});

test('short turns and repeated waiting stay quiet', () => {
    const t = new L.Tracker();
    t.track('', [group([session('a', 'idle')])], T, '', settings);
    t.track('', [group([session('a', 'working', {since: T + 1000})])], T + 1000, '', settings);
    let out = t.track('', [group([session('a', 'idle', {since: T + 5000})])], T + 5000, '', settings);
    eq(out.notify.length, 0, 'a 4 s turn');
    eq(out.pets.map(p => p.kind), ['done'], 'the pet still cheers');
    t.track('', [group([session('a', 'waiting')])], T + 6000, '', settings);
    t.track('', [group([session('a', 'working')])], T + 7000, '', settings);
    out = t.track('', [group([session('a', 'waiting')])], T + 8000, '', settings);
    eq(out.notify.length, 0, 'second alert within a minute');
});

test('the most urgent sound wins, sources keep their own memory', () => {
    const t = new L.Tracker();
    t.track('', [group([session('a', 'working', {since: T}), session('b', 'working', {since: T})])], T, '', settings);
    const out = t.track('', [group([session('a', 'done', {reason: 'failed', since: T + 60000}),
        session('b', 'idle', {since: T + 60000})])], T + 60000, '', settings);
    eq(out.sound, 'failed');
    const remote = t.track('ssh:lab', [group([session('a', 'waiting')])], T + 60000, 'lab', settings);
    eq(remote.notify.length, 0, 'a new source primes first');
    eq([...remote.present], ['ssh:lab|a']);
    eq([L.keyOfSource('ssh:lab|a', 'ssh:lab'), L.keyOfSource('a', ''), L.keyOfSource('ssh:lab|a', '')],
        [true, true, false]);
});

test('limit resets cheer once', () => {
    const t = new L.Tracker();
    const g = pct => [group([], {id: 'w', limits: {updatedAt: 0, windows: [{key: 'five_hour', label: '5h', pct}]}})];
    eq(t.celebrateResets('', g(100)), []);
    eq(t.celebrateResets('', g(0)).map(e => e.text), ['5h limit reset!']);
    eq(t.celebrateResets('', g(0)), []);
});

test('helper output', () => {
    eq(L.helperResult('{"ok": true, "message": "x"}', ''), {ok: true, message: 'x'});
    eq(L.helperResult('', 'Traceback\nValueError: no'), {ok: false, message: 'ValueError: no'});
    eq(L.statusResult('{"ok": false, "error": "nope"}', ''), {error: 'Status unavailable: nope'});
    eq(L.statusResult('{"ok": true, "errors": ["a", "b"], "groups": []}', '').errorText, 'a\nb');
});

test('new chat folders', () => {
    const g = group([], {projects: [{path: '/h', short: '~'}, {path: '/h/p', short: '~/p'}]});
    eq(L.newChatFolders(g, '').map(f => f.short), ['~/p'], 'home is behind Choose folder… here');
    eq(L.newChatFolders(group([], {projects: [], homeChatCommand: 'claude'}), 'lab'),
        [{path: '', short: '~', newChatCommand: 'claude'}], 'an SSH host keeps its home folder');
});

test('pets: stage order and keys', () => {
    const g = group([session('a', 'done'), session('b', 'waiting'), session('c', 'working', {chatId: 'C'})]);
    eq(L.stageChats(g, '').map(c => c.key), ['b', 'C', 'a']);
    eq(L.petKeyOf(session('x', 'idle'), 'lab'), 'ssh:lab|x');
});

test('raising: nearest ancestor, caption, prefer, require', () => {
    const w = (pid, title) => ({pid, title});
    const windows = [w(10, 'konsole: other'), w(20, 'editor - proj'), w(20, 'editor - other')];
    eq(L.pickWindow(windows, {pids: [5, 20, 10]}).pid, 20, 'nearest');
    eq(L.pickWindow(windows, {pids: [5, 20, 10], caption: 'other'}).title, 'editor - other', 'caption');
    eq(L.pickWindow(windows, {pids: [20], prefer: 'proj'}).title, 'editor - proj', 'prefer');
    eq(L.pickWindow(windows, {pids: [20], caption: 'nope', require: true}), null, 'required caption');
    eq(L.pickWindow(windows, {pids: 'bad'}), null, 'bad input');
});

print(`${count - failures}/${count} passed`);
if (failures)
    System.exit(1);
