# Changelog

## Unreleased

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
