import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami

// What a chat waiting for a permission asks (claude_status.py:
// note_permissions): the command, or the file and the change; then Allow
// once, Always allow and Deny (with a note), where the widget can answer it
// (answer "hook": through the hook, "keys": in its tmux pane).
ColumnLayout {
    id: ask

    property var permission: null
    property bool busy: false        // an answer is on its way
    property int diffLines: 6
    property bool denying: false
    signal answered(string decision, string note)

    readonly property bool canAnswer: !!permission && (permission.answer === "hook" || permission.answer === "keys")
    readonly property var diff: permission && permission.diff ? permission.diff : []
    spacing: Kirigami.Units.smallSpacing
    onPermissionChanged: if (!permission) denying = false

    PlasmaComponents3.Label {
        textFormat: Text.PlainText
        Layout.fillWidth: true
        font.bold: true
        wrapMode: Text.Wrap
        text: !ask.permission ? ""
              : ask.permission.command ? i18n("Claude asks to run:")
              : ask.permission.file ? i18n("Claude asks to change %1:", ask.permission.file)
              : i18n("Claude asks: %1", ask.permission.line)
    }
    Rectangle {
        visible: !!ask.permission && ask.permission.command !== ""
        Layout.fillWidth: true
        implicitHeight: commandText.implicitHeight + Kirigami.Units.smallSpacing * 2
        radius: Kirigami.Units.cornerRadius
        color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.07)

        TextEdit {
            id: commandText
            anchors.fill: parent
            anchors.margins: Kirigami.Units.smallSpacing
            text: ask.permission ? ask.permission.command : ""
            textFormat: TextEdit.PlainText
            readOnly: true
            selectByMouse: true
            wrapMode: TextEdit.WrapAnywhere
            color: Kirigami.Theme.textColor
            selectionColor: Kirigami.Theme.focusColor
            font.family: "monospace"
            font.pointSize: Kirigami.Theme.smallFont.pointSize
        }
    }
    DiffView {
        visible: ask.diff.length > 0
        Layout.fillWidth: true
        lines: ask.diff.length > ask.diffLines
               ? ask.diff.slice(0, ask.diffLines).concat([i18n("… %1 more lines", ask.diff.length - ask.diffLines)])
               : ask.diff
    }
    RowLayout {
        visible: ask.canAnswer && !ask.denying
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        PlasmaComponents3.Button {
            enabled: !ask.busy
            icon.name: "dialog-ok-apply"
            text: i18n("Allow once")
            onClicked: ask.answered("allow", "")
        }
        PlasmaComponents3.Button {
            visible: ask.permission && (ask.permission.answer === "keys" || ask.permission.always !== "")
            enabled: !ask.busy
            icon.name: "dialog-ok"
            text: i18n("Always allow")
            onClicked: ask.answered("always", "")

            PlasmaCore.ToolTipArea {
                textFormat: Text.PlainText
                anchors.fill: parent
                mainText: i18n("Always allow")
                subText: !ask.permission ? ""
                         : ask.permission.answer === "keys" ? i18n("Like \"Yes, and don't ask again\" in its dialog.")
                         : i18n("From now on, without asking: %1. Saved in the project's .claude/settings.local.json, as Claude's own \"don't ask again\" does.",
                                ask.permission.always)
            }
        }
        PlasmaComponents3.Button {
            enabled: !ask.busy
            icon.name: "dialog-cancel"
            text: i18n("Deny…")
            onClicked: {
                ask.denying = true
                noteField.forceActiveFocus()
            }
        }
        Item {
            Layout.fillWidth: true
        }
    }
    RowLayout {
        visible: ask.canAnswer && ask.denying
        Layout.fillWidth: true
        spacing: Kirigami.Units.smallSpacing

        PlasmaComponents3.TextField {
            id: noteField
            Layout.fillWidth: true
            placeholderText: i18n("What should Claude do instead? (optional)")
            onAccepted: denyButton.clicked()
        }
        PlasmaComponents3.Button {
            id: denyButton
            enabled: !ask.busy
            icon.name: "dialog-cancel"
            text: i18n("Deny")
            onClicked: {
                ask.answered("deny", noteField.text.trim())
                noteField.text = ""
                ask.denying = false
            }
        }
        PlasmaComponents3.ToolButton {
            icon.name: "edit-undo"
            display: PlasmaComponents3.AbstractButton.IconOnly
            text: i18n("Cancel")
            onClicked: ask.denying = false
        }
    }
    PlasmaComponents3.Label {
        textFormat: Text.PlainText
        visible: !!ask.permission && !ask.canAnswer
        Layout.fillWidth: true
        wrapMode: Text.Wrap
        font: Kirigami.Theme.smallFont
        opacity: 0.7
        text: i18n("Answer it in the chat, or turn on \"Answer permission prompts from the widget\" in the settings to answer it here.")
    }
}
