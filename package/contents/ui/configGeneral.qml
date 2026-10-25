import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami
import org.kde.kcmutils as KCM
import org.kde.plasma.plasma5support as P5Support
import org.kde.plasma.plasmoid

KCM.SimpleKCM {
    id: page

    // Plasma writes back every cfg_ property on Apply. These are set in the
    // popup, not here: take what they are now, so applying this page doesn't
    // put back what they were when it opened.
    function saveConfig() {
        cfg_newChatInVscode = Plasmoid.configuration.newChatInVscode
        cfg_newChatModel = Plasmoid.configuration.newChatModel
        cfg_newChatEffort = Plasmoid.configuration.newChatEffort
        cfg_newChatMode = Plasmoid.configuration.newChatMode
        cfg_sshHosts = Plasmoid.configuration.sshHosts
    }

    property alias cfg_pollInterval: pollInterval.value
    property alias cfg_idlePollInterval: idlePollInterval.value
    property alias cfg_extraConfigDirs: extraDirs.text
    property alias cfg_notifyWaiting: notifyWaiting.checked
    property alias cfg_notifyDone: notifyDone.checked
    property alias cfg_notifyDoneMinSeconds: notifyDoneMinSeconds.value
    property alias cfg_awayDigest: awayDigest.checked
    property alias cfg_awayMinutes: awayMinutes.value
    property alias cfg_shortcutGoesToChat: shortcutGoesToChat.checked
    property alias cfg_phoneWhileAway: phoneWhileAway.checked
    property alias cfg_phoneFinished: phoneFinished.checked
    property string cfg_phoneDevice
    property alias cfg_keepDoneHours: keepDoneHours.value
    property alias cfg_showUsageInPanel: showUsage.checked
    property alias cfg_iconBlink: iconBlink.checked
    property bool cfg_newChatInVscode   // set with the Terminal | VS Code switch in the popup
    property string cfg_newChatModel    // these three in the popup's new-chat box
    property string cfg_newChatEffort
    property string cfg_newChatMode
    property int cfg_usageCap
    property alias cfg_showTokens: showTokens.checked
    property alias cfg_showPet: showPet.checked
    property alias cfg_chatPets: chatPets.value
    property alias cfg_recentChats: recentChats.value
    property alias cfg_remotePollSeconds: remotePollSeconds.value
    property string cfg_sshHosts
    property string cfg_sshUsage
    property string cfg_markdownApp
    property string cfg_recapCurrency
    property alias cfg_recapRules: recapRules.checked
    property alias cfg_notifySound: notifySound.checked
    property alias cfg_soundVolume: soundVolume.value
    property alias cfg_soundWaiting: soundWaiting.value
    property alias cfg_soundDone: soundDone.value
    property alias cfg_soundFailed: soundFailed.value

    // Plasma passes the defaults in too; declaring them avoids
    // "SimpleKCM does not have a property called cfg_…Default" warnings.
    property int cfg_pollIntervalDefault
    property int cfg_idlePollIntervalDefault
    property string cfg_extraConfigDirsDefault
    property bool cfg_notifyWaitingDefault
    property bool cfg_notifyDoneDefault
    property int cfg_notifyDoneMinSecondsDefault
    property bool cfg_awayDigestDefault
    property int cfg_awayMinutesDefault
    property bool cfg_shortcutGoesToChatDefault
    property bool cfg_phoneWhileAwayDefault
    property bool cfg_phoneFinishedDefault
    property string cfg_phoneDeviceDefault
    property int cfg_keepDoneHoursDefault
    property bool cfg_showUsageInPanelDefault
    property bool cfg_iconBlinkDefault
    property bool cfg_newChatInVscodeDefault
    property string cfg_newChatModelDefault
    property string cfg_newChatEffortDefault
    property string cfg_newChatModeDefault
    property int cfg_usageCapDefault
    property bool cfg_showTokensDefault
    property bool cfg_showPetDefault
    property int cfg_chatPetsDefault
    property int cfg_recentChatsDefault
    property int cfg_remotePollSecondsDefault
    property string cfg_sshHostsDefault
    property string cfg_sshUsageDefault
    property string cfg_markdownAppDefault
    property string cfg_recapCurrencyDefault
    property bool cfg_recapRulesDefault
    property bool cfg_notifySoundDefault
    property int cfg_soundVolumeDefault
    property string cfg_soundWaitingDefault
    property string cfg_soundDoneDefault
    property string cfg_soundFailedDefault

    readonly property string codeDir: decodeURIComponent(Qt.resolvedUrl("../code/").toString().replace(/^file:\/\//, ""))

    // Preview a sound (plays even with Do Not Disturb on)
    P5Support.DataSource {
        id: player
        engine: "executable"
        connectedSources: []
        onNewData: source => disconnectSource(source)
    }

    // KDE Connect: the paired phones (jump.py --phone-devices), and a test message
    property var phones: []
    property string phoneStatus: ""
    property bool kdeConnect: true

    P5Support.DataSource {
        id: phoneHelper
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            let result = null
            try {
                result = JSON.parse(data["stdout"])
            } catch (e) {
                page.phoneStatus = i18n("Couldn't ask KDE Connect")
                return
            }
            if (result.devices !== undefined) {
                page.kdeConnect = result.ok
                page.phones = result.devices
                if (!result.ok)
                    page.phoneStatus = result.message
            } else {
                page.phoneStatus = result.message
            }
        }
    }

    function jumpCommand(args) {
        const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'"
        return "python3 -I " + q(codeDir + "jump.py") + " " + args.map(q).join(" ") + " # " + Date.now()
    }

    Component.onCompleted: phoneHelper.connectSource(jumpCommand(["--phone-devices"]))

    function play(sound) {
        const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'"
        player.connectSource("python3 -I " + q(codeDir + "notify_sound.py") + " " + q(sound)
                             + " --volume " + soundVolume.value + " --force # " + Date.now())
    }

    Kirigami.FormLayout {
        QQC2.SpinBox {
            id: pollInterval
            Kirigami.FormData.label: i18n("Check every (ms):")
            from: 1000
            to: 60000
            stepSize: 500
        }

        QQC2.SpinBox {
            id: idlePollInterval
            Kirigami.FormData.label: i18n("…while nothing runs (ms):")
            from: 1000
            to: 300000
            stepSize: 1000
            QQC2.ToolTip.visible: hovered
            QQC2.ToolTip.text: i18n("While no chat runs and the popup is closed. Never more often than above; opening the popup checks at once.")
        }

        QQC2.TextField {
            id: extraDirs
            Kirigami.FormData.label: i18n("Extra config dirs:")
            placeholderText: i18n("comma separated; ~/.claude and ~/.claude-* are automatic")
        }

        QQC2.CheckBox {
            id: notifyWaiting
            Kirigami.FormData.label: i18n("Notify:")
            text: i18n("When a session needs input (permission, question)")
        }

        QQC2.CheckBox {
            id: notifyDone
            text: i18n("When a session finishes its turn")
        }

        QQC2.SpinBox {
            id: notifyDoneMinSeconds
            Kirigami.FormData.label: i18n("…if the turn took at least (s):")
            enabled: notifyDone.checked
            from: 0
            to: 3600
            stepSize: 10
        }

        QQC2.CheckBox {
            id: awayDigest
            Kirigami.FormData.label: i18n("While you're away:")
            text: i18n("Sum it all up in one notification when you're back")
        }

        QQC2.SpinBox {
            id: awayMinutes
            Kirigami.FormData.label: i18n("…once the screen was locked for (min):")
            enabled: awayDigest.checked || phoneWhileAway.checked   // the phone waits as long too
            from: 1
            to: 240
            QQC2.ToolTip.visible: hovered
            QQC2.ToolTip.text: i18n("After this long, chats that finish or need you don't notify one by one: when you unlock the screen, one notification says what happened meanwhile.")
        }

        QQC2.CheckBox {
            id: phoneWhileAway
            Kirigami.FormData.label: i18n("Phone:")
            enabled: page.kdeConnect
            text: i18n("Meanwhile, send chats that need you to my phone")
        }

        QQC2.CheckBox {
            id: phoneFinished
            enabled: page.kdeConnect && phoneWhileAway.checked
            text: i18n("…and chats that finish a turn")
        }

        RowLayout {
            Kirigami.FormData.label: i18n("…to:")
            enabled: page.kdeConnect

            QQC2.ComboBox {
                id: phoneDevice
                textRole: "text"
                valueRole: "value"
                model: [{ text: i18n("Every paired phone that's reachable"), value: "" }].concat(
                    page.phones.map(d => ({ text: d.name + (d.reachable ? "" : " " + i18n("(not reachable now)")), value: d.id })),
                    page.cfg_phoneDevice && !page.phones.some(d => d.id === page.cfg_phoneDevice)
                        ? [{ text: i18n("A phone no longer paired"), value: page.cfg_phoneDevice }] : [])
                // again once the phones are listed (the list comes after the page)
                currentIndex: { model; return Math.max(0, indexOfValue(page.cfg_phoneDevice)) }
                onModelChanged: Qt.callLater(() => currentIndex = Math.max(0, indexOfValue(page.cfg_phoneDevice)))
                onActivated: page.cfg_phoneDevice = currentValue
                Layout.preferredWidth: Kirigami.Units.gridUnit * 14
            }
            QQC2.Button {
                text: i18n("Send a test")
                icon.name: "smartphone"
                onClicked: {
                    page.phoneStatus = i18n("Sending…")
                    phoneHelper.connectSource(page.jumpCommand(["--phone", i18n("Claude Status: this is how chats that need you will show up here."),
                                                                ...(page.cfg_phoneDevice ? ["--device", page.cfg_phoneDevice] : [])]))
                }
            }
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 20
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: (page.phoneStatus ? page.phoneStatus + "\n" : "")
                  + (page.kdeConnect
                     ? i18n("Through KDE Connect, once the screen was locked as long as set above: the phone gets them while it's on the same network as this computer (pair it in System Settings → KDE Connect).")
                     : i18n("Needs KDE Connect (kdeconnect-cli), paired with your phone."))
        }

        QQC2.CheckBox {
            id: notifySound
            Kirigami.FormData.label: i18n("Sound:")
            text: i18n("Play a sound with these notifications")
        }

        RowLayout {
            Kirigami.FormData.label: i18n("Volume:")
            enabled: notifySound.checked
            QQC2.Slider {
                id: soundVolume
                from: 0
                to: 100
                stepSize: 5
                snapMode: QQC2.Slider.SnapAlways   // whole steps, not 47.82%
                Layout.preferredWidth: Kirigami.Units.gridUnit * 10
            }
            QQC2.Label {
                text: i18nc("volume in percent", "%1%", soundVolume.value)
            }
        }

        SoundChooser {
            id: soundWaiting
            Kirigami.FormData.label: i18n("Needs input:")
            enabled: notifySound.checked && notifyWaiting.checked
            onPreview: sound => page.play(sound)
        }

        SoundChooser {
            id: soundDone
            Kirigami.FormData.label: i18n("Finished:")
            enabled: notifySound.checked && notifyDone.checked
            onPreview: sound => page.play(sound)
        }

        SoundChooser {
            id: soundFailed
            Kirigami.FormData.label: i18n("Failed:")
            enabled: notifySound.checked && notifyDone.checked
            onPreview: sound => page.play(sound)
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 20
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: i18n("Sounds use your sound theme and the system's notification volume. They stay quiet while Do Not Disturb is on.")
        }

        // The usage cap: stop what an account has at work at N% of a plan window
        RowLayout {
            Kirigami.FormData.label: i18n("Usage cap:")
            QQC2.CheckBox {
                id: capOn
                text: i18n("Stop an account's chats at work when a plan limit reaches")
                checked: page.cfg_usageCap > 0
                onToggled: page.cfg_usageCap = checked ? capPct.value : 0
            }
            QQC2.SpinBox {
                id: capPct
                from: 10
                to: 100
                stepSize: 5
                value: page.cfg_usageCap > 0 ? page.cfg_usageCap : 90
                enabled: capOn.checked
                onValueModified: if (capOn.checked) page.cfg_usageCap = value
            }
            QQC2.Label {
                text: i18nc("percent sign after the usage cap", "%")
            }
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 20
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: i18n("Once an account's 5-hour or weekly window reaches it, the chats of that account that are at work on this computer are stopped, once in that window (in tmux and VS Code's Claude the turn is interrupted, the chat stays open). Queued tasks wait until the window resets, and chats that keep going go on then. Chats you start or answer yourself afterwards aren't stopped again.")
        }

        QQC2.SpinBox {
            id: keepDoneHours
            Kirigami.FormData.label: i18n("Keep finished background jobs (h):")
            from: 0
            to: 168
        }

        QQC2.SpinBox {
            id: recentChats
            Kirigami.FormData.label: i18n("Recent chats per account:")
            from: 0
            to: 20
        }

        QQC2.SpinBox {
            id: remotePollSeconds
            Kirigami.FormData.label: i18n("Check SSH hosts every (s):")
            from: 10
            to: 600
            stepSize: 10
        }

        QQC2.ComboBox {
            id: sshUsage
            readonly property var values: ["once", "all", "none"]
            Kirigami.FormData.label: i18n("Plan usage on SSH hosts:")
            model: [i18n("Once per account"), i18n("On every host"), i18n("Not on hosts")]
            currentIndex: Math.max(0, values.indexOf(page.cfg_sshUsage))
            onActivated: page.cfg_sshUsage = values[currentIndex]
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 20
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: i18n("An account logged in here and on a host (or on two hosts) has one plan usage. Once per account shows it where the account is listed first, with the newest numbers of them all.")
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 20
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: i18n("Pick SSH hosts with the server button at the top of the popup. A host that wants a password (or a passphrase, a code, its host key confirmed) shows Log in…, which opens a terminal where ssh asks for it: the widget never sees it. With your key in the agent (ssh-add) that isn't needed. The host needs python3; nothing gets installed there.")
        }

        QQC2.CheckBox {
            id: showUsage
            Kirigami.FormData.label: i18n("Panel:")
            text: i18n("Show 5-hour usage next to the icon")
        }

        QQC2.CheckBox {
            id: shortcutGoesToChat
            Kirigami.FormData.label: i18n("Keyboard shortcut:")
            text: i18n("Goes to the chat that needs you")
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 20
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: i18n("Set the key on the Keyboard Shortcuts page of these settings. It brings up the chat that has waited longest for you, then one that finished while you weren't looking; press it again for the next one. With none, it opens the popup. In the system tray, the shortcut opens the popup.")
        }

        QQC2.CheckBox {
            id: iconBlink
            Kirigami.FormData.label: i18n("Icon:")
            text: i18n("Blink while a chat needs you, pulse when one finishes")
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 20
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: i18n("Its number: red, chats that need you; green, chats that finished since you last opened the popup (turns at least as long as the \"finished\" notifications ask for). Opening the popup counts as seen.")
        }

        QQC2.Label {
            Kirigami.FormData.label: i18n("System tray:")
            Layout.maximumWidth: Kirigami.Units.gridUnit * 20
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: i18n("Claude Status can sit in the system tray too: right-click the tray's arrow → Configure System Tray… → Entries → Claude Status. \"Shown when relevant\" shows it while a chat runs. Several Claude Status widgets share these settings, and only one of them notifies.")
        }

        QQC2.CheckBox {
            id: showPet
            Kirigami.FormData.label: i18n("Pet:")
            text: i18n("Show Talpa, the pet, in the popup and in notifications")
        }

        QQC2.SpinBox {
            id: chatPets
            Kirigami.FormData.label: i18n("Chat pets per account, at most:")
            enabled: showPet.checked
            from: 0
            to: 8
        }

        QQC2.CheckBox {
            id: showTokens
            Kirigami.FormData.label: i18n("Popup:")
            text: i18n("Show token totals from local transcripts")
        }

        QQC2.ComboBox {
            id: recapCurrency
            // (the currencies of the European Central Bank's reference rates)
            readonly property var values: ["USD", "EUR", "GBP", "CHF", "JPY", "CNY", "INR", "CAD", "AUD", "NZD", "SEK", "NOK",
                                           "DKK", "PLN", "CZK", "HUF", "RON", "ISK", "TRY", "BRL", "MXN", "ZAR", "KRW", "SGD",
                                           "HKD", "ILS", "IDR", "MYR", "PHP", "THB"]
            Kirigami.FormData.label: i18n("Recap amounts in:")
            model: [i18n("US dollars (USD)"), i18n("Euros (EUR)"), i18n("Pounds sterling (GBP)"), i18n("Swiss francs (CHF)"),
                    i18n("Japanese yen (JPY)"), i18n("Chinese yuan (CNY)"), i18n("Indian rupees (INR)"),
                    i18n("Canadian dollars (CAD)"), i18n("Australian dollars (AUD)"), i18n("New Zealand dollars (NZD)"),
                    i18n("Swedish kronor (SEK)"), i18n("Norwegian kroner (NOK)"), i18n("Danish kroner (DKK)"),
                    i18n("Polish złoty (PLN)"), i18n("Czech koruny (CZK)"), i18n("Hungarian forints (HUF)"),
                    i18n("Romanian lei (RON)"), i18n("Icelandic krónur (ISK)"), i18n("Turkish lira (TRY)"),
                    i18n("Brazilian reais (BRL)"), i18n("Mexican pesos (MXN)"), i18n("South African rand (ZAR)"),
                    i18n("South Korean won (KRW)"), i18n("Singapore dollars (SGD)"), i18n("Hong Kong dollars (HKD)"),
                    i18n("Israeli shekels (ILS)"), i18n("Indonesian rupiah (IDR)"), i18n("Malaysian ringgit (MYR)"),
                    i18n("Philippine pesos (PHP)"), i18n("Thai baht (THB)")]
            currentIndex: Math.max(0, values.indexOf(page.cfg_recapCurrency))
            onActivated: page.cfg_recapCurrency = values[currentIndex]
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 20
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: i18n("Claude's API prices are in US dollars. For another currency, the Recap tab downloads the European Central Bank's reference rates of the day from ecb.europa.eu, at most every 6 hours and only while the tab is open; offline, it uses the last rates it has. Nothing about your chats is sent.")
        }

        QQC2.CheckBox {
            id: recapRules
            text: i18n("Suggest rules for the permission prompts you answered")
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 20
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: i18n("The Permissions tab offers rules that would have let those prompts go without asking, each with an Allow… button. Off, it only counts the prompts, and there's nothing to allow by mistake. Either way it lists the permissions you gave, to revoke them.")
        }

        QQC2.ComboBox {
            id: markdownApp
            readonly property var values: ["auto", "okular", "browser", "vscode", "default"]
            Kirigami.FormData.label: i18n("Open plans and runs in:")
            model: [i18n("Okular if installed, else your browser"), i18n("Okular"), i18n("Your web browser"),
                    i18n("VS Code (Markdown preview)"), i18n("Your app for Markdown files")]
            currentIndex: Math.max(0, values.indexOf(page.cfg_markdownApp))
            onActivated: page.cfg_markdownApp = values[currentIndex]
        }

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 20
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: i18n("Plans and subagent runs are Markdown. Okular shows it rendered; in your browser the widget shows it as a page of its own (it loads nothing from the internet). VS Code's preview needs the Claude Status extension for VS Code 1.13 or newer, else the file opens in its editor. Your app for Markdown files is often a text editor: a change you make there to a plan is the plan's. Whatever you pick that isn't installed, your browser shows it.")
        }
    }
}
