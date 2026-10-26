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
QtObject {
    id: exec

    signal newData(string source, var data)

    property var running: ({})   // command -> its DataSource

    function connectSource(command) {
        if (running[command])
            return   // still running: not run twice (as with a DataSource)
        const source = runner.createObject(exec)
        running[command] = source
        source.connectSource(command)
    }

    // (each command's DataSource lets go of it by itself; the onNewData
    // handlers still call this, as they did on a DataSource)
    function disconnectSource(command) {
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
