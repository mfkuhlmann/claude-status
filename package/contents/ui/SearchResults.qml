import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami

// What "Find a chat" found (main.qml: runSearch): on this computer, then on
// each SSH host shown, newest first. Click one to bring it up where it runs,
// or to reopen it (in a terminal or VS Code, as the switch of Recent chats says).
// After the chats: the project folders, plans and memories with those words
// (a folder opens the new-chat box, a plan or a memory opens to read).
ColumnLayout {
    id: found

    readonly property var sources: [""].concat(root.shownHosts)

    spacing: Kirigami.Units.smallSpacing

    Repeater {
        model: found.sources.length
        delegate: ColumnLayout {
            id: block

            required property int index
            readonly property string host: found.sources[index] || ""
            readonly property var answer: root.searchResults[host] || ({ busy: false, results: [], more: false, error: "" })
            readonly property var projects: answer.projects || []
            readonly property var plans: answer.plans || []
            readonly property var memories: answer.memories || []
            readonly property bool nothing: answer.results.length + projects.length + plans.length + memories.length === 0

            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.smallSpacing
            Layout.rightMargin: Kirigami.Units.smallSpacing
            spacing: Kirigami.Units.smallSpacing / 2

            RowLayout {
                Layout.fillWidth: true
                spacing: Kirigami.Units.smallSpacing

                Kirigami.Icon {
                    source: block.host ? "network-server" : "computer"
                    Layout.preferredWidth: Kirigami.Units.iconSizes.small
                    Layout.preferredHeight: Layout.preferredWidth
                }
                PlasmaComponents3.Label {
                    textFormat: Text.PlainText
                    Layout.fillWidth: true
                    text: (block.host || i18n("This computer"))
                          + (block.answer.busy ? "" : " · " + i18np("%1 chat", "%1 chats", block.answer.results.length)
                                                       + (block.answer.more ? "+" : "")
                                                       + (block.projects.length ? ", " + i18np("%1 folder", "%1 folders", block.projects.length) : "")
                                                       + (block.plans.length ? ", " + i18np("%1 plan", "%1 plans", block.plans.length) : "")
                                                       + (block.memories.length ? ", " + i18np("%1 memory", "%1 memories", block.memories.length) : ""))
                    font.bold: true
                    opacity: 0.8
                    elide: Text.ElideRight
                }
                PlasmaComponents3.BusyIndicator {
                    visible: block.answer.busy
                    running: visible
                    Layout.preferredWidth: Kirigami.Units.iconSizes.small
                    Layout.preferredHeight: Kirigami.Units.iconSizes.small
                }
            }

            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                visible: block.answer.error !== ""
                text: block.answer.error
                color: Kirigami.Theme.negativeTextColor
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
            }

            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                visible: !block.answer.busy && block.answer.error === "" && block.nothing
                text: i18n("Nothing with all of these words: no chat (its name, folder or your prompts), project folder, plan or memory.")
                opacity: 0.6
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
            }

            // project folders: click for a new chat there
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.leftMargin: Kirigami.Units.gridUnit
                visible: block.projects.length > 0
                text: i18n("Folders")
                opacity: 0.6
                font: Kirigami.Theme.smallFont
            }
            Repeater {
                model: block.projects.length
                delegate: FoundLine {
                    required property int index
                    readonly property var project: block.projects[index] || ({ folder: "", folderShort: "", chats: 0, lastActive: 0, account: "", groupId: "" })
                    icon: "folder"
                    text: project.folderShort || project.folder
                    detail: i18np("%1 chat", "%1 chats", project.chats) + " · " + i18nc("how long ago", "%1 ago", root.duration(root.now - project.lastActive))
                    account: root.hostGroups(block.host).length > 1 ? project.profile : ""
                    tipTitle: project.folder
                    tip: i18n("Click to start a new chat in this folder on %1: its new-chat box opens with this folder first.", project.account)
                    onActivated: root.openFoundProject(project, block.host)
                }
            }

            // plans: click to read one
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.leftMargin: Kirigami.Units.gridUnit
                visible: block.plans.length > 0
                text: i18n("Plans")
                opacity: 0.6
                font: Kirigami.Theme.smallFont
            }
            Repeater {
                model: block.plans.length
                delegate: FoundLine {
                    required property int index
                    readonly property var plan: block.plans[index] || ({ slug: "", title: "", profileDir: "", updatedAt: 0, account: "" })
                    icon: "view-task"
                    text: plan.title
                    detail: i18nc("how long ago", "%1 ago", root.duration(root.now - plan.updatedAt))
                    account: root.hostGroups(block.host).length > 1 ? plan.profile : ""
                    tipTitle: plan.title
                    tip: i18n("A plan on %1. Click to read it.", plan.account)
                    onActivated: root.openPlan(plan.slug, plan.profileDir, block.host)
                }
            }

            // memories: click to read one
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.leftMargin: Kirigami.Units.gridUnit
                visible: block.memories.length > 0
                text: i18n("Memories")
                opacity: 0.6
                font: Kirigami.Theme.smallFont
            }
            Repeater {
                model: block.memories.length
                delegate: FoundLine {
                    required property int index
                    readonly property var memory: block.memories[index] || ({ name: "", description: "", type: "", path: "", folderShort: "", updatedAt: 0, account: "" })
                    icon: root.memoryIcon(memory.type)
                    text: memory.description || memory.name
                    detail: memory.folderShort || i18n("every folder")
                    account: root.hostGroups(block.host).length > 1 ? memory.profile : ""
                    tipTitle: memory.name
                    tip: i18n("A memory on %1. Click to read it.", memory.account)
                    enabled: !block.host || root.vscodeInstalled
                    onActivated: root.openMemory(memory, block.host, false)
                }
            }

            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.leftMargin: Kirigami.Units.gridUnit
                visible: block.answer.results.length > 0 && block.projects.length + block.plans.length + block.memories.length > 0
                text: i18n("Chats")
                opacity: 0.6
                font: Kirigami.Theme.smallFont
            }

            Repeater {
                model: block.answer.results.length
                delegate: ColumnLayout {
                    id: hit

                    required property int index
                    readonly property var chat: block.answer.results[index] || root.emptyFound
                    // listed above right now (it runs, or just finished): its row's state
                    readonly property var row: root.listedRow(chat.sessionId, chat.profileDir, block.host)

                    Layout.fillWidth: true
                    Layout.leftMargin: Kirigami.Units.gridUnit
                    spacing: 0

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Kirigami.Units.smallSpacing

                        Rectangle {
                            visible: hit.row !== null
                            Layout.preferredWidth: Math.round(Kirigami.Units.gridUnit * 0.5)
                            Layout.preferredHeight: Layout.preferredWidth
                            radius: width / 2
                            color: hit.row ? root.stateColor(hit.row.state) : "transparent"
                        }
                        PlasmaComponents3.Label {
                            id: hitName
                            textFormat: Text.PlainText
                            text: hit.chat.name
                            font.underline: hitMouse.containsMouse
                            elide: Text.ElideRight
                            Layout.fillWidth: true

                            PlasmaCore.ToolTipArea {
                                textFormat: Text.PlainText
                                width: hitName.contentWidth
                                height: parent.height
                                mainText: hit.chat.name
                                subText: (hit.row ? i18n("Listed above: %1. Click to go to it.", root.stateText(hit.row))
                                                  : i18n("Click to reopen it on %1.", hit.chat.account))
                                         + (hit.chat.shared ? "\n" + i18n("Shared between accounts; last used on %1.", hit.chat.profile) : "")
                                         + (hit.chat.match ? "\n\n" + hit.chat.match : "")

                                MouseArea {
                                    id: hitMouse
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: root.openFound(hit.chat, block.host)
                                }
                            }
                        }
                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            visible: hit.chat.shared
                            text: "⇄"
                            opacity: 0.6
                        }
                        Tag {
                            // its account, where there's more than one
                            visible: root.hostGroups(block.host).length > 1
                            text: hit.chat.profile
                            tooltipTitle: hit.chat.account
                            tooltip: i18n("The account it's on")
                        }
                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            text: i18nc("found chat: folder · how long ago", "%1 · %2 ago", hit.chat.cwdShort || "~",
                                        root.duration(root.now - hit.chat.lastActive))
                            opacity: 0.6
                            font: Kirigami.Theme.smallFont
                            elide: Text.ElideLeft
                            Layout.maximumWidth: Kirigami.Units.gridUnit * 11
                        }
                    }
                    PlasmaComponents3.Label {
                        textFormat: Text.PlainText
                        Layout.fillWidth: true
                        visible: hit.chat.match !== ""
                        text: hit.chat.match
                        opacity: 0.7
                        elide: Text.ElideRight
                        font: Kirigami.Theme.smallFont
                    }
                }
            }

            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                Layout.leftMargin: Kirigami.Units.gridUnit
                visible: block.answer.more
                text: i18n("More chats have these words: add a word to narrow it down.")
                opacity: 0.6
                font: Kirigami.Theme.smallFont
            }

        }
    }

    Kirigami.Separator {
        Layout.fillWidth: true
    }
}
