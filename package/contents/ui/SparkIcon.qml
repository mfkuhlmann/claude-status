import QtQuick

// Claude's ✳ spinner glyph built from rounded bars so it stays crisp at any
// size and can take the session-state color.
Item {
    id: spark

    property color color: "#d97757"
    property bool spinning: false

    Repeater {
        model: 4
        Rectangle {
            required property int index
            anchors.centerIn: parent
            width: Math.min(spark.width, spark.height) * 0.96
            height: Math.max(2, width * 0.17)
            radius: height / 2
            rotation: index * 45
            antialiasing: true
            color: spark.color
        }
    }

    // Stepped rotation (~8 fps) instead of a 60 fps animation, so a panel
    // icon that spins for hours stays cheap.
    Timer {
        interval: 120
        repeat: true
        running: spark.spinning && spark.visible
        onTriggered: spark.rotation = (spark.rotation + 11.25) % 45
        onRunningChanged: if (!running) spark.rotation = 0
    }
}
