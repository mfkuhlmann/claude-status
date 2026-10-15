// Claude Status for GNOME Shell: the panel button (indicator.js) and the
// window raiser that code/jump.py calls (raiser.js). Nothing runs until
// enable(), and disable() takes everything down again.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Indicator} from './indicator.js';
import {Raiser} from './raiser.js';

export default class ClaudeStatusExtension extends Extension {
    enable() {
        this._raiser = new Raiser();
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._raiser?.destroy();
        this._raiser = null;
    }
}
