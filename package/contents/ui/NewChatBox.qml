import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami

// A new chat on an account: what Claude should do (optional), then the folder
// it starts in. The + next to an account opens one; so does a plan's "Carry
// it out" (plan set: the chat carries out that plan, in its folder first).
// With a task, the chat starts with it: in a terminal (sent at once), in VS
// Code (typed in for you to send) or in the background (no window: Claude's
// background service runs it, and it's listed right away). The background
// needs a folder Claude trusts already: it can't ask there.
Rectangle {
    id: box

    property var group
    property string remoteHost: ""
    property var plan: null

    readonly property var folders: visible ? root.newChatFolders(group, remoteHost, plan) : []
    readonly property bool inVscode: root.openInVscode(group, remoteHost, false)
    readonly property bool terminalHere: root.cliHere(remoteHost)
    readonly property bool hasTask: root.taskText.trim() !== "" || plan !== null
    readonly property bool background: root.taskBackground && hasTask
    // The account is at a usage limit: a background task can wait until it resets
    readonly property var reset: visible ? root.limitReset(group, remoteHost) : null
    readonly property bool queued: background && root.taskQueued && reset !== null

    // A folder a chat can start in now
    function usable(folder) {
        if (background)
            return terminalHere && folder.trusted !== false
        return inVscode || (terminalHere && (!remoteHost || !!folder.newChatCommand || hasTask))
    }

    implicitHeight: column.implicitHeight + Kirigami.Units.smallSpacing * 2
    radius: Kirigami.Units.cornerRadius
    color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.05)
    border.width: 1
    border.color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.12)

    onVisibleChanged: {
        if (visible) {
            taskField.text = root.taskText
            taskField.forceActiveFocus()
        }
    }

    Connections {   // (cleared once a chat starts)
        target: root
        function onTaskTextChanged() {
            if (box.visible && taskField.text !== root.taskText)
                taskField.text = root.taskText
        }
    }

    ColumnLayout {
        id: column
        anchors.fill: parent
        anchors.margins: Kirigami.Units.smallSpacing
        spacing: Kirigami.Units.smallSpacing / 2

        PlasmaComponents3.Label {
            textFormat: Text.PlainText
            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.smallSpacing
            text: {
                const where = box.remoteHost ? i18nc("account on ssh host", "%1 on %2", box.group.title, box.remoteHost) : box.group.title
                return box.plan ? i18n("Carry out “%1” on %2, in…", box.plan.title, where) : i18n("New chat on %1 in…", where)
            }
            font.bold: true
            opacity: 0.8
            elide: Text.ElideRight
        }

        // What Claude should do (Ctrl+Enter starts it in the first folder)
        PlasmaComponents3.TextArea {
            id: taskField
            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.smallSpacing
            Layout.maximumHeight: Kirigami.Units.gridUnit * 6
            wrapMode: TextEdit.Wrap
            textFormat: TextEdit.PlainText
            placeholderText: box.plan ? i18n("Anything to add? (optional)")
                                      : i18n("What should Claude do? (optional)")
            onTextChanged: root.taskText = text
            Keys.onPressed: event => {
                if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && (event.modifiers & Qt.ControlModifier)) {
                    event.accepted = true
                    const first = box.folders.find(f => box.usable(f))
                    if (first)
                        root.startChat(box.group, box.remoteHost, first, box.inVscode, box.plan)
                } else if (event.key === Qt.Key_Escape) {
                    event.accepted = true
                    root.newChatGroup = ""
                    root.planComposer = ""
                }
            }

            PlasmaCore.ToolTipArea {
                textFormat: Text.PlainText
                anchors.fill: parent
                active: !taskField.activeFocus
                mainText: box.plan ? i18n("Carry out a plan") : i18n("Start with a task")
                subText: (box.plan ? i18n("The chat starts with the plan as its first message, and what you add here.")
                                   : i18n("With a task, the chat starts with it as its first message. Without one, it opens empty."))
                         + " " + i18n("Then click the folder it's for (Ctrl+Enter: the first one).")
            }
        }

        PlasmaComponents3.CheckBox {
            Layout.leftMargin: Kirigami.Units.smallSpacing
            visible: box.hasTask
            text: i18n("In the background")
            checked: root.taskBackground
            enabled: box.terminalHere
            onToggled: root.taskBackground = checked

            PlasmaCore.ToolTipArea {
                textFormat: Text.PlainText
                anchors.fill: parent
                mainText: i18n("Run it in the background")
                subText: i18n("No window opens: Claude's background service runs the chat (claude --bg), and it's listed here right away, so you see when it needs you. Only in folders Claude trusts already: it can't ask there.")
            }
        }

        PlasmaComponents3.CheckBox {
            Layout.leftMargin: Kirigami.Units.gridUnit
            visible: box.background && box.reset !== null
            text: box.reset ? i18n("After the limit resets (in %1, at %2)", root.duration(box.reset.at - root.now), root.clockText(box.reset.at)) : ""
            checked: root.taskQueued
            onToggled: root.taskQueued = checked

            PlasmaCore.ToolTipArea {
                textFormat: Text.PlainText
                anchors.fill: parent
                mainText: i18n("Wait for the usage limit")
                subText: i18n("This account is at its usage limit. The task waits under the account and starts in the background a minute after the limit resets, while the widget runs (or as soon as it runs again). You can start or cancel it before.")
            }
        }

        // Where it starts otherwise: Terminal | VS Code
        OpenInSwitch {
            visible: !box.background
            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.smallSpacing
            group: box.group
            remoteHost: box.remoteHost
        }

        Repeater {
            model: box.folders.length
            delegate: PlasmaComponents3.ItemDelegate {
                id: folderRow
                required property int index
                readonly property var folder: box.folders[index] || ({ path: "", short: "", newChatCommand: "", trusted: true })
                readonly property bool untrusted: box.background && folder.trusted === false
                Layout.fillWidth: true
                icon.name: folderRow.folder.short === "~" ? "user-home" : "folder"
                text: (folderRow.folder.short === "~" ? i18n("Home folder (~)") : folderRow.folder.short)
                      + (box.plan && index === 0 && box.plan.cwd ? "  " + i18nc("the folder a plan was made in", "(the plan's)") : "")
                enabled: box.usable(folderRow.folder)
                onClicked: root.startChat(box.group, box.remoteHost, folderRow.folder, box.inVscode, box.plan)

                PlasmaCore.ToolTipArea {
                    textFormat: Text.PlainText
                    anchors.fill: parent
                    active: folderRow.untrusted
                    mainText: i18n("Claude doesn't trust this folder yet")
                    subText: folderRow.folder.short === "~"
                             ? i18n("Claude never keeps trusting your home folder, and a background session can't ask: start it in a terminal, or pick a project folder.")
                             : i18n("A background session can't ask whether you trust it: start a chat there in a terminal once and say yes.")
                }
            }
        }

        Kirigami.Separator {
            visible: !box.remoteHost && box.folders.length > 0
            Layout.fillWidth: true
            Layout.topMargin: Kirigami.Units.smallSpacing / 2
            Layout.bottomMargin: Kirigami.Units.smallSpacing / 2
        }

        // Any folder, picked in the folder dialog (not on an SSH host)
        PlasmaComponents3.ItemDelegate {
            visible: !box.remoteHost
            enabled: box.background ? box.terminalHere : (box.inVscode || box.terminalHere)
            Layout.fillWidth: true
            icon.name: "folder-open"
            text: i18n("Choose folder…")
            onClicked: root.startChat(box.group, box.remoteHost, { path: "", short: "" }, box.inVscode, box.plan)
        }
    }
}
