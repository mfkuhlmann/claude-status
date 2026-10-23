import QtQuick
import org.kde.kirigami as Kirigami
import "talpa/talpa.mjs" as T

// Talpa on a canvas: talpa/talpa.mjs is the creature (looks, moods, actions);
// this ticks its clock while it can be seen and paints it. The canvas has
// room around the creature's box for what it throws and holds up.
Canvas {
    id: view

    property real box: 100                 // the creature's 64-unit box, in pixels
    property bool playing: true            // seen: it moves
    property bool travels: false           // may dig over to another spot by itself
    property color tint: "transparent"     // a chat's color (calmed down); none: Talpa's own lilac
    property bool facingLeft: false
    readonly property real boxX: box * 0.3
    readonly property real boxY: box * 0.45
    readonly property real floorY: boxY + box * T.FLOOR / T.BOX   // the floor, from the canvas top
    property var talpa: null
    signal travel(int ms)                  // it dug in: move it to its new spot within ms
    signal ready()                         // talpa exists

    width: box * 1.6
    height: box * 1.5
    renderStrategy: Canvas.Cooperative

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
        requestPaint()
        ready()
    }
    onTintChanged: if (talpa) talpa.setColors(colors())
    onFacingLeftChanged: if (talpa) talpa.facingLeft = facingLeft
    onTravelsChanged: if (talpa) talpa.travels = travels

    Connections {
        target: Kirigami.Theme
        function onTextColorChanged() {
            if (view.talpa)
                view.talpa.setTheme(view.theme())
        }
    }

    Timer {
        interval: 33
        repeat: true
        running: view.playing && view.visible && view.talpa !== null
        onTriggered: {
            view.talpa.tick(Date.now())
            view.requestPaint()
        }
    }

    onPaint: {
        if (!talpa)
            return
        const ctx = getContext("2d")
        ctx.reset()
        ctx.translate(boxX, boxY)
        ctx.scale(box / T.BOX, box / T.BOX)
        talpa.draw(ctx)
    }
}
