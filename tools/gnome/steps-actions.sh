# Steps for tools/gnome/shell.sh that click things: jumping to a terminal
# session (the extension raises its window), notifications, the settings.
#   tools/gnome/shell.sh OUT tools/gnome/steps-actions.sh
profile=$HOME/.claude-work
# A "session" whose process belongs to a window: a sleep whose parent becomes
# a plain GTK window (terminals need a systemd user session, which the
# container hasn't got; the raising is the same)
bash -c 'sleep infinity & echo $! > /tmp/term.pid; exec gjs /src/tools/gnome/window.js "chat terminal"' >/dev/null 2>&1 &
for _ in $(seq 30); do [ -s /tmp/term.pid ] && break; sleep 0.5; done
pid=$(cat /tmp/term.pid)
start=$(awk '{print $22}' /proc/$pid/stat)
cat > "$profile/sessions/$pid.json" <<JSON
{"pid": $pid, "procStart": "$start", "sessionId": "9a1c7e2b-0000-4000-8000-0000000000aa", "cwd": "$HOME/repos/api",
 "name": "terminal chat", "kind": "interactive", "status": "idle", "statusUpdatedAt": $(date +%s000)}
JSON
sleep 3
# another window on top of it
gjs /src/tools/gnome/window.js "other window" >/dev/null 2>&1 &
sleep 4
echo "focused before: $(ev 'global.display.focus_window?.get_title()')"
shot before-jump
ev 'ext.jumpTo("9a1c7e2b-0000-4000-8000-0000000000aa", "")'
sleep 4
echo "focused after jump: $(ev 'global.display.focus_window?.get_title()')"
shot after-jump
echo "jump.py says: $(XDG_CURRENT_DESKTOP=ubuntu:GNOME python3 -I /src/package/contents/code/jump.py 9a1c7e2b-0000-4000-8000-0000000000aa)"

# Notifications: "release notes" was answered, "fix parser" finished a long
# turn, "api tests" now asks something
now=$(date +%s000)
for f in "$profile"/sessions/*.json; do
  python3 - "$f" "$now" <<'PY'
import json, sys
path, now = sys.argv[1], int(sys.argv[2])
s = json.load(open(path))
change = {"release notes": {"status": "idle"}, "fix parser": {"status": "idle"},
          "api tests": {"status": "waiting", "waitingFor": "question"}}.get(s.get("name"))
if change:
    s.update(change, statusUpdatedAt=now)
    json.dump(s, open(path, "w"))
PY
done
sleep 4
shot notifications
ev 'Main.panel.statusArea.dateMenu.menu.open()'
sleep 2
shot message-list
ev 'Main.panel.statusArea.dateMenu.menu.close()'

# The settings window
gnome-extensions prefs claude-status@wzaielamri.github.io >/dev/null 2>&1 &
sleep 6
shot prefs

# Turning the extension off and on again leaves nothing behind
ev 'Main.panel.statusArea.dateMenu.menu.close()'
for i in 1 2 3 4 5; do
  gnome-extensions disable claude-status@wzaielamri.github.io; sleep 1
  gnome-extensions enable claude-status@wzaielamri.github.io; sleep 2
done
gnome-extensions disable claude-status@wzaielamri.github.io; sleep 3
echo "after disable: panel button $(ev "'claude-status@wzaielamri.github.io' in Main.panel.statusArea"), helpers running: $(pgrep -fc 'code/(claude_status|remote|jump).py' || true)"
echo "raiser after disable: $(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Extensions/ClaudeStatus --method org.gnome.Shell.Extensions.ClaudeStatus.RaiseWindow '"{}"' 2>&1 | head -c 120)"
gnome-extensions enable claude-status@wzaielamri.github.io; sleep 3
echo "enabled again: $(ev "'claude-status@wzaielamri.github.io' in Main.panel.statusArea")"
