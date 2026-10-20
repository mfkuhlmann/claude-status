import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami

// One Claude account: plan limits, token totals, its sessions (which may
// come from several config dirs logged into that account) and recent chats.
// With remoteHost set, the account is on that SSH host: its actions run there.
ColumnLayout {
    id: section

    property var group
    property bool last: false
    property string remoteHost: ""

    readonly property string groupKey: (remoteHost ? remoteHost + "/" : "") + group.id
    readonly property var recent: group.recent || []
    readonly property bool recentOpen: !!root.expandedRecent[groupKey]

    readonly property var tokens: group.tokens
    readonly property bool hasTokens: tokens !== null && tokens !== undefined
    readonly property bool hasStats: !!group.stats
    readonly property bool statsOpen: hasStats && root.expandedStats[groupKey] === true
    readonly property bool multiProfile: group.profiles.length > 1

    spacing: Kirigami.Units.smallSpacing

    RowLayout {
        Layout.fillWidth: true
        Layout.leftMargin: Kirigami.Units.smallSpacing
        Layout.rightMargin: Kirigami.Units.smallSpacing

        Kirigami.Heading {
            id: heading
            textFormat: Text.PlainText
            level: 4
            text: section.group.title
            elide: Text.ElideRight
            Layout.maximumWidth: section.width - newChatButton.width - Kirigami.Units.gridUnit * 6
        }
        PlasmaComponents3.ToolButton {
            id: newChatButton
            icon.name: "list-add"
            display: PlasmaComponents3.AbstractButton.IconOnly
            text: i18n("New chat")
            Layout.preferredHeight: heading.implicitHeight
            Layout.preferredWidth: Layout.preferredHeight
            checked: root.newChatGroup === section.groupKey
            onClicked: root.toggleNewChat(section.groupKey)

            PlasmaCore.ToolTipArea {
                textFormat: Text.PlainText
                anchors.fill: parent
                mainText: i18n("New chat on %1", section.group.title)
                subText: section.remoteHost
                         ? i18n("Lists this account's folders on %1: start a new Claude chat in one, in a terminal (over ssh) or in VS Code.", section.remoteHost)
                         : i18n("Lists this account's recent folders: start a new Claude chat in one, in a terminal or in VS Code.")
            }
        }
        Item {
            Layout.fillWidth: true
        }
        PlasmaComponents3.Label {
            textFormat: Text.PlainText
            visible: section.multiProfile
            text: section.group.profiles.join(" + ")
            opacity: 0.6
            font: Kirigami.Theme.smallFont
        }
    }

    // New chat (the + above): the account's folders. One switch at the top
    // says where a chat starts (OpenInSwitch.qml): a terminal with Claude in
    // the folder you click, or VS Code's Claude extension, which runs on one
    // account only (greyed out on the others).
    Rectangle {
        id: newChatBox
        readonly property bool open: root.newChatGroup === section.groupKey
        readonly property var folders: open ? root.newChatFolders(section.group, section.remoteHost) : []
        readonly property bool inVscode: root.openInVscode(section.group, section.remoteHost, false)
        readonly property bool terminalHere: root.cliHere(section.remoteHost)

        visible: open
        Layout.fillWidth: true
        Layout.leftMargin: Kirigami.Units.smallSpacing
        Layout.rightMargin: Kirigami.Units.smallSpacing
        implicitHeight: newChatColumn.implicitHeight + Kirigami.Units.smallSpacing * 2
        radius: Kirigami.Units.cornerRadius
        color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.05)
        border.width: 1
        border.color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.12)

        ColumnLayout {
            id: newChatColumn
            anchors.fill: parent
            anchors.margins: Kirigami.Units.smallSpacing
            spacing: 0

            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                Layout.leftMargin: Kirigami.Units.smallSpacing
                text: i18n("New chat on %1 in…", section.remoteHost
                           ? i18nc("account on ssh host", "%1 on %2", section.group.title, section.remoteHost)
                           : section.group.title)
                font.bold: true
                opacity: 0.8
                elide: Text.ElideRight
            }

            // Where it starts: Terminal | VS Code, for every folder below
            OpenInSwitch {
                Layout.fillWidth: true
                Layout.leftMargin: Kirigami.Units.smallSpacing
                group: section.group
                remoteHost: section.remoteHost
            }

            Repeater {
                model: newChatBox.folders.length
                delegate: PlasmaComponents3.ItemDelegate {
                    id: folderRow
                    required property int index
                    readonly property var folder: newChatBox.folders[index] || ({ path: "", short: "", newChatCommand: "" })
                    Layout.fillWidth: true
                    icon.name: folderRow.folder.short === "~" ? "user-home" : "folder"
                    text: folderRow.folder.short === "~" ? i18n("Home folder (~)") : folderRow.folder.short
                    enabled: newChatBox.inVscode || (newChatBox.terminalHere && (!section.remoteHost || !!folderRow.folder.newChatCommand))
                    onClicked: {
                        if (section.remoteHost && newChatBox.inVscode) {
                            root.remoteNewChatVscode(section.remoteHost, folderRow.folder.path, section.group)
                        } else if (section.remoteHost) {
                            root.remoteNewChat(section.remoteHost, folderRow.folder.newChatCommand)
                        } else {
                            root.newChat(section.group.chatProfile, folderRow.folder.path, newChatBox.inVscode)
                        }
                    }
                }
            }

            Kirigami.Separator {
                visible: !section.remoteHost && newChatBox.folders.length > 0
                Layout.fillWidth: true
                Layout.topMargin: Kirigami.Units.smallSpacing / 2
                Layout.bottomMargin: Kirigami.Units.smallSpacing / 2
            }

            // Any folder, picked in the folder dialog (not on an SSH host)
            PlasmaComponents3.ItemDelegate {
                visible: !section.remoteHost
                enabled: newChatBox.inVscode || newChatBox.terminalHere
                Layout.fillWidth: true
                icon.name: "folder-open"
                text: i18n("Choose folder…")
                onClicked: root.newChatChoosingFolder(section.group.chatProfile, newChatBox.inVscode)
            }
        }
    }

    // This account's chats as pets (PetStrip.qml), the ones that need you or
    // work first. It slides open when the account has a chat in the list.
    PetStrip {
        id: stage
        readonly property bool wanted: Plasmoid.configuration.showPet && Plasmoid.configuration.chatPets > 0
                                       && (stage.chats.length > 0 || stage.petCount > 0)
        property real shownHeight: wanted ? implicitHeight : 0
        Behavior on shownHeight {
            NumberAnimation { duration: 260; easing.type: Easing.InOutQuad }
        }
        Layout.fillWidth: true
        Layout.leftMargin: Kirigami.Units.smallSpacing
        Layout.rightMargin: Kirigami.Units.smallSpacing
        Layout.preferredHeight: shownHeight
        visible: shownHeight > 0
        stageKey: section.groupKey
        chats: {
            const rank = { waiting: 0, working: 1, idle: 2, done: 3 }
            const out = [], seen = {}
            for (const s of section.group.sessions) {
                const key = root.petKeyOf(s, section.remoteHost)
                if (key in seen)
                    continue
                seen[key] = true
                out.push({ key: key, session: s, host: section.remoteHost, order: out.length })
            }
            return out.sort((a, b) => (rank[a.session.state] - rank[b.session.state]) || (a.order - b.order))
        }
    }

    // Plan limits (from the status line); not where they show elsewhere (root.withUsage)
    ColumnLayout {
        visible: !section.group.limitsHidden
        Layout.fillWidth: true
        Layout.leftMargin: Kirigami.Units.smallSpacing
        Layout.rightMargin: Kirigami.Units.smallSpacing
        spacing: Kirigami.Units.smallSpacing / 2

        Repeater {
            // a count, not the array: a new array every poll would make the
            // bars anew (and close the forecast's tooltip under the mouse)
            model: section.group.limits ? section.group.limits.windows.length : 0
            delegate: UsageBar {
                required property int index
                readonly property var window: (section.group.limits ? section.group.limits.windows[index] : null)
                                              || ({ label: "", pct: 0, forecast: null, resetsAt: 0 })
                Layout.fillWidth: true
                label: window.label
                pct: window.pct
                detail: root.resetText(window)
                forecast: window.forecast || null
                resetsAt: window.resetsAt || 0
            }
        }

        PlasmaComponents3.Label {
            textFormat: Text.PlainText
            Layout.fillWidth: true
            elide: Text.ElideRight
            opacity: 0.6
            font: Kirigami.Theme.smallFont
            text: !section.group.limits ? i18n("No plan usage yet: shows after this account's next reply")
                  : section.group.limitsFrom
                    ? (root.now - section.group.limits.updatedAt < 60000 ? i18n("Plan usage updated just now, on %1", section.group.limitsFrom)
                       : i18n("Plan usage as of %1 ago, on %2", root.duration(root.now - section.group.limits.updatedAt), section.group.limitsFrom))
                  : root.now - section.group.limits.updatedAt < 60000 ? i18n("Plan usage updated just now")
                  : i18n("Plan usage as of %1 ago", root.duration(root.now - section.group.limits.updatedAt))

            PlasmaCore.ToolTipArea {
                textFormat: Text.PlainText
                anchors.fill: parent
                active: !section.group.limits
                mainText: i18n("No plan usage yet")
                subText: i18n("Plan limits come from the Claude Code status line (statusline-snippet.sh). They update whenever a session of this account gets a reply.")
            }
        }
    }

    // Token totals (from local transcripts); click for the last days
    RowLayout {
        visible: section.hasTokens
        Layout.fillWidth: true
        Layout.leftMargin: Kirigami.Units.smallSpacing
        Layout.rightMargin: Kirigami.Units.smallSpacing
        spacing: Kirigami.Units.smallSpacing

        PlasmaComponents3.Label {
            id: tokenLabel
            textFormat: Text.PlainText
            Layout.fillWidth: true
            elide: Text.ElideRight
            text: section.hasTokens
                  ? i18n("Tokens today %1 (%2 out) · 7 days %3 (%4 out)",
                         root.formatTokens(section.tokens.today.total), root.formatTokens(section.tokens.today.output),
                         root.formatTokens(section.tokens.week.total), root.formatTokens(section.tokens.week.output))
                  : ""

            PlasmaCore.ToolTipArea {
                textFormat: Text.PlainText
                anchors.fill: parent
                active: section.hasTokens
                mainText: i18n("Tokens (this machine's transcripts only)")
                subText: {
                    if (!section.hasTokens)
                        return ""
                    const t = section.tokens
                    const fmt = b => i18n("input %1 · output %2 · cache read %3 · cache write %4 · %5 replies",
                                          root.formatTokens(b.input), root.formatTokens(b.output),
                                          root.formatTokens(b.cacheRead), root.formatTokens(b.cacheWrite), b.messages)
                    const models = t.models.map(m => m.model.replace(/^claude-/, "") + ": " + root.formatTokens(m.total))
                    return i18n("Today: %1", fmt(t.today)) + "\n" + i18n("Last 7 days: %1", fmt(t.week))
                           + (models.length ? "\n" + i18n("By model (7 days): %1", models.join(", ")) : "")
                           + (t.week.shared > 0
                              ? "\n" + i18n("Includes %1 today (%2 in 7 days) from chats shared with another profile. A transcript doesn't say which account paid, so shared chats count on both.",
                                             root.formatTokens(t.today.shared), root.formatTokens(t.week.shared))
                              : "")
                           + (section.hasStats ? "\n\n" + (section.statsOpen ? i18n("Click to fold the last days up again.")
                                                                             : i18n("Click for the last days: tokens per day, your busiest folders and models.")) : "")
                }

                MouseArea {
                    anchors.fill: parent
                    enabled: section.hasStats
                    cursorShape: section.hasStats ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onClicked: root.toggleStats(section.groupKey)
                }
            }
        }
        Kirigami.Icon {
            visible: section.hasStats
            source: section.statsOpen ? "arrow-up" : "arrow-down"
            Layout.preferredWidth: Kirigami.Units.iconSizes.small
            Layout.preferredHeight: Layout.preferredWidth
            opacity: 0.5

            TapHandler {
                onTapped: root.toggleStats(section.groupKey)
            }
        }
    }

    // The last days, unfolded from the token line
    StatsPanel {
        visible: section.statsOpen
        Layout.fillWidth: true
        Layout.leftMargin: Kirigami.Units.smallSpacing
        Layout.rightMargin: Kirigami.Units.smallSpacing
        stats: section.hasStats ? section.group.stats : null
    }

    // Sessions
    Repeater {
        model: section.group.sessions.length
        delegate: SessionRow {
            required property int index
            Layout.fillWidth: true
            session: section.group.sessions[index] || root.emptySession
            showProfile: section.multiProfile
            remoteHost: section.remoteHost
        }
    }

    PlasmaComponents3.Label {
        textFormat: Text.PlainText
        visible: section.group.sessions.length === 0
        Layout.fillWidth: true
        Layout.leftMargin: Kirigami.Units.smallSpacing
        text: i18n("No running sessions")
        opacity: 0.6
    }

    // Chats shared with this account that are in use on another one (they're
    // listed there, once): a line pointing to them
    Repeater {
        model: (section.group.sharedHere || []).length
        delegate: RowLayout {
            id: sharedLine

            required property int index
            readonly property var chat: section.group.sharedHere[index]
                                        || ({ sessionId: "", profileDir: "", name: "", profile: "", state: "idle",
                                              reason: "", since: null, stoppedHere: false, copy: false, openCommand: "" })

            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.smallSpacing
            Layout.rightMargin: Kirigami.Units.smallSpacing
            spacing: Kirigami.Units.smallSpacing

            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                text: "⇄"
                color: root.stateColor(sharedLine.chat.state)
            }
            PlasmaComponents3.Label {
                id: sharedName
                textFormat: Text.PlainText
                text: sharedLine.chat.name
                opacity: 0.8
                font.underline: sharedMouse.containsMouse
                elide: Text.ElideRight
                Layout.fillWidth: true

                PlasmaCore.ToolTipArea {
                    textFormat: Text.PlainText
                    width: sharedName.contentWidth
                    height: parent.height
                    mainText: sharedLine.chat.copy ? i18n("Shared chat, continued on %1 as a copy", sharedLine.chat.profile)
                              : sharedLine.chat.state === "done" ? i18n("Shared chat, last used on %1", sharedLine.chat.profile)
                              : i18n("Shared chat, open on %1", sharedLine.chat.profile)
                    subText: (sharedLine.chat.copy
                              ? i18n("This chat is shared with this account too, but it continued on %1 in a copy Claude forked from it. New messages are only in that copy. Click to go to it.", sharedLine.chat.profile)
                              : i18n("This chat is shared with this account too. It's listed once, under the account it's used on. Click to go to it."))
                             + (sharedLine.chat.stoppedHere ? "\n" + i18n("Its background session on this account was stopped.") : "")

                    MouseArea {
                        id: sharedMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: section.remoteHost ? root.remoteOpen(section.remoteHost, sharedLine.chat.openCommand)
                                                      : root.jumpTo(sharedLine.chat.sessionId, sharedLine.chat.profileDir)
                    }
                }
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                text: sharedLine.chat.copy
                      ? i18nc("shared chat continued in a copy: where, its state", "copy on %1 · %2", sharedLine.chat.profile, root.stateText(sharedLine.chat))
                      : i18nc("shared chat: where it is, its state", "on %1 · %2", sharedLine.chat.profile, root.stateText(sharedLine.chat))
                opacity: 0.6
                font: Kirigami.Theme.smallFont
                elide: Text.ElideRight
                Layout.maximumWidth: Kirigami.Units.gridUnit * 12
            }
        }
    }

    // Recent chats: this account's latest other chats, to pick one up again
    PlasmaComponents3.ToolButton {
        visible: section.recent.length > 0
        Layout.leftMargin: Kirigami.Units.smallSpacing
        flat: true
        icon.name: section.recentOpen ? "arrow-down" : "arrow-right"
        text: i18n("Recent chats (%1)", section.recent.length)
        font: Kirigami.Theme.smallFont
        onClicked: root.toggleRecent(section.groupKey, section.recentOpen)

        PlasmaCore.ToolTipArea {
            textFormat: Text.PlainText
            anchors.fill: parent
            mainText: i18n("Recent chats")
            subText: i18n("This account's latest chats that aren't listed above. Click one to reopen it, in a terminal or in VS Code (the switch at the top of the list).")
        }
    }

    // Where they reopen: the same Terminal | VS Code choice as for new chats
    OpenInSwitch {
        id: recentOpenIn
        visible: section.recentOpen && section.recent.length > 0
        Layout.fillWidth: true
        Layout.leftMargin: Kirigami.Units.gridUnit
        Layout.rightMargin: Kirigami.Units.smallSpacing
        group: section.group
        remoteHost: section.remoteHost
        resuming: true
    }

    Repeater {
        model: section.recentOpen ? section.recent.length : 0
        delegate: ColumnLayout {
            id: recentLine

            required property int index
            readonly property var chat: section.recent[index]
                                        || ({ key: "", sessionId: "", name: "", cwd: "", cwdShort: "", lastActive: 0, profileDir: "",
                                              profile: "", shared: false, openCommand: "" })
            readonly property string rowKey: (section.remoteHost ? section.remoteHost + "|" : "") + chat.key
            readonly property bool canOpen: recentOpenIn.inVscode
                                            || (recentOpenIn.terminalHere && (!section.remoteHost || !!chat.openCommand))

            function open() {
                if (section.remoteHost && recentOpenIn.inVscode)
                    root.remoteResumeVscode(section.remoteHost, chat.sessionId, chat.cwd)
                else if (section.remoteHost)
                    root.remoteOpen(section.remoteHost, chat.openCommand)
                else if (recentOpenIn.inVscode)
                    root.resumeInVscode(chat.sessionId, chat.profileDir)
                else
                    root.jumpTo(chat.sessionId, chat.profileDir)
            }

            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.gridUnit
            Layout.rightMargin: Kirigami.Units.smallSpacing
            spacing: 0

            HoverHandler {
                id: recentHover
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Kirigami.Units.smallSpacing

                PlasmaComponents3.Label {
                    id: recentName
                    textFormat: Text.PlainText
                    text: recentLine.chat.name
                    font.underline: recentMouse.containsMouse
                    opacity: recentLine.canOpen ? 1 : 0.6
                    elide: Text.ElideRight
                    Layout.fillWidth: true

                    PlasmaCore.ToolTipArea {
                        textFormat: Text.PlainText
                        width: recentName.contentWidth
                        height: parent.height
                        mainText: recentLine.chat.name
                        subText: (recentLine.canOpen ? (recentOpenIn.inVscode ? root.vscodeHint(section.group, section.remoteHost, true)
                                                                              : root.terminalHint(section.remoteHost, true))
                                                     : root.terminalHint(section.remoteHost, true) + "\n" + root.vscodeHint(section.group, section.remoteHost, true))
                                 + (recentLine.chat.shared ? "\n" + i18n("Shared between accounts; last used on %1.", recentLine.chat.profile) : "")

                        MouseArea {
                            id: recentMouse
                            anchors.fill: parent
                            enabled: recentLine.canOpen
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: recentLine.open()
                        }
                    }
                }
                PlasmaComponents3.Label {
                    textFormat: Text.PlainText
                    visible: recentLine.chat.shared
                    text: "⇄"
                    opacity: 0.6
                }
                PlasmaComponents3.Label {
                    textFormat: Text.PlainText
                    text: i18nc("recent chat: folder, how long ago", "%1 · %2 ago", recentLine.chat.cwdShort || "~",
                                root.duration(root.now - recentLine.chat.lastActive))
                    opacity: 0.6
                    font: Kirigami.Theme.smallFont
                    elide: Text.ElideLeft
                    Layout.maximumWidth: Kirigami.Units.gridUnit * 12
                }
                PlasmaComponents3.ToolButton {
                    id: recentShare
                    visible: root.shareAccountsOf(section.remoteHost).length >= 2
                    opacity: recentHover.hovered ? 1 : 0
                    icon.name: "document-share"
                    display: PlasmaComponents3.AbstractButton.IconOnly
                    text: i18n("Share or continue on another account…")
                    Layout.preferredHeight: recentName.implicitHeight
                    Layout.preferredWidth: Layout.preferredHeight
                    onClicked: root.openShareMenu(recentShare, {
                        chatId: recentLine.chat.sessionId, name: recentLine.chat.name,
                        profileDir: recentLine.chat.profileDir, shared: recentLine.chat.shared, host: section.remoteHost
                    }, recentLine.rowKey)

                    PlasmaCore.ToolTipArea {
                        textFormat: Text.PlainText
                        anchors.fill: parent
                        mainText: i18n("Continue on another account")
                        subText: root.shareHint(section.remoteHost)
                    }
                }
            }

            KeepOnlyMessage {
                Layout.fillWidth: true
                visible: root.shareConfirm.key === recentLine.rowKey
            }
        }
    }

    Kirigami.Separator {
        visible: !section.last
        Layout.fillWidth: true
        Layout.topMargin: Kirigami.Units.smallSpacing
    }
}
