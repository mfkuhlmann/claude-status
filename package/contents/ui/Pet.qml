import QtQuick
import org.kde.plasma.components as PlasmaComponents3
import org.kde.plasma.core as PlasmaCore
import org.kde.kirigami as Kirigami

// One Clawd on the pet strip (PetStrip.qml; artwork: clawd-pet, MIT).
//
// The lone Clawd (petKey "") mirrors all your sessions and has a life of his
// own: he wanders, follows your mouse, has hobbies, naps, dresses for the
// season and reacts to you. Click to pet him (many quick clicks tickle),
// double-click to make him dance, drag him to pick him up and drop him.
//
// A chat's pet stands for one chat in the sessions list: it acts that chat out
// (works, calls you, rests while it's idle, sleeps once it's done, looks sad if
// it failed), wears its name and color, walks in when the chat shows up and
// off when it leaves the list, and opens the chat when clicked (drag him for fun).
Item {
    id: pet

    required property Item strip
    property string petKey: ""          // the chat's key ("" for the lone Clawd)
    readonly property bool lone: petKey === ""
    property var chat: null             // the chat's session row, null once it's done
    property var lastChat: null         // the last one seen (opened when clicked)
    property string host: ""            // SSH host of the chat, if any
    property string label: ""           // short name on his tag
    property color tint: "transparent"  // the chat's color
    property real homeX: strip.width / 2
    property bool leaving: false
    property bool isMain: false         // shows the account-wide things (usage limits)
    signal gone()

    onChatChanged: if (chat) lastChat = chat

    readonly property string mood: lone ? root.petMood
                                 : !chat ? (leaving ? "waving" : "sleeping")   // its chat left the list: bye
                                 : chat.state === "waiting" ? "waving"
                                 : chat.state === "working" ? (chat.agents && chat.agents.running > 0 ? "working-juggling"
                                                                                                       : "working-typing")
                                 : chat.state === "idle" ? "idle-living"       // ready for your next message
                                 : chat.reason === "failed" ? "sad"
                                 : "sleeping"                                  // done: results to look at

    // All pets share the viewBox -15 -25 45 45: the character is centred,
    // 15 units wide and ~11 tall, standing on y = 16 (91% down the image).
    readonly property real gu: strip.gu
    readonly property real imageSize: strip.imageSize
    readonly property real feet: strip.feet
    readonly property real bodyWidth: strip.bodyWidth
    readonly property real bodyHeight: strip.bodyHeight
    readonly property real ground: lone ? strip.loneGround : strip.chatGround
    readonly property real minX: bodyWidth / 2 + Kirigami.Units.smallSpacing
    readonly property real maxX: Math.max(minX, strip.width - bodyWidth / 2 - Kirigami.Units.smallSpacing)
    readonly property bool live: strip.live
    readonly property bool playing: strip.playing   // not under a window: he moves

    // Where he is: px = horizontal centre, lift = height above the ground.
    property real px: homeX
    property real lift: 0
    property real squash: 1        // < 1 squashed (landing), > 1 stretched
    property real breath: 1        // gentle breathing, so he never looks frozen
    readonly property int breathHalf: mood.startsWith("working") ? 260 : mood === "sleeping" ? 1600 : 1100
    property bool facingLeft: false
    property bool held: false
    property bool moving: false
    property bool running: false
    property bool offstage: false  // walking in from / out to the edge
    property string action: ""     // something he chose to do (smile, coffee…)
    property string reaction: ""   // a reaction to you or an event (love, dizzy…)
    property double reactionUntil: 0
    property int quickClicks: 0
    property int sleepyClicks: 0
    property string lastMood: ""
    property bool heldLong: false
    property bool restarting: false  // moveTo turning a walk around: not an arrival

    // What he does while Claude works, waits for you, or runs subagents:
    // switched now and then so he isn't stuck in one pose.
    readonly property var workPoses: ["working-typing", "working-thinking", "coding", "working-testing",
                                      "working-reviewing", "working-debugger", "working-building",
                                      "working-tool-calling", "working-deploying", "working-rubber-duck",
                                      "working-wizard"]
    readonly property var agentPoses: ["working-juggling", "working-conducting", "working-pairing"]
    readonly property var waitPoses: ["waving", "working-oncall", "notification", "mail", "working-beacon", "praying"]
    property string workPose: pick(workPoses, "")
    property string agentPose: "working-juggling"
    property string waitPose: "working-oncall"   // the alert sign first: it reads best

    readonly property string moodPose: mood === "working-typing" ? workPose
                                     : mood === "working-juggling" ? agentPose
                                     : mood === "waving" ? waitPose
                                     : mood
    readonly property string pose: held ? (heldLong ? "scared" : "surprised")
                                 : reaction !== "" ? reaction
                                 : moving ? (running ? "running" : "crab-walking")
                                 : action !== "" ? action
                                 : moodPose

    anchors.fill: parent

    Component.onCompleted: {
        lastMood = mood
        if (lone && !strip.firstShown) {
            px = homeX   // the first time the popup opens he's just there
            return
        }
        // walk in from the nearest edge
        const fromLeft = homeX < strip.width / 2
        px = fromLeft ? -imageSize / 2 : strip.width + imageSize / 2
        facingLeft = !fromLeft
        offstage = true
        enterTimer.start()
    }
    onHomeXChanged: {
        if (lone && !strip.firstShown) {
            px = homeX   // laid out before anyone saw him: he's just there
            return
        }
        if (!leaving && !held && !offstage)
            moveTo(homeX, true)
        else if (offstage && !leaving && !held && moving)
            moveTo(homeX, true, true)   // still walking in: to where its spot is now
    }
    // The strip got narrower: back inside it
    onMaxXChanged: if (!offstage && !held && px > maxX) moveTo(maxX, true)
    onLeavingChanged: {
        if (leaving) {
            leaveTimer.interval = Math.max(300, reactionUntil - Date.now() + 300)
            leaveTimer.restart()
        } else {
            leaveTimer.stop()
            offstage = false
            if (!held)
                moveTo(homeX, true)
        }
    }
    onLiveChanged: {
        if (!live || !lone || mood === "sleeping" || mood === "loading")
            return
        const holiday = holidayGreeting()
        if (holiday.text) {
            react(holiday.pose, holiday.text, 3500)
            hop(gu * 0.6)
        } else if (Math.random() < 0.6) {
            hop(gu * 0.6)
            say(i18n("Hi!"))
        }
    }
    onMoodChanged: {
        if (!offstage)
            stopMoving()
        action = ""
        if (lastMood === "sleeping" && mood !== "sleeping" && mood !== "waving")
            doAction("yawning", 1800)          // woken up by work
        lastMood = mood
    }

    // ------------------------------------------------------------ actions

    function clampX(x) {
        return Math.max(minX, Math.min(maxX, x))
    }

    // Walk (or run) to x; anywhere: x may be off the strip (entering, leaving)
    function moveTo(x, fast, anywhere) {
        if (!anywhere)
            x = clampX(x)
        if (Math.abs(x - px) < Kirigami.Units.smallSpacing)
            return
        facingLeft = x < px
        running = fast
        action = ""
        stride.to = x
        stride.duration = Math.abs(x - px) / (gu * (fast ? 6 : 2)) * 1000
        moving = true
        // restart() stops a walk under way first, and that fires onStopped
        restarting = true
        stride.restart()
        restarting = false
    }

    function stopMoving() {
        stride.stop()
    }

    function react(pose, text, ms) {
        if (!offstage)
            stopMoving()
        action = ""
        reaction = pose
        reactionTimer.interval = ms || 2500
        reactionUntil = Date.now() + reactionTimer.interval
        reactionTimer.restart()
        if (text)
            say(text)
    }

    function doAction(pose, ms) {
        action = pose
        actionTimer.interval = ms
        actionTimer.restart()
    }

    function say(text) {
        strip.say(pet, text)
    }

    function burst(symbol, color, count) {
        if (live)   // with the popup closed they'd pile up until it opens
            strip.burst(pet, symbol, color, count)
    }

    // A random element of list, not the same as last if there's a choice
    function pick(list, last) {
        const choices = list.length > 1 ? list.filter(x => x !== last) : list
        return choices[Math.floor(Math.random() * choices.length)]
    }

    // Seasons (northern hemisphere, by month) and a few days of the year
    function seasonPose() {
        const m = new Date().getMonth()
        return m === 11 || m <= 1 ? "winter" : m <= 4 ? "spring" : m <= 7 ? "summer" : "autumn"
    }

    function holidayGreeting() {
        const d = new Date(), m = d.getMonth() + 1, day = d.getDate()
        if ((m === 12 && day === 31) || (m === 1 && day === 1))
            return { pose: "new-year", text: i18n("Happy New Year!") }
        if (m === 12 && day >= 24 && day <= 26)
            return { pose: "christmas", text: i18n("Merry Christmas!") }
        if (m === 10 && day === 31)
            return { pose: "halloween", text: i18n("Boo! Happy Halloween!") }
        if (m === 2 && day === 14)
            return { pose: "valentine", text: i18n("Happy Valentine's Day!") }
        return { pose: "", text: "" }
    }

    function hop(height) {
        if (held || lift > 0)
            return
        hopUp.to = height || gu * 0.8
        hopAnimation.restart()
    }

    // Clicked: the lone Clawd gets petted, a chat's pet opens its chat
    function clicked() {
        if (lone) {
            petHim()
            return
        }
        const c = lastChat
        if (!c)
            return
        if (host)
            root.remoteShow(host, c)
        else
            root.jumpTo(c.sessionId, c.profileDir)
    }

    function petHim() {
        if (mood === "sleeping") {
            sleepyClicks += 1
            tickleTimer.restart()
            if (sleepyClicks >= 3) {
                sleepyClicks = 0
                react("angry", i18n("I said let me SLEEP!"), 2500)
                burst("!", Kirigami.Theme.negativeTextColor, 2)
            } else {
                react("grumpy", i18n("Zzz… let me sleep."), 2500)
            }
            return
        }
        quickClicks += 1
        tickleTimer.restart()
        if (quickClicks >= 4) {
            quickClicks = 0
            react("laughing", i18n("Hehe, that tickles!"), 2500)
            burst("♥", "#ff6b8a", 4)
        } else if (quickClicks === 3) {
            react("embarrassed", i18n("Aww, stop it…"), 2000)
            burst("♥", "#ff6b8a", 3)
        } else {
            react(Math.random() < 0.7 ? "love" : "happy", petLine(), 2000)
            burst("♥", "#ff6b8a", 2)
        }
        hop()
    }

    function dance() {
        if (mood === "sleeping") {
            react("yawning", i18n("…five more minutes."), 2500)
            return
        }
        react(pick(["dancing", "dancing", "dj", "music", "singing"]), "♪ ♫", 3500)
        burst("♪", Kirigami.Theme.focusColor, 3)
    }

    function pickUp() {
        held = true   // first: a walk that stops now isn't an arrival or a departure
        fall.stop()   // grabbed again while falling
        stopMoving()
        reaction = ""
        action = ""
        hopAnimation.stop()
        landing.stop()
        heldLong = false
        heldTimer.restart()
        say(i18n("Whoa!"))
    }

    function drop() {
        held = false
        heldTimer.stop()
        fall.duration = Math.max(160, Math.sqrt(lift / gu) * 230)
        fall.restart()
    }

    function landed(fromHeight) {
        landing.restart()
        if (fromHeight > gu * 2.6)
            react("sick", i18n("Ugh… I don't feel so good."), 2600)
        else if (fromHeight > gu * 1.5)
            react("dizzy", i18n("Ouch… the room is spinning."), 2200)
        heldLong = false
        if (leaving)
            leaveTimer.restart()   // its chat left while you held it: now it goes
    }

    function petLine() {
        if (mood === "waving")
            return i18n("%1 needs you!", root.waitingName)
        if (mood === "working-juggling")
            return i18np("Juggling %1 agent!", "Juggling %1 agents!", root.agentsRunning)
        if (mood === "working-typing")
            return i18n("Busy coding… thanks!")
        const lines = [i18n("Hi!"), "♥", i18n("Ship it!"), i18n("All quiet here."), i18n("Pet me more!")]
        return lines[Math.floor(Math.random() * lines.length)]
    }

    // Hobbies for quiet moments (with what he says, sometimes)
    readonly property var hobbies: [
        { pose: "reading", text: i18n("Reading the docs…") },
        { pose: "music", text: "♪" },
        { pose: "gaming", text: "" },
        { pose: "meditating", text: i18n("Ommm…") },
        { pose: "yoga", text: "" },
        { pose: "eating", text: i18n("Snack time!") },
        { pose: "ice-cream", text: "" },
        { pose: "painting", text: "" },
        { pose: "gardening", text: "" },
        { pose: "studying", text: i18n("Learning new tricks.") },
        { pose: "singing", text: "♪ ♫" },
        { pose: "telescope", text: i18n("Any bugs out there?") },
        { pose: "peeking", text: "" },
        { pose: "photography", text: i18n("Say cheese!") },
        { pose: "drumming", text: "" },
        { pose: "magic", text: i18n("Ta-da!") },
        { pose: "chef", text: "" },
        { pose: "idea", text: i18n("I have an idea!") },
        { pose: "cool", text: "" },
        { pose: "bored", text: i18n("So quiet…") },
        { pose: "shrug", text: "" },
        { pose: "hopeful", text: "" },
        { pose: "flexing", text: "" },
        { pose: "skeptical", text: "" },
        { pose: "going-away", text: i18n("Brb!") }
    ]
    property string lastHobby: ""

    function doHobby(quiet) {
        let h = hobbies[Math.floor(Math.random() * hobbies.length)]
        if (h.pose === lastHobby)
            h = hobbies[(hobbies.indexOf(h) + 1) % hobbies.length]
        lastHobby = h.pose
        doAction(h.pose, 5000)
        if (!quiet && h.text && Math.random() < 0.5)
            say(h.text)
    }

    // What the lone Clawd does by himself when nothing in particular is going on.
    function idleChoice() {
        const cursorX = strip.cursorX
        if (cursorX >= 0 && Math.abs(cursorX - px) > bodyWidth * 0.8) {
            moveTo(cursorX, Math.abs(cursorX - px) > strip.width / 3)      // follow the mouse
            return
        }
        const r = Math.random()
        const anywhere = minX + Math.random() * (maxX - minX)
        if (r < 0.26) moveTo(anywhere, false)
        else if (r < 0.32) moveTo(anywhere, true)
        else if (r < 0.42) { facingLeft = !facingLeft; lookBack.restart() }
        else if (r < 0.48) hop()
        else if (r < 0.53) doAction("smile", 2500)
        else if (r < 0.58) doAction("coffee", 4500)
        else if (r < 0.61) { doAction("dancing", 2500); burst("♪", Kirigami.Theme.focusColor, 2) }
        else if (r < 0.64) doAction("yawning", 2500)
        else if (r < 0.80) doHobby()
        else if (r < 0.85) {
            // dressed for the day or the season
            const holiday = holidayGreeting()
            const season = seasonPose()
            doAction(holiday.pose || (season === "winter" && Math.random() < 0.3 ? "snow" : season), 5000)
        }
        // otherwise: just stand there for a bit
    }

    // What a chat's pet does: stays near its spot and acts its chat out
    function chatChoice() {
        if (Math.abs(px - homeX) > bodyWidth * 0.7) {
            moveTo(homeX, false)      // dragged away: back to its spot
            return
        }
        const r = Math.random()
        if (mood === "waving") {
            hop(gu * 0.9)
            if (r < 0.3)
                say(i18n("%1 needs you!", label))
            else if (r < 0.6)
                burst("!", Kirigami.Theme.neutralTextColor, 1)
        } else if (mood === "sleeping") {
            if (r < 0.5)
                burst("z", Kirigami.Theme.disabledTextColor, 1)
        } else if (mood === "idle-living") {
            // awake and relaxed, waiting for your next message (quietly: the
            // speech bubble is for things that matter)
            if (r < 0.15) facingLeft = !facingLeft
            else if (r < 0.25) moveTo(homeX + (Math.random() - 0.5) * bodyWidth * 0.8, false)
            else if (r < 0.32) doAction("smile", 2500)
            else if (r < 0.38) doAction("coffee", 4000)
            else if (r < 0.50) doHobby(true)
        } else if (mood !== "sad") {
            if (r < 0.2)
                facingLeft = !facingLeft            // busy, but glances around
            else if (r < 0.3)
                moveTo(homeX + (Math.random() - 0.5) * bodyWidth * 0.6, false)
        }
    }

    // Something happened to his chat (or, for the main pet, to an account)
    function event(kind, text) {
        if (held)
            return
        if (kind === "done") {
            react(pick(["celebrating", "celebrating", "clapping", "trophy", "shipping", "rocket",
                        "200", "star", "happy", "flexing"]), text, 3000)
            burst("✦", Kirigami.Theme.neutralTextColor, 4)
            hop(gu)
        } else if (kind === "failed") {
            react(pick(["facepalm", "sad", "crying", "working-firefighting"]), text, 3500)
            burst("✗", Kirigami.Theme.negativeTextColor, 2)
        } else if (kind === "stopped") {
            react("shrug", text, 2500)
        } else if (kind === "oops") {
            react("confused", text, 3000)
            burst("?", Kirigami.Theme.neutralTextColor, 2)
        } else if (kind === "reset") {
            react(pick(["charging", "celebrating"]), text, 3000)
            burst("⚡", Kirigami.Theme.neutralTextColor, 3)
            hop(gu)
        } else {
            say(text)
            burst("!", Kirigami.Theme.neutralTextColor, 1)
            hop()
        }
    }

    // ------------------------------------------------------------ timers

    Timer {
        id: enterTimer
        interval: 60
        onTriggered: pet.moveTo(pet.homeX, true, true)
    }

    Timer {
        id: leaveTimer
        onTriggered: {
            if (pet.held)
                return   // dropped, it goes on (landed)
            pet.reaction = ""
            pet.offstage = true
            pet.moveTo(pet.px < pet.strip.width / 2 ? -pet.imageSize / 2 : pet.strip.width + pet.imageSize / 2, true, true)
        }
    }

    Timer {
        id: brain
        interval: 3000
        repeat: true
        running: pet.playing && !pet.held && !pet.leaving && !pet.offstage
        onTriggered: {
            interval = 2000 + Math.random() * 3000
            if (pet.reaction !== "" || pet.moving || pet.action !== "")
                return
            if (!pet.lone)
                pet.chatChoice()
            else if (pet.mood === "idle-living")
                pet.idleChoice()
            else if (pet.mood === "waving") {
                pet.hop(pet.gu * 0.9)
                if (Math.random() < 0.25 && root.waitingName)
                    pet.say(i18n("%1 needs you!", root.waitingName))
            } else if (pet.mood === "sleeping")
                pet.burst("z", Kirigami.Theme.disabledTextColor, 1)
            else if (Math.random() < 0.2)
                pet.facingLeft = !pet.facingLeft            // busy, but glances around
        }
    }

    // The lone Clawd turns towards the mouse while it hovers the strip
    Timer {
        interval: 350
        repeat: true
        running: pet.playing && pet.lone && pet.strip.cursorX >= 0 && !pet.moving && !pet.held && pet.mood !== "sleeping"
        onTriggered: {
            if (Math.abs(pet.strip.cursorX - pet.px) > pet.bodyWidth * 0.4)
                pet.facingLeft = pet.strip.cursorX < pet.px
        }
    }

    Timer {
        id: lookBack
        interval: 900
        onTriggered: pet.facingLeft = !pet.facingLeft
    }

    Timer {
        id: reactionTimer
        onTriggered: pet.reaction = ""
    }

    Timer {
        id: actionTimer
        onTriggered: pet.action = ""
    }

    Timer {
        id: tickleTimer
        interval: 1500
        onTriggered: {
            pet.quickClicks = 0
            pet.sleepyClicks = 0
        }
    }

    // Held up in the air for a while: he gets scared
    Timer {
        id: heldTimer
        interval: 2200
        onTriggered: if (pet.held) pet.heldLong = true
    }

    // A different work pose now and then while Claude works
    Timer {
        interval: 14000
        repeat: true
        running: pet.playing && pet.mood.startsWith("working") && pet.reaction === ""
        onTriggered: {
            interval = 10000 + Math.random() * 10000
            if (pet.mood === "working-juggling")
                pet.agentPose = pet.pick(pet.agentPoses, pet.agentPose)
            else
                pet.workPose = pet.pick(pet.workPoses, pet.workPose)
        }
    }

    // ...and while a session waits for you
    Timer {
        interval: 6000
        repeat: true
        running: pet.playing && pet.mood === "waving" && pet.reaction === ""
        onTriggered: pet.waitPose = pet.pick(pet.waitPoses, pet.waitPose)
    }

    // A working session's context window is nearly full: point it out now and
    // then (a chat's pet for its own chat, the hero for chats without a pet)
    readonly property string contextFullText: !lone ? (chat && chat.state === "working" && chat.context !== null && chat.context >= 85
                                                       ? i18n("%1: context %2% full", label, Math.round(chat.context)) : "")
                                                    : root.contextFullText
    Timer {
        interval: 40000
        repeat: true
        running: pet.playing && pet.contextFullText !== "" && pet.mood.startsWith("working") && !pet.leaving
        triggeredOnStart: true
        onTriggered: {
            if (!pet.held && pet.reaction === "")
                pet.react("working-context-full", pet.contextFullText, 3500)
        }
    }

    // Close to a usage limit: look mind-blown (or overheated, or low on
    // battery) now and then, then carry on. At the limit: 429.
    Timer {
        interval: 25000
        repeat: true
        running: pet.playing && pet.isMain && root.highUsageText !== "" && pet.mood !== "sleeping" && !pet.leaving
        triggeredOnStart: true
        onTriggered: {
            if (pet.held || pet.reaction !== "")
                return
            const pose = root.maxFiveHour >= 100 ? "429"
                       : pet.pick(["mindblown", "mindblown", "working-overheated", "battery-low"])
            pet.react(pose, root.highUsageText, 3500)
        }
    }

    // ------------------------------------------------------------ motion

    NumberAnimation {
        id: stride
        target: pet
        property: "px"
        easing.type: Easing.InOutSine
        onStopped: {
            if (pet.restarting)
                return
            pet.moving = false
            pet.running = false
            if (pet.leaving && pet.offstage && !pet.held)
                pet.gone()
            else
                pet.offstage = false
        }
    }

    SequentialAnimation {
        id: hopAnimation
        NumberAnimation { id: hopUp; target: pet; property: "lift"; duration: 170; easing.type: Easing.OutQuad }
        NumberAnimation { target: pet; property: "lift"; to: 0; duration: 230; easing.type: Easing.InQuad }
        ScriptAction { script: landing.restart() }
    }

    NumberAnimation {
        id: fall
        target: pet
        property: "lift"
        to: 0
        easing.type: Easing.InQuad
        property real fromHeight: 0
        onStarted: fromHeight = pet.lift
        onFinished: pet.landed(fromHeight)
    }

    // Breathing: slow when idle or asleep, quick while he types. Most of the
    // pets' own CSS animations don't play in Qt, so this keeps him alive.
    SequentialAnimation {
        running: pet.playing && !pet.held && !pet.moving
        loops: Animation.Infinite
        NumberAnimation { target: pet; property: "breath"; to: 0.94; duration: pet.breathHalf; easing.type: Easing.InOutSine }
        NumberAnimation { target: pet; property: "breath"; to: 1; duration: pet.breathHalf; easing.type: Easing.InOutSine }
        onRunningChanged: if (!running) pet.breath = 1
    }

    // squash on landing, then a little stretch back
    SequentialAnimation {
        id: landing
        NumberAnimation { target: pet; property: "squash"; to: 0.72; duration: 80; easing.type: Easing.OutQuad }
        NumberAnimation { target: pet; property: "squash"; to: 1.12; duration: 120; easing.type: Easing.OutQuad }
        NumberAnimation { target: pet; property: "squash"; to: 1; duration: 150; easing.type: Easing.InOutQuad }
    }

    // ------------------------------------------------------------ drawing

    // Under him: the chat's color as a soft ring, or the hero's shadow
    Rectangle {
        width: pet.bodyWidth * (pet.lone ? 1.25 : 1.15)
        height: pet.gu * (pet.lone ? 0.5 : 0.42)
        radius: height / 2
        x: pet.px - width / 2
        y: pet.ground - height / 2
        color: pet.lone ? Kirigami.Theme.textColor : pet.tint
        opacity: (pet.lone ? 0.13 : 0.45) * (1 - Math.min(1, pet.lift / (pet.gu * 3)))
    }

    // His pose: animated (PetImage.qml) where Qt can, a still image elsewhere
    Item {
        id: image
        readonly property url poseUrl: Qt.resolvedUrl("../pets/clawd-" + pet.pose + ".svg")
        width: pet.imageSize
        height: width
        x: pet.px - width / 2
        y: pet.ground - height * pet.feet - pet.lift
        transform: Scale {
            origin.x: image.width / 2
            origin.y: image.height * pet.feet
            xScale: (pet.facingLeft ? -1 : 1) * (2 - pet.squash)
            yScale: pet.squash * pet.breath
        }

        Loader {
            id: animated
            anchors.fill: parent
            active: root.animatedPets
            source: "PetImage.qml"
            Binding {
                target: animated.item
                when: animated.status === Loader.Ready
                property: "source"
                value: image.poseUrl
            }
            Binding {
                target: animated.item
                when: animated.status === Loader.Ready
                property: "playing"
                value: pet.playing
            }
        }
        Image {
            anchors.fill: parent
            visible: animated.status !== Loader.Ready
            source: visible ? image.poseUrl : ""
            sourceSize: Qt.size(width, height)
            fillMode: Image.PreserveAspectFit
        }
    }

    // Name tag under his feet, in the chat's color
    Rectangle {
        id: tag
        visible: !pet.lone && pet.label !== ""
        readonly property bool darkTint: (pet.tint.r * 0.299 + pet.tint.g * 0.587 + pet.tint.b * 0.114) < 0.6
        width: Math.min(tagText.implicitWidth + Kirigami.Units.smallSpacing * 2, pet.strip.tagWidth)
        height: tagText.implicitHeight + 2
        radius: height / 2
        x: pet.px - width / 2   // follows him, also when he walks in or off
        y: pet.ground + 2
        color: pet.tint

        PlasmaComponents3.Label {
            id: tagText
            textFormat: Text.PlainText
            anchors.centerIn: parent
            width: Math.min(implicitWidth, pet.strip.tagWidth - Kirigami.Units.smallSpacing * 2)
            text: pet.label
            elide: Text.ElideRight
            font.pixelSize: Kirigami.Theme.smallFont.pixelSize * 0.95
            color: tag.darkTint ? "white" : "black"
        }

        MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: pet.clicked()
        }
    }

    // ------------------------------------------------------------ input

    // Grab area around his body (in strip coordinates, so flipping doesn't move it)
    MouseArea {
        id: grab
        property point pressedAt
        property bool dragging: false
        x: pet.px - width / 2
        y: pet.ground - pet.lift - height
        width: pet.bodyWidth + Kirigami.Units.largeSpacing
        height: pet.bodyHeight + Kirigami.Units.largeSpacing
        cursorShape: pet.held ? Qt.ClosedHandCursor : pet.lone ? Qt.OpenHandCursor : Qt.PointingHandCursor
        preventStealing: true
        hoverEnabled: !pet.lone

        onPressed: mouse => {
            pressedAt = mapToItem(pet, mouse.x, mouse.y)
            dragging = false
        }
        onPositionChanged: mouse => {
            if (!pressed)
                return
            const p = mapToItem(pet, mouse.x, mouse.y)
            if (!dragging && Math.hypot(p.x - pressedAt.x, p.y - pressedAt.y) > pet.gu * 0.5) {
                dragging = true
                pet.pickUp()
            }
            if (dragging) {
                pet.px = pet.clampX(p.x)
                pet.lift = Math.max(0, Math.min(pet.ground - pet.bodyHeight, pet.ground - p.y - pet.bodyHeight / 2))
            }
        }
        onReleased: {
            if (dragging)
                pet.drop()
        }
        onClicked: {
            if (!dragging)
                pet.clicked()
        }
        onDoubleClicked: {
            if (!dragging && pet.lone)
                pet.dance()
        }

        PlasmaCore.ToolTipArea {
            textFormat: Text.PlainText
            anchors.fill: parent
            active: !pet.lone && !pet.held && pet.lastChat !== null
            mainText: pet.lastChat ? (pet.host ? pet.host + ": " : "") + pet.lastChat.name : ""
            subText: pet.lastChat ? root.stateText(pet.lastChat) + "\n" + i18n("Click to open this chat") : ""
        }
    }
}
