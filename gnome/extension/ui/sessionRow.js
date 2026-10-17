// One session in an account's list (port of the Plasma widget's
// SessionRow.qml): state dot, name (click to jump there), tags, state, and
// on hover the share, remove and stop buttons; below it the folder, model,
// context fill, what it needs, its subagents and any question to confirm.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as L from '../logic.js';
import {box, column, dot, iconButton, label, link, meter, paragraph, tag, textButton} from './widgets.js';

export function buildSessionRow(ctx, session, {showProfile = false, remoteHost = ''} = {}) {
    const s = session;
    const tips = ctx.tips;
    const rowKey = (remoteHost ? `${remoteHost}|` : '') + s.key;
    // A background session (claude stop), or an idle chat in a terminal (its claude quits)
    const canEnd = L.canEnd(s);
    const canStop = canEnd || (s.kind === 'bg' && s.pid !== null && (!remoteHost || !!s.stopCommand));
    const confirmingStop = s.key !== '' && ctx.ui.stopConfirm === rowKey;
    const canShare = ctx.canShareChats && !remoteHost && s.pid === null && s.state === 'done' &&
        !!s.chatId && ctx.shareAccounts.length >= 2;
    const petColor = ctx.petColors[L.petKeyOf(s, remoteHost)] || '';
    const agents = s.agents || null;
    const showAgents = ctx.ui.expandedAgents[rowKey] === true;
    const open = () => (remoteHost ? ctx.remoteShow(remoteHost, s) : ctx.jumpTo(s.sessionId, s.profileDir));

    const row = box('claude-session-row', {x_expand: true, reactive: true, track_hover: true});

    // A bar in the color of the chat's pet, to spot which pet is which
    row.add_child(new St.Widget({
        style_class: 'claude-pet-bar', y_expand: true,
        style: petColor ? `background-color: ${petColor};` : '',
    }));
    const stateDot = dot(s.reason === 'failed' ? 'bad' : L.stateClass(s.state));
    stateDot.y_align = Clutter.ActorAlign.START;
    row.add_child(stateDot);

    const body = column('claude-session-body', {x_expand: true});
    row.add_child(body);

    // First line: name, tags, state, buttons
    const line1 = box('claude-line', {x_expand: true});
    const name = link(s.name, open, 'claude-session-name');
    name.x_expand = true;
    tips.add(name, L.openHint(s, remoteHost));
    line1.add_child(name);

    if (showProfile)
        line1.add_child(tips.add(tag(s.profile), 'The Claude profile (config folder) this session runs in'));
    const kindTag = s.entrypoint === 'claude-vscode' ? 'VS Code' : s.kind === 'bg' ? 'background' : '';
    if (kindTag) {
        line1.add_child(tips.add(tag(kindTag), s.entrypoint === 'claude-vscode'
            ? "Runs in VS Code's Claude panel. Click the name to open the conversation there."
            : "A background session: Claude's background service runs it, with no terminal of its own. Click the name to open it in a terminal (claude attach)."));
    }
    if (s.shared)
        line1.add_child(tips.add(tag(s.shared.forkOf ? '⇄ shared copy' : '⇄ shared'), () => sharedTooltip(s)));
    if (agents) {
        const t = tag(L.fmt('agents %1/%2', agents.done, agents.total), agents.running > 0);
        t.add_style_class_name('claude-clickable');
        t.connect('button-release-event', () => {
            ctx.toggleAgents(rowKey);
            return Clutter.EVENT_STOP;
        });
        line1.add_child(tips.add(t, () => ['Subagents', L.fmt('%1 done, %2 running, %3 stopped. Click to %4 what each one is doing.',
            agents.done, agents.running, agents.stopped, showAgents ? 'hide' : 'show')]));
    }
    line1.add_child(label(L.stateText(s, ctx.now),
        `claude-state${s.state === 'waiting' ? ' claude-fg-waiting claude-strong' : ''}`));

    const hoverButtons = [];
    if (canShare) {
        const share = iconButton('emblem-shared-symbolic', () => ctx.toggleShareMenu(rowKey, {
            chatId: s.chatId, name: s.name, profileDir: s.profileDir,
            shared: !!s.shared && !s.shared.forkOf,
        }));
        tips.add(share, ['Continue on another account',
            'Share this chat with your other accounts and pick it up there, or keep it on one account only.']);
        hoverButtons.push(share);
        line1.add_child(share);
    }
    if (s.state === 'done') {
        // Remove a finished session from the list (nothing is deleted)
        const remove = iconButton('list-remove-symbolic',
            () => (remoteHost ? ctx.remoteDismiss(remoteHost, s.sessionId) : ctx.dismissSession(s.sessionId)));
        tips.add(remove, ['Remove from the list',
            'Only hides it here; nothing is deleted. It comes back if the session runs again, or with “Show removed sessions again” at the bottom of this menu.']);
        hoverButtons.push(remove);
        line1.add_child(remove);
    }
    if (canStop) {
        const stop = iconButton('media-playback-stop-symbolic', () => ctx.setStopConfirm(confirmingStop ? '' : rowKey));
        tips.add(stop, canEnd
            ? ['Stop this chat', 'Asks first. Claude quits and its terminal stays open; the chat is kept and shows under Recent chats.']
            : ['Stop this background session', 'Asks first. The conversation is kept; claude attach resumes it.']);
        if (!confirmingStop)
            hoverButtons.push(stop);
        line1.add_child(stop);
    }
    const syncHover = () => {
        for (const b of hoverButtons)
            b.opacity = row.hover ? 255 : 0;
    };
    row.connect('notify::hover', syncHover);
    syncHover();
    body.add_child(line1);

    // Second line: folder, model, context fill
    const line2 = box('claude-line claude-small', {x_expand: true});
    const cwd = label(s.cwdShort, 'claude-dim', {x_expand: true});
    cwd.clutter_text.ellipsize = 2;   // Pango.EllipsizeMode.MIDDLE
    line2.add_child(cwd);
    if (s.model)
        line2.add_child(label(s.model, 'claude-dim'));
    if (s.context !== null && s.context !== undefined) {
        const m = meter(s.context, L.usageClass(s.context), 'claude-meter claude-context-meter');
        m.x_expand = false;
        line2.add_child(m);
        line2.add_child(label(L.fmt('ctx %1%', Math.round(s.context)), 'claude-dim'));
    }
    body.add_child(line2);

    if (s.detail && (s.state === 'waiting' || s.state === 'done')) {
        const detail = label(s.detail, 'claude-detail claude-small', {x_expand: true});
        tips.add(detail, [s.state === 'waiting' ? 'What it needs' : 'Result', s.detail]);
        body.add_child(detail);
    }

    if (showAgents && agents)
        body.add_child(buildAgentsTree(ctx, agents));

    if (ctx.ui.openMenu?.type === 'share' && ctx.ui.openMenu.key === rowKey)
        body.add_child(buildShareMenu(ctx, ctx.ui.openMenu.chat, rowKey));
    if (s.key !== '' && ctx.ui.shareConfirm?.key === rowKey)
        body.add_child(buildKeepOnly(ctx));

    if (confirmingStop && canStop) {
        body.add_child(confirmBox(L.stopQuestion(s), [
            ['Stop', 'media-playback-stop-symbolic', () => {
                ctx.setStopConfirm('');
                if (remoteHost && canEnd)
                    ctx.remoteEnd(remoteHost, s.sessionId, s.profileDir);
                else if (remoteHost)
                    ctx.remoteStop(remoteHost, s.stopCommand);
                else
                    ctx.stopSession(s.sessionId, s.profileDir);
            }],
            ['Cancel', '', () => ctx.setStopConfirm('')],
        ]));
    }
    return row;
}

function sharedTooltip(s) {
    const info = s.shared;
    if (info.forkOf) {
        let text = L.fmt('A copy of a chat shared between the %1 profiles: Claude forked it into a chat of its own on %2, so new messages here are only on %2.',
            info.profiles.join(' + '), info.forkOn);
        if (info.movedHere)
            text += "\nThe shared chat continued here, so it isn't listed itself.";
        if (info.stoppedCopies)
            text += `\n${L.fmt('Its background session on %1 was stopped; %1 shows a link to this copy.', info.stoppedCopies.join(', '))}`;
        return ['Copy of a shared chat', text];
    }
    let text = L.fmt('This chat is shared between the %1 profiles: it continues on whichever account you open it with. Only one session can have it open at a time.',
        info.profiles.join(' + '));
    if (s.kind === 'chat')
        text += `\n${L.fmt('Listed here because it was used on %1 last.', s.profile)}`;
    if (info.openIn)
        text += `\n${L.fmt('Open in %1 right now.', info.openIn)}`;
    if (info.stoppedCopies)
        text += `\n${L.fmt('Its background session on %1 was stopped; %1 shows a link to this chat.', info.stoppedCopies.join(', '))}`;
    return ['Shared chat', text];
}

// Subagents as a tree: what each one is doing
function buildAgentsTree(ctx, agents) {
    const tree = column('claude-agents', {x_expand: true});
    for (const a of agents.tree) {
        const line = box('claude-agent', {x_expand: true, style: `margin-left: ${Math.round(a.depth * 14)}px;`});
        line.add_child(label('└', 'claude-dim'));
        const d = dot(a.status === 'running' ? 'working' : a.status === 'done' ? 'ok' : 'none', 'claude-dot claude-dot-small');
        d.y_align = Clutter.ActorAlign.START;
        line.add_child(d);
        const col = column('', {x_expand: true});
        const top = box('claude-line', {x_expand: true});
        top.add_child(label(a.description || a.type, 'claude-small', {x_expand: true}));
        top.add_child(label(a.type, 'claude-small claude-dim'));
        top.add_child(label(a.status === 'running'
            ? L.fmt('running · %1', L.duration(ctx.now - (a.started || ctx.now)))
            : a.status === 'done' ? 'done' : 'stopped', 'claude-small claude-dim'));
        col.add_child(top);
        if (a.activity) {
            const activity = label(a.activity, 'claude-small claude-dim', {x_expand: true});
            ctx.tips.add(activity, [a.description || a.type, a.activity]);
            col.add_child(activity);
        }
        line.add_child(col);
        tree.add_child(line);
    }
    return tree;
}

// A question with buttons, e.g. "Stop “fix parser”? …" [Stop] [Cancel]
export function confirmBox(text, buttons) {
    const c = column('claude-confirm', {x_expand: true});
    c.add_child(paragraph(text, 'claude-small'));
    const row = box('claude-confirm-buttons');
    for (const [title, icon, onClick] of buttons)
        row.add_child(textButton(title, onClick, 'claude-text-button claude-confirm-button', icon));
    c.add_child(row);
    return c;
}

// Share a chat with your other accounts, continue it on one of them, or
// keep it on one only (jump.py)
export function buildShareMenu(ctx, chat, rowKey) {
    const menu = column('claude-inline-menu', {x_expand: true});
    menu.add_child(label(chat.name, 'claude-menu-title'));
    const here = ctx.groupOfProfile(chat.profileDir);
    for (const g of ctx.shareAccounts) {
        if (g === here)
            continue;
        menu.add_child(textButton(chat.shared ? L.fmt('Continue on %1', g.title) : L.fmt('Share and continue on %1', g.title),
            () => ctx.shareAction('continue', chat.chatId, g.shareProfile), 'claude-menu-item', 'go-next-symbolic'));
    }
    if (!chat.shared) {
        menu.add_child(textButton('Share with all accounts', () => ctx.shareAction('share', chat.chatId, ''),
            'claude-menu-item', 'emblem-shared-symbolic'));
    } else {
        for (const g of ctx.shareAccounts) {
            menu.add_child(textButton(L.fmt('Keep only on %1…', g.title), () => ctx.askKeepOnly(rowKey, chat, g),
                'claude-menu-item', 'list-remove-symbolic'));
        }
    }
    return menu;
}

// Asks before a shared chat is kept on one account only (the others lose it)
export function buildKeepOnly(ctx) {
    const c = ctx.ui.shareConfirm;
    return confirmBox(L.fmt("Keep “%1” only on %2? It leaves the chat lists of %3; the conversation stays on %2. It can't be open in a session meanwhile.",
        c.name, c.account, c.others), [
        [L.fmt('Keep only on %1', c.account), 'list-remove-symbolic', () => ctx.confirmKeepOnly()],
        ['Cancel', '', () => ctx.cancelKeepOnly()],
    ]);
}
