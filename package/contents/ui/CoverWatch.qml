import QtQuick
import org.kde.taskmanager as TaskManager
import org.kde.kwindowsystem

// Whether a window covers the whole widget on the desktop (main.qml:
// coveredByWindow): then nobody sees the pets, and they stop moving, as
// Plasma's animated wallpapers do under a maximized window. Showing the
// desktop, or moving the window so a bit of the widget shows, starts them
// again. Loaded only on the desktop (and only where the taskmanager module
// is), so elsewhere the widget is never taken for covered.
Item {
    id: watch

    // Showing the desktop doesn't minimize the windows, it only hides them:
    // they stay in the list below, so it's checked on its own, at once
    readonly property bool covered: windowCovers && !KWindowSystem.showingDesktop
    property bool windowCovers: false
    readonly property rect screenRect: Window.window ? Qt.rect(Window.window.x, Window.window.y, Window.window.width, Window.window.height)
                                                     : Qt.rect(0, 0, 0, 0)

    TaskManager.ActivityInfo {
        id: activityInfo
    }

    // The windows on this screen that you could see now
    TaskManager.TasksModel {
        id: windows
        filterByCurrentVirtualDesktop: true
        filterByActivity: true
        activity: activityInfo.currentActivity
        filterByRegion: TaskManager.RegionFilterMode.Intersect
        regionGeometry: watch.screenRect
        filterHidden: true
        filterMinimized: true
        groupMode: TaskManager.TasksModel.GroupDisabled
        onCountChanged: check.restart()
        onDataChanged: check.restart()
    }

    Connections {
        target: root
        function onWidthChanged() { check.restart() }
        function onHeightChanged() { check.restart() }
    }
    onScreenRectChanged: check.restart()

    // A moment's wait, as Plasma's panel does: a new dialog can show up in
    // the middle of the screen for a split second before it's placed
    Timer {
        id: check
        interval: 100
        onTriggered: watch.windowCovers = watch.windowCoversNow()
    }
    // and now and then, for a widget moved on the desktop
    Timer {
        interval: 5000
        repeat: true
        running: true
        onTriggered: watch.windowCovers = watch.windowCoversNow()
    }
    Component.onCompleted: check.restart()

    function windowCoversNow() {
        if (!Window.window || root.width <= 0 || root.height <= 0)
            return false
        const at = root.mapToItem(null, 0, 0)
        const x = screenRect.x + at.x, y = screenRect.y + at.y
        for (let i = 0; i < windows.count; i++) {
            const g = windows.data(windows.makeModelIndex(i), TaskManager.AbstractTasksModel.Geometry)
            if (g && g.x <= x && g.y <= y && g.x + g.width >= x + root.width && g.y + g.height >= y + root.height)
                return true
        }
        return false
    }
}
