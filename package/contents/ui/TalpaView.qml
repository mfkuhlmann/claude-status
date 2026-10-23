import QtQuick
import org.kde.kirigami as Kirigami
import "talpa/talpa.mjs" as T

// Talpa on a canvas: talpa/talpa.mjs is the creature (looks, moods, actions);
// this ticks its clock with the widget's (main.qml: petFrame) while it can be
// seen, and paints it. Each picture costs, so:
// - live (the big Talpa, or a pet you hold): as often as that shows something
//   new (talpa.frameMs: 25 times a second for quick moves, down to 5 at rest);
// - stills (a chat's pet): only when what it shows changes (talpa.stillKey),
//   on the sheet behind, which then fades in as the shown one fades out for
//   a new pose, or just takes its place for a blink, a glance or a beat.
// The canvas has room around the creature's box for what it throws and holds up.
Item {
    id: view

    property real box: 100                 // the creature's 64-unit box, in pixels
    property bool playing: true            // seen: it moves
    property bool travels: false           // may dig over to another spot by itself
    property color tint: "transparent"     // a chat's color (calmed down); none: Talpa's own lilac
    property bool facingLeft: false
    property bool stills: false            // pictures only (see above)
    readonly property real boxX: box * 0.3
    readonly property real boxY: box * 0.45
    readonly property real floorY: boxY + box * T.FLOOR / T.BOX   // the floor, from the canvas top
    property var talpa: null
    signal travel(int ms)                  // it dug in: move it to its new spot within ms
    signal ready()                         // talpa exists

    width: box * 1.6
    height: box * 1.5

    // The sheet shown, and the one behind it for the next picture
    property Item front: sheetA
    property Item back: sheetB
    property real lastPaint: 0
    property real paintedAt: -1            // the back sheet got its picture (shown at the next tick)
    property real fadeAt: -1               // the back sheet fades in since then
    readonly property int fadeMs: 200

    function cssColor(c, alpha) {
        return "rgba(" + Math.round(c.r * 255) + "," + Math.round(c.g * 255) + "," + Math.round(c.b * 255) + "," + (alpha === undefined ? c.a : alpha) + ")"
    }
    function colors() {
        return tint.a > 0 ? T.calmColors(tint.toString().slice(-6)) : T.LILAC
    }
    function theme() {
        return { fx: cssColor(Kirigami.Theme.textColor, 0.5), text: cssColor(Kirigami.Theme.textColor, 1) }
    }
    // (new colors: the pictures are drawn again)
    function redraw() {
        front.key = "~"
        back.key = ""
        lastPaint = 0
    }

    Component.onCompleted: {
        // the few words it says, in your language
        const words = {
            "achoo!": i18nc("Talpa sneezes", "achoo!"), "hic!": i18nc("Talpa has the hiccups", "hic!"),
            "pop!": i18nc("a balloon pops", "pop!"), "ta-da!": i18nc("Talpa pops out of hiding", "ta-da!"),
            "boo!": i18nc("Talpa plays peekaboo", "boo!"), "a bug!": i18nc("Talpa spots a bug", "a bug!"),
            "got it!": i18nc("Talpa caught a bug", "got it!"), "sigh": i18nc("Talpa is sad", "sigh"),
            "haha": i18nc("Talpa laughs", "haha"), "hihi": i18nc("Talpa giggles", "hihi")
        }
        talpa = new T.Talpa({ colors: colors(), theme: theme(), travels: travels, words: s => words[s] || s })
        talpa.facingLeft = facingLeft
        talpa.onTravel = ms => view.travel(ms)
        talpa.tick(Date.now())
        ready()
        frame(Date.now())
    }
    onTintChanged: if (talpa) { talpa.setColors(colors()); redraw() }
    onFacingLeftChanged: if (talpa) talpa.facingLeft = facingLeft
    onTravelsChanged: if (talpa) talpa.travels = travels

    Connections {
        target: Kirigami.Theme
        function onTextColorChanged() {
            if (view.talpa) {
                view.talpa.setTheme(view.theme())
                view.redraw()
            }
        }
    }

    Connections {
        target: root
        enabled: view.playing && view.visible && view.talpa !== null
        function onPetFrame(now) {
            view.frame(now)
        }
    }

    function frame(now) {
        talpa.tick(now)
        if (!stills) {
            if (front.key !== "" || back.opacity > 0) {
                front.key = ""   // (back from pictures: drawn live on the shown sheet)
                front.opacity = 1
                back.opacity = 0
                back.key = ""
                fadeAt = paintedAt = -1
            }
            if (now - lastPaint >= talpa.frameMs - 5) {   // (ticks come every 40 ms, give or take)
                lastPaint = now
                front.requestPaint()
            }
            return
        }
        if (fadeAt >= 0) {
            const p = (now - fadeAt) / fadeMs
            if (p < 1) {
                back.opacity = p   // (one fades in as the other fades out)
                front.opacity = 1 - p
                return
            }
            swap()
        }
        if (paintedAt >= 0) {
            paintedAt = -1
            showBack(now)
            return
        }
        const key = talpa.stillKey()
        if (key === front.key)
            return
        if (key === back.key) {
            showBack(now)   // the picture it needs is behind already (a beat, a blink)
            return
        }
        back.key = key
        back.requestPaint()
        paintedAt = now
    }

    // A new pose fades in; a new detail (a blink, a glance, a beat) just shows
    function showBack(now) {
        const pose = k => k.split("#")[0]
        if (front.key !== "" && front.key !== "~" && pose(back.key) === pose(front.key)) {
            swap()
        } else {
            fadeAt = now
            back.opacity = 0.01
        }
    }

    function swap() {
        const shown = back
        back = front
        front = shown
        front.opacity = 1
        back.opacity = 0
        fadeAt = -1
    }

    function paint(sheet) {
        const ctx = sheet.getContext("2d")
        ctx.reset()
        if (!talpa)
            return
        ctx.translate(boxX, boxY)
        ctx.scale(box / T.BOX, box / T.BOX)
        if (sheet.key === "")
            talpa.draw(ctx)
        else
            talpa.drawStill(ctx)
    }

    component Sheet: Canvas {
        property string key: ""   // the picture on it, "": drawn live
        anchors.fill: parent
        renderStrategy: Canvas.Cooperative
        z: view.back === this ? 1 : 0   // (the next picture fades in on top)
        onPaint: view.paint(this)
    }
    Sheet { id: sheetA }
    Sheet { id: sheetB; opacity: 0 }
}
