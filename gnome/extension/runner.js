// Runs the widget's Python helpers (code/*.py, the same ones the Plasma
// widget uses) without blocking GNOME Shell: python3 -I <script> <args>,
// read asynchronously, then handed back as text.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class Runner {
    constructor(codeDir) {
        this._codeDir = codeDir;
        this._cancellable = new Gio.Cancellable();
        this._polls = new Set();   // read-only status checks: stopped on destroy
    }

    // Resolves to {stdout, stderr} (empty when it couldn't start). A poll is
    // only reading, so it's killed when the extension is disabled; actions
    // (jump, stop, new chat) are left to finish.
    run(script, args, {poll = false} = {}) {
        return new Promise(resolve => {
            let proc;
            try {
                const launcher = new Gio.SubprocessLauncher({
                    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
                });
                launcher.set_cwd(GLib.get_home_dir());
                proc = launcher.spawnv(['python3', '-I', GLib.build_filenamev([this._codeDir, script]), ...args]);
            } catch (e) {
                resolve({stdout: '', stderr: `Couldn't run python3: ${e.message}`});
                return;
            }
            if (poll)
                this._polls.add(proc);
            proc.communicate_utf8_async(null, this._cancellable, (p, res) => {
                this._polls.delete(proc);
                try {
                    const [, stdout, stderr] = p.communicate_utf8_finish(res);
                    resolve({stdout: stdout || '', stderr: stderr || ''});
                } catch (e) {
                    resolve({stdout: '', stderr: e.message, cancelled: e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)});
                }
            });
        });
    }

    get cancelled() {
        return this._cancellable.is_cancelled();
    }

    destroy() {
        this._cancellable.cancel();
        for (const proc of this._polls)
            proc.force_exit();
        this._polls.clear();
    }
}
