import QtQuick
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore

// One half of the Terminal | VS Code switch (OpenInSwitch.qml). Greyed out
// where it can't open a chat; the tooltip says why, also when greyed out (it
// sits beside the button, so the button's state doesn't switch it off).
Item {
    id: openInButton

    property bool available: false
    property bool checked: false
    property string iconName
    property string text
    property string tipTitle
    property string tip
    signal clicked()

    implicitWidth: button.implicitWidth
    implicitHeight: button.implicitHeight

    PlasmaComponents3.ToolButton {
        id: button
        anchors.fill: parent
        enabled: openInButton.available
        checked: openInButton.checked
        icon.name: openInButton.iconName
        text: openInButton.text
        display: PlasmaComponents3.AbstractButton.TextBesideIcon
        onClicked: openInButton.clicked()
    }

    PlasmaCore.ToolTipArea {
        anchors.fill: parent
        mainText: openInButton.tipTitle
        subText: openInButton.tip
    }
}
