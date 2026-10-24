// The popup's Week tab: your last 7 days with Claude (week.py, which the
// indicator runs only while this tab is open). How long you were at it and
// how long Claude worked, a day per row on a timeline (drawn with Cairo),
// what the same work would cost at API prices, where it went, and what would
// use less of your plan (the rules of Claude Code's own /usage). No tokens
// used, nothing sent anywhere: it's all read from the chats' transcripts.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as L from '../logic.js';
import {box, column, iconButton, label, meter, paragraph, textButton} from './widgets.js';

const ROW_PX = 18;
// The colors of the timeline: mid tones, as the rest of the popup, so they
// read on the dark and the light shell theme
const YOU = [154 / 255, 153 / 255, 150 / 255, 0.85];
const WORK = [53 / 255, 132 / 255, 228 / 255];
const WAIT = [245 / 255, 121 / 255, 0, 0.85];
const GRID = [0.5, 0.5, 0.5, 0.25];
const MARK = [0.5, 0.5, 0.5, 0.9];

function heading(text) {
    return label(text, 'claude-week-heading');
}

export function buildWeekView(ctx) {
    const week = ctx.week;
    const recap = week.recap;
    const view = column('claude-week', {x_expand: true});
    if (week.busy && recap)
        view.opacity = 160;   // what it said before, while it reads again

    // The 7 days shown, a week back or on, and whose chats
    const period = box('claude-week-period', {x_expand: true});
    const before = iconButton('go-previous-symbolic', () => ctx.setWeek({back: week.back + 1}));
    before.reactive = before.can_focus = !!recap && week.back < recap.backMax;
    before.opacity = before.reactive ? 255 : 90;
    ctx.tips.add(before, 'The week before');
    period.add_child(before);
    period.add_child(label(recap ? L.weekPeriodText({...recap, back: week.back}) : week.back === 0 ? 'Last 7 days' : '',
        'claude-week-span', {x_expand: true, x_align: Clutter.ActorAlign.CENTER}));
    const after = iconButton('go-next-symbolic', () => ctx.setWeek({back: week.back - 1}));
    after.reactive = after.can_focus = week.back > 0;
    after.opacity = after.reactive ? 255 : 90;
    ctx.tips.add(after, 'The week after');
    period.add_child(after);
    view.add_child(period);

    if (recap && recap.accounts.length > 1) {
        const chips = box('claude-week-accounts', {x_expand: true});
        for (const a of [{id: '', name: 'All accounts', plan: null}, ...recap.accounts]) {
            const chip = textButton(a.name + (a.plan ? ` · ${a.plan}` : ''), () => ctx.setWeek({account: a.id}),
                `claude-chip${week.account === a.id ? ' claude-chip-on' : ''}`);
            chips.add_child(chip);
        }
        view.add_child(chips);
    }

    if (week.busy && !recap && !week.error)
        view.add_child(paragraph("Reading your chats of these days. The first time takes a few seconds; after that only what's new is read.",
            'claude-dim claude-week-note'));
    if (week.error)
        view.add_child(paragraph(L.fmt("Couldn't read your week: %1", week.error), 'claude-fg-bad'));
    const s = recap ? recap.sum : null;
    const hasData = !!s && (s.workedMs > 0 || s.prompts > 0 || s.cost > 0);
    if (recap && !hasData)
        view.add_child(paragraph('No Claude in these days: none of your chats here (or on the SSH hosts shown) has a prompt or a reply in them.',
            'claude-dim claude-week-note'));
    if (!hasData)
        return view;

    const tiles = box('claude-week-tiles', {x_expand: true});
    for (const t of L.weekTiles(recap)) {
        const tile = column('claude-week-tile', {x_expand: true});
        tile.add_child(label(t.label, 'claude-small claude-dim'));
        tile.add_child(label(t.value, 'claude-week-value'));
        if (t.delta)
            tile.add_child(label(t.delta, 'claude-small claude-dim'));
        ctx.tips.add(tile, [t.label, t.tip]);
        tiles.add_child(tile);
    }
    view.add_child(tiles);
    const facts = L.weekFactsText(s);
    if (facts)
        view.add_child(paragraph(facts, 'claude-small claude-dim'));

    view.add_child(buildTimeline(ctx, recap));
    view.add_child(buildBars(ctx, 'Where Claude worked', recap.projects.map(p => ({
        name: (p.host ? `${p.host}: ` : '') + p.name, share: p.workedMs / Math.max(1, ...recap.projects.map(q => q.workedMs)),
        value: `${L.hoursText(p.workedMs)} · ${L.moneyText(p.cost)}`, color: 'working',
        tip: [(p.host ? `${p.host}: ` : '') + p.path, `Claude worked ${L.hoursText(p.workedMs)} · ${L.moneyText(p.cost)} at API prices\n` +
            `${p.prompts} prompts · ${p.chats} chats`],
    }))));
    if (recap.chats.length) {
        const chats = column('claude-week-section', {x_expand: true});
        chats.add_child(heading('Chats it worked on most'));
        for (const c of recap.chats) {
            const line = box('claude-week-chat', {x_expand: true});
            line.add_child(label(c.name, '', {x_expand: true}));
            line.add_child(label((c.host ? `${c.host}: ` : '') + c.folder, 'claude-small claude-dim claude-week-folder'));
            line.add_child(label(`${L.hoursText(c.workedMs)} · ${L.moneyText(c.cost)}`, 'claude-small claude-dim'));
            const button = new St.Button({style_class: 'claude-row-button', child: line, x_expand: true, can_focus: !c.host,
                reactive: !c.host});
            button.connect('clicked', () => ctx.jumpTo(c.chatId, c.profileDir));
            ctx.tips.add(button, c.host ? `${c.name} on ${c.host}: its row under ${c.host} opens it` : `Open “${c.name}”`);
            chats.add_child(button);
        }
        view.add_child(chats);
    }
    const models = buildBars(ctx, 'At API prices', recap.models.map(m => ({
        name: m.model, share: m.share, value: `${L.moneyText(m.cost)} · ${L.weekShareText(m.share)}`, color: 'none',
        tip: `${m.model}: ${L.moneyText(m.cost)} · ${m.requests} requests`,
    })));
    const cache = L.weekCacheText(recap);
    if (cache)
        models.add_child(paragraph(cache, 'claude-small claude-dim'));
    view.add_child(models);
    view.add_child(buildTips(ctx, recap));
    view.add_child(paragraph(L.weekFootText(recap), 'claude-small claude-dim claude-week-foot'));
    return view;
}

// A day per row: when you were at it, when Claude worked (darker where
// several chats worked at once), when it waited for your answer
function buildTimeline(ctx, recap) {
    const section = column('claude-week-section', {x_expand: true});
    const head = box('claude-week-head', {x_expand: true});
    head.add_child(heading('Day by day'));
    head.add_child(new St.Widget({x_expand: true}));
    for (const [cls, text] of [['claude-week-swatch-you', 'You'], ['claude-bg-working', 'Claude working'], ['claude-bg-waiting', 'Waiting for you']]) {
        head.add_child(new St.Widget({style_class: `claude-week-swatch ${cls}`, y_align: Clutter.ActorAlign.CENTER}));
        head.add_child(label(text, 'claude-small claude-dim'));
    }
    section.add_child(head);

    const axis = box('claude-week-row', {x_expand: true});
    axis.add_child(label('', 'claude-week-day'));
    const hours = box('claude-week-hours', {x_expand: true});
    [0, 6, 12, 18, 24].forEach((h, i) => {
        hours.add_child(label(String(h), 'claude-small claude-dim', {x_expand: i < 4}));
    });
    axis.add_child(hours);
    axis.add_child(label('You', 'claude-small claude-dim claude-week-num'));
    axis.add_child(label('Claude', 'claude-small claude-dim claude-week-num'));
    section.add_child(axis);

    const readout = label('Point at a day to see what went on then.', 'claude-small claude-dim claude-week-readout', {x_expand: true});
    const areas = [];
    const last = recap.days.length - 1;
    recap.days.forEach((d, i) => {
        const today = i === last && recap.back === 0;
        const row = box('claude-week-row', {x_expand: true});
        row.add_child(label(L.weekRowDay(d.day), `claude-small claude-week-day${today ? ' claude-strong' : ''}`));
        const area = new St.DrawingArea({x_expand: true, height: ROW_PX, reactive: true, track_hover: true});
        area._week = {day: d, today, hoverX: -1};
        area.connect('repaint', a => paintDay(a, recap.generatedAt));
        area.connect('motion-event', (a, event) => {
            const [x, y] = event.get_coords();
            const [ok, lx] = a.transform_stage_point(x, y);
            if (!ok)
                return Clutter.EVENT_PROPAGATE;
            const width = Math.max(1, a.get_width());
            const span = d.end - d.start;
            for (const other of areas) {
                if (other !== a && other._week.hoverX >= 0) {
                    other._week.hoverX = -1;
                    other.queue_repaint();
                }
            }
            a._week.hoverX = lx;
            a.queue_repaint();
            readout.text = L.weekHoverText(d, d.start + (lx / width) * span, recap.generatedAt, span / width);
            readout.remove_style_class_name('claude-dim');
            return Clutter.EVENT_PROPAGATE;
        });
        area.connect('leave-event', a => {
            a._week.hoverX = -1;
            a.queue_repaint();
            readout.text = 'Point at a day to see what went on then.';
            readout.add_style_class_name('claude-dim');
            return Clutter.EVENT_PROPAGATE;
        });
        areas.push(area);
        row.add_child(area);
        row.add_child(label(d.youMs >= 60000 ? L.hoursText(d.youMs) : '–', 'claude-small claude-dim claude-week-num'));
        const worked = label(d.workedMs >= 60000 ? L.hoursText(d.workedMs) : '–', 'claude-small claude-week-num');
        ctx.tips.add(worked, L.weekDayTip(d));
        row.add_child(worked);
        section.add_child(row);
    });
    section.add_child(readout);
    return section;
}

function paintDay(area, now) {
    const {day: d, today, hoverX} = area._week;
    const cr = area.get_context();
    const [w, h] = area.get_surface_size();
    const span = Math.max(1, d.end - d.start);
    const x = ms => Math.max(0, Math.min(w, (ms - d.start) / span * w));
    const bar = (a, b, top, height) => {
        cr.rectangle(x(a), top, Math.max(1, x(b) - x(a)), height);
        cr.fill();
    };
    cr.setSourceRGBA(...GRID);
    for (const q of [0.25, 0.5, 0.75]) {
        cr.rectangle(Math.round(w * q), 0, 1, h);
        cr.fill();
    }
    cr.rectangle(0, h - 1, w, 1);
    cr.fill();
    cr.setSourceRGBA(...YOU);
    for (const [a, b] of d.you)
        bar(a, b, 1, 4);
    cr.setSourceRGBA(...WAIT);
    for (const [a, b] of d.wait)
        bar(a, b, 7, 9);
    for (const [a, b, n] of d.work) {
        cr.setSourceRGBA(...WORK, n >= 3 ? 1 : n === 2 ? 0.8 : 0.55);
        bar(a, b, 7, 9);
    }
    cr.setSourceRGBA(...MARK);
    if (today) {
        cr.rectangle(Math.round(x(now)), 0, 1, h);
        cr.fill();
    }
    if (hoverX >= 0) {
        cr.rectangle(Math.round(hoverX), 0, 1, h);
        cr.fill();
    }
    cr.$dispose();
}

function buildBars(ctx, title, rows) {
    const section = column('claude-week-section', {x_expand: true});
    if (!rows.length)
        return section;
    section.add_child(heading(title));
    for (const r of rows) {
        const line = box('claude-stats-project', {x_expand: true});
        line.add_child(label(r.name, 'claude-small claude-week-name'));
        line.add_child(meter(100 * r.share, r.color, 'claude-meter claude-stats-meter'));
        line.add_child(label(r.value, 'claude-small claude-dim claude-stats-numbers'));
        ctx.tips.add(line, r.tip);
        section.add_child(line);
    }
    return section;
}

// What would use less of your plan (Claude Code's /usage rules)
function buildTips(ctx, recap) {
    const section = column('claude-week-section', {x_expand: true});
    section.add_child(heading('What could use less of your plan'));
    if (!recap.tips.length)
        section.add_child(paragraph("Nothing stands out: no habit takes a tenth of this week's usage.", 'claude-dim'));
    for (const t of recap.tips) {
        const line = box('claude-week-tip', {x_expand: true});
        const text = column('', {x_expand: true});
        text.add_child(paragraph(t.title, ''));
        if (t.detail)
            text.add_child(paragraph(t.detail, 'claude-small claude-dim'));
        line.add_child(text);
        if (t.pct !== null && t.pct !== undefined) {
            const pct = label(`${t.pct}%`, 'claude-small', {y_align: Clutter.ActorAlign.START});
            ctx.tips.add(pct, [`${t.pct}% of this week's usage`, "Of the usage of these 7 days, as Claude Code's /usage weighs it " +
                "toward your plan's limits. A request can count for several of these."]);
            line.add_child(pct);
        }
        if (t.command) {
            const copy = textButton(ctx.week.copied === t.command ? 'Copied' : t.command, () => ctx.copyText(t.command),
                'claude-chip claude-chip-code');
            copy.y_align = Clutter.ActorAlign.START;
            ctx.tips.add(copy, [`Copy ${t.command}`, 'Type it in a chat of yours.']);
            line.add_child(copy);
        }
        section.add_child(line);
    }
    return section;
}
