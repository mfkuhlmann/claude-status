import QtQuick
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

// A section's title in the Recap and Permissions tabs: big and bold, under a
// line that sets the section off from the one before
ColumnLayout {
    property alias text: title.text
    Layout.fillWidth: true
    Layout.topMargin: Math.round(Kirigami.Units.gridUnit * 0.7)
    spacing: Math.round(Kirigami.Units.gridUnit * 0.35)

    Kirigami.Separator {
        Layout.fillWidth: true
    }
    Kirigami.Heading {
        id: title
        Layout.fillWidth: true
        textFormat: Text.PlainText
        level: 2
        font.weight: Font.Bold
        wrapMode: Text.Wrap
    }
}
