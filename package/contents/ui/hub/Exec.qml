import QtQuick
import org.kde.plasma.plasma5support as P5Support

// Runs commands as an "executable" DataSource does: connectSource(command),
// then newData(command, data) with data's stdout, stderr and "exit code".
// But each command gets a DataSource of its own, gone with its answer.
//
// Plasma tells every executable DataSource in plasmashell about each command
// that ends, the ones that never ran it too, and each one keeps a property
// named after that command for good: a new name rebuilds its whole list of
// them. With ~30 DataSources kept in each copy of the widget and commands
// named " # <time>" to make them run again, that cost grew all day: after a
// few hours each command took plasmashell a second, so the panel, the
// desktop and the chat pane froze now and then. A DataSource that lives for
// one command only ever sees a few.
//
// A command whose answer never comes (plasmashell lost it) must not block
// that command for good: with staleMs, one that has run longer than that is
// given up and run again. And QML refuses a new DataSource while another one
// of this copy is still being made (it logs "Cannot create new component
// instance before completing the previous" and gives none): the command is
// tried again a moment later, not dropped.
QtObject {
    id: exec

    signal newData(string source, var data)

    property int staleMs: 0      // 0: a command that doesn't answer is waited for
    property var running: ({})   // command -> {source, at}
    property var waiting: []     // commands whose DataSource couldn't be made yet

    function connectSource(command) {
        const old = running[command]
        if (old) {
            if (!staleMs || Date.now() - old.at < staleMs)
                return   // still running: not run twice (as with a DataSource)
            if (old.source) {
                old.source.destroy()
                console.warn("Claude Status: no answer to a command in " + staleMs + " ms, running it again")
            }
        }
        const source = runner.createObject(exec)
        if (!source) {
            running[command] = { source: null, at: Date.now() }
            if (waiting.indexOf(command) < 0)
                waiting.push(command)
            retry.restart()
            return
        }
        running[command] = { source: source, at: Date.now() }
        source.connectSource(command)
    }

    // (each command's DataSource lets go of it by itself; the onNewData
    // handlers still call this, as they did on a DataSource)
    function disconnectSource(command) {
    }

    property Timer retry: Timer {
        interval: 50
        onTriggered: {
            const commands = exec.waiting
            exec.waiting = []
            for (const command of commands) {
                delete exec.running[command]
                exec.connectSource(command)
            }
        }
    }

    property Component runner: Component {
        P5Support.DataSource {
            engine: "executable"
            connectedSources: []
            onNewData: (source, data) => {
                disconnectSource(source)
                destroy()
                delete exec.running[source]
                exec.newData(source, data)
            }
        }
    }
}
