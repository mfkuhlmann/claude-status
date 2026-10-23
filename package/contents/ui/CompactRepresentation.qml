import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.components as PlasmaComponents3
import org.kde.kirigami as Kirigami

MouseArea {
    id: compact

    readonly property bool vertical: Plasmoid.formFactor === PlasmaCore.Types.Vertical
    // Not in the system tray: its icons are square
    readonly property bool showUsage: Plasmoid.configuration.showUsageInPanel && !vertical && !root.inTray && root.panelWindow !== null
    // One count at a time, the most urgent: chats that need you (red), else
    // chats that finished since you last opened the popup (green). Working
    // chats show as Talpa glancing around; the tooltip has every count.
    readonly property int badgeCount: root.counts.waiting > 0 ? root.counts.waiting : root.unseenDone
    // To catch your eye: it blinks while a chat that needs you hasn't been
    // seen, and pulses a few times when one finishes (opening the popup stops it)
    property int pulses: 0
    property int doneBefore: 0
    readonly property bool blinking: Plasmoid.configuration.iconBlink && !root.expanded
                                     && (root.unseenWaiting > 0 || pulses > 0)

    Connections {
        target: root
        function onUnseenDoneChanged() {
            if (root.unseenDone > compact.doneBefore)
                compact.pulses = 6   // three blinks
            compact.doneBefore = root.unseenDone
        }
        function onExpandedChanged() {
            if (root.expanded)
                compact.pulses = 0   // seen: the pulses left don't go on once it closes
        }
    }

    Timer {
        interval: 450
        repeat: true
        running: compact.blinking
        onTriggered: {
            icon.dimmed = !icon.dimmed
            if (compact.pulses > 0)
                compact.pulses -= 1
        }
        onRunningChanged: if (!running) icon.dimmed = false
    }
    property bool wasExpanded: false

    // In the system tray the slot is given (one icon wide, but as tall as a
    // thick panel's row): the icon fits in it, as tray icons do
    Layout.minimumWidth: vertical || root.inTray ? 0 : row.implicitWidth
    Layout.preferredWidth: Layout.minimumWidth
    Layout.minimumHeight: vertical ? width : 0

    acceptedButtons: Qt.LeftButton | Qt.MiddleButton
    hoverEnabled: true
    onPressed: wasExpanded = root.expanded
    onClicked: mouse => {
        if (mouse.button === Qt.MiddleButton)
            root.refresh()
        else
            root.expanded = !wasExpanded
    }

    RowLayout {
        id: row
        anchors.fill: parent
        spacing: Kirigami.Units.smallSpacing

        Item {
            id: iconBox
            Layout.fillHeight: true
            Layout.fillWidth: compact.vertical || root.inTray
            Layout.preferredWidth: compact.vertical || root.inTray ? -1 : compact.height

            // The icon's square, centered (the box can be taller than wide)
            Item {
                id: square
                anchors.centerIn: parent
                width: Math.min(parent.width, parent.height)
                height: width
            }

            TalpaIcon {
                id: icon
                property bool dimmed: false
                anchors.centerIn: square
                width: square.width * (root.inTray ? 0.86 : 0.78)
                height: width
                color: root.stateColor(root.overall)
                mode: root.overall
                opacity: dimmed ? 0.2 : 1

                Behavior on opacity {
                    NumberAnimation { duration: 400; easing.type: Easing.InOutQuad }
                }
            }

            Rectangle {
                visible: compact.badgeCount > 0
                anchors.right: square.right
                anchors.top: square.top
                width: Math.max(height, badgeLabel.implicitWidth + Kirigami.Units.smallSpacing)
                height: Math.round(square.height * 0.45)
                radius: height / 2
                color: root.counts.waiting > 0 ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.positiveTextColor
                border.color: Kirigami.Theme.backgroundColor
                border.width: 1

                PlasmaComponents3.Label {
                    id: badgeLabel
                    textFormat: Text.PlainText
                    anchors.centerIn: parent
                    text: compact.badgeCount
                    color: "white"
                    font.bold: true
                    font.pixelSize: Math.max(7, parent.height * 0.75)
                }
            }
        }

        PlasmaComponents3.Label {
            textFormat: Text.PlainText
            visible: compact.showUsage
            Layout.fillHeight: true
            verticalAlignment: Text.AlignVCenter
            text: compact.showUsage ? Math.round(root.panelWindow.pct) + "%" : ""
            color: compact.showUsage && root.panelWindow.pct >= 90 ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.textColor
        }
    }
}
