// Small building blocks for the popup (St widgets), and hover tooltips
// (GNOME Shell has none of its own for popup contents).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function box(styleClass = '', props = {}) {
    return new St.BoxLayout({style_class: styleClass, ...props});
}

export function column(styleClass = '', props = {}) {
    return new St.BoxLayout({style_class: styleClass, orientation: Clutter.Orientation.VERTICAL, ...props});
}

// One line of text, cut off with … when there's no room
export function label(text, styleClass = '', props = {}) {
    const l = new St.Label({text: text ?? '', style_class: styleClass, y_align: Clutter.ActorAlign.CENTER, ...props});
    l.clutter_text.ellipsize = props.ellipsize ?? Pango.EllipsizeMode.END;
    return l;
}

// Text that wraps onto more lines
export function paragraph(text, styleClass = '', props = {}) {
    const l = new St.Label({text: text ?? '', style_class: styleClass, x_expand: true, ...props});
    l.clutter_text.line_wrap = true;
    l.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    l.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return l;
}

export function iconButton(iconName, onClick, styleClass = 'claude-icon-button') {
    const b = new St.Button({
        style_class: styleClass,
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
        child: new St.Icon({icon_name: iconName, style_class: 'claude-button-icon'}),
    });
    b.connect('clicked', () => onClick(b));
    return b;
}

export function textButton(text, onClick, styleClass = 'claude-text-button', iconName = '') {
    const content = box('claude-button-box');
    if (iconName)
        content.add_child(new St.Icon({icon_name: iconName, style_class: 'claude-button-icon'}));
    content.add_child(label(text));
    const b = new St.Button({style_class: styleClass, can_focus: true, child: content, x_align: Clutter.ActorAlign.START});
    b.connect('clicked', () => onClick(b));
    return b;
}

// Clickable text (a session's name, a recent chat): underlined on hover
export function link(text, onClick, styleClass = '') {
    const l = label(text);
    const b = new St.Button({
        style_class: `claude-link ${styleClass}`, can_focus: true, child: l,
        x_align: Clutter.ActorAlign.START, x_expand: false,
    });
    b.connect('clicked', () => onClick(b));
    return b;
}

// Small outlined label, e.g. the profile or "VS Code" next to a session name
export function tag(text, active = false) {
    return new St.Label({
        text, style_class: `claude-tag${active ? ' claude-tag-active' : ''}`,
        y_align: Clutter.ActorAlign.CENTER, reactive: true, track_hover: true,
    });
}

// A bar filled to pct% in the color class (working, waiting, bad)
export function meter(pct, colorClass, styleClass = 'claude-meter') {
    const trough = new St.BoxLayout({style_class: styleClass, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    const fill = new St.Widget({style_class: `claude-meter-fill claude-bg-${colorClass}`, y_expand: true});
    trough.add_child(fill);
    const share = Math.min(100, Math.max(0, pct)) / 100;
    trough.connect('notify::width', () => {
        fill.width = Math.round(trough.width * share);
    });
    return trough;
}

// A plan usage bar: filled to pct%, then, lighter, to where it would be when
// the window resets at your pace (projected, e.g. claude_status.py's
// forecast.atReset), and a thin tick where an even pace would be by now
export function usageMeter(pct, colorClass, projected = pct, projectedClass = colorClass, evenPct = null) {
    const trough = new St.Widget({style_class: 'claude-meter', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
    const share = v => Math.min(100, Math.max(0, v)) / 100;
    const ahead = projected > pct
        ? new St.Widget({style_class: `claude-meter-fill claude-bg-${projectedClass}`, opacity: 90}) : null;
    const fill = new St.Widget({style_class: `claude-meter-fill claude-bg-${colorClass}`});
    const tick = evenPct !== null && evenPct !== undefined ? new St.Widget({style_class: 'claude-meter-tick'}) : null;
    for (const part of [ahead, fill, tick]) {
        if (part)
            trough.add_child(part);
    }
    const layout = () => {
        const [w, h] = [trough.width, trough.height];
        const filled = Math.round(w * share(pct));
        fill.set_position(0, 0);
        fill.set_size(filled, h);
        if (ahead) {
            // under the fill's rounded end, so there's no gap between them
            const from = Math.max(0, filled - h);
            ahead.set_position(from, 0);
            ahead.set_size(Math.max(0, Math.round(w * share(projected)) - from), h);
        }
        if (tick) {   // sticks out above and below, so it shows over the fill too
            tick.set_position(Math.max(0, Math.round(w * share(evenPct)) - 1), -3);
            tick.set_size(2, h + 6);
        }
    };
    trough.connect('notify::width', layout);
    trough.connect('notify::height', layout);
    return trough;
}

export function dot(colorClass, styleClass = 'claude-dot') {
    return new St.Widget({style_class: `${styleClass} claude-bg-${colorClass}`, y_align: Clutter.ActorAlign.CENTER});
}

export function separator() {
    return new St.Widget({style_class: 'claude-separator', x_expand: true});
}

// Shows a little box of text under whatever the pointer rests on
export class Tooltips {
    constructor() {
        this._label = new St.Label({style_class: 'dash-label claude-tooltip', visible: false, reactive: false});
        this._label.clutter_text.line_wrap = true;
        this._label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        this._label.connect('destroy', () => {
            this._label = null;   // gone with the shell's UI (shutting down)
        });
        Main.layoutManager.uiGroup.add_child(this._label);
        this._timeout = 0;
        this._owner = null;
    }

    // text: a string, or a function giving one ([title, text] for a bold title)
    add(actor, text) {
        actor.reactive = true;
        actor.track_hover = true;
        actor.connect('notify::hover', () => {
            if (actor.hover)
                this._schedule(actor, text);
            else if (this._owner === actor || this._pending === actor)
                this.hide();
        });
        actor.connect('destroy', () => {
            if (this._owner === actor || this._pending === actor)
                this.hide();
        });
        return actor;
    }

    _schedule(actor, text) {
        this.hide();
        this._pending = actor;
        this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._timeout = 0;
            this._pending = null;
            this._show(actor, typeof text === 'function' ? text() : text);
            return GLib.SOURCE_REMOVE;
        });
    }

    _show(actor, text) {
        const [title, body] = Array.isArray(text) ? text : ['', text];
        if (!title && !body)
            return;
        const esc = s => GLib.markup_escape_text(s, -1);
        this._label.clutter_text.set_markup(
            title && body ? `<b>${esc(title)}</b>\n${esc(body)}` : title ? `<b>${esc(title)}</b>` : esc(body));
        this._owner = actor;
        const [x, y] = actor.get_transformed_position();
        const [, height] = actor.get_transformed_size();
        const monitor = Main.layoutManager.findMonitorForActor(actor) || Main.layoutManager.primaryMonitor;
        const [, natWidth] = this._label.get_preferred_width(-1);
        const [, natHeight] = this._label.get_preferred_height(natWidth);
        let left = Math.min(x, monitor.x + monitor.width - natWidth - 8);
        let top = y + height + 6;
        if (top + natHeight > monitor.y + monitor.height)
            top = y - natHeight - 6;
        this._label.set_position(Math.max(monitor.x + 8, Math.round(left)), Math.round(top));
        Main.layoutManager.uiGroup.set_child_above_sibling(this._label, null);
        this._label.show();
    }

    hide() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = 0;
        }
        this._pending = null;
        this._owner = null;
        this._label?.hide();
    }

    destroy() {
        this.hide();
        this._label?.destroy();
    }
}
