// Claude's ✳ glyph built from rounded bars (port of SparkIcon.qml), in the
// color of its style class (claude-fg-*), stepping round while Claude works.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

export const Spark = GObject.registerClass(
class ClaudeSpark extends St.DrawingArea {
    _init(styleClass = 'claude-spark') {
        super._init({style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
        this._angle = 0;
        this._timer = 0;
        this._colorClass = '';
        this.connect('destroy', () => this._stop());
    }

    setState(colorClass, spinning) {
        if (colorClass !== this._colorClass) {
            if (this._colorClass)
                this.remove_style_class_name(`claude-fg-${this._colorClass}`);
            this._colorClass = colorClass;
            this.add_style_class_name(`claude-fg-${colorClass}`);
        }
        // Stepped rotation (~8 fps), so an icon that spins for hours stays cheap
        if (spinning && !this._timer) {
            this._timer = GLib.timeout_add(GLib.PRIORITY_LOW, 120, () => {
                this._angle = (this._angle + 11.25) % 45;
                this.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!spinning) {
            this._stop();
        }
        this.queue_repaint();
    }

    _stop() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = 0;
        }
        this._angle = 0;
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        const size = Math.min(width, height);
        const color = this.get_theme_node().get_foreground_color();
        cr.setSourceRGBA(color.red / 255, color.green / 255, color.blue / 255, color.alpha / 255);
        cr.translate(width / 2, height / 2);
        cr.rotate(this._angle * Math.PI / 180);
        const length = size * 0.96;
        cr.setLineWidth(Math.max(2, length * 0.17));
        cr.setLineCap(1);   // Cairo.LineCap.ROUND
        const reach = length / 2 - cr.getLineWidth() / 2;
        for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 4;
            cr.moveTo(-Math.cos(a) * reach, -Math.sin(a) * reach);
            cr.lineTo(Math.cos(a) * reach, Math.sin(a) * reach);
        }
        cr.stroke();
        cr.$dispose();
    }
});
