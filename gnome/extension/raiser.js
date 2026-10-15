// Brings a window to the front for code/jump.py. On Wayland one app can't
// activate another's window; GNOME Shell can, so the extension offers it on
// D-Bus (jump.py's raise_window_gnome calls it). On Plasma jump.py loads a
// KWin script instead: this is the same choice as its KWIN_SCRIPT.

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {pickWindow} from './logic.js';

const PATH = '/org/gnome/Shell/Extensions/ClaudeStatus';
const IFACE = `
<node>
  <interface name="org.gnome.Shell.Extensions.ClaudeStatus">
    <method name="RaiseWindow">
      <arg type="s" direction="in" name="want"/>
      <arg type="b" direction="out" name="handled"/>
    </method>
  </interface>
</node>`;

export class Raiser {
    constructor() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._dbus.export(Gio.DBus.session, PATH);
    }

    // True once looked at, like the KWin script (which can't say whether a
    // window matched)
    RaiseWindow(json) {
        let want;
        try {
            want = JSON.parse(json);
        } catch {
            return false;
        }
        const windows = global.display.list_all_windows()
            .filter(w => w.get_window_type() === Meta.WindowType.NORMAL)
            .map(w => ({window: w, pid: w.get_pid(), title: w.get_title()}));
        const best = pickWindow(windows, want || {});
        if (best)
            Main.activateWindow(best.window);
        return true;
    }

    destroy() {
        this._dbus.unexport();
        this._dbus = null;
    }
}
