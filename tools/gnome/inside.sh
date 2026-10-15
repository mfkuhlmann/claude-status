#!/usr/bin/env bash
# Runs inside the container of tools/gnome/shell.sh.
set -euo pipefail
export XDG_RUNTIME_DIR=/tmp/run
mkdir -p -m 700 "$XDG_RUNTIME_DIR"
python3 /src/tools/gnome/demo_home.py "$HOME" >/dev/null
mkdir -p "$HOME/Desktop"
ext="$HOME/.local/share/gnome-shell/extensions"
mkdir -p "$ext"
cp -r /out/build/claude-status@wzaielamri.github.io "/src/tools/gnome/devtools@local" "$ext/"
# GNOME Shell wants a system bus too: an empty one of our own will do
dbus-daemon --session --fork --address="unix:path=$XDG_RUNTIME_DIR/system_bus" --print-pid > /dev/null
export DBUS_SYSTEM_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/system_bus"
exec dbus-run-session -- bash /src/tools/gnome/session.sh
