// What the dashboard says, worked out from the status script's JSON
// (package/contents/code/claude_status.py, see its collect()). No GNOME Shell
// imports here, so `gjs -m gnome/tests/test_logic.js` can test it.
//
// A port of the logic in the Plasma widget's main.qml: keep the two in step.

// "%1 of %2" style placeholders, as in the Plasma widget's i18n()
export function fmt(text, ...args) {
    return text.replace(/%(\d)/g, (m, i) => (args[i - 1] !== undefined ? String(args[i - 1]) : m));
}

function plural(n, one, many) {
    return fmt(n === 1 ? one : many, n);
}

export function counts(groups) {
    const c = {waiting: 0, working: 0, idle: 0, done: 0};
    for (const g of groups) {
        for (const s of g.sessions)
            c[s.state] = (c[s.state] || 0) + 1;
    }
    return c;
}

export function overall(groups, c = counts(groups)) {
    if (c.waiting)
        return 'waiting';
    if (c.working)
        return 'working';
    // finished jobs kept for the record don't count as running
    return groups.some(g => g.sessions.some(s => (s.state === 'idle' || s.state === 'done') && s.pid !== null))
        ? 'idle' : 'none';
}

// Milliseconds between status checks: the setting while a chat runs (here or
// on a host) or the menu is open; with nothing running, five times as long.
// An idle panel then costs a fifth, and a chat that starts still shows within
// seconds (the menu opening checks at once).
export const QUIET_POLL_FACTOR = 5;

export function pollInterval(settingMs, overallState, menuOpen) {
    const ms = Math.max(1000, settingMs);
    return overallState === 'none' && !menuOpen ? ms * QUIET_POLL_FACTOR : ms;
}

// The accounts of the hosts that answered, each marked with its host
export function remoteGroups(shownHosts, remote) {
    const out = [];
    for (const host of shownHosts) {
        const r = remote[host];
        if (r && r.result) {
            for (const g of r.result.groups)
                out.push(Object.assign({}, g, {host}));
        }
    }
    return out;
}

// The hero's headline: the most important thing on the dashboard
export function headline(status, errorText, c) {
    if (!status && errorText)
        return 'Status unavailable';
    if (!status)
        return 'Looking for your chats…';
    if (c.waiting)
        return plural(c.waiting, '%1 chat needs you', '%1 chats need you');
    if (c.working)
        return plural(c.working, '%1 chat working', '%1 chats working');
    if (c.idle)
        return plural(c.idle, 'Your turn in %1 chat', 'Your turn in %1 chats');   // Claude finished its reply
    if (c.done)
        return plural(c.done, '%1 finished chat to look at', '%1 finished chats to look at');
    return 'All quiet';
}

export function summaryText(c) {
    const parts = [];
    if (c.waiting)
        parts.push(plural(c.waiting, '%1 needs input', '%1 need input'));
    if (c.working)
        parts.push(fmt('%1 working', c.working));
    if (c.idle)
        parts.push(fmt('%1 idle', c.idle));
    if (c.done)
        parts.push(fmt('%1 done', c.done));
    return parts.length ? parts.join(' · ') : 'No sessions running';
}

// A chat's pet key: its conversation (so the pet stays the same while the
// chat's row changes, e.g. from a running to a finished background session)
export function petKeyOf(session, host) {
    return (host ? `ssh:${host}|` : '') + (session.chatId || session.sessionId || session.key);
}

// The 5-hour usage that goes next to the panel icon: the account with an
// active session, else the one with the freshest numbers.
export function panelWindow(groups) {
    let best = null, bestScore = -1;
    for (const g of groups) {
        if (!g.limits || !g.limits.windows.length)
            continue;
        const active = g.sessions.some(s => s.state === 'working' || s.state === 'waiting');
        const score = (active ? 1e15 : 0) + g.limits.updatedAt;
        if (score > bestScore) {
            bestScore = score;
            best = g.limits.windows[0];
        }
    }
    return best;
}

// "work · Team", or "lab: work · Team" for an SSH host's account
export function groupLabel(g) {
    return g.host ? fmt('%1: %2', g.host, g.name) : g.name;
}

export function tooltipText(status, errorText, groups, shownHosts, remote) {
    if (errorText && !status)
        return errorText;
    const lines = [summaryText(counts(groups))];
    for (const g of groups) {
        if (!g.limits)
            continue;
        lines.push(`${g.host ? `${g.host}: ` : ''}${g.title}: ${
            g.limits.windows.map(w => `${w.label} ${Math.round(w.pct)}%`).join(' · ')}`);
    }
    for (const host of shownHosts) {
        if (remote[host] && remote[host].error)
            lines.push(fmt('%1: not reachable', host));
    }
    return lines.join('\n');
}

export function reasonText(reason) {
    switch (reason) {
    case 'permission': return 'Asks for permission';
    case 'question': return 'Has a question for you';
    case 'network access': return 'Asks for network access';
    case 'goal approval': return 'Proposes a goal';
    case '': return 'Waiting for you';
    default: return reason;
    }
}

export function duration(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 60)
        return fmt('%1m', m);
    const h = Math.floor(m / 60);
    if (h < 24)
        return fmt('%1h %2m', h, m % 60);
    return fmt('%1d %2h', Math.floor(h / 24), h % 24);
}

export function resetText(window, now) {
    if (window.reset)
        return 'reset';
    if (!window.resetsAt)
        return '';
    // The last minute reads "<1m": a rounded "0m" looked stuck
    return fmt('resets in %1', window.resetsAt - now < 60000 ? '<1m' : duration(window.resetsAt - now));
}

export function stateText(s, now) {
    const since = s.since ? ` · ${duration(now - s.since)}` : '';
    const reason = s.reason ? ` · ${s.reason}` : '';
    switch (s.state) {
    case 'waiting': return `Needs input${reason}`;
    case 'working': return `Working${reason}${since}`;
    case 'done':
        return (s.reason === 'failed' ? 'Failed' : s.reason === 'stopped' ? 'Stopped' : 'Done') + since;
    default: return `Idle${since}`;
    }
}

export function formatTokens(n) {
    if (n >= 1e9)
        return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6)
        return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3)
        return `${(n / 1e3).toFixed(1)}k`;
    return String(n);
}

// The color of a state, as a style class suffix (claude-fg-*, claude-bg-*
// in stylesheet.css)
export function stateClass(state) {
    switch (state) {
    case 'waiting': return 'waiting';
    case 'working': return 'working';
    case 'idle':
    case 'done': return 'ok';
    default: return 'none';
    }
}

export function usageClass(pct) {
    if (pct >= 90)
        return 'bad';
    if (pct >= 70)
        return 'waiting';
    return 'working';
}

export function planUsageText(limits, now) {
    if (!limits)
        return "No plan usage yet: shows after this account's next reply";
    if (now - limits.updatedAt < 60000)
        return 'Plan usage updated just now';
    return fmt('Plan usage as of %1 ago', duration(now - limits.updatedAt));
}

export function tokensText(t) {
    return fmt('Tokens today %1 (%2 out) · 7 days %3 (%4 out)',
        formatTokens(t.today.total), formatTokens(t.today.output),
        formatTokens(t.week.total), formatTokens(t.week.output));
}

export function tokensTooltip(t) {
    const line = b => fmt('input %1 · output %2 · cache read %3 · cache write %4 · %5 replies',
        formatTokens(b.input), formatTokens(b.output), formatTokens(b.cacheRead),
        formatTokens(b.cacheWrite), b.messages);
    const models = t.models.map(m => `${m.model.replace(/^claude-/, '')}: ${formatTokens(m.total)}`);
    let text = `Today: ${line(t.today)}\nLast 7 days: ${line(t.week)}`;
    if (models.length)
        text += `\nBy model (7 days): ${models.join(', ')}`;
    if (t.week.shared > 0) {
        text += `\n${fmt("Includes %1 today (%2 in 7 days) from chats shared with another profile. A transcript doesn't say which account paid, so shared chats count on both.",
            formatTokens(t.today.shared), formatTokens(t.week.shared))}`;
    }
    return text;
}

// The hint on a session's name: what clicking it does
export function openHint(session, remoteHost) {
    if (remoteHost) {
        if (session.entrypoint === 'claude-vscode' && !session.openCommand)
            return fmt('Show this conversation in VS Code (connected to %1)', remoteHost);
        if (!session.openCommand)
            return fmt('Switch to the terminal with the ssh session to %1', remoteHost);
        if (session.kind === 'chat')
            return fmt('Reopen this chat on %1 in a terminal (ssh)', remoteHost);
        return fmt('Open this background session on %1 in a terminal (ssh)', remoteHost);
    }
    if (session.entrypoint === 'claude-vscode')
        return 'Open this conversation in VS Code';
    if (session.kind === 'chat')
        return 'Reopen this chat in a terminal (claude --resume)';
    if (session.kind === 'bg' && session.pid === null)
        return 'Reopen this background session in a terminal';
    if (session.kind === 'bg')
        return 'Show this background session in a terminal';
    return 'Switch to the terminal running this session';
}

export function stopQuestion(session) {
    if (session.state === 'working') {
        return fmt("Stop “%1”? It's working right now: the current step is interrupted and anything it started in the background stops too. The conversation is kept; claude attach resumes it.",
            session.name);
    }
    if (session.state === 'waiting')
        return fmt("Stop “%1”? It's waiting for you. The conversation is kept; claude attach resumes it.", session.name);
    return fmt("Stop “%1”? It's finished, so this only shuts down its idle process. The conversation is kept.", session.name);
}

// The pets' mood for the whole dashboard (the big Clawd)
export function petMood(status, errorText, overallState, agentsRunning) {
    if (!status && errorText)
        return 'error';
    if (!status)
        return 'loading';
    if (overallState === 'waiting')
        return 'waving';
    if (overallState === 'working')
        return agentsRunning > 0 ? 'working-juggling' : 'working-typing';
    if (overallState === 'idle')
        return 'idle-living';
    return 'sleeping';
}

export function agentsRunning(groups) {
    let n = 0;
    for (const g of groups) {
        for (const s of g.sessions) {
            if (s.agents && s.state !== 'done')
                n += s.agents.running;
        }
    }
    return n;
}

const SOUND_RANK = {'': 0, done: 1, failed: 2, waiting: 3};

// Remembers each session's state across polls and says what to tell you
// when one changes: notifications to send or close, pet reactions, and the
// one sound for the poll (the most urgent). Each source ("" for this
// computer, "ssh:<host>" for an SSH host) keeps its own memory, so one
// poll can't close another's notifications.
export class Tracker {
    constructor() {
        this.lastStates = {};
        this.turnStarts = {};
        this.primed = {};
        this.lastWaitingAlert = {};
        this.lastWindows = {};
    }

    // settings: {notifyWaiting, notifyDone, notifyDoneMinSeconds}
    // Returns {notify: [...], close: [...], pets: [...], sound: "" | "waiting" | "done" | "failed", present: Set}
    track(source, groupList, nowMs, host, settings) {
        const out = {notify: [], close: [], pets: [], sound: '', present: new Set()};
        const next = {}, starts = {};
        const before = this.lastStates[source] || {};
        const startedAt = this.turnStarts[source] || {};
        const primed = !!this.primed[source];
        const where = host ? ` · ${host}` : '';
        const sound = kind => {
            if (SOUND_RANK[kind] > SOUND_RANK[out.sound])
                out.sound = kind;
        };
        for (const g of groupList) {
            for (const s of g.sessions) {
                const sid = (source ? `${source}|` : '') + (s.key || s.sessionId);
                const prev = before[sid];
                const active = s.state === 'working' || s.state === 'waiting';
                next[sid] = s.state;
                out.present.add(sid);
                // A turn runs from leaving idle/done until returning to it.
                if (active)
                    starts[sid] = sid in startedAt ? startedAt[sid] : s.since || nowMs;
                if (prev === 'waiting' && s.state !== 'waiting')
                    out.close.push({key: sid, kind: 'waiting'});   // answered: drop the stale prompt
                if (!primed || prev === s.state)
                    continue;
                if (s.state === 'waiting') {
                    // At most one "needs input" alert per session per minute
                    if (nowMs - (this.lastWaitingAlert[sid] || 0) >= 60000) {
                        this.lastWaitingAlert[sid] = nowMs;
                        out.pets.push({kind: 'waiting', text: fmt('%1 needs you!', s.name), key: petKeyOf(s, host)});
                        if (settings.notifyWaiting) {
                            out.notify.push({
                                key: sid, session: s, kind: 'waiting', host,
                                title: fmt('%1 needs your input', s.name),
                                body: `${s.detail || reasonText(s.reason)}\n${s.cwdShort}${where}`,
                                icon: 'dialog-warning-symbolic',
                            });
                            sound('waiting');
                        }
                    }
                } else if (prev === 'working' && (s.state === 'idle' || s.state === 'done')) {
                    const pk = petKeyOf(s, host);
                    if (s.reason === 'failed')
                        out.pets.push({kind: 'failed', text: fmt('%1 failed…', s.name), key: pk});
                    else if (s.reason === 'stopped')
                        out.pets.push({kind: 'stopped', text: fmt('%1 was stopped.', s.name), key: pk});
                    else
                        out.pets.push({kind: 'done', text: fmt('%1 is done!', s.name), key: pk});
                    const took = (s.since || nowMs) - (sid in startedAt ? startedAt[sid] : nowMs);
                    if (settings.notifyDone && took >= settings.notifyDoneMinSeconds * 1000) {
                        const title = s.reason === 'failed' ? fmt('%1 failed', s.name)
                            : s.reason === 'stopped' ? fmt('%1 was stopped', s.name)
                                : fmt('%1 finished', s.name);
                        out.notify.push({
                            key: sid, session: s, kind: 'done', host, title,
                            body: `${s.detail ? `${s.detail}\n` : ''}${fmt('Took %1 · %2', duration(took), s.cwdShort)}${where}`,
                            icon: 'emblem-ok-symbolic',
                        });
                        sound(s.reason === 'failed' ? 'failed' : 'done');
                    }
                }
            }
        }
        this.lastStates[source] = next;
        this.turnStarts[source] = starts;
        this.primed[source] = true;
        return out;
    }

    // A limit that dropped a lot since the last poll was reset: the pets cheer
    celebrateResets(source, groupList) {
        const events = [];
        const next = Object.assign({}, this.lastWindows);
        for (const g of groupList) {
            for (const w of g.limits ? g.limits.windows : []) {
                const key = `${source}|${g.id}/${w.key}`;
                if (key in this.lastWindows && this.lastWindows[key] >= 25 && w.pct < this.lastWindows[key] - 20)
                    events.push({kind: 'reset', text: fmt('%1 limit reset!', w.label), key: ''});
                next[key] = w.pct;
            }
        }
        this.lastWindows = next;
        return events;
    }
}

// Which notification keys belong to a source: "" (this computer) has no
// "|" in its keys, "ssh:<host>" prefixes them
export function keyOfSource(key, source) {
    return source ? key.startsWith(`${source}|`) : key.indexOf('|') < 0;
}

// The helpers print one JSON line; anything else becomes an error message
export function helperResult(stdout, stderr) {
    try {
        return JSON.parse(stdout);
    } catch {
        const lines = (stderr || '').trim().split('\n');
        return {ok: false, message: lines[lines.length - 1] || 'the helper gave no answer'};
    }
}

// The status script's answer: {status} or {error}
export function statusResult(stdout, stderr) {
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    } catch {
        const lines = (stderr || '').trim().split('\n');
        return {error: fmt('Status script failed: %1', lines[lines.length - 1] || 'no output')};
    }
    if (!parsed.ok)
        return {error: fmt('Status unavailable: %1', parsed.error)};
    return {status: parsed, errorText: parsed.errors.length ? parsed.errors.join('\n') : ''};
}

// The new-chat choices of an account: its recent folders (here without the
// home folder, which "Choose folder…" covers; an SSH host's can't be browsed
// from here, so its home folder stays in the list)
export function newChatFolders(group, host) {
    const folders = host ? group.projects.slice() : group.projects.filter(f => f.short !== '~');
    if (host && !folders.some(f => f.short === '~'))
        folders.push({path: '', short: '~', newChatCommand: group.homeChatCommand || ''});
    return folders;
}

// The pets of an account's stage: one per chat, the ones that need you or
// work first
export function stageChats(group, host) {
    const rank = {waiting: 0, working: 1, idle: 2, done: 3};
    const out = [], seen = {};
    for (const s of group.sessions) {
        const key = petKeyOf(s, host);
        if (key in seen)
            continue;
        seen[key] = true;
        out.push({key, session: s, host, order: out.length});
    }
    return out.sort((a, b) => rank[a.session.state] - rank[b.session.state] || a.order - b.order);
}

// Accounts close to their 5-hour limit, e.g. "work: 100% of the 5-hour limit!"
export function highUsageText(groups) {
    const parts = [];
    for (const g of groups) {
        for (const w of g.limits ? g.limits.windows : []) {
            if (w.key === 'five_hour' && w.pct >= 90)
                parts.push(fmt('%1: %2% of the 5-hour limit!', groupLabel(g), Math.round(w.pct)));
        }
    }
    return parts.join(' ');
}

export function maxFiveHour(groups) {
    let m = 0;
    for (const g of groups) {
        for (const w of g.limits ? g.limits.windows : []) {
            if (w.key === 'five_hour')
                m = Math.max(m, w.pct);
        }
    }
    return m;
}

// A working session whose context window is nearly full and that has no
// pet of its own to show it, e.g. "fix parser: context 91% full"
export function contextFullText(groups, petColors) {
    for (const g of groups) {
        for (const s of g.sessions) {
            if (s.state === 'working' && s.context !== null && s.context >= 85 && !(petKeyOf(s, g.host) in petColors))
                return fmt('%1: context %2% full', s.name, Math.round(s.context));
        }
    }
    return '';
}

export function firstWaitingName(groups) {
    for (const g of groups) {
        for (const s of g.sessions) {
            if (s.state === 'waiting')
                return s.name;
        }
    }
    return '';
}

// Which window jump.py wants raised (raiser.js; on Plasma its KWIN_SCRIPT).
// want: {pids, caption, require, prefer}. The window owned by the nearest of
// pids wins (pids go from the process up to its ancestors); a title with
// caption first (only those if require), then one with prefer.
export function pickWindow(windows, want) {
    const pids = Array.isArray(want.pids) ? want.pids.filter(Number.isInteger).slice(0, 64) : [];
    const caption = typeof want.caption === 'string' ? want.caption : '';
    const prefer = typeof want.prefer === 'string' ? want.prefer : '';
    let best = null, bestScore = -1;
    for (const w of windows) {
        const rank = pids.indexOf(w.pid);
        if (rank < 0)
            continue;
        const title = w.title || '';
        const hit = caption !== '' && title.includes(caption);
        if (want.require && !hit)
            continue;
        let score = 100 - rank;   // the nearest ancestor owning a window wins
        if (hit)
            score += 1000;
        if (prefer && title.includes(prefer))
            score += 500;
        if (score > bestScore) {
            best = w;
            bestScore = score;
        }
    }
    return best;
}

// The VS Code button of a new chat (port of main.qml's vscodeHint): VS Code's
// Claude extension runs on one account (status.vscode.on; an SSH host's: its
// ~/.claude), so the button only works there
export function vscodeHint(group, host, status) {
    if (group.vscodeHere) {
        return host ? fmt('Opens VS Code connected to %1 (Remote-SSH) with a new chat in its Claude panel.', host)
            : 'Opens the folder in VS Code with a new chat in its Claude panel.';
    }
    if (host)
        return fmt("VS Code's Claude on %1 runs on another account (the host's ~/.claude).", host);
    const on = status && status.vscode ? status.vscode.on : null;
    return on ? fmt("VS Code's Claude runs on %1, not %2: switch its profile to start a chat on this account there.", on, group.title)
        : "VS Code's Claude doesn't run on this account.";
}
