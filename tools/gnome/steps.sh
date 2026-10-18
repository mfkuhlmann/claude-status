# Default steps for tools/gnome/shell.sh: the panel and the popup, then the
# popup with things unfolded, then in the dark style.
work='const g = ext.groups.find(g => g.name.startsWith("work")); const s = n => g.sessions.find(x => x.name === n);'
shot screen
ev 'ext.menu.open()'
sleep 2
popup popup
# subagents of the background job, its stop question, the new-chat menu
ev "$work ext.toggleAgents(s('deploy docs').key); ext.setStopConfirm(s('deploy docs').key); ext.toggleNewChat(g.id)"
sleep 1
popup popup-unfolded
# a tooltip: the tokens line
ev "$work const row = ext._list.get_child_at_index(1).get_children().find(c => c.has_style_class_name && c.has_style_class_name('claude-tokens')); ext.tips._show(row, ['Tokens', 'tooltip test'])"
sleep 1
shot tooltip
ev 'ext.tips.hide(); ext._toggleMenu("hosts", ""); ext.toggleHost("lab")'
sleep 4
popup popup-hosts
ev 'ext.menu.close()'
gsettings set org.gnome.desktop.interface color-scheme prefer-dark
sleep 2
ev 'ext.menu.open()'
sleep 2
popup popup-dark
# the SSH host picked above, at the end of the list (it can't be reached here)
ev 'const a = ext._scroll.vadjustment; a.value = a.upper - a.page_size'
sleep 1
popup popup-host
