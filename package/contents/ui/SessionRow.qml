import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami

RowLayout {
    id: row

    property var session
    property bool showProfile: false
    property string remoteHost: ""   // set for a session on an SSH host

    readonly property string tag: session.entrypoint === "claude-vscode" ? i18n("VS Code")
                                  : session.kind === "bg" ? i18n("background") : ""
    // A background session with a running process can be stopped (`claude stop`),
    // and so can an idle chat in a terminal: its claude quits, the chat is kept
    // (not VS Code's: the extension would show that as an error)
    readonly property bool canEnd: session.kind === "interactive" && session.entrypoint !== "claude-vscode"
                                   && session.state === "idle" && session.pid !== null
    readonly property bool canStop: canEnd || (session.kind === "bg" && session.pid !== null && (!remoteHost || !!session.stopCommand))
    // Kept in root by row key: rows are refreshed with new data every poll.
    readonly property string rowKey: (remoteHost ? remoteHost + "|" : "") + session.key
    readonly property bool confirmingStop: session.key !== "" && root.stopConfirmSession === rowKey
    // A finished chat on this computer can be shared, continued on another account
    // or kept on one (jump.py); not while a session has it open.
    readonly property bool canShare: root.canShareChats && !remoteHost && session.pid === null && session.state === "done"
                                     && !!session.chatId && root.shareAccounts.length >= 2
    readonly property bool confirmingKeepOnly: session.key !== "" && root.shareConfirm.key === rowKey
    // The color of this chat's pet (the strip at the bottom), if it has one
    readonly property string petColor: root.petColors[root.petKeyOf(session, remoteHost)] || ""
    readonly property bool showAgents: root.expandedAgents[rowKey] === true
    readonly property var agents: session.agents || null
    readonly property string openHint: remoteHost
                                       ? (session.entrypoint === "claude-vscode" && !session.openCommand
                                          ? i18n("Show this conversation in VS Code (connected to %1)", remoteHost)
                                          : !session.openCommand ? i18n("Switch to the terminal with the ssh session to %1", remoteHost)
                                          : session.kind === "chat" ? i18n("Reopen this chat on %1 in a terminal (ssh)", remoteHost)
                                          : i18n("Open this background session on %1 in a terminal (ssh)", remoteHost))
                                       : session.entrypoint === "claude-vscode" ? i18n("Open this conversation in VS Code")
                                       : session.kind === "chat" ? i18n("Reopen this chat in a terminal (claude --resume)")
                                       : session.kind === "bg" && session.pid === null ? i18n("Reopen this background session in a terminal")
                                       : session.kind === "bg" ? i18n("Show this background session in a terminal")
                                       : i18n("Switch to the terminal running this session")

    function open() {
        if (remoteHost)
            root.remoteShow(remoteHost, session)
        else
            root.jumpTo(session.sessionId, session.profileDir)
    }

    spacing: Kirigami.Units.smallSpacing
    Layout.leftMargin: Kirigami.Units.smallSpacing

    HoverHandler {
        id: rowHover
    }
    Layout.rightMargin: Kirigami.Units.smallSpacing

    // A bar in the color of the chat's pet, to spot which pet is which
    Rectangle {
        Layout.fillHeight: true
        Layout.preferredWidth: 3
        radius: 1.5
        color: row.petColor || "transparent"
    }

    Rectangle {
        Layout.alignment: Qt.AlignTop
        Layout.topMargin: Math.round((nameLabel.implicitHeight - height) / 2)
        Layout.preferredWidth: Math.round(Kirigami.Units.gridUnit * 0.6)
        Layout.preferredHeight: Layout.preferredWidth
        radius: width / 2
        color: row.session.reason === "failed" ? Kirigami.Theme.negativeTextColor : root.stateColor(row.session.state)
    }

    ColumnLayout {
        Layout.fillWidth: true
        spacing: 0

        RowLayout {
            Layout.fillWidth: true
            spacing: Kirigami.Units.smallSpacing

            PlasmaComponents3.Label {
                id: nameLabel
                text: row.session.name
                font.bold: true
                font.underline: nameMouse.containsMouse
                elide: Text.ElideRight
                Layout.fillWidth: true

                // Click the name to jump to the session
                PlasmaCore.ToolTipArea {
                    width: nameLabel.contentWidth
                    height: parent.height
                    mainText: row.openHint

                    MouseArea {
                        id: nameMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: row.open()
                    }
                }
            }
            Tag {
                visible: row.showProfile
                text: row.session.profile
                tooltip: i18n("The Claude profile (config folder) this session runs in")
            }
            Tag {
                visible: row.tag !== ""
                text: row.tag
                tooltip: row.session.entrypoint === "claude-vscode"
                         ? i18n("Runs in VS Code's Claude panel. Click the name to open the conversation there.")
                         : i18n("A background session: Claude's background service runs it, with no terminal of its own. Click the name to open it in a terminal (claude attach).")
            }
            Tag {
                // Chat shared across profiles (hard-linked transcript)
                readonly property var info: row.session.shared
                visible: !!info
                text: info && info.forkOf ? i18n("⇄ shared copy") : i18n("⇄ shared")
                tooltipTitle: info && info.forkOf ? i18n("Copy of a shared chat") : i18n("Shared chat")
                tooltip: !info ? ""
                         : info.forkOf
                           ? i18n("A copy of a chat shared between the %1 profiles: Claude forked it into a chat of its own on %2, so new messages here are only on %2.",
                                  info.profiles.join(" + "), info.forkOn)
                             + (info.movedHere ? "\n" + i18n("The shared chat continued here, so it isn't listed itself.") : "")
                             + (info.stoppedCopies ? "\n" + i18n("Its background session on %1 was stopped; %1 shows a link to this copy.", info.stoppedCopies.join(", ")) : "")
                           : i18n("This chat is shared between the %1 profiles: it continues on whichever account you open it with. Only one session can have it open at a time.",
                                  info.profiles.join(" + "))
                             + (row.session.kind === "chat" ? "\n" + i18n("Listed here because it was used on %1 last.", row.session.profile) : "")
                             + (info.openIn ? "\n" + i18n("Open in %1 right now.", info.openIn) : "")
                             + (info.stoppedCopies ? "\n" + i18n("Its background session on %1 was stopped; %1 shows a link to this chat.", info.stoppedCopies.join(", ")) : "")
            }
            Tag {
                visible: row.agents !== null
                text: row.agents ? i18nc("subagents finished/total", "agents %1/%2", row.agents.done, row.agents.total) : ""
                active: row.agents !== null && row.agents.running > 0
                clickable: true
                onClicked: root.toggleAgents(row.rowKey)
                tooltipTitle: i18n("Subagents")
                tooltip: !row.agents ? ""
                         : i18n("%1 done, %2 running, %3 stopped. Click to %4 what each one is doing.",
                                row.agents.done, row.agents.running, row.agents.stopped,
                                row.showAgents ? i18n("hide") : i18n("show"))
            }
            PlasmaComponents3.Label {
                text: root.stateText(row.session)
                color: row.session.state === "waiting" ? Kirigami.Theme.neutralTextColor : Kirigami.Theme.textColor
                font.bold: row.session.state === "waiting"
                elide: Text.ElideRight
                Layout.maximumWidth: Kirigami.Units.gridUnit * 11
            }
            PlasmaComponents3.ToolButton {
                id: shareButton
                visible: row.canShare
                opacity: rowHover.hovered ? 1 : 0
                icon.name: "document-share"
                display: PlasmaComponents3.AbstractButton.IconOnly
                text: i18n("Share or continue on another account…")
                Layout.preferredHeight: nameLabel.implicitHeight
                Layout.preferredWidth: Layout.preferredHeight
                onClicked: root.openShareMenu(shareButton, {
                    chatId: row.session.chatId, name: row.session.name, profileDir: row.session.profileDir,
                    shared: !!row.session.shared && !row.session.shared.forkOf
                }, row.rowKey)

                PlasmaCore.ToolTipArea {
                    anchors.fill: parent
                    mainText: i18n("Continue on another account")
                    subText: i18n("Share this chat with your other accounts and pick it up there, or keep it on one account only.")
                }
            }
            PlasmaComponents3.ToolButton {
                // Remove a finished session from the list (nothing is deleted)
                visible: row.session.state === "done"
                opacity: rowHover.hovered ? 1 : 0
                icon.name: "list-remove"
                display: PlasmaComponents3.AbstractButton.IconOnly
                text: i18n("Remove from list")
                Layout.preferredHeight: nameLabel.implicitHeight
                Layout.preferredWidth: Layout.preferredHeight
                onClicked: row.remoteHost ? root.remoteDismiss(row.remoteHost, row.session.sessionId)
                                          : root.dismissSession(row.session.sessionId)

                PlasmaCore.ToolTipArea {
                    anchors.fill: parent
                    mainText: i18n("Remove from the list")
                    subText: i18n("Only hides it here; nothing is deleted. It comes back if the session runs again, or via right-click → Show removed sessions again.")
                }
            }
            PlasmaComponents3.ToolButton {
                visible: row.canStop
                opacity: rowHover.hovered || row.confirmingStop ? 1 : 0
                icon.name: "media-playback-stop"
                display: PlasmaComponents3.AbstractButton.IconOnly
                text: i18n("Stop…")
                Layout.preferredHeight: nameLabel.implicitHeight
                Layout.preferredWidth: Layout.preferredHeight
                onClicked: root.stopConfirmSession = row.confirmingStop ? "" : row.rowKey

                PlasmaCore.ToolTipArea {
                    anchors.fill: parent
                    mainText: row.canEnd ? i18n("Stop this chat") : i18n("Stop this background session")
                    subText: row.canEnd ? i18n("Asks first. Claude quits and its terminal stays open; the chat is kept and shows under Recent chats.")
                                        : i18n("Asks first. The conversation is kept; claude attach resumes it.")
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: Kirigami.Units.smallSpacing

            PlasmaComponents3.Label {
                text: row.session.cwdShort
                opacity: 0.7
                font: Kirigami.Theme.smallFont
                elide: Text.ElideMiddle
                Layout.fillWidth: true
            }
            PlasmaComponents3.Label {
                visible: !!row.session.model
                text: row.session.model || ""
                opacity: 0.7
                font: Kirigami.Theme.smallFont
            }
            // Context window fill
            Rectangle {
                visible: row.session.context !== null
                Layout.preferredWidth: Kirigami.Units.gridUnit * 2.5
                Layout.preferredHeight: Math.round(Kirigami.Units.gridUnit * 0.3)
                radius: height / 2
                color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.15)

                Rectangle {
                    width: parent.width * Math.min(100, Math.max(0, row.session.context || 0)) / 100
                    height: parent.height
                    radius: parent.radius
                    color: root.usageColor(row.session.context || 0)
                }
            }
            PlasmaComponents3.Label {
                visible: row.session.context !== null
                text: i18nc("context window fill", "ctx %1%", Math.round(row.session.context || 0))
                opacity: 0.7
                font: Kirigami.Theme.smallFont
            }
        }

        PlasmaComponents3.Label {
            visible: !!row.session.detail && (row.session.state === "waiting" || row.session.state === "done")
            text: row.session.detail
            Layout.fillWidth: true
            elide: Text.ElideRight
            opacity: 0.8
            font: Kirigami.Theme.smallFont

            PlasmaCore.ToolTipArea {
                anchors.fill: parent
                active: parent.truncated
                mainText: row.session.state === "waiting" ? i18n("What it needs") : i18n("Result")
                subText: row.session.detail
            }
        }

        // Subagents as a tree: what each one is doing
        ColumnLayout {
            Layout.fillWidth: true
            Layout.topMargin: Kirigami.Units.smallSpacing / 2
            visible: row.showAgents && row.agents !== null
            spacing: Kirigami.Units.smallSpacing / 2

            Repeater {
                model: row.agents ? row.agents.tree.length : 0
                delegate: RowLayout {
                    id: agentRow
                    required property int index
                    readonly property var modelData: (row.agents && row.agents.tree[index]) || root.emptyAgent
                    Layout.fillWidth: true
                    Layout.leftMargin: Kirigami.Units.gridUnit * 0.9 * modelData.depth
                    spacing: Kirigami.Units.smallSpacing

                    PlasmaComponents3.Label {
                        Layout.alignment: Qt.AlignTop
                        text: "└"
                        opacity: 0.4
                    }
                    Rectangle {
                        Layout.alignment: Qt.AlignTop
                        Layout.topMargin: Math.round(Kirigami.Units.gridUnit * 0.3)
                        Layout.preferredWidth: Math.round(Kirigami.Units.gridUnit * 0.45)
                        Layout.preferredHeight: Layout.preferredWidth
                        radius: width / 2
                        color: agentRow.modelData.status === "running" ? Kirigami.Theme.focusColor
                             : agentRow.modelData.status === "done" ? Kirigami.Theme.positiveTextColor
                             : Kirigami.Theme.disabledTextColor
                    }
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 0
                        RowLayout {
                            Layout.fillWidth: true
                            PlasmaComponents3.Label {
                                Layout.fillWidth: true
                                text: agentRow.modelData.description || agentRow.modelData.type
                                elide: Text.ElideRight
                                font: Kirigami.Theme.smallFont
                            }
                            PlasmaComponents3.Label {
                                text: agentRow.modelData.type
                                opacity: 0.6
                                font: Kirigami.Theme.smallFont
                            }
                            PlasmaComponents3.Label {
                                text: agentRow.modelData.status === "running"
                                      ? i18n("running · %1", root.duration(root.now - (agentRow.modelData.started || root.now)))
                                      : agentRow.modelData.status === "done" ? i18n("done") : i18n("stopped")
                                opacity: 0.7
                                font: Kirigami.Theme.smallFont
                            }
                        }
                        PlasmaComponents3.Label {
                            id: activityLabel
                            Layout.fillWidth: true
                            visible: text !== ""
                            text: agentRow.modelData.activity
                            opacity: 0.6
                            elide: Text.ElideRight
                            font: Kirigami.Theme.smallFont

                            PlasmaCore.ToolTipArea {
                                anchors.fill: parent
                                active: activityLabel.truncated
                                mainText: agentRow.modelData.description || agentRow.modelData.type
                                subText: agentRow.modelData.activity
                            }
                        }
                    }
                }
            }
        }

        KeepOnlyMessage {
            Layout.fillWidth: true
            visible: row.confirmingKeepOnly
        }

        Kirigami.InlineMessage {
            Layout.fillWidth: true
            visible: row.confirmingStop && row.canStop
            type: Kirigami.MessageType.Warning
            text: row.canEnd
                  ? i18n("Stop “%1”? It's idle, so nothing is interrupted: Claude quits and its terminal stays open. The chat is kept; reopen it from Recent chats.", row.session.name)
                  : row.session.state === "working"
                  ? i18n("Stop “%1”? It's working right now: the current step is interrupted and anything it started in the background stops too. The conversation is kept; claude attach resumes it.", row.session.name)
                  : row.session.state === "waiting"
                  ? i18n("Stop “%1”? It's waiting for you. The conversation is kept; claude attach resumes it.", row.session.name)
                  : i18n("Stop “%1”? It's finished, so this only shuts down its idle process. The conversation is kept.", row.session.name)
            actions: [
                Kirigami.Action {
                    text: i18n("Stop")
                    icon.name: "media-playback-stop"
                    onTriggered: {
                        root.stopConfirmSession = ""
                        if (row.remoteHost && row.canEnd)
                            root.remoteEnd(row.remoteHost, row.session.sessionId, row.session.profileDir)
                        else if (row.remoteHost)
                            root.remoteStop(row.remoteHost, row.session.stopCommand)
                        else
                            root.stopSession(row.session.sessionId, row.session.profileDir)
                    }
                },
                Kirigami.Action {
                    text: i18n("Cancel")
                    onTriggered: root.stopConfirmSession = ""
                }
            ]
        }
    }
}
