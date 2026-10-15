// Only for the throwaway container of tools/gnome/shell.sh: lets its script
// call org.gnome.Shell.Eval and take screenshots.
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class DevTools extends Extension {
    enable() {
        global.context.unsafe_mode = true;
    }

    disable() {
        global.context.unsafe_mode = false;
    }
}
