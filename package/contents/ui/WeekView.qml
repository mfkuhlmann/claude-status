import QtQuick
import QtQuick.Layouts
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.extras as PlasmaExtras
import org.kde.kirigami as Kirigami

// The Recap tab (main.qml: loadWeek, week.py): your last 7 days with Claude.
// How long you were at it and how long Claude worked, a day per row on a
// timeline, what the same work would cost at API prices, where it went, and
// what would make it use less of your plan (the rules of Claude Code's own
// /usage). All of it read from the chat transcripts: no tokens, nothing sent.
PlasmaComponents3.ScrollView {
    id: view

    readonly property var recap: root.weekRecap
    readonly property var days: recap ? recap.days : []
    readonly property var sum: recap ? recap.sum : null
    readonly property var previous: recap && recap.previous && (recap.previous.workedMs || recap.previous.prompts
                                                                  || recap.previous.cost) ? recap.previous : null
    readonly property var accounts: recap ? recap.accounts : []
    readonly property var projects: recap ? recap.projects : []
    readonly property var models: recap ? recap.models : []
    readonly property var chats: recap ? recap.chats : []
    readonly property var tips: recap ? recap.tips : []
    readonly property bool hasData: !!sum && (sum.workedMs > 0 || sum.prompts > 0 || sum.cost > 0)
    readonly property real maxProject: Math.max(1, ...projects.map(p => p.workedMs))
    readonly property real gu: Kirigami.Units.gridUnit

    // One hue for Claude's work (darker where several chats ran at once), the
    // text color for you, orange (as for a chat that needs you) for Claude
    // waiting on your answer
    readonly property color ink: Kirigami.Theme.textColor
    readonly property color grid: Qt.rgba(ink.r, ink.g, ink.b, 0.12)
    readonly property color youColor: Qt.rgba(ink.r, ink.g, ink.b, 0.45)
    readonly property color workColor: Kirigami.Theme.focusColor
    readonly property color waitColor: Kirigami.Theme.neutralTextColor

    readonly property real dayWidth: gu * 2.6
    readonly property real numWidth: gu * 2.9
    readonly property real youHeight: Math.round(gu * 0.25)
    readonly property real workHeight: Math.round(gu * 0.5)
    readonly property real laneGap: Math.round(gu * 0.15)
    property var hover: null   // what the mouse points at on the timeline: {row, x, ms}
    property string copied: ""   // a tip's command just copied

    readonly property var emptyDay: ({ day: "", start: 0, end: 1, you: [], work: [], wait: [], youMs: 0, workedMs: 0,
                                       busyMs: 0, waitMs: 0, prompts: 0, cost: 0 })
    readonly property var emptyProject: ({ name: "", path: "", host: "", workedMs: 0, cost: 0, prompts: 0, chats: 0 })
    readonly property var emptyModel: ({ model: "", cost: 0, tokens: 0, requests: 0, share: 0 })
    readonly property var emptyChat: ({ name: "", chatId: "", host: "", profileDir: "", folder: "", workedMs: 0, cost: 0,
                                        prompts: 0 })
    readonly property var emptyTip: ({ key: "", pct: null, title: "", detail: "", command: "" })

    // Fixed implicit size, as the Chats tab's list: deriving it from the
    // content would loop through the popup's width
    implicitWidth: gu * 28
    implicitHeight: gu * 26
    contentWidth: availableWidth
    contentHeight: sheet.implicitHeight
    PlasmaComponents3.ScrollBar.horizontal.policy: PlasmaComponents3.ScrollBar.AlwaysOff

    // 3h 05m, 45m: a week of work reads better in hours than in days
    function hours(ms) {
        const m = Math.round(Math.max(0, ms) / 60000)
        return m < 60 ? i18nc("duration in minutes", "%1m", m)
                      : i18nc("duration in hours and minutes", "%1h %2m", Math.floor(m / 60), m % 60)
    }

    function money(usd) {
        if (!usd)
            return "$0"
        if (usd < 0.01)
            return "<$0.01"
        return "$" + Number(usd).toLocaleString(Qt.locale(), "f", usd >= 100 ? 0 : 2)
    }

    function date(day) {
        const p = String(day).split("-").map(Number)
        return new Date(p[0], p[1] - 1, p[2])
    }

    function periodText() {
        if (!recap)
            return root.weekBack === 0 ? i18n("Last 7 days") : ""
        const span = i18nc("from day – to day", "%1 – %2", Qt.locale().toString(date(recap.from), "d MMM"),
                           Qt.locale().toString(date(recap.to), "d MMM"))
        return recap.back === 0 ? i18n("Last 7 days · %1", span) : span
    }

    // The change against the 7 days before: +4h 44m, −$12
    function deltaText(now, before, kind) {
        if (!previous)
            return ""
        const d = now - before
        const amount = kind === "time" ? hours(Math.abs(d)) : kind === "money" ? money(Math.abs(d)) : String(Math.abs(d))
        if (kind === "time" ? Math.abs(d) < 60000 : kind === "money" ? Math.abs(d) < 0.01 : d === 0)
            return i18nc("no change against the 7 days before", "same as before")
        return (d > 0 ? "+" : "−") + amount
    }

    function beforeText(before, kind) {
        return !previous ? "" : "\n" + i18n("The 7 days before: %1", kind === "time" ? hours(before) : kind === "money" ? money(before)
                                                                                                : String(before))
    }

    readonly property var tiles: !sum ? [] : [
        { label: i18n("You"), value: hours(sum.youMs), delta: deltaText(sum.youMs, previous ? previous.youMs : 0, "time"),
          tip: i18n("The time you spent writing to Claude, reading its replies and answering its questions, in all your chats and accounts: the time between your prompts and its replies counts when it's under 15 minutes.")
               + beforeText(previous ? previous.youMs : 0, "time") },
        { label: i18n("Claude worked"), value: hours(sum.workedMs),
          delta: deltaText(sum.workedMs, previous ? previous.workedMs : 0, "time"),
          tip: i18n("Claude's own count of its turns (its “Worked for …”), all chats added up: chats working at the same time each count. On the clock it worked %1, and it waited %2 for your answers.",
                    hours(sum.busyMs), hours(sum.waitMs)) + beforeText(previous ? previous.workedMs : 0, "time") },
        { label: i18n("At API prices"), value: money(sum.cost), delta: deltaText(sum.cost, previous ? previous.cost : 0, "money"),
          tip: i18n("What the same tokens would cost on Claude's API, at its list prices of %1. Your plan isn't billed this way: this is the value of what you used.",
                    recap.prices ? Qt.locale().toString(date(recap.prices.asOf), "d MMMM yyyy") : "")
               + beforeText(previous ? previous.cost : 0, "money") },
        { label: i18n("Prompts"), value: String(sum.prompts), delta: deltaText(sum.prompts, previous ? previous.prompts : 0, "count"),
          tip: i18np("In %1 chat", "In %1 chats", sum.chats) + " · " + i18np("%1 turn of Claude's", "%1 turns of Claude's", sum.turns)
               + beforeText(previous ? previous.prompts : 0, "count") }
    ]

    function factsText() {
        if (!sum)
            return ""
        const parts = []
        if (sum.longestTurn && sum.longestTurn.workedMs >= 60000)
            parts.push(i18n("longest turn %1 (%2)", hours(sum.longestTurn.workedMs), sum.longestTurn.name || "?"))
        if (sum.peakAtOnce > 1)
            parts.push(i18n("up to %1 chats at once", sum.peakAtOnce))
        if (sum.busiestDay)
            parts.push(i18n("busiest day %1", Qt.locale().toString(date(sum.busiestDay), "dddd")))
        if (sum.limits)
            parts.push(i18np("a usage limit stopped you once", "usage limits stopped you %1 times", sum.limits))
        return parts.join(" · ")
    }

    // What went on at the moment the mouse points at, on its day's row
    function hoverText() {
        if (!hover || !days[hover.row])
            return i18n("Point at a day to see what went on then.")
        const d = days[hover.row]
        const when = Qt.locale().toString(date(d.day), "ddd d MMM") + ", " + root.clockText(hover.ms) + ": "
        if (hover.ms > root.now)
            return when + i18n("still to come")
        const px = (d.end - d.start) / Math.max(1, timelineWidth)   // (a mark a pixel or two wide is hard to hit)
        const at = list => list.find(s => s[0] <= hover.ms && hover.ms < s[1])
                           || list.find(s => s[1] - s[0] < 3 * px && s[0] - 2 * px <= hover.ms && hover.ms < s[1] + 2 * px)
        const work = at(d.work), wait = at(d.wait), you = at(d.you)
        const span = s => root.clockText(s[0]) + "–" + root.clockText(s[1])
        const parts = []
        if (work)
            parts.push(work[2] > 1 ? i18n("Claude worked %1, %2 chats at once", span(work), work[2])
                                   : i18n("Claude worked %1", span(work)))
        else if (wait)
            parts.push(i18n("Claude waited for your answer %1", span(wait)))
        if (you)
            parts.push(i18n("you were at it %1", span(you)))
        return when + (parts.length ? parts.join(" · ") : i18n("nothing went on"))
    }
    property real timelineWidth: 0

    function tipIcon(key) {
        return key === "waits" ? "chronometer" : key === "limits" ? "speedometer" : "help-hint"
    }

    FontMetrics {
        id: smallMetrics
        font: Kirigami.Theme.smallFont
    }

    // (a hidden text field: QML has no clipboard of its own)
    TextEdit {
        id: clipboard
        visible: false
        function put(text) {
            clipboard.text = text
            clipboard.selectAll()
            clipboard.copy()
        }
    }

    Timer {
        id: copiedTimer
        interval: 2000
        onTriggered: view.copied = ""
    }

    Item {
        id: sheet
        width: view.availableWidth
        implicitHeight: page.implicitHeight + Kirigami.Units.largeSpacing

    ColumnLayout {
        id: page
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.leftMargin: Kirigami.Units.smallSpacing
        anchors.rightMargin: Kirigami.Units.smallSpacing
        spacing: Kirigami.Units.largeSpacing
        // (while it reads again: what it said before, dimmed, no jump)
        opacity: root.weekBusy && view.recap ? 0.6 : 1

        // The 7 days shown, a week back or on, and whose chats
        RowLayout {
            Layout.fillWidth: true
            Layout.topMargin: Kirigami.Units.smallSpacing
            spacing: Kirigami.Units.smallSpacing

            PlasmaComponents3.ToolButton {
                icon.name: "go-previous"
                display: PlasmaComponents3.AbstractButton.IconOnly
                text: i18n("The week before")
                enabled: root.weekBack < (view.recap ? view.recap.backMax : 0)
                onClicked: root.weekBack += 1

                PlasmaCore.ToolTipArea {
                    textFormat: Text.PlainText
                    anchors.fill: parent
                    mainText: i18n("The week before")
                }
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                horizontalAlignment: Text.AlignHCenter
                elide: Text.ElideRight
                font.bold: true
                text: view.periodText()
            }
            PlasmaComponents3.ToolButton {
                icon.name: "go-next"
                display: PlasmaComponents3.AbstractButton.IconOnly
                text: i18n("The week after")
                enabled: root.weekBack > 0
                onClicked: root.weekBack -= 1

                PlasmaCore.ToolTipArea {
                    textFormat: Text.PlainText
                    anchors.fill: parent
                    mainText: i18n("The week after")
                }
            }
        }

        // Whose chats: all, or one account's (a chat shared by hard links counts on each account that has it)
        Flow {
            Layout.fillWidth: true
            visible: view.accounts.length > 1
            spacing: Kirigami.Units.smallSpacing

            Repeater {
                model: view.accounts.length + 1
                delegate: PlasmaComponents3.ToolButton {
                    required property int index
                    readonly property var account: index > 0 ? view.accounts[index - 1] || null : null
                    readonly property string accountId: account ? account.id : ""
                    text: account ? account.name + (account.plan ? " · " + account.plan : "") : i18n("All accounts")
                    checkable: true
                    autoExclusive: true
                    checked: root.weekAccount === accountId
                    onClicked: root.weekAccount = accountId
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            visible: root.weekBusy && !view.recap
            spacing: Kirigami.Units.smallSpacing

            PlasmaComponents3.BusyIndicator {
                implicitWidth: Kirigami.Units.iconSizes.medium
                implicitHeight: Kirigami.Units.iconSizes.medium
                running: parent.visible
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                wrapMode: Text.Wrap
                text: i18n("Reading your chats of these days. The first time takes a few seconds; after that only what's new is read.")
                opacity: 0.8
            }
        }

        PlasmaComponents3.Label {
            textFormat: Text.PlainText
            Layout.fillWidth: true
            visible: root.weekError !== ""
            wrapMode: Text.Wrap
            color: Kirigami.Theme.negativeTextColor
            text: i18n("Couldn't read your week: %1", root.weekError)
        }

        PlasmaExtras.PlaceholderMessage {
            Layout.fillWidth: true
            visible: !!view.recap && !view.hasData
            iconName: "view-calendar-week"
            text: i18n("No Claude in these days")
            explanation: i18n("None of your chats here (or on the SSH hosts shown) has a prompt or a reply in these 7 days.")
        }

        // The numbers of the week, against the week before
        GridLayout {
            Layout.fillWidth: true
            visible: view.hasData
            columns: width > view.gu * 22 ? 4 : 2
            columnSpacing: Kirigami.Units.largeSpacing
            rowSpacing: Kirigami.Units.largeSpacing

            Repeater {
                model: view.tiles.length
                delegate: Item {
                    id: tile
                    required property int index
                    readonly property var info: view.tiles[index] || ({ label: "", value: "", delta: "", tip: "" })
                    Layout.fillWidth: true
                    Layout.preferredWidth: 1
                    implicitHeight: tileText.implicitHeight

                    ColumnLayout {
                        id: tileText
                        anchors.left: parent.left
                        anchors.right: parent.right
                        spacing: 0

                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.fillWidth: true
                            text: tile.info.label
                            elide: Text.ElideRight
                            font: Kirigami.Theme.smallFont
                            opacity: 0.7
                        }
                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.fillWidth: true
                            text: tile.info.value
                            elide: Text.ElideRight
                            font.pointSize: Kirigami.Theme.defaultFont.pointSize * 1.6
                            font.weight: Font.DemiBold
                        }
                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.fillWidth: true
                            visible: text !== ""
                            text: tile.info.delta
                            elide: Text.ElideRight
                            font: Kirigami.Theme.smallFont
                            opacity: 0.6
                        }
                    }
                    PlasmaCore.ToolTipArea {
                        textFormat: Text.PlainText
                        anchors.fill: parent
                        mainText: tile.info.label
                        subText: tile.info.tip
                    }
                }
            }
        }

        PlasmaComponents3.Label {
            textFormat: Text.PlainText
            Layout.fillWidth: true
            visible: view.hasData && text !== ""
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: view.factsText()
        }

        // A day per row: when you were at it, when Claude worked, when it waited for you
        ColumnLayout {
            Layout.fillWidth: true
            visible: view.hasData
            spacing: Math.round(view.gu * 0.2)

            RowLayout {
                Layout.fillWidth: true
                spacing: Kirigami.Units.largeSpacing

                Kirigami.Heading {
                    textFormat: Text.PlainText
                    level: 4
                    text: i18n("Day by day")
                }
                Item {
                    Layout.fillWidth: true
                }
                Repeater {
                    model: [[view.youColor, i18n("You")], [view.workColor, i18n("Claude working")],
                            [view.waitColor, i18n("Waiting for you")]]
                    delegate: RowLayout {
                        required property var modelData
                        spacing: Math.round(view.gu * 0.25)

                        Rectangle {
                            implicitWidth: Math.round(view.gu * 0.7)
                            implicitHeight: Math.round(view.gu * 0.35)
                            radius: 1
                            color: modelData[0]
                        }
                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            text: modelData[1]
                            font: Kirigami.Theme.smallFont
                            opacity: 0.8
                        }
                    }
                }
            }

            // The hours, and what the two columns are
            RowLayout {
                Layout.fillWidth: true
                spacing: Kirigami.Units.smallSpacing

                Item {
                    Layout.preferredWidth: view.dayWidth
                }
                Item {
                    id: axis
                    Layout.fillWidth: true
                    implicitHeight: smallMetrics.height
                    onWidthChanged: view.timelineWidth = width

                    Repeater {
                        model: [0, 6, 12, 18, 24]
                        delegate: PlasmaComponents3.Label {
                            required property int modelData
                            textFormat: Text.PlainText
                            x: Math.max(0, Math.min(axis.width - width, axis.width * modelData / 24 - width / 2))
                            text: String(modelData)
                            font: Kirigami.Theme.smallFont
                            opacity: 0.6
                        }
                    }
                }
                PlasmaComponents3.Label {
                    textFormat: Text.PlainText
                    Layout.preferredWidth: view.numWidth
                    horizontalAlignment: Text.AlignRight
                    text: i18n("You")
                    font: Kirigami.Theme.smallFont
                    opacity: 0.6
                }
                PlasmaComponents3.Label {
                    textFormat: Text.PlainText
                    Layout.preferredWidth: view.numWidth
                    horizontalAlignment: Text.AlignRight
                    text: i18n("Claude")
                    font: Kirigami.Theme.smallFont
                    opacity: 0.6
                }
            }

            Repeater {
                model: view.days.length
                delegate: RowLayout {
                    id: dayRow
                    required property int index
                    readonly property var day: view.days[index] || view.emptyDay
                    readonly property bool today: index === view.days.length - 1 && !!view.recap && view.recap.back === 0
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing

                    PlasmaComponents3.Label {
                        textFormat: Text.PlainText
                        Layout.preferredWidth: view.dayWidth
                        text: dayRow.day.day ? Qt.locale().toString(view.date(dayRow.day.day), "ddd d") : ""
                        elide: Text.ElideRight
                        font.pointSize: Kirigami.Theme.smallFont.pointSize
                        font.bold: dayRow.today
                        opacity: dayRow.today ? 0.9 : 0.7
                    }
                    Item {
                        id: track
                        readonly property real span: Math.max(1, dayRow.day.end - dayRow.day.start)
                        Layout.fillWidth: true
                        Layout.preferredHeight: view.youHeight + view.laneGap + view.workHeight + 2

                        function xOf(ms) {
                            return Math.max(0, Math.min(width, (ms - dayRow.day.start) / span * width))
                        }

                        // the quarters of the day
                        Repeater {
                            model: 3
                            delegate: Rectangle {
                                required property int index
                                x: Math.round(track.width * (index + 1) / 4)
                                width: 1
                                height: track.height
                                color: view.grid
                            }
                        }
                        Rectangle {
                            anchors.bottom: parent.bottom
                            width: parent.width
                            height: 1
                            color: view.grid
                        }
                        Repeater {
                            model: dayRow.day.you.length
                            delegate: Rectangle {
                                required property int index
                                readonly property var stretch: dayRow.day.you[index] || [0, 0]
                                x: track.xOf(stretch[0])
                                width: Math.max(1, track.xOf(stretch[1]) - x)
                                height: view.youHeight
                                radius: 1
                                color: view.youColor
                            }
                        }
                        Repeater {
                            model: dayRow.day.wait.length
                            delegate: Rectangle {
                                required property int index
                                readonly property var stretch: dayRow.day.wait[index] || [0, 0]
                                x: track.xOf(stretch[0])
                                y: view.youHeight + view.laneGap
                                width: Math.max(1, track.xOf(stretch[1]) - x)
                                height: view.workHeight
                                radius: 1
                                color: view.waitColor
                                opacity: 0.8
                            }
                        }
                        Repeater {
                            model: dayRow.day.work.length
                            delegate: Rectangle {
                                required property int index
                                readonly property var stretch: dayRow.day.work[index] || [0, 0, 1]
                                x: track.xOf(stretch[0])
                                y: view.youHeight + view.laneGap
                                width: Math.max(1, track.xOf(stretch[1]) - x)
                                height: view.workHeight
                                radius: 1
                                color: view.workColor
                                opacity: stretch[2] >= 3 ? 1 : stretch[2] === 2 ? 0.8 : 0.55
                            }
                        }
                        Rectangle {   // now
                            visible: dayRow.today
                            x: Math.round(track.xOf(root.now))
                            width: 1
                            height: track.height
                            color: view.ink
                            opacity: 0.6
                        }
                        Rectangle {   // where the mouse points
                            visible: !!view.hover && view.hover.row === dayRow.index
                            x: view.hover ? Math.round(view.hover.x) : 0
                            width: 1
                            height: track.height
                            color: view.ink
                            opacity: 0.5
                        }
                        MouseArea {
                            anchors.fill: parent
                            anchors.topMargin: -2
                            anchors.bottomMargin: -2
                            hoverEnabled: true
                            onPositionChanged: mouse => view.hover = { row: dayRow.index, x: mouse.x,
                                                                       ms: dayRow.day.start + mouse.x / Math.max(1, width) * track.span }
                            onExited: {
                                if (view.hover && view.hover.row === dayRow.index)
                                    view.hover = null
                            }
                        }
                    }
                    PlasmaComponents3.Label {
                        textFormat: Text.PlainText
                        Layout.preferredWidth: view.numWidth
                        horizontalAlignment: Text.AlignRight
                        text: dayRow.day.youMs >= 60000 ? view.hours(dayRow.day.youMs) : "–"
                        font: Kirigami.Theme.smallFont
                        opacity: 0.7
                    }
                    PlasmaComponents3.Label {
                        textFormat: Text.PlainText
                        Layout.preferredWidth: view.numWidth
                        horizontalAlignment: Text.AlignRight
                        text: dayRow.day.workedMs >= 60000 ? view.hours(dayRow.day.workedMs) : "–"
                        font: Kirigami.Theme.smallFont
                        opacity: 0.9

                        PlasmaCore.ToolTipArea {
                            textFormat: Text.PlainText
                            anchors.fill: parent
                            mainText: dayRow.day.day ? Qt.locale().toString(view.date(dayRow.day.day), "dddd d MMMM") : ""
                            subText: i18n("You: %1 · Claude worked %2 (on the clock %3) · it waited %4 for you",
                                          view.hours(dayRow.day.youMs), view.hours(dayRow.day.workedMs),
                                          view.hours(dayRow.day.busyMs), view.hours(dayRow.day.waitMs))
                                     + "\n" + i18np("%1 prompt", "%1 prompts", dayRow.day.prompts)
                                     + " · " + i18n("%1 at API prices", view.money(dayRow.day.cost))
                        }
                    }
                }
            }

            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                Layout.leftMargin: view.dayWidth + Kirigami.Units.smallSpacing
                elide: Text.ElideRight
                font: Kirigami.Theme.smallFont
                opacity: view.hover ? 0.9 : 0.5
                text: view.hoverText()
            }
        }

        // The project folders Claude worked in most (a chat started in a
        // subfolder of a repository counts for the repository)
        ColumnLayout {
            Layout.fillWidth: true
            visible: view.hasData && view.projects.length > 0
            spacing: Math.round(view.gu * 0.2)

            Kirigami.Heading {
                textFormat: Text.PlainText
                level: 4
                text: i18n("Where Claude worked")
            }
            Repeater {
                model: view.projects.length
                delegate: Item {
                    id: projectRow
                    required property int index
                    readonly property var project: view.projects[index] || view.emptyProject
                    Layout.fillWidth: true
                    implicitHeight: projectLine.implicitHeight

                    RowLayout {
                        id: projectLine
                        anchors.left: parent.left
                        anchors.right: parent.right
                        spacing: Kirigami.Units.smallSpacing

                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.preferredWidth: view.gu * 7
                            text: (projectRow.project.host ? projectRow.project.host + ": " : "") + projectRow.project.name
                            elide: Text.ElideMiddle
                        }
                        Item {
                            Layout.fillWidth: true
                            Layout.preferredHeight: Math.round(view.gu * 0.4)

                            Rectangle {
                                width: Math.max(2, parent.width * projectRow.project.workedMs / view.maxProject)
                                height: parent.height
                                radius: Math.min(2, height / 2)
                                color: view.workColor
                                opacity: 0.8
                            }
                        }
                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            text: view.hours(projectRow.project.workedMs) + " · " + view.money(projectRow.project.cost)
                            font: Kirigami.Theme.smallFont
                            opacity: 0.8
                        }
                    }
                    PlasmaCore.ToolTipArea {
                        textFormat: Text.PlainText
                        anchors.fill: parent
                        mainText: (projectRow.project.host ? projectRow.project.host + ": " : "") + projectRow.project.path
                        subText: i18n("Claude worked %1 · %2 at API prices", view.hours(projectRow.project.workedMs),
                                      view.money(projectRow.project.cost))
                                 + "\n" + i18np("%1 prompt", "%1 prompts", projectRow.project.prompts)
                                 + " · " + i18np("%1 chat", "%1 chats", projectRow.project.chats)
                    }
                }
            }
        }

        // The chats Claude worked on most: click one to bring it up
        ColumnLayout {
            Layout.fillWidth: true
            visible: view.hasData && view.chats.length > 0
            spacing: 0

            Kirigami.Heading {
                textFormat: Text.PlainText
                level: 4
                text: i18n("Chats it worked on most")
                Layout.bottomMargin: Math.round(view.gu * 0.2)
            }
            Repeater {
                model: view.chats.length
                delegate: PlasmaComponents3.ItemDelegate {
                    id: chatRow
                    required property int index
                    readonly property var chat: view.chats[index] || view.emptyChat
                    Layout.fillWidth: true
                    enabled: !chat.host   // (an SSH host's chat: its row in the Chats tab opens it)
                    onClicked: root.openChatById(chat.chatId, chat.profileDir, "", "", "", "")
                    contentItem: RowLayout {
                        spacing: Kirigami.Units.smallSpacing

                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.fillWidth: true
                            text: chatRow.chat.name
                            elide: Text.ElideRight
                        }
                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.maximumWidth: view.gu * 7
                            text: (chatRow.chat.host ? chatRow.chat.host + ": " : "") + chatRow.chat.folder
                            elide: Text.ElideMiddle
                            font: Kirigami.Theme.smallFont
                            opacity: 0.6
                        }
                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            text: view.hours(chatRow.chat.workedMs) + " · " + view.money(chatRow.chat.cost)
                            font: Kirigami.Theme.smallFont
                            opacity: 0.8
                        }
                    }
                }
            }
        }

        // What it'd cost on the API, by model, and what the cache saved
        ColumnLayout {
            Layout.fillWidth: true
            visible: view.hasData && view.models.length > 0
            spacing: Math.round(view.gu * 0.2)

            Kirigami.Heading {
                textFormat: Text.PlainText
                level: 4
                text: i18n("At API prices")
            }
            Repeater {
                model: view.models.length
                delegate: RowLayout {
                    id: modelRow
                    required property int index
                    readonly property var entry: view.models[index] || view.emptyModel
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing

                    PlasmaComponents3.Label {
                        textFormat: Text.PlainText
                        Layout.preferredWidth: view.gu * 7
                        text: modelRow.entry.model
                        elide: Text.ElideRight
                    }
                    Item {
                        Layout.fillWidth: true
                        Layout.preferredHeight: Math.round(view.gu * 0.4)

                        Rectangle {
                            width: Math.max(2, parent.width * modelRow.entry.share)
                            height: parent.height
                            radius: Math.min(2, height / 2)
                            color: view.youColor
                        }
                    }
                    PlasmaComponents3.Label {
                        textFormat: Text.PlainText
                        text: view.money(modelRow.entry.cost) + " · "
                              + (modelRow.entry.share < 0.01 ? "<1%" : Math.round(modelRow.entry.share * 100) + "%")
                        font: Kirigami.Theme.smallFont
                        opacity: 0.8
                    }
                }
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                visible: !!view.sum && view.sum.tokens.cacheRead > 0
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
                opacity: 0.7
                text: {
                    if (!view.sum)
                        return ""
                    const t = view.sum.tokens
                    const input = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h
                    return i18n("%1 of the %2 input tokens came from the cache: it saved %3. Claude wrote %4 tokens.",
                                Math.round(100 * t.cacheRead / Math.max(1, input)) + "%", root.formatTokens(input),
                                view.money(view.recap.cacheSaved), root.formatTokens(t.output))
                }
            }
        }

        // What would use less of your plan (Claude Code's /usage rules)
        ColumnLayout {
            Layout.fillWidth: true
            visible: view.hasData
            spacing: Kirigami.Units.smallSpacing

            Kirigami.Heading {
                textFormat: Text.PlainText
                level: 4
                text: i18n("What could use less of your plan")
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                visible: view.tips.length === 0
                wrapMode: Text.Wrap
                opacity: 0.7
                text: i18n("Nothing stands out: no habit takes a tenth of this week's usage.")
            }
            Repeater {
                model: view.tips.length
                delegate: RowLayout {
                    id: tipRow
                    required property int index
                    readonly property var tip: view.tips[index] || view.emptyTip
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing

                    Kirigami.Icon {
                        Layout.alignment: Qt.AlignTop
                        Layout.preferredWidth: Kirigami.Units.iconSizes.small
                        Layout.preferredHeight: Kirigami.Units.iconSizes.small
                        source: view.tipIcon(tipRow.tip.key)
                        opacity: 0.8
                    }
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 0

                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.fillWidth: true
                            wrapMode: Text.Wrap
                            text: tipRow.tip.title
                        }
                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.fillWidth: true
                            visible: text !== ""
                            wrapMode: Text.Wrap
                            text: tipRow.tip.detail
                            font: Kirigami.Theme.smallFont
                            opacity: 0.7
                        }
                    }
                    PlasmaComponents3.Label {
                        textFormat: Text.PlainText
                        Layout.alignment: Qt.AlignTop
                        visible: tipRow.tip.pct !== null && tipRow.tip.pct !== undefined
                        text: (tipRow.tip.pct || 0) + "%"
                        font: Kirigami.Theme.smallFont
                        opacity: 0.8

                        PlasmaCore.ToolTipArea {
                            textFormat: Text.PlainText
                            anchors.fill: parent
                            mainText: i18n("%1% of this week's usage", tipRow.tip.pct || 0)
                            subText: i18n("Of the usage of these 7 days, as Claude Code's /usage weighs it toward your plan's limits. A request can count for several of these.")
                        }
                    }
                    PlasmaComponents3.ToolButton {
                        Layout.alignment: Qt.AlignTop
                        visible: tipRow.tip.command !== ""
                        text: view.copied === tipRow.tip.command && tipRow.tip.command ? i18n("Copied") : tipRow.tip.command
                        font.family: "monospace"
                        font.pointSize: Kirigami.Theme.smallFont.pointSize
                        onClicked: {
                            clipboard.put(tipRow.tip.command)
                            view.copied = tipRow.tip.command
                            copiedTimer.restart()
                        }

                        PlasmaCore.ToolTipArea {
                            textFormat: Text.PlainText
                            anchors.fill: parent
                            mainText: i18n("Copy %1", tipRow.tip.command)
                            subText: i18n("Type it in a chat of yours.")
                        }
                    }
                }
            }
        }

        // Where it all comes from
        PlasmaComponents3.Label {
            textFormat: Text.PlainText
            Layout.fillWidth: true
            visible: !!view.recap
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.55
            text: {
                if (!view.recap)
                    return ""
                const failed = view.recap.sources.filter(s => !s.ok)
                let text = i18n("Read from the chats on this computer%1, without using any tokens. Prices: Claude's API list prices of %2%3.",
                                root.shownHosts.length ? i18n(" and on %1", root.shownHosts.join(", ")) : "",
                                Qt.locale().toString(view.date(view.recap.prices.asOf), "d MMM yyyy"),
                                view.recap.prices.guessed.length
                                    ? i18n(" (%1 at the price of its family's newest model)", view.recap.prices.guessed.join(", ")) : "")
                for (const s of failed)
                    text += "\n" + i18n("%1 couldn't be read: %2", s.host, s.error)
                return text
            }
        }
    }
    }
}
