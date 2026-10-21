"""Every pose the pet code asks for exists, and every bundled pose is used."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "package/contents"
PETS = ROOT / "pets"
# strings in the QML that aren't pose names
NOT_POSES = {"px", "lift", "squash", "breath", "z", "file", "chat", "bg", "interactive", "done", "failed",
             "stopped", "reset", "waiting", "working", "idle", "limit", "none", "permission", "question",
             "network access", "goal approval", "claude-vscode", "five_hour", "plasma_workspace", "oops",
             "jump-error", "dialog-warning", "dialog-ok", "dialog-error", "dialog-information", "view-refresh",
             "view-visible", "internet-web-browser", "dialog-messages", "list-add", "list-remove", "user-home",
             "folder", "media-playback-stop", "executable", "x-kde-display-appname", "oncall",
             "x", "y", "opacity", "notify-", "transparent", "lift", "petkey",
             "black", "white", "label", "leaving", "hero", "source", "playing"}


# strings in the GNOME pets.js that aren't pose names (timers, events, settings)
GNOME_NOT_POSES = {"action", "black", "white", "brain", "bubble", "chat-pets", "show-pet", "hero", "leave", "destroy",
                   "poses", "reaction", "scale-y", "tickle", "worries", "x", "z", "ok", "oops",
                   "done", "failed", "stopped", "reset", "waiting", "working", "idle"}


def quoted(text):
    return set(re.findall(r'"([a-z0-9][a-z0-9-]*)"', text))


class PoseTests(unittest.TestCase):
    def test_every_pose_used_exists_and_every_file_is_used(self):
        strip = (ROOT / "ui/Pet.qml").read_text() + (ROOT / "ui/PetStrip.qml").read_text()
        main = (ROOT / "ui/main.qml").read_text()
        mood_block = main[main.index("readonly property string petMood"):]
        mood_block = mood_block[:mood_block.index("\n    }\n")]
        used = (quoted(strip) | quoted(mood_block)) - NOT_POSES
        files = {p.name[len("clawd-"):-len(".svg")] for p in PETS.glob("clawd-*.svg")}
        self.assertEqual(sorted(used - files), [], "poses the code uses but that have no file")
        self.assertEqual(sorted(files - used), [], "bundled poses nothing uses")

    def test_every_pose_the_gnome_pets_use_exists(self):
        # The GNOME extension's pets ask for the same files (single-quoted there)
        gnome = ROOT.parent.parent / "gnome/extension"
        pets = (gnome / "ui/pets.js").read_text()
        logic = (gnome / "logic.js").read_text()
        mood = logic[logic.index("export function petMood"):]
        mood = mood[:mood.index("\n}\n")]
        words = set(re.findall(r"'([a-z0-9][a-z0-9-]*)'", pets + mood))
        used = {w for w in words if not w.startswith("claude-") and not w.endswith("-event")} - GNOME_NOT_POSES
        files = {p.name[len("clawd-"):-len(".svg")] for p in PETS.glob("clawd-*.svg")}
        self.assertEqual(sorted(used - files), [], "poses the GNOME pets use but that have no file")
        notifier = (gnome / "notifier.js").read_text()
        for name in re.findall(r"'(notify-[a-z]+\.svg|clawd-[a-z-]+\.svg)'", notifier):
            self.assertTrue((PETS / name).is_file(), name)

    def test_notification_icons_exist(self):
        main = (ROOT / "ui/main.qml").read_text()
        block = main[main.index("const pose = kind"):]
        block = block[:block.index("\n\n")]
        for pose in set(re.findall(r'"([a-z0-9-]+)"', block)) - {"done", "failed", "waiting", "notify-"}:
            self.assertTrue((PETS / f"notify-{pose}.svg").is_file(), pose)

    def test_shared_viewbox_and_no_external_content(self):
        for p in PETS.glob("*.svg"):
            text = p.read_text()
            if p.name.startswith("clawd-"):
                self.assertIn('viewBox="-15 -25 45 45"', text, p.name)
            self.assertNotRegex(text, r"(?i)<script|<image|<foreignObject|href=\"(?!#)|url\((?!#)|@import", p.name)

    def test_pivots_baked(self):
        # Qt draws CSS transform-origin wrongly: tools/bake_pet_origins.py must have run
        for p in PETS.glob("*.svg"):
            self.assertNotRegex(p.read_text(), r"transform-origin\s*:\s*-?[\d.]+px", p.name)


class ThemeTests(unittest.TestCase):
    def test_state_colors_use_the_accent(self):
        # In a Plasma 6 popup, Kirigami.Theme.highlightColor is a pale selection
        # tint (light blue on light themes, navy on dark ones): working dots,
        # usage bars and the hero's light would hardly show. focusColor is the accent.
        for p in (ROOT / "ui").glob("*.qml"):
            self.assertIsNone(re.search(r"Theme\.highlightColor", p.read_text()), p.name)


class PetEventTests(unittest.TestCase):
    def test_every_pet_event_passes_kind_text_and_key(self):
        # petEvent(kind, text, key) called with two arguments throws "Insufficient
        # arguments": at a limit reset that stopped every later poll from being
        # shown (the popup froze until Plasma restarted).
        for p in (ROOT / "ui").glob("*.qml"):
            text = p.read_text()
            for m in re.finditer(r"\bpetEvent\(", text):
                if text[:m.start()].rstrip().endswith("signal"):
                    continue
                depth, args, i = 1, 1, m.end()
                while depth:
                    c = text[i]
                    if c in "([{":
                        depth += 1
                    elif c in ")]}":
                        depth -= 1
                    elif c == "," and depth == 1:
                        args += 1
                    elif c == '"':   # skip string literals (they may hold commas)
                        i = text.index('"', i + 1)
                    i += 1
                line = text.count("\n", 0, m.start()) + 1
                self.assertEqual(args, 3, f"{p.name}:{line}: petEvent needs (kind, text, key)")


if __name__ == "__main__":
    unittest.main()


class PlainTextTests(unittest.TestCase):
    """Chat names, agent activity and other text from transcripts are shown
    as plain text: as rich text, "Fix <div> centering" lost its tag and an
    <img src=…> in an agent's activity made plasmashell fetch the URL."""

    def test_every_label_and_tooltip_is_plain_text(self):
        missing = []
        for path in sorted((ROOT / "ui").glob("*.qml")):
            if path.name == "configGeneral.qml":  # fixed texts only
                continue
            lines = path.read_text().split("\n")
            for i, line in enumerate(lines):
                m = re.match(r"(\s*)(PlasmaComponents3\.Label|Text|Kirigami\.Heading|PlasmaCore\.ToolTipArea)\s*\{\s*$", line)
                if not m:
                    continue
                own, depth = [], 0
                for j in range(i, len(lines)):
                    depth += lines[j].count("{") - lines[j].count("}")
                    if j > i and re.match(m.group(1) + r"    \S", lines[j]):
                        own.append(lines[j])
                    if depth <= 0 and j > i:
                        break
                if any(re.match(r"\s*(text|mainText|subText):", l) for l in own) and not any("textFormat" in l for l in own):
                    missing.append(f"{path.name}:{i + 1}")
        self.assertEqual(missing, [])

    def test_inline_messages_escape_what_they_quote(self):
        for name in ("SessionRow.qml", "KeepOnlyMessage.qml"):
            text = (ROOT / "ui" / name).read_text()
            block = text[text.index("Kirigami.InlineMessage {"):]
            block = block[:block.index("actions:")]
            self.assertIn('"<span>"', block, name)
            self.assertNotRegex(block, r"[^(]row\.session\.name\)|shareConfirm\.name,", name)


class SeveralCopiesTests(unittest.TestCase):
    """Five copies (panel and one dashboard per screen) each ran the status
    check every 2 s and kept their pets moving under maximized windows:
    plasmashell took most of a core (2026-10-20)."""

    def test_the_status_check_runs_once_for_all_copies(self):
        # main.qml asks hub/Hub.qml (a singleton, shared by the copies in
        # plasmashell); only the hub runs claude_status.py and names the copy
        main = (ROOT / "ui/main.qml").read_text()
        hub = (ROOT / "ui/hub/Hub.qml").read_text()
        self.assertNotIn("\" --instance", main)
        self.assertNotRegex(main, r"connectSource\(\s*command\b")
        self.assertIn("pragma Singleton", hub)
        self.assertIn("singleton Hub 1.0 Hub.qml", (ROOT / "ui/hub/qmldir").read_text())
        self.assertIn('--instance " + shellQuote(instanceName)', hub)

    def test_the_pets_wake_at_once_when_you_look(self):
        # Showing the desktop hides the windows without minimizing them, and a
        # 5 s re-check woke one copy after the other: you saw some dashboards
        # still while looking at all of them (2026-10-20). It's a binding now,
        # and with the mouse on a dashboard it can't be covered either.
        watch = (ROOT / "ui/CoverWatch.qml").read_text()
        main = (ROOT / "ui/main.qml").read_text()
        self.assertIn("readonly property bool covered: windowCovers && !KWindowSystem.showingDesktop", watch)
        self.assertRegex(main, r"coveredByWindow: .*covered && !mouseOnWidget\.hovered")

    def test_a_dashboard_on_the_desktop_keeps_its_pets_after_a_click(self):
        # Opening a chat "closes the popup" (expanded = false), but a dashboard
        # on the desktop stays on screen: its pets froze (seen on one screen,
        # 2026-10-20). What moves goes by dashboardShown, not by expanded.
        strip = (ROOT / "ui/PetStrip.qml").read_text()
        full = (ROOT / "ui/FullRepresentation.qml").read_text()
        self.assertIn("readonly property bool live: visible && root.dashboardShown", strip)
        self.assertNotIn("root.expanded", strip + (ROOT / "ui/Pet.qml").read_text())
        self.assertIn("root.dashboardShown && !root.coveredByWindow", full)

    def test_each_ssh_host_is_checked_once_for_all_copies(self):
        # (Plasma merged identical checks that started at the same moment,
        # which held only while the copies' timers kept in step)
        main = (ROOT / "ui/main.qml").read_text()
        self.assertIn('Hub.want(instanceId, "ssh:" + host, next[host], interval, false)', main)
        self.assertNotIn("remotePoller", main)
        self.assertNotRegex(main, r'connectSource\([^)]*--status')

    def test_looping_animations_stop_under_a_window(self):
        # Every repeating timer and endless animation of the pets runs only
        # while it can be seen (playing), not just while the popup is open
        # (live): on the desktop the dashboard is always "open".
        for name in ("Pet.qml", "PetStrip.qml"):
            lines = (ROOT / "ui" / name).read_text().split("\n")
            for i, line in enumerate(lines):
                if not re.search(r"^\s*(loops: Animation\.Infinite|repeat: true)\s*$", line):
                    continue
                indent = len(line) - len(line.lstrip())
                start = i
                while start > 0 and not lines[start].rstrip().endswith("{"):
                    start -= 1
                end = i
                while end < len(lines) and not (lines[end].strip() == "}" and len(lines[end]) - len(lines[end].lstrip()) < indent):
                    end += 1
                running = [l for l in lines[start:end] if l.strip().startswith("running:")
                           and len(l) - len(l.lstrip()) == indent]
                self.assertTrue(running and "playing" in running[0] and ".live" not in running[0],
                                f"{name}:{i + 1}: a loop that should stop while covered")


class NewChatTests(unittest.TestCase):
    def test_only_a_new_chat_switches_vscode_on_a_host(self):
        # A new chat on an SSH host's other account opens in VS Code, which
        # switches there first (--account); a recent chat reopens on its own
        # account, so its switch never offers that
        switch = (ROOT / "ui/OpenInSwitch.qml").read_text()
        main = (ROOT / "ui/main.qml").read_text()
        self.assertIn("root.openInVscode(group, remoteHost, resuming)", switch)
        self.assertIn("readonly property bool switching: !resuming && root.vscodeSwitches(group, remoteHost)", switch)
        self.assertIn('const account = group && !group.vscodeHere ? " --account " + shellQuote(group.configDir || "-") : ""', main)
        self.assertIn("(group.vscodeHere || (!resuming && vscodeSwitches(group, host)))", main)

    def test_a_folder_row_never_closes_its_own_list(self):
        # Closing the list (newChatGroup = "") destroys its rows: the rest of
        # the row's click handler lost root ("ReferenceError: root is not
        # defined") and no terminal opened on the host (2026-10-20). Root's
        # functions close it, after the row handed them what they need.
        section = (ROOT / "ui/GroupSection.qml").read_text()
        box = (ROOT / "ui/NewChatBox.qml").read_text()
        main = (ROOT / "ui/main.qml").read_text()
        self.assertNotIn("newChatGroup = ", section)
        rows = box[box.index("delegate: PlasmaComponents3.ItemDelegate"):box.index("Kirigami.Separator")]
        self.assertNotIn("newChatGroup", rows)
        self.assertNotIn("planComposer", rows)
        self.assertIn("onClicked: root.startChat(box.group, box.remoteHost, folderRow.folder, box.inVscode, box.plan)", rows)
        start = main[main.index("function startChat("):]
        self.assertIn("remoteNewChat(host, folder.newChatCommand)", start[:start.index("\n    }\n")])
        self.assertIn('function remoteNewChat(host, command) {\n        newChatGroup = ""\n        remoteOpen(host, command)', main)


class SshUsageTests(unittest.TestCase):
    def test_every_host_view_shows_an_accounts_usage_once(self):
        # An account on this computer and on a host has one plan usage: the
        # host lists, the badge's and the tooltip's (allGroups) all go
        # through withUsage, and the setting is shared between copies
        main = (ROOT / "ui/main.qml").read_text()
        host = (ROOT / "ui/HostSection.qml").read_text()
        section = (ROOT / "ui/GroupSection.qml").read_text()
        self.assertIn('<entry name="sshUsage" type="String">', (ROOT / "config/main.xml").read_text())
        self.assertIn('"sshUsage"', main[main.index("readonly property var sharedKeys"):])
        self.assertIn('status.groups.map(g => withUsage(g, ""))', main)
        self.assertIn("out.push(Object.assign({}, withUsage(g, host), { host: host }))", main)
        self.assertIn("info.result.groups.map(g => root.withUsage(g, host))", host)
        self.assertIn("visible: !section.group.limitsHidden", section)
