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
    property string account: ""      // its account's title

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
    // (not when only a background command runs: its turn is over, Ctrl+C would land at its prompt)
    readonly property bool canInterrupt: canEnd && !!session.tmux && (session.state === "working" || session.state === "waiting")
                                         && session.reason !== "background shell"
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
    // A finished chat can be shared, continued on another account or kept on
    // one (jump.py; on an SSH host, between its accounts: remote.py); not
    // while a session has it open.
    readonly property bool canShare: session.pid === null && session.state === "done" && !!session.chatId
                                     && root.shareAccountsOf(remoteHost).length >= 2
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
    readonly property var recap: session.stats || null
    // Claude's own recap of the chat (claude_status.py: recap_of), while nothing was said after it
    readonly property var summary: peek && peek.recap ? peek.recap : null
    // What stopped it: a usage limit (and when that resets) or an expired login
    readonly property var stopped: session.stopped || null
    readonly property bool hasPeek: (!!peek && (peek.prompt !== "" || peek.reply !== "")) || tasks !== null || recap !== null
                                    || summary !== null
    // Its changes open side by side in VS Code (jump.py --changes); an SSH host's files are there
    readonly property bool canCompare: changes !== null && !remoteHost && root.vscodeInstalled && !!session.chatId
    // The line under the folder: what it's doing, what it needs, what stopped
    // it, Claude's recap, or what Claude said last
    readonly property bool resting: session.state === "idle" || (session.state === "done" && !session.detail)
    readonly property bool showsRecap: resting && !stopped && summary !== null
    readonly property bool showsReply: resting && !stopped && !showsRecap && !!peek && peek.replyLine !== ""
    readonly property string stepText: session.state === "working"
                                       ? (peek && peek.activity ? peek.activity : tasks && tasks.current ? tasks.current : "")
                                       : session.state === "waiting" ? (session.detail || (peek ? peek.activity : ""))
                                       : stopped ? root.stopText(stopped)
                                       : session.state === "done" && session.detail ? session.detail
                                       : showsRecap ? summary.text.split("\n")[0]
                                       : showsReply ? peek.replyLine : ""
    // Its permission mode, unless it's the default
    readonly property string modeText: root.modeText(peek ? peek.mode : null)
    // A usage limit stopped it: it can go on on another account with room left
    readonly property var handover: root.handoverTarget(session, remoteHost)
    // or by itself once the limit resets (queued), when the widget knows when
    readonly property real goOnAt: root.goOnAt(session)
    readonly property var goingOn: goOnAt || stopped ? root.queuedChat(session.chatId, remoteHost) : null
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

    // The first other chat that changes the same files
    function openOverlap() {
        const o = (session.overlaps || [])[0]
        const other = o ? root.listedRow(o.sessionId, o.profileDir, remoteHost) : null
        if (other && remoteHost)
            root.remoteShow(remoteHost, other)
        else if (other)
            root.jumpTo(other.sessionId, other.profileDir)
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
        color: row.session.reason === "failed" || (row.stopped && !row.stopped.over) ? Kirigami.Theme.negativeTextColor
             : root.stateColor(row.session.state)
    }

    ColumnLayout {
        Layout.fillWidth: true
        spacing: 0

        RowLayout {
            Layout.fillWidth: true
            spacing: Kirigami.Units.smallSpacing

            PlasmaComponents3.Label {
                id: nameLabel
                textFormat: Text.PlainText
                text: row.session.name
                font.bold: true
                font.underline: nameMouse.containsMouse
                elide: Text.ElideRight
                Layout.fillWidth: true

                // Click the name to jump to the session
                PlasmaCore.ToolTipArea {
                    textFormat: Text.PlainText
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
                                row.agents.done, row.agents.running, row.agents.stopped + (row.agents.failed || 0),
                                row.showAgents ? i18n("hide") : i18n("show"))
            }
            Tag {
                // plan mode, auto mode, …: how freely it may act
                visible: row.modeText !== ""
                text: row.modeText
                warning: !!row.peek && row.peek.mode === "bypassPermissions"
                tooltipTitle: i18n("Permission mode: %1", row.modeText)
                tooltip: root.modeHint(row.peek ? row.peek.mode : "")
            }
            Tag {
                // the plan it made (claude_status.py: plan_of)
                visible: !!row.session.plan
                text: i18nc("a chat's plan, click to open it", "plan ↗")
                clickable: true
                onClicked: root.openPlan(row.session.plan.slug, row.session.profileDir, row.remoteHost)
                tooltipTitle: row.session.plan ? row.session.plan.title : ""
                tooltip: row.remoteHost ? i18n("The plan this chat made. Click to read it: a copy, fetched from %1.", row.remoteHost)
                                        : i18n("The plan this chat made. Click to read it, rendered.")
            }
            Tag {
                // its file itself, to change it (an SSH host's: in VS Code, over Remote-SSH)
                visible: !!row.session.plan && (!row.remoteHost || root.vscodeInstalled)
                text: "✎"
                clickable: true
                onClicked: root.editPlan({ slug: row.session.plan.slug, path: row.session.plan.path,
                                           profileDir: row.session.profileDir }, row.remoteHost)
                tooltipTitle: i18n("Edit the plan")
                tooltip: (row.remoteHost
                          ? i18n("Opens its Markdown file on %1 in VS Code (Remote - SSH). What you change there is the plan.", row.remoteHost)
                          : i18n("Opens its Markdown file in your text editor (VS Code, if the settings open plans there). What you change there is the plan."))
                         + (row.remoteHost ? "" : " " + i18n("Then send your changes to this chat (↩ send to Claude): Claude revises the plan."))
            }
            Tag {
                // you changed its plan since the chat last did anything (claude_status.py: plan_edited)
                visible: !!row.session.plan && !!row.session.plan.edited && !row.remoteHost && !!row.session.chatId
                text: i18nc("send your changes to the plan to the chat", "↩ send to Claude")
                active: true
                clickable: true
                onClicked: root.sendPlanFeedback(row.session.plan.slug, row.session.profileDir, row.session.chatId)
                tooltipTitle: i18n("Send your changes to Claude")
                tooltip: i18n("You changed this plan since Claude wrote it. Click to send what you changed (and notes you wrote into it) to this chat: Claude revises the plan, in plan mode.")
                         + "\n\n" + i18n("In tmux it's typed in for you. Else it goes to the clipboard and the chat comes up: paste it there (if Claude asks whether to go ahead with the plan, choose to keep planning first). A chat that isn't open reopens in plan mode with it.")
            }
            Tag {
                // another chat with a process changed some of the same files (claude_status.py: note_overlaps)
                visible: !!row.session.overlaps && row.session.overlaps.length > 0
                text: i18nc("two chats changed the same files", "⚠ same files")
                warning: true
                clickable: true
                onClicked: row.openOverlap()
                tooltipTitle: i18n("Another chat changes the same files")
                tooltip: row.session.overlaps ? root.overlapText(row.session.overlaps) + "\n\n"
                         + i18n("Two chats changing the same files can overwrite each other's work. Click to go to the other chat.") : ""
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
                textFormat: Text.PlainText
                text: root.stateText(row.session)
                color: row.session.state === "waiting" ? Kirigami.Theme.neutralTextColor
                     : row.stopped && !row.stopped.over ? Kirigami.Theme.negativeTextColor
                     : row.stopped ? Kirigami.Theme.positiveTextColor : Kirigami.Theme.textColor
                font.bold: row.session.state === "waiting" || !!row.stopped
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
                    shared: !!row.session.shared && !row.session.shared.forkOf, host: row.remoteHost
                }, row.rowKey)

                PlasmaCore.ToolTipArea {
                    textFormat: Text.PlainText
                    anchors.fill: parent
                    mainText: i18n("Continue on another account")
                    subText: root.shareHint(row.remoteHost)
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
                    textFormat: Text.PlainText
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
                    textFormat: Text.PlainText
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
                id: folderLabel
                textFormat: Text.PlainText
                text: row.session.cwdShort
                opacity: 0.7
                font: Kirigami.Theme.smallFont
                elide: Text.ElideMiddle
                Layout.fillWidth: true

                PlasmaCore.ToolTipArea {   // (the whole folder: the line may be cut short)
                    textFormat: Text.PlainText
                    width: folderLabel.contentWidth
                    height: parent.height
                    active: !!row.session.cwd
                    mainText: i18n("Folder")
                    subText: (row.remoteHost ? row.remoteHost + ":" : "") + row.session.cwd
                }
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                visible: !!row.session.model
                // the model, and how hard it thinks (Claude's /effort)
                text: (row.session.model || "") + (row.session.effort ? " · " + row.session.effort : "")
                opacity: 0.7
                font: Kirigami.Theme.smallFont

                PlasmaCore.ToolTipArea {
                    textFormat: Text.PlainText
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
                textFormat: Text.PlainText
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

            // Under the line, so its buttons get their own clicks and tooltips
            PlasmaCore.ToolTipArea {
                textFormat: Text.PlainText
                anchors.fill: parent
                active: stepLabel.truncated || row.hasPeek
                mainText: row.session.state === "waiting" ? i18n("What it needs")
                          : row.session.state === "working" ? i18n("What it's doing")
                          : row.stopped ? (row.stopped.kind === "login" ? i18n("Its login expired") : i18n("A usage limit stopped it"))
                          : row.showsRecap ? i18n("Claude's recap")
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
                    textFormat: Text.PlainText
                    visible: row.tasks !== null
                    text: row.tasks ? i18nc("tasks done/total", "%1/%2", row.tasks.done, row.tasks.total) : ""
                    opacity: 0.7
                    font: Kirigami.Theme.smallFont
                }
                PlasmaComponents3.Label {
                    id: stepLabel
                    Layout.fillWidth: true
                    text: (row.session.state === "working" && row.stepText ? "▸ "
                           : row.showsRecap ? i18nc("Claude's recap of the chat", "Recap: ")
                           : row.showsReply ? i18nc("what Claude said last", "Claude: ") : "") + row.stepText
                    textFormat: Text.PlainText
                    color: row.session.state === "waiting" ? Kirigami.Theme.neutralTextColor
                         : row.stopped && !row.stopped.over && row.session.state !== "working" ? Kirigami.Theme.negativeTextColor
                         : Kirigami.Theme.textColor
                    elide: Text.ElideRight
                    opacity: 0.8
                    font: Kirigami.Theme.smallFont
                }
                // A usage limit stopped it: continue on another account with room left
                PlasmaComponents3.ToolButton {
                    id: handoverButton
                    visible: row.handover !== null
                    icon.name: "system-switch-user"
                    text: row.handover ? i18n("Continue on %1", row.handover.title) : ""
                    font: Kirigami.Theme.smallFont
                    Layout.preferredHeight: stepLabel.implicitHeight + Kirigami.Units.smallSpacing
                    onClicked: root.handOver(row.session, row.remoteHost, row.handover)

                    PlasmaCore.ToolTipArea {
                        textFormat: Text.PlainText
                        anchors.fill: parent
                        mainText: row.handover ? i18n("Continue on %1", row.handover.title) : ""
                        subText: !row.handover ? ""
                                 : (row.handover.pct !== null
                                    ? i18n("%1 has used %2% of its %3 limit.", row.handover.title, Math.round(row.handover.pct), row.handover.label)
                                    : i18n("%1's plan usage isn't known here.", row.handover.title))
                                   + " " + (row.session.pid !== null
                                            ? (row.session.kind === "bg"
                                               ? i18n("This background session is stopped first (claude stop); then the chat is shared with %1 and reopens there in a terminal.", row.handover.title)
                                               : i18n("Claude here quits first (its terminal stays open); then the chat is shared with %1 and reopens there in a terminal.", row.handover.title))
                                            : i18n("The chat is shared with %1 and reopens there in a terminal.", row.handover.title))
                    }
                }
                // or go on by itself once the limit resets (queued; again: cancelled)
                PlasmaComponents3.ToolButton {
                    visible: row.goOnAt > 0 || row.goingOn !== null
                    icon.name: row.goingOn ? "checkmark" : "chronometer"
                    text: row.goingOn ? i18n("Goes on at %1", root.clockText(row.goingOn.startAt))
                                      : i18n("Go on at %1", root.clockText(row.goOnAt))
                    font: Kirigami.Theme.smallFont
                    Layout.preferredHeight: stepLabel.implicitHeight + Kirigami.Units.smallSpacing
                    onClicked: {
                        if (row.goingOn)
                            root.unqueue(row.goingOn)
                        else
                            root.queueContinue(row.session, row.remoteHost, row.account)
                    }

                    PlasmaCore.ToolTipArea {
                        textFormat: Text.PlainText
                        anchors.fill: parent
                        mainText: row.goingOn ? i18n("Goes on by itself at %1", root.clockText(row.goingOn.startAt))
                                              : i18n("Go on by itself after the limit resets")
                        subText: (row.goingOn ? "" : i18n("At %1, a minute after the limit resets, the chat goes on in the background, telling Claude that the limit has reset.", root.clockText(row.goOnAt)) + " ")
                                 + (row.session.pid === null || row.session.pid === undefined ? ""
                                    : row.session.kind === "bg" ? i18n("This background session is stopped first (claude stop).")
                                    : i18n("Claude here quits first (its terminal stays open); open the chat from here to see it.")) + " "
                                 + i18n("If it went on before then, nothing happens.")
                                 + (row.goingOn ? "\n\n" + i18n("Click to cancel it.") : "")
                    }
                }
                Kirigami.Icon {
                    visible: row.hasPeek
                    source: row.showPeek ? "arrow-up" : "arrow-down"
                    Layout.preferredWidth: Kirigami.Units.iconSizes.small
                    Layout.preferredHeight: Layout.preferredWidth
                    opacity: stepMouse.containsMouse ? 0.9 : 0.4
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

                // Claude's recap of the chat, written when you came back to it
                PlasmaComponents3.Label {
                    Layout.fillWidth: true
                    visible: row.summary !== null
                    text: row.summary ? i18nc("Claude's recap of the chat", "Recap: %1", row.summary.text) : ""
                    textFormat: Text.PlainText
                    wrapMode: Text.Wrap
                    maximumLineCount: 8
                    elide: Text.ElideRight
                    font: Kirigami.Theme.smallFont
                }
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

                // The chat in numbers
                PlasmaComponents3.Label {
                    textFormat: Text.PlainText
                    Layout.fillWidth: true
                    visible: row.recap !== null
                    text: root.recapText(row.recap, row.session.costUsd)
                    wrapMode: Text.Wrap
                    opacity: 0.7
                    font: Kirigami.Theme.smallFont

                    PlasmaCore.ToolTipArea {
                        textFormat: Text.PlainText
                        anchors.fill: parent
                        active: row.recap !== null
                        mainText: i18n("This chat in numbers")
                        subText: !row.recap ? ""
                                 : (row.recap.startedAt ? i18n("Started %1 ago, last active %2 ago.", root.duration(root.now - row.recap.startedAt),
                                                               root.duration(root.now - (row.recap.lastAt || root.now))) + "\n" : "")
                                   + i18n("Tokens: input %1 · output %2 · cache read %3 · cache write %4 (subagents included).",
                                          root.formatTokens(row.recap.tokens.input), root.formatTokens(row.recap.tokens.output),
                                          root.formatTokens(row.recap.tokens.cacheRead), root.formatTokens(row.recap.tokens.cacheWrite))
                                   + "\n" + i18n("Worked: how long Claude was at it, from each prompt of yours to its last step.")
                                   + (row.session.costUsd ? "\n" + i18n("The price is what this session would cost through the API, from the status line.") : "")
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
                            textFormat: Text.PlainText
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
                            textFormat: Text.PlainText
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
                    readonly property string runKey: row.rowKey + "|" + modelData.id
                    readonly property bool open: root.expandedAgentRuns[runKey] === true
                    Layout.fillWidth: true
                    Layout.leftMargin: Kirigami.Units.gridUnit * 0.9 * modelData.depth
                    spacing: Kirigami.Units.smallSpacing

                    PlasmaComponents3.Label {
                        textFormat: Text.PlainText
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

                        // Its lines: click for its task, its last steps and its report
                        Item {
                            Layout.fillWidth: true
                            implicitHeight: agentLines.implicitHeight

                            ColumnLayout {
                                id: agentLines
                                anchors.fill: parent
                                spacing: 0
                                RowLayout {
                                    Layout.fillWidth: true
                                    PlasmaComponents3.Label {
                                        textFormat: Text.PlainText
                                        Layout.fillWidth: true
                                        text: agentRow.modelData.description || agentRow.modelData.type
                                        elide: Text.ElideRight
                                        font: Kirigami.Theme.smallFont
                                    }
                                    PlasmaComponents3.Label {
                                        textFormat: Text.PlainText
                                        // its kind, and the model it runs on
                                        text: agentRow.modelData.type + (agentRow.modelData.model ? " · " + agentRow.modelData.model : "")
                                        opacity: 0.6
                                        font: Kirigami.Theme.smallFont
                                    }
                                    PlasmaComponents3.Label {
                                        textFormat: Text.PlainText
                                        // failed: it ended on an API error (e.g. a usage limit)
                                        text: agentRow.modelData.status === "running"
                                              ? i18n("running · %1", root.duration(root.now - (agentRow.modelData.started || root.now)))
                                              : agentRow.modelData.status === "done" ? i18n("done")
                                              : agentRow.modelData.status === "failed" ? i18n("failed") : i18n("stopped")
                                        color: agentRow.modelData.status === "failed" ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.textColor
                                        opacity: agentRow.modelData.status === "failed" ? 1 : 0.7
                                        font: Kirigami.Theme.smallFont
                                    }
                                    Kirigami.Icon {
                                        source: agentRow.open ? "arrow-up" : "arrow-down"
                                        Layout.preferredWidth: Kirigami.Units.iconSizes.small
                                        Layout.preferredHeight: Layout.preferredWidth
                                        opacity: agentMouse.containsMouse ? 0.9 : 0.4
                                    }
                                }
                                PlasmaComponents3.Label {
                                    id: activityLabel
                                    textFormat: Text.PlainText
                                    Layout.fillWidth: true
                                    visible: text !== ""
                                    text: agentRow.modelData.activity
                                    opacity: 0.6
                                    elide: Text.ElideRight
                                    font: Kirigami.Theme.smallFont
                                }
                            }

                            PlasmaCore.ToolTipArea {
                                textFormat: Text.PlainText
                                anchors.fill: parent
                                mainText: agentRow.modelData.description || agentRow.modelData.type
                                subText: (activityLabel.truncated ? agentRow.modelData.activity + "\n\n" : "")
                                         + (agentRow.open ? i18n("Click to fold it up again.")
                                                          : i18n("Click for its task, its last steps and its report."))

                                MouseArea {
                                    id: agentMouse
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: root.toggleAgentRun(agentRow.runKey)
                                }
                            }
                        }

                        // What it was asked, what it did last, and what it handed back
                        Rectangle {
                            Layout.fillWidth: true
                            Layout.topMargin: Kirigami.Units.smallSpacing / 2
                            visible: agentRow.open
                            implicitHeight: runColumn.implicitHeight + Kirigami.Units.smallSpacing * 2
                            radius: Kirigami.Units.cornerRadius
                            color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.06)

                            ColumnLayout {
                                id: runColumn
                                anchors.fill: parent
                                anchors.margins: Kirigami.Units.smallSpacing
                                spacing: Kirigami.Units.smallSpacing / 2

                                PlasmaComponents3.Label {
                                    id: taskLabel
                                    Layout.fillWidth: true
                                    visible: !!agentRow.modelData.task
                                    text: i18nc("what a subagent was asked to do", "Task: %1", agentRow.modelData.task)
                                    textFormat: Text.PlainText
                                    wrapMode: Text.Wrap
                                    maximumLineCount: 4
                                    elide: Text.ElideRight
                                    opacity: 0.7
                                    font: Kirigami.Theme.smallFont

                                    PlasmaCore.ToolTipArea {
                                        textFormat: Text.PlainText
                                        anchors.fill: parent
                                        active: taskLabel.truncated
                                        mainText: i18n("Its task")
                                        subText: agentRow.modelData.task
                                    }
                                }
                                PlasmaComponents3.Label {
                                    textFormat: Text.PlainText
                                    Layout.fillWidth: true
                                    visible: text !== ""
                                    text: root.agentNumbers(agentRow.modelData)
                                    opacity: 0.7
                                    font: Kirigami.Theme.smallFont
                                }
                                Repeater {
                                    model: (agentRow.modelData.steps || []).length
                                    delegate: PlasmaComponents3.Label {
                                        required property int index
                                        Layout.fillWidth: true
                                        text: "▸ " + ((agentRow.modelData.steps || [])[index] || "")
                                        textFormat: Text.PlainText
                                        elide: Text.ElideRight
                                        opacity: 0.8
                                        font.pointSize: Kirigami.Theme.smallFont.pointSize
                                        font.bold: agentRow.modelData.status === "running" && index === (agentRow.modelData.steps || []).length - 1
                                    }
                                }
                                PlasmaComponents3.Label {
                                    Layout.fillWidth: true
                                    visible: !!agentRow.modelData.report
                                    text: i18nc("what a subagent handed back", "Report: %1", agentRow.modelData.report)
                                    textFormat: Text.PlainText
                                    wrapMode: Text.Wrap
                                    maximumLineCount: 12
                                    elide: Text.ElideRight
                                    font: Kirigami.Theme.smallFont
                                }
                                PlasmaComponents3.ToolButton {
                                    icon.name: "document-preview"
                                    text: i18n("Open the whole run")
                                    enabled: !!row.session.chatId
                                    onClicked: root.openAgentRun(row.session, agentRow.modelData.id, row.remoteHost)

                                    PlasmaCore.ToolTipArea {
                                        textFormat: Text.PlainText
                                        anchors.fill: parent
                                        mainText: i18n("Everything it did")
                                        subText: i18n("Its task, every step with the start of each result, and its report, as a Markdown file in your app for those. Claude Code itself can't open a subagent from outside.")
                                                 + (row.remoteHost ? " " + i18n("Fetched from %1 over ssh.", row.remoteHost) : "")
                                    }
                                }
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
            // rich text (an InlineMessage always guesses), so the name is escaped
            text: "<span>" + (row.canInterrupt
                  ? i18n("Interrupt “%1”? Like Ctrl+C in its tmux pane, or the stop button in VS Code: the current step and its subagents stop, and the chat stays open there. Or stop it: Claude quits and its terminal stays open.", root.escapeHtml(row.session.name))
                  : row.canEnd && row.inVscode && row.session.state === "working"
                  ? i18n("Stop “%1”? It's working right now: the current step is interrupted, as with VS Code's stop button, and anything it was running stops. Its tab keeps the chat and goes on with your next message.", root.escapeHtml(row.session.name))
                  : row.canEnd && row.inVscode && row.session.state === "waiting"
                  ? i18n("Stop “%1”? It's waiting for you: what it asks is refused, as with VS Code's stop button. Its tab keeps the chat and goes on with your next message.", root.escapeHtml(row.session.name))
                  : row.canEnd && row.inVscode
                  ? i18n("Stop “%1”? It's idle, so nothing is interrupted: its Claude process in VS Code quits. Its tab keeps the chat and goes on with your next message.", root.escapeHtml(row.session.name))
                  : row.canEnd && row.session.state === "working"
                  ? i18n("Stop “%1”? It's working right now: the current step is cut off and anything it was running stops. Claude quits and its terminal stays open; the chat is kept (Recent chats reopens it).", root.escapeHtml(row.session.name))
                  : row.canEnd && row.session.state === "waiting"
                  ? i18n("Stop “%1”? It's waiting for you: Claude quits without your answer and its terminal stays open. The chat is kept (Recent chats reopens it).", root.escapeHtml(row.session.name))
                  : row.canEnd
                  ? i18n("Stop “%1”? It's idle, so nothing is interrupted: Claude quits and its terminal stays open. The chat is kept; reopen it from Recent chats.", root.escapeHtml(row.session.name))
                  : row.session.state === "working"
                  ? i18n("Stop “%1”? It's working right now: the current step is interrupted and anything it started in the background stops too. The conversation is kept; claude attach resumes it.", root.escapeHtml(row.session.name))
                  : row.session.state === "waiting"
                  ? i18n("Stop “%1”? It's waiting for you. The conversation is kept; claude attach resumes it.", root.escapeHtml(row.session.name))
                  : i18n("Stop “%1”? It's finished, so this only shuts down its idle process. The conversation is kept.", root.escapeHtml(row.session.name))) + "</span>"
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
