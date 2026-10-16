# Steps for tools/gnome/shell.sh: new chats in VS Code, with stand-ins for
# code and xdg-open that only write down how they were called.
#   tools/gnome/shell.sh OUT tools/gnome/steps-vscode.sh
mkdir -p "$HOME/.local/bin"
for cmd in code xdg-open; do
  printf '#!/bin/sh\necho "%s $*" >> /tmp/vscode.log\n' "$cmd" > "$HOME/.local/bin/$cmd"
  chmod +x "$HOME/.local/bin/$cmd"
done
ln -sfn "$HOME/.claude-work" "$HOME/.claude"   # VS Code's Claude: ~/.claude, i.e. work
sleep 4
group='const g = n => ext.groups.find(g => g.name === n);'
echo "vscode: $(ev 'JSON.stringify(ext._status.vscode)')"
ev 'ext.menu.open()'
sleep 1
ev "$group ext.toggleNewChat(g('work').id)"
sleep 1
popup vscode-work
ev "$group ext.toggleNewChat(g('personal').id)"
sleep 1
popup vscode-personal
# work's first folder, in VS Code: the folder opens, then the new-chat link
ev "$group ext.newChat(g('work').chatProfile, g('work').projects[0].path, true)"
sleep 12
echo "calls:"; cat /tmp/vscode.log
# personal isn't where VS Code's Claude runs: refused
ev 'ext.menu.open()'
ev "$group ext.newChat(g('personal').chatProfile, '', true)"
sleep 3
echo "refused with: $(ev 'ext._actionError')"
