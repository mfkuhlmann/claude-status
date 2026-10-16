import QtQuick
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore

// "VS Code" next to a folder in an account's new-chat list (GroupSection.qml):
// starts the chat in VS Code's Claude extension. Greyed out on the accounts
// VS Code's Claude doesn't run on; the tooltip says why, also when greyed out
// (it sits beside the button, so the button's state doesn't switch it off).
Item {
    id: vscodeButton

    property bool here: false   // VS Code's Claude runs on this account
    property string hint
    signal clicked()

    implicitWidth: button.implicitWidth
    implicitHeight: button.implicitHeight

    PlasmaComponents3.ToolButton {
        id: button
        anchors.fill: parent
        enabled: vscodeButton.here
        icon.name: "vscode"
        text: i18n("VS Code")
        display: PlasmaComponents3.AbstractButton.TextBesideIcon
        onClicked: vscodeButton.clicked()
    }

    PlasmaCore.ToolTipArea {
        anchors.fill: parent
        mainText: vscodeButton.here ? i18n("New chat in VS Code") : i18n("Not on this account")
        subText: vscodeButton.hint
    }
}
