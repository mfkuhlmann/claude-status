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
            SparkIcon {
                visible: !root.inTray
                Layout.preferredWidth: Kirigami.Units.iconSizes.small
                Layout.preferredHeight: Kirigami.Units.iconSizes.small
                color: root.stateColor(root.overall)
                spinning: root.overall === "working" && root.dashboardShown && !root.coveredByWindow
            }
            Kirigami.Heading {
                textFormat: Text.PlainText
                visible: !root.inTray
                level: 3
                text: i18n("Claude Code")
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                horizontalAlignment: Text.AlignRight
                text: hero.visible ? "" : root.summaryText()   // the big Clawd's headline says it
                opacity: 0.8
                elide: Text.ElideRight
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
        spacing: Kirigami.Units.smallSpacing

        // The big Clawd: the whole dashboard at a glance (stays put while the list scrolls)
        PetStrip {
            id: hero
            hero: true
            visible: Plasmoid.configuration.showPet
            Layout.fillWidth: true
            Layout.preferredHeight: implicitHeight
            Layout.topMargin: Kirigami.Units.smallSpacing
            Layout.leftMargin: Kirigami.Units.smallSpacing
            Layout.rightMargin: Kirigami.Units.smallSpacing
        }

        PlasmaComponents3.ScrollView {
            id: scroll
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

                PlasmaComponents3.Label {
                    textFormat: Text.PlainText
                    Layout.fillWidth: true
                    Layout.margins: Kirigami.Units.smallSpacing
                    visible: root.errorText !== ""
                    text: root.errorText
                    color: Kirigami.Theme.negativeTextColor
                    wrapMode: Text.Wrap
                }

                // Indexed by position so rows survive each poll (a new array every
                // 2 s would rebuild them and drop their state).
                Repeater {
                    model: root.groups.length
                    delegate: GroupSection {
                        required property int index
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
            }
        }
    }
}
