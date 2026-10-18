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
    // and so can a chat with a process of its own, whatever it's doing: in a
    // terminal its claude quits (the chat is kept), in VS Code its tab shows it
    // as interrupted and goes on with the next message (claude_status.py:
    // stopping and interrupting chats). One in tmux that's working can be
    // interrupted instead: Ctrl+C in its pane, like VS Code's stop button.
    readonly property bool canEnd: session.kind === "interactive" && session.pid !== null
    readonly property bool inVscode: session.entrypoint === "claude-vscode"
    readonly property bool canInterrupt: canEnd && !!session.tmux && (session.state === "working" || session.state === "waiting")
    readonly property bool canStop: canEnd || (session.kind === "bg" && session.pid !== null && (!remoteHost || !!session.stopCommand))
    readonly property string stopTitle: row.canInterrupt ? i18n("Interrupt or stop this chat")
                                        : row.canEnd ? i18n("Stop this chat") : i18n("Stop this background session")
    readonly property string stopTip: row.canInterrupt
        ? i18n("Asks first. Interrupting is like Ctrl+C in its tmux pane, or the stop button in VS Code: the current step and its subagents stop, and the chat stays open there.")
        : row.canEnd && row.inVscode
        ? i18n("Asks first. Its tab in VS Code shows it as interrupted, keeps the chat and goes on with your next message.")
        : row.canEnd && row.session.state === "idle"
        ? i18n("Asks first. Claude quits and its terminal stays open; the chat is kept and shows under Recent chats.")
        : row.canEnd
        ? i18n("Asks first. The current step is cut off, Claude quits and its terminal stays open; the chat is kept and shows under Recent chats.")
        : i18n("Asks first. The conversation is kept; claude attach resumes it.")
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
    // A peek at the chat (claude_status.py: chat_peek), its task list and the
    // files it changed
    readonly property var peek: session.peek || null
    readonly property var tasks: session.tasks || null
    readonly property var changes: session.changes || null
    readonly property bool showPeek: root.expandedPeek[rowKey] === true
    readonly property bool hasPeek: (!!peek && (peek.prompt !== "" || peek.reply !== "")) || tasks !== null
    // Its changes open side by side in VS Code (jump.py --changes); an SSH host's files are there
    readonly property bool canCompare: changes !== null && !remoteHost && root.vscodeInstalled && !!session.chatId
    // The line under the folder: what it's doing, what it needs, or what Claude said last
    readonly property bool showsReply: (session.state === "idle" || (session.state === "done" && !session.detail))
                                       && !!peek && peek.replyLine !== ""
    readonly property string stepText: session.state === "working"
                                       ? (peek && peek.activity ? peek.activity : tasks && tasks.current ? tasks.current : "")
                                       : session.state === "waiting" ? (session.detail || (peek ? peek.activity : ""))
                                       : session.state === "done" && session.detail ? session.detail
                                       : showsReply ? peek.replyLine : ""
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
            Tag {
                visible: row.changes !== null
                text: row.changes ? i18nc("number of files a chat changed", "±%1", row.changes.count) : ""
                clickable: row.canCompare
                onClicked: root.showChanges(row.session.chatId, row.session.profileDir, false)
                tooltipTitle: row.changes ? i18np("Changed %1 file", "Changed %1 files", row.changes.count) : ""
                tooltip: !row.changes ? ""
                         : row.changes.files.join("\n")
                           + (row.changes.count > row.changes.files.length ? "\n" + i18n("…and %1 more", row.changes.count - row.changes.files.length) : "")
                           + "\n\n" + (row.remoteHost ? i18n("The files are on %1.", row.remoteHost)
                                      : !root.vscodeInstalled ? i18n("Install VS Code to compare them side by side.")
                                      : i18n("Click to compare them in VS Code: what they were before the chat, and now."))
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
                text: row.canInterrupt ? i18n("Interrupt or stop…") : i18n("Stop…")
                Layout.preferredHeight: nameLabel.implicitHeight
                Layout.preferredWidth: Layout.preferredHeight
                onClicked: {
                    root.stopConfirmBusy = row.session.state !== "idle"
                    root.stopConfirmSession = row.confirmingStop ? "" : row.rowKey
                }

                PlasmaCore.ToolTipArea {
                    anchors.fill: parent
                    mainText: row.stopTitle
                    subText: row.stopTip
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
                // the model, and how hard it thinks (Claude's /effort)
                text: (row.session.model || "") + (row.session.effort ? " · " + row.session.effort : "")
                opacity: 0.7
                font: Kirigami.Theme.smallFont

                PlasmaCore.ToolTipArea {
                    anchors.fill: parent
                    active: !!row.session.effort
                    mainText: row.session.model || ""
                    subText: i18n("Effort: %1 (how hard it thinks; /effort changes it)", row.session.effort || "")
                }
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

        // What it's doing now, what it needs, or what Claude said last, with
        // its task progress; click to read your last prompt and Claude's reply
        Item {
            Layout.fillWidth: true
            visible: row.stepText !== "" || row.tasks !== null
            implicitHeight: stepRow.implicitHeight

            RowLayout {
                id: stepRow
                anchors.fill: parent
                spacing: Kirigami.Units.smallSpacing

                Rectangle {
                    visible: row.tasks !== null
                    Layout.preferredWidth: Kirigami.Units.gridUnit * 2.5
                    Layout.preferredHeight: Math.round(Kirigami.Units.gridUnit * 0.3)
                    radius: height / 2
                    color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.15)

                    Rectangle {
                        width: parent.width * (row.tasks ? row.tasks.done / Math.max(1, row.tasks.total) : 0)
                        height: parent.height
                        radius: parent.radius
                        color: Kirigami.Theme.positiveTextColor
                    }
                }
                PlasmaComponents3.Label {
                    visible: row.tasks !== null
                    text: row.tasks ? i18nc("tasks done/total", "%1/%2", row.tasks.done, row.tasks.total) : ""
                    opacity: 0.7
                    font: Kirigami.Theme.smallFont
                }
                PlasmaComponents3.Label {
                    id: stepLabel
                    Layout.fillWidth: true
                    text: (row.session.state === "working" && row.stepText ? "▸ "
                           : row.showsReply ? i18nc("what Claude said last", "Claude: ") : "") + row.stepText
                    textFormat: Text.PlainText
                    color: row.session.state === "waiting" ? Kirigami.Theme.neutralTextColor : Kirigami.Theme.textColor
                    elide: Text.ElideRight
                    opacity: 0.8
                    font: Kirigami.Theme.smallFont
                }
                Kirigami.Icon {
                    visible: row.hasPeek
                    source: row.showPeek ? "arrow-up" : "arrow-down"
                    Layout.preferredWidth: Kirigami.Units.iconSizes.small
                    Layout.preferredHeight: Layout.preferredWidth
                    opacity: stepMouse.containsMouse ? 0.9 : 0.4
                }
            }

            PlasmaCore.ToolTipArea {
                anchors.fill: parent
                active: stepLabel.truncated || row.hasPeek
                mainText: row.session.state === "waiting" ? i18n("What it needs")
                          : row.session.state === "working" ? i18n("What it's doing")
                          : row.showsReply ? i18n("What Claude said last") : i18n("Result")
                subText: (stepLabel.truncated ? row.stepText + (row.hasPeek ? "\n\n" : "") : "")
                         + (!row.hasPeek ? "" : row.showPeek ? i18n("Click to fold it up again.")
                                                             : i18n("Click to read your last prompt, Claude's reply and the chat's tasks."))

                MouseArea {
                    id: stepMouse
                    anchors.fill: parent
                    enabled: row.hasPeek
                    hoverEnabled: true
                    cursorShape: row.hasPeek ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onClicked: root.togglePeek(row.rowKey)
                }
            }
        }

        // Your last prompt, Claude's reply since, the chat's tasks, and what it changed
        Rectangle {
            Layout.fillWidth: true
            Layout.topMargin: Kirigami.Units.smallSpacing / 2
            visible: row.showPeek && row.hasPeek
            implicitHeight: peekColumn.implicitHeight + Kirigami.Units.smallSpacing * 2
            radius: Kirigami.Units.cornerRadius
            color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.06)

            ColumnLayout {
                id: peekColumn
                anchors.fill: parent
                anchors.margins: Kirigami.Units.smallSpacing
                spacing: Kirigami.Units.smallSpacing

                PlasmaComponents3.Label {
                    Layout.fillWidth: true
                    visible: !!row.peek && row.peek.prompt !== ""
                    text: row.peek ? i18nc("your last prompt", "You: %1", row.peek.prompt) : ""
                    textFormat: Text.PlainText
                    wrapMode: Text.Wrap
                    maximumLineCount: 3
                    elide: Text.ElideRight
                    opacity: 0.7
                    font: Kirigami.Theme.smallFont
                }
                PlasmaComponents3.Label {
                    Layout.fillWidth: true
                    visible: !!row.peek && row.peek.reply !== ""
                    text: row.peek ? i18nc("Claude's last reply", "Claude: %1", row.peek.reply) : ""
                    textFormat: Text.PlainText
                    wrapMode: Text.Wrap
                    maximumLineCount: 14
                    elide: Text.ElideRight
                    font: Kirigami.Theme.smallFont
                }

                // The chat's tasks: ✓ done, ▸ the one it's on, ○ still to do
                ColumnLayout {
                    Layout.fillWidth: true
                    visible: row.tasks !== null
                    spacing: 0

                    Repeater {
                        model: row.tasks ? row.tasks.items.length : 0
                        delegate: PlasmaComponents3.Label {
                            required property int index
                            readonly property var task: (row.tasks && row.tasks.items[index]) || root.emptyTask
                            Layout.fillWidth: true
                            text: (task.status === "completed" ? "✓ " : task.status === "in_progress" ? "▸ " : "○ ") + task.subject
                            textFormat: Text.PlainText
                            elide: Text.ElideRight
                            opacity: task.status === "completed" ? 0.6 : 0.9
                            font.pointSize: Kirigami.Theme.smallFont.pointSize
                            font.bold: task.status === "in_progress"
                        }
                    }
                }

                RowLayout {
                    visible: row.changes !== null && !row.remoteHost
                    spacing: Kirigami.Units.smallSpacing

                    PlasmaComponents3.ToolButton {
                        icon.name: "vcs-diff"
                        text: i18np("Compare %1 changed file", "Compare %1 changed files", row.changes ? row.changes.count : 0)
                        enabled: row.canCompare
                        onClicked: root.showChanges(row.session.chatId, row.session.profileDir, false)

                        PlasmaCore.ToolTipArea {
                            anchors.fill: parent
                            mainText: i18n("Everything this chat changed")
                            subText: root.vscodeInstalled
                                     ? i18n("Opens in VS Code side by side: each file as it was before the chat first changed it, and as it is now.")
                                     : i18n("Needs VS Code.")
                        }
                    }
                    PlasmaComponents3.ToolButton {
                        text: i18n("Last turn")
                        enabled: row.canCompare
                        onClicked: root.showChanges(row.session.chatId, row.session.profileDir, true)

                        PlasmaCore.ToolTipArea {
                            anchors.fill: parent
                            mainText: i18n("What its last turn changed")
                            subText: i18n("The files as they were when you sent your last prompt, and as they are now.")
                        }
                    }
                }
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
                                // its kind, and the model it runs on
                                text: agentRow.modelData.type + (agentRow.modelData.model ? " · " + agentRow.modelData.model : "")
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
            text: row.canInterrupt
                  ? i18n("Interrupt “%1”? Like Ctrl+C in its tmux pane, or the stop button in VS Code: the current step and its subagents stop, and the chat stays open there. Or stop it: Claude quits and its terminal stays open.", row.session.name)
                  : row.canEnd && row.inVscode && row.session.state === "working"
                  ? i18n("Stop “%1”? It's working right now: the current step is interrupted, as with VS Code's stop button, and anything it was running stops. Its tab keeps the chat and goes on with your next message.", row.session.name)
                  : row.canEnd && row.inVscode && row.session.state === "waiting"
                  ? i18n("Stop “%1”? It's waiting for you: what it asks is refused, as with VS Code's stop button. Its tab keeps the chat and goes on with your next message.", row.session.name)
                  : row.canEnd && row.inVscode
                  ? i18n("Stop “%1”? It's idle, so nothing is interrupted: its Claude process in VS Code quits. Its tab keeps the chat and goes on with your next message.", row.session.name)
                  : row.canEnd && row.session.state === "working"
                  ? i18n("Stop “%1”? It's working right now: the current step is cut off and anything it was running stops. Claude quits and its terminal stays open; the chat is kept (Recent chats reopens it).", row.session.name)
                  : row.canEnd && row.session.state === "waiting"
                  ? i18n("Stop “%1”? It's waiting for you: Claude quits without your answer and its terminal stays open. The chat is kept (Recent chats reopens it).", row.session.name)
                  : row.canEnd
                  ? i18n("Stop “%1”? It's idle, so nothing is interrupted: Claude quits and its terminal stays open. The chat is kept; reopen it from Recent chats.", row.session.name)
                  : row.session.state === "working"
                  ? i18n("Stop “%1”? It's working right now: the current step is interrupted and anything it started in the background stops too. The conversation is kept; claude attach resumes it.", row.session.name)
                  : row.session.state === "waiting"
                  ? i18n("Stop “%1”? It's waiting for you. The conversation is kept; claude attach resumes it.", row.session.name)
                  : i18n("Stop “%1”? It's finished, so this only shuts down its idle process. The conversation is kept.", row.session.name)
            actions: [
                Kirigami.Action {
                    text: i18n("Interrupt")
                    icon.name: "media-playback-pause"
                    visible: row.canInterrupt
                    onTriggered: {
                        root.stopConfirmSession = ""
                        if (row.remoteHost)
                            root.remoteInterrupt(row.remoteHost, row.session.sessionId, row.session.profileDir)
                        else
                            root.interruptSession(row.session.sessionId, row.session.profileDir)
                    }
                },
                Kirigami.Action {
                    text: i18n("Stop")
                    icon.name: "media-playback-stop"
                    onTriggered: {
                        root.stopConfirmSession = ""
                        // only stopped if it's as you were told (an idle one that got busy isn't)
                        const busy = root.stopConfirmBusy
                        if (row.remoteHost && row.canEnd)
                            root.remoteEnd(row.remoteHost, row.session.sessionId, row.session.profileDir, busy)
                        else if (row.remoteHost)
                            root.remoteStop(row.remoteHost, row.session.stopCommand)
                        else
                            root.stopSession(row.session.sessionId, row.session.profileDir, busy)
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
