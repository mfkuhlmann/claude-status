import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami
import org.kde.kcmutils as KCM
import org.kde.plasma.plasma5support as P5Support

KCM.SimpleKCM {
    id: page

    property alias cfg_pollInterval: pollInterval.value
    property alias cfg_extraConfigDirs: extraDirs.text
    property alias cfg_notifyWaiting: notifyWaiting.checked
    property alias cfg_notifyDone: notifyDone.checked
    property alias cfg_notifyDoneMinSeconds: notifyDoneMinSeconds.value
    property alias cfg_keepDoneHours: keepDoneHours.value
    property alias cfg_showUsageInPanel: showUsage.checked
    property alias cfg_showTokens: showTokens.checked
    property alias cfg_showPet: showPet.checked
    property alias cfg_chatPets: chatPets.value
    property alias cfg_recentChats: recentChats.value
    property alias cfg_remotePollSeconds: remotePollSeconds.value
    property string cfg_sshHosts
    property alias cfg_notifySound: notifySound.checked
    property alias cfg_soundVolume: soundVolume.value
    property alias cfg_soundWaiting: soundWaiting.value
    property alias cfg_soundDone: soundDone.value
    property alias cfg_soundFailed: soundFailed.value

    // Plasma passes the defaults in too; declaring them avoids
    // "SimpleKCM does not have a property called cfg_…Default" warnings.
    property int cfg_pollIntervalDefault
    property string cfg_extraConfigDirsDefault
    property bool cfg_notifyWaitingDefault
    property bool cfg_notifyDoneDefault
    property int cfg_notifyDoneMinSecondsDefault
    property int cfg_keepDoneHoursDefault
    property bool cfg_showUsageInPanelDefault
    property bool cfg_showTokensDefault
    property bool cfg_showPetDefault
    property int cfg_chatPetsDefault
    property int cfg_recentChatsDefault
    property int cfg_remotePollSecondsDefault
    property string cfg_sshHostsDefault
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

        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 20
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: i18n("Pick SSH hosts with the server button at the top of the popup. They need key-based login (the widget can't type a password) and python3 on the host; nothing gets installed there.")
        }

        QQC2.CheckBox {
            id: showUsage
            Kirigami.FormData.label: i18n("Panel:")
            text: i18n("Show 5-hour usage next to the icon")
        }

        QQC2.CheckBox {
            id: showPet
            Kirigami.FormData.label: i18n("Pet:")
            text: i18n("Show Clawd in the popup and in notifications")
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
    }
}
