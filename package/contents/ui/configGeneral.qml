import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami
import org.kde.kcmutils as KCM
import org.kde.plasma.plasma5support as P5Support
import org.kde.plasma.plasmoid

KCM.SimpleKCM {
    id: page

    // Plasma writes back every cfg_ property on Apply. These two are set in
    // the popup, not here: take what they are now, so applying this page
    // doesn't put back what they were when it opened.
    function saveConfig() {
        cfg_newChatInVscode = Plasmoid.configuration.newChatInVscode
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
    property alias cfg_showTokens: showTokens.checked
    property alias cfg_showPet: showPet.checked
    property alias cfg_chatPets: chatPets.value
    property alias cfg_recentChats: recentChats.value
    property alias cfg_remotePollSeconds: remotePollSeconds.value
    property string cfg_sshHosts
    property string cfg_sshUsage
    property string cfg_markdownApp
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
    property bool cfg_showTokensDefault
    property bool cfg_showPetDefault
    property int cfg_chatPetsDefault
    property int cfg_recentChatsDefault
    property int cfg_remotePollSecondsDefault
    property string cfg_sshHostsDefault
    property string cfg_sshUsageDefault
    property string cfg_markdownAppDefault
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
