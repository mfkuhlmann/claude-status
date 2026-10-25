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
    readonly property var trend: recap && recap.trend ? recap.trend : []
    readonly property var plan: recap && recap.plan ? recap.plan : []
    readonly property var spend: recap && recap.spend ? recap.spend : null
    readonly property var work: recap && recap.work ? recap.work : null
    readonly property var prompts: recap && recap.prompts ? recap.prompts : null
    readonly property var granted: recap && recap.granted ? recap.granted : []
    readonly property var currency: recap && recap.currency ? recap.currency : ({ code: "USD", rate: 1, date: "", error: "" })
    readonly property bool hasData: !!sum && (sum.workedMs > 0 || sum.prompts > 0 || sum.cost > 0)
    readonly property real maxProject: Math.max(1, ...projects.map(p => p.workedMs))
    readonly property real gu: Kirigami.Units.gridUnit
    property string openDay: ""       // the day whose chats are unfolded
    property string openProject: ""   // the project folder whose chats are unfolded: host|path
    property string confirmRule: ""   // the rule whose Allow asks first: its id
    property string confirmGrant: ""  // the permission whose Revoke asks first: its id
    property bool allGranted: false   // all the permissions you gave shown, not the first few
    readonly property int grantedFew: 8

    // One hue for Claude's work (darker where several chats ran at once), the
    // text color for you, orange (as for a chat that needs you) for Claude
    // waiting on your answer
    readonly property color ink: Kirigami.Theme.textColor
    readonly property color grid: Qt.rgba(ink.r, ink.g, ink.b, 0.12)
    readonly property color youColor: Qt.rgba(ink.r, ink.g, ink.b, 0.45)
    readonly property color workColor: Kirigami.Theme.focusColor
    readonly property color waitColor: Kirigami.Theme.neutralTextColor
    readonly property color limitColor: Kirigami.Theme.negativeTextColor

    readonly property real dayWidth: gu * 2.6
    readonly property real numWidth: gu * 2.9
    readonly property real youHeight: Math.round(gu * 0.25)
    readonly property real workHeight: Math.round(gu * 0.5)
    readonly property real laneGap: Math.round(gu * 0.15)
    property var hover: null   // what the mouse points at on the timeline: {row, x, ms}
    property string copied: ""   // a tip's command just copied

    readonly property var emptyDay: ({ day: "", start: 0, end: 1, you: [], work: [], wait: [], limits: [], youMs: 0,
                                       workedMs: 0, busyMs: 0, waitMs: 0, prompts: 0, cost: 0, chats: [] })
    readonly property var emptyProject: ({ name: "", path: "", host: "", workedMs: 0, cost: 0, prompts: 0, chats: [],
                                           chatCount: 0 })
    readonly property var emptyRule: ({ kind: "", value: "", project: "", count: 0, waitMs: 0, example: "", id: "",
                                        state: "", title: "", change: "" })
    readonly property var emptyGrant: ({ id: "", kind: "", value: "", title: "", place: "", where: "", shared: false,
                                         added: false, change: "" })
    readonly property var emptyWindow: ({ key: "", label: "", resetsAt: 0, pct: 0, points: [] })
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

    // A permission you gave: a folder, a mode, a command, the web
    function grantIcon(g) {
        if (g.kind === "dir")
            return "folder-open"
        if (g.kind === "mode")
            return g.value === "acceptEdits" ? "document-edit" : "security-low"
        if (g.value.indexOf("WebFetch") === 0 || g.value === "WebSearch")
            return "globe"
        return g.value.indexOf("Bash") === 0 ? "utilities-terminal" : "checkmark"
    }

    // What a plan window's bar says beside it: "45% · resets 20:10"
    function planText(win) {
        return Math.round(win.pct) + "%" + (win.resetsAt ? " · " + resetText(win.resetsAt) : "")
    }

    // A section's title: big and bold, under a line that sets the section
    // off from the one before
    component SectionTitle: ColumnLayout {
        property alias text: title.text
        Layout.fillWidth: true
        Layout.topMargin: Math.round(view.gu * 0.7)
        spacing: Math.round(view.gu * 0.35)

        Kirigami.Separator {
            Layout.fillWidth: true
        }
        Kirigami.Heading {
            id: title
            Layout.fillWidth: true
            textFormat: Text.PlainText
            level: 2
            font.weight: Font.Bold
            wrapMode: Text.Wrap
        }
    }

    // 3h 05m, 45m: a week of work reads better in hours than in days
    function hours(ms) {
        const m = Math.round(Math.max(0, ms) / 60000)
        return m < 60 ? i18nc("duration in minutes", "%1m", m)
                      : i18nc("duration in hours and minutes", "%1h %2m", Math.floor(m / 60), m % 60)
    }

    // An amount of US dollars in the currency picked in the settings (week.py
    // sends the European Central Bank's rate of the day)
    readonly property var symbols: ({ USD: "$", EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", INR: "₹", KRW: "₩", ILS: "₪",
                                      TRY: "₺", PHP: "₱", THB: "฿" })
    readonly property var wholeUnits: ["JPY", "KRW", "HUF", "ISK", "IDR"]

    function money(usd) {
        const amount = (usd || 0) * currency.rate
        const symbol = symbols[currency.code]
        const put = text => symbol ? symbol + text : text + " " + currency.code
        if (!amount)
            return put("0")
        const whole = amount >= 100 || wholeUnits.indexOf(currency.code) >= 0
        if (amount < (whole ? 1 : 0.01))
            return "<" + put(whole ? "1" : Number(0.01).toLocaleString(Qt.locale(), "f", 2))
        return put(Number(amount).toLocaleString(Qt.locale(), "f", whole ? 0 : 2))
    }

    function count(n) {
        return Number(n || 0).toLocaleString(Qt.locale(), "f", 0)
    }

    // Wed 14:05
    function whenText(ms) {
        return Qt.locale().toString(new Date(ms), "ddd") + " " + root.clockText(ms)
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

    // The same number over the 5 weeks up to these days (a week older than
    // the widget keeps: unknown)
    function trendText(key, kind) {
        if (trend.length < 2)
            return ""
        const shown = trend.map(w => !w ? "?" : kind === "time" ? hours(w[key]) : kind === "money" ? money(w[key])
                                                                                                  : String(w[key]))
        return "\n" + i18n("Week by week, these 7 days last: %1", shown.join(" · "))
    }

    readonly property var tiles: !sum ? [] : [
        { label: i18n("You"), key: "youMs", value: hours(sum.youMs),
          delta: deltaText(sum.youMs, previous ? previous.youMs : 0, "time"),
          tip: i18n("The time you spent writing to Claude, reading its replies and answering its questions, in all your chats and accounts: the time between your prompts and its replies counts when it's under 15 minutes.")
               + beforeText(previous ? previous.youMs : 0, "time") + trendText("youMs", "time") },
        { label: i18n("Claude worked"), key: "workedMs", value: hours(sum.workedMs),
          delta: deltaText(sum.workedMs, previous ? previous.workedMs : 0, "time"),
          tip: i18n("Claude's own count of its turns (its “Worked for …”), all chats added up: chats working at the same time each count. On the clock it worked %1, and it waited %2 for your answers.",
                    hours(sum.busyMs), hours(sum.waitMs)) + beforeText(previous ? previous.workedMs : 0, "time")
               + trendText("workedMs", "time") },
        { label: i18n("At API prices"), key: "cost", value: money(sum.cost),
          delta: deltaText(sum.cost, previous ? previous.cost : 0, "money"),
          tip: i18n("What the same tokens would cost on Claude's API, at its list prices of %1. Your plan isn't billed this way: this is the value of what you used.",
                    recap.prices ? Qt.locale().toString(date(recap.prices.asOf), "d MMMM yyyy") : "")
               + beforeText(previous ? previous.cost : 0, "money") + trendText("cost", "money") },
        { label: i18n("Prompts"), key: "prompts", value: String(sum.prompts),
          delta: deltaText(sum.prompts, previous ? previous.prompts : 0, "count"),
          tip: i18np("In %1 chat", "In %1 chats", sum.chats) + " · " + i18np("%1 turn of Claude's", "%1 turns of Claude's", sum.turns)
               + beforeText(previous ? previous.prompts : 0, "count") + trendText("prompts", "count") }
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
            return i18n("Point at a day to see what went on then; click it for its chats.")
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
        const limit = (d.limits || []).find(t => Math.abs(t - hover.ms) <= 3 * px)
        if (limit)
            parts.unshift(i18n("a usage limit stopped a chat at %1", root.clockText(limit)))
        return when + (parts.length ? parts.join(" · ") : i18n("nothing went on"))
    }

    // What Claude did, in a line: its tool calls, commands, edits, subagents
    function workText() {
        if (!work || !work.toolCalls)
            return ""
        const parts = [i18np("%1 tool call", "%1 tool calls", work.toolCalls)]
        if (work.commands)
            parts.push(i18np("%1 command run", "%1 commands run", work.commands))
        if (work.edits)
            parts.push(i18np("%1 edit", "%1 edits", work.edits) + " "
                       + i18np("in %1 file", "in %1 files", work.files)
                       + " (+" + count(work.linesAdded) + " −" + count(work.linesRemoved) + ")")
        if (work.subagents)
            parts.push(i18np("%1 subagent started", "%1 subagents started", work.subagents))
        if (work.webSearches)
            parts.push(i18np("%1 web search", "%1 web searches", work.webSearches))
        if (work.webFetches)
            parts.push(i18np("%1 page fetched", "%1 pages fetched", work.webFetches))
        if (work.compactions)
            parts.push(i18np("%1 compaction", "%1 compactions", work.compactions))
        return parts.join(" · ")
    }

    // A plan window's color: as its bar in the Chats tab
    function planColor(pct) {
        return pct >= 90 ? Kirigami.Theme.negativeTextColor : pct >= 70 ? Kirigami.Theme.neutralTextColor : workColor
    }

    readonly property var windowMs: ({ five_hour: 5 * 3600000, seven_day: 7 * 86400000, seven_day_opus: 7 * 86400000,
                                       seven_day_sonnet: 7 * 86400000 })

    function resetText(ms) {
        if (!ms)
            return ""
        return ms - root.now < 86400000 ? i18n("resets %1", root.clockText(ms)) : i18n("resets %1", whenText(ms))
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
                    readonly property var info: view.tiles[index] || ({ label: "", key: "", value: "", delta: "", tip: "" })
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
                        // the last 5 weeks, these 7 days last (a week the widget no longer has: a dot)
                        Row {
                            id: trendBars
                            readonly property var values: view.trend.map(w => w ? (w[tile.info.key] || 0) : null)
                            readonly property real highest: Math.max(1e-9, ...values.filter(v => v !== null))
                            Layout.topMargin: Math.round(view.gu * 0.2)
                            visible: view.trend.length > 1
                            spacing: Math.max(1, Math.round(view.gu * 0.12))

                            Repeater {
                                model: trendBars.values.length
                                delegate: Item {
                                    required property int index
                                    readonly property var value: trendBars.values[index]
                                    width: Math.round(view.gu * 0.5)
                                    height: Math.round(view.gu * 0.8)

                                    Rectangle {
                                        anchors.bottom: parent.bottom
                                        width: parent.width
                                        height: parent.value === null ? width : Math.max(1, parent.height * parent.value / trendBars.highest)
                                        radius: parent.value === null ? width / 2 : 1
                                        color: parent.index === trendBars.values.length - 1 ? view.workColor : view.youColor
                                        opacity: parent.value === null ? 0.3 : 1
                                    }
                                }
                            }
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

            SectionTitle {
                text: i18n("Day by day")
            }
            Flow {
                Layout.fillWidth: true
                spacing: Kirigami.Units.largeSpacing

                Repeater {
                    model: [[view.youColor, i18n("You")], [view.workColor, i18n("Claude working")],
                            [view.waitColor, i18n("Waiting for you")]].concat(
                               view.days.some(d => d.limits && d.limits.length) ? [[view.limitColor, i18n("A usage limit stopped a chat"), true]] : [])
                    delegate: RowLayout {
                        required property var modelData
                        spacing: Math.round(view.gu * 0.25)

                        Rectangle {
                            implicitWidth: modelData[2] ? 2 : Math.round(view.gu * 0.7)
                            implicitHeight: Math.round(view.gu * (modelData[2] ? 0.7 : 0.35))
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
                delegate: ColumnLayout {
                    id: dayRow
                    required property int index
                    readonly property var day: view.days[index] || view.emptyDay
                    readonly property bool today: index === view.days.length - 1 && !!view.recap && view.recap.back === 0
                    readonly property bool open: view.openDay !== "" && view.openDay === day.day
                    Layout.fillWidth: true
                    spacing: 0

                    function toggle() {
                        view.openDay = open || !day.chats.length ? "" : day.day
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Kirigami.Units.smallSpacing

                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.preferredWidth: view.dayWidth
                            text: dayRow.day.day ? Qt.locale().toString(view.date(dayRow.day.day), "ddd d") : ""
                            elide: Text.ElideRight
                            font.pointSize: Kirigami.Theme.smallFont.pointSize
                            font.bold: dayRow.today || dayRow.open
                            opacity: dayRow.today || dayRow.open ? 0.9 : 0.7

                            MouseArea {
                                anchors.fill: parent
                                cursorShape: dayRow.day.chats.length ? Qt.PointingHandCursor : Qt.ArrowCursor
                                onClicked: dayRow.toggle()
                            }
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
                            Repeater {   // where a usage limit stopped a chat
                                model: dayRow.day.limits ? dayRow.day.limits.length : 0
                                delegate: Rectangle {
                                    required property int index
                                    x: Math.round(track.xOf(dayRow.day.limits[index] || 0)) - 1
                                    width: 2
                                    height: track.height
                                    color: view.limitColor
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
                                cursorShape: dayRow.day.chats.length ? Qt.PointingHandCursor : Qt.ArrowCursor
                                onClicked: dayRow.toggle()
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

                    // the day's chats, unfolded with a click on its row
                    Repeater {
                        model: dayRow.open ? dayRow.day.chats.length : 0
                        delegate: WeekChatLine {
                            required property int index
                            chat: dayRow.day.chats[index] || view.emptyChat
                            indent: view.dayWidth
                            numbers: view.hours(chat.workedMs) + " · " + view.money(chat.cost)
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

        // How full your plan's windows are now, and how they filled up
        // (the widget's usage history); a limit that stopped a chat is a
        // red mark on the days above
        ColumnLayout {
            id: planSection
            Layout.fillWidth: true
            visible: view.hasData && view.plan.length > 0
            spacing: Math.round(view.gu * 0.2)
            // (the widest text beside the bars, for all of them: the bars get one length)
            readonly property real textWidth: {
                let w = 0
                for (const a of view.plan)
                    for (const win of a.windows)
                        w = Math.max(w, planFont.advanceWidth(view.planText(win)))
                return Math.ceil(w)
            }

            FontMetrics {
                id: planFont
                font: Kirigami.Theme.smallFont
            }
            SectionTitle {
                text: i18n("Your plan's limits now")
            }
            Repeater {
                model: view.plan.length
                delegate: ColumnLayout {
                    id: planAccount
                    required property int index
                    readonly property var account: view.plan[index] || ({ name: "", windows: [] })
                    Layout.fillWidth: true
                    spacing: Math.round(view.gu * 0.2)

                    Repeater {
                        model: planAccount.account.windows.length
                        delegate: RowLayout {
                            id: planRow
                            required property int index
                            readonly property var win: planAccount.account.windows[index] || view.emptyWindow
                            readonly property real from: win.resetsAt && view.windowMs[win.key] ? win.resetsAt - view.windowMs[win.key]
                                                                                              : (win.points.length ? win.points[0][0] : 0)
                            readonly property real until: Math.max(win.resetsAt || 0, from + 1)
                            Layout.fillWidth: true
                            spacing: Kirigami.Units.smallSpacing

                            PlasmaComponents3.Label {
                                textFormat: Text.PlainText
                                Layout.preferredWidth: view.gu * 7
                                text: (view.plan.length > 1 ? planAccount.account.name + " · " : "") + planRow.win.label
                                elide: Text.ElideRight
                            }
                            // how the window filled up, from its start to its reset
                            Canvas {
                                id: fillChart
                                Layout.fillWidth: true
                                Layout.preferredHeight: Math.round(view.gu * 1.1)
                                readonly property color lineColor: view.planColor(planRow.win.pct)
                                onWidthChanged: requestPaint()
                                onHeightChanged: requestPaint()
                                onLineColorChanged: requestPaint()
                                Connections {
                                    target: planRow
                                    function onWinChanged() {
                                        fillChart.requestPaint()
                                    }
                                }
                                onPaint: {
                                    const ctx = getContext("2d")
                                    ctx.reset()
                                    const w = width, h = height
                                    const x = ms => Math.max(0, Math.min(w, (ms - planRow.from) / (planRow.until - planRow.from) * w))
                                    const y = pct => h - 0.5 - Math.max(0, Math.min(100, pct)) / 100 * (h - 1)
                                    ctx.fillStyle = Qt.rgba(view.ink.r, view.ink.g, view.ink.b, 0.06)
                                    ctx.fillRect(0, 0, w, h)
                                    const points = planRow.win.points.filter(p => p[0] >= planRow.from)
                                    if (!points.length)
                                        return
                                    const end = Math.min(root.now, planRow.until)
                                    ctx.beginPath()
                                    ctx.moveTo(x(points[0][0]), h)
                                    for (const p of points)
                                        ctx.lineTo(x(p[0]), y(p[1]))
                                    ctx.lineTo(x(end), y(points[points.length - 1][1]))
                                    ctx.lineTo(x(end), h)
                                    ctx.closePath()
                                    const c = lineColor
                                    ctx.fillStyle = Qt.rgba(c.r, c.g, c.b, 0.3)
                                    ctx.fill()
                                    ctx.beginPath()
                                    ctx.moveTo(x(points[0][0]), y(points[0][1]))
                                    for (const p of points)
                                        ctx.lineTo(x(p[0]), y(p[1]))
                                    ctx.lineTo(x(end), y(points[points.length - 1][1]))
                                    ctx.strokeStyle = c
                                    ctx.lineWidth = 1.5
                                    ctx.stroke()
                                }

                                PlasmaCore.ToolTipArea {
                                    textFormat: Text.PlainText
                                    anchors.fill: parent
                                    mainText: i18n("%1: %2% used", planRow.win.label, Math.round(planRow.win.pct))
                                    subText: i18n("How this window of your plan filled up, from its start (on the left) to when it resets (on the right), as the widget saw it.")
                                }
                            }
                            PlasmaComponents3.Label {
                                textFormat: Text.PlainText
                                Layout.preferredWidth: planSection.textWidth
                                text: view.planText(planRow.win)
                                font: Kirigami.Theme.smallFont
                                color: planRow.win.pct >= 90 ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.textColor
                                opacity: 0.8
                            }
                        }
                    }
                }
            }
        }

        // The project folders Claude worked in most (a chat started in a
        // subfolder of a repository counts for the repository): click one
        // for its chats
        ColumnLayout {
            Layout.fillWidth: true
            visible: view.hasData && view.projects.length > 0
            spacing: Math.round(view.gu * 0.2)

            SectionTitle {
                text: i18n("Where Claude worked")
            }
            Repeater {
                model: view.projects.length
                delegate: ColumnLayout {
                    id: projectRow
                    required property int index
                    readonly property var project: view.projects[index] || view.emptyProject
                    readonly property string key: project.host + "|" + project.path
                    readonly property bool open: view.openProject === key
                    Layout.fillWidth: true
                    spacing: 0

                    Item {
                        Layout.fillWidth: true
                        implicitHeight: projectLine.implicitHeight

                        RowLayout {
                            id: projectLine
                            anchors.left: parent.left
                            anchors.right: parent.right
                            spacing: Kirigami.Units.smallSpacing

                            Kirigami.Icon {
                                Layout.preferredWidth: Kirigami.Units.iconSizes.small
                                Layout.preferredHeight: Kirigami.Units.iconSizes.small
                                source: projectRow.open ? "arrow-down" : (Qt.application.layoutDirection === Qt.RightToLeft ? "arrow-left" : "arrow-right")
                                opacity: 0.6
                            }
                            PlasmaComponents3.Label {
                                textFormat: Text.PlainText
                                Layout.preferredWidth: view.gu * 6
                                text: (projectRow.project.host ? projectRow.project.host + ": " : "") + projectRow.project.name
                                elide: Text.ElideMiddle
                                font.bold: projectRow.open
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
                        MouseArea {
                            anchors.fill: parent
                            cursorShape: Qt.PointingHandCursor
                            onClicked: view.openProject = projectRow.open ? "" : projectRow.key

                            PlasmaCore.ToolTipArea {
                                textFormat: Text.PlainText
                                anchors.fill: parent
                                mainText: (projectRow.project.host ? projectRow.project.host + ": " : "") + projectRow.project.path
                                subText: i18n("Claude worked %1 · %2 at API prices", view.hours(projectRow.project.workedMs),
                                              view.money(projectRow.project.cost))
                                         + "\n" + i18np("%1 prompt", "%1 prompts", projectRow.project.prompts)
                                         + " · " + i18np("%1 chat", "%1 chats", projectRow.project.chatCount)
                            }
                        }
                    }
                    Repeater {
                        model: projectRow.open ? projectRow.project.chats.length : 0
                        delegate: WeekChatLine {
                            required property int index
                            chat: projectRow.project.chats[index] || view.emptyChat
                            where: ""
                            indent: Kirigami.Units.iconSizes.small + Kirigami.Units.smallSpacing
                            numbers: view.hours(chat.workedMs) + " · " + view.money(chat.cost)
                        }
                    }
                    PlasmaComponents3.Label {
                        textFormat: Text.PlainText
                        Layout.fillWidth: true
                        Layout.leftMargin: Kirigami.Units.iconSizes.small + Kirigami.Units.smallSpacing * 2
                        visible: projectRow.open && projectRow.project.chatCount > projectRow.project.chats.length
                        text: i18np("and %1 more chat", "and %1 more chats",
                                    projectRow.project.chatCount - projectRow.project.chats.length)
                        font: Kirigami.Theme.smallFont
                        opacity: 0.6
                    }
                }
            }
        }

        // The chats Claude worked on most: click one to bring it up
        ColumnLayout {
            Layout.fillWidth: true
            visible: view.hasData && view.chats.length > 0
            spacing: 0

            SectionTitle {
                text: i18n("Chats it worked on most")
                Layout.bottomMargin: Math.round(view.gu * 0.2)
            }
            Repeater {
                model: view.chats.length
                delegate: WeekChatLine {
                    required property int index
                    chat: view.chats[index] || view.emptyChat
                    numbers: view.hours(chat.workedMs) + " · " + view.money(chat.cost)
                }
            }
        }

        // What Claude did: its tool calls, commands, edits, subagents
        ColumnLayout {
            Layout.fillWidth: true
            visible: view.hasData && !!view.work && view.work.toolCalls > 0
            spacing: Math.round(view.gu * 0.2)

            SectionTitle {
                text: i18n("What Claude did")
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                wrapMode: Text.Wrap
                text: view.workText()
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                visible: !!view.work && view.work.tools.length > 0
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
                opacity: 0.7
                text: !view.work ? "" : i18n("Its tools: %1", view.work.tools.map(t => t[0] + " " + view.count(t[1])).join(" · "))
            }
        }

        // What it'd cost on the API, by model, and what the cache saved
        ColumnLayout {
            Layout.fillWidth: true
            visible: view.hasData && view.models.length > 0
            spacing: Math.round(view.gu * 0.2)

            SectionTitle {
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

        // Where the money went: the turns that cost most, the chats, and
        // coming back to chats whose cache had expired
        ColumnLayout {
            Layout.fillWidth: true
            visible: view.hasData && !!view.spend && (view.spend.turns.length > 0 || view.spend.cold.count > 0)
            spacing: 0

            SectionTitle {
                text: i18n("Turns that cost the most")
                visible: !!view.spend && view.spend.turns.length > 0
                Layout.bottomMargin: Math.round(view.gu * 0.2)
            }
            Repeater {
                model: view.spend ? view.spend.turns.length : 0
                delegate: WeekChatLine {
                    required property int index
                    chat: view.spend.turns[index] || view.emptyChat
                    where: chat.startedAt ? view.whenText(chat.startedAt) : ""
                    numbers: view.hours(chat.workedMs) + " · " + view.money(chat.cost)
                }
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                Layout.topMargin: Math.round(view.gu * 0.2)
                visible: !!view.spend && view.spend.chats.length > 0
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
                opacity: 0.7
                text: !view.spend ? "" : i18n("Costliest chats: %1", view.spend.chats.map(c => c.name + " " + view.money(c.cost)).join(" · "))
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                Layout.topMargin: Math.round(view.gu * 0.2)
                visible: !!view.spend && view.spend.cold.count > 0
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
                opacity: 0.7
                text: {
                    if (!view.spend || !view.spend.cold.count)
                        return ""
                    const cold = view.spend.cold
                    return i18np("You came back to a chat after its cache had expired (an hour without a reply) once: writing its context again cost %2 more than reading it from the cache.",
                                 "You came back to chats after their cache had expired (an hour without a reply) %1 times: writing their context again cost %2 more than reading it from the cache.",
                                 cold.count, view.money(cold.cost))
                           + (cold.chats.length ? " " + i18n("Most in: %1.", cold.chats.map(c => i18n("%1 (%2×, %3)", c.name, c.resumes, view.money(c.cost))).join(", ")) : "")
                }
            }
        }

        // What would use less of your plan (Claude Code's /usage rules)
        ColumnLayout {
            Layout.fillWidth: true
            visible: view.hasData
            spacing: Kirigami.Units.smallSpacing

            SectionTitle {
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

        // The permission prompts you answered, and the rules that would have
        // let the most of them through (written only when you allow one)
        ColumnLayout {
            Layout.fillWidth: true
            visible: view.hasData && !!view.prompts && view.prompts.answered > 0
            spacing: Math.round(view.gu * 0.2)

            SectionTitle {
                text: i18n("Permission prompts")
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                wrapMode: Text.Wrap
                text: {
                    const p = view.prompts
                    if (!p)
                        return ""
                    let text = p.refused ? i18np("You answered %1 permission prompt and refused %2 of them.", "You answered %1 permission prompts and refused %2 of them.", p.answered, p.refused)
                                         : i18np("You answered %1 permission prompt.", "You answered %1 permission prompts.", p.answered)
                    if (p.waitMs >= 60000)
                        text += " " + i18n("They waited for your answer %1 in all.", view.hours(p.waitMs))
                    return text
                }
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                visible: !!view.prompts && view.prompts.byTool.length > 0
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
                opacity: 0.7
                text: !view.prompts ? "" : i18n("For: %1", view.prompts.byTool.map(t => t[0] + " " + t[1]).join(" · "))
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                visible: root.weekRules && !!view.prompts && view.prompts.rules.length > 0
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
                opacity: 0.7
                text: i18n("These rules would have let the most of them through. One you allow goes into the .claude/settings.local.json of the folder the chats started in (not shared through git), and only chats started there follow it.")
            }
            Repeater {
                model: root.weekRules && view.prompts ? view.prompts.rules.length : 0   // (the settings can leave them out)
                delegate: ColumnLayout {
                    id: ruleRow
                    required property int index
                    readonly property var rule: view.prompts.rules[index] || view.emptyRule
                    readonly property bool asking: view.confirmRule !== "" && view.confirmRule === rule.id
                    readonly property bool busy: root.weekRuleBusy !== "" && root.weekRuleBusy === rule.id
                    Layout.fillWidth: true
                    spacing: Math.round(view.gu * 0.2)

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Kirigami.Units.smallSpacing

                        Kirigami.Icon {
                            Layout.alignment: Qt.AlignTop
                            Layout.preferredWidth: Kirigami.Units.iconSizes.small
                            Layout.preferredHeight: Kirigami.Units.iconSizes.small
                            source: ruleRow.rule.kind === "dir" ? "folder-open" : ruleRow.rule.kind === "edits" ? "document-edit"
                                  : ruleRow.rule.value.indexOf("WebFetch") === 0 ? "globe" : "utilities-terminal"
                            opacity: 0.8
                        }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 0

                            PlasmaComponents3.Label {
                                textFormat: Text.PlainText
                                Layout.fillWidth: true
                                wrapMode: Text.Wrap
                                text: ruleRow.rule.title
                            }
                            PlasmaComponents3.Label {
                                textFormat: Text.PlainText
                                Layout.fillWidth: true
                                wrapMode: Text.Wrap
                                maximumLineCount: 2
                                elide: Text.ElideRight
                                text: i18np("%1 prompt", "%1 prompts", ruleRow.rule.count)
                                      + (ruleRow.rule.waitMs >= 60000 ? " · " + i18n("waited %1 for you", view.hours(ruleRow.rule.waitMs)) : "")
                                      + " · " + i18n("e.g. %1", ruleRow.rule.example)
                                font: Kirigami.Theme.smallFont
                                opacity: 0.7
                            }
                        }
                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.alignment: Qt.AlignTop
                            visible: ruleRow.rule.state === "allowed"
                            text: i18n("Allowed now")
                            font: Kirigami.Theme.smallFont
                            opacity: 0.7
                        }
                        PlasmaComponents3.Button {
                            Layout.alignment: Qt.AlignTop
                            visible: ruleRow.rule.state === "new" && !ruleRow.asking
                            enabled: root.weekRuleBusy === ""
                            text: i18n("Allow…")
                            onClicked: view.confirmRule = ruleRow.rule.id
                        }
                        PlasmaComponents3.Button {
                            Layout.alignment: Qt.AlignTop
                            visible: ruleRow.rule.state === "added"
                            enabled: root.weekRuleBusy === ""
                            icon.name: "edit-undo"
                            text: i18n("Undo")
                            onClicked: root.changeWeekRule(ruleRow.rule, false)

                            PlasmaCore.ToolTipArea {
                                textFormat: Text.PlainText
                                anchors.fill: parent
                                mainText: i18n("Take this rule back")
                                subText: i18n("You allowed it here: Undo removes it from the file it went into, as it was before.")
                            }
                        }
                        PlasmaComponents3.BusyIndicator {
                            Layout.alignment: Qt.AlignTop
                            Layout.preferredWidth: Kirigami.Units.iconSizes.small
                            Layout.preferredHeight: Kirigami.Units.iconSizes.small
                            visible: ruleRow.busy
                            running: visible
                        }
                    }
                    // Allow asks first, saying what changes where
                    ColumnLayout {
                        Layout.fillWidth: true
                        Layout.leftMargin: Kirigami.Units.iconSizes.small + Kirigami.Units.smallSpacing
                        visible: ruleRow.asking
                        spacing: Kirigami.Units.smallSpacing

                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.fillWidth: true
                            wrapMode: Text.Wrap
                            font: Kirigami.Theme.smallFont
                            text: i18n("This %1.", ruleRow.rule.change)
                        }
                        RowLayout {
                            spacing: Kirigami.Units.smallSpacing

                            PlasmaComponents3.Button {
                                icon.name: "dialog-ok-apply"
                                text: i18n("Allow")
                                onClicked: {
                                    view.confirmRule = ""
                                    root.changeWeekRule(ruleRow.rule, true)
                                }
                            }
                            PlasmaComponents3.Button {
                                text: i18n("Cancel")
                                onClicked: view.confirmRule = ""
                            }
                        }
                    }
                }
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                visible: root.weekRuleMessage !== "" && !root.weekRuleRevoked
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
                text: root.weekRuleMessage
            }
        }

        // The permissions you gave: every rule and mode that lets chats on
        // this computer go without asking, each to revoke (it asks first)
        ColumnLayout {
            Layout.fillWidth: true
            visible: view.hasData && !!view.recap && !!view.recap.granted
            spacing: Math.round(view.gu * 0.2)

            SectionTitle {
                text: i18n("Permissions you gave")
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
                opacity: 0.7
                text: view.granted.length
                      ? i18n("What lets chats on this computer go without asking you: your settings, and the .claude settings of the folders Claude ran in, with the rules it saved when you answered “don't ask again”. Revoke takes one out of its file.")
                      : i18n("Nothing lets chats on this computer skip a permission prompt: they ask you each time.")
            }
            Repeater {
                model: view.allGranted ? view.granted.length : Math.min(view.granted.length, view.grantedFew)
                delegate: ColumnLayout {
                    id: grantRow
                    required property int index
                    readonly property var grant: view.granted[index] || view.emptyGrant
                    readonly property bool asking: view.confirmGrant !== "" && view.confirmGrant === grant.id
                    Layout.fillWidth: true
                    spacing: Math.round(view.gu * 0.2)

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Kirigami.Units.smallSpacing

                        Kirigami.Icon {
                            Layout.alignment: Qt.AlignTop
                            Layout.preferredWidth: Kirigami.Units.iconSizes.small
                            Layout.preferredHeight: Kirigami.Units.iconSizes.small
                            source: view.grantIcon(grantRow.grant)
                            opacity: 0.8
                        }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 0

                            PlasmaComponents3.Label {
                                textFormat: Text.PlainText
                                Layout.fillWidth: true
                                wrapMode: Text.Wrap
                                text: grantRow.grant.title
                            }
                            PlasmaComponents3.Label {
                                textFormat: Text.PlainText
                                Layout.fillWidth: true
                                wrapMode: Text.Wrap
                                text: grantRow.grant.place + " · " + grantRow.grant.where
                                font: Kirigami.Theme.smallFont
                                opacity: 0.7
                            }
                        }
                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.alignment: Qt.AlignTop
                            visible: grantRow.grant.shared
                            text: i18n("In git")
                            font: Kirigami.Theme.smallFont
                            opacity: 0.7

                            PlasmaCore.ToolTipArea {
                                textFormat: Text.PlainText
                                anchors.fill: parent
                                mainText: i18n("Shared through git")
                                subText: i18n("This folder's .claude/settings.json is shared with whoever uses its repository: change it there.")
                            }
                        }
                        PlasmaComponents3.Button {
                            Layout.alignment: Qt.AlignTop
                            visible: !grantRow.grant.shared && !grantRow.asking && root.weekRuleBusy !== grantRow.grant.id
                            enabled: root.weekRuleBusy === ""
                            text: i18n("Revoke…")
                            onClicked: view.confirmGrant = grantRow.grant.id
                        }
                        PlasmaComponents3.BusyIndicator {
                            Layout.alignment: Qt.AlignTop
                            Layout.preferredWidth: Kirigami.Units.iconSizes.small
                            Layout.preferredHeight: Kirigami.Units.iconSizes.small
                            visible: root.weekRuleBusy !== "" && root.weekRuleBusy === grantRow.grant.id
                            running: visible
                        }
                    }
                    // Revoke asks first, saying what changes where
                    ColumnLayout {
                        Layout.fillWidth: true
                        Layout.leftMargin: Kirigami.Units.iconSizes.small + Kirigami.Units.smallSpacing
                        visible: grantRow.asking
                        spacing: Kirigami.Units.smallSpacing

                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.fillWidth: true
                            wrapMode: Text.Wrap
                            font: Kirigami.Theme.smallFont
                            text: i18n("This %1.", grantRow.grant.change)
                        }
                        RowLayout {
                            spacing: Kirigami.Units.smallSpacing

                            PlasmaComponents3.Button {
                                icon.name: "edit-delete-remove"
                                text: i18n("Revoke")
                                onClicked: {
                                    view.confirmGrant = ""
                                    root.revokeWeekGrant(grantRow.grant)
                                }
                            }
                            PlasmaComponents3.Button {
                                text: i18n("Cancel")
                                onClicked: view.confirmGrant = ""
                            }
                        }
                    }
                }
            }
            PlasmaComponents3.ToolButton {
                visible: !view.allGranted && view.granted.length > view.grantedFew
                text: i18np("Show %1 more", "Show %1 more", view.granted.length - view.grantedFew)
                onClicked: view.allGranted = true
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                visible: root.weekRuleMessage !== "" && root.weekRuleRevoked
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
                text: root.weekRuleMessage
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
                const cur = view.currency
                if (cur.error)
                    text += "\n" + i18n("Amounts in US dollars: %1.", cur.error)
                else if (cur.code !== "USD")
                    text += "\n" + i18n("Amounts in %1 at the European Central Bank's rate of %2: 1 USD = %3 %1.", cur.code,
                                        Qt.locale().toString(view.date(cur.date), "d MMM yyyy"),
                                        Number(cur.rate).toLocaleString(Qt.locale(), "f", 4))
                for (const s of failed)
                    text += "\n" + i18n("%1 couldn't be read: %2", s.host, s.error)
                return text
            }
        }
    }
    }
}
