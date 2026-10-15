import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents3
import org.kde.kirigami as Kirigami

RowLayout {
    id: bar

    property string label
    property real pct: 0
    property string detail

    spacing: Kirigami.Units.smallSpacing

    PlasmaComponents3.Label {
        text: bar.label
        Layout.preferredWidth: Kirigami.Units.gridUnit * 3.5
        elide: Text.ElideRight
    }

    Rectangle {
        Layout.fillWidth: true
        Layout.preferredHeight: Math.round(Kirigami.Units.gridUnit * 0.5)
        radius: height / 2
        color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.15)

        Rectangle {
            width: parent.width * Math.min(100, Math.max(0, bar.pct)) / 100
            height: parent.height
            radius: parent.radius
            color: root.usageColor(bar.pct)
        }
    }

    PlasmaComponents3.Label {
        text: Math.round(bar.pct) + "%"
        Layout.preferredWidth: Kirigami.Units.gridUnit * 2.2
        horizontalAlignment: Text.AlignRight
    }

    PlasmaComponents3.Label {
        text: bar.detail
        Layout.preferredWidth: Kirigami.Units.gridUnit * 6.5
        opacity: 0.7
        font: Kirigami.Theme.smallFont
        elide: Text.ElideRight
    }
}
