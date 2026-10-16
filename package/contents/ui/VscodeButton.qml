import QtQuick
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore

// The "VS Code" half of the Terminal | VS Code switch at the top of an
// account's new-chat list (GroupSection.qml): new chats start in VS Code's
// Claude extension. Greyed out on the accounts VS Code's Claude doesn't run
// on; the tooltip says why, also when greyed out (it sits beside the button,
// so the button's state doesn't switch it off).
Item {
    id: vscodeButton

    property bool here: false   // VS Code's Claude runs on this account
    property bool checked: false
    property string hint
    signal clicked()

    implicitWidth: button.implicitWidth
    implicitHeight: button.implicitHeight

    PlasmaComponents3.ToolButton {
        id: button
        anchors.fill: parent
        enabled: vscodeButton.here
        checked: vscodeButton.checked
        icon.name: "vscode"
        text: i18n("VS Code")
        display: PlasmaComponents3.AbstractButton.TextBesideIcon
        onClicked: vscodeButton.clicked()
    }

    PlasmaCore.ToolTipArea {
        anchors.fill: parent
        mainText: vscodeButton.here ? i18n("New chats in VS Code") : i18n("Not on this account")
        subText: vscodeButton.hint
    }
}
