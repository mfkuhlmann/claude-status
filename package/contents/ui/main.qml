import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasma5support as P5Support
import org.kde.plasma.extras as PlasmaExtras
import org.kde.kirigami as Kirigami
import org.kde.notification

PlasmoidItem {
    id: root

    // Parsed output of contents/code/claude_status.py (see its collect()).
    property var status: null
    property string errorText: ""
    // Per-session memory across polls, per source ("" = this computer,
    // "ssh:<host>" = an SSH host): last state, when the current turn started,
    // and the last notification so a newer one replaces it and a stale
    // "needs input" one can be closed.
    property var lastStates: ({})
    property var turnStarts: ({})
    property var notifications: ({})
    property var primedSources: ({})
    property string actionError: ""
    property string actionInfo: ""

    // Popup state kept by row key (rows get new data every poll)
    property var expandedAgents: ({})
    property var expandedRecent: ({})
    property string stopConfirmSession: ""
    readonly property var emptyGroup: ({ id: "", name: "", title: "", plan: "", profiles: [], sessions: [],
                                         limits: null, tokens: null, projects: [], chatProfile: "", sharedHere: [],
                                         recent: [] })
    readonly property var emptySession: ({ key: "", profileDir: "", sessionId: "", chatId: "", pid: null, name: "", cwd: "", cwdShort: "", profile: "",
                                           kind: "", entrypoint: "", state: "idle", reason: "", waitingFor: "",
                                           detail: "", since: null, startedAt: null, context: null, model: null,
                                           costUsd: null, agents: null, shared: null })
    readonly property var emptyAgent: ({ id: "", parent: null, depth: 0, type: "", description: "",
                                         status: "done", activity: "", started: null, updated: null })
    readonly property string waitingName: {
        for (const g of allGroups)
            for (const s of g.sessions)
                if (s.state === "waiting")
                    return s.name
        return ""
    }

    readonly property var groups: status ? status.groups : []
    readonly property real now: status ? status.generatedAt : Date.now()

    // SSH hosts (remote.py): the ones in ~/.ssh/config, the ones you picked,
    // and what each answered ({loading, ok, error, result, updatedAt}).
    property var sshHosts: []
    readonly property var shownHosts: Plasmoid.configuration.sshHosts.split(",").map(h => h.trim()).filter(h => h.length)
    property var remote: ({})
    // The accounts of the hosts that answered, each marked with its host
    readonly property var remoteGroups: {
        const out = []
        for (const host of shownHosts) {
            const r = remote[host]
            if (r && r.result)
                for (const g of r.result.groups)
                    out.push(Object.assign({}, g, { host: host }))
        }
        return out
    }
    // Everything on the dashboard: this computer's accounts, then the hosts'
    readonly property var allGroups: groups.concat(remoteGroups)
    readonly property var counts: {
        const c = { waiting: 0, working: 0, idle: 0, done: 0 }
        for (const g of allGroups)
            for (const s of g.sessions)
                c[s.state] += 1
        return c
    }
    readonly property string overall: {
        if (counts.waiting)
            return "waiting"
        if (counts.working)
            return "working"
        // finished jobs kept for the record don't count as running
        return allGroups.some(g => g.sessions.some(s => (s.state === "idle" || s.state === "done") && s.pid !== null))
               ? "idle" : "none"
    }

    // The pets (PetStrip.qml, Pet.qml): their moods follow the sessions, and
    // petEvent makes one react ("done", "failed", "reset", "waiting", …): the
    // pet of the chat with that row key, or the main one.
    signal petEvent(string kind, string text, string key)
    // Each chat pet's color by pet key, for the bar next to its chat in the
    // list (every pet stage publishes its own: setPetColors)
    property var petColorsByStage: ({})
    readonly property var petColors: {
        const all = {}
        for (const stage in petColorsByStage)
            Object.assign(all, petColorsByStage[stage])
        return all
    }

    function setPetColors(stage, colors) {
        if (JSON.stringify(petColorsByStage[stage] || {}) === JSON.stringify(colors))
            return   // unchanged: don't make every row look again
        petColorsByStage = Object.assign({}, petColorsByStage, { [stage]: colors })
    }

    // The hero's headline: the most important thing on the dashboard
    function headlineText() {
        if (!status && errorText)
            return i18n("Status unavailable")
        if (!status)
            return i18n("Looking for your chats…")
        if (counts.waiting)
            return i18np("%1 chat needs you", "%1 chats need you", counts.waiting)
        if (counts.working)
            return i18np("%1 chat working", "%1 chats working", counts.working)
        if (counts.idle)
            return i18np("Your turn in %1 chat", "Your turn in %1 chats", counts.idle)   // Claude finished its reply
        if (counts.done)
            return i18np("%1 finished chat to look at", "%1 finished chats to look at", counts.done)
        return i18n("All quiet")
    }

    // A chat's pet key: its conversation (so the pet stays the same while the
    // chat's row changes, e.g. from a running to a finished background session)
    function petKeyOf(session, host) {
        return (host ? "ssh:" + host + "|" : "") + (session.chatId || session.sessionId || session.key)
    }
    property var lastWindows: ({})
    readonly property string petsDir: decodeURIComponent(Qt.resolvedUrl("../pets/").toString().replace(/^file:\/\//, ""))
    // Animated pets need Qt 6.10+ and the QtQuick.VectorImage module (on
    // Debian/Ubuntu: qml6-module-qtquick-vectorimage); without them the pets
    // are still images that move all the same.
    readonly property bool animatedPets: Qt.createComponent("PetImage.qml").status === Component.Ready
    readonly property int agentsRunning: {
        let n = 0
        for (const g of allGroups)
            for (const s of g.sessions)
                if (s.agents && s.state !== "done")
                    n += s.agents.running
        return n
    }
    readonly property real maxFiveHour: {
        let m = 0
        for (const g of allGroups)
            for (const w of (g.limits ? g.limits.windows : []))
                if (w.key === "five_hour")
                    m = Math.max(m, w.pct)
        return m
    }
    // Accounts close to their 5-hour limit, e.g. "work: 100% of the 5-hour limit!".
    // Clawd shows it now and then; as a mood it froze him in one pose.
    readonly property string highUsageText: {
        const parts = []
        for (const g of allGroups)
            for (const w of (g.limits ? g.limits.windows : []))
                if (w.key === "five_hour" && w.pct >= 90)
                    parts.push(i18n("%1: %2% of the 5-hour limit!", groupLabel(g), Math.round(w.pct)))
        return parts.join(" ")
    }
    // A working session whose context window is nearly full and that has no
    // pet of its own to show it, e.g. "fix parser: context 91% full"
    readonly property string contextFullText: {
        for (const g of allGroups)
            for (const s of g.sessions)
                if (s.state === "working" && s.context !== null && s.context >= 85 && !(petKeyOf(s, g.host) in petColors))
                    return i18n("%1: context %2% full", s.name, Math.round(s.context))
        return ""
    }
    readonly property string petMood: {
        if (!status && errorText)
            return "error"
        if (!status)
            return "loading"
        if (overall === "waiting")
            return "waving"
        if (overall === "working")
            return agentsRunning > 0 ? "working-juggling" : "working-typing"
        if (overall === "idle")
            return "idle-living"
        return "sleeping"
    }

    // The account whose 5-hour usage goes next to the panel icon: the one
    // with an active session, else the one with the freshest numbers.
    readonly property var panelWindow: {
        let best = null, bestScore = -1
        for (const g of allGroups) {
            if (!g.limits || !g.limits.windows.length)
                continue
            const active = g.sessions.some(s => s.state === "working" || s.state === "waiting")
            const score = (active ? 1e15 : 0) + g.limits.updatedAt
            if (score > bestScore) {
                bestScore = score
                best = g.limits.windows[0]
            }
        }
        return best
    }

    readonly property string codeDir: decodeURIComponent(Qt.resolvedUrl("../code/").toString().replace(/^file:\/\//, ""))
    readonly property string configDirArgs: Plasmoid.configuration.extraConfigDirs.split(",")
        .map(d => d.trim()).filter(d => d.length).map(d => " --config-dir " + shellQuote(d)).join("")
    readonly property string command: {
        let cmd = "python3 -I " + shellQuote(codeDir + "claude_status.py") + configDirArgs
        cmd += " --done-hours " + Math.max(0, Plasmoid.configuration.keepDoneHours)
        cmd += " --recent " + Math.max(0, Plasmoid.configuration.recentChats)
        if (!Plasmoid.configuration.showTokens)
            cmd += " --no-tokens"
        return cmd
    }

    Plasmoid.icon: "dialog-messages"
    Plasmoid.status: overall === "waiting" ? PlasmaCore.Types.NeedsAttentionStatus : PlasmaCore.Types.ActiveStatus

    toolTipMainText: i18n("Claude Code")
    toolTipSubText: tooltipText()

    switchWidth: Kirigami.Units.gridUnit * 16
    switchHeight: Kirigami.Units.gridUnit * 12

    compactRepresentation: CompactRepresentation {}
    fullRepresentation: FullRepresentation {}

    Plasmoid.contextualActions: [
        PlasmaCore.Action {
            text: i18n("Refresh")
            icon.name: "view-refresh"
            onTriggered: root.refresh()
        },
        PlasmaCore.Action {
            text: i18n("Show removed sessions again (%1)", root.status ? root.status.dismissed || 0 : 0)
            icon.name: "view-visible"
            visible: root.status !== null && (root.status.dismissed || 0) > 0
            onTriggered: root.runHelper("--undismiss-all")
        },
        PlasmaCore.Action {
            text: i18n("Open Usage Page on claude.ai")
            icon.name: "internet-web-browser"
            onTriggered: Qt.openUrlExternally("https://claude.ai/settings/usage")
        }
    ]

    P5Support.DataSource {
        id: poller
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            root.handleOutput(data["stdout"], data["stderr"])
        }
    }

    // Runs contents/code/jump.py, which brings a session to the front.
    P5Support.DataSource {
        id: jumper
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const result = root.helperResult(data)
            if (result.ok) {
                root.actionError = ""
                root.expanded = false
            } else {
                root.actionError = i18n("Couldn't open the session: %1", result.message)
                actionErrorTimer.restart()
                root.petEvent("oops", i18n("Hmm, that didn't work."), "")
                if (!root.expanded)
                    root.notify("jump-error", null, "error", i18n("Couldn't open the session"), result.message, "dialog-error")
            }
        }
    }

    // Runs `jump.py --stop`, which stops a background session (`claude stop`).
    P5Support.DataSource {
        id: stopper
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const result = root.helperResult(data)
            if (result.ok) {
                root.actionError = ""
            } else {
                root.actionError = i18n("Couldn't stop the session: %1", result.message)
                actionErrorTimer.restart()
            }
            root.refresh()
        }
    }

    Timer {
        id: actionErrorTimer
        interval: 10000
        onTriggered: root.actionError = ""
    }

    Timer {
        id: actionInfoTimer
        interval: 12000
        onTriggered: root.actionInfo = ""
    }

    Component {
        id: notificationComponent
        Notification {
            id: notification
            property string sessionId
            property string profileDir
            property string kind
            property string host           // an SSH host's session...
            property string openCommand    // ...opens with this command there
            property var session: null     // (or, running there, is shown here)
            componentName: "plasma_workspace"
            eventId: "notification"
            hints: ({ "x-kde-display-appname": "Claude Code" })
            defaultAction: NotificationAction {
                label: i18n("Open")
                onActivated: root.openFromNotification(notification)
            }
            actions: [
                NotificationAction {
                    label: i18n("Open session")
                    onActivated: root.openFromNotification(notification)
                }
            ]
            onClosed: root.forgetNotification(notification)
        }
    }

    Timer {
        interval: Math.max(1000, Plasmoid.configuration.pollInterval)
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: root.refresh()
    }

    function refresh() {
        // A still-running poll keeps its source connected; don't stack another.
        if (poller.connectedSources.indexOf(command) < 0)
            poller.connectSource(command)
    }

    function handleOutput(stdout, stderr) {
        let parsed = null
        try {
            parsed = JSON.parse(stdout)
        } catch (e) {
            const lines = (stderr || "").trim().split("\n")
            errorText = i18n("Status script failed: %1", lines[lines.length - 1] || i18n("no output"))
            return
        }
        if (!parsed.ok) {
            errorText = i18n("Status unavailable: %1", parsed.error)
            return
        }
        errorText = parsed.errors.length ? parsed.errors.join("\n") : ""
        trackTransitions("", parsed.groups, parsed.generatedAt, "")
        celebrateResets("", parsed.groups)
        status = parsed
    }

    function celebrateResets(source, groupList) {
        const next = Object.assign({}, lastWindows)
        for (const g of groupList) {
            for (const w of (g.limits ? g.limits.windows : [])) {
                const key = source + "|" + g.id + "/" + w.key
                if (key in lastWindows && lastWindows[key] >= 25 && w.pct < lastWindows[key] - 20)
                    petEvent("reset", i18n("%1 limit reset!", w.label), "")
                next[key] = w.pct
            }
        }
        lastWindows = next
    }

    // "work · Team", or "lab: work · Team" for an SSH host's account
    function groupLabel(g) {
        return g.host ? i18nc("ssh host: account", "%1: %2", g.host, g.name) : g.name
    }

    // Rows are tracked by s.key, not the chat id: a chat shared across profiles
    // is listed once per profile with the same id, and keying by id made the
    // two rows flip each other's state on every poll (a notification each time).
    property var lastWaitingAlert: ({})

    // One sound per poll at most (several sessions can change at once): the
    // most urgent of the notifications sent.
    property string pendingSound: ""
    readonly property var soundRank: ({ "": 0, done: 1, failed: 2, waiting: 3 })
    property string pendingSoundKind: ""

    function queueSound(kind) {
        if (!Plasmoid.configuration.notifySound || soundRank[kind] <= soundRank[pendingSoundKind])
            return
        const sound = kind === "waiting" ? Plasmoid.configuration.soundWaiting
                    : kind === "failed" ? Plasmoid.configuration.soundFailed
                    : Plasmoid.configuration.soundDone
        if (sound) {
            pendingSound = sound
            pendingSoundKind = kind
        }
    }

    function playQueuedSound() {
        if (pendingSound)
            soundPlayer.connectSource("python3 -I " + shellQuote(codeDir + "notify_sound.py") + " " + shellQuote(pendingSound)
                                      + " --volume " + Plasmoid.configuration.soundVolume + " # " + Date.now())
        pendingSound = ""
        pendingSoundKind = ""
    }

    P5Support.DataSource {
        id: soundPlayer
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => disconnectSource(source)
    }

    // Notifications and pet reactions when a session changes state. source is
    // "" for this computer, "ssh:<host>" for an SSH host; each source keeps its
    // own memory, so one poll can't close another's notifications.
    function trackTransitions(source, groupList, nowMs, host) {
        const next = {}, starts = {}
        const before = lastStates[source] || {}
        const startedAt = turnStarts[source] || {}
        const primed = !!primedSources[source]
        const where = host ? " · " + host : ""
        for (const g of groupList) {
            for (const s of g.sessions) {
                const sid = (source ? source + "|" : "") + (s.key || s.sessionId)
                const prev = before[sid]
                const active = s.state === "working" || s.state === "waiting"
                next[sid] = s.state
                // A turn runs from leaving idle/done until returning to it.
                if (active)
                    starts[sid] = sid in startedAt ? startedAt[sid] : (s.since || nowMs)
                if (prev === "waiting" && s.state !== "waiting")
                    closeNotification(sid, "waiting")  // answered: drop the stale prompt
                if (!primed || prev === s.state)
                    continue
                if (s.state === "waiting") {
                    // At most one "needs input" alert per session per minute
                    const quiet = nowMs - (lastWaitingAlert[sid] || 0) < 60000
                    if (!quiet) {
                        lastWaitingAlert[sid] = nowMs
                        petEvent("waiting", i18n("%1 needs you!", s.name), petKeyOf(s, host))
                        if (Plasmoid.configuration.notifyWaiting) {
                            notify(sid, s, "waiting", i18n("%1 needs your input", s.name),
                                   (s.detail || reasonText(s.reason)) + "\n" + s.cwdShort + where, "dialog-warning", host)
                            queueSound("waiting")
                        }
                    }
                } else if (prev === "working" && (s.state === "idle" || s.state === "done")) {
                    const pk = petKeyOf(s, host)
                    if (s.reason === "failed")
                        petEvent("failed", i18n("%1 failed…", s.name), pk)
                    else if (s.reason === "stopped")
                        petEvent("stopped", i18n("%1 was stopped.", s.name), pk)
                    else
                        petEvent("done", i18n("%1 is done!", s.name), pk)
                    const took = (s.since || nowMs) - (sid in startedAt ? startedAt[sid] : nowMs)
                    if (Plasmoid.configuration.notifyDone && took >= Plasmoid.configuration.notifyDoneMinSeconds * 1000) {
                        notify(sid, s, "done", s.reason === "failed" ? i18n("%1 failed", s.name)
                                            : s.reason === "stopped" ? i18n("%1 was stopped", s.name)
                                            : i18n("%1 finished", s.name),
                               (s.detail ? s.detail + "\n" : "") + i18n("Took %1 · %2", duration(took), s.cwdShort) + where,
                               "dialog-ok", host)
                        queueSound(s.reason === "failed" ? "failed" : "done")
                    }
                }
            }
        }
        // Sessions of this source that exited no longer need anything.
        const prefix = source ? source + "|" : ""
        for (const sid in notifications) {
            const mine = source ? sid.startsWith(prefix) : sid.indexOf("|") < 0
            if (mine && !(sid in next))
                closeNotification(sid, "waiting")
        }
        lastStates = Object.assign({}, lastStates, { [source]: next })
        turnStarts = Object.assign({}, turnStarts, { [source]: starts })
        primedSources = Object.assign({}, primedSources, { [source]: true })
        playQueuedSound()
    }

    function notify(key, session, kind, title, body, icon, host) {
        // One notification per row: a newer one replaces the previous.
        closeNotification(key, notifications[key] ? notifications[key].kind : "")
        // With the pet on, notifications show Clawd in a matching pose.
        const pose = kind === "done" && session && session.reason === "failed" ? "sad"
                   : { waiting: "oncall", done: "trophy", error: "error" }[kind]
        const n = notificationComponent.createObject(root, {
            sessionId: session ? session.sessionId : "", profileDir: session ? session.profileDir || "" : "",
            host: host || "", openCommand: session && session.openCommand ? session.openCommand : "",
            session: host && session ? session : null,
            kind: kind, title: title, text: body.trim(),
            iconName: Plasmoid.configuration.showPet && pose ? petsDir + "notify-" + pose + ".svg" : icon
        })
        if (!n)
            return
        notifications[key] = n
        n.sendEvent()
    }

    function closeNotification(key, kind) {
        const n = notifications[key]
        if (!n || n.kind !== kind)
            return
        delete notifications[key]
        n.close()
    }

    function forgetNotification(n) {
        for (const sid in notifications) {
            if (notifications[sid] === n)
                delete notifications[sid]
        }
    }

    function openFromNotification(n) {
        if (n.host && n.session)
            remoteShow(n.host, n.session)
        else if (n.host)
            remoteOpen(n.host, n.openCommand)
        else
            jumpTo(n.sessionId, n.profileDir)
    }

    function toggleAgents(rowKey) {
        const next = Object.assign({}, expandedAgents)
        next[rowKey] = !next[rowKey]
        expandedAgents = next
    }

    function toggleRecent(groupKey, wasOpen) {
        expandedRecent = Object.assign({}, expandedRecent, { [groupKey]: !wasOpen })
    }

    // New chat: the + next to an account unfolds its folders under its name
    // (GroupSection.qml). A folder opens a terminal with Claude there; its
    // VS Code button starts the chat in VS Code's Claude extension instead.
    property string newChatGroup: ""   // group key of the account whose folders are open
    onExpandedChanged: if (!root.expanded) newChatGroup = ""

    function toggleNewChat(groupKey) {
        newChatGroup = newChatGroup === groupKey ? "" : groupKey
    }

    // Here: your recent folders, then any folder you pick in the folder dialog
    // (it opens in your home folder). An SSH host's folders can't be browsed
    // from here, so its home folder stays in the list.
    function newChatFolders(group, host) {
        const folders = host ? group.projects.slice() : group.projects.filter(f => f.short !== "~")
        if (host && !folders.some(f => f.short === "~"))
            folders.push({ path: "", short: "~", newChatCommand: group.homeChatCommand || "" })
        return folders
    }

    // VS Code's Claude extension runs on the account its own environment and
    // settings say (claude_status.py: vscode_profile), so its button is only
    // on that account (an SSH host's: the host's ~/.claude)
    readonly property bool vscodeInstalled: status !== null && !!status.vscode && status.vscode.installed === true

    function vscodeHint(group, host) {
        if (group.vscodeHere)
            return host ? i18n("Opens VS Code connected to %1 (Remote-SSH) with a new chat in its Claude panel.", host)
                        : i18n("Opens the folder in VS Code with a new chat in its Claude panel.")
        if (host)
            return i18n("VS Code's Claude on %1 runs on another account (the host's ~/.claude).", host)
        const on = status && status.vscode ? status.vscode.on : null
        return on ? i18n("VS Code's Claude runs on %1, not %2: switch its profile to start a chat on this account there.", on, group.title)
                  : i18n("VS Code's Claude doesn't run on this account.")
    }

    P5Support.DataSource {
        id: launcher
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const result = root.helperResult(data)
            if (result.ok) {
                root.actionError = ""
                root.expanded = false
            } else {
                root.actionError = i18n("Couldn't open a new chat: %1", result.message)
                actionErrorTimer.restart()
            }
        }
    }

    // vscode: in VS Code's Claude extension instead of a terminal
    function newChat(profile, folder, vscode) {
        newChatGroup = ""
        launcher.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --new-chat " + shellQuote(profile)
                               + (folder ? " --cwd " + shellQuote(folder) : "") + (vscode ? " --vscode" : "")
                               + configDirArgs + " # " + Date.now())
    }

    // The folder dialog takes over from the popup; cancelling it does nothing
    function newChatChoosingFolder(profile, vscode) {
        newChatGroup = ""
        root.expanded = false
        launcher.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --new-chat " + shellQuote(profile)
                               + " --choose-folder" + (vscode ? " --vscode" : "") + configDirArgs + " # " + Date.now())
    }

    // VS Code connected to an SSH host, with a new chat (in folder there, or home)
    function remoteNewChatVscode(host, folder) {
        newChatGroup = ""
        launcher.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --remote-new-vscode " + shellQuote(host)
                               + (folder ? " --cwd " + shellQuote(folder) : "") + " # " + Date.now())
    }

    // ---------------------------------------------------------------- SSH hosts

    // ~/.ssh/config's hosts (loaded at start and whenever the menu opens)
    P5Support.DataSource {
        id: hostLister
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const result = root.helperResult(data)
            if (result.ok)
                root.sshHosts = result.hosts
        }
    }

    function loadHosts() {
        hostLister.connectSource("python3 -I " + shellQuote(codeDir + "remote.py") + " --hosts # " + Date.now())
    }

    Component.onCompleted: loadHosts()

    // Status of the hosts you picked: polled less often than this computer
    P5Support.DataSource {
        id: remotePoller
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const host = root.remoteSources[source]
            if (host)
                root.handleRemote(host, data)
        }
    }

    property var remoteSources: ({})   // poll command -> host

    Timer {
        interval: Math.max(10, Plasmoid.configuration.remotePollSeconds) * 1000
        running: root.shownHosts.length > 0
        repeat: true
        triggeredOnStart: true
        onTriggered: {
            for (const host of root.shownHosts)
                root.pollHost(host)
        }
    }

    onShownHostsChanged: {
        const next = {}
        for (const host of shownHosts) {
            if (host in remote)
                next[host] = remote[host]
            else
                Qt.callLater(pollHost, host)  // just picked: load it now
        }
        remote = next
    }

    function pollHost(host) {
        let cmd = "python3 -I " + shellQuote(codeDir + "remote.py") + " --status " + shellQuote(host)
                  + " --done-hours " + Math.max(0, Plasmoid.configuration.keepDoneHours)
                  + " --recent " + Math.max(0, Plasmoid.configuration.recentChats)
        if (!Plasmoid.configuration.showTokens)
            cmd += " --no-tokens"
        if (remotePoller.connectedSources.indexOf(cmd) >= 0)
            return  // still waiting for the last answer
        remoteSources = Object.assign({}, remoteSources, { [cmd]: host })
        setRemote(host, { loading: true })
        remotePoller.connectSource(cmd)
    }

    function setRemote(host, patch) {
        if (shownHosts.indexOf(host) < 0)
            return  // unpicked meanwhile
        const old = remote[host] || { loading: false, ok: false, error: "", result: null, updatedAt: 0 }
        remote = Object.assign({}, remote, { [host]: Object.assign({}, old, patch) })
    }

    function handleRemote(host, data) {
        if (shownHosts.indexOf(host) < 0)
            return  // unticked while its check was running
        const answer = helperResult(data)
        if (answer.ok && answer.result) {
            const result = answer.result
            trackTransitions("ssh:" + host, result.groups, result.generatedAt, host)
            celebrateResets("ssh:" + host, result.groups)
            setRemote(host, { loading: false, ok: true, error: "", result: result, updatedAt: Date.now() })
        } else {
            // keep the last answer to show (dimmed) with the error
            setRemote(host, { loading: false, ok: false, error: answer.error || answer.message || i18n("no answer") })
        }
    }

    function toggleHost(host) {
        const list = shownHosts.slice()
        const i = list.indexOf(host)
        if (i >= 0)
            list.splice(i, 1)
        else
            list.push(host)
        Plasmoid.configuration.sshHosts = list.join(",")
    }

    PlasmaExtras.Menu {
        id: hostsMenu
    }

    Component {
        id: hostItem
        PlasmaExtras.MenuItem {
            property string host
            property bool reload: false
            onClicked: reload ? root.loadHosts() : root.toggleHost(host)
        }
    }

    property var hostItems: []

    function openHostsMenu(button) {
        loadHosts()  // for next time, in case ~/.ssh/config changed
        hostsMenu.clearMenuItems()
        const items = [hostItem.createObject(hostsMenu, { section: true, text: i18n("Show Claude on SSH hosts") })]
        for (const h of sshHosts) {
            const target = (h.user ? h.user + "@" : "") + (h.hostname || h.name) + (h.jump ? " via " + h.jump : "")
            items.push(hostItem.createObject(hostsMenu, {
                text: target !== h.name ? h.name + "  (" + target + ")" : h.name,
                icon: "network-server", checkable: true, checked: shownHosts.indexOf(h.name) >= 0, host: h.name
            }))
        }
        // picked hosts that aren't in ~/.ssh/config (any more)
        for (const host of shownHosts)
            if (!sshHosts.some(h => h.name === host))
                items.push(hostItem.createObject(hostsMenu, { text: host, icon: "network-server", checkable: true,
                                                              checked: true, host: host }))
        if (items.length === 1)
            items.push(hostItem.createObject(hostsMenu, { text: i18n("No hosts in ~/.ssh/config"), enabled: false }))
        items.push(hostItem.createObject(hostsMenu, { separator: true }))
        items.push(hostItem.createObject(hostsMenu, { text: i18n("Reload ~/.ssh/config"), icon: "view-refresh", reload: true }))
        for (const item of items)
            hostsMenu.addMenuItem(item)
        hostItems = items
        hostsMenu.visualParent = button
        hostsMenu.openRelative()
    }

    // Actions on an SSH host: open a session in a local terminal (ssh -t),
    // stop a background session, hide a finished one
    P5Support.DataSource {
        id: remoteActions
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const result = root.helperResult(data)
            const what = root.remoteActionKinds[source] || ""
            if (result.ok) {
                root.actionError = ""
                if (what === "open")
                    root.expanded = false
            } else {
                root.actionError = what === "open" ? i18n("Couldn't open the session: %1", result.message)
                                 : what === "stop" ? i18n("Couldn't stop the session: %1", result.message)
                                 : result.message
                actionErrorTimer.restart()
                root.petEvent("oops", i18n("Hmm, that didn't work."), "")
            }
            const host = root.remoteActionHosts[source]
            if (what !== "open" && host)
                root.pollHost(host)
        }
    }

    property var remoteActionKinds: ({})
    property var remoteActionHosts: ({})

    function remoteAction(kind, host, args) {
        const cmd = "python3 -I " + shellQuote(codeDir + "remote.py") + " " + args + " # " + Date.now()
        remoteActionKinds = Object.assign({}, remoteActionKinds, { [cmd]: kind })
        remoteActionHosts = Object.assign({}, remoteActionHosts, { [cmd]: host })
        remoteActions.connectSource(cmd)
    }

    // Bring up a session of an SSH host: background sessions and finished chats
    // open in a terminal (ssh); one running there shows where it runs here (its
    // VS Code window or the terminal tab with the ssh connection)
    function remoteShow(host, session) {
        if (session.openCommand)
            remoteOpen(host, session.openCommand)
        else if (session.entrypoint === "claude-vscode")
            jumper.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --remote-vscode " + shellQuote(host)
                                 + " " + shellQuote(session.sessionId) + (session.cwd ? " --cwd " + shellQuote(session.cwd) : "")
                                 + " # " + Date.now())
        else
            jumper.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --remote-terminal " + shellQuote(host)
                                 + " --name " + shellQuote(session.name || "") + " # " + Date.now())
    }

    function remoteOpen(host, command) {
        if (!command) {
            actionError = i18n("This session runs in a terminal on %1; the widget can't bring it here.", host)
            actionErrorTimer.restart()
            return
        }
        remoteAction("open", host, "--open " + shellQuote(host) + " " + shellQuote(command))
    }

    function remoteStop(host, command) {
        remoteAction("stop", host, "--run " + shellQuote(host) + " " + shellQuote(command))
    }

    function remoteDismiss(host, sessionId) {
        remoteAction("dismiss", host, "--dismiss " + shellQuote(host) + " " + shellQuote(sessionId))
    }

    function remoteUndismissAll(host) {
        remoteAction("dismiss", host, "--undismiss-all " + shellQuote(host))
    }

    // ---------------------------------------------------------------- shared chats
    // Share a chat with your other accounts, continue it on one of them, or
    // keep it on one only: jump.py runs ~/.claude-shared/profile-tools/shared-chats.sh.

    readonly property bool canShareChats: status !== null && status.canShare === true
    readonly property var shareAccounts: groups.filter(g => !!g.shareProfile)
    // "Keep only on …" waits for a yes: {key, chatId, name, profileKey, account, others}
    property var shareConfirm: ({ key: "", chatId: "", name: "", profileKey: "", account: "", others: "" })

    PlasmaExtras.Menu {
        id: shareMenu
    }

    Component {
        id: shareItem
        PlasmaExtras.MenuItem {
            property string kind      // continue | share | keeponly
            property string chatId
            property string chatName
            property string rowKey
            property var account: null
            onClicked: {
                if (kind === "keeponly")
                    root.askKeepOnly(rowKey, chatId, chatName, account)
                else
                    root.shareAction(kind, chatId, account ? account.shareProfile : "")
            }
        }
    }

    property var shareItems: []

    // chat: {chatId, name, shared, profileDir}; rowKey: where to ask "keep only on …?"
    function openShareMenu(button, chat, rowKey) {
        shareMenu.clearMenuItems()
        const here = groups.find(g => g.profileKeys.indexOf(chat.profileDir) >= 0) || null
        const items = [shareItem.createObject(shareMenu, { section: true, text: chat.name })]
        for (const g of shareAccounts) {
            if (g === here)
                continue
            items.push(shareItem.createObject(shareMenu, {
                text: chat.shared ? i18n("Continue on %1", g.title) : i18n("Share and continue on %1", g.title),
                icon: "system-switch-user", kind: "continue", chatId: chat.chatId, account: g
            }))
        }
        if (!chat.shared)
            items.push(shareItem.createObject(shareMenu, { text: i18n("Share with all accounts"), icon: "document-share",
                                                           kind: "share", chatId: chat.chatId }))
        else {
            items.push(shareItem.createObject(shareMenu, { separator: true }))
            for (const g of shareAccounts)
                items.push(shareItem.createObject(shareMenu, {
                    text: i18n("Keep only on %1…", g.title), icon: "list-remove", kind: "keeponly",
                    chatId: chat.chatId, chatName: chat.name, rowKey: rowKey, account: g
                }))
        }
        for (const item of items)
            shareMenu.addMenuItem(item)
        shareItems = items
        shareMenu.visualParent = button
        shareMenu.openRelative()
    }

    function askKeepOnly(rowKey, chatId, name, account) {
        shareConfirm = {
            key: rowKey, chatId: chatId, name: name, profileKey: account.shareProfile, account: account.title,
            others: shareAccounts.filter(g => g !== account).map(g => g.title).join(", ")
        }
    }

    function confirmKeepOnly() {
        const c = shareConfirm
        shareConfirm = { key: "", chatId: "", name: "", profileKey: "", account: "", others: "" }
        shareAction("keeponly", c.chatId, c.profileKey)
    }

    P5Support.DataSource {
        id: sharer
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const result = root.helperResult(data)
            const kind = root.shareKinds[source] || ""
            if (!result.ok) {
                root.actionError = result.message
                actionErrorTimer.restart()
                root.petEvent("oops", i18n("Hmm, that didn't work."), "")
            } else if (kind === "continue") {
                root.actionError = ""
                root.expanded = false
            } else {
                root.actionError = ""
                root.actionInfo = result.message
                actionInfoTimer.restart()
            }
            root.refresh()
        }
    }

    property var shareKinds: ({})

    function shareAction(kind, chatId, profileKey) {
        const flag = { continue: "--continue", share: "--share", keeponly: "--unshare" }[kind]
        const cmd = "python3 -I " + shellQuote(codeDir + "jump.py") + " " + flag + " " + shellQuote(chatId)
                    + (profileKey ? " --profile " + shellQuote(profileKey) : "") + configDirArgs + " # " + Date.now()
        shareKinds = Object.assign({}, shareKinds, { [cmd]: kind })
        sharer.connectSource(cmd)
    }

    function helperResult(data) {
        try {
            return JSON.parse(data["stdout"])
        } catch (e) {
            const lines = (data["stderr"] || "").trim().split("\n")
            return { ok: false, message: lines[lines.length - 1] || i18n("the helper gave no answer") }
        }
    }

    // Small helper actions whose only effect is on the widget's own list
    function runHelper(args) {
        stopper.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " " + args + configDirArgs + " # " + Date.now())
    }

    function dismissSession(sessionId) {
        runHelper("--dismiss " + shellQuote(sessionId))
    }

    // profileDir picks the right copy of a chat shared across profiles
    function profileArg(profileDir) {
        return profileDir ? " --profile " + shellQuote(profileDir) : ""
    }

    function stopSession(sessionId, profileDir) {
        stopper.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --stop " + shellQuote(sessionId)
                              + profileArg(profileDir) + configDirArgs + " # " + Date.now())
    }

    function jumpTo(sessionId, profileDir) {
        // Trailing comment keeps repeated clicks from being deduplicated by the engine.
        jumper.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " " + shellQuote(sessionId)
                             + profileArg(profileDir) + configDirArgs + " # " + Date.now())
    }

    function reasonText(reason) {
        switch (reason) {
        case "permission": return i18n("Asks for permission")
        case "question": return i18n("Has a question for you")
        case "network access": return i18n("Asks for network access")
        case "goal approval": return i18n("Proposes a goal")
        case "": return i18n("Waiting for you")
        default: return reason
        }
    }

    function shellQuote(s) {
        return "'" + String(s).replace(/'/g, "'\\''") + "'"
    }

    function stateColor(state) {
        switch (state) {
        case "waiting": return Kirigami.Theme.neutralTextColor
        case "working": return Kirigami.Theme.focusColor   // the accent (highlightColor is a pale selection tint)
        case "idle":
        case "done": return Kirigami.Theme.positiveTextColor
        default: return Kirigami.Theme.disabledTextColor
        }
    }

    function usageColor(pct) {
        if (pct >= 90)
            return Kirigami.Theme.negativeTextColor
        if (pct >= 70)
            return Kirigami.Theme.neutralTextColor
        return Kirigami.Theme.focusColor
    }

    function duration(ms) {
        const m = Math.max(0, Math.round(ms / 60000))
        if (m < 60)
            return i18nc("duration in minutes", "%1m", m)
        const h = Math.floor(m / 60)
        if (h < 24)
            return i18nc("duration in hours and minutes", "%1h %2m", h, m % 60)
        return i18nc("duration in days and hours", "%1d %2h", Math.floor(h / 24), h % 24)
    }

    function resetText(window) {
        if (window.reset)
            return i18n("reset")
        if (!window.resetsAt)
            return ""
        // The last minute reads "<1m": a rounded "0m" looked stuck
        return i18n("resets in %1", window.resetsAt - now < 60000 ? i18nc("less than a minute", "<1m")
                                                                   : duration(window.resetsAt - now))
    }

    function stateText(s) {
        const since = s.since ? " · " + duration(now - s.since) : ""
        const reason = s.reason ? " · " + s.reason : ""
        switch (s.state) {
        case "waiting": return i18n("Needs input") + reason
        case "working": return i18n("Working") + reason + since
        case "done":
            return (s.reason === "failed" ? i18n("Failed") : s.reason === "stopped" ? i18n("Stopped") : i18n("Done")) + since
        default: return i18n("Idle") + since
        }
    }

    function formatTokens(n) {
        if (n >= 1e9)
            return (n / 1e9).toFixed(1) + "B"
        if (n >= 1e6)
            return (n / 1e6).toFixed(1) + "M"
        if (n >= 1e3)
            return (n / 1e3).toFixed(1) + "k"
        return String(n)
    }

    function summaryText() {
        const parts = []
        if (counts.waiting)
            parts.push(i18np("%1 needs input", "%1 need input", counts.waiting))
        if (counts.working)
            parts.push(i18n("%1 working", counts.working))
        if (counts.idle)
            parts.push(i18n("%1 idle", counts.idle))
        if (counts.done)
            parts.push(i18n("%1 done", counts.done))
        return parts.length ? parts.join(" · ") : i18n("No sessions running")
    }

    function tooltipText() {
        if (errorText && !status)
            return errorText
        const lines = [summaryText()]
        for (const g of allGroups) {
            if (!g.limits)
                continue
            lines.push((g.host ? g.host + ": " : "") + g.title + ": "
                       + g.limits.windows.map(w => w.label + " " + Math.round(w.pct) + "%").join(" · "))
        }
        for (const host of shownHosts)
            if (remote[host] && remote[host].error)
                lines.push(i18n("%1: not reachable", host))
        return lines.join("\n")
    }
}
