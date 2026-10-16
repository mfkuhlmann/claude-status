// One Claude account (port of the Plasma widget's GroupSection.qml): plan
// limits, token totals, its sessions (from every config dir logged into it),
// chats shared with it that run elsewhere, and recent chats. With remoteHost
// set, the account is on that SSH host and its actions run there.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as L from '../logic.js';
import {buildSessionRow, buildKeepOnly, buildShareMenu} from './sessionRow.js';
import {box, column, iconButton, label, link, meter, separator, textButton} from './widgets.js';

export function buildGroupSection(ctx, group, {last = false, remoteHost = ''} = {}) {
    const tips = ctx.tips;
    const groupKey = (remoteHost ? `${remoteHost}/` : '') + group.id;
    const multiProfile = group.profiles.length > 1;
    const section = column('claude-group', {x_expand: true});

    // Heading: the account, its new-chat button and its profiles
    const head = box('claude-group-head', {x_expand: true});
    head.add_child(label(group.title, 'claude-group-title'));
    const add = iconButton('list-add-symbolic', () => ctx.toggleNewChat(groupKey));
    tips.add(add, [L.fmt('New chat on %1', group.title), remoteHost
        ? L.fmt("Lists this account's folders on %1: start a new Claude chat in one, in a terminal (over ssh) or in VS Code.", remoteHost)
        : "Lists this account's recent folders: start a new Claude chat in one, in a terminal or in VS Code."]);
    head.add_child(add);
    head.add_child(new St.Widget({x_expand: true}));
    if (multiProfile)
        head.add_child(label(group.profiles.join(' + '), 'claude-small claude-dim'));
    section.add_child(head);

    if (ctx.ui.openMenu?.type === 'newchat' && ctx.ui.openMenu.key === groupKey)
        section.add_child(buildNewChatMenu(ctx, group, remoteHost));

    // This account's chats as pets (pets.js), when there are any
    const stage = ctx.stageFor(groupKey, L.stageChats(group, remoteHost));
    if (stage)
        section.add_child(stage);

    // Plan limits (from the status line)
    const limits = column('claude-limits', {x_expand: true});
    for (const w of group.limits ? group.limits.windows : []) {
        const bar = box('claude-usage', {x_expand: true});
        bar.add_child(label(w.label, 'claude-usage-label'));
        bar.add_child(meter(w.pct, L.usageClass(w.pct)));
        bar.add_child(label(`${Math.round(w.pct)}%`, 'claude-usage-pct'));
        bar.add_child(label(L.resetText(w, ctx.now), 'claude-usage-detail claude-small claude-dim'));
        limits.add_child(bar);
    }
    const asOf = label(L.planUsageText(group.limits, ctx.now), 'claude-small claude-dim', {x_expand: true});
    if (!group.limits) {
        tips.add(asOf, ['No plan usage yet',
            'Plan limits come from the Claude Code status line (statusline-snippet.sh). They update whenever a session of this account gets a reply.']);
    }
    limits.add_child(asOf);
    section.add_child(limits);

    // Token totals (from local transcripts)
    if (group.tokens) {
        const tokens = label(L.tokensText(group.tokens), 'claude-tokens', {x_expand: true});
        tips.add(tokens, () => ["Tokens (this machine's transcripts only)", L.tokensTooltip(group.tokens)]);
        section.add_child(tokens);
    }

    // Sessions
    for (const s of group.sessions)
        section.add_child(buildSessionRow(ctx, s, {showProfile: multiProfile, remoteHost}));
    if (group.sessions.length === 0)
        section.add_child(label('No running sessions', 'claude-dim claude-indent'));

    // Chats shared with this account that are in use on another one (they're
    // listed there, once): a line pointing to them
    for (const chat of group.sharedHere || [])
        section.add_child(buildSharedLine(ctx, chat, remoteHost));

    // Recent chats: this account's latest other chats, to pick one up again
    const recent = group.recent || [];
    if (recent.length > 0) {
        const isOpen = groupKey in ctx.ui.expandedRecent ? ctx.ui.expandedRecent[groupKey] : remoteHost !== '';
        const toggle = textButton(L.fmt('Recent chats (%1)', recent.length), () => ctx.toggleRecent(groupKey, isOpen),
            'claude-text-button claude-small claude-expander', isOpen ? 'pan-down-symbolic' : 'pan-end-symbolic');
        tips.add(toggle, ['Recent chats',
            "This account's latest chats that aren't listed above. Click one to reopen it in a terminal (claude --resume)."]);
        section.add_child(toggle);
        if (isOpen) {
            for (const chat of recent)
                section.add_child(buildRecentLine(ctx, chat, remoteHost));
        }
    }

    if (!last)
        section.add_child(separator());
    return section;
}

// New chat on this account: its recent folders, then any folder you pick.
// One switch at the top says where a chat starts (kept between uses): a
// terminal with Claude in the folder you click, or VS Code's Claude extension,
// which runs on one account only (greyed out on the others).
function buildNewChatMenu(ctx, group, host) {
    const menu = column('claude-inline-menu', {x_expand: true});
    menu.add_child(label(L.fmt('New chat on %1 in…', host ? L.fmt('%1 on %2', group.title, host) : group.title),
        'claude-menu-title'));
    const vscodeHere = ctx.vscodeInstalled && !!group.vscodeHere;
    const inVscode = vscodeHere && ctx.newChatInVscode;
    if (ctx.vscodeInstalled)
        menu.add_child(openInSwitch(ctx, group, host, inVscode, vscodeHere));
    for (const f of L.newChatFolders(group, host)) {
        const item = textButton(f.short === '~' ? 'Home folder (~)' : f.short, () => {
            if (host && inVscode)
                ctx.remoteNewChatVscode(host, f.path);
            else if (host)
                ctx.remoteOpen(host, f.newChatCommand || '');
            else
                ctx.newChat(group.chatProfile, f.path, inVscode);
        }, 'claude-menu-item', f.short === '~' ? 'user-home-symbolic' : 'folder-symbolic');
        item.x_expand = true;
        item.reactive = !host || inVscode || !!f.newChatCommand;
        menu.add_child(item);
    }
    if (!host) {
        const choose = textButton('Choose folder…', () => ctx.newChatChoosingFolder(group.chatProfile, inVscode),
            'claude-menu-item', 'folder-open-symbolic');
        choose.x_expand = true;
        menu.add_child(choose);
    }
    return menu;
}

// Terminal | VS Code. VS Code is greyed out on the accounts its Claude
// doesn't run on, with a tooltip saying why (on a wrapper, so it shows then too)
function openInSwitch(ctx, group, host, inVscode, vscodeHere) {
    const line = box('claude-menu-row claude-open-in', {x_expand: true});
    line.add_child(label('Open in:', 'claude-small claude-dim', {y_align: Clutter.ActorAlign.CENTER}));
    const half = (icon, fallback, text, checked, enabled, onClick, tip) => {
        const content = box('claude-button-box');
        content.add_child(new St.Icon({icon_name: icon, fallback_icon_name: fallback, style_class: 'claude-button-icon'}));
        content.add_child(label(text));
        const button = new St.Button({style_class: 'claude-text-button claude-switch-button', child: content,
            checked, reactive: enabled, can_focus: enabled, opacity: enabled ? 255 : 110});
        button.connect('clicked', onClick);
        const wrap = new St.Bin({child: button, y_align: Clutter.ActorAlign.CENTER});
        ctx.tips.add(wrap, tip);
        return wrap;
    };
    line.add_child(half('utilities-terminal-symbolic', 'utilities-terminal', 'Terminal', !inVscode, true,
        () => ctx.setNewChatInVscode(false),
        ['New chats in a terminal', 'A terminal opens with Claude in the folder you click.']));
    line.add_child(half('vscode', 'text-editor-symbolic', 'VS Code', inVscode, vscodeHere,
        () => ctx.setNewChatInVscode(true),
        [vscodeHere ? 'New chats in VS Code' : 'Not on this account', L.vscodeHint(group, host, ctx._status)]));
    return line;
}

function buildSharedLine(ctx, chat, remoteHost) {
    const line = box('claude-line claude-indent', {x_expand: true});
    line.add_child(label('⇄', `claude-fg-${L.stateClass(chat.state)}`));
    const name = link(chat.name, () => (remoteHost ? ctx.remoteOpen(remoteHost, chat.openCommand)
        : ctx.jumpTo(chat.sessionId, chat.profileDir)), 'claude-dim');
    name.x_expand = true;
    ctx.tips.add(name, () => {
        const title = chat.copy ? L.fmt('Shared chat, continued on %1 as a copy', chat.profile)
            : chat.state === 'done' ? L.fmt('Shared chat, last used on %1', chat.profile)
                : L.fmt('Shared chat, open on %1', chat.profile);
        let text = chat.copy
            ? L.fmt('This chat is shared with this account too, but it continued on %1 in a copy Claude forked from it. New messages are only in that copy. Click to go to it.', chat.profile)
            : "This chat is shared with this account too. It's listed once, under the account it's used on. Click to go to it.";
        if (chat.stoppedHere)
            text += '\nIts background session on this account was stopped.';
        return [title, text];
    });
    line.add_child(name);
    line.add_child(label(chat.copy ? L.fmt('copy on %1 · %2', chat.profile, L.stateText(chat, ctx.now))
        : L.fmt('on %1 · %2', chat.profile, L.stateText(chat, ctx.now)), 'claude-small claude-dim claude-side'));
    return line;
}

function buildRecentLine(ctx, chat, remoteHost) {
    const rowKey = (remoteHost ? `${remoteHost}|` : '') + chat.key;
    const wrap = column('claude-recent', {x_expand: true});
    const line = box('claude-line', {x_expand: true, reactive: true, track_hover: true});
    const name = link(chat.name, () => (remoteHost ? ctx.remoteOpen(remoteHost, chat.openCommand)
        : ctx.jumpTo(chat.sessionId, chat.profileDir)));
    name.x_expand = true;
    ctx.tips.add(name, [chat.name, (remoteHost ? L.fmt('Reopens it on %1 in a terminal (ssh, claude --resume).', remoteHost)
        : 'Reopens it in a terminal (claude --resume).') +
        (chat.shared ? `\n${L.fmt('Shared between accounts; last used on %1.', chat.profile)}` : '')]);
    line.add_child(name);
    if (chat.shared)
        line.add_child(label('⇄', 'claude-dim'));
    const when = label(L.fmt('%1 · %2 ago', chat.cwdShort || '~', L.duration(ctx.now - chat.lastActive)),
        'claude-small claude-dim claude-side');
    when.clutter_text.ellipsize = 1;   // Pango.EllipsizeMode.START
    line.add_child(when);
    if (ctx.canShareChats && !remoteHost && ctx.shareAccounts.length >= 2) {
        const share = iconButton('emblem-shared-symbolic', () => ctx.toggleShareMenu(rowKey, {
            chatId: chat.sessionId, name: chat.name, profileDir: chat.profileDir, shared: chat.shared,
        }));
        ctx.tips.add(share, ['Continue on another account',
            'Share this chat with your other accounts and pick it up there, or keep it on one account only.']);
        share.opacity = 0;
        line.connect('notify::hover', () => {
            share.opacity = line.hover ? 255 : 0;
        });
        line.add_child(share);
    }
    wrap.add_child(line);
    if (ctx.ui.openMenu?.type === 'share' && ctx.ui.openMenu.key === rowKey)
        wrap.add_child(buildShareMenu(ctx, ctx.ui.openMenu.chat, rowKey));
    if (ctx.ui.shareConfirm?.key === rowKey)
        wrap.add_child(buildKeepOnly(ctx));
    return wrap;
}

// An SSH host you picked (port of HostSection.qml): its accounts, fetched by
// remote.py over ssh. Its last answer stays (dimmed) when a check fails.
export function buildHostSection(ctx, host) {
    const tips = ctx.tips;
    const info = ctx.remote[host] || {loading: true, ok: false, error: '', result: null, updatedAt: 0};
    const groups = info.result ? info.result.groups : [];
    const stale = !!info.error && info.result !== null;
    const section = column('claude-host', {x_expand: true});
    section.add_child(separator());

    const head = box('claude-group-head', {x_expand: true});
    head.add_child(new St.Icon({icon_name: 'network-server-symbolic', style_class: 'claude-button-icon'}));
    head.add_child(label(host, 'claude-host-title'));
    const real = info.result && info.result.host && info.result.host.split('.')[0] !== host ? info.result.host : '';
    if (real)
        head.add_child(label(real, 'claude-small claude-dim'));
    head.add_child(new St.Widget({x_expand: true}));
    head.add_child(label(info.loading && !info.result ? 'connecting…'
        : !info.updatedAt ? ''
            : ctx.now - info.updatedAt < 60000 ? 'updated just now'
                : L.fmt('updated %1 ago', L.duration(ctx.now - info.updatedAt)), 'claude-small claude-dim'));
    if (info.result && (info.result.dismissed || 0) > 0) {
        head.add_child(tips.add(iconButton('view-reveal-symbolic', () => ctx.remoteUndismissAll(host)),
            L.fmt('Show removed sessions again (%1)', info.result.dismissed)));
    }
    head.add_child(tips.add(iconButton('view-refresh-symbolic', () => ctx.pollHost(host)),
        [L.fmt('Refresh %1', host), L.fmt("Checked every %1 seconds while it's shown.", ctx.remotePollSeconds)]));
    head.add_child(tips.add(iconButton('window-close-symbolic', () => ctx.toggleHost(host)),
        [L.fmt('Stop showing %1', host), 'Pick it again from the hosts list at the top.']));
    section.add_child(head);

    if (info.error) {
        const err = stale ? L.fmt('%1 Showing what it said %2 ago.', info.error, L.duration(ctx.now - info.updatedAt))
            : info.error;
        const l = label(err, 'claude-fg-bad claude-indent', {x_expand: true});
        l.clutter_text.line_wrap = true;
        l.clutter_text.ellipsize = 0;
        section.add_child(l);
    }
    groups.forEach(g => {
        const s = buildGroupSection(ctx, g, {last: true, remoteHost: host});
        if (stale)
            s.opacity = 128;
        section.add_child(s);
    });
    if (info.ok && groups.length === 0)
        section.add_child(label('No Claude Code config on this host (~/.claude, ~/.claude-*)', 'claude-dim claude-indent'));
    return section;
}
