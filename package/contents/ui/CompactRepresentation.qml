import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.components as PlasmaComponents3
import org.kde.kirigami as Kirigami

MouseArea {
    id: compact

    readonly property bool vertical: Plasmoid.formFactor === PlasmaCore.Types.Vertical
    readonly property bool showUsage: Plasmoid.configuration.showUsageInPanel && !vertical && root.panelWindow !== null
    property bool wasExpanded: false

    Layout.minimumWidth: vertical ? 0 : row.implicitWidth
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
            Layout.fillWidth: compact.vertical
            Layout.preferredWidth: compact.vertical ? compact.width : compact.height

            SparkIcon {
                anchors.centerIn: parent
                width: Math.min(parent.width, parent.height) * 0.78
                height: width
                color: root.stateColor(root.overall)
                spinning: root.overall === "working"
            }

            // Count of sessions waiting for input
            Rectangle {
                visible: root.counts.waiting > 0
                anchors.right: parent.right
                anchors.top: parent.top
                width: Math.max(height, badgeLabel.implicitWidth + Kirigami.Units.smallSpacing)
                height: Math.round(parent.height * 0.45)
                radius: height / 2
                color: Kirigami.Theme.negativeTextColor
                border.color: Kirigami.Theme.backgroundColor
                border.width: 1

                PlasmaComponents3.Label {
                    id: badgeLabel
                    anchors.centerIn: parent
                    text: root.counts.waiting
                    color: "white"
                    font.bold: true
                    font.pixelSize: Math.max(7, parent.height * 0.75)
                }
            }
        }

        PlasmaComponents3.Label {
            visible: compact.showUsage
            Layout.fillHeight: true
            verticalAlignment: Text.AlignVCenter
            text: compact.showUsage ? Math.round(root.panelWindow.pct) + "%" : ""
            color: compact.showUsage && root.panelWindow.pct >= 90 ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.textColor
        }
    }
}
