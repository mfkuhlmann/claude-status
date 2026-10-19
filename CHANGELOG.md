# Changelog

## 1.10.0 (2026-10-19)

- **What each subagent did:** click an agent in a chat's agent tree for its task, its tool calls and tokens so far, its last steps and, once it's done, the report it handed back. **Open the whole run** shows everything it did as a Markdown file in your app for those: each step with its tool calls and the start of their results, messages the chat sent it, and its report (fetched over ssh for an SSH host). Claude Code can't open a subagent itself, so this is read-only.
- An agent whose transcript ends with a very big tool result no longer shows as *starting…*: the widget reads further back until it knows what the agent did.
- The GNOME extension has it too, and the VS Code extension is 1.10.0 with the same.

## 1.9.1 (2026-10-18)

- **Chats that need you, on your phone (Plasma):** while you're away (the screen locked for the minutes set under *While you're away*), a chat that needs you is sent to your phone with KDE Connect, and if you like a chat that finishes a turn too. Settings → *Phone*: pick the phone (or every reachable one) and *Send a test*. Off until you turn it on. Back at your desk, the summary comes as before.
- The GNOME and VS Code extensions are unchanged (the GNOME one is numbered 1.9.1 along with the widget).

## 1.9.0 (2026-10-18)

- **Your last days in numbers:** click an account's token line for its last 14 days: tokens per day as bars (today's in your accent color), chats, prompts and active days, your busiest folders and the models you used. The token scan keeps 30 days of per-day sums for it, and reads back 30 days once.
- **A chat's recap:** the box under a chat ends with its numbers: your prompts, how long Claude worked, its tool calls by name, its tokens (subagents included) and, when the status line has it, what the session would cost through the API.
- The GNOME extension has them too, and the VS Code extension is 1.9.0 with the same.

## 1.8.0 (2026-10-18)

- **What a chat is doing, without switching to it:** a line under each session says what it's doing right now (*▸ Bash: npm test*), what it needs, or what Claude said last. Click it for your last prompt, Claude's reply and the chat's tasks.
- **Task progress:** a chat's task list (Claude's own) shows as a bar with *2/5* and, unfolded, as a checklist.
- **What a chat changed, side by side:** **±3** next to a chat counts the files it changed. Click it, or *Compare changed files* / *Last turn* in the unfolded box, and VS Code shows each file as it was before the chat (or before its last turn) next to the file now. With the VS Code extension 1.8 or newer they open in one multi-file view.
- **Usage forecast:** usage bars show where you'll be when the window resets at your pace, a mark for an even pace, and a warning when you'd run out before it resets.
- **A shortcut to the chat that needs you:** the widget's keyboard shortcut (Plasma: set it in its settings; GNOME: Super+Shift+C; VS Code: Ctrl+Alt+Shift+C) goes to the chat that has waited longest, then to ones that finished while you weren't looking; again for the next one.
- **While you were away:** after the screen has been locked for 5 minutes (a setting), notifications wait; when you're back, one notification and a card at the top of the popup sum up what finished, failed or needs you.
- The GNOME extension has all of this too, and the VS Code extension is 1.8.0 with the same changes.

## 1.7.0 (2026-10-18)

- **Stop or interrupt any running chat:** the ■ stop button works on every chat with a process, whatever it's doing, and asks first with what will happen. In a terminal, Claude quits as when the terminal closes: the current step is cut off, the terminal stays open and the chat moves to **Recent chats**. In VS Code's Claude tab it's like the tab's own stop button: the tab says *Interrupted*, keeps the chat and goes on with your next message (Claude gets SIGINT there, its clean exit; SIGTERM showed an error). A working chat in tmux can be **interrupted** instead: Ctrl+C in its pane, which stops the turn and its subagents, background ones too, and keeps the chat open. Commands a stopped chat leaves behind are ended too. Also on SSH hosts.
- **Model and effort:** a chat's row shows its reasoning effort next to the model (*Opus 5.5 · max*, from the status line), and each subagent in the tree the model it runs on (*Explore · Haiku 4.5*).
- **System tray (Plasma):** Claude Status can sit in the system tray: System Tray Settings → Entries → Claude Status (off until you switch it on; *Shown when relevant* shows it while a chat runs). With a panel widget and a tray one, only one of them notifies, and they share their settings.
- **An icon that catches your eye:** it blinks while a chat needs you that you haven't seen, and pulses a few times when one finishes. Its one number is the most urgent: red for chats that need you, else green for chats that finished since you last opened the popup (turns as long as the "finished" notifications ask for). Opening the popup counts as seen. A new setting turns the blinking off.
- The VS Code extension is 1.7.0 too, with the same changes; in its own terminals a working chat can be interrupted (Ctrl+C) too, not only in tmux.

## 1.6.0 (2026-10-17)

- **Stop idle chats:** a chat in a terminal whose turn is over gets the ■ stop button too (it asks first). Claude shuts down as when its terminal closes: the terminal stays open, and the chat is kept and moves to **Recent chats**. One that got back to work meanwhile isn't touched, and one that hangs on is killed after 10 s. Also on SSH hosts. Not for chats in VS Code, where it would show as an error.
- **Recent chats in VS Code:** the **Terminal | VS Code** switch now sits at the top of each account's recent chats too (one choice for new and recent chats). In VS Code, a chat reopens in the folder it last ran in, in a new tab of the Claude panel; on an SSH host, through Remote-SSH.
- **Terminal or VS Code, whichever is there:** both halves of the switch always show. **Terminal** is greyed out without the `claude` command (here, or on that SSH host), and chats open in VS Code then; **VS Code** is greyed out when it isn't installed. The tooltips say why, and a line under the switch does when neither works.
- The VS Code extension is 1.6.0 too, with the same changes (its switch says **Terminal | Claude Code tab**).

## 1.5.0 (2026-10-17)

- The Plasma widget, the GNOME extension and the VS Code extension now share their version numbers: all three are 1.5.0.
- **Works beyond the author's setup:**
  - Opening, attaching, stopping and starting chats no longer need `claude` on the desktop session's PATH: it's also found in `~/.local/bin`, npm's, bun's, Volta's, pnpm's and nvm's folders, or on your login shell's PATH (nvm installs get their Node too). When it's nowhere, the message says what to do.
  - SSH hosts work with any home folder: the shared-connection sockets moved to `$XDG_RUNTIME_DIR` (a home folder name over 24 characters made their path too long, and every check failed).
  - The status-line snippet is plain POSIX sh: it broke status lines run by `sh` (dash on Debian and Ubuntu). `./install.sh` replaces an older copy.
  - Sharing checks that the chat, your other account and the shared-chat folder are on one filesystem before it changes anything, instead of failing half-way.
- **New chat:** one **Terminal | VS Code** switch at the top of an account's folders, kept for next time, instead of a VS Code button on every folder.
- **Lighter:** while nothing runs and the popup is closed, the widget checks every 10 s instead of every 2 s (a new setting, *…while nothing runs*; opening the popup checks at once). Token totals are summed per day when transcripts are read (once a minute), and VS Code is looked for at most every 30 s (or when its settings or PATH change), instead of on every check.
- Tests pass when run from a GNOME session, with `claude` in `/usr/bin`, and don't touch your real state folders.

## 1.4 (2026-10-16)

- **Sharing chats is built in:** with two or more Claude accounts on this computer, the share button on a finished chat (**Continue on …**, **Share with all accounts**, **Keep only on …**) works out of the box, with any profiles (`~/.claude`, `~/.claude-*`, extra config folders). It used to need the author's own script. A shared chat is one transcript hard-linked into each profile; its folders live in `~/.local/share/claude-status/shared-chats`. **Continue on …** now shares the chat with that account only. See "Sharing chats" in the README.
- **New chats in VS Code:** the + next to an account now unfolds its folders under its name, each with a **VS Code** button next to it: VS Code opens the folder and its Claude extension a new chat there (on an SSH host through Remote-SSH). The button works on the account VS Code's Claude runs on (its `CLAUDE_CONFIG_DIR` setting, else `~/.claude`) and says so on the others. Clicking a folder still opens a terminal. Both on Plasma and GNOME.

## 1.3 (2026-10-15)

- **GNOME Shell extension** (GNOME 49 and 50, e.g. Ubuntu 26.04): the same dashboard in GNOME's top bar, with the same scripts (`gnome/`, installed by `./install.sh` on GNOME). See "On GNOME" in the README.
- Fixed: the popup stopped updating when a plan limit reset (the pets' "limit reset!" cheer failed, and every later update with it) until Plasma restarted. Failed actions hit the same error.
- Fixed: a shared chat that moved on to a copy which was then shared too was listed twice, with a link to itself from each account.
- The last minute before a plan limit resets reads "resets in <1m" instead of a rounded "0m", which looked stuck.

## 1.2 (2026-10-15): first public release

- A panel widget and dashboard for Claude Code: the state of every session (working, needs you, your turn, done) across your Claude profiles, accounts and SSH hosts, with plan usage, context, token totals, recent chats, notifications with sounds, and actions to jump to, start, stop, hide and share chats.
- **The big Clawd** on a stage at the top of the popup: its light shows the whole dashboard at a glance (orange when a chat needs you, blue while chats work, green when it's your turn, a starry night when all is done), with a headline you can click to go to the chat that needs you.
- **Pets per account:** every account's chats walk on a stage under its name, one pet per chat, each keeping its spot and its color (shared with a bar on the chat's row) until the chat leaves the list.
- Working sessions, usage bars and the panel spark use your theme's accent color.
- Runs on any Plasma 6 system: without Qt 6.10 or the QtQuick.VectorImage module (e.g. Kubuntu 25.10 and 26.04 out of the box), the pets are still images. Tested on Fedora 44, Kubuntu 25.10 and Kubuntu 26.04.
- New chat: next to your recent folders, **Choose folder…** opens the folder dialog (in your home folder) to start the chat anywhere.
- New terminals open in your default terminal (System Settings → Default Applications) when that isn't Konsole.
- Restarting Plasma (by hand, after an update or a crash) no longer kills chats in terminals the widget opened: terminals and VS Code windows get a systemd scope of their own.
- The status script runs on SSH hosts with Python 3.7 or newer.
