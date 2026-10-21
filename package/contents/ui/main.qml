import QtQuick
import QtQuick.Layouts
import org.kde.plasma.plasmoid
import org.kde.plasma.core as PlasmaCore
import org.kde.plasma.plasma5support as P5Support
import org.kde.plasma.extras as PlasmaExtras
import org.kde.kirigami as Kirigami
import org.kde.notification
import "hub"

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
    property var expandedAgentRuns: ({}) // subagents showing their task, last steps and report (row key|agent id)
    property var expandedPeek: ({})     // rows showing your last prompt, Claude's reply and the tasks
    property var expandedStats: ({})    // accounts showing their last days
    property var expandedRecent: ({})
    property string stopConfirmSession: ""
    property bool stopConfirmBusy: false   // the chat wasn't idle when you were asked (stop it anyway)
    readonly property var emptyGroup: ({ id: "", name: "", title: "", plan: "", profiles: [], sessions: [],
                                         limits: null, tokens: null, projects: [], chatProfile: "", sharedHere: [],
                                         recent: [], plans: [] })
    readonly property var emptySession: ({ key: "", profileDir: "", sessionId: "", chatId: "", pid: null, name: "", cwd: "", cwdShort: "", profile: "",
                                           kind: "", entrypoint: "", state: "idle", reason: "", waitingFor: "",
                                           detail: "", since: null, startedAt: null, context: null, model: null,
                                           costUsd: null, agents: null, shared: null, effort: null, tmux: false,
                                           peek: null, changes: null, tasks: null, stats: null, plan: null, stopped: null,
                                           overlaps: null })
    readonly property var emptyFound: ({ key: "", sessionId: "", name: "", cwd: "", cwdShort: "", lastActive: 0, profile: "",
                                         profileDir: "", groupId: "", account: "", shared: false, match: "", openCommand: "" })
    readonly property var emptyPlan: ({ key: "", slug: "", title: "", path: "", profileDir: "", profile: "", updatedAt: 0,
                                        shared: false, chatId: null, chatProfileDir: null, cwd: "", cwdShort: "",
                                        openCommand: null })
    readonly property var emptyTask: ({ subject: "", status: "pending" })
    readonly property var emptyDay: ({ day: "", total: 0, output: 0, messages: 0, chats: 0, prompts: 0 })
    readonly property var emptyProject: ({ name: "", path: "", total: 0, output: 0, prompts: 0 })
    readonly property var emptyAgent: ({ id: "", parent: null, depth: 0, type: "", description: "",
                                         status: "done", activity: "", started: null, updated: null, model: null,
                                         task: "", steps: [], report: "", toolCalls: null, tokens: null })
    readonly property string waitingName: {
        for (const g of allGroups)
            for (const s of g.sessions)
                if (s.state === "waiting")
                    return s.name
        return ""
    }

    readonly property var groups: status ? status.groups.map(g => withUsage(g, "")) : []
    property real now: Date.now()   // the last check's time (handleOutput)

    // Plan usage is the account's, whichever machine it's used on. An
    // account on several (this computer and SSH hosts: the same id) shows it
    // once, where it's listed first, with the newest numbers of them all
    // (sshUsage "once"); "all" shows each machine's own, "none" no host's.
    readonly property var usageOwners: {
        const out = {}
        const note = (g, host) => {
            const o = out[g.id] || (out[g.id] = { host: host, limits: null, from: "" })
            if (g.limits && (!o.limits || g.limits.updatedAt > o.limits.updatedAt)) {
                o.limits = g.limits
                o.from = host
            }
        }
        for (const g of (status ? status.groups : []))
            note(g, "")
        for (const host of shownHosts)
            for (const g of (remote[host] && remote[host].result ? remote[host].result.groups : []))
                note(g, host)
        return out
    }

    // group as shown on host's section ("" here): limitsHidden when its usage
    // shows elsewhere (or no host's does), limitsFrom when the numbers come
    // from another machine
    function withUsage(group, host) {
        const mode = Plasmoid.configuration.sshUsage
        const owner = usageOwners[group.id]
        if (host && (mode === "none" || (mode !== "all" && owner && owner.host !== host)))
            return Object.assign({}, group, { limits: null, limitsHidden: true })
        if (mode === "all" || !owner || owner.from === host)
            return group
        return Object.assign({}, group, { limits: owner.limits, limitsFrom: owner.from })
    }

    // SSH hosts (remote.py): the ones in ~/.ssh/config, the ones you picked,
    // and what each answered ({loading, ok, error, result, updatedAt}).
    property var sshHosts: []
    readonly property var shownHosts: Plasmoid.configuration.sshHosts.split(",").map(h => h.trim()).filter(h => h.length)
    property var remote: ({})
    // The accounts of the hosts that answered, each marked with its host. A
    // host whose last check failed still shows what it said before (dimmed,
    // HostSection.qml), but that doesn't count here: no badge or shortcut
    // for a chat you can't reach.
    readonly property var remoteGroups: {
        const out = []
        for (const host of shownHosts) {
            const r = remote[host]
            if (r && r.result && !r.error)
                for (const g of r.result.groups)
                    out.push(Object.assign({}, withUsage(g, host), { host: host }))
        }
        return out
    }
    // Everything on the dashboard: this computer's accounts, then the hosts'
    readonly property var allGroups: groups.concat(remoteGroups)
    // (a chat a usage limit stopped waits for the limit, not for you: "limit",
    // whether a process still has it open or not)
    readonly property var counts: {
        const c = { waiting: 0, working: 0, idle: 0, done: 0, limit: 0 }
        for (const g of allGroups)
            for (const s of g.sessions)
                c[atLimit(s) ? "limit" : s.state] += 1
        return c
    }

    function atLimit(s) {
        return (s.state === "idle" || s.state === "done") && !!s.stopped && s.stopped.kind === "limit" && !s.stopped.over
    }
    // What happened since you last opened the popup, for the icon: chats that
    // started needing you, and chats that finished a turn (as long as the
    // "finished" notifications ask for), keyed like lastStates.
    property var unseen: ({})
    readonly property int unseenDone: Object.keys(unseen).filter(k => unseen[k] === "done").length
    readonly property int unseenWaiting: Object.keys(unseen).filter(k => unseen[k] === "waiting").length
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

    function dropPetColors(stage) {   // a stage that's gone (its account isn't listed any more)
        if (!(stage in petColorsByStage))
            return
        const next = Object.assign({}, petColorsByStage)
        delete next[stage]
        petColorsByStage = next
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
        if (counts.limit)
            return i18np("%1 chat waits for its usage limit", "%1 chats wait for their usage limit", counts.limit)
        if (counts.done)
            return i18np("%1 finished chat to look at", "%1 finished chats to look at", counts.done)
        return i18n("All quiet")
    }

    // A chat's key: its account and conversation, so its pet, its
    // notifications and whether you've seen it stay the same while its row
    // changes (e.g. a background session's row from running to finished,
    // …/live to …/job). A chat shared with two accounts is two chats here.
    function petKeyOf(session, host) {
        return (host ? "ssh:" + host + "|" : "") + (session.profileDir || "") + "/"
               + (session.chatId || session.sessionId || session.key)
    }
    property var lastWindows: ({})
    readonly property string petsDir: decodeURIComponent(Qt.resolvedUrl("../pets/").toString().replace(/^file:\/\//, ""))
    // Animated pets need Qt 6.10+ and the QtQuick.VectorImage module (on
    // Debian/Ubuntu: qml6-module-qtquick-vectorimage); without them the pets
    // are still images that move all the same.
    readonly property bool animatedPets: Qt.createComponent("PetImage.qml").status === Component.Ready
    // On the desktop the dashboard is shown all the time, and is often under
    // your windows: there the pets and the spinner stop moving while a window
    // covers it all (CoverWatch.qml), since every frame redraws the screen.
    readonly property bool onDesktop: Plasmoid.formFactor === PlasmaCore.Types.Planar && !inTray
    // The dashboard is on screen: the popup is open, or it's shown in place
    // (on the desktop). There, opening a chat "closes the popup" too
    // (expanded false), though the dashboard stays: its pets froze.
    readonly property bool dashboardShown: expanded || (Window.window !== null && fullRepresentationItem !== null
                                                         && fullRepresentationItem.Window.window === Window.window)
    // (with the mouse on it, it can be seen: a window over it would have the mouse)
    readonly property bool coveredByWindow: coverWatch.item !== null && coverWatch.item.covered && !mouseOnWidget.hovered
    HoverHandler {
        id: mouseOnWidget
        enabled: root.onDesktop
    }
    Loader {
        id: coverWatch
        active: root.onDesktop
        source: "CoverWatch.qml"
    }
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

    // The account whose 5-hour usage goes next to the panel icon: this
    // computer's default account (listed first; VS Code's Claude and plain
    // claude run on it, see accounts.py --default), else the one with an
    // active session, else the one with the freshest numbers.
    readonly property var panelWindow: {
        const own = allGroups.find(g => !g.host && g.defaultHere && g.limits && g.limits.windows.length)
        if (own)
            return own.limits.windows[0]
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
        // (poll.py runs claude_status.py with its compiled code cached)
        let cmd = "python3 -I " + shellQuote(codeDir + "poll.py") + configDirArgs
        cmd += " --done-hours " + Math.max(0, Plasmoid.configuration.keepDoneHours)
        cmd += " --recent " + Math.max(0, Plasmoid.configuration.recentChats)
        if (!Plasmoid.configuration.showTokens)
            cmd += " --no-tokens"
        return cmd   // (hub/Hub.qml adds --instance and --interval-ms)
    }

    // ---------------------------------------------------------------- several widgets
    // This widget can run several times, e.g. on a panel, in the system tray
    // and on each screen's desktop. The copies share one check (hub/Hub.qml);
    // the one here longest sends the notifications and sounds, and across
    // programs claude_status.py picks one (several widgets at once). Settings
    // are shared: a change is saved for the others at the next check, and the
    // others take it over at theirs (a new copy takes over what the others use).
    readonly property string instanceId: (Plasmoid.containment ? Plasmoid.containment.id + "/" : "") + Plasmoid.id
    readonly property bool notifier: (status === null || status.notifier !== false) && Hub.leaderId === instanceId
    // In the system tray, which draws the popup's heading itself (settable for render tests)
    property bool inTray: (Plasmoid.containmentDisplayHints & PlasmaCore.Types.ContainmentDrawsPlasmoidHeading) !== 0
    readonly property var sharedKeys: ["pollInterval", "idlePollInterval", "extraConfigDirs", "notifyWaiting", "notifyDone",
        "notifyDoneMinSeconds", "notifySound", "soundVolume", "soundWaiting", "soundDone", "soundFailed", "recentChats",
        "sshHosts", "remotePollSeconds", "sshUsage", "keepDoneHours", "showUsageInPanel", "showPet", "chatPets", "showTokens",
        "newChatInVscode", "iconBlink", "awayDigest", "awayMinutes", "phoneWhileAway", "phoneFinished", "phoneDevice",
        "markdownApp"]
    property real settingsSeenAt: 0     // the newest shared settings this copy has seen
    property string settingsSeen: ""    // its own settings as of the last check (to see changes)

    function currentSettings() {
        const values = {}
        for (const key of sharedKeys)
            values[key] = Plasmoid.configuration[key]
        return values
    }

    function syncSettings(shared) {
        const first = settingsSeen === ""
        if (shared && shared.at > settingsSeenAt) {
            settingsSeenAt = shared.at
            if (shared.by !== instanceId) {
                for (const key in shared.values)
                    if (sharedKeys.indexOf(key) >= 0 && Plasmoid.configuration[key] !== shared.values[key])
                        Plasmoid.configuration[key] = shared.values[key]
                settingsSeen = JSON.stringify(currentSettings())
                return
            }
        }
        const now = JSON.stringify(currentSettings())
        if (now === settingsSeen)
            return
        settingsSeen = now
        // Changed here: save it for the others. The first check of a copy
        // saves only what's been set up, so a new copy can't replace the
        // others' settings with defaults.
        if (!first || !shared)
            settingsSaver.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --save-settings " + shellQuote(now)
                                        + " --by " + shellQuote(instanceId) + (first ? " --unless-default" : "") + " # " + Date.now())
    }

    P5Support.DataSource {
        id: settingsSaver
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => disconnectSource(source)
    }

    Plasmoid.icon: "dialog-messages"
    // In the system tray, "shown when relevant" means: while a chat runs, and
    // until you've seen what needs you or finished
    Plasmoid.status: overall === "waiting" || unseenDone > 0 ? PlasmaCore.Types.NeedsAttentionStatus
                   : inTray && overall === "none" ? PlasmaCore.Types.PassiveStatus
                   : PlasmaCore.Types.ActiveStatus

    toolTipMainText: i18n("Claude Code")
    toolTipSubText: tooltipText()

    switchWidth: Kirigami.Units.gridUnit * 16
    switchHeight: Kirigami.Units.gridUnit * 12

    compactRepresentation: CompactRepresentation {}
    fullRepresentation: FullRepresentation {}

    // The widget's keyboard shortcut (its settings' Keyboard Shortcuts page)
    // goes to the chat that needs you, or opens the popup when none does
    // (shortcutGoesToChat). Plasma opens the popup on the shortcut whatever
    // the widget says (activationTogglesExpanded only stops it from closing),
    // so a jump closes it again right away, and opening it counts as seeing
    // the chats only once it stays open (markSeen). In the system tray, the
    // tray opens the popup.
    property bool shortcutJump: false
    Connections {
        target: Plasmoid
        function onActivated() {
            if (root.inTray || !Plasmoid.configuration.shortcutGoesToChat)
                return
            const chats = root.chatsNeedingYou()
            if (!chats.length)
                return
            root.shortcutJump = true
            Qt.callLater(() => {
                root.goToNextChat(chats)
                root.expanded = false
                root.shortcutJump = false
            })
        }
    }

    // Chats that need you, most urgent first: waiting (the longest first),
    // then ones that finished a turn while you weren't looking (newest first).
    // Keys as in trackTransitions.
    function chatsNeedingYou() {
        const waiting = [], finished = []
        const seen = {}
        for (const g of allGroups) {
            for (const s of g.sessions) {
                const key = petKeyOf(s, g.host)
                if (key in seen)
                    continue   // the chat's most urgent row came first
                seen[key] = true
                if (s.state === "waiting")
                    waiting.push({ key: key, session: s, host: g.host || "" })
                else if (unseen[key] === "done")
                    finished.push({ key: key, session: s, host: g.host || "" })
            }
        }
        waiting.sort((a, b) => (a.session.since || 0) - (b.session.since || 0))
        finished.sort((a, b) => (b.session.since || 0) - (a.session.since || 0))
        return waiting.concat(finished)
    }

    property string lastNextKey: ""
    property real lastNextAt: 0

    // Pressed again within 30 s, the shortcut goes on to the next chat
    function goToNextChat(chats) {
        if (!chats.length)
            return
        let i = 0
        if (Date.now() - lastNextAt < 30000) {
            const j = chats.findIndex(c => c.key === lastNextKey)
            if (j >= 0)
                i = (j + 1) % chats.length
        }
        const c = chats[i]
        lastNextKey = c.key
        lastNextAt = Date.now()
        forgetUnseen(c.key, "done")
        if (c.host)
            remoteShow(c.host, c.session)
        else
            jumpTo(c.session.sessionId, c.session.profileDir)
    }

    // While you're away (the screen is locked) for awayMinutes, chats that
    // finish or need you don't notify one by one: when you're back, one
    // notification sums up what happened since you left (awayDigest).
    property bool away: false
    property real awaySince: 0
    property var awayEvents: []         // [{kind: done|failed|stopped|reset, name}]
    property var awayDigest: null       // the last summary, at the top of the popup until you've seen it

    function awayLongEnough() {
        return away && Date.now() - awaySince >= Plasmoid.configuration.awayMinutes * 60000
    }

    function holdingBack() {
        return awayLongEnough() && Plasmoid.configuration.awayDigest
    }

    // ...and meanwhile, chats that need you (or finish) go to your phone with
    // KDE Connect (phoneWhileAway; jump.py --phone)
    function toPhone(text) {
        if (!root.notifier || !Plasmoid.configuration.phoneWhileAway || !awayLongEnough())
            return
        const device = Plasmoid.configuration.phoneDevice
        phoneSender.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --phone " + shellQuote(text)
                                  + (device ? " --device " + shellQuote(device) : "") + " # " + Date.now())
    }

    P5Support.DataSource {
        id: phoneSender
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => disconnectSource(source)   // a phone out of reach just misses it
    }

    function noteAway(kind, name) {
        if (away)
            awayEvents = awayEvents.concat([{ kind: kind, name: name }])
    }

    function setAway(locked) {
        if (locked === away)
            return
        if (locked) {
            away = true
            awaySince = Date.now()
            awayEvents = []
            return
        }
        const took = Date.now() - awaySince
        away = false
        if (Plasmoid.configuration.awayDigest && took >= Plasmoid.configuration.awayMinutes * 60000)
            sendDigest(took)
        awayEvents = []
    }

    // "Needs you: fix-parser (waiting 22m)", "Finished: a, b", … for what
    // happened while you were away (events) and the chats waiting now
    function digestLines(events, waiting) {
        const lines = []
        const names = kind => {
            const seen = []
            for (const e of events)
                if (e.kind === kind && seen.indexOf(e.name) < 0)
                    seen.push(e.name)
            return seen
        }
        const list = all => all.slice(0, 4).join(", ") + (all.length > 4 ? " " + i18nc("and more", "+%1", all.length - 4) : "")
        for (const c of waiting.slice(0, 3))
            lines.push(i18n("Needs you: %1 (waiting %2)", c.session.name + (c.host ? " · " + c.host : ""),
                            duration(Date.now() - (c.session.since || Date.now()))))
        if (waiting.length > 3)
            lines.push(i18np("+%1 more needs you", "+%1 more need you", waiting.length - 3))
        const done = names("done"), failed = names("failed"), stopped = names("stopped"), resets = names("reset")
        if (done.length)
            lines.push(i18n("Finished: %1", list(done)))
        if (failed.length)
            lines.push(i18n("Failed: %1", list(failed)))
        if (stopped.length)
            lines.push(i18n("Stopped: %1", list(stopped)))
        for (const r of resets)
            lines.push(i18n("%1 limit reset", r))
        return lines
    }

    function sendDigest(took) {
        const waiting = chatsNeedingYou().filter(c => c.session.state === "waiting")
        const lines = digestLines(awayEvents, waiting)
        if (!lines.length)
            return
        const title = i18n("While you were away (%1)", duration(took))
        awayDigest = { title: title, lines: lines }
        if (!root.notifier || !(Plasmoid.configuration.notifyWaiting || Plasmoid.configuration.notifyDone))
            return
        const first = waiting.length ? waiting[0] : null
        notify("away-digest", first ? first.session : null, "digest", title, lines.join("\n"), "user-away", first ? first.host : "")
        queueSound(waiting.length ? "waiting" : awayEvents.some(e => e.kind === "failed") ? "failed" : "done")
        playQueuedSound()
    }

    // Is the screen locked? Asked every 10 s by the copy that notifies.
    P5Support.DataSource {
        id: lockWatch
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const out = String(data["stdout"] || "")
            if (/boolean (true|false)/.test(out))
                root.setAway(out.indexOf("boolean true") >= 0)
        }
    }

    Timer {
        interval: 10000
        repeat: true
        running: root.notifier && (Plasmoid.configuration.awayDigest || Plasmoid.configuration.phoneWhileAway)
        triggeredOnStart: true
        onTriggered: lockWatch.connectSource("dbus-send --session --print-reply=literal --dest=org.freedesktop.ScreenSaver"
                                             + " /ScreenSaver org.freedesktop.ScreenSaver.GetActive # " + Date.now())
    }

    // Runs `jump.py --changes`: the files a chat changed, side by side in VS Code
    P5Support.DataSource {
        id: differ
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const result = root.helperResult(data)
            if (result.ok) {
                root.actionError = ""
                root.expanded = false
            } else {
                root.actionError = i18n("Couldn't compare the changes: %1", result.message)
                actionErrorTimer.restart()
            }
        }
    }

    function showChanges(chatId, profileDir, turn) {
        differ.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --changes " + shellQuote(chatId)
                             + profileArg(profileDir) + (turn ? " --turn" : "") + configDirArgs + " # " + Date.now())
    }

    function toggleStats(groupKey) {
        expandedStats = Object.assign({}, expandedStats, { [groupKey]: !expandedStats[groupKey] })
    }

    // "Tue" (long: "Tuesday 15 October") for a day of the stats ("2026-10-15")
    function dayName(day, long) {
        const p = String(day).split("-").map(Number)
        if (p.length !== 3)
            return ""
        const d = new Date(p[0], p[1] - 1, p[2])
        return long ? d.toLocaleDateString(Qt.locale(), "dddd d MMMM") : Qt.locale().dayName(d.getDay(), Locale.NarrowFormat)
    }

    // A chat's recap (claude_status.py: stats_summary), e.g. "3 prompts ·
    // worked 51m · 278 tool calls (Bash 236, Read 23) · 85.3M tokens (249k out)"
    function recapText(st, costUsd) {
        if (!st)
            return ""
        const parts = [i18np("%1 prompt", "%1 prompts", st.prompts)]
        if (st.workedMs > 0)
            parts.push(i18n("worked %1", st.workedMs < 60000 ? i18nc("less than a minute", "<1m") : duration(st.workedMs)))
        if (st.toolCalls)
            parts.push(i18np("%1 tool call", "%1 tool calls", st.toolCalls)
                       + " (" + st.tools.slice(0, 3).map(t => t[0] + " " + t[1]).join(", ") + ")")
        parts.push(i18n("%1 tokens (%2 out)", formatTokens(st.tokens.total), formatTokens(st.tokens.output)))
        if (costUsd !== null && costUsd !== undefined && costUsd > 0)
            parts.push(i18n("$%1 at API prices", costUsd.toFixed(2)))
        return parts.join(" · ")
    }

    function togglePeek(rowKey) {
        const next = Object.assign({}, expandedPeek)
        next[rowKey] = !next[rowKey]
        expandedPeek = next
    }

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
            text: i18n("Go to the Chat That Needs You")
            icon.name: "go-next"
            visible: root.chatsNeedingYou().length > 0
            onTriggered: root.goToNextChat(root.chatsNeedingYou())
        },
        PlasmaCore.Action {
            text: i18n("Open Usage Page on claude.ai")
            icon.name: "internet-web-browser"
            onTriggered: Qt.openUrlExternally("https://claude.ai/settings/usage")
        }
    ]

    Connections {
        target: Hub
        function onOutput(command, stdout, stderr) {
            if (command === root.command)
                root.handleOutput(stdout, stderr)
            const host = root.hostOfCommand(command)
            if (host)
                root.handleRemote(host, { stdout: stdout, stderr: stderr })
        }
        function onStarted(command) {
            const host = root.hostOfCommand(command)
            if (host)
                root.setRemote(host, { loading: true })
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
                if (!root.dashboardShown)
                    root.notify("jump-error", null, "error", i18n("Couldn't open the session"), result.message, "dialog-error")
            }
        }
    }

    // Runs `jump.py --stop`, which stops a background session (`claude stop`)
    // or a chat in a terminal or VS Code (its claude quits), or `--interrupt`
    // (Esc for a chat in tmux).
    P5Support.DataSource {
        id: stopper
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const result = root.helperResult(data)
            if (!result.ok) {
                root.actionError = i18n("Couldn't stop the session: %1", result.message)
                actionErrorTimer.restart()
            } else {
                root.actionError = ""
                if (result.message.indexOf("killed") >= 0 || result.message.indexOf("ended") >= 0) {
                    root.actionInfo = result.message   // more happened than you asked for: say so
                    actionInfoTimer.restart()
                }
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

    // Every pollInterval while a chat runs (here or on a host) or the popup is
    // open; with nothing running, every idlePollInterval (never more often).
    // An idle panel then costs less, and a chat that starts still shows
    // within seconds (opening the popup checks at once). The GNOME extension
    // does the same (logic.js).
    readonly property bool quiet: status !== null && overall === "none" && !root.dashboardShown
    readonly property int pollMs: Math.max(1000, Plasmoid.configuration.pollInterval)
    readonly property int checkInterval: quiet ? Math.max(pollMs, Plasmoid.configuration.idlePollInterval) : pollMs

    // The checks come from hub/Hub.qml, as often as the most eager copy
    // wants them (an open popup: pollInterval)
    onCommandChanged: Hub.want(instanceId, "status", command, checkInterval, true)
    onCheckIntervalChanged: Hub.want(instanceId, "status", command, checkInterval, true)
    Component.onDestruction: Hub.drop(instanceId)

    function refresh() {
        Hub.refresh(command)
    }

    // Most checks say what the one before said but for their time and the
    // usage forecasts, which drift with it. Then only the clock moves on
    // (time labels) and the dashboard isn't rebuilt; the forecasts catch up
    // within 30 s.
    property string lastOutputKey: ""
    property real lastFullUpdate: 0

    function handleOutput(stdout, stderr) {
        const time = /"generatedAt": *(\d+)/.exec(stdout)
        const key = stdout.replace(/"generatedAt": *\d+/g, "").replace(/"forecast": *\{[^{}]*\}/g, "")
        if (status && time && key === lastOutputKey && Date.now() - lastFullUpdate < 30000) {
            now = Number(time[1])
            return
        }
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
        lastOutputKey = key
        lastFullUpdate = Date.now()
        now = parsed.generatedAt
        status = parsed   // first: whether this copy notifies
        trackTransitions("", parsed.groups, parsed.generatedAt, "")
        trackLimitStops("", parsed.groups, "")
        trackOverlaps("", parsed.groups, "")
        startDueTasks(parsed.queue || [])
        celebrateResets("", parsed.groups)
        syncSettings(parsed.sharedSettings || null)
    }

    function celebrateResets(source, groupList) {
        const next = Object.assign({}, lastWindows)
        for (const g of groupList) {
            for (const w of (g.limits ? g.limits.windows : [])) {
                const key = source + "|" + g.id + "/" + w.key
                if (key in lastWindows && lastWindows[key] >= 25 && w.pct < lastWindows[key] - 20) {
                    petEvent("reset", i18n("%1 limit reset!", w.label), "")
                    noteAway("reset", w.label + (g.host ? " · " + g.host : ""))
                }
                next[key] = w.pct
            }
        }
        lastWindows = next
    }

    // "work · Team", or "lab: work · Team" for an SSH host's account
    function groupLabel(g) {
        return g.host ? i18nc("ssh host: account", "%1: %2", g.host, g.name) : g.name
    }

    // Rows are tracked by account and chat (petKeyOf), not the chat id alone:
    // a chat shared across profiles is listed once per profile with the same
    // id, and keying by id made the two rows flip each other's state on every
    // poll (a notification each time).
    property var lastWaitingAlert: ({})

    // One sound per poll at most (several sessions can change at once): the
    // most urgent of the notifications sent.
    property string pendingSound: ""
    readonly property var soundRank: ({ "": 0, done: 1, failed: 2, waiting: 3 })
    property string pendingSoundKind: ""

    function queueSound(kind) {
        if (!root.notifier || !Plasmoid.configuration.notifySound || soundRank[kind] <= soundRank[pendingSoundKind])
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
                const sid = petKeyOf(s, host)   // starts with source + "|" for a host's
                if (sid in next)
                    continue   // a chat listed twice: its most urgent row (they come first) counts
                const prev = before[sid]
                const active = s.state === "working" || s.state === "waiting"
                next[sid] = s.state
                // A turn runs from leaving idle/done until returning to it.
                if (active)
                    starts[sid] = sid in startedAt ? startedAt[sid] : (s.since || nowMs)
                if (prev === "waiting" && s.state !== "waiting") {
                    closeNotification(sid, "waiting")  // answered: drop the stale prompt
                    forgetUnseen(sid, "waiting")
                }
                if (s.state === "working")
                    forgetUnseen(sid, "done")  // it's at it again
                if (!primed || prev === s.state)
                    continue
                if (s.state === "waiting") {
                    markUnseen(sid, "waiting")
                    // At most one "needs input" alert per session per minute
                    const quiet = nowMs - (lastWaitingAlert[sid] || 0) < 60000
                    if (!quiet) {
                        lastWaitingAlert[sid] = nowMs
                        petEvent("waiting", i18n("%1 needs you!", s.name), petKeyOf(s, host))
                        toPhone(i18n("Claude: %1 needs you", s.name + where) + (s.detail ? " (" + s.detail + ")" : "")
                                + " · " + s.cwdShort)
                        if (Plasmoid.configuration.notifyWaiting && root.notifier && !holdingBack()) {
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
                    if (took >= Plasmoid.configuration.notifyDoneMinSeconds * 1000)
                        markUnseen(sid, "done")
                    noteAway(s.reason === "failed" || s.reason === "stopped" ? s.reason : "done", s.name + where)
                    if (Plasmoid.configuration.phoneFinished && took >= Plasmoid.configuration.notifyDoneMinSeconds * 1000)
                        toPhone((s.reason === "failed" ? i18n("Claude: %1 failed", s.name + where)
                                 : s.reason === "stopped" ? i18n("Claude: %1 was stopped", s.name + where)
                                 : i18n("Claude: %1 finished", s.name + where))
                                + (s.detail ? " (" + s.detail + ")" : "") + " · " + i18n("took %1", duration(took)))
                    if (Plasmoid.configuration.notifyDone && root.notifier && !holdingBack()
                            && took >= Plasmoid.configuration.notifyDoneMinSeconds * 1000) {
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
        for (const sid in unseen) {
            const mine = source ? sid.startsWith(prefix) : sid.indexOf("|") < 0
            if (mine && !(sid in next))
                forgetUnseen(sid, "")
        }
        for (const sid in lastWaitingAlert) {
            const mine = source ? sid.startsWith(prefix) : sid.indexOf("|") < 0
            if (mine && !(sid in next))
                delete lastWaitingAlert[sid]
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
        const summary = kind === "digest"   // while you were away: someone waits for you, or all went well
        const pose = kind === "done" && session && session.reason === "failed" ? "sad"
                   : summary ? (session ? "oncall" : "trophy")
                   : { waiting: "oncall", overlap: "oncall", done: "trophy", reset: "trophy", started: "trophy", error: "error" }[kind]
        const n = notificationComponent.createObject(root, {
            sessionId: session ? session.sessionId : "", profileDir: session ? session.profileDir || "" : "",
            host: host || "", openCommand: session && session.openCommand ? session.openCommand : "",
            session: host && session ? session : null,
            kind: kind, title: title, text: escapeHtml(body.trim()),   // Plasma shows markup in the text
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
        if (!n.sessionId && !n.host)
            root.expanded = true   // nothing waits for you, or what went wrong: show the popup
        else if (n.host && n.session)
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

    function toggleAgentRun(key) {
        expandedAgentRuns = Object.assign({}, expandedAgentRuns, { [key]: !expandedAgentRuns[key] })
    }

    // "12 tool calls · 45.2k tokens" of a subagent, as far as it's known
    function agentNumbers(agent) {
        const parts = []
        if (agent.toolCalls !== null && agent.toolCalls !== undefined)
            parts.push(i18np("%1 tool call", "%1 tool calls", agent.toolCalls))
        if (agent.tokens)
            parts.push(i18n("%1 tokens", formatTokens(agent.tokens)))
        return parts.join(" · ")
    }

    // A subagent's whole run as a Markdown file, opened in your app for those
    // (jump.py --agent-run; remote.py fetches it from an SSH host): Claude
    // Code itself can't open a subagent from outside.
    P5Support.DataSource {
        id: runOpener
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const result = root.helperResult(data)
            if (result.ok) {
                root.actionError = ""
                root.expanded = false
            } else {
                root.actionError = i18n("Couldn't open the subagent's run: %1", result.message)
                actionErrorTimer.restart()
            }
        }
    }

    function openAgentRun(session, agentId, host) {
        if (host)
            remoteAction("run", host, "--agent-run " + shellQuote(host) + " " + shellQuote(session.chatId) + " "
                                      + shellQuote(agentId) + (session.profileDir ? " " + shellQuote(session.profileDir) : ""))
        else
            runOpener.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --agent-run " + shellQuote(agentId)
                                    + " --chat " + shellQuote(session.chatId) + profileArg(session.profileDir)
                                    + configDirArgs + " # " + Date.now())
    }

    function toggleRecent(groupKey, wasOpen) {
        expandedRecent = Object.assign({}, expandedRecent, { [groupKey]: !wasOpen })
    }

    // New chat: the + next to an account unfolds its folders under its name
    // (NewChatBox.qml), with a field for what Claude should do. A folder
    // starts the chat there (startChat): in a terminal, in VS Code's Claude
    // extension (the switch above them) or, with a task, in the background.
    property string newChatGroup: ""   // group key of the account whose folders are open
    property bool digestSeen: false
    onExpandedChanged: {
        if (!root.expanded) {
            newChatGroup = ""
            planComposer = ""   // (what you wrote in it stays: root.taskText)
            if (digestSeen)
                awayDigest = null
            digestSeen = false
        } else {
            Qt.callLater(markSeen)
            refresh()  // it may have been checked a while ago (see quiet)
        }
    }

    // The popup stayed open (not just flashed open by the shortcut): what it
    // shows counts as seen, and the icon stops blinking
    function markSeen() {
        if (!root.expanded || shortcutJump)
            return
        unseen = ({})
        digestSeen = awayDigest !== null
    }

    function markUnseen(sid, kind) {
        if (!root.dashboardShown)
            unseen = Object.assign({}, unseen, { [sid]: kind })
    }

    function forgetUnseen(sid, kind) {
        if (sid in unseen && (!kind || unseen[sid] === kind)) {
            const next = Object.assign({}, unseen)
            delete next[sid]
            unseen = next
        }
    }

    function toggleNewChat(groupKey) {
        newChatGroup = newChatGroup === groupKey ? "" : groupKey
        planComposer = ""
    }

    // Here: your recent folders, then any folder you pick in the folder dialog
    // (it opens in your home folder). An SSH host's folders can't be browsed
    // from here, so its home folder stays in the list. A plan's own folder
    // (where the chat that made it ran) comes first.
    function newChatFolders(group, host, plan) {
        let folders = host ? group.projects.slice() : group.projects.filter(f => f.short !== "~")
        if (host && !folders.some(f => f.short === "~"))
            folders.push({ path: "", short: "~", newChatCommand: group.homeChatCommand || "", trusted: false })
        if (plan && plan.cwd) {
            const own = folders.find(f => f.path === plan.cwd)
            folders = [own || { path: plan.cwd, short: plan.cwdShort || plan.cwd, newChatCommand: "" }]
                .concat(folders.filter(f => f.path !== plan.cwd))
        }
        return folders
    }

    // Chats open in a terminal or in VS Code (OpenInSwitch.qml): one choice,
    // newChatInVscode, for new and recent chats.
    // VS Code's Claude extension runs on the account its own environment and
    // settings say (claude_status.py: vscode_profile), so its button is only
    // on that account (an SSH host's: the host's ~/.claude)
    readonly property bool vscodeInstalled: status !== null && !!status.vscode && status.vscode.installed === true

    // There's a claude command here (host: on that SSH host). When unsure
    // (no answer yet, or an error looking), it counts as there.
    function cliHere(host) {
        const result = host ? (remote[host] || {}).result : status
        return !result || !result.cli || result.cli.installed !== false
    }

    // Where this account's chats open: VS Code when you picked it, or when
    // there's no claude command but VS Code's Claude runs on this account
    // (resuming: a recent chat, which reopens on its own account)
    function openInVscode(group, host, resuming) {
        if (!vscodeInstalled || !(group.vscodeHere || (!resuming && vscodeSwitches(group, host))))
            return false
        return Plasmoid.configuration.newChatInVscode || !cliHere(host)
    }

    // A new chat on an SSH host's other account opens in VS Code too: VS
    // Code's Claude there switches to that account first, and stays on it
    // (jump.py --remote-new-vscode --account; configDir comes from the host)
    function vscodeSwitches(group, host) {
        return !!host && vscodeInstalled && !group.vscodeHere && group.configDir !== undefined
    }

    // resuming: for the recent chats' switch (they reopen) instead of new chats'
    function terminalHint(host, resuming) {
        if (!cliHere(host))
            return host ? i18n("Claude Code's claude command isn't installed on %1: it isn't on PATH there, in ~/.local/bin, npm's or nvm's folders, nor on the login shell's PATH.", host)
                        : i18n("Claude Code's claude command isn't installed here: it isn't on PATH, in ~/.local/bin, npm's or nvm's folders, nor on your login shell's PATH.")
        if (resuming)
            return host ? i18n("Reopens the chat on %1 in a terminal (ssh, claude --resume).", host)
                        : i18n("Reopens the chat in a terminal (claude --resume).")
        return host ? i18n("A terminal opens with Claude on %1 (ssh) in the folder you click.", host)
                    : i18n("A terminal opens with Claude in the folder you click.")
    }

    function vscodeHint(group, host, resuming) {
        if (!vscodeInstalled)
            return host ? i18n("VS Code would connect to %1 (Remote-SSH), but it isn't installed on this computer.", host)
                        : i18n("VS Code isn't installed on this computer.")
        if (group.vscodeHere && resuming)
            return host ? i18n("Opens VS Code connected to %1 (Remote-SSH) in the chat's folder, and the chat in its Claude panel.", host)
                        : i18n("Opens the chat's folder in VS Code, and the chat in its Claude panel.")
        if (group.vscodeHere)
            return host ? i18n("Opens VS Code connected to %1 (Remote-SSH) with a new chat in its Claude panel.", host)
                        : i18n("Opens the folder in VS Code with a new chat in its Claude panel.")
        if (host && !resuming && vscodeSwitches(group, host))
            return i18n("Opens VS Code connected to %1 (Remote-SSH) with a new chat in its Claude panel. VS Code's Claude on %1 switches to %2 for it, and stays on it.", host, group.title)
        if (host)
            return i18n("VS Code's Claude on %1 runs on another account: a new chat in VS Code on this one switches it.", host)
        const on = status && status.vscode ? status.vscode.on : null
        return on ? i18n("VS Code's Claude runs on %1, not %2: switch its profile to use this account there.", on, group.title)
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
            const host = root.launcherHosts[source]
            if (host) {
                const rest = Object.assign({}, root.launcherHosts)
                delete rest[source]
                root.launcherHosts = rest
                root.pollHost(host)
            }
        }
    }

    // A recent chat, reopened in VS Code's Claude extension (in its folder)
    function resumeInVscode(sessionId, profileDir) {
        jumper.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --resume " + shellQuote(sessionId)
                             + profileArg(profileDir) + " --vscode" + configDirArgs + " # " + Date.now())
    }

    // A recent chat of an SSH host, reopened in VS Code connected to it
    function remoteResumeVscode(host, sessionId, folder) {
        jumper.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --remote-resume-vscode " + shellQuote(host)
                             + " " + shellQuote(sessionId) + (folder ? " --cwd " + shellQuote(folder) : "") + " # " + Date.now())
    }

    // A new chat in a terminal on an SSH host (a folder's newChatCommand).
    // The list closes here, not in the folder's row: closing it destroys
    // the row, and the rest of the row's click handler lost root with it.
    function remoteNewChat(host, command) {
        newChatGroup = ""
        remoteOpen(host, command)
    }

    // VS Code connected to an SSH host, with a new chat (in folder there, or home)
    // group: the account the chat is for, when it isn't VS Code's there yet
    // text, plan: a task to type in there (its plan comes from the host)
    function remoteNewChatVscode(host, folder, group, text, plan) {
        newChatGroup = ""
        const account = group && !group.vscodeHere ? " --account " + shellQuote(group.configDir || "-") : ""
        const line = "python3 -I " + shellQuote(codeDir + "jump.py") + " --remote-new-vscode " + shellQuote(host)
                     + (folder ? " --cwd " + shellQuote(folder) : "") + account
                     + (text ? " --prompt " + shellQuote(text) : "")
                     + (plan ? " --plan " + shellQuote(plan.slug) + " --plan-profile " + shellQuote(plan.profileDir) : "")
                     + " # " + Date.now()
        launcherHosts = Object.assign({}, launcherHosts, { [line]: host })
        launcher.connectSource(line)
    }

    property var launcherHosts: ({})   // command -> SSH host it was for (checked again after: its accounts may have switched)

    // Claude's own login for an account that isn't logged in, in a terminal
    // (accounts.py --login; an SSH host's account: its loginCommand over ssh)
    function logIn(group, host) {
        if (host) {
            remoteOpen(host, group.loginCommand)
            return
        }
        loginRunner.connectSource("python3 -I " + shellQuote(codeDir + "accounts.py") + " --login " + shellQuote(group.chatProfile)
                                  + configDirArgs + " # " + Date.now())
    }

    P5Support.DataSource {
        id: loginRunner
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const result = root.helperResult(data)
            if (result.ok) {
                root.actionError = ""
                root.expanded = false
            } else {
                root.actionError = i18n("Couldn't log in: %1", result.message)
                actionErrorTimer.restart()
            }
        }
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

    Component.onCompleted: {
        loadHosts()
        Hub.want(instanceId, "status", command, checkInterval, true)
        wantHosts()
    }

    // Status of the hosts you picked: polled less often than this computer,
    // once for all copies (hub/Hub.qml; a host just picked is checked at once)
    property var wantedHosts: ({})   // host -> its check's command
    readonly property string hostWish: JSON.stringify([shownHosts, Plasmoid.configuration.remotePollSeconds,
        Plasmoid.configuration.keepDoneHours, Plasmoid.configuration.recentChats, Plasmoid.configuration.showTokens])
    onHostWishChanged: wantHosts()

    function wantHosts() {
        const next = {}
        const interval = Math.max(10, Plasmoid.configuration.remotePollSeconds) * 1000
        for (const host of shownHosts) {
            next[host] = hostCommand(host)
            Hub.want(instanceId, "ssh:" + host, next[host], interval, false)
        }
        for (const host in wantedHosts)
            if (!(host in next))
                Hub.unwant(instanceId, "ssh:" + host)
        wantedHosts = next
    }

    function hostOfCommand(command) {
        for (const host in wantedHosts)
            if (wantedHosts[host] === command)
                return host
        return ""
    }

    onShownHostsChanged: {
        const next = {}
        for (const host of shownHosts)
            if (host in remote)
                next[host] = remote[host]
        for (const host in remote)
            if (!(host in next))
                forgetSource("ssh:" + host)  // shown again later, it starts afresh
        remote = next
    }

    // What a source's chats were (and their notifications): gone with the source
    function forgetSource(source) {
        const prefix = source + "|"
        for (const key in notifications)
            if (key.startsWith(prefix))
                closeNotification(key, notifications[key].kind)
        for (const key in unseen)
            if (key.startsWith(prefix))
                forgetUnseen(key, "")
        for (const key in lastWaitingAlert)
            if (key.startsWith(prefix))
                delete lastWaitingAlert[key]
        const drop = map => { const out = Object.assign({}, map); delete out[source]; return out }
        lastStates = drop(lastStates)
        turnStarts = drop(turnStarts)
        primedSources = drop(primedSources)
    }

    // A host's answer on this computer's clock: its times ("since", "last
    // active", resets) are its own clock's, which may be off from ours
    function toLocalClock(result, offset) {
        if (Math.abs(offset) < 5000)
            return result   // network delay, or close enough
        const at = t => typeof t === "number" ? t + offset : t
        const shift = (o, keys) => { if (o) for (const k of keys) o[k] = at(o[k]) }
        result = JSON.parse(JSON.stringify(result))
        result.generatedAt = at(result.generatedAt)
        for (const g of result.groups || []) {
            for (const s of g.sessions || []) {
                shift(s, ["since", "startedAt"])
                shift(s.peek, ["at"])
                shift(s.peek && s.peek.recap, ["at"])
                shift(s.stopped, ["at", "resetsAt"])
                shift(s.plan, ["updatedAt"])
                shift(s.stats, ["startedAt", "lastAt"])
                for (const a of (s.agents && s.agents.tree) || [])
                    shift(a, ["started", "updated"])
            }
            for (const c of (g.recent || []).concat(g.sharedHere || [])) {
                shift(c, ["lastActive", "since"])
                shift(c.recap, ["at"])
                shift(c.stopped, ["at", "resetsAt"])
            }
            for (const plan of g.plans || [])
                shift(plan, ["updatedAt"])
            if (g.limits) {
                shift(g.limits, ["updatedAt"])
                for (const w of g.limits.windows || []) {
                    shift(w, ["resetsAt"])
                    shift(w.forecast, ["fullAt"])
                }
            }
        }
        return result
    }

    function hostCommand(host) {
        let cmd = "python3 -I " + shellQuote(codeDir + "remote.py") + " --status " + shellQuote(host)
                  + " --done-hours " + Math.max(0, Plasmoid.configuration.keepDoneHours)
                  + " --recent " + Math.max(0, Plasmoid.configuration.recentChats)
        if (!Plasmoid.configuration.showTokens)
            cmd += " --no-tokens"
        return cmd
    }

    function pollHost(host) {
        Hub.refresh(hostCommand(host))   // (not while its last check still runs)
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
            const result = toLocalClock(answer.result, Date.now() - (answer.result.generatedAt || Date.now()))
            trackTransitions("ssh:" + host, result.groups, result.generatedAt, host)
            trackLimitStops("ssh:" + host, result.groups, host)
            trackOverlaps("ssh:" + host, result.groups, host)
            celebrateResets("ssh:" + host, result.groups)
            setRemote(host, { loading: false, ok: true, error: "", result: result, updatedAt: Date.now(),
                              login: false, loggedIn: !!answer.loggedIn })
        } else {
            // keep the last answer to show (dimmed) with the error
            setRemote(host, { loading: false, ok: false, error: answer.error || answer.message || i18n("no answer"),
                              login: !!answer.login, loggedIn: false })
        }
    }

    // A host that wants a password (or a passphrase, a code, its host key
    // confirmed): remote.py --login opens a terminal where ssh asks for it,
    // so it goes to ssh only. The checks then share that connection (until
    // 30 minutes after their last use, logging out, or Disconnect). Until
    // you're in, the host is checked every few seconds.
    function loginHost(host) {
        remoteAction("login", host, "--login " + shellQuote(host))
        loginWaits = Object.assign({}, loginWaits, { [host]: Date.now() + 180000 })
    }

    function disconnectHost(host) {
        remoteAction("disconnect", host, "--disconnect " + shellQuote(host))
    }

    property var loginWaits: ({})   // host -> until when it's checked often

    Timer {
        interval: 3000
        repeat: true
        running: Object.keys(root.loginWaits).length > 0
        onTriggered: {
            const next = {}
            for (const host in root.loginWaits) {
                const info = root.remote[host]
                if ((info && info.ok) || Date.now() > root.loginWaits[host] || root.shownHosts.indexOf(host) < 0)
                    continue
                next[host] = root.loginWaits[host]
                root.pollHost(host)
            }
            root.loginWaits = next
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
            const target = (h.user ? h.user + "@" : "") + (h.hostname || h.name) + (h.jump ? " " + i18nc("ssh through a jump host", "via %1", h.jump) : "")
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
            const host = root.remoteActionHosts[source]
            delete root.remoteActionKinds[source]   // (each command is new: these would only grow)
            delete root.remoteActionHosts[source]
            if (result.ok) {
                root.actionError = ""
                if (what === "open" || what === "run" || what === "continue" || what === "login" || what === "plan")
                    root.expanded = false
                else if (what === "share" || what === "task") {
                    root.actionInfo = result.message
                    actionInfoTimer.restart()
                }
            } else {
                root.actionError = what === "open" ? i18n("Couldn't open the session: %1", result.message)
                                 : what === "stop" ? i18n("Couldn't stop the session: %1", result.message)
                                 : what === "run" ? i18n("Couldn't open the subagent's run: %1", result.message)
                                 : what === "plan" ? i18n("Couldn't open the plan: %1", result.message)
                                 : what === "task" ? i18n("Couldn't start it: %1", result.message)
                                 : result.message
                actionErrorTimer.restart()
                root.petEvent("oops", i18n("Hmm, that didn't work."), "")
                if (!root.dashboardShown)   // e.g. from a notification or the shortcut: say so
                    root.notify("remote-error", null, "error", i18n("That didn't work on %1", host || i18n("the host")),
                                root.actionError, "dialog-error")
            }
            if (what !== "open" && what !== "run" && what !== "plan" && host)
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
    // VS Code window, the terminal of one, or the terminal tab with the ssh connection)
    function remoteShow(host, session) {
        const cwd = session.cwd ? " --cwd " + shellQuote(session.cwd) : ""
        if (session.openCommand)
            remoteOpen(host, session.openCommand)
        else if (session.entrypoint === "claude-vscode")
            jumper.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --remote-vscode " + shellQuote(host)
                                 + " " + shellQuote(session.sessionId) + cwd + " # " + Date.now())
        else
            jumper.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --remote-terminal " + shellQuote(host)
                                 + " --name " + shellQuote(session.name || "")
                                 + (session.vscodeTerminal ? " --vscode-terminal " + Math.trunc(session.vscodeTerminal) + cwd : "")
                                 + " # " + Date.now())
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

    // A chat with a process on the host (claude_status.py --end there; busy:
    // you were told it's working or waiting), or one in tmux interrupted
    function remoteEnd(host, sessionId, profileDir, busy) {
        remoteAction("stop", host, "--end " + shellQuote(host) + " " + shellQuote(sessionId)
                                   + (profileDir ? " " + shellQuote(profileDir) : "") + (busy ? " --busy" : ""))
    }

    function remoteInterrupt(host, sessionId, profileDir) {
        remoteAction("stop", host, "--interrupt " + shellQuote(host) + " " + shellQuote(sessionId)
                                   + (profileDir ? " " + shellQuote(profileDir) : ""))
    }

    function remoteDismiss(host, sessionId) {
        remoteAction("dismiss", host, "--dismiss " + shellQuote(host) + " " + shellQuote(sessionId))
    }

    function remoteUndismissAll(host) {
        remoteAction("dismiss", host, "--undismiss-all " + shellQuote(host))
    }

    // ---------------------------------------------------------------- shared chats
    // Share a chat with your other accounts, continue it on one of them, or
    // keep it on one only: jump.py does it (sharing.py); on an SSH host,
    // between that host's accounts, remote.py does it there.

    // The accounts a chat of this computer (host "") or of an SSH host can go to
    function shareAccountsOf(host) {
        const result = host ? (remote[host] || {}).result : status
        return result && result.canShare === true ? result.groups.filter(g => !!g.shareProfile) : []
    }

    function shareHint(host) {
        return host ? i18n("Share this chat with your other accounts on %1 and pick it up there (in a terminal, over ssh), or keep it on one account only.", host)
                    : i18n("Share this chat with your other accounts and pick it up there, or keep it on one account only.")
    }

    readonly property var noShareConfirm: ({ key: "", chatId: "", name: "", profileKey: "", account: "", others: "", host: "" })
    // "Keep only on …" waits for a yes: {key, chatId, name, profileKey, account, others, host}
    property var shareConfirm: noShareConfirm

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
            property string host
            property var account: null
            onClicked: {
                if (kind === "keeponly")
                    root.askKeepOnly(rowKey, chatId, chatName, account, host)
                else
                    root.shareAction(kind, chatId, account ? account.shareProfile : "", host)
            }
        }
    }

    property var shareItems: []

    // chat: {chatId, name, shared, profileDir, host}; rowKey: where to ask "keep only on …?"
    function openShareMenu(button, chat, rowKey) {
        shareMenu.clearMenuItems()
        const host = chat.host || ""
        const accounts = shareAccountsOf(host)
        const here = accounts.find(g => g.profileKeys.indexOf(chat.profileDir) >= 0) || null
        const items = [shareItem.createObject(shareMenu, { section: true, text: host ? i18nc("chat name on host", "%1 on %2", chat.name, host) : chat.name })]
        for (const g of accounts) {
            if (g === here)
                continue
            items.push(shareItem.createObject(shareMenu, {
                text: chat.shared ? i18n("Continue on %1", g.title) : i18n("Share and continue on %1", g.title),
                icon: "system-switch-user", kind: "continue", chatId: chat.chatId, account: g, host: host
            }))
        }
        if (!chat.shared)
            items.push(shareItem.createObject(shareMenu, { text: i18n("Share with all accounts"), icon: "document-share",
                                                           kind: "share", chatId: chat.chatId, host: host }))
        else {
            items.push(shareItem.createObject(shareMenu, { separator: true }))
            for (const g of accounts)
                items.push(shareItem.createObject(shareMenu, {
                    text: i18n("Keep only on %1…", g.title), icon: "list-remove", kind: "keeponly",
                    chatId: chat.chatId, chatName: chat.name, rowKey: rowKey, account: g, host: host
                }))
        }
        for (const item of items)
            shareMenu.addMenuItem(item)
        shareItems = items
        shareMenu.visualParent = button
        shareMenu.openRelative()
    }

    function askKeepOnly(rowKey, chatId, name, account, host) {
        shareConfirm = {
            key: rowKey, chatId: chatId, name: name, profileKey: account.shareProfile, account: account.title,
            others: shareAccountsOf(host).filter(g => g.shareProfile !== account.shareProfile).map(g => g.title).join(", "),
            host: host
        }
    }

    function confirmKeepOnly() {
        const c = shareConfirm
        shareConfirm = noShareConfirm
        shareAction("keeponly", c.chatId, c.profileKey, c.host)
    }

    P5Support.DataSource {
        id: sharer
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const result = root.helperResult(data)
            const kind = root.shareKinds[source] || ""
            delete root.shareKinds[source]
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

    function shareAction(kind, chatId, profileKey, host) {
        const flag = { continue: "--continue", share: "--share", keeponly: "--unshare" }[kind]
        if (host) {
            // remote.py --share|--continue|--unshare HOST CHAT_ID [PROFILE]
            remoteAction(kind === "continue" ? "continue" : "share", host, flag + " " + shellQuote(host) + " "
                         + shellQuote(chatId) + (profileKey ? " " + shellQuote(profileKey) : ""))
            return
        }
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

    // busy: you were told it's working or waiting (else only an idle one is stopped)
    function stopSession(sessionId, profileDir, busy) {
        stopper.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --stop " + shellQuote(sessionId)
                              + profileArg(profileDir) + (busy ? " --busy" : "") + configDirArgs + " # " + Date.now())
    }

    // Esc in the tmux pane of a working chat
    function interruptSession(sessionId, profileDir) {
        stopper.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --interrupt " + shellQuote(sessionId)
                              + profileArg(profileDir) + configDirArgs + " # " + Date.now())
    }

    function jumpTo(sessionId, profileDir) {
        // Trailing comment keeps repeated clicks from being deduplicated by the engine.
        jumper.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " " + shellQuote(sessionId)
                             + profileArg(profileDir) + configDirArgs + " # " + Date.now())
    }

    // ---------------------------------------------------------------- usage limits that stopped chats
    // A chat a usage limit stopped (claude_status.py: stopped_by, limit_stop)
    // says when the limit resets. Once it has, one notification per account
    // says which of its chats can go on. Meanwhile one can continue on another
    // account that still has room (handOver: shared with it, then reopened there).

    property var lastStops: ({})   // source -> {chat key: whether its limit has reset}

    function trackLimitStops(source, groupList, host) {
        const before = lastStops[source]
        const next = {}
        for (const g of groupList) {
            const freed = []
            for (const s of g.sessions) {
                if (!s.stopped || s.stopped.kind !== "limit")
                    continue
                const key = petKeyOf(s, host)
                if (key in next)
                    continue
                next[key] = !!s.stopped.over
                if (before && before[key] === false && s.stopped.over)
                    freed.push(s)
            }
            if (!freed.length)
                continue
            const where = host ? i18nc("ssh host: account", "%1: %2", host, g.name) : g.name
            for (const s of freed)
                petEvent("reset", i18n("%1 can go on!", s.name), petKeyOf(s, host))
            if (!root.notifier || !Plasmoid.configuration.notifyDone || holdingBack())
                continue
            const names = freed.slice(0, 4).map(s => s.name).join(", ") + (freed.length > 4 ? " " + i18nc("and more", "+%1", freed.length - 4) : "")
            notify("limit-reset|" + source + "|" + g.id, freed[0], "reset", i18n("%1: the usage limit reset", where),
                   i18np("%2 can go on.", "%1 chats can go on: %2", freed.length, names), "chronometer-reset", host)
            queueSound("done")
        }
        lastStops = Object.assign({}, lastStops, { [source]: next })
        playQueuedSound()
    }

    // ---------------------------------------------------------------- chats changing the same files
    // Two chats with a process that changed some of the same files
    // (claude_status.py: note_overlaps): a tag on both rows, and one
    // notification per pair when it starts.

    property var lastOverlaps: ({})   // source -> {pair key: true}

    function trackOverlaps(source, groupList, host) {
        const before = lastOverlaps[source]
        const next = {}
        for (const g of groupList)
            for (const s of g.sessions)
                for (const o of (s.overlaps || [])) {
                    const pair = [s.key, o.key].sort().join("|")
                    if (pair in next)
                        continue
                    next[pair] = true
                    if (!before || pair in before)
                        continue   // (the first check only learns)
                    petEvent("waiting", i18n("%1 and %2 change the same files!", s.name, o.name), petKeyOf(s, host))
                    if (root.notifier && Plasmoid.configuration.notifyWaiting && !holdingBack())
                        notify("overlap|" + source + "|" + pair, s, "overlap", i18n("Two chats change the same files"),
                               i18n("%1 and %2: %3", s.name, o.name, o.files.join(", ") + (o.count > o.files.length ? " …" : ""))
                               + (host ? "\n" + host : ""), "dialog-warning", host)
                }
        lastOverlaps = Object.assign({}, lastOverlaps, { [source]: next })
    }

    // "Also changed by …" for a row's tag
    function overlapText(overlaps) {
        return overlaps.map(o => i18np("Also changed by “%2”: %3", "Also changed by “%2” (%1 files): %3", o.count, o.name,
                                       o.files.join(", ") + (o.count > o.files.length ? " …" : ""))).join("\n")
    }

    // ---------------------------------------------------------------- tasks waiting for a usage limit
    // A background task can wait for its account's usage limit to reset
    // (jump.py --queue; the status lists the queue). Once one is due, the
    // copy of the widget that notifies starts it (jump.py --start-queued,
    // which takes it out of the queue first: one start, whoever asks).

    property bool taskQueued: false    // the new-chat box: start after the limit resets
    property var startingTasks: ({})   // task id -> true while it's being started

    // When the usage limit this account is at resets ({at, label}), or null:
    // the latest of its full windows, else of the chats a limit stopped
    function limitReset(group, host) {
        let best = null
        for (const w of (group.limits ? group.limits.windows : []))
            if (w.pct >= 95 && w.resetsAt && (!best || w.resetsAt > best.at))
                best = { at: w.resetsAt, label: w.label }
        if (!best)
            for (const s of group.sessions)
                if (s.stopped && s.stopped.kind === "limit" && !s.stopped.over && s.stopped.resetsAt
                        && (!best || s.stopped.resetsAt > best.at))
                    best = { at: s.stopped.resetsAt, label: "" }
        return best && best.at > now ? best : null
    }

    function clockText(ms) {
        return new Date(ms).toLocaleTimeString(Qt.locale(), Locale.ShortFormat)
    }

    // What a queued task does, in a line
    function queuedWhat(t) {
        return t.chat ? i18n("Go on with “%1”", t.name || t.chat.slice(0, 8))
             : t.planTitle ? i18n("Carry out “%1”", t.planTitle) + (t.prompt ? ": " + t.prompt : "")
             : t.prompt
    }

    // The queued task that goes on with this chat (here, or on host), or null
    function queuedChat(chatId, host) {
        return (status && status.queue ? status.queue : []).find(t => t.chat === chatId && (t.host || "") === (host || ""))
               || null
    }

    // When a chat a usage limit stopped can go on by itself (a minute after
    // the limit resets: jump.py --queue-continue), in ms, or 0. Not one open
    // in VS Code's Claude (its tab can't be ended), nor one at work again.
    function goOnAt(session) {
        const stop = session.stopped
        if (!stop || stop.kind !== "limit" || stop.over || !stop.resetsAt || !(session.chatId || session.sessionId))
            return 0
        if (session.pid !== undefined && session.pid !== null
                && (session.entrypoint === "claude-vscode" || session.state !== "idle" || session.sessionId !== session.chatId))
            return 0
        return stop.resetsAt + 60000
    }

    function queueContinue(session, host, account) {
        const at = goOnAt(session)
        if (!at)
            return
        queuer.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --queue-continue "
                             + shellQuote(session.chatId || session.sessionId) + " --profile " + shellQuote(session.profileDir)
                             + " --at " + Math.round(at) + (session.cwd ? " --cwd " + shellQuote(session.cwd) : "")
                             + " --name " + shellQuote(session.name || "") + (host ? " --host " + shellQuote(host) : "")
                             + " --account " + shellQuote(account) + configDirArgs + " # " + Date.now())
    }

    // Queueing a task or a chat: says when it starts, or why it can't
    P5Support.DataSource {
        id: queuer
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const result = root.helperResult(data)
            if (result.ok) {
                root.actionError = ""
                if (result.message) {
                    root.actionInfo = result.message
                    actionInfoTimer.restart()
                }
            } else {
                root.actionError = i18n("Couldn't queue it: %1", result.message)
                actionErrorTimer.restart()
            }
            root.refresh()
        }
    }

    // The account's queued tasks (here, or on host)
    function queuedFor(group, host) {
        return (status && status.queue ? status.queue : []).filter(t => (t.host || "") === (host || "")
                                                                         && group.profileKeys.indexOf(t.profile) >= 0)
    }

    function startDueTasks(queue) {
        if (!root.notifier)
            return
        for (const t of queue)
            if (t.due && !startingTasks[t.id])
                startQueued(t)
    }

    function startQueued(t) {
        startingTasks = Object.assign({}, startingTasks, { [t.id]: true })
        const cmd = "python3 -I " + shellQuote(codeDir + "jump.py") + " --start-queued " + shellQuote(t.id) + configDirArgs
                    + " # " + Date.now()
        queueRuns[cmd] = t
        queueRunner.connectSource(cmd)
    }

    function unqueue(t) {
        runHelper("--unqueue " + shellQuote(t.id))
    }

    property var queueRuns: ({})   // command -> the task it starts

    P5Support.DataSource {
        id: queueRunner
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const t = root.queueRuns[source]
            delete root.queueRuns[source]
            const result = root.helperResult(data)
            const what = t ? root.queuedWhat(t).split("\n")[0] : ""
            if (t) {
                const rest = Object.assign({}, root.startingTasks)
                delete rest[t.id]
                root.startingTasks = rest
            }
            if (result.ok && result.message && t) {   // ("": another copy started it)
                root.petEvent("reset", i18n("Started: %1", what), "")
                if (root.notifier && Plasmoid.configuration.notifyDone && !root.holdingBack())
                    root.notify("queued|" + t.id, null, "started", i18n("Started on %1: %2", t.account, what),
                                result.message + (t.host ? " · " + t.host : ""), "media-playback-start", "")
            } else if (!result.ok && t) {
                root.actionError = i18n("Couldn't start the queued task: %1", result.message)
                actionErrorTimer.restart()
                if (root.notifier && !root.dashboardShown)
                    root.notify("queued|" + t.id, null, "error", i18n("Couldn't start the queued task"),
                                what + "\n" + result.message, "dialog-error", "")
            }
            root.refresh()
            if (t && t.host)
                root.pollHost(t.host)
        }
    }

    // The step line of a chat that something stopped
    function stopText(stopped) {
        if (stopped.kind === "login")
            return i18n("Claude's login expired. Log in again (/login), then tell it to go on.")
        if (stopped.over)
            return i18n("The limit it hit has reset: open it and tell Claude to go on.")
        return stopped.text
    }

    // Another account (here, or on the chat's SSH host) with room left in
    // the limit that stopped this chat: {title, shareProfile, pct, label}, or
    // null. Not for a chat open in VS Code's Claude, whose tab would start it
    // again here with your next message.
    function handoverTarget(session, host) {
        const stop = session.stopped
        if (!stop || stop.kind !== "limit" || stop.over || !session.chatId)
            return null
        // (a session continuing another chat: the one with the chat's own id would be ended, not this one)
        if (session.pid !== null && (session.entrypoint === "claude-vscode" || session.state !== "idle"
                                     || session.sessionId !== session.chatId))
            return null
        let best = null
        for (const g of shareAccountsOf(host)) {
            if (g.profileKeys.indexOf(session.profileDir) >= 0)
                continue
            const w = g.limits ? g.limits.windows.find(x => x.key === (stop.window || "five_hour")) : null
            const pct = w ? w.pct : null
            if (pct !== null && pct >= 95)
                continue
            if (!best || (pct !== null && (best.pct === null || pct < best.pct)))
                best = { title: g.title, shareProfile: g.shareProfile, pct: pct, label: w ? w.label : "" }
        }
        return best
    }

    // Continue it there: an idle session that has it open here quits first
    // (jump.py --continue --end-first; on an SSH host, remote.py there)
    function handOver(session, host, target) {
        const endFirst = session.pid !== null ? " --end-first" : ""
        if (host) {
            remoteAction("continue", host, "--continue " + shellQuote(host) + " " + shellQuote(session.chatId) + " "
                         + shellQuote(target.shareProfile) + endFirst)
            return
        }
        const cmd = "python3 -I " + shellQuote(codeDir + "jump.py") + " --continue " + shellQuote(session.chatId)
                    + " --profile " + shellQuote(target.shareProfile) + endFirst + configDirArgs + " # " + Date.now()
        shareKinds = Object.assign({}, shareKinds, { [cmd]: "continue" })
        sharer.connectSource(cmd)
    }

    // A chat's permission mode (claude_status.py: mode_of), "" for the default
    function modeText(mode) {
        switch (mode) {
        case "plan": return i18n("plan mode")
        case "acceptEdits": return i18n("accept edits")
        case "auto": return i18n("auto mode")
        case "bypassPermissions": return i18n("bypass permissions")
        case "dontAsk": return i18n("don't ask")
        case "default": case "": case null: case undefined: return ""
        default: return mode
        }
    }

    function modeHint(mode) {
        switch (mode) {
        case "plan": return i18n("Plan mode: Claude looks around and writes a plan, and changes nothing until you approve it.")
        case "acceptEdits": return i18n("Claude edits files without asking; other actions still ask you.")
        case "auto": return i18n("Auto mode: Claude goes ahead with what it judges safe, and asks you about the rest.")
        case "bypassPermissions": return i18n("Claude runs everything without asking.")
        case "dontAsk": return i18n("What isn't allowed already is refused, without asking you.")
        default: return i18n("Shift+Tab in the chat changes it.")
        }
    }

    // ---------------------------------------------------------------- opening a chat by its id
    // A chat found by the search, or the one that made a plan: its row when
    // it's listed, else reopened (in a terminal or VS Code, as the switch says)

    function hostGroups(host) {
        return host ? (remote[host] && remote[host].result ? remote[host].result.groups : []) : (status ? status.groups : [])
    }

    // The listed row of a chat (here, or on host), or null: on the account
    // given if it's there, else on any (a shared chat runs where it was opened)
    function listedRow(chatId, profileDir, host) {
        let other = null
        for (const g of hostGroups(host))
            for (const s of g.sessions)
                if (s.chatId === chatId || s.sessionId === chatId) {
                    if (!profileDir || g.profileKeys.indexOf(profileDir) >= 0)
                        return s
                    other = other || s
                }
        return other
    }

    function openChatById(chatId, profileDir, cwd, openCommand, groupId, host) {
        const row = listedRow(chatId, profileDir, host)
        if (row) {
            if (host)
                remoteShow(host, row)
            else
                jumpTo(row.sessionId, row.profileDir)
            return
        }
        const groupList = hostGroups(host)
        const group = groupList.find(g => g.id === groupId || g.profileKeys.indexOf(profileDir) >= 0) || null
        if (group && openInVscode(group, host, true)) {
            if (host)
                remoteResumeVscode(host, chatId, cwd)
            else
                resumeInVscode(chatId, profileDir)
        } else if (host)
            remoteOpen(host, openCommand)
        else
            jumpTo(chatId, profileDir)
    }

    // ---------------------------------------------------------------- finding a chat
    // The search at the top of the popup: every chat with all the words in its
    // name, folder or your prompts (claude_status.py --find), here and on the
    // SSH hosts shown (remote.py --find), newest first.

    property bool searchOpen: false
    property string searchQuery: ""
    property var searchResults: ({})   // source ("" here, else the host) -> {busy, results, more, error}
    property var searchAsked: ({})     // command -> [source, query]

    onSearchQueryChanged: searchTimer.restart()

    Timer {
        id: searchTimer
        interval: 350
        onTriggered: root.runSearch()
    }

    function toggleSearch() {
        searchOpen = !searchOpen
        if (!searchOpen) {
            searchQuery = ""
            searchResults = ({})
        }
    }

    function runSearch() {
        const query = searchQuery.trim()
        if (query.length < 2) {
            searchResults = ({})
            return
        }
        const next = {}
        const ask = (source, cmd) => {
            searchAsked[cmd] = [source, query]
            next[source] = Object.assign({ results: [], more: false, error: "" }, searchResults[source] || {}, { busy: true })
            finder.connectSource(cmd)
        }
        ask("", "python3 -I " + shellQuote(codeDir + "poll.py") + " --find " + shellQuote(query) + configDirArgs + " # " + Date.now())
        for (const host of shownHosts)
            ask(host, "python3 -I " + shellQuote(codeDir + "remote.py") + " --find " + shellQuote(host) + " " + shellQuote(query)
                      + " # " + Date.now())
        searchResults = next
    }

    P5Support.DataSource {
        id: finder
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const asked = root.searchAsked[source]
            delete root.searchAsked[source]
            if (!asked || asked[1] !== root.searchQuery.trim())
                return   // an answer to what you looked for before
            const result = root.helperResult(data)
            root.searchResults = Object.assign({}, root.searchResults, { [asked[0]]: {
                busy: false, results: result.ok ? result.results || [] : [], more: !!result.more,
                error: result.ok ? "" : (result.message || result.error || i18n("no answer")) } })
        }
    }

    function openFound(result, host) {
        openChatById(result.sessionId, result.profileDir, result.cwd, result.openCommand || "", result.groupId, host)
    }

    // ---------------------------------------------------------------- plans
    // Each account's plans (<config>/plans/*.md, what chats in plan mode
    // write): open one in your Markdown app, carry it out in a new chat,
    // continue the chat that made it, or share it with your other accounts.

    property var expandedPlans: ({})   // accounts showing their plans
    property string planComposer: ""   // the plan whose "carry it out" box is open: [host|]plan key

    function togglePlans(groupKey, wasOpen) {
        expandedPlans = Object.assign({}, expandedPlans, { [groupKey]: !wasOpen })
    }

    function togglePlanComposer(key) {
        planComposer = planComposer === key ? "" : key
        newChatGroup = ""
    }

    // A plan's Markdown file itself, to change it (jump.py --edit-plan; an
    // SSH host's in VS Code over Remote-SSH: --remote-edit)
    function editPlan(plan, host) {
        planOpener.connectSource("python3 -I " + shellQuote(codeDir + "jump.py")
                                 + (host ? " --remote-edit " + shellQuote(host) + " " + shellQuote(plan.path)
                                         : " --edit-plan " + shellQuote(plan.slug) + profileArg(plan.profileDir))
                                 + configDirArgs + " # " + Date.now())
    }

    function openPlan(slug, profileDir, host) {
        if (host)
            remoteAction("plan", host, "--plan " + shellQuote(host) + " " + shellQuote(slug)
                                       + (profileDir ? " " + shellQuote(profileDir) : ""))
        else
            planOpener.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --open-plan " + shellQuote(slug)
                                     + profileArg(profileDir) + configDirArgs + " # " + Date.now())
    }

    P5Support.DataSource {
        id: planOpener
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const result = root.helperResult(data)
            if (result.ok) {
                root.actionError = ""
                root.expanded = false
            } else {
                root.actionError = i18n("Couldn't open the plan: %1", result.message)
                actionErrorTimer.restart()
            }
        }
    }

    function continuePlanChat(plan, group, host) {
        openChatById(plan.chatId, plan.chatProfileDir, plan.cwd, plan.openCommand || "", group.id, host)
    }

    PlasmaExtras.Menu {
        id: planMenu
    }

    Component {
        id: planItem
        PlasmaExtras.MenuItem {
            property string kind      // share | keeponly
            property string slug
            property string from      // the profile whose copy it is
            property string to        // share: only with this one ("": all); keeponly: the one it stays on
            property string host
            onClicked: root.planShare(kind, slug, from, to, host)
        }
    }

    property var planItems: []

    function openPlanMenu(button, plan, host) {
        planMenu.clearMenuItems()
        const accounts = shareAccountsOf(host)
        const here = accounts.find(g => g.profileKeys.indexOf(plan.profileDir) >= 0) || null
        const items = [planItem.createObject(planMenu, { section: true, text: plan.title })]
        for (const g of accounts)
            if (g !== here)
                items.push(planItem.createObject(planMenu, { text: i18n("Share with %1", g.title), icon: "document-share",
                                                            kind: "share", slug: plan.slug, from: plan.profileDir,
                                                            to: g.shareProfile, host: host }))
        if (accounts.length > 2)
            items.push(planItem.createObject(planMenu, { text: i18n("Share with all accounts"), icon: "document-share",
                                                        kind: "share", slug: plan.slug, from: plan.profileDir, to: "", host: host }))
        if (plan.shared) {
            items.push(planItem.createObject(planMenu, { separator: true }))
            for (const g of accounts)
                items.push(planItem.createObject(planMenu, { text: i18n("Keep only on %1", g.title), icon: "list-remove",
                                                            kind: "keeponly", slug: plan.slug, from: plan.profileDir,
                                                            to: g.shareProfile, host: host }))
        }
        for (const item of items)
            planMenu.addMenuItem(item)
        planItems = items
        planMenu.visualParent = button
        planMenu.openRelative()
    }

    function planShare(kind, slug, from, to, host) {
        if (host) {
            // remote.py --share-plan HOST SLUG PROFILE [TO] | --unshare-plan HOST SLUG PROFILE
            remoteAction("share", host, (kind === "share" ? "--share-plan " : "--unshare-plan ") + shellQuote(host) + " "
                         + shellQuote(slug) + " " + shellQuote(kind === "share" ? from : to)
                         + (kind === "share" && to ? " " + shellQuote(to) : ""))
            return
        }
        const cmd = "python3 -I " + shellQuote(codeDir + "jump.py")
                    + (kind === "share" ? " --share-plan " + shellQuote(slug) + profileArg(from) + (to ? " --to " + shellQuote(to) : "")
                                        : " --unshare-plan " + shellQuote(slug) + profileArg(to))
                    + configDirArgs + " # " + Date.now()
        shareKinds = Object.assign({}, shareKinds, { [cmd]: "share" })
        sharer.connectSource(cmd)
    }

    // ---------------------------------------------------------------- new chats with a task
    // The + box (and a plan's "carry it out" box, NewChatBox.qml) takes what
    // Claude should do: the chat starts with it in a terminal (sent at once),
    // in VS Code (typed in for you to send) or in the background (claude
    // --bg: no window, listed right away). One box is open at a time, so its
    // text lives here, kept until a chat starts.

    property string taskText: ""
    property bool taskBackground: false
    // or later: on a day (0 today, 1 tomorrow, …) at a time ("14:30")
    property bool taskLater: false
    property int taskLaterDay: 0
    property string taskLaterTime: ""

    // The days a task can start on: today and the next six
    function laterDays() {
        const out = []
        for (let i = 0; i < 7; i++) {
            const d = new Date()
            d.setDate(d.getDate() + i)
            out.push(i === 0 ? i18n("Today") : i === 1 ? i18n("Tomorrow") : Qt.locale().toString(d, "ddd d MMM"))
        }
        return out
    }

    // When a task picked for later starts (ms): on day at clock ("9", "930",
    // "9:30", "14:30"); 0 for no time, or one that has passed
    function laterAt(day, clock) {
        const m = /^(\d{1,2})(?::?(\d{2}))?$/.exec((clock || "").trim())
        if (!m || +m[1] > 23 || +(m[2] || 0) > 59)
            return 0
        const d = new Date()
        d.setDate(d.getDate() + day)
        d.setHours(+m[1], +(m[2] || 0), 0, 0)
        return d.getTime() > Date.now() ? d.getTime() : 0
    }

    // Ticking "Later, at": the next full hour, to change
    function pickLater(on) {
        taskLater = on
        if (!on)
            return
        taskQueued = false
        if (laterAt(taskLaterDay, taskLaterTime))
            return
        const d = new Date()
        d.setHours(d.getHours() + 1, 0, 0, 0)
        taskLaterDay = d.getDate() === new Date().getDate() ? 0 : 1
        taskLaterTime = Qt.locale("C").toString(d, "HH:mm")
    }

    // When a queued task starts, in words: "14:30" today, "tomorrow 09:00", "Fri 24 Oct 09:00"
    function startText(ms) {
        const d = new Date(ms), today = new Date()
        const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate())
                                 - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000)
        return days <= 0 ? clockText(ms)
             : days === 1 ? i18nc("a time tomorrow", "tomorrow %1", clockText(ms))
             : Qt.locale().toString(d, "ddd d MMM") + " " + clockText(ms)
    }

    function startChat(group, host, folder, inVscode, plan) {
        const text = taskText.trim()
        const hasTask = text !== "" || !!plan
        const background = taskBackground && hasTask
        const reset = background && taskQueued ? limitReset(group, host) : null
        const later = background && taskLater ? laterAt(taskLaterDay, taskLaterTime) : 0
        if (background && taskLater && !later) {
            actionError = i18n("Pick a time that's still to come, e.g. 14:30.")
            actionErrorTimer.restart()
            return
        }
        newChatGroup = ""
        planComposer = ""
        taskText = ""
        taskBackground = false
        taskQueued = false
        taskLater = false
        if (reset || later) {
            // to start a minute after the limit resets, or at the time picked
            if (!folder.path && !host)
                root.expanded = false   // the folder dialog takes over
            queuer.connectSource("python3 -I " + shellQuote(codeDir + "jump.py") + " --queue " + shellQuote(group.chatProfile)
                                      + (folder.path || host ? " --cwd " + shellQuote(folder.path || "~") : " --choose-folder")
                                      + " --at " + (later || Math.round(reset.at + 60000)) + (later ? " --scheduled" : "")
                                      + (text ? " --prompt " + shellQuote(text) : "")
                                      + (plan ? " --plan " + shellQuote(plan.slug) + " --plan-profile " + shellQuote(plan.profileDir) : "")
                                      + (host ? " --host " + shellQuote(host) : "") + " --account " + shellQuote(group.title)
                                      + configDirArgs + " # " + Date.now())
            return
        }
        if (host) {
            if (background || (hasTask && !inVscode)) {
                // remote.py --task HOST PROFILE FOLDER [--prompt TEXT] [--plan SLUG PROFILE] [--bg]
                remoteAction(background ? "task" : "open", host, "--task " + shellQuote(host) + " " + shellQuote(group.chatProfile)
                             + " " + shellQuote(folder.path || "~") + (text ? " --prompt " + shellQuote(text) : "")
                             + (plan ? " --plan " + shellQuote(plan.slug) + " " + shellQuote(plan.profileDir) : "")
                             + (background ? " --bg" : ""))
            } else if (inVscode) {
                remoteNewChatVscode(host, folder.path, group, text, plan)
            } else {
                remoteNewChat(host, folder.newChatCommand)
            }
            return
        }
        const cmd = "python3 -I " + shellQuote(codeDir + "jump.py") + " --new-chat " + shellQuote(group.chatProfile)
                    + (folder.path ? " --cwd " + shellQuote(folder.path) : " --choose-folder")
                    + (background ? " --bg" : inVscode ? " --vscode" : "")
                    + (text ? " --prompt " + shellQuote(text) : "")
                    + (plan ? " --plan " + shellQuote(plan.slug) + " --plan-profile " + shellQuote(plan.profileDir) : "")
                    + configDirArgs + " # " + Date.now()
        if (!folder.path)
            root.expanded = false   // the folder dialog takes over
        if (background)
            taskStarter.connectSource(cmd)
        else
            launcher.connectSource(cmd)
    }

    // A task started in the background: the popup stays, and its row comes up
    P5Support.DataSource {
        id: taskStarter
        engine: "executable"
        connectedSources: []
        onNewData: (source, data) => {
            disconnectSource(source)
            const result = root.helperResult(data)
            if (result.ok) {
                root.actionError = ""
                if (result.message) {
                    root.actionInfo = result.message
                    actionInfoTimer.restart()
                }
            } else {
                root.actionError = i18n("Couldn't start it: %1", result.message)
                actionErrorTimer.restart()
            }
            root.refresh()
        }
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

    function escapeHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
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
        case "limit": return Kirigami.Theme.negativeTextColor
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

    // The usage bar's tooltip: the pace, and where it leads (usage_forecast)
    function forecastText(f, pct, resetsAt) {
        if (!f)
            return ""
        const when = ms => {
            const d = new Date(ms)
            const time = d.toLocaleTimeString(Qt.locale(), Locale.ShortFormat)
            return ms - now > 20 * 3600000 ? d.toLocaleDateString(Qt.locale(), "ddd") + " " + time : time
        }
        const lines = [f.basis === "hour" ? i18n("Your pace over the last hour: %1% an hour.", f.rate.toFixed(1))
                                          : i18n("Your pace in this window so far: %1% an hour.", f.rate.toFixed(1))]
        if (f.fullAt)
            lines.push(i18n("At this pace it runs out at %1, %2 before it resets.", when(f.fullAt), duration(resetsAt - f.fullAt)))
        else if (pct < 100)
            lines.push(i18n("At this pace: about %1% when it resets (the faded part of the bar).", Math.round(f.atReset)))
        lines.push(i18n("An even pace through the window would be at %1% by now (the mark).", Math.round(f.evenPct)))
        return lines.join("\n")
    }

    function stateText(s) {
        const since = s.since ? " · " + duration(now - s.since) : ""
        const reason = s.reason ? " · " + s.reason : ""
        if (s.stopped && (s.state === "idle" || s.state === "done")) {
            if (s.stopped.kind === "login")
                return i18n("Login expired")
            if (s.stopped.over)
                return i18n("Limit reset · go on")
            return s.stopped.resetsAt ? i18n("Limit · resets in %1", s.stopped.resetsAt - now < 60000
                                             ? i18nc("less than a minute", "<1m") : duration(s.stopped.resetsAt - now))
                                      : i18n("Hit a usage limit")
        }
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
            parts.push(i18np("%1 working", "%1 working", counts.working))   // plural forms differ in other languages
        if (counts.idle)
            parts.push(i18np("%1 idle", "%1 idle", counts.idle))
        if (counts.limit)
            parts.push(i18np("%1 at the usage limit", "%1 at the usage limit", counts.limit))
        if (counts.done)
            parts.push(i18np("%1 done", "%1 done", counts.done))
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
