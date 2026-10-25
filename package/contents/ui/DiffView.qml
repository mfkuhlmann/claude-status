import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents3
import org.kde.kirigami as Kirigami

// Lines of a unified diff: added green, removed red, the rest as is.
Rectangle {
    id: diffView

    property var lines: []

    implicitHeight: column.implicitHeight + Kirigami.Units.smallSpacing * 2
    radius: Kirigami.Units.cornerRadius
    color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.05)

    ColumnLayout {
        id: column
        anchors.fill: parent
        anchors.margins: Kirigami.Units.smallSpacing
        spacing: 0

        Repeater {
            model: diffView.lines.length
            delegate: PlasmaComponents3.Label {
                required property int index
                readonly property string line: diffView.lines[index] || ""
                Layout.fillWidth: true
                textFormat: Text.PlainText
                text: line
                elide: Text.ElideRight
                font.family: "monospace"
                font.pointSize: Kirigami.Theme.smallFont.pointSize
                color: line.startsWith("+") ? Kirigami.Theme.positiveTextColor
                     : line.startsWith("-") ? Kirigami.Theme.negativeTextColor
                     : line.startsWith("@@") ? Kirigami.Theme.focusColor : Kirigami.Theme.textColor
                opacity: line.startsWith("+") || line.startsWith("-") ? 1 : 0.7
            }
        }
    }
}
