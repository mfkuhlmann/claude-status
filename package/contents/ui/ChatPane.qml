import QtQuick
import QtQuick.Layouts
import QtQuick.Window
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasma5support as P5Support
import org.kde.kirigami as Kirigami

// A chat beside the popup (main.qml: openPane): its conversation, updating
// while it works, with each tool call folded into one line; a box to reply
// (pane.py --send: typed into tmux, put in its VS Code tab's input, or it
// goes on in the background); what it asks while it waits for a permission,
// with Allow once / Always allow / Deny; and its review: the files it
// changed, against how they were before the chat, with Undo, Commit and
// Mark reviewed. One window, for the chat root.paneChat.
Window {
    id: pane

    readonly property var chat: root.paneChat || ({})
    readonly property var row: root.paneRow   // its row in the status now (null: not listed)
    readonly property string host: chat.host || ""
    readonly property string chatId: chat.chatId || ""
    readonly property string profileDir: row && row.profileDir ? row.profileDir : (chat.profileDir || "")
    readonly property string sessionId: row && row.sessionId ? row.sessionId : (chat.sessionId || "")
    readonly property string chatName: row && row.name ? row.name : (chat.name || "")
    readonly property string chatState: row ? row.state : "done"
    readonly property bool busy: chatState === "working" || chatState === "waiting"
    readonly property string route: row && row.reply ? row.reply : "background"
    readonly property var permission: row && row.permission && chatState === "waiting" ? row.permission : null
    readonly property var queued: root.queuedMessage(chatId, host)
    readonly property bool reviewPending: row ? root.reviewPending(row, host) : false
    property string tab: "chat"

    title: i18nc("window title: a chat's name", "%1 — Claude chat", chatName || chatId.slice(0, 8))
    width: Kirigami.Units.gridUnit * 34
    height: Kirigami.Units.gridUnit * 36
    minimumWidth: Kirigami.Units.gridUnit * 22
    minimumHeight: Kirigami.Units.gridUnit * 18
    color: Kirigami.Theme.backgroundColor
    onClosing: root.closePane()

    // ---------------------------------------------------------------- the conversation

    property string stamp: ""
    property int limit: 120
    property bool more: false
    property bool loaded: false
    property string loadError: ""
    property var openTools: ({})   // key -> unfolded
    property string info: ""
    property bool infoBad: false

    ListModel {
        id: items
    }

    function reset() {
        items.clear()
        stamp = ""
        limit = 120
        more = false
        loaded = false
        loadError = ""
        openTools = {}
        info = ""
        review = null
        commitOpen = false
        undoAsk = ""
        replyBox.text = ""
        tab = chat.tab || "chat"
        Qt.callLater(load)
    }
    property bool ready: false   // (nothing runs while the window is being made)
    onChatIdChanged: if (ready) reset()
    Component.onCompleted: {
        ready = true
        reset()
    }
    Connections {
        target: root
        function onPaneDraftChanged() {   // (a reply from a notification, for a terminal that takes no text)
            if (root.paneDraft) {
                replyBox.text = root.paneDraft
                pane.askHow = true
                root.paneDraft = ""
            }
        }
        function onPaneDenyingChanged() {   // (Deny with a note, from a notification)
            if (root.paneDenying) {
                askColumn.denyWithNote()
                root.paneDenying = false
            }
        }
        function onPaneChatChanged() {
            if (root.paneChat && root.paneChat.tab)
                pane.tab = root.paneChat.tab
            pane.raise()
            pane.requestActivate()
        }
    }

    function paneArgs() {
        return (profileDir ? " --profile " + root.shellQuote(profileDir) : "")
               + (host ? " --host " + root.shellQuote(host) : "") + root.configDirArgs
    }

    function run(kind, args) {
        const cmd = "python3 -I " + root.shellQuote(root.codeDir + "pane.py") + " " + args + " # " + Date.now()
        runs[cmd] = kind
        runner.connectSource(cmd)
    }
    property var runs: ({})
    property bool loading: false

    function load() {
        if (loading || !chatId)
            return
        loading = true
        run("conversation", "--conversation " + root.shellQuote(chatId) + " --limit " + limit
            + (stamp ? " --if-changed " + root.shellQuote(stamp) : "") + paneArgs())
    }

    Timer {
        interval: pane.host ? 5000 : 1500
        running: pane.visible && pane.chatId !== ""
        repeat: true
        onTriggered: pane.load()
    }

    // The items in place (by key): rows keep their state, the list its position
    function merge(list) {
        const wanted = {}
        list.forEach(i => wanted[i.key] = true)
        for (let i = items.count - 1; i >= 0; i--) {
            if (!wanted[items.get(i).key])
                items.remove(i)
        }
        for (let i = 0; i < list.length; i++) {
            const it = list[i]
            const flat = { kind: it.kind, key: String(it.key), text: it.text || "", line: it.line || "",
                           status: it.status || "", input: it.input || "", output: it.output || "",
                           at: it.at || 0, bad: !!it.error }
            if (i < items.count && items.get(i).key === flat.key) {
                const old = items.get(i)
                if (old.text !== flat.text || old.status !== flat.status || old.output !== flat.output
                        || old.input !== flat.input)
                    items.set(i, flat)
            } else if (i < items.count) {
                items.insert(i, flat)
            } else {
                items.append(flat)
            }
        }
        while (items.count > list.length)
            items.remove(items.count - 1)
    }

    function handle(kind, result) {
        if (kind === "conversation") {
            loading = false
            if (!result.ok) {
                loadError = result.message || i18n("Can't read this chat")
                return
            }
            loadError = ""
            if (result.unchanged)
                return
            const following = !loaded || list.atYEnd
            stamp = result.stamp || ""
            more = !!result.more
            merge(result.items || [])
            loaded = true
            if (following)
                Qt.callLater(() => list.positionViewAtEnd())
            return
        }
        if (kind === "review") {
            reviewLoading = false
            review = result.ok ? result : null
            reviewError = result.ok ? "" : (result.message || "")
            if (result.ok && !commitEdited)
                commitText.text = result.message || ""
            return
        }
        info = result.message || (result.ok ? "" : i18n("That didn't work"))
        infoBad = !result.ok
        infoTimer.restart()
        if (kind === "send" && result.ok) {
            if (result.how === "ask") {
                askHow = true
                info = ""
                return
            }
            if (result.how === "vscode" && result.link)
                Qt.openUrlExternally(result.link)
            if (result.how === "copy")
                root.openRow(row || chat, host)
            replyBox.text = ""
            askHow = false
        }
        if (kind === "deny" || kind === "answer")
            answering = Math.max(0, answering - 1)
        if (kind === "commit" && result.ok) {
            commitOpen = false
            commitEdited = false
        }
        if (kind === "undo" || kind === "commit" || kind === "reviewed")
            loadReview()
        root.refresh()
        if (host)
            root.pollHost(host)
        stamp = ""   // (read it again now)
        load()
    }

    P5Support.DataSource {
        id: runner
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const kind = pane.runs[source] || ""
            delete pane.runs[source]
            pane.handle(kind, root.helperResult(data))
        }
    }

    Timer {
        id: infoTimer
        interval: 12000
        onTriggered: pane.info = ""
    }

    // ---------------------------------------------------------------- replying

    property bool askHow: false   // its terminal takes no text: background or copy?

    function send(how, afterTurn) {
        const text = replyBox.text.trim()
        if (!text)
            return
        run(afterTurn ? "later" : "send", "--send " + root.shellQuote(chatId) + " --text " + root.shellQuote(text)
            + (sessionId ? " --session " + root.shellQuote(sessionId) : "") + " --how " + (how || "auto")
            + (afterTurn ? " --after-turn --name " + root.shellQuote(chatName) : "") + paneArgs())
        if (afterTurn)
            replyBox.text = ""
    }

    readonly property string routeHint: {
        const where = host ? " " + i18n("(on %1)", host) : ""
        if (route === "tmux")
            return i18n("Typed into its tmux pane.") + where
        if (route === "vscode")
            return i18n("Goes into the chat's input in VS Code: press Enter there.") + where
        if (route === "terminal")
            return i18n("Its terminal takes no text from outside: send it, and Claude there quits and the chat goes on in the background, or copy it and open its tab.") + where
        if (row && row.pid && row.kind === "bg")
            return i18n("Its background session stops, then goes on with your message.") + where
        return i18n("The chat goes on in the background with your message.") + where
    }

    // ---------------------------------------------------------------- permission prompt

    property int answering: 0   // answers on their way

    function answer(decision, note) {
        const p = permission
        if (!p || (p.answer !== "hook" && p.answer !== "keys"))
            return
        answering += 1
        if (p.answer === "hook")
            run(decision === "deny" ? "deny" : "answer", "--answer " + root.shellQuote(p.request) + " --decision " + decision
                + (note ? " --note " + root.shellQuote(note) : "") + (host ? " --host " + root.shellQuote(host) : "")
                + root.configDirArgs)
        else if (p.answer === "keys")
            run(decision === "deny" ? "deny" : "answer", "--keys " + root.shellQuote(sessionId) + " --decision " + decision
                + (note ? " --note " + root.shellQuote(note) : "") + paneArgs())
    }

    // ---------------------------------------------------------------- review

    property var review: null
    property bool reviewLoading: false
    property string reviewError: ""
    property var openFiles: ({})
    property bool commitOpen: false
    property bool commitEdited: false
    property string undoAsk: ""   // "*": all, else a file's path, asked to confirm

    function loadReview() {
        if (!chatId)
            return
        reviewLoading = true
        run("review", "--review " + root.shellQuote(chatId) + paneArgs())
    }
    onTabChanged: if (tab === "review" && review === null) loadReview()
    readonly property real editedAt: row && row.review ? row.review.editedAt || 0 : 0
    onEditedAtChanged: if (tab === "review") loadReview()

    function undo(path) {
        undoAsk = ""
        run("undo", "--undo " + root.shellQuote(chatId) + (path !== "*" ? " --file " + root.shellQuote(path) : "") + paneArgs())
    }

    function totals(files) {
        let added = 0, removed = 0
        for (const f of files || []) {
            added += f.added || 0
            removed += f.removed || 0
        }
        return [added, removed]
    }

    // ---------------------------------------------------------------- what's shown

    Rectangle {
        anchors.fill: parent
        color: Kirigami.Theme.backgroundColor
        Kirigami.Theme.colorSet: Kirigami.Theme.Window
        Kirigami.Theme.inherit: false

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: Kirigami.Units.largeSpacing
            spacing: Kirigami.Units.smallSpacing

            // Its name, where it runs and what it's doing
            RowLayout {
                Layout.fillWidth: true
                spacing: Kirigami.Units.smallSpacing

                Rectangle {
                    Layout.preferredWidth: Math.round(Kirigami.Units.gridUnit * 0.6)
                    Layout.preferredHeight: Layout.preferredWidth
                    radius: width / 2
                    color: root.stateColor(pane.chatState)
                }
                Kirigami.Heading {
                    level: 4
                    textFormat: Text.PlainText
                    text: pane.chatName
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
                Tag {
                    visible: pane.host !== ""
                    text: pane.host
                    tooltip: i18n("This chat runs on the SSH host %1.", pane.host)
                }
                PlasmaComponents3.Label {
                    textFormat: Text.PlainText
                    text: pane.row ? root.stateText(pane.row) : i18n("not running")
                    color: pane.chatState === "waiting" ? Kirigami.Theme.neutralTextColor : Kirigami.Theme.textColor
                    font.bold: pane.chatState === "waiting"
                    opacity: 0.8
                }
                PlasmaComponents3.ToolButton {
                    icon.name: "window"
                    display: PlasmaComponents3.AbstractButton.IconOnly
                    text: i18n("Open its window")
                    onClicked: root.openRow(pane.row || pane.chat, pane.host)

                    PlasmaCore.ToolTipArea {
                        textFormat: Text.PlainText
                        anchors.fill: parent
                        mainText: i18n("Open its window")
                        subText: i18n("The terminal or VS Code tab the chat runs in; a chat that isn't open reopens in a terminal.")
                    }
                }
            }
            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                text: (pane.host ? pane.host + ":" : "") + (pane.row ? pane.row.cwdShort || pane.row.cwd || "" : pane.chat.cwd || "")
                font: Kirigami.Theme.smallFont
                opacity: 0.7
                elide: Text.ElideMiddle
            }

            PlasmaComponents3.TabBar {
                id: tabBar
                Layout.fillWidth: true
                currentIndex: pane.tab === "review" ? 1 : 0

                PlasmaComponents3.TabButton {
                    text: i18n("Chat")
                    onClicked: pane.tab = "chat"
                }
                PlasmaComponents3.TabButton {
                    text: pane.row && pane.row.changes
                          ? (pane.reviewPending ? i18nc("tab: the files a chat changed, not reviewed yet", "Review ±%1 •", pane.row.changes.count)
                                                : i18nc("tab: the files a chat changed", "Review ±%1", pane.row.changes.count))
                          : i18n("Review")
                    onClicked: pane.tab = "review"
                }
            }

            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                Layout.fillWidth: true
                visible: pane.info !== ""
                text: pane.info
                wrapMode: Text.Wrap
                color: pane.infoBad ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.positiveTextColor
            }

            // ---------------------------------------------------------------- Chat
            PlasmaComponents3.ScrollView {
                id: scroll
                visible: pane.tab === "chat"
                Layout.fillWidth: true
                Layout.fillHeight: true
                PlasmaComponents3.ScrollBar.horizontal.policy: PlasmaComponents3.ScrollBar.AlwaysOff

                ListView {
                    id: list
                    model: items
                    spacing: Kirigami.Units.largeSpacing
                    clip: true
                    boundsBehavior: Flickable.StopAtBounds

                    header: Item {
                        width: list.width
                        implicitHeight: headerColumn.implicitHeight + Kirigami.Units.smallSpacing

                        ColumnLayout {
                            id: headerColumn
                            width: parent.width

                            PlasmaComponents3.Button {
                                visible: pane.more
                                Layout.alignment: Qt.AlignHCenter
                                icon.name: "go-up"
                                text: i18n("Show earlier")
                                onClicked: {
                                    pane.limit = Math.min(2000, pane.limit * 2)
                                    pane.stamp = ""
                                    pane.load()
                                }
                            }
                            PlasmaComponents3.Label {
                                textFormat: Text.PlainText
                                Layout.fillWidth: true
                                visible: !pane.loaded || pane.loadError !== ""
                                horizontalAlignment: Text.AlignHCenter
                                text: pane.loadError || i18n("Reading the chat…")
                                color: pane.loadError ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.textColor
                                opacity: 0.7
                                wrapMode: Text.Wrap
                            }
                        }
                    }

                    footer: Item {
                        width: list.width
                        implicitHeight: pane.chatState === "working" ? footerRow.implicitHeight + Kirigami.Units.largeSpacing : 0
                        visible: pane.chatState === "working"

                        RowLayout {
                            id: footerRow
                            anchors.left: parent.left
                            anchors.right: parent.right
                            anchors.bottom: parent.bottom
                            spacing: Kirigami.Units.smallSpacing

                            PlasmaComponents3.BusyIndicator {
                                Layout.preferredWidth: Kirigami.Units.iconSizes.small
                                Layout.preferredHeight: Kirigami.Units.iconSizes.small
                                running: footerRow.visible
                            }
                            PlasmaComponents3.Label {
                                textFormat: Text.PlainText
                                Layout.fillWidth: true
                                text: pane.row && pane.row.peek && pane.row.peek.activity ? pane.row.peek.activity : i18n("working…")
                                elide: Text.ElideRight
                                opacity: 0.7
                            }
                        }
                    }

                    delegate: ColumnLayout {
                        id: entry
                        required property int index
                        required property string kind
                        required property string key
                        required property string text
                        required property string line
                        required property string status
                        required property string input
                        required property string output
                        required property bool bad
                        readonly property bool unfolded: pane.openTools[key] === true
                        width: list.width
                        spacing: Kirigami.Units.smallSpacing

                        // Yours: set off, on the right
                        Rectangle {
                            visible: entry.kind === "you"
                            Layout.alignment: Qt.AlignRight
                            Layout.maximumWidth: list.width * 0.85
                            Layout.preferredWidth: Math.min(list.width * 0.85, youText.implicitWidth + Kirigami.Units.largeSpacing * 2)
                            implicitHeight: youText.implicitHeight + Kirigami.Units.largeSpacing
                            radius: Kirigami.Units.cornerRadius
                            color: Qt.rgba(Kirigami.Theme.focusColor.r, Kirigami.Theme.focusColor.g, Kirigami.Theme.focusColor.b, 0.15)

                            TextEdit {
                                id: youText
                                anchors.fill: parent
                                anchors.margins: Kirigami.Units.largeSpacing / 2
                                anchors.leftMargin: Kirigami.Units.largeSpacing
                                anchors.rightMargin: Kirigami.Units.largeSpacing
                                text: entry.kind === "you" ? entry.text : ""
                                textFormat: TextEdit.PlainText
                                readOnly: true
                                selectByMouse: true
                                wrapMode: TextEdit.Wrap
                                color: Kirigami.Theme.textColor
                                selectionColor: Kirigami.Theme.focusColor
                                selectedTextColor: Kirigami.Theme.highlightedTextColor
                                font: Kirigami.Theme.defaultFont
                            }
                        }

                        // Claude's reply, rendered
                        TextEdit {
                            visible: entry.kind === "claude"
                            Layout.fillWidth: true
                            text: entry.kind === "claude" ? entry.text : ""
                            textFormat: TextEdit.MarkdownText
                            readOnly: true
                            selectByMouse: true
                            wrapMode: TextEdit.Wrap
                            color: Kirigami.Theme.textColor
                            selectionColor: Kirigami.Theme.focusColor
                            selectedTextColor: Kirigami.Theme.highlightedTextColor
                            font: Kirigami.Theme.defaultFont
                            onLinkActivated: link => Qt.openUrlExternally(link)
                        }

                        // A tool call: one line (▸ Bash: pytest ✓); click for what it ran and got
                        RowLayout {
                            visible: entry.kind === "tool"
                            Layout.fillWidth: true
                            spacing: Kirigami.Units.smallSpacing

                            PlasmaComponents3.Label {
                                textFormat: Text.PlainText
                                text: entry.unfolded ? "▾" : "▸"
                                opacity: 0.6
                            }
                            PlasmaComponents3.Label {
                                id: toolLine
                                textFormat: Text.PlainText
                                Layout.fillWidth: true
                                text: entry.line
                                elide: Text.ElideRight
                                font.family: "monospace"
                                font.pointSize: Kirigami.Theme.smallFont.pointSize
                                opacity: 0.85

                                MouseArea {
                                    anchors.fill: parent
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: {
                                        const next = Object.assign({}, pane.openTools)
                                        next[entry.key] = !entry.unfolded
                                        pane.openTools = next
                                    }
                                }
                            }
                            PlasmaComponents3.Label {
                                textFormat: Text.PlainText
                                text: entry.status === "ok" ? "✓" : entry.status === "error" ? "✗"
                                    : pane.permission && entry.index === items.count - 1 ? "?" : pane.busy ? "…" : "–"
                                color: entry.status === "ok" ? Kirigami.Theme.positiveTextColor
                                     : entry.status === "error" ? Kirigami.Theme.negativeTextColor
                                     : Kirigami.Theme.neutralTextColor
                                font.bold: true
                            }
                        }
                        Rectangle {
                            visible: entry.kind === "tool" && entry.unfolded && (entry.input !== "" || entry.output !== "")
                            Layout.fillWidth: true
                            Layout.leftMargin: Kirigami.Units.gridUnit
                            implicitHeight: detail.implicitHeight + Kirigami.Units.smallSpacing * 2
                            radius: Kirigami.Units.cornerRadius
                            color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.06)

                            TextEdit {
                                id: detail
                                anchors.fill: parent
                                anchors.margins: Kirigami.Units.smallSpacing
                                text: entry.kind !== "tool" ? "" : entry.input + (entry.input && entry.output ? "\n──\n" : "") + entry.output
                                textFormat: TextEdit.PlainText
                                readOnly: true
                                selectByMouse: true
                                wrapMode: TextEdit.Wrap
                                color: Kirigami.Theme.textColor
                                selectionColor: Kirigami.Theme.focusColor
                                font.family: "monospace"
                                font.pointSize: Kirigami.Theme.smallFont.pointSize
                            }
                        }

                        // A note: interrupted, a usage limit, compacted
                        PlasmaComponents3.Label {
                            visible: entry.kind === "note"
                            Layout.fillWidth: true
                            textFormat: Text.PlainText
                            text: entry.kind === "note" ? "— " + entry.text + " —" : ""
                            horizontalAlignment: Text.AlignHCenter
                            wrapMode: Text.Wrap
                            font.italic: true
                            font.pointSize: Kirigami.Theme.smallFont.pointSize
                            color: entry.bad ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.textColor
                            opacity: entry.bad ? 1 : 0.6
                        }
                    }
                }
            }

            // What it asks while it waits: Allow once / Always allow / Deny
            Rectangle {
                visible: pane.tab === "chat" && pane.permission !== null
                Layout.fillWidth: true
                implicitHeight: askColumn.implicitHeight + Kirigami.Units.largeSpacing * 2
                radius: Kirigami.Units.cornerRadius
                color: Qt.rgba(Kirigami.Theme.neutralTextColor.r, Kirigami.Theme.neutralTextColor.g, Kirigami.Theme.neutralTextColor.b, 0.08)
                border.width: 1
                border.color: Kirigami.Theme.neutralTextColor

                PermissionAsk {
                    id: askColumn
                    anchors.fill: parent
                    anchors.margins: Kirigami.Units.largeSpacing
                    permission: pane.permission
                    busy: pane.answering > 0
                    diffLines: 12
                    onAnswered: (decision, note) => pane.answer(decision, note)
                }
            }

            // Your reply
            ColumnLayout {
                visible: pane.tab === "chat"
                Layout.fillWidth: true
                spacing: Kirigami.Units.smallSpacing

                RowLayout {
                    visible: pane.queued !== null
                    Layout.fillWidth: true

                    PlasmaComponents3.Label {
                        textFormat: Text.PlainText
                        Layout.fillWidth: true
                        text: pane.queued ? i18n("Sent when this turn ends: %1", pane.queued.prompt) : ""
                        elide: Text.ElideRight
                        color: Kirigami.Theme.focusColor
                    }
                    PlasmaComponents3.ToolButton {
                        icon.name: "edit-delete-remove"
                        text: i18n("Cancel")
                        onClicked: root.unqueue(pane.queued)
                    }
                }
                PlasmaComponents3.ScrollView {
                    Layout.fillWidth: true
                    Layout.preferredHeight: Math.min(Kirigami.Units.gridUnit * 8, Math.max(Kirigami.Units.gridUnit * 3, replyBox.implicitHeight))

                    PlasmaComponents3.TextArea {
                        id: replyBox
                        placeholderText: pane.permission ? i18n("It's asking you something: answer that first")
                                                         : i18n("Reply to Claude… (Ctrl+Enter sends)")
                        wrapMode: TextEdit.Wrap
                        enabled: !(pane.permission && pane.route === "tmux")
                        Keys.onPressed: event => {
                            if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && (event.modifiers & Qt.ControlModifier)) {
                                pane.send("auto", false)
                                event.accepted = true
                            }
                        }
                    }
                }
                PlasmaComponents3.Label {
                    textFormat: Text.PlainText
                    Layout.fillWidth: true
                    text: pane.routeHint
                    wrapMode: Text.Wrap
                    font: Kirigami.Theme.smallFont
                    opacity: 0.7
                }
                RowLayout {
                    Layout.fillWidth: true
                    spacing: Kirigami.Units.smallSpacing

                    Item {
                        Layout.fillWidth: true
                    }
                    PlasmaComponents3.Button {
                        visible: pane.route === "terminal" || pane.askHow
                        enabled: replyBox.text.trim() !== ""
                        icon.name: "edit-copy"
                        text: i18n("Copy and open its tab")
                        onClicked: pane.send("copy", false)
                    }
                    PlasmaComponents3.Button {
                        visible: pane.busy
                        enabled: replyBox.text.trim() !== ""
                        icon.name: "chronometer"
                        text: i18n("Send when this turn ends")
                        onClicked: pane.send(pane.route === "terminal" ? "background" : "auto", true)

                        PlasmaCore.ToolTipArea {
                            textFormat: Text.PlainText
                            anchors.fill: parent
                            mainText: i18n("Send when this turn ends")
                            subText: i18n("The widget keeps it and sends it once Claude's turn is over (also with the popup closed).")
                        }
                    }
                    PlasmaComponents3.Button {
                        enabled: replyBox.text.trim() !== "" && !(pane.route === "terminal" && pane.busy)
                                 && !(pane.permission && pane.route === "tmux")
                        icon.name: "document-send"
                        text: pane.route === "terminal" || pane.askHow ? i18n("Send, go on in the background") : i18n("Send")
                        onClicked: pane.send(pane.route === "terminal" || pane.askHow ? "background" : "auto", false)
                    }
                }
            }

            // ---------------------------------------------------------------- Review
            PlasmaComponents3.ScrollView {
                visible: pane.tab === "review"
                Layout.fillWidth: true
                Layout.fillHeight: true
                contentWidth: availableWidth
                PlasmaComponents3.ScrollBar.horizontal.policy: PlasmaComponents3.ScrollBar.AlwaysOff

                ColumnLayout {
                    width: parent.width
                    spacing: Kirigami.Units.smallSpacing

                    PlasmaComponents3.Label {
                        textFormat: Text.PlainText
                        Layout.fillWidth: true
                        visible: pane.review === null
                        text: pane.reviewLoading ? i18n("Comparing its files with how they were before the chat…")
                                                 : pane.reviewError || i18n("Nothing to review yet")
                        color: pane.reviewError ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.textColor
                        opacity: 0.7
                        wrapMode: Text.Wrap
                    }
                    PlasmaComponents3.Label {
                        textFormat: Text.PlainText
                        Layout.fillWidth: true
                        visible: pane.review !== null && pane.review.files.length === 0
                        text: i18n("No changed files: they're as they were before this chat.")
                        opacity: 0.7
                        wrapMode: Text.Wrap
                    }

                    // the files, +/- lines, their diffs
                    RowLayout {
                        visible: pane.review !== null && pane.review.files.length > 0
                        Layout.fillWidth: true

                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.fillWidth: true
                            readonly property var sums: pane.totals(pane.review ? pane.review.files : [])
                            text: pane.review ? i18np("%1 file changed since the chat started", "%1 files changed since the chat started",
                                                     pane.review.files.length) + "  +" + sums[0] + " −" + sums[1] : ""
                            font.bold: true
                        }
                        TestsBadge {
                            review: pane.row ? pane.row.review : (pane.review ? { tests: pane.review.tests } : null)
                        }
                    }
                    Repeater {
                        model: pane.review ? pane.review.files.length : 0
                        delegate: ColumnLayout {
                            id: fileItem
                            required property int index
                            readonly property var file: pane.review && pane.review.files[index] ? pane.review.files[index] : ({ label: "", path: "", diff: [] })
                            readonly property bool unfolded: pane.openFiles[file.path] === true
                            Layout.fillWidth: true
                            spacing: 0

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: Kirigami.Units.smallSpacing

                                PlasmaComponents3.Label {
                                    textFormat: Text.PlainText
                                    text: fileItem.unfolded ? "▾" : "▸"
                                    opacity: 0.6
                                }
                                PlasmaComponents3.Label {
                                    textFormat: Text.PlainText
                                    Layout.fillWidth: true
                                    text: fileItem.file.label + (fileItem.file.created ? "  " + i18nc("a file the chat made", "(new)") : "")
                                          + (fileItem.file.deleted ? "  " + i18nc("a file the chat removed", "(removed)") : "")
                                    elide: Text.ElideMiddle
                                    font.family: "monospace"

                                    MouseArea {
                                        anchors.fill: parent
                                        cursorShape: Qt.PointingHandCursor
                                        onClicked: {
                                            const next = Object.assign({}, pane.openFiles)
                                            next[fileItem.file.path] = !fileItem.unfolded
                                            pane.openFiles = next
                                        }
                                    }
                                }
                                PlasmaComponents3.Label {
                                    textFormat: Text.PlainText
                                    visible: fileItem.file.added !== null && fileItem.file.added !== undefined
                                    text: "+" + fileItem.file.added
                                    color: Kirigami.Theme.positiveTextColor
                                    font.family: "monospace"
                                }
                                PlasmaComponents3.Label {
                                    textFormat: Text.PlainText
                                    visible: fileItem.file.removed !== null && fileItem.file.removed !== undefined
                                    text: "−" + fileItem.file.removed
                                    color: Kirigami.Theme.negativeTextColor
                                    font.family: "monospace"
                                }
                                PlasmaComponents3.Label {
                                    textFormat: Text.PlainText
                                    visible: !!fileItem.file.binary || !!fileItem.file.unknown
                                    text: fileItem.file.unknown ? i18n("no earlier version kept") : i18n("binary")
                                    opacity: 0.6
                                    font: Kirigami.Theme.smallFont
                                }
                                PlasmaComponents3.ToolButton {
                                    visible: !fileItem.file.unknown
                                    icon.name: "edit-undo"
                                    display: PlasmaComponents3.AbstractButton.IconOnly
                                    text: i18n("Undo this file")
                                    onClicked: pane.undoAsk = fileItem.file.path

                                    PlasmaCore.ToolTipArea {
                                        textFormat: Text.PlainText
                                        anchors.fill: parent
                                        mainText: i18n("Undo this file")
                                        subText: i18n("Asks first. Puts it back as it was before this chat.")
                                    }
                                }
                            }
                            ConfirmLine {
                                visible: pane.undoAsk === fileItem.file.path
                                Layout.fillWidth: true
                                text: fileItem.file.created ? i18n("Remove %1? The chat made it.", fileItem.file.label)
                                                            : i18n("Put %1 back as it was before this chat? Later changes to it are lost too.", fileItem.file.label)
                                confirmText: i18n("Undo")
                                onConfirmed: pane.undo(fileItem.file.path)
                                onCancelled: pane.undoAsk = ""
                            }
                            DiffView {
                                visible: fileItem.unfolded
                                Layout.fillWidth: true
                                Layout.leftMargin: Kirigami.Units.gridUnit
                                lines: fileItem.unfolded ? fileItem.file.diff || [] : []
                            }
                        }
                    }

                    // Commit only these files, with a message from its name and recap
                    ColumnLayout {
                        visible: pane.commitOpen && pane.review !== null
                        Layout.fillWidth: true
                        Layout.topMargin: Kirigami.Units.largeSpacing

                        PlasmaComponents3.Label {
                            textFormat: Text.PlainText
                            Layout.fillWidth: true
                            text: pane.review && pane.review.repos.length
                                  ? i18n("Commit only these files in %1 (yours that aren't this chat's stay as they are):", pane.review.repos.join(", "))
                                  : i18n("None of these files is in a git repository.")
                            wrapMode: Text.Wrap
                        }
                        PlasmaComponents3.TextArea {
                            id: commitText
                            Layout.fillWidth: true
                            Layout.preferredHeight: Kirigami.Units.gridUnit * 6
                            wrapMode: TextEdit.Wrap
                            font.family: "monospace"
                            onTextChanged: if (activeFocus) pane.commitEdited = true
                        }
                        RowLayout {
                            Item {
                                Layout.fillWidth: true
                            }
                            PlasmaComponents3.Button {
                                text: i18n("Cancel")
                                onClicked: pane.commitOpen = false
                            }
                            PlasmaComponents3.Button {
                                enabled: commitText.text.trim() !== "" && pane.review && pane.review.repos.length > 0
                                icon.name: "vcs-commit"
                                text: i18n("Commit")
                                onClicked: pane.run("commit", "--commit " + root.shellQuote(pane.chatId) + " --message "
                                                    + root.shellQuote(commitText.text) + pane.paneArgs())
                            }
                        }
                    }
                    ConfirmLine {
                        visible: pane.undoAsk === "*"
                        Layout.fillWidth: true
                        text: i18n("Put all of them back as they were before this chat? Files it made are removed; later changes to them are lost too.")
                        confirmText: i18n("Undo all")
                        onConfirmed: pane.undo("*")
                        onCancelled: pane.undoAsk = ""
                    }
                }
            }
            RowLayout {
                visible: pane.tab === "review"
                Layout.fillWidth: true
                spacing: Kirigami.Units.smallSpacing

                PlasmaComponents3.ToolButton {
                    icon.name: "view-refresh"
                    display: PlasmaComponents3.AbstractButton.IconOnly
                    text: i18n("Compare again")
                    onClicked: pane.loadReview()
                }
                Item {
                    Layout.fillWidth: true
                }
                PlasmaComponents3.Button {
                    enabled: pane.review !== null && pane.review.files.length > 0
                    icon.name: "edit-undo"
                    text: i18n("Undo all…")
                    onClicked: pane.undoAsk = "*"
                }
                PlasmaComponents3.Button {
                    enabled: pane.review !== null && pane.review.files.length > 0 && pane.review.repos.length > 0
                    icon.name: "vcs-commit"
                    text: i18n("Commit these files…")
                    onClicked: pane.commitOpen = !pane.commitOpen
                }
                PlasmaComponents3.Button {
                    readonly property bool marked: !!pane.row && !pane.reviewPending && !!pane.row.review
                    icon.name: marked ? "checkmark" : "view-task"
                    text: marked ? i18n("Reviewed") : i18n("Mark reviewed")
                    checkable: false
                    onClicked: pane.run("reviewed", "--reviewed " + root.shellQuote(pane.chatId) + (marked ? " --off" : "")
                                        + (pane.host ? " --host " + root.shellQuote(pane.host) : "") + root.configDirArgs)

                    PlasmaCore.ToolTipArea {
                        textFormat: Text.PlainText
                        anchors.fill: parent
                        mainText: parent.marked ? i18n("Reviewed") : i18n("Mark reviewed")
                        subText: parent.marked ? i18n("Click to mark it not reviewed.")
                                               : i18n("Its row stops saying \"to review\", until it changes files again.")
                    }
                }
            }
        }
    }
}
