#!/usr/bin/env bash
# Install or upgrade Claude Status (the Plasma widget, or the GNOME Shell
# extension) and hook the Claude status line.
#   ./install.sh              install/upgrade; add the status-line snippet (asks first)
#   ./install.sh --yes        same, without asking
#   ./install.sh --uninstall  remove it and the snippet
#   --plasma / --gnome        which one (default: the desktop you're on)
# The snippet goes into every script a Claude profile's settings.json runs as
# its status line (~/.claude, ~/.claude-*; a script shared by several profiles
# is patched once). CLAUDE_WIDGET_STATUSLINE=/path/script.sh overrides that.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
id="org.wzaielamri.claudestatus"
uuid="claude-status@wzaielamri.github.io"
marker_start="# >>> claude-widget >>>"
yes=0
uninstall=0
target=""
for arg in "$@"; do
  case "$arg" in
    -y|--yes) yes=1 ;;
    --uninstall) uninstall=1 ;;
    --plasma) target=plasma ;;
    --gnome) target=gnome ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# Plasma unless only GNOME is here, or both are and this is a GNOME session
if [ -z "$target" ]; then
  if command -v kpackagetool6 >/dev/null; then
    target=plasma
    if command -v gnome-extensions >/dev/null; then
      case ":${XDG_CURRENT_DESKTOP:-}:" in *:GNOME:*) target=gnome ;; esac
    fi
  elif command -v gnome-extensions >/dev/null; then
    target=gnome
  else
    target=plasma
  fi
fi

if [ "$target" = plasma ] && ! command -v kpackagetool6 >/dev/null; then
  echo "kpackagetool6 not found: Claude Status needs KDE Plasma 6 (Plasma 5 isn't supported)," >&2
  echo "or GNOME Shell 49 or newer (./install.sh --gnome)." >&2
  exit 1
fi
if [ "$target" = gnome ] && ! command -v gnome-extensions >/dev/null; then
  echo "gnome-extensions not found: the GNOME version needs GNOME Shell 49 or newer." >&2
  exit 1
fi
command -v python3 >/dev/null || echo "warning: python3 not found; the widget needs it to read Claude's files" >&2

confirm() {
  [ "$yes" = 1 ] && return 0
  if [ ! -t 0 ]; then
    echo "(no terminal to ask on; re-run with --yes to apply)"
    return 1
  fi
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy] ]]
}

# Status-line scripts in use, one per line (links resolved, duplicates dropped).
find_statuslines() {
  if [ -n "${CLAUDE_WIDGET_STATUSLINE:-}" ]; then
    printf '%s\n' "$CLAUDE_WIDGET_STATUSLINE"
    return
  fi
  python3 -I - "$HOME" <<'EOF'
import json, os, shlex, sys
from pathlib import Path
home = Path(sys.argv[1])
found = []
for cfg in [home / ".claude", *sorted(home.glob(".claude-*"))]:
    try:
        command = json.loads((cfg / "settings.json").read_text())["statusLine"]["command"]
        words = shlex.split(command)
    except (OSError, ValueError, KeyError, TypeError):
        continue
    for word in words:
        path = Path(os.path.expanduser(word))
        if path.suffix == ".sh" and path.is_file() and str(path.resolve()) not in found:
            found.append(str(path.resolve()))
print("\n".join(found))
EOF
}

# Write the patched status line ($statusline) to stdout: add, or with "remove" strip, the snippet.
patched_statusline() {
  python3 -I - "$statusline" "$here/statusline-snippet.sh" "$1" <<'EOF'
import re, sys
path, snippet_path, mode = sys.argv[1:4]
text = open(path, encoding="utf-8").read()
block = re.compile(r"^# >>> claude-widget >>>\n.*?^# <<< claude-widget <<<\n", re.S | re.M)
text = block.sub("", text)
if mode == "add":
    snippet = open(snippet_path, encoding="utf-8").read()
    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if re.match(r"\s*input=\$\(cat\)", line):
            lines.insert(i + 1, snippet)
            break
    else:
        sys.exit(f"{path}: no 'input=$(cat)' line found; add statusline-snippet.sh by hand after it reads stdin")
    text = "".join(lines)
sys.stdout.write(text)
EOF
}

apply_statusline() {
  local mode="$1" tmp
  tmp="$(mktemp)"
  if ! patched_statusline "$mode" > "$tmp"; then
    rm -f "$tmp"
    return 0
  fi
  if cmp -s "$tmp" "$statusline"; then
    rm -f "$tmp"
    echo "Status line already up to date: $statusline"
    return 0
  fi
  diff -u "$statusline" "$tmp" || true
  if confirm "Apply this change to $statusline?"; then
    cp -p "$statusline" "$statusline.bak.$(date +%Y%m%d%H%M%S)"
    cat "$tmp" > "$statusline"
    echo "Patched $statusline (backup next to it)."
  elif grep -qF "$marker_start" "$statusline"; then
    echo "Skipped $statusline; its widget snippet stays as it was."
  else
    echo "Skipped $statusline; plan-usage bars stay empty until the snippet is added."
  fi
  rm -f "$tmp"
}

# The GNOME extension: built from this repo (gnome/build.sh), then installed
# and turned on. A running GNOME Shell only loads new extension code at the
# next login.
install_gnome() {
  local zip="$here/gnome/build/$uuid.shell-extension.zip"
  "$here/gnome/build.sh" >/dev/null
  if [ -d "$HOME/.local/share/gnome-shell/extensions/$uuid" ]; then upgraded=1; else upgraded=0; fi
  gnome-extensions install --force "$zip"
  if gnome-extensions enable "$uuid" 2>/dev/null; then
    enabled=1
  else
    # not loaded yet (first install): turn it on for the next login
    enabled=0
    local list
    list="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || echo "@as []")"
    case "$list" in
      *"'$uuid'"*) ;;
      "@as []"|"[]") gsettings set org.gnome.shell enabled-extensions "['$uuid']" || true ;;
      *) gsettings set org.gnome.shell enabled-extensions "${list%]}, '$uuid']" || true ;;
    esac
  fi
}

uninstall_gnome() {
  gnome-extensions uninstall "$uuid" 2>/dev/null || rm -rf "$HOME/.local/share/gnome-shell/extensions/$uuid"
  local list
  list="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || true)"
  case "$list" in
    *"'$uuid'"*)
      list="$(printf '%s' "$list" | sed -e "s/, '$uuid'//; s/'$uuid', //; s/'$uuid'//")"
      gsettings set org.gnome.shell enabled-extensions "$list" || true ;;
  esac
}

mapfile -t statuslines < <(find_statuslines)

if [ "$uninstall" = 1 ]; then
  if [ "$target" = gnome ]; then
    uninstall_gnome
  else
    kpackagetool6 -t Plasma/Applet -r "$id" || true
  fi
  for statusline in "${statuslines[@]}"; do
    [ -f "$statusline" ] && grep -qF "$marker_start" "$statusline" && apply_statusline remove
  done
  echo "Uninstalled. Cached data is in ${XDG_CACHE_HOME:-$HOME/.cache}/claude-widget (safe to delete)."
  exit 0
fi

# 1. Widget (without Python bytecode caches a test run may have left in it)
find "$here/package" -name __pycache__ -type d -prune -exec rm -rf {} +
if [ "$target" = gnome ]; then
  install_gnome
elif [ -d "$HOME/.local/share/plasma/plasmoids/$id" ]; then
  kpackagetool6 -t Plasma/Applet -u "$here/package"
  upgraded=1
else
  kpackagetool6 -t Plasma/Applet -i "$here/package"
  upgraded=0
fi

# 2. Status-line snippet (feeds plan limits and per-session context)
command -v jq >/dev/null || echo "warning: jq not found; the snippet needs it" >&2
if [ "${#statuslines[@]}" -eq 0 ]; then
  echo "No Claude profile runs a status-line script (statusLine in settings.json)."
  echo "Add the contents of statusline-snippet.sh to your status-line command, after it reads stdin into \$input."
fi
for statusline in "${statuslines[@]}"; do
  if [ -f "$statusline" ]; then
    apply_statusline add
  else
    echo "Status-line script not found: $statusline"
  fi
done

echo
if [ "$target" = gnome ]; then
  if [ "$upgraded" = 1 ]; then
    echo "Extension upgraded. GNOME Shell loads the new version when you log out and back in."
  elif [ "$enabled" = 1 ]; then
    echo "Extension installed and turned on: look for the ✳ in the top bar."
  else
    echo "Extension installed. Log out and back in: the ✳ then shows in the top bar."
  fi
elif [ "$upgraded" = 1 ]; then
  echo "Widget upgraded. If the panel still shows the old version: systemctl --user restart plasma-plasmashell"
else
  echo "Widget installed. Right-click the panel → Add Widgets… → search \"Claude Status\"."
fi
