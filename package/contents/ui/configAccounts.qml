import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami
import org.kde.kcmutils as KCM
import org.kde.plasma.plasma5support as P5Support
import org.kde.plasma.plasmoid

// The Claude accounts on this computer (code/accounts.py): add one (a
// ~/.claude-NAME folder that Claude's own login, in a terminal, signs in),
// log in or out, remove one, and its claude-NAME command. Nothing here is a
// setting, so there's nothing to apply.
KCM.SimpleKCM {
    id: page

    readonly property string codeDir: decodeURIComponent(Qt.resolvedUrl("../code/").toString().replace(/^file:\/\//, ""))
    readonly property var configDirArgs: Plasmoid.configuration.extraConfigDirs.split(",")
        .map(d => d.trim()).filter(d => d.length).reduce((args, d) => args.concat(["--config-dir", d]), [])

    property var accounts: []
    property bool loaded: false
    property bool canCheck: true
    property string message: ""
    property bool messageOk: true
    property string busy: ""          // the account (or "add") an action runs for
    property string confirm: ""       // "remove:<key>" or "logout:<key>": asks first

    readonly property string name: nameField.text.trim()
    readonly property string nameProblem: {
        if (!name)
            return ""
        if (name === "default")
            return i18n("default is the name of ~/.claude")
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name))
            return i18n("Up to 32 letters, digits, - and _, starting with a letter")
        if (accounts.some(a => a.folder === "~/.claude-" + name))
            return i18n("There's an account called %1 already", name)
        return ""
    }

    function command(args) {
        const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'"
        return "python3 -I " + q(codeDir + "accounts.py") + " " + args.concat(configDirArgs).map(q).join(" ") + " # " + Date.now()
    }

    // check: ask Claude which accounts are logged in (and as whom); without,
    // the list says what the folders say (cheap, every few seconds)
    function load(check) {
        helper.connectSource(command(check ? ["--list", "--check"] : ["--list"]))
    }

    function act(args, forKey) {
        busy = forKey
        confirm = ""
        helper.connectSource(command(args))
    }

    P5Support.DataSource {
        id: helper
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            let result = null
            try {
                result = JSON.parse(data["stdout"])
            } catch (e) {
                const lines = (data["stderr"] || "").trim().split("\n")
                result = { ok: false, message: lines[lines.length - 1] || i18n("the helper gave no answer") }
            }
            if (source.indexOf("'--list'") >= 0 && !result.ok) {
                page.message = result.message || i18n("the helper gave no answer")
                page.messageOk = false
                page.loaded = true
                return
            }
            if (source.indexOf("'--list'") >= 0) {
                const checked = source.indexOf("'--check'") >= 0
                const before = {}
                for (const a of page.accounts)
                    before[a.key] = a
                // A quick look keeps what Claude said last while the folder
                // says the same (quick); when that changes, Claude is asked again
                const changed = result.accounts.some(a => !before[a.key] || before[a.key].quick !== a.quick)
                page.accounts = result.accounts.map(a => {
                    const old = before[a.key]
                    return checked || !old || !old.checked || old.quick !== a.quick ? a
                        : Object.assign({}, a, { checked: true, method: old.method, email: old.email, loggedIn: old.loggedIn })
                })
                page.canCheck = result.canCheck
                if (!checked && (!page.loaded || changed))
                    page.load(true)
                page.loaded = true
                return
            }
            page.message = result.message || ""
            page.messageOk = result.ok
            page.busy = ""
            if (result.ok && source.indexOf("'--add'") >= 0)
                nameField.text = ""
            page.load(true)
        }
    }

    Component.onCompleted: load(true)

    // A login happens in a terminal: look again every few seconds
    Timer {
        interval: 4000
        repeat: true
        running: page.visible && page.loaded
        onTriggered: page.load(false)
    }

    ColumnLayout {
        spacing: Kirigami.Units.largeSpacing

        Kirigami.InlineMessage {
            Layout.fillWidth: true
            visible: page.message !== ""
            type: page.messageOk ? Kirigami.MessageType.Positive : Kirigami.MessageType.Error
            text: page.message
            showCloseButton: true
            onVisibleChanged: if (!visible) page.message = ""
        }

        Kirigami.Heading {
            level: 3
            textFormat: Text.PlainText
            text: i18n("Accounts on this computer")
        }

        QQC2.Label {
            Layout.fillWidth: true
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: i18n("Each account is a Claude folder (~/.claude, ~/.claude-NAME) with a login, history and chats of its own. Plain claude runs on ~/.claude; a chat started with the + next to an account in the popup runs on that account.")
        }

        QQC2.Label {
            visible: !page.loaded
            text: i18n("Looking…")
            opacity: 0.7
        }

        Repeater {
            model: page.accounts.length
            delegate: Rectangle {
                id: card
                required property int index
                readonly property var account: page.accounts[index] || ({ key: "", label: "", folder: "" })
                readonly property bool asking: page.confirm === "remove:" + account.key || page.confirm === "logout:" + account.key
                Layout.fillWidth: true
                implicitHeight: cardColumn.implicitHeight + Kirigami.Units.largeSpacing * 2
                radius: Kirigami.Units.cornerRadius
                color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.04)
                border.width: 1
                border.color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.12)

                ColumnLayout {
                    id: cardColumn
                    anchors.fill: parent
                    anchors.margins: Kirigami.Units.largeSpacing
                    spacing: Kirigami.Units.smallSpacing

                    RowLayout {
                        Layout.fillWidth: true
                        Kirigami.Icon {
                            source: card.account.loggedIn ? "user-identity" : "im-user-offline"
                            Layout.preferredWidth: Kirigami.Units.iconSizes.smallMedium
                            Layout.preferredHeight: Layout.preferredWidth
                        }
                        QQC2.Label {
                            textFormat: Text.PlainText
                            text: card.account.label
                            font.bold: true
                        }
                        QQC2.Label {
                            textFormat: Text.PlainText
                            visible: card.account.main || card.account.vscode
                            text: [card.account.main ? i18n("plain claude") : "", card.account.vscode ? i18n("VS Code's Claude") : ""]
                                  .filter(t => t).join(" · ")
                            font: Kirigami.Theme.smallFont
                            opacity: 0.7
                        }
                        Item { Layout.fillWidth: true }
                        QQC2.Label {
                            textFormat: Text.PlainText
                            text: card.account.folder
                            font: Kirigami.Theme.smallFont
                            opacity: 0.6
                        }
                    }

                    QQC2.Label {
                        Layout.fillWidth: true
                        textFormat: Text.PlainText
                        wrapMode: Text.Wrap
                        text: {
                            const a = card.account
                            const parts = []
                            if (!a.loggedIn)
                                parts.push(a.checked ? i18n("Not logged in") : i18n("Not logged in to a Claude account"))
                            else if (a.method && a.method !== "claude.ai")
                                parts.push(i18n("Logged in (%1)", a.method))
                            else
                                parts.push([a.email || a.account || i18n("Logged in"), a.plan].filter(t => t).join(" · "))
                            if (a.chats > 0)
                                parts.push(i18np("1 chat running", "%1 chats running", a.chats))
                            return parts.join(" · ")
                        }
                        opacity: card.account.loggedIn ? 1 : 0.8
                    }

                    // Asks first: logging out, removing
                    Kirigami.InlineMessage {
                        Layout.fillWidth: true
                        visible: card.asking
                        type: page.confirm.startsWith("remove:") ? Kirigami.MessageType.Warning : Kirigami.MessageType.Information
                        text: page.confirm.startsWith("remove:")
                              ? i18n("Remove %1? It logs out, then moves %2 to the Trash with its chats, history and settings (restore it from there if you change your mind). Chats shared with your other accounts stay on them.", card.account.label, card.account.folder)
                              : i18n("Log out of %1? Claude deletes its login; its chats and history stay, and Log in… signs it in again (also with another account).", card.account.label)
                        actions: [
                            Kirigami.Action {
                                text: page.confirm.startsWith("remove:") ? i18n("Remove") : i18n("Log out")
                                icon.name: page.confirm.startsWith("remove:") ? "edit-delete" : "system-log-out"
                                onTriggered: page.act([page.confirm.startsWith("remove:") ? "--remove" : "--logout", card.account.key], card.account.key)
                            },
                            Kirigami.Action {
                                text: i18n("Cancel")
                                icon.name: "dialog-cancel"
                                onTriggered: page.confirm = ""
                            }
                        ]
                    }

                    Flow {
                        Layout.fillWidth: true
                        spacing: Kirigami.Units.smallSpacing
                        visible: !card.asking

                        QQC2.Button {
                            visible: !card.account.loggedIn
                            text: i18n("Log in…")
                            icon.name: "go-next"
                            enabled: page.busy === "" && page.canCheck
                            onClicked: page.act(["--login", card.account.key], card.account.key)
                            QQC2.ToolTip.visible: hovered
                            QQC2.ToolTip.text: i18n("Opens a terminal with Claude's own login (claude auth login): sign in in your browser with the account for this folder.")
                        }
                        QQC2.Button {
                            visible: card.account.loggedIn
                            text: i18n("Log out…")
                            icon.name: "system-log-out"
                            enabled: page.busy === "" && card.account.chats === 0
                            onClicked: page.confirm = "logout:" + card.account.key
                            QQC2.ToolTip.visible: hovered
                            QQC2.ToolTip.text: card.account.chats > 0 ? i18n("Close its chats first: they'd lose the login.")
                                                                      : i18n("Claude deletes this account's login (claude auth logout).")
                        }
                        QQC2.Button {
                            text: i18n("Remove…")
                            icon.name: "edit-delete"
                            enabled: page.busy === "" && !card.account.notRemovable
                            onClicked: page.confirm = "remove:" + card.account.key
                            QQC2.ToolTip.visible: hovered
                            QQC2.ToolTip.text: card.account.notRemovable || i18n("Logs out and moves the folder to the Trash.")
                        }
                        QQC2.CheckBox {
                            visible: !!card.account.commandName
                            text: i18n("%1 command", card.account.commandName || "")
                            checked: !!card.account.command
                            enabled: page.busy === ""
                            onToggled: {
                                const want = checked
                                checked = Qt.binding(() => !!card.account.command)   // the list says when it's done
                                page.act([want ? "--command" : "--no-command", card.account.key], card.account.key)
                            }
                            QQC2.ToolTip.visible: hovered
                            QQC2.ToolTip.text: i18n("~/.local/bin/%1 runs Claude on this account in any terminal, like claude-switch %2 did.",
                                                    card.account.commandName || "", (card.account.commandName || "").replace(/^claude-/, ""))
                        }
                        QQC2.BusyIndicator {
                            visible: page.busy === card.account.key
                            running: visible
                            implicitHeight: Kirigami.Units.iconSizes.smallMedium
                            implicitWidth: implicitHeight
                        }
                    }
                }
            }
        }

        Kirigami.Heading {
            level: 3
            textFormat: Text.PlainText
            text: i18n("Add an account")
            Layout.topMargin: Kirigami.Units.largeSpacing
        }

        Kirigami.FormLayout {
            Layout.fillWidth: true

            QQC2.TextField {
                id: nameField
                Kirigami.FormData.label: i18n("Name:")
                placeholderText: i18n("e.g. work")
                maximumLength: 32
                Layout.preferredWidth: Kirigami.Units.gridUnit * 14
            }

            QQC2.Label {
                textFormat: Text.PlainText
                text: page.nameProblem || (page.name ? i18n("Folder: ~/.claude-%1", page.name) : i18n("Its folder will be ~/.claude-NAME"))
                color: page.nameProblem ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.textColor
                font: Kirigami.Theme.smallFont
                opacity: page.nameProblem ? 1 : 0.7
            }

            QQC2.ComboBox {
                id: shareFrom
                Kirigami.FormData.label: i18n("Settings:")
                textRole: "text"
                valueRole: "value"
                model: page.accounts.map(a => ({ text: i18n("Shared with %1", a.label), value: a.key }))
                       .concat([{ text: i18n("Claude's defaults, nothing shared"), value: "" }])
                Layout.preferredWidth: Kirigami.Units.gridUnit * 14
            }

            QQC2.Label {
                Layout.maximumWidth: Kirigami.Units.gridUnit * 22
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
                opacity: 0.7
                text: shareFrom.currentValue
                      ? i18n("Links settings.json (your status line, so the plan usage bars work), CLAUDE.md, keybindings and your own skills, agents and commands to that account's: a change on one is a change on both. The login, MCP servers, plugins and the skills claude.ai syncs stay per account.")
                      : i18n("A fresh folder: Claude starts with its defaults. Plan usage shows once Claude fetched it (/usage), or after you give the account a status line and run install.sh again.")
            }

            QQC2.CheckBox {
                id: withCommand
                text: page.name && !page.nameProblem ? i18n("Add a claude-%1 command", page.name) : i18n("Add a claude-NAME command")
                checked: true
                QQC2.ToolTip.visible: hovered
                QQC2.ToolTip.text: i18n("In ~/.local/bin: runs Claude on the new account in any terminal.")
            }

            RowLayout {
                QQC2.Button {
                    text: i18n("Add and Log In…")
                    icon.name: "list-add-user"
                    enabled: page.name !== "" && page.nameProblem === "" && page.busy === "" && page.canCheck
                    onClicked: page.act(["--add", page.name].concat(shareFrom.currentValue ? ["--share-from", shareFrom.currentValue] : [],
                                                                    withCommand.checked ? ["--command"] : []), "add")
                }
                QQC2.BusyIndicator {
                    visible: page.busy === "add"
                    running: visible
                    implicitHeight: Kirigami.Units.iconSizes.smallMedium
                    implicitWidth: implicitHeight
                }
            }

            QQC2.Label {
                Layout.maximumWidth: Kirigami.Units.gridUnit * 22
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
                opacity: 0.7
                text: page.canCheck
                      ? i18n("A terminal opens with Claude's own login: sign in in your browser with the other account. Claude keeps the login in the new folder; the widget never sees it. The account shows up in the popup right away.")
                      : i18n("Needs the claude command, which isn't found (on PATH, in ~/.local/bin, npm's or nvm's folders).")
            }
        }
    }
}
