# Steps for tools/gnome/shell.sh: the background job's subagents, unfolded
# by clicking them (task, last steps, report), and opening one's whole run.
#   tools/gnome/shell.sh OUT tools/gnome/steps-agents.sh
work='const g = ext.groups.find(g => g.name.startsWith("work")); const s = n => g.sessions.find(x => x.name === n);'
# every actor under ext._list with a style class, depth first; scrolling the
# popup so the first one of a class shows near its top
find='const find = (a, cls, out = []) => { if (a.has_style_class_name && a.has_style_class_name(cls)) out.push(a); for (const c of a.get_children()) find(c, cls, out); return out; };'
scroll='const scrollTo = cls => { const b = find(ext._list, cls)[0]; const a = ext._scroll.vadjustment; const [, ly] = ext._list.get_transformed_position(); const [, by] = b.get_transformed_position(); a.value = Math.max(0, Math.min(a.upper - a.page_size, by - ly - 90)); };'
run_button="find(ext._list, 'claude-confirm-button').find(x => x.get_child().get_children().some(c => c.text === 'Open the whole run'))"
ev 'ext.menu.open()'
sleep 2
ev "$work ext.toggleAgents(s('deploy docs').key)"
sleep 1
ev "$find $scroll scrollTo('claude-agent-button')"
sleep 1
popup agents-folded
# click the first subagent (the finished one), as a pointer would
echo "agent lines: $(ev "$find find(ext._list, 'claude-agent-button').length")"
ev "$find find(ext._list, 'claude-agent-button')[0].emit('clicked', 1)"
sleep 1
ev "$find $scroll scrollTo('claude-agent-button')"
sleep 1
popup agent-done-unfolded
# and the running one
ev "$find find(ext._list, 'claude-agent-button')[1].emit('clicked', 1)"
sleep 1
ev "$find $scroll scrollTo('claude-agent-button')"
sleep 1
popup agents-unfolded
ev "$find $scroll scrollTo('claude-agent-detail'); const a = ext._scroll.vadjustment; a.value = a.value + 250"
sleep 1
popup agents-unfolded-lower
echo "open state: $(ev 'JSON.stringify(ext.ui.expandedAgent)')"
# Open the whole run: a click on the button (the container has no app for
# Markdown files, so the popup says where it was saved)
ev "$find $run_button.emit('clicked', 1)"
sleep 4
ev 'const a = ext._scroll.vadjustment; a.value = 0'
sleep 1
popup agent-run-opened
echo "saved runs: $(ls "$HOME/.cache/talpy-den/agent-runs/")"
echo "first lines:"
head -5 "$HOME"/.cache/talpy-den/agent-runs/*.md
# folded again: clicking the line once more
ev "$find find(ext._list, 'claude-agent-button')[0].emit('clicked', 1)"
sleep 1
echo "open state after folding: $(ev 'JSON.stringify(ext.ui.expandedAgent)')"
ev "$find $scroll scrollTo('claude-agent-button')"
sleep 1
popup agents-one-folded
# the same in the dark style
ev 'ext.menu.close()'
gsettings set org.gnome.desktop.interface color-scheme prefer-dark
sleep 2
ev 'ext.menu.open()'
sleep 2
ev "$find $scroll scrollTo('claude-agent-button')"
sleep 1
popup agents-dark
