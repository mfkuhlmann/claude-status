import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.extras as PlasmaExtras
import org.kde.kirigami as Kirigami

PlasmaExtras.Representation {
    id: full

    Layout.minimumWidth: Kirigami.Units.gridUnit * 22
    Layout.minimumHeight: Kirigami.Units.gridUnit * 14
    Layout.preferredWidth: Kirigami.Units.gridUnit * 28
    Layout.preferredHeight: Kirigami.Units.gridUnit * 30

    collapseMarginsHint: true

    header: PlasmaExtras.PlasmoidHeading {
        RowLayout {
            anchors.fill: parent
            spacing: Kirigami.Units.smallSpacing

            // In the system tray, the tray's own heading names the widget
            TalpaIcon {
                visible: !root.inTray
                Layout.preferredWidth: Kirigami.Units.iconSizes.small
                Layout.preferredHeight: Kirigami.Units.iconSizes.small
                color: root.stateColor(root.overall)
                mode: root.overall
                moving: root.dashboardShown && !root.coveredByWindow
            }
            Kirigami.Heading {
                textFormat: Text.PlainText
                visible: !root.inTray
                level: 3
                text: i18n("Claude Code")
            }
            // Your chats now, your last 7 days with Claude (WeekView.qml), or
            // the permissions you gave (PermsView.qml)
            PlasmaComponents3.TabBar {
                id: tabs
                Layout.leftMargin: root.inTray ? 0 : Kirigami.Units.smallSpacing
                // (squeezed, it shares out what's left, and "Recap" broke onto two lines)
                Layout.minimumWidth: implicitWidth
                // (set by a click, not by the bar's own index: a new popup
                // starts at its first tab, which mustn't undo the one shown)
                currentIndex: ["chats", "week", "perms"].indexOf(root.popupTab)

                PlasmaComponents3.TabButton {
                    width: implicitWidth   // (else the bar gives each the same share)
                    text: i18n("Chats")
                    onClicked: root.popupTab = "chats"
                }
                PlasmaComponents3.TabButton {
                    width: implicitWidth
                    text: i18n("Recap")
                    onClicked: root.popupTab = "week"
                }
                PlasmaComponents3.TabButton {
                    width: implicitWidth
                    text: i18n("Permissions")
                    onClicked: root.popupTab = "perms"
                }
                Connections {
                    target: root
                    function onPopupTabChanged() {
                        tabs.currentIndex = ["chats", "week", "perms"].indexOf(root.popupTab)
                    }
                }
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                horizontalAlignment: Text.AlignRight
                text: hero.visible ? "" : root.summaryText()   // the big Talpa's headline says it
                opacity: 0.8
                elide: Text.ElideRight
            }
            PlasmaComponents3.ToolButton {
                visible: root.popupTab === "chats"
                icon.name: "view-filter"
                checkable: true
                checked: root.focusView
                display: PlasmaComponents3.AbstractButton.IconOnly
                text: i18n("Focus")
                onClicked: root.setFocusView(!root.focusView)

                PlasmaCore.ToolTipArea {
                    textFormat: Text.PlainText
                    anchors.fill: parent
                    mainText: root.focusView ? i18n("Show everything") : i18n("Focus")
                    subText: root.focusView ? i18n("Back to every account, chat, pet and usage bar.")
                                            : i18n("Only what needs you, the chats that finished while you looked away, and one line for each chat at work.")
                }
            }
            PlasmaComponents3.ToolButton {
                visible: root.popupTab === "chats"
                icon.name: "edit-find"
                checkable: true
                checked: root.searchOpen
                display: PlasmaComponents3.AbstractButton.IconOnly
                text: i18n("Find a chat")
                onClicked: root.toggleSearch()

                PlasmaCore.ToolTipArea {
                    textFormat: Text.PlainText
                    anchors.fill: parent
                    mainText: i18n("Find a chat")
                    subText: i18n("Every chat of your accounts (and of the SSH hosts shown) with all the words you type in its name, its folder or your prompts.")
                }
            }
            PlasmaComponents3.ToolButton {
                id: hostsButton
                icon.name: "network-server"
                text: root.shownHosts.length > 0 ? String(root.shownHosts.length) : ""
                display: root.shownHosts.length > 0 ? PlasmaComponents3.AbstractButton.TextBesideIcon
                                                    : PlasmaComponents3.AbstractButton.IconOnly
                onClicked: root.openHostsMenu(hostsButton)

                PlasmaCore.ToolTipArea {
                    textFormat: Text.PlainText
                    anchors.fill: parent
                    mainText: i18n("SSH hosts")
                    subText: root.shownHosts.length > 0
                             ? i18n("Showing Claude on %1. Click to pick hosts from ~/.ssh/config.", root.shownHosts.join(", "))
                             : i18n("Show Claude sessions of your SSH hosts (from ~/.ssh/config) here too.")
                }
            }
            PlasmaComponents3.ToolButton {
                icon.name: "view-refresh"
                onClicked: {
                    root.refresh()
                    for (const host of root.shownHosts)
                        root.pollHost(host)
                    root.loadWeek()   // (on the Recap tab)
                }

                PlasmaCore.ToolTipArea {
                    textFormat: Text.PlainText
                    anchors.fill: parent
                    mainText: i18n("Refresh")
                }
            }
        }
    }

    contentItem: ColumnLayout {
        id: tabContent
        spacing: Kirigami.Units.smallSpacing
        // A tab slides in from the side it's on (Chats | Recap | Permissions)
        transform: Translate { id: tabSlide }
        property int tabIndex: ["chats", "week", "perms"].indexOf(root.popupTab)
        onTabIndexChanged: {
            if (!root.animateRows)
                return
            const from = tabIndex > shownTab ? 1 : -1
            shownTab = tabIndex
            tabSlideIn.stop()
            tabSlide.x = from * Kirigami.Units.gridUnit * 2.5
            tabContent.opacity = 0.35
            tabSlideIn.start()
        }
        property int shownTab: tabIndex
        ParallelAnimation {
            id: tabSlideIn
            NumberAnimation { target: tabSlide; property: "x"; to: 0; duration: Kirigami.Units.longDuration; easing.type: Easing.OutCubic }
            NumberAnimation { target: tabContent; property: "opacity"; to: 1; duration: Kirigami.Units.longDuration; easing.type: Easing.OutQuad }
            onStopped: { tabSlide.x = 0; tabContent.opacity = 1 }
        }

        // The big Talpa: the whole dashboard at a glance (stays put while the list scrolls)
        PetStrip {
            id: hero
            hero: true
            visible: Plasmoid.configuration.showPet && root.popupTab === "chats"
            Layout.fillWidth: true
            Layout.preferredHeight: implicitHeight
            Layout.topMargin: Kirigami.Units.smallSpacing
            Layout.leftMargin: Kirigami.Units.smallSpacing
            Layout.rightMargin: Kirigami.Units.smallSpacing
        }

        // Find a chat (the magnifier above): its words, then what matched
        PlasmaExtras.SearchField {
            id: searchField
            visible: root.searchOpen && root.popupTab === "chats"
            Layout.fillWidth: true
            Layout.leftMargin: Kirigami.Units.smallSpacing
            Layout.rightMargin: Kirigami.Units.smallSpacing
            placeholderText: i18n("Find a chat: words in its name, folder or your prompts")
            onTextChanged: root.searchQuery = text
            onVisibleChanged: {
                if (visible) {
                    text = root.searchQuery
                    forceActiveFocus()
                }
            }
            Keys.onEscapePressed: root.toggleSearch()

            Connections {   // (cleared when the search closes)
                target: root
                function onSearchQueryChanged() {
                    if (searchField.text !== root.searchQuery)
                        searchField.text = root.searchQuery
                }
            }
        }

        // (made only while their tab is open)
        Loader {
            active: root.popupTab === "week"
            visible: active
            Layout.fillWidth: true
            Layout.fillHeight: true
            source: "WeekView.qml"
        }
        Loader {
            active: root.popupTab === "perms"
            visible: active
            Layout.fillWidth: true
            Layout.fillHeight: true
            source: "PermsView.qml"
        }

        PlasmaComponents3.ScrollView {
            id: scroll
            visible: root.popupTab === "chats"
            // Fixed implicit size: deriving it from the content would loop
            // through the popup's width.
            implicitWidth: Kirigami.Units.gridUnit * 28
            implicitHeight: Kirigami.Units.gridUnit * 26
            Layout.fillWidth: true
            Layout.fillHeight: true
            contentWidth: availableWidth
            contentHeight: content.implicitHeight
            PlasmaComponents3.ScrollBar.horizontal.policy: PlasmaComponents3.ScrollBar.AlwaysOff

            ColumnLayout {
                id: content
                width: scroll.availableWidth
                spacing: Kirigami.Units.largeSpacing
                Component.onCompleted: root.rowSpace = content

                PlasmaComponents3.Label {
                    textFormat: Text.PlainText
                    Layout.fillWidth: true
                    Layout.margins: Kirigami.Units.smallSpacing
                    visible: root.actionError !== ""
                    text: root.actionError
                    color: Kirigami.Theme.negativeTextColor
                    wrapMode: Text.Wrap
                }

                PlasmaComponents3.Label {
                    textFormat: Text.PlainText
                    Layout.fillWidth: true
                    Layout.margins: Kirigami.Units.smallSpacing
                    visible: root.actionInfo !== ""
                    text: root.actionInfo
                    color: Kirigami.Theme.positiveTextColor
                    wrapMode: Text.Wrap
                }

                // What happened while you were away (main.qml: sendDigest), until you've seen it
                Kirigami.InlineMessage {
                    Layout.fillWidth: true
                    Layout.margins: Kirigami.Units.smallSpacing
                    visible: root.awayDigest !== null
                    type: Kirigami.MessageType.Information
                    icon.name: "user-away"
                    text: root.awayDigest ? "<b>" + root.escapeHtml(root.awayDigest.title) + "</b><br>"
                                            + root.awayDigest.lines.map(root.escapeHtml).join("<br>") : ""
                    actions: [
                        Kirigami.Action {
                            text: i18n("Dismiss")
                            icon.name: "dialog-close"
                            onTriggered: root.awayDigest = null
                        }
                    ]
                }

                SearchResults {
                    visible: root.searchOpen && root.searchQuery.trim().length >= 2
                    Layout.fillWidth: true
                }

                PlasmaComponents3.Label {
                    textFormat: Text.PlainText
                    Layout.fillWidth: true
                    Layout.margins: Kirigami.Units.smallSpacing
                    visible: root.errorText !== ""
                    text: root.errorText
                    color: Kirigami.Theme.negativeTextColor
                    wrapMode: Text.Wrap
                }

                // Only what needs you and what works (the header's filter button)
                FocusView {
                    visible: root.focusView && !(root.searchOpen && root.searchQuery.trim().length >= 2)
                    Layout.fillWidth: true
                }

                // Indexed by position so rows survive each poll (a new array every
                // 2 s would rebuild them and drop their state).
                Repeater {
                    model: root.groups.length
                    delegate: GroupSection {
                        required property int index
                        visible: !root.focusView   // (kept, with their pets and what's open, while the focus view shows)
                        Layout.fillWidth: true
                        group: root.groups[index] || root.emptyGroup
                        accounts: root.groups.length
                        last: index === root.groups.length - 1
                    }
                }

                // SSH hosts you picked, after this computer's accounts
                Repeater {
                    model: root.shownHosts.length
                    delegate: HostSection {
                        required property int index
                        visible: !root.focusView
                        Layout.fillWidth: true
                        host: root.shownHosts[index] || ""
                    }
                }

                PlasmaExtras.PlaceholderMessage {
                    Layout.fillWidth: true
                    Layout.margins: Kirigami.Units.gridUnit
                    visible: root.status !== null && root.groups.length === 0
                    iconName: "dialog-information"
                    text: i18n("No Claude Code config found")
                    explanation: i18n("Looked for ~/.claude and ~/.claude-*. Add other dirs in the widget settings.")
                }

                // (some room under the last line, scrolled to the end too)
                Item {
                    implicitHeight: Kirigami.Units.smallSpacing
                }
            }
        }
    }
}
