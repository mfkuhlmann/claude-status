# Steps for tools/gnome/shell.sh: the Recap tab, then scrolled down, with a
# day's chats unfolded and a rule's Allow asking first.
ev 'ext.menu.open()'
sleep 2
ev 'ext.setTab("week")'
sleep 8
popup recap
ev 'const a = ext._scroll.vadjustment; a.value = 420'
sleep 1
popup recap-2
ev 'const r = ext.week.recap; ext.weekUnfold("day:" + r.days[r.days.length - 2].day); ext.weekAsk(r.prompts.rules[0].id)'
sleep 1
ev 'const a = ext._scroll.vadjustment; a.value = 0'
sleep 1
popup recap-day
ev 'const a = ext._scroll.vadjustment; a.value = a.upper - a.page_size'
sleep 1
popup recap-end
ev 'ext.menu.close()'
gsettings set org.gnome.desktop.interface color-scheme prefer-dark
sleep 2
ev 'ext.menu.open()'
sleep 3
popup recap-dark
