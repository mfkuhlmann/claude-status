import QtQuick
import "talpa/glyph.mjs" as G

// The panel icon: Talpa peeking up through the panel's edge (talpa/glyph.mjs),
// in the state's color. It pops up when a chat needs you, glances around while
// Claude works, smiles when it's your turn and sleeps when nothing runs.
Canvas {
    id: icon

    property color color: "#3daee9"
    property string mode: "none"      // root.overall: waiting working idle none
    property bool moving: true        // false: holds still (e.g. under a window)

    renderStrategy: Canvas.Cooperative
    onColorChanged: requestPaint()
    onModeChanged: requestPaint()
    onWidthChanged: requestPaint()

    // A few frames a second are enough for a panel icon that may move for hours
    Timer {
        interval: 80
        repeat: true
        running: icon.moving && icon.visible && G.glyphMoves(icon.mode)
        onTriggered: icon.requestPaint()
    }

    onPaint: {
        const ctx = getContext("2d")
        ctx.reset()
        const k = Math.min(width, height) / 24
        ctx.translate((width - 24 * k) / 2, (height - 24 * k) / 2)
        ctx.scale(k, k)
        G.drawGlyph(ctx, mode, "rgba(" + Math.round(color.r * 255) + "," + Math.round(color.g * 255) + ","
                                 + Math.round(color.b * 255) + "," + color.a + ")", Date.now())
    }
}
