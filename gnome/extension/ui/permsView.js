// The popup's Permissions tab (port of PermsView.qml): the permissions you
// gave, every rule and mode that lets chats on this computer go without
// asking (each to revoke), and the permission prompts you answered in the
// last 7 days with the rules that would have let the most of them through
// (the recap-rules setting can leave those out). week.py --permissions reads
// them from your settings and the chats' transcripts: no tokens used.

import Clutter from 'gi://Clutter';

import * as L from '../logic.js';
import {heading} from './weekView.js';
import {box, column, label, paragraph, textButton} from './widgets.js';

export function buildPermsView(ctx) {
    const perms = ctx.perms;
    const data = perms.data;
    const view = column('claude-week', {x_expand: true});
    if (perms.busy && data)
        view.opacity = 160;   // what it said before, while it reads again
    if (perms.busy && !data && !perms.error)
        view.add_child(paragraph('Reading your settings and the chats of the last 7 days.', 'claude-dim claude-week-note'));
    if (perms.error)
        view.add_child(paragraph(L.fmt("Couldn't read your permissions: %1", perms.error), 'claude-fg-bad'));
    if (!data)
        return view;
    view.add_child(buildGranted(ctx, data));
    view.add_child(buildPrompts(ctx, data));
    view.add_child(paragraph('Read from your settings and the chats on this computer, without using any tokens.',
        'claude-small claude-dim claude-week-foot'));
    return view;
}

// The permissions you gave: every rule and mode that lets chats on this
// computer go without asking, each to revoke (it asks first)
function buildGranted(ctx, data) {
    const section = column('claude-week-section', {x_expand: true});
    const granted = data.granted || [];
    const week = ctx.perms;
    section.add_child(heading('Permissions you gave'));
    section.add_child(paragraph(L.weekGrantedIntro(granted), 'claude-small claude-dim'));
    for (const g of L.weekGrantedShown(granted, week.allGranted)) {
        const line = box('claude-week-tip', {x_expand: true});
        const text = column('', {x_expand: true});
        text.add_child(paragraph(g.title, ''));
        text.add_child(paragraph(L.weekGrantMeta(g), 'claude-small claude-dim'));
        if (week.revoking === g.id) {
            text.add_child(paragraph(`This ${g.change}.`, 'claude-small'));
            const buttons = box('claude-week-accounts');
            buttons.add_child(textButton('Revoke', () => ctx.revokeGrant(g), 'claude-chip claude-chip-on'));
            buttons.add_child(textButton('Cancel', () => ctx.permsRevokeAsk(''), 'claude-chip'));
            text.add_child(buttons);
        }
        line.add_child(text);
        if (week.ruleBusy === g.id) {
            line.add_child(label('…', 'claude-small claude-dim', {y_align: Clutter.ActorAlign.START}));
        } else if (g.shared) {
            const git = label('In git', 'claude-small claude-dim', {y_align: Clutter.ActorAlign.START});
            ctx.tips.add(git, ['Shared through git', "This folder's .claude/settings.json is shared with whoever uses its repository: change it there."]);
            line.add_child(git);
        } else if (week.revoking !== g.id) {
            const revoke = textButton('Revoke…', () => ctx.permsRevokeAsk(g.id), 'claude-chip');
            revoke.y_align = Clutter.ActorAlign.START;
            revoke.reactive = !week.ruleBusy;
            line.add_child(revoke);
        }
        section.add_child(line);
    }
    const more = granted.length - L.WEEK_GRANTED_FEW;
    if (!week.allGranted && more > 0)
        section.add_child(textButton(`Show ${more} more`, () => ctx.permsShowAllGranted(), 'claude-chip'));
    if (week.ruleMessage && week.ruleRevoked)
        section.add_child(paragraph(week.ruleMessage, 'claude-small'));
    return section;
}

// The permission prompts you answered, and the rules that would have let
// the most of them through (written only when you allow one)
function buildPrompts(ctx, data) {
    const section = column('claude-week-section', {x_expand: true});
    const p = data.prompts;
    if (!p)
        return section;
    const week = ctx.perms;
    section.add_child(heading('Permission prompts, last 7 days'));
    section.add_child(paragraph(p.answered ? L.weekPromptsText(p)
        : 'You answered no permission prompts on this computer in the last 7 days.', ''));
    if (p.byTool.length)
        section.add_child(paragraph(`For: ${p.byTool.map(([tool, n]) => `${tool} ${n}`).join(' · ')}`, 'claude-small claude-dim'));
    const rules = week.rules ? p.rules : [];   // (the settings can leave them out)
    if (rules.length)
        section.add_child(paragraph('These rules would have let the most of them through. One you allow goes into the ' +
            '.claude/settings.local.json of the folder the chats started in (not shared through git), and only chats started there follow it.',
        'claude-small claude-dim'));
    for (const r of rules) {
        const line = box('claude-week-tip', {x_expand: true});
        const text = column('', {x_expand: true});
        text.add_child(paragraph(r.title, ''));
        text.add_child(paragraph(L.weekRuleMeta(r), 'claude-small claude-dim'));
        if (week.asking === r.id) {
            text.add_child(paragraph(`This ${r.change}.`, 'claude-small'));
            const buttons = box('claude-week-accounts');
            buttons.add_child(textButton('Allow', () => ctx.changeRule(r, true), 'claude-chip claude-chip-on'));
            buttons.add_child(textButton('Cancel', () => ctx.permsAsk(''), 'claude-chip'));
            text.add_child(buttons);
        }
        line.add_child(text);
        if (week.ruleBusy === r.id) {
            line.add_child(label('…', 'claude-small claude-dim', {y_align: Clutter.ActorAlign.START}));
        } else if (r.state === 'allowed') {
            line.add_child(label('Allowed now', 'claude-small claude-dim', {y_align: Clutter.ActorAlign.START}));
        } else if (r.state === 'added') {
            const undo = textButton('Undo', () => ctx.changeRule(r, false), 'claude-chip');
            undo.y_align = Clutter.ActorAlign.START;
            undo.reactive = !week.ruleBusy;
            ctx.tips.add(undo, ['Take this rule back', 'You allowed it here: Undo removes it from the file it went into, as it was before.']);
            line.add_child(undo);
        } else if (week.asking !== r.id) {
            const allow = textButton('Allow…', () => ctx.permsAsk(r.id), 'claude-chip');
            allow.y_align = Clutter.ActorAlign.START;
            allow.reactive = !week.ruleBusy;
            line.add_child(allow);
        }
        section.add_child(line);
    }
    if (week.ruleMessage && !week.ruleRevoked)
        section.add_child(paragraph(week.ruleMessage, 'claude-small'));
    return section;
}
