import QtQuick
import org.kde.kirigami as Kirigami
import "talpa/talpa.mjs" as T
import "talpa/pictures.mjs" as P

// Talpa on a canvas: talpa/talpa.mjs is the creature (looks, moods, actions);
// this ticks its clock with the widget's (main.qml: petFrame) while it can be
// seen, and paints it. Each picture costs, so:
// - live (the big Talpa, or a pet you hold): as often as that shows something
//   new (talpa.frameMs: 25 times a second for quick moves, down to 5 at rest);
// - stills (a chat's pet): pictures (talpa/pictures.mjs), each drawn once on
//   one of a few sheets and shown while it's what Talpa looks like. A quick
//   move goes round its pictures, a pose fades into the next (the two mixed
//   on a sheet of their own), and only a big move (a jump, popping out of its
//   burrow) is drawn live.
// The canvas has room around the creature's box for what it throws and holds up.
Item {
    id: view

    property real box: 100                 // the creature's 64-unit box, in pixels
    property bool playing: true            // seen: it moves
    property bool travels: false           // may dig over to another spot by itself
    property color tint: "transparent"     // a chat's color (calmed down); none: Talpa's own lilac
    property bool facingLeft: false
    property int sheets: 1                 // canvases: more than one to show it as pictures
    property bool stills: false            // pictures (see above)
    readonly property real boxX: box * 0.3
    readonly property real boxY: box * 0.45
    readonly property real floorY: boxY + box * T.FLOOR / T.BOX   // the floor, from the canvas top
    property var talpa: null
    property var pictures: null
    signal travel(int ms)                  // it dug in: move it to its new spot within ms
    signal ready()                         // talpa exists

    width: box * 1.6
    height: box * 1.5

    function cssColor(c, alpha) {
        return "rgba(" + Math.round(c.r * 255) + "," + Math.round(c.g * 255) + "," + Math.round(c.b * 255) + "," + (alpha === undefined ? c.a : alpha) + ")"
    }
    function colors() {
        return tint.a > 0 ? T.calmColors(tint.toString().slice(-6)) : T.LILAC
    }
    function theme() {
        return { fx: cssColor(Kirigami.Theme.textColor, 0.5), text: cssColor(Kirigami.Theme.textColor, 1) }
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
        pictures = new P.Pictures(talpa, sheets)
        ready()
        frame(Date.now())
    }
    // (new colors: the pictures are drawn again)
    onTintChanged: if (talpa) { talpa.setColors(colors()); pictures.reset() }
    onFacingLeftChanged: if (talpa) talpa.facingLeft = facingLeft
    onTravelsChanged: if (talpa) talpa.travels = travels

    Connections {
        target: Kirigami.Theme
        function onTextColorChanged() {
            if (view.talpa) {
                view.talpa.setTheme(view.theme())
                view.pictures.reset()
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
        pictures.pictures = stills
        pictures.tick(now)
        for (const s of pictures.sheets) {
            if (s.paint && sheetItems.itemAt(s.index)) {
                s.paint = false
                sheetItems.itemAt(s.index).requestPaint()
            }
        }
        // the sheet in front shows, or the blend once it has the two mixed
        if (pictures.coming)
            blend.requestPaint()
        else
            blend.drawn = false
        const mixed = pictures.coming !== null && blend.drawn
        blend.opacity = mixed ? 1 : 0
        for (let i = 0; i < sheetItems.count; i++)
            sheetItems.itemAt(i).opacity = !mixed && i === pictures.front.index ? 1 : 0
    }

    function paint(sheet, index) {
        const ctx = sheet.getContext("2d")
        ctx.reset()
        if (!pictures)
            return
        ctx.translate(boxX, boxY)
        ctx.scale(box / T.BOX, box / T.BOX)
        pictures.paint(pictures.sheets[index], ctx)
    }

    Repeater {
        id: sheetItems
        model: view.sheets
        delegate: Canvas {
            required property int index
            anchors.fill: parent
            renderStrategy: Canvas.Cooperative
            opacity: index === 0 ? 1 : 0
            onPaint: view.paint(this, index)
        }
    }

    // A pose fading into the next: (1 - mix) × the one in front + mix × the
    // next, added up ("lighter"), so where both cover nothing shows through.
    // Qt adds up right only at full strength (with less it adds, caps, then
    // mixes with what was there: the background showed through again), so
    // the next one is first made mix × itself on a sheet of its own.
    Canvas {
        id: fader
        anchors.fill: parent
        renderStrategy: Canvas.Cooperative
        visible: false
    }
    Canvas {
        id: blend
        property bool drawn: false   // has the two of the fade under way
        anchors.fill: parent
        renderStrategy: Canvas.Cooperative
        opacity: 0
        z: 1
        onPaint: {
            const ctx = getContext("2d")
            ctx.reset()
            const p = view.pictures
            const from = p && p.coming ? sheetItems.itemAt(p.front.index) : null
            const to = p && p.coming ? sheetItems.itemAt(p.coming.index) : null
            if (!from || !to) {
                drawn = false
                return
            }
            // (pixel for pixel: the sheets are a whole number of pixels, the
            // view maybe not, and squeezing one into it shifted the edges)
            const next = fader.getContext("2d")
            next.reset()
            next.globalAlpha = p.mix
            next.drawImage(to, 0, 0)
            ctx.globalAlpha = 1 - p.mix
            ctx.drawImage(from, 0, 0)
            ctx.globalAlpha = 1
            ctx.globalCompositeOperation = "lighter"
            ctx.drawImage(fader, 0, 0)
            drawn = true
        }
    }
}
