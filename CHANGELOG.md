# Changelog

## Unreleased

- **Continue on …** opens the chat on the other account in VS Code's
  terminal, like every other chat, instead of always in your desktop's
  terminal (`claudeStatus.openIn` = `system` keeps that).
- From the widget's backend:
  - `claude` is found beyond PATH: in `~/.local/bin`, npm's, bun's, Volta's,
    pnpm's and nvm's folders, or on your login shell's PATH.
  - SSH hosts work with any home folder: the shared-connection sockets moved
    to `$XDG_RUNTIME_DIR` (a long home folder name made their path too long).
  - The status-line snippet is plain POSIX sh (it broke status lines run by
    `sh`); **Set Up Plan Usage Bars…** replaces an older copy.
  - Sharing checks for one filesystem first, instead of failing half-way.
  - Lighter status checks: token totals are summed per day when transcripts
    are read, not on every check.

## 0.1.3

- Sharing chats between your accounts is built in (the widget 1.4's
  backend): with two or more Claude accounts on this computer, a finished
  chat's share button offers **Continue on …**, **Share with all accounts**
  and **Keep only on …**, with any profiles and no extra tool. It used to
  appear only where the author's own sharing script was installed.
  **Continue on …** shares the chat with that account only.

## 0.1.2

- New chat asks where: in a terminal as before, or as a Claude Code chat tab
  in this window (the Claude Code extension's own chat). The tab is offered
  for accounts on the window's machine and opens in the window's folder; the
  menu says when the extension is set to another account than the one picked.

## 0.1.1

From the widget's latest fixes (backend synced to its GNOME release):

- A shared chat that moved on to a copy of itself, after that copy was shared
  too, is listed once instead of twice.
- The last minute before a plan limit resets reads "resets in <1m", not "0m".
- New status is stored before the pets and notifications react to it, so one
  reaction that fails can't stop the view from updating (the widget froze at
  every plan-limit reset that way).
- GNOME: chats running outside VS Code are brought to the front through the
  widget's GNOME Shell extension, chats open in GNOME's terminal with
  `claudeStatus.openIn` = `system`, and sounds use GNOME's sound theme.

## 0.1.0

First version: the Claude Status Plasma widget's dashboard in VS Code.

- Every Claude Code chat on this computer and on picked SSH hosts, in an
  Activity Bar view (also as an editor tab), with plan usage, tokens,
  subagents, recent chats and the animated Clawd pets.
- Runs on your side, also in Remote-SSH windows; the window's host is shown
  without setup.
- Chats open in VS Code's terminal on the machine they're on.
- Notifications and sounds from one window at a time; status bar item and
  Activity Bar badge.
- Plan usage bars setup for any status line, with undo.
- Demo mode for screenshots.
