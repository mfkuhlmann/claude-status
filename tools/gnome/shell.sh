#!/usr/bin/env bash
# Try the GNOME extension in a real, headless GNOME Shell (Ubuntu 26.04, in
# podman) with made-up Claude data (demo_home.py), and save screenshots.
#
#   tools/gnome/shell.sh OUT_DIR [STEPS_FILE]
#
# Builds the extension from this repo, starts GNOME Shell with it, and runs
# the steps (default: tools/gnome/steps.sh): bash using
#   ev 'JS'        run JS in the shell (org.gnome.Shell.Eval; `ext` is the indicator)
#   shot NAME      screenshot of the whole screen -> OUT_DIR/NAME.png
#   popup NAME     screenshot of just the popup  -> OUT_DIR/NAME.png
# GNOME Shell's log goes to OUT_DIR/shell.log. Nothing of your desktop or
# your Claude data is used.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out="$(realpath -m "$1")"
steps="$(realpath "${2:-$repo/tools/gnome/steps.sh}")"
mkdir -p "$out"
podman image exists claude-status-gnome ||
  podman build -t claude-status-gnome -f "$repo/tools/gnome/Containerfile" "$repo/tools/gnome"
"$repo/gnome/build.sh" "$out/build" >/dev/null
podman run --rm --security-opt label=disable --userns=keep-id:uid=1001,gid=1001 \
  -v "$repo:/src:ro" -v "$out:/out" -v "$steps:/steps.sh:ro" \
  claude-status-gnome bash /src/tools/gnome/inside.sh
