import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami

// A stage where pets (Pet.qml) live. Two kinds:
//
// hero: the big Clawd at the top of the popup, on a little stage whose light
// follows the whole dashboard (warm when a chat needs you, blue while chats
// work, green when they wait for your next message, a starry night once
// everything is done), with a headline and the session counts beside him.
//
// an account's stage (in GroupSection): one pet per chat of that account in
// the sessions list, up to a few. A pet wears the chat's name on a tag in the
// chat's color (the chat's row gets a bar in the same color), acts the chat
// out, opens it when clicked, and stays the same pet, on the same spot, until
// the chat leaves the list; then it waves and walks off.
//
// Everything stops while the popup is closed.
Item {
    id: strip

    property bool hero: false
    // An account's chats, as [{key, session, host}], the ones that get a pet first
    property var chats: []
    // Names this stage's colors in root.petColors (an account's group key)
    property string stageKey: hero ? "hero" : ""

    // All pets share the viewBox -15 -25 45 45: the character is centred,
    // 15 units wide and ~11 tall, standing on y = 16 (91% down the image).
    readonly property real gu: Kirigami.Units.gridUnit
    readonly property real imageSize: hero ? gu * 10 : gu * 6.2
    readonly property real feet: 41 / 45
    readonly property real bodyWidth: imageSize / 3
    readonly property real bodyHeight: imageSize * 11 / 45
    readonly property real tagHeight: gu * 1.05
    readonly property real margin: bodyWidth * 0.8
    // Pets stand in a row from the left, spaced so their tags fit
    readonly property real slotSpacing: spacingFor(shownChats.length)
    readonly property real tagWidth: Math.max(gu * 3.5, slotSpacing - Kirigami.Units.smallSpacing * 2)
    readonly property real chatGround: height - tagHeight - Kirigami.Units.smallSpacing
    readonly property real loneGround: height - gu * 0.55
    readonly property bool live: visible && root.expanded
    property real cursorX: -1        // mouse x while it hovers the stage
    property bool firstShown: false  // once shown, a returning pet walks in
    readonly property int maxPets: Math.max(0, Plasmoid.configuration.chatPets)
    // Colors that stay apart from each other on light and dark themes
    readonly property var petPalette: ["#e5534b", "#e8913a", "#c9a227", "#4caf50", "#26a69a", "#42a5f5", "#7e57c2", "#ec407a"]
    readonly property bool darkTheme: Kirigami.Theme.backgroundColor.hslLightness < 0.5

    readonly property var shownChats: hero || !Plasmoid.configuration.showPet ? [] : chats.slice(0, maxPets)
    readonly property int hiddenChats: hero ? 0 : Math.max(0, chats.length - shownChats.length)
    readonly property int petCount: petModel.count
    property var chatByKey: ({})
    property var order: []      // the shown chats' keys, in the order their pets came
    property var slots: ({})    // pet key → where it stands; a leaving pet keeps its spot

    // The hero's light: what the whole dashboard is up to
    readonly property string mood: root.petMood
    readonly property color moodColor: mood === "waving" ? Kirigami.Theme.neutralTextColor
                                     : mood.startsWith("working") ? Kirigami.Theme.focusColor
                                     : mood === "idle-living" ? Kirigami.Theme.positiveTextColor
                                     : mood === "error" ? Kirigami.Theme.negativeTextColor
                                     : darkTheme ? "#6f7fd0" : "#5363b8"   // night
    property real glow: 1   // pulses while a chat needs you

    // Room for what the pets hold over their heads (signs, bubbles: up to
    // half the image above the floor)
    implicitHeight: hero ? gu * 6 : gu * 4.5
    clip: true

    ListModel {
        id: petModel  // {petKey, colorIndex, leaving, label, host}; petKey "" is the hero
    }

    onShownChatsChanged: sync()
    onWidthChanged: sync()
    Component.onCompleted: sync()
    Component.onDestruction: if (root) root.dropPetColors(stageKey)   // (root may be gone at shutdown)

    // Shown and laid out: from now on the hero walks where he goes
    Timer {
        running: strip.live && !strip.firstShown
        interval: 500
        onTriggered: strip.firstShown = true
    }

    function indexOfPet(key) {
        for (let i = 0; i < petModel.count; i++)
            if (petModel.get(i).petKey === key)
                return i
        return -1
    }

    function spacingFor(n) {
        return Math.max(0, Math.min(gu * 7.5, (width - 2 * margin) / Math.max(1, n)))
    }

    // Where a pet stands: the hero on the right of his stage (under the
    // stars), a chat's pet on its spot in the row
    function slotX(key) {
        if (key === "")
            return width * 0.76
        return key in slots ? slots[key] : width / 2
    }

    // A color for a chat: its own (from its key) unless another pet wears it,
    // here or, while there are colors left, on another account's stage
    function freeColor(key) {
        let h = 0
        for (let i = 0; i < key.length; i++)
            h = (h * 31 + key.charCodeAt(i)) >>> 0
        const here = new Set(), anywhere = new Set()
        for (let i = 0; i < petModel.count; i++) {
            const p = petModel.get(i)
            if (!p.leaving && p.colorIndex >= 0)
                here.add(p.colorIndex)
        }
        for (const k in root.petColors)
            anywhere.add(petPalette.indexOf(root.petColors[k]))
        for (const used of [new Set([...here, ...anywhere]), here]) {
            let c = h % petPalette.length
            for (let n = 0; n < petPalette.length; n++, c = (c + 1) % petPalette.length)
                if (!used.has(c))
                    return c
        }
        return h % petPalette.length
    }

    // What the pets showed at the last sync: most checks change nothing for
    // them (the same chats in the same states), and then there's nothing to do
    property string syncedAs: ""

    function sync() {
        if (hero) {
            if (indexOfPet("") < 0)
                petModel.append({ petKey: "", colorIndex: -1, leaving: false, label: "", host: "" })
            return
        }
        const seen = JSON.stringify([width, shownChats.map(c => {
            const s = c.session   // what a pet shows of its chat (Pet.qml)
            return [c.key, s.state, s.reason, s.name, s.since, s.context, s.agents ? s.agents.running : 0, c.host || ""]
        })])
        if (seen === syncedAs)
            return
        syncedAs = seen
        const byKey = {}
        for (const c of shownChats)
            byKey[c.key] = c
        chatByKey = byKey
        for (let i = 0; i < petModel.count; i++) {
            const p = petModel.get(i)
            const leave = !(p.petKey in byKey)
            if (p.leaving !== leave)
                petModel.setProperty(i, "leaving", leave)
            const label = leave ? p.label : (byKey[p.petKey].session.name || "").trim()
            if (p.label !== label)
                petModel.setProperty(i, "label", label)
        }
        for (const c of shownChats)
            if (indexOfPet(c.key) < 0)
                petModel.append({ petKey: c.key, colorIndex: freeColor(c.key), leaving: false,
                                  label: (c.session.name || "").trim(), host: c.host })
        // Spots: a pet keeps its place in the row while its chat changes state
        // (the colors tie pets to rows); newcomers line up on the right
        const keys = order.filter(k => k in byKey)
        for (const c of shownChats)
            if (keys.indexOf(c.key) < 0)
                keys.push(c.key)
        order = keys
        const spacing = spacingFor(keys.length)
        const spots = {}
        for (let i = 0; i < petModel.count; i++) {
            const k = petModel.get(i).petKey
            const at = keys.indexOf(k)
            if (at >= 0)
                spots[k] = margin + (at + 0.5) * spacing
            else if (k in slots)
                spots[k] = slots[k]
        }
        if (JSON.stringify(spots) !== JSON.stringify(slots))
            slots = spots
        publishColors()
    }

    function removePet(key) {
        const i = indexOfPet(key)
        if (i >= 0 && petModel.get(i).leaving)
            petModel.remove(i)
        publishColors()
    }

    // The list shows a bar in each pet's color next to its chat
    function publishColors() {
        const colors = {}
        for (let i = 0; i < petModel.count; i++) {
            const p = petModel.get(i)
            if (p.petKey !== "" && !p.leaving && p.colorIndex >= 0)
                colors[p.petKey] = petPalette[p.colorIndex]
        }
        root.setPetColors(stageKey, colors)
    }

    function petFor(key) {
        for (let i = 0; i < pets.count; i++) {
            const p = pets.itemAt(i)
            if (p && p.petKey === key)
                return p
        }
        return null
    }

    // The chat the hero's headline is about: the first one that needs you
    readonly property var callingChat: {
        if (!hero)
            return null
        for (const g of root.allGroups)
            for (const s of g.sessions)
                if (s.state === "waiting")
                    return { session: s, host: g.host || "" }
        return null
    }

    // ------------------------------------------------------------ the stage

    // Hero: a soft card lit in the dashboard's mood
    Rectangle {
        visible: strip.hero
        anchors.fill: parent
        radius: strip.gu * 0.7
        gradient: Gradient {
            GradientStop { position: 0; color: Qt.rgba(strip.moodColor.r, strip.moodColor.g, strip.moodColor.b, 0.24 * strip.glow) }
            GradientStop { position: 1; color: Qt.rgba(strip.moodColor.r, strip.moodColor.g, strip.moodColor.b, 0.06) }
        }
        border.width: 1
        border.color: Qt.rgba(strip.moodColor.r, strip.moodColor.g, strip.moodColor.b, 0.35 * strip.glow)
    }

    SequentialAnimation on glow {
        running: strip.hero && strip.live && strip.mood === "waving"
        loops: Animation.Infinite
        NumberAnimation { to: 1.6; duration: 900; easing.type: Easing.InOutSine }
        NumberAnimation { to: 1; duration: 900; easing.type: Easing.InOutSine }
        onRunningChanged: if (!running) strip.glow = 1
    }

    // An account's stage: barely there, just a place to stand
    Rectangle {
        visible: !strip.hero
        anchors.fill: parent
        radius: strip.gu * 0.5
        color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.035)
    }

    // An account's floor
    Rectangle {
        visible: !strip.hero
        x: strip.gu * 0.6
        width: strip.width - 2 * x
        height: 1
        y: strip.chatGround
        color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.10)
    }

    // A starry night once everything is done
    Repeater {
        model: strip.hero ? 9 : 0
        delegate: PlasmaComponents3.Label {
            required property int index
            readonly property var spots: [[0.55, 0.14], [0.64, 0.36], [0.71, 0.10], [0.80, 0.30], [0.88, 0.12],
                                          [0.94, 0.40], [0.60, 0.56], [0.97, 0.66], [0.50, 0.42]]
            visible: strip.mood === "sleeping"
            x: strip.width * spots[index][0]
            y: strip.height * spots[index][1]
            text: index % 3 === 0 ? "✦" : "·"
            font.pixelSize: strip.gu * (index % 3 === 0 ? 0.6 : 1)
            color: strip.darkTheme ? "#d4dbff" : "#5363b8"
            opacity: 0.5
            SequentialAnimation on opacity {
                running: strip.live && strip.mood === "sleeping"
                loops: Animation.Infinite
                NumberAnimation { to: 0.9; duration: 900 + 260 * index; easing.type: Easing.InOutSine }
                NumberAnimation { to: 0.15; duration: 1100 + 190 * index; easing.type: Easing.InOutSine }
            }
        }
    }

    // The hero's headline (what needs you, what works) and the session counts,
    // left of where he stands
    ColumnLayout {
        visible: strip.hero
        x: strip.gu * 0.8
        y: strip.gu * 0.55
        width: Math.max(strip.gu * 8, strip.slotX("") - strip.bodyWidth / 2 - strip.gu - x)
        spacing: Kirigami.Units.smallSpacing
        z: 1

        PlasmaComponents3.Label {
            id: headline
            textFormat: Text.PlainText
            Layout.fillWidth: true
            text: root.headlineText()
            font.pixelSize: Math.round(strip.gu * 1.0)
            font.weight: Font.DemiBold
            font.underline: headlineMouse.containsMouse
            color: strip.mood === "waving" ? Kirigami.Theme.neutralTextColor : Kirigami.Theme.textColor
            elide: Text.ElideRight

            // "1 chat needs you": click to go there
            MouseArea {
                id: headlineMouse
                // the words only: Clawd may stand under the rest of the line, and he's grabbed there
                width: Math.min(parent.width, parent.paintedWidth)
                height: parent.height
                enabled: strip.callingChat !== null
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                    const c = strip.callingChat
                    if (c && c.host)
                        root.remoteShow(c.host, c.session)
                    else if (c)
                        root.jumpTo(c.session.sessionId, c.session.profileDir)
                }
                PlasmaCore.ToolTipArea {
                    textFormat: Text.PlainText
                    anchors.fill: parent
                    active: strip.callingChat !== null
                    mainText: strip.callingChat ? i18n("Open %1", strip.callingChat.session.name) : ""
                    subText: strip.callingChat ? (strip.callingChat.host ? strip.callingChat.host + " · " : "")
                                                 + root.stateText(strip.callingChat.session) : ""
                }
            }
        }

        Flow {
            Layout.fillWidth: true
            spacing: Kirigami.Units.largeSpacing
            visible: strip.hero && root.status !== null

            Repeater {
                model: !strip.hero ? [] : [
                    { state: "waiting", n: root.counts.waiting, text: i18np("%1 needs input", "%1 need input", root.counts.waiting) },
                    { state: "working", n: root.counts.working, text: i18n("%1 working", root.counts.working) },
                    { state: "idle", n: root.counts.idle, text: i18n("%1 idle", root.counts.idle) },
                    { state: "done", n: root.counts.done, text: i18n("%1 done", root.counts.done) }
                ].filter(c => c.n > 0)
                delegate: Row {
                    required property var modelData
                    spacing: Kirigami.Units.smallSpacing
                    Rectangle {
                        anchors.verticalCenter: parent.verticalCenter
                        width: Math.round(strip.gu * 0.45)
                        height: width
                        radius: width / 2
                        color: root.stateColor(modelData.state)
                    }
                    PlasmaComponents3.Label {
                        textFormat: Text.PlainText
                        text: modelData.text
                        font: Kirigami.Theme.smallFont
                        opacity: 0.85
                    }
                }
            }

            PlasmaComponents3.Label {
                textFormat: Text.PlainText
                visible: root.counts.waiting + root.counts.working + root.counts.idle + root.counts.done === 0
                text: i18n("No sessions running")
                font: Kirigami.Theme.smallFont
                opacity: 0.7
            }
        }
    }

    // ------------------------------------------------------------ the pets

    Repeater {
        id: pets
        model: petModel
        // (Pet has properties named like the roles: read them through model,
        // and reach the stage as pets.parent)
        delegate: Pet {
            required property var model
            strip: pets.parent
            petKey: model.petKey
            leaving: model.leaving
            label: model.label
            host: model.host
            tint: model.colorIndex >= 0 ? pets.parent.petPalette[model.colorIndex] : "transparent"
            chat: pets.parent.chatByKey[model.petKey] ? pets.parent.chatByKey[model.petKey].session : null
            homeX: pets.parent.slotX(model.petKey)
            isMain: pets.parent.hero
            onGone: pets.parent.removePet(model.petKey)
        }
    }

    // More chats than pets: say how many
    PlasmaComponents3.Label {
        textFormat: Text.PlainText
        visible: strip.hiddenChats > 0
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.margins: Kirigami.Units.smallSpacing
        text: i18nc("more chats than pets", "+%1", strip.hiddenChats)
        opacity: 0.7
        font: Kirigami.Theme.smallFont
        z: 2

        PlasmaCore.ToolTipArea {
            textFormat: Text.PlainText
            anchors.fill: parent
            mainText: i18np("%1 more chat", "%1 more chats", strip.hiddenChats)
            subText: i18n("Up to %1 pets per account, the chats that need you or work first; the list shows them all.", strip.maxPets)
        }
    }

    // ------------------------------------------------------------ shared by the pets

    function say(pet, text) {
        bubbleBox.owner = pet
        bubble.text = text
        bubbleTimer.restart()
    }

    function burst(pet, symbol, color, count) {
        for (let i = 0; i < count; i++)
            particle.createObject(strip, {
                text: symbol, color: color,
                x: pet.px - gu * 0.4 + (Math.random() - 0.5) * bodyWidth,
                y: pet.ground - pet.lift - bodyHeight - gu * 0.6 - Math.random() * gu * 0.5
            })
    }

    Timer {
        id: bubbleTimer
        interval: 4500
        onTriggered: bubble.text = ""
    }

    // Floating hearts, notes, sparkles and z's
    Component {
        id: particle
        PlasmaComponents3.Label {
            id: bit
            readonly property real drift: (Math.random() - 0.5) * strip.gu * 2
            font.pixelSize: strip.gu * 0.9
            font.bold: true
            z: 2
            ParallelAnimation {
                running: true
                NumberAnimation { target: bit; property: "y"; to: bit.y - strip.gu * 2.4; duration: 1500; easing.type: Easing.OutQuad }
                NumberAnimation { target: bit; property: "x"; to: bit.x + bit.drift; duration: 1500 }
                NumberAnimation { target: bit; property: "opacity"; from: 1; to: 0; duration: 1500; easing.type: Easing.InQuad }
                onFinished: bit.destroy()
            }
        }
    }

    // Speech bubble above whoever speaks, or beside him when there's no room above
    Rectangle {
        id: bubbleBox
        property Item owner: null
        readonly property real ownerX: owner ? owner.px : strip.width / 2
        readonly property real headTop: owner ? owner.ground - owner.lift - strip.bodyHeight : strip.height
        readonly property bool roomAbove: headTop - height - Kirigami.Units.smallSpacing >= 0
        readonly property bool rightSide: ownerX + strip.bodyWidth / 2 + width + Kirigami.Units.smallSpacing <= strip.width
        visible: bubble.text !== "" && owner !== null
        z: 3
        width: Math.min(bubble.implicitWidth + Kirigami.Units.largeSpacing, strip.width)
        height: bubble.implicitHeight + Kirigami.Units.smallSpacing
        x: roomAbove ? Math.max(0, Math.min(strip.width - width, ownerX - width / 2))
                     : rightSide ? ownerX + strip.bodyWidth / 2 + Kirigami.Units.smallSpacing
                                 : Math.max(0, ownerX - strip.bodyWidth / 2 - width - Kirigami.Units.smallSpacing)
        y: roomAbove ? headTop - height - Kirigami.Units.smallSpacing : Math.max(0, headTop)
        radius: height / 2
        color: Kirigami.Theme.backgroundColor
        border.width: 1
        border.color: Qt.rgba(Kirigami.Theme.textColor.r, Kirigami.Theme.textColor.g, Kirigami.Theme.textColor.b, 0.3)

        PlasmaComponents3.Label {
            id: bubble
            anchors.centerIn: parent
            width: Math.min(implicitWidth, strip.width - Kirigami.Units.largeSpacing)
            elide: Text.ElideRight
            font: Kirigami.Theme.smallFont
        }
    }

    HoverHandler {
        onPointChanged: strip.cursorX = hovered ? point.position.x : -1
        onHoveredChanged: if (!hovered) strip.cursorX = -1
    }

    // Events go to the chat's own pet; the hero takes the ones about everything
    // (and the ones for a chat that has no pet)
    Connections {
        target: root
        function onPetEvent(kind, text, key) {
            let pet = null
            if (strip.hero)
                pet = !key || !(key in root.petColors) ? strip.petFor("") : null
            else if (key)
                pet = strip.petFor(key)
            if (pet)
                pet.event(kind, text)
        }
    }
}
