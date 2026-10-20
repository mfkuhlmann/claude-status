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

        window.add(this._accountsPage(window, settings));
    }

    // The Claude accounts on this computer or an SSH host (code/accounts.py; a
    // host's through remote.py --accounts; port of the Plasma widget's
    // configAccounts.qml): add one, log in or out, remove one, the default one
    _accountsPage(window, settings) {
        const page = new Adw.PreferencesPage({title: 'Accounts', icon_name: 'system-users-symbolic'});
        const esc = text => GLib.markup_escape_text(text, -1);
        const state = {accounts: [], loaded: false, canCheck: true, linked: false, busy: '', confirm: '', rows: [], closed: false,
            host: '', loadedAt: 0};
        // whose accounts: this computer's, or an SSH host's picked in the popup
        const hosts = settings.get_strv('ssh-hosts').map(h => h.trim()).filter(h => h);
        const where = new Adw.ComboRow({title: 'On', subtitle: 'A host\'s accounts go over ssh: nothing is installed there, and its logins open in a terminal here, where you paste the code Claude gives you.',
            model: Gtk.StringList.new(['This computer', ...hosts])});
        if (hosts.length) {
            const on = new Adw.PreferencesGroup();
            on.add(where);
            page.add(on);
        }

        const about = 'Each account is a Claude folder (~/.claude, ~/.claude-NAME) with a login, history and chats of its own. The default account is listed first and its usage is in the top bar: VS Code\'s Claude runs on it, and plain claude too where ~/.claude is a link. A chat started with the + next to an account runs on that account.';
        const list = new Adw.PreferencesGroup({title: 'Accounts on this computer', description: about});
        page.add(list);

        const add = new Adw.PreferencesGroup({title: 'Add an account',
            description: "A terminal opens with Claude's own login: sign in in your browser with the other account. Claude keeps the login in the new folder; the extension never sees it."});
        const nameRow = new Adw.EntryRow({title: 'Name, e.g. work (its folder: ~/.claude-NAME)'});
        add.add(nameRow);
        const shareRow = new Adw.ComboRow({title: 'Settings',
            subtitle: 'Shared: settings.json (your status line), CLAUDE.md, keybindings and your own skills, agents and commands are linked to that account\'s. The login, MCP servers, plugins and claude.ai\'s skills stay per account.'});
        add.add(shareRow);
        const commandRow = new Adw.ActionRow({title: 'Add a claude-NAME command', subtitle: 'In ~/.local/bin: runs Claude on the new account in any terminal'});
        const commandSwitch = new Gtk.Switch({active: true, valign: Gtk.Align.CENTER});
        commandRow.add_suffix(commandSwitch);
        commandRow.activatable_widget = commandSwitch;
        add.add(commandRow);
        const addRow = new Adw.ActionRow({title: ''});
        const addButton = new Gtk.Button({label: 'Add and Log In…', valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
        addRow.add_suffix(addButton);
        add.add(addRow);
        page.add(add);

        const toast = (text, ok) => {
            if (text)
                window.add_toast(new Adw.Toast({title: esc(text), timeout: ok ? 5 : 10}));
        };
        const run = args => new Promise(resolve => {
            const dirs = settings.get_string('extra-config-dirs').split(',').map(d => d.trim()).filter(d => d)
                .flatMap(d => ['--config-dir', d]);
            const code = name => GLib.build_filenamev([this.path, 'code', name]);
            const argv = state.host
                ? ['python3', '-I', code('remote.py'), '--accounts', state.host, ...args]
                : ['python3', '-I', code('accounts.py'), ...args, ...dirs];
            try {
                const proc = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
                proc.communicate_utf8_async(null, null, (pr, res) => {
                    try {
                        const [, out, err] = pr.communicate_utf8_finish(res);
                        try {
                            resolve(JSON.parse(out));
                        } catch {
                            resolve({ok: false, message: (err || '').trim().split('\n').pop() || 'the helper gave no answer'});
                        }
                    } catch (e) {
                        resolve({ok: false, message: e.message});
                    }
                });
            } catch (e) {
                resolve({ok: false, message: e.message});
            }
        });

        const nameProblem = () => {
            const name = nameRow.text.trim();
            if (!name)
                return 'empty';
            if (name === 'default')
                return 'default is the name of ~/.claude';
            if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name))
                return 'Up to 32 letters, digits, - and _, starting with a letter';
            if (state.accounts.some(a => a.folder === `~/.claude-${name}`))
                return `There's an account called ${name} already`;
            return '';
        };
        const syncAdd = () => {
            const problem = nameProblem();
            const name = nameRow.text.trim();
            addRow.title = problem && problem !== 'empty' ? esc(problem) : name ? esc(`Folder: ~/.claude-${name}`) : '';
            commandRow.title = esc(`Add a claude-${!problem ? name : 'NAME'} command`);
            addButton.sensitive = !problem && !state.busy && state.canCheck;
        };
        nameRow.connect('changed', () => {
            nameRow.remove_css_class('error');
            syncAdd();
        });

        let shareKeys = [];
        const render = () => {
            for (const row of state.rows)
                list.remove(row);
            state.rows = state.accounts.map(a => this._accountRow(a, state, esc, act));
            for (const row of state.rows)
                list.add(row);
            if (!state.loaded) {
                const row = new Adw.ActionRow({title: 'Looking…'});
                state.rows.push(row);
                list.add(row);
            }
            // VS Code's Claude and plain claude on two accounts: say so
            const def = state.accounts.find(a => a.default), plain = state.accounts.find(a => a.main);
            list.description = esc(state.linked && def && plain && def.key !== plain.key
                ? `${about}\n\nVS Code's Claude runs on ${def.label}, the default account, but plain claude on ${plain.label} (~/.claude links there). Make Default on ${def.label} points plain claude there too.`
                : about);
            const keys = state.accounts.map(a => a.key);
            if (keys.join('\n') !== shareKeys.join('\n')) {
                shareKeys = keys;
                shareRow.model = Gtk.StringList.new([...state.accounts.map(a => `Shared with ${a.label}`), "Claude's defaults, nothing shared"]);
                shareRow.selected = 0;
            }
            syncAdd();
        };

        const load = async check => {
            const host = state.host;
            state.loadedAt = Date.now();
            const result = await run(check ? ['--list', '--check'] : ['--list']);
            if (state.closed || host !== state.host)
                return;   // (an answer for the machine shown before)
            if (!result.ok) {
                state.loaded = true;
                toast(result.message, false);
                render();
                return;
            }
            const before = Object.fromEntries(state.accounts.map(a => [a.key, a]));
            // A quick look keeps what Claude said last while the folder says the
            // same (quick); when that changes, Claude is asked again
            const changed = result.accounts.some(a => !before[a.key] || before[a.key].quick !== a.quick);
            state.accounts = result.accounts.map(a => {
                const old = before[a.key];
                return check || !old || !old.checked || old.quick !== a.quick ? a
                    : {...a, checked: true, method: old.method, email: old.email, loggedIn: old.loggedIn};
            });
            state.canCheck = result.canCheck;
            state.linked = !!result.linked;
            state.canDefault = !!result.canDefault;
            const first = !state.loaded;
            state.loaded = true;
            render();
            if (!check && (first || changed))
                load(true);
        };

        const act = async (args, key) => {
            state.busy = key;
            state.confirm = '';
            render();
            const result = await run(args);
            if (state.closed)
                return;
            state.busy = '';
            toast(result.message, result.ok);
            if (result.ok && args[0] === '--add')
                nameRow.text = '';
            await load(true);
        };
        state.render = render;

        addButton.connect('clicked', () => {
            const share = shareKeys[shareRow.selected];
            act(['--add', nameRow.text.trim(), ...share ? ['--share-from', share] : [],
                ...commandSwitch.active ? ['--command'] : []], 'add');
        });

        where.connect('notify::selected', () => {
            state.host = where.selected > 0 ? hosts[where.selected - 1] : '';
            list.title = state.host ? esc(`Accounts on ${state.host}`) : 'Accounts on this computer';
            state.accounts = [];
            state.loaded = false;
            state.confirm = '';
            render();
            load(true);
        });

        load(true);
        // A login happens in a terminal: look again every few seconds (a
        // host's over ssh, less often)
        const timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 4, () => {
            if (state.closed)
                return GLib.SOURCE_REMOVE;
            if (state.loaded && !state.busy && window.is_active && Date.now() - state.loadedAt >= (state.host ? 10000 : 3500))
                load(false);
            return GLib.SOURCE_CONTINUE;
        });
        window.connect('close-request', () => {
            state.closed = true;
            GLib.source_remove(timer);
            return false;
        });
        return page;
    }

    // One account: what it is, and its buttons (log in or out, remove, its
    // claude-NAME command); logging out and removing ask first
    _accountRow(a, state, esc, act) {
        const parts = [a.folder];
        if (a.default)
            parts.push('default');
        if (a.main)
            parts.push('plain claude');
        if (a.vscode)
            parts.push("VS Code's Claude");
        if (!a.loggedIn)
            parts.push('not logged in');
        else if (a.method && a.method !== 'claude.ai')
            parts.push(`logged in (${a.method})`);
        else
            parts.push(...[a.email || a.account || 'logged in', a.plan].filter(t => t));
        if (a.chats > 0)
            parts.push(a.chats === 1 ? '1 chat running' : `${a.chats} chats running`);
        const row = new Adw.ActionRow({title: esc(a.label), subtitle: esc(parts.join(' · '))});
        const button = (label, onClick, css = [], tip = '') => {
            const b = new Gtk.Button({label, valign: Gtk.Align.CENTER, css_classes: css, tooltip_text: tip});
            b.sensitive = !state.busy;
            b.connect('clicked', onClick);
            row.add_suffix(b);
            return b;
        };
        const rerender = () => state.render();
        if (state.confirm === `remove:${a.key}` || state.confirm === `logout:${a.key}`) {
            const removing = state.confirm.startsWith('remove:');
            row.subtitle = esc(removing
                ? `Remove ${a.label}? It logs out, then moves ${a.folder} to the Trash with its chats, history and settings. Chats shared with your other accounts stay on them.`
                : `Log out of ${a.label}? Claude deletes its login; its chats and history stay, and Log in… signs it in again.`);
            button(removing ? 'Remove' : 'Log out', () => act([removing ? '--remove' : '--logout', a.key], a.key),
                [removing ? 'destructive-action' : 'suggested-action']);
            button('Cancel', () => {
                state.confirm = '';
                rerender();
            });
            return row;
        }
        if (state.canDefault && state.accounts.length > 1 && a.loggedIn && (!a.default || (state.linked && !a.main))) {
            button('Make Default', () => act(['--default', a.key], a.key), [], state.linked
                ? "Lists it first and shows its usage in the top bar; VS Code's Claude and plain claude (~/.claude) run on it. Not while a chat runs through ~/.claude: it would go on on this account."
                : "Lists it first and shows its usage in the top bar; VS Code's Claude runs on it. Plain claude stays on ~/.claude, a folder.");
        }
        if (!a.loggedIn) {
            button('Log in…', () => act(['--login', a.key], a.key), [],
                "Opens a terminal with Claude's own login (claude auth login): sign in in your browser with the account for this folder.");
        } else {
            const out = button('Log out…', () => {
                state.confirm = `logout:${a.key}`;
                rerender();
            }, [], a.chats > 0 ? "Close its chats first: they'd lose the login." : "Claude deletes this account's login (claude auth logout).");
            out.sensitive = !state.busy && a.chats === 0;
        }
        const remove = button('Remove…', () => {
            state.confirm = `remove:${a.key}`;
            rerender();
        }, [], a.notRemovable || 'Logs out and moves the folder to the Trash.');
        remove.sensitive = !state.busy && !a.notRemovable;
        if (a.commandName) {
            const check = new Gtk.CheckButton({label: a.commandName, active: !!a.command, valign: Gtk.Align.CENTER,
                tooltip_text: `~/.local/bin/${a.commandName} runs Claude on this account in any terminal.`});
            check.sensitive = !state.busy;
            check.connect('toggled', () => act([check.active ? '--command' : '--no-command', a.key], a.key));
            row.add_suffix(check);
        }
        return row;
    }

    // An accelerator like <Super><Shift>c, checked before it's kept
    _shortcutRow(settings, key, title) {
        const row = new Adw.EntryRow({title, show_apply_button: true, text: settings.get_strv(key)[0] || ''});
        row.connect('apply', () => {
            const text = row.text.trim();
            const [ok, keyval, mods] = text ? Gtk.accelerator_parse(text) : [true, 0, 0];
            // a key with no modifier (plain "c") would take that key from every app
            if (text && (!ok || !keyval || !mods)) {
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
            row.subtitle = preset >= 0 ? '' : GLib.markup_escape_text(GLib.path_get_basename(value), -1);   // shown as markup
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
