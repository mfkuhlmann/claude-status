# Changelog

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
