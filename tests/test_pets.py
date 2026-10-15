"""Every pose the pet code asks for exists, and every bundled pose is used."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "package/contents"
PETS = ROOT / "pets"
# strings in the QML that aren't pose names
NOT_POSES = {"px", "lift", "squash", "breath", "z", "file", "chat", "bg", "interactive", "done", "failed",
             "stopped", "reset", "waiting", "working", "idle", "none", "permission", "question",
             "network access", "goal approval", "claude-vscode", "five_hour", "plasma_workspace", "oops",
             "jump-error", "dialog-warning", "dialog-ok", "dialog-error", "dialog-information", "view-refresh",
             "view-visible", "internet-web-browser", "dialog-messages", "list-add", "list-remove", "user-home",
             "folder", "media-playback-stop", "executable", "x-kde-display-appname", "oncall",
             "x", "y", "opacity", "notify-", "transparent", "lift", "petkey",
             "black", "white", "label", "leaving", "hero"}


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


if __name__ == "__main__":
    unittest.main()
