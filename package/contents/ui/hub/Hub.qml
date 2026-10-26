pragma Singleton
import QtQuick

// One status check for every copy of the widget in plasmashell (panel,
// tray, one per desktop…): Plasma runs them all in one QML engine, where a
// singleton is shared, so claude_status.py runs once per interval instead of
// once per copy, and so does each SSH host's check (remote.py --status). Each
// copy says what it wants (want: a command and how often) and gets every
// answer to it (output). Copies with other settings (a moment while shared
// settings spread) get their own runs.
QtObject {
    id: hub

    // copy id -> {since, wants: {key: {command, interval, named}}}; key is
    // what the command is to the copy ("status", "ssh:<host>")
    property var copies: ({})
    // The copy that sends the notifications and plays the sounds: the one
    // here longest. Across programs (another plasmashell, a test window),
    // claude_status.py --instance still picks one (notifier in its answer).
    property string leaderId: ""
    // The name these copies go by in claude_status.py's election: the first
    // copy's, kept when that copy goes, so the others keep notifying
    property string instanceName: ""
    property var running: ({})       // full command line -> command
    property var lastStart: ({})     // command -> ms
    property var lastOutput: ({})    // command -> {stdout, stderr}

    signal output(string command, string stdout, string stderr)
    signal started(string command)   // (an SSH host shows "connecting…" meanwhile)

    // named: the status check, which says which copy asks (--instance)
    function want(id, key, command, interval, named) {
        const copy = copies[id] || (copies[id] = { since: Date.now(), wants: {} })
        const known = copy.wants[key]
        copy.wants[key] = { command: command, interval: interval, named: !!named }
        if (!instanceName)
            instanceName = id
        update()
        if (known && known.command === command)
            return
        // New to this copy: the last answer at once, if there's one
        const last = lastOutput[command]
        if (last)
            Qt.callLater(() => hub.output(command, last.stdout, last.stderr))
        else
            run(command)
    }

    function unwant(id, key) {
        if (copies[id] && key in copies[id].wants) {
            delete copies[id].wants[key]
            update()
        }
    }

    function drop(id) {
        if (!(id in copies))
            return
        delete copies[id]
        update()
    }

    function refresh(command) {
        run(command)
    }

    function wantsOf(command) {
        const out = []
        for (const id in copies)
            for (const key in copies[id].wants)
                if (copies[id].wants[key].command === command)
                    out.push(copies[id].wants[key])
        return out
    }

    // How often a command is checked: as often as its most eager copy wants
    function intervalFor(command) {
        let ms = 0
        for (const w of wantsOf(command))
            if (!ms || w.interval < ms)
                ms = w.interval
        return ms
    }

    function update() {
        let leader = "", since = 0, shortest = 0
        const wanted = {}
        for (const id in copies) {
            const c = copies[id]
            if (!leader || c.since < since || (c.since === since && id < leader)) {
                leader = id
                since = c.since
            }
            for (const key in c.wants) {
                wanted[c.wants[key].command] = true
                if (!shortest || c.wants[key].interval < shortest)
                    shortest = c.wants[key].interval
            }
        }
        leaderId = leader
        ticker.interval = Math.max(1000, shortest || 2000)
        ticker.running = shortest > 0
        // Forget the answers no copy asks for any more
        for (const command in lastOutput)
            if (!(command in wanted))
                delete lastOutput[command]
    }

    function shellQuote(s) {
        return "'" + String(s).replace(/'/g, "'\\''") + "'"
    }

    function run(command) {
        for (const line in running)
            if (running[line] === command)
                return   // a still-running check: don't stack another
        const named = wantsOf(command).some(w => w.named)
        const line = named ? command + " --instance " + shellQuote(instanceName) + " --interval-ms " + (intervalFor(command) || 2000)
                           : command
        running[line] = command
        lastStart[command] = Date.now()
        started(command)
        poller.connectSource(line)
    }

    property Timer ticker: Timer {
        repeat: true
        onTriggered: {
            const due = {}
            for (const id in hub.copies)
                for (const key in hub.copies[id].wants)
                    due[hub.copies[id].wants[key].command] = true
            // (each command at its own pace; a little early is fine)
            for (const command in due)
                if (Date.now() - (hub.lastStart[command] || 0) >= hub.intervalFor(command) - 250)
                    hub.run(command)
        }
    }

    property Exec poller: Exec {
        onNewData: (source, data) => {
            disconnectSource(source)
            const command = hub.running[source]
            delete hub.running[source]
            if (command === undefined)
                return
            const answer = { stdout: data["stdout"] || "", stderr: data["stderr"] || "" }
            if (hub.intervalFor(command))   // still wanted
                hub.lastOutput[command] = answer
            hub.output(command, answer.stdout, answer.stderr)
        }
    }
}
