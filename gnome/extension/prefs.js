// Settings window (port of the Plasma widget's configGeneral.qml and
// SoundChooser.qml): same settings, same defaults (schemas/*.gschema.xml).

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Sounds from the sound theme (comma separated: the first one found plays)
const SOUNDS = [
    ['Message', 'message-new-instant'],
    ['Success', 'outcome-success,complete'],
    ['Complete', 'complete'],
    ['Bell', 'bell'],
    ['Attention', 'window-attention'],
    ['Question', 'dialog-question,dialog-information'],
    ['Information', 'dialog-information'],
    ['Warning', 'dialog-warning'],
    ['Error', 'dialog-error'],
    ['No sound', ''],
];

export default class ClaudeStatusPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._claudeSettings = settings;   // lives as long as the window
        window.set_default_size(620, 760);
        const page = new Adw.PreferencesPage({title: 'Claude Status', icon_name: 'preferences-system-symbolic'});
        window.add(page);

        const spin = (key, title, subtitle, min, max, step) => {
            const row = Adw.SpinRow.new_with_range(min, max, step);
            row.set({title, subtitle});
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            return row;
        };
        const toggle = (key, title, subtitle = '') => {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            return row;
        };
        const needs = (row, key) => {
            settings.bind(key, row, 'sensitive', Gio.SettingsBindFlags.GET);
            return row;
        };

        const sessions = new Adw.PreferencesGroup({title: 'Sessions',
            description: '~/.claude and ~/.claude-* are found automatically.'});
        sessions.add(spin('poll-interval', 'Check every', 'milliseconds', 1000, 60000, 500));
        sessions.add(spin('idle-poll-interval', '…while nothing runs',
            'milliseconds, while no chat runs and the menu is closed', 1000, 300000, 1000));
        const dirs = new Adw.EntryRow({title: 'Extra config folders (comma separated)', show_apply_button: true,
            text: settings.get_string('extra-config-dirs')});
        dirs.connect('apply', () => settings.set_string('extra-config-dirs', dirs.text));
        sessions.add(dirs);
        sessions.add(spin('keep-done-hours', 'Keep finished background jobs', 'hours; 0 hides them right away', 0, 168, 1));
        sessions.add(spin('recent-chats', 'Recent chats per account', '0 hides the list', 0, 20, 1));
        page.add(sessions);

        const notify = new Adw.PreferencesGroup({title: 'Notifications'});
        notify.add(toggle('notify-waiting', 'When a session needs input', 'a permission prompt or a question'));
        notify.add(toggle('notify-done', 'When a session finishes its turn'));
        notify.add(needs(spin('notify-done-min-seconds', '…if the turn took at least', 'seconds', 0, 3600, 10),
            'notify-done'));
        notify.add(toggle('away-digest', 'A summary when you come back',
            'after the screen was locked: what finished, failed or needs you, at the top of the menu, and as one notification while the ones above are on'));
        notify.add(needs(spin('away-minutes', '…if you were away at least', 'minutes', 1, 240, 1), 'away-digest'));
        page.add(notify);

        // (a group's description is Pango markup: < is &lt;)
        const keys = new Adw.PreferencesGroup({title: 'Keyboard shortcut',
            description: "Goes to the chat that needs you: the one waiting longest, then a finished turn you haven't seen. Press it again soon after for the next one. With none, it opens the menu. E.g. &lt;Super&gt;&lt;Shift&gt;c; empty for none."});
        keys.add(this._shortcutRow(settings, 'next-chat-shortcut', 'Go to the chat that needs you'));
        page.add(keys);

        const sounds = new Adw.PreferencesGroup({title: 'Sounds',
            description: "Sounds come from your sound theme. They stay quiet while Do Not Disturb is on."});
        sounds.add(toggle('notify-sound', 'Play a sound with these notifications'));
        sounds.add(needs(spin('sound-volume', 'Volume', 'percent', 0, 100, 5), 'notify-sound'));
        sounds.add(needs(this._soundRow(window, settings, 'sound-waiting', 'Needs input'), 'notify-sound'));
        sounds.add(needs(this._soundRow(window, settings, 'sound-done', 'Finished'), 'notify-sound'));
        sounds.add(needs(this._soundRow(window, settings, 'sound-failed', 'Failed'), 'notify-sound'));
        page.add(sounds);

        const ssh = new Adw.PreferencesGroup({title: 'SSH hosts',
            description: "Pick SSH hosts with the server button at the top of the popup. They need key-based login (the widget can't type a password) and python3 on the host; nothing gets installed there."});
        ssh.add(spin('remote-poll-seconds', 'Check SSH hosts every', 'seconds', 10, 600, 10));
        page.add(ssh);

        const look = new Adw.PreferencesGroup({title: 'Panel and popup'});
        look.add(toggle('show-usage-in-panel', 'Show 5-hour usage next to the icon'));
        look.add(toggle('show-pet', 'Show Clawd', 'in the popup and in notifications'));
        look.add(needs(spin('chat-pets', 'Chat pets per account, at most', '0 keeps only the big Clawd', 0, 8, 1),
            'show-pet'));
        look.add(toggle('show-tokens', 'Show token totals', 'from local transcripts'));
        page.add(look);
    }

    // An accelerator like <Super><Shift>c, checked before it's kept
    _shortcutRow(settings, key, title) {
        const row = new Adw.EntryRow({title, show_apply_button: true, text: settings.get_strv(key)[0] || ''});
        row.connect('apply', () => {
            const text = row.text.trim();
            const [ok, keyval] = text ? Gtk.accelerator_parse(text) : [true, 0];
            if (text && (!ok || !keyval)) {
                row.add_css_class('error');
                return;
            }
            row.remove_css_class('error');
            settings.set_strv(key, text ? [text] : []);
        });
        row.connect('changed', () => row.remove_css_class('error'));
        return row;
    }

    // A sound: one of the theme's, none, or a file; with a button to hear it
    _soundRow(window, settings, key, title) {
        const labels = [...SOUNDS.map(([label]) => label), 'Sound file…'];
        const row = new Adw.ComboRow({title, model: Gtk.StringList.new(labels)});
        let syncing = false;
        const sync = () => {
            syncing = true;
            const value = settings.get_string(key);
            const preset = SOUNDS.findIndex(([, v]) => v === value);
            row.selected = preset >= 0 ? preset : SOUNDS.length;
            row.subtitle = preset >= 0 ? '' : GLib.path_get_basename(value);
            syncing = false;
        };
        row.connect('notify::selected', () => {
            if (syncing)
                return;
            if (row.selected < SOUNDS.length) {
                settings.set_string(key, SOUNDS[row.selected][1]);
                return;
            }
            const filter = new Gtk.FileFilter({name: 'Sound files'});
            for (const ext of ['oga', 'ogg', 'wav', 'flac', 'mp3'])
                filter.add_suffix(ext);
            const dialog = new Gtk.FileDialog({title: 'Choose a sound file', default_filter: filter});
            dialog.open(window, null, (d, result) => {
                try {
                    settings.set_string(key, d.open_finish(result).get_path());
                } catch {
                    sync();   // cancelled
                }
            });
        });
        const changed = settings.connect(`changed::${key}`, sync);
        row.connect('destroy', () => settings.disconnect(changed));
        sync();

        const play = new Gtk.Button({icon_name: 'media-playback-start-symbolic', valign: Gtk.Align.CENTER,
            tooltip_text: 'Play this sound', css_classes: ['flat']});
        play.connect('clicked', () => this._preview(settings, settings.get_string(key)));
        row.add_suffix(play);
        return row;
    }

    // Plays even with Do Not Disturb on
    _preview(settings, sound) {
        if (!sound)
            return;
        const theme = new Gio.Settings({schema_id: 'org.gnome.desktop.sound'}).get_string('theme-name');
        try {
            Gio.Subprocess.new(['python3', '-I', GLib.build_filenamev([this.path, 'code', 'notify_sound.py']), sound,
                '--volume', String(settings.get_int('sound-volume')), '--force', '--theme', theme],
            Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            console.warn(`Claude Status: couldn't play ${sound}: ${e.message}`);
        }
    }
}
