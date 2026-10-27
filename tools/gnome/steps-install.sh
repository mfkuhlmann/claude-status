# Steps for tools/gnome/shell.sh: ./install.sh on GNOME, as a fresh clone
# would run it (uninstall, install again).
#   tools/gnome/shell.sh OUT tools/gnome/steps-install.sh
uuid=talpy-den@wzaielamri.github.io
cp -r /src "$HOME/clone" && rm -rf "$HOME/clone/gnome/build"
cd "$HOME/clone"
echo "--- uninstall"
./install.sh --uninstall --yes 2>&1 | tail -2
echo "dir after uninstall: $(ls -d "$HOME/.local/share/gnome-shell/extensions/$uuid" 2>&1 | tail -c 30)"
echo "enabled after uninstall: $(gsettings get org.gnome.shell enabled-extensions)"
echo "--- install"
./install.sh --yes 2>&1 | tail -2
echo "enabled after install: $(gsettings get org.gnome.shell enabled-extensions)"
echo "installed files: $(ls "$HOME/.local/share/gnome-shell/extensions/$uuid" | tr '\n' ' ')"
echo "--- install again (an update)"
./install.sh --yes 2>&1 | tail -1
