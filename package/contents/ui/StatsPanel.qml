import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami

// An account's last days (claude_status.py: token_stats): tokens per day as
// bars (today's in the accent color), the totals, its busiest folders and
// its models.
ColumnLayout {
    id: panel

    property var stats: null
    readonly property var days: stats ? stats.days : []
    readonly property var projects: stats ? stats.projects.slice(0, 5) : []
    readonly property real maxDay: Math.max(1, ...days.map(d => d.total))
    readonly property real maxProject: Math.max(1, ...projects.map(p => p.total))
    readonly property color muted: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.35)

    spacing: Kirigami.Units.smallSpacing

    RowLayout {
        Layout.fillWidth: true
        spacing: 2

        Repeater {
            model: panel.days.length
            delegate: ColumnLayout {
                id: dayColumn
                required property int index
                readonly property var day: panel.days[index] || root.emptyDay
                readonly property bool today: index === panel.days.length - 1
                Layout.fillWidth: true
                Layout.preferredWidth: 1
                spacing: 1

                Item {
                    Layout.fillWidth: true
                    Layout.preferredHeight: Kirigami.Units.gridUnit * 2.5

                    Rectangle {
                        anchors.bottom: parent.bottom
                        anchors.horizontalCenter: parent.horizontalCenter
                        width: Math.max(2, parent.width * 0.7)
                        height: Math.max(1, Math.round(parent.height * dayColumn.day.total / panel.maxDay))
                        radius: Math.min(2, width / 2)
                        color: dayColumn.today ? Kirigami.Theme.focusColor : panel.muted
                    }

                    PlasmaCore.ToolTipArea {
                        textFormat: Text.PlainText
                        anchors.fill: parent
                        mainText: root.dayName(dayColumn.day.day, true)
                        subText: i18n("%1 tokens (%2 out)", root.formatTokens(dayColumn.day.total), root.formatTokens(dayColumn.day.output))
                                 + "\n" + i18np("%1 chat", "%1 chats", dayColumn.day.chats)
                                 + " · " + i18np("%1 prompt", "%1 prompts", dayColumn.day.prompts)
                    }
                }
                PlasmaComponents3.Label {
                    textFormat: Text.PlainText
                    Layout.fillWidth: true
                    horizontalAlignment: Text.AlignHCenter
                    text: root.dayName(dayColumn.day.day, false)
                    font.pointSize: Kirigami.Theme.smallFont.pointSize
                    font.bold: dayColumn.today
                    opacity: dayColumn.today ? 0.9 : 0.6
                }
            }
        }
    }

    PlasmaComponents3.Label {
        textFormat: Text.PlainText
        Layout.fillWidth: true
        visible: panel.stats !== null
        wrapMode: Text.Wrap
        font: Kirigami.Theme.smallFont
        opacity: 0.8
        text: !panel.stats ? ""
              : i18np("%1 day: ", "%1 days: ", panel.days.length)
                + i18n("%1 tokens (%2 out)", root.formatTokens(panel.stats.sum.total), root.formatTokens(panel.stats.sum.output))
                + " · " + i18np("%1 chat", "%1 chats", panel.stats.sum.chats)
                + " · " + i18np("%1 prompt", "%1 prompts", panel.stats.sum.prompts)
                + " · " + i18np("%1 active day", "%1 active days", panel.stats.sum.activeDays)
    }

    // Its busiest folders, by tokens
    Repeater {
        model: panel.projects.length
        delegate: RowLayout {
            id: projectRow
            required property int index
            readonly property var project: panel.projects[index] || root.emptyProject
            Layout.fillWidth: true
            spacing: Kirigami.Units.smallSpacing

            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.preferredWidth: Kirigami.Units.gridUnit * 7
                text: projectRow.project.name
                elide: Text.ElideMiddle
                font: Kirigami.Theme.smallFont

                PlasmaCore.ToolTipArea {
                    textFormat: Text.PlainText
                    anchors.fill: parent
                    mainText: projectRow.project.path
                    subText: i18n("%1 tokens (%2 out) · %3", root.formatTokens(projectRow.project.total),
                                  root.formatTokens(projectRow.project.output),
                                  i18np("%1 prompt", "%1 prompts", projectRow.project.prompts))
                }
            }
            Item {
                Layout.fillWidth: true
                Layout.preferredHeight: Math.round(Kirigami.Units.gridUnit * 0.35)

                Rectangle {
                    width: Math.max(1, parent.width * projectRow.project.total / panel.maxProject)
                    height: parent.height
                    radius: height / 2
                    color: panel.muted
                }
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                text: root.formatTokens(projectRow.project.total)
                      + (projectRow.project.prompts ? " · " + i18np("%1 prompt", "%1 prompts", projectRow.project.prompts) : "")
                font: Kirigami.Theme.smallFont
                opacity: 0.7
            }
        }
    }

    PlasmaComponents3.Label {
        textFormat: Text.PlainText
        Layout.fillWidth: true
        visible: !!panel.stats && panel.stats.models.length > 0
        elide: Text.ElideRight
        font: Kirigami.Theme.smallFont
        opacity: 0.7
        text: !panel.stats ? "" : panel.stats.models.map(m => {
            const share = 100 * m.total / Math.max(1, panel.stats.sum.total)
            return m.model + " " + (share < 1 ? "<1%" : share > 99 && share < 100 ? ">99%" : Math.round(share) + "%")
        }).join(" · ")
    }
}
