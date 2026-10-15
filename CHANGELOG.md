# Changelog

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
