import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami

// What "Find a chat" found (main.qml: runSearch): on this computer, then on
// each SSH host shown, newest first. Click one to bring it up where it runs,
// or to reopen it (in a terminal or VS Code, as the switch of Recent chats says).
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
                                                       + (block.answer.more ? "+" : ""))
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
                visible: !block.answer.busy && block.answer.error === "" && block.answer.results.length === 0
                text: i18n("No chat with all of these words in its name, folder or your prompts.")
                opacity: 0.6
                wrapMode: Text.Wrap
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
