# Changelog

## 1.9.0

- **Your last days:** an account's token line unfolds its last 14 days:
  tokens per day as bars (today's in the accent color; hover one for its
  chats and prompts), the totals, the busiest folders and the models used.
- **A chat's recap:** the unfolded peek ends with the chat's numbers: your
  prompts, how long Claude worked, its tool calls by tool, its tokens
  (subagents included) and, when the status line says so, its cost at API
  prices.

## 1.8.0

- **See what a chat is doing without switching to it:** a line under each
  chat says what it's on right now (*▸ Bash: npm test*), what it needs, or
  the first line of Claude's last reply. Click it for your last prompt,
  Claude's whole reply, the chat's tasks and its changed files.
- **Task progress:** a chat with a task list gets a **2/4** tag that fills up
  as tasks get done; its tooltip lists them with the one it's on now.
- **Compare what a chat changed:** the **± 3 files** tag opens VS Code's
  changes view with every file the chat changed, as it was before the chat
  and now (or only its last turn, from the unfolded peek). The Plasma and
  GNOME widgets open the same view through this extension
  (`vscode://wzaielamri.claude-status/changes`).
- **Usage forecast:** each plan bar shows where your pace leads by the reset
  (lighter) and where an even pace would be by now (a tick). When the
  5-hour limit would run out first, a line under it says when.
- **Go to the chat that needs you:** Ctrl+Alt+Shift+C (**Claude Status: Go
  to the Chat That Needs You**) opens the chat waiting longest; press it again
  for the next one, then the chats that finished while you weren't looking.
  With none, it shows the view.
- **While you were away:** back at VS Code after 5 minutes or more
  (`claudeStatus.awayMinutes`), one notification and a card in the view sum
  up what happened: chats that need you, finished or failed, limits that
  reset. Meanwhile, notifications of finished chats wait for it
  (`claudeStatus.awayDigest`). With notifications off, only the card shows.

## 1.7.0

- The same version as the widget and the GNOME extension: all three are 1.7.0.
- **Stop or interrupt any running chat:** the ■ button works on every chat
  with a process, whatever it's doing, and asks first, saying what will
  happen. In a terminal, Claude quits as when its terminal closes (the chat
  is kept and moves to Recent chats); in a Claude Code tab it's like the tab's
  own stop button (the tab says *Interrupted* and goes on with your next
  message). A working chat in one of this window's terminals, or in tmux, can
  be interrupted instead: Ctrl+C, which stops the turn and its subagents, and
  keeps the chat open. Also on SSH hosts.
- **Model and effort:** chats show their reasoning effort next to the model,
  subagents the model they run on.
- From the widget's backend 1.7.0: stopping by signal as each host expects
  (SIGINT for Claude Code tabs, SIGTERM in terminals) and ending what a
  stopped chat leaves behind; `jump.py --interrupt`; models and effort.

## 1.6.0

- The same version as the widget and the GNOME extension: all three are 1.6.0.
- **Stop idle chats:** a chat in a terminal whose turn is over gets the ■
  stop button too (it asks first). Claude quits as when its terminal closes:
  the terminal stays open, and the chat is kept and moves to Recent chats. One
  that got back to work meanwhile isn't touched. Also on SSH hosts. Not for
  chats in a Claude Code tab, where it would show as an error.
- **Recent chats in a Claude Code tab:** a **Terminal | Claude Code tab**
  switch above an account's recent chats (`claudeStatus.reopenIn`). In Claude
  Code, a chat reopens in the window that has its folder (opened if needed;
  an SSH host's through Remote-SSH).
- **Terminal or Claude Code, whichever is there:** without the `claude`
  command on a chat's machine, Terminal is greyed out and recent chats reopen
  in Claude Code; **New chat** says so and offers the chat tab. Claude Code
  tab is greyed out when the extension isn't there or runs on another
  account. The tooltips say why.
- From the widget's backend: `claude_status.py` reports whether the `claude`
  command is there; `jump.py --stop` stops idle chats, and `jump.py --resume
  … --vscode` reopens a chat in VS Code.

## 1.5.0

- From now on this extension has the same version as the Plasma widget and the GNOME
  extension: all three are 1.5.0.
- **Switch VS Code's Claude between your accounts:** the status bar shows
  which account the Claude Code panel runs on (**Claude: work**); click it,
  or run **Use Account for VS Code's Claude…**, and the window reloads on
  the one you pick. It changes only VS Code's `claudeCode.environmentVariables`:
  plain `claude` in a terminal and running chats keep their accounts.
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
