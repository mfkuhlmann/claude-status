#!/usr/bin/env bash
# Runs inside the container's D-Bus session: starts GNOME Shell, then the steps.
set -uo pipefail
uuid=claude-status@wzaielamri.github.io
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['$uuid', 'devtools@local']"
export XDG_CURRENT_DESKTOP=ubuntu:GNOME XDG_SESSION_TYPE=wayland
gnome-shell --headless --virtual-monitor 1280x1000 --mode=ubuntu > /out/shell.log 2>&1 &
shell=$!
for _ in $(seq 60); do
  gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval 1 >/dev/null 2>&1 && break
  sleep 1
done
ev() {
  gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval \
    "const ext = Main.panel.statusArea['$uuid']; $1"
}
shot() {
  gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.Screenshot false false "/out/$1.png" >/dev/null
}
popup() {
  local box
  box=$(ev 'const a = ext.menu.actor; const [x, y] = a.get_transformed_position(); const [w, h] = a.get_transformed_size(); [x, y, w, h].map(Math.round).join(" ")' |
        sed -E "s/^\(true, '\"?([0-9 ]+)\"?'\)$/\1/")
  # shellcheck disable=SC2086
  set -- "$1" $box
  gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.ScreenshotArea "$2" "$3" "$4" "$5" false "/out/$1.png" >/dev/null
}
export WAYLAND_DISPLAY=wayland-0 DISPLAY=:0   # for apps the steps start
sleep 4   # the first status check
# shellcheck disable=SC1091
source /steps.sh
kill "$shell" 2>/dev/null
wait "$shell" 2>/dev/null
grep -E "claude-status|JS ERROR|TypeError|ReferenceError|SyntaxError|Error:" /out/shell.log | grep -v "devtools@local" || echo "(no errors in shell.log)"
