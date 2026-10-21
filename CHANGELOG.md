# Changelog

## Unreleased

- **Wait for the usage limit:** when an account is at its usage limit,
  **New Chat… → Start with a task…** offers **After the limit resets (in
  2h 15m, at 16:10)**, in a recent folder or **Choose folder…**: the task
  is queued under the account and starts in the background a minute after
  the limit resets (as soon as VS Code or the widget runs, if neither did
  then). The account lists its queued
  tasks with when they start: start one now (▶) or cancel it (✕). One that
  can't start (e.g. its folder isn't trusted any more) stays, saying why.
  The queue is shared with the Plasma widget, and only one of them starts
  a task. Also for SSH hosts' accounts (they start from here, over ssh).
- **Queued tasks wait for the limit:** a task (or a chat going on by
  itself) whose account is at its usage limit when its time comes waits
  on, and starts a minute after that resets, instead of stopping at once;
  ▶ still starts it right away. A chat that went on by itself keeps its
  name.
- **Start a background task later:** **New Chat… → Start with a task…**
  offers **Later, at a time you pick…**: a day (today or one of the next
  six), a time, then the folder. The task waits under the account and
  starts in the background then (as soon as VS Code or the widget runs, if
  neither did then); it's listed with when it starts, to start now or
  cancel. Also for SSH hosts' accounts.
- **Chats go on by themselves after the limit:** a chat a usage limit
  stopped gets **⏱ Go on at 10:41** (next to **Continue on …**): a minute
  after the limit resets, it goes on in the background with *The usage
  limit has reset: go on where you stopped.* (`claude --bg --resume`: the
  same chat). An idle Claude that still has it open quits first (a
  background session is stopped); if the chat went on before then,
  nothing happens. It's listed with the queued tasks (click it again, or
  ✕, to cancel). In **Recent chats**, click a chat's red **limit** tag.
  Only in folders Claude trusts (as for background tasks). Also on SSH
  hosts.
- **A background session the limit stopped** said *Needs input* (Claude
  marks it as blocked, *rate limited — wait and retry*): it now says
  **Limit · resets in …** like the others, and doesn't count as needing
  you.
- **The summary counts chats at the usage limit apart:** *1 working · 2 at
  the usage limit* (red), instead of counting them as idle or done.
- **A recent chat's or a plan's tooltip** shows its whole folder (the
  line may cut it short).
- **Finding more than chats:** **Find a Chat…** also finds project folders
  (by their path: pick one for a new chat there), plans (by their title or
  text) and memories (by what they say), listed before the chats.
- **Each account's memories:** what Claude keeps about you and your
  projects (`<config>/projects/<folder>/memory`) is listed under each
  account (**Memories**, folded), after the account's own `CLAUDE.md` (your
  instructions for every chat on it), newest first, with the folder each is
  for: one opens in the Markdown preview, and the edit button opens its
  file, to change what Claude remembers.
- **Feedback on a plan, as in a review:** in a plan's file (✎), the **+**
  next to a line adds a comment for Claude; change the file itself too if
  you like. **Send Feedback to Claude** (the send button in the editor's
  title bar, **↩ send to Claude** next to the chat's plan, or the plan's
  row) sends your comments, with the lines they're on, and exactly what
  you changed (told apart from Claude's own version of the plan, rebuilt
  from the chat) to the chat that made it, which revises the plan in plan
  mode. A chat idle in one of this window's terminals, or in tmux, gets it
  typed in; one in a Claude Code tab or another terminal gets it on the
  clipboard and comes up, to paste it there; one that isn't open reopens
  in plan mode with it.
- **Plans open in the Markdown preview,** rendered, instead of as a text
  file. To change one, the **✎** next to a chat's **plan ↗** tag, or in
  the plan's row, opens its file in an editor tab (so does the preview's
  **Open Source** button): what you change is the plan.
- **Two chats changing the same files:** chats that are open and changed
  some of the same files get a red **⚠ same files** tag naming the other
  chat and the files (click it to go there), and a notification when it
  starts (with the "waiting" ones): two chats editing one file can
  overwrite each other's work. Also on SSH hosts.
- **The widget's plans and subagent runs in VS Code:** the Plasma
  widget's **Open plans and runs in: VS Code** shows them in VS Code's
  Markdown preview, through a `vscode://` link this extension handles (it
  opens only plans of a Claude config folder and the widget's runs).
- **Open the whole run** in a Remote-SSH window opens the run file of
  this computer (it looked for it on the SSH host).

## 1.12.0

- **Chats a usage limit stopped:** a chat that hit a usage limit
  (*You've hit your session limit*) says so in red, with when that limit
  resets (from the account's plan usage, else from Claude's message), and
  its pet's battery runs low. Once the limit has reset, a notification
  per account says which chats can go on (with the "finished"
  notifications). Meanwhile **Continue on personal** under the chat moves
  it to another account with room left in that limit: shared with it,
  then reopened there in VS Code's terminal. An idle Claude that still has
  it open quits first; one in a Claude Code tab, close the tab first. A
  chat whose login expired says so too.
- **Claude's recap:** when you come back to a chat after a while, Claude
  Code writes a short recap of it (*You asked …; Next step: …*). While
  nothing was said after it, it's the line under the chat (instead of
  Claude's last words) and the first thing in its peek; recent chats show
  theirs in their tooltip.
- **Start a chat with a task, also in the background:** **New Chat…**
  offers **Start with a task…**: say what Claude should do, then pick
  where. In a terminal it's sent right away, in a Claude Code chat tab it's
  typed in for you to send, and **In the background** runs it as a
  background session (`claude --bg`): no window opens, and it's listed
  right away. The background only works in folders Claude trusts already
  (it can't ask there), so never in your home folder. Also on SSH hosts.
- **Find a Chat…** (the search button in the view's title bar): every
  chat with all the words you type in its name, its folder or one of your
  prompts, on this computer and on the SSH hosts shown, newest first. Pick
  one to go to it, or to reopen it.
- **Plans:** a chat that wrote a plan in plan mode gets a **plan ↗** tag
  that opens it in an editor tab (yours to change; an SSH host's that this
  window isn't connected to opens as a copy). Each account lists its plans
  (**Plans**, folded): open one, **carry it out** in a new chat (the plan
  is the chat's first message, with what you add, in a terminal, the
  background or a Claude Code tab), go back to the chat that made it, or
  share it with your other accounts (one file on all of them; **Keep only
  on …** undoes it). Sharing a chat shares its plan too.
- **Permission mode:** a chat in plan mode, auto mode, accept edits or
  don't ask says so next to its name; one that bypasses permissions says
  so in red.
- **SSH hosts that want a password:** such a host shows **Log in…**, which
  opens a terminal where `ssh` itself asks for the password (or
  passphrase, one-time code, new host key): the extension never sees it.
  The checks then go through the connection that login opened, until 30
  minutes after their last check, until you log out, or until you click
  the host's **Disconnect** button.
- The backend is the widget's 1.12.0: background sessions open, stop and
  start even with `CLAUDE_CODE_DISABLE_AGENT_VIEW` set for your whole
  desktop.

## 1.11.0

- **Accounts:** **Claude Status: Claude Accounts…**
  (in the view's ⋯ menu) lists this computer's Claude accounts: whom each
  is logged in as, whether plain `claude` or VS Code's Claude runs on it,
  its running chats. **Add Claude Account…** (also in the account item's
  switcher) makes `~/.claude-NAME` and opens a terminal with Claude's own
  login, optionally with your settings, `CLAUDE.md`, keybindings and own
  skills, agents and commands linked from another account, and a
  `claude-NAME` command. An account can log in or out
  (`claude auth logout`), get or lose its command, be used for VS Code's
  Claude, or be removed (logged out, its folder to the Trash). Login
  terminals are transient: VS Code doesn't keep or restore them. The
  extension never sees a login.
- **Log in…** in the view for an account that isn't logged in (a new one,
  or logged out), also on an SSH host.
- **One default account:** the default account is listed first and marked
  **default** (on each SSH host too, with two or more accounts) (as in the
  Plasma and GNOME widgets: this view listed the account `~/.claude` links
  to first, while the status bar showed VS Code's), its usage is in the
  status bar, and VS Code's Claude and plain `claude` run on it. The
  status bar's account item (**Default Claude Account…**) and **Make
  Default** in Claude Accounts point VS Code's Claude there and, where
  `~/.claude` is a link, plain `claude` too; refused while a chat works in
  VS Code's Claude or any Claude runs through the name `~/.claude`. In a
  Remote-SSH window: the host's default, its `~/.claude` included.
- **Accounts on SSH hosts:** Claude Accounts… first asks whose: this
  computer's or a host's in the view; on a host everything goes over ssh,
  with nothing installed there.
- **Switch Claude Code's account in a Remote-SSH window:** the account item in
  the status bar shows which of the host's accounts Claude Code there runs on,
  and switches it. VS Code keeps that setting per host (it's a machine
  setting, written to the host's Remote Settings from a window connected to
  it), so this computer's account stays as it is; the Claude extension
  follows the change for new chats.
- A new chat in the Claude Code chat tab on the host's other account switches
  Claude Code there to that account first (the menu says so), and it stays on
  it. Before, the chat started on the host's other account.
- **An account's plan usage shows once:** an account logged in on this
  computer and on an SSH host (or on two hosts) has one plan usage, which
  showed under each copy. It now shows where the account is listed first,
  with the newest numbers of them all (the machine they come from is named
  when it's another one). `claudeStatus.sshUsage` shows each host's own
  again (`all`) or none on hosts (`none`).
- The status bar's 5-hour usage is that of the account VS Code's Claude runs
  on (in a Remote-SSH window: the host's), when it has numbers. It was the
  account with a running chat, so a terminal chat on another account showed
  that account's.
- **Plan usage of accounts used in VS Code** (also on SSH hosts), the
  **Claude Code changed something** note, checks that cost less (`poll.py`)
  and VS Code's account listed first come with the widget's backend.
- **A chat in another window's terminal comes into view:** opening a chat
  that runs in the terminal of another VS Code window raised that window
  only; its terminal now comes up there, also with the panel closed. The
  same for a chat in the terminal of a Remote-SSH window connected to an
  SSH host, and when the Plasma and GNOME widgets open such a chat (they
  hand it over with a `vscode://wzaielamri.claude-status/terminal` link).
- **Orange like the widgets:** *needs you* and plan usage from 70% use VS
  Code's orange (`charts.orange`); they were the theme's warning color,
  which is yellow in VS Code's own themes, while the Plasma and GNOME
  widgets show orange.

## 1.10.1

- **Share chats on SSH hosts:** a host with two or more Claude accounts
  (the one this window is connected to with Remote-SSH, or any host you
  picked) gets the share button too: **Continue on …** shares the chat with
  that account there and opens it in VS Code's terminal (through ssh, or the
  window's own terminal on its Remote-SSH host), **Share with all accounts**
  and **Keep only on …** work as they do here, between the host's accounts.
  Nothing is installed on the host.

Fixes (from a review of the whole code):

- A chat whose prompt or reply mentioned the status script's answer marker
  made the whole view say "The status script's answer couldn't be read".
- The extension runs a chat's open and stop commands from its own status,
  never ones the view sends it, and checks every message from the view.
- When Python didn't work at first and the view was opened meanwhile, SSH
  hosts never showed once it did. A fractional number in a count setting
  (e.g. 2.5 recent chats) broke every check; they're whole numbers now.
- A chat's notifications follow the chat, not its row: a background session
  whose row changes as it finishes still notifies, and one listed twice no
  longer alerts every minute. A host that stopped answering no longer counts
  in the badge, status bar or "go to the chat that needs you", and a host's
  clock being off no longer skews its times.
- Plan usage bars setup: a missing or outdated wrapper script is repaired,
  it's written before the settings point at it, files are replaced in one
  step, and what changed in them while the dialog was open is kept.
  `bash $HOME/…` status lines and more ways of reading the input are found.
- Switching VS Code's Claude to a plain `~/.claude` while VS Code itself was
  started with `CLAUDE_CONFIG_DIR` says so instead of doing nothing.
  `pythonPath`, `sshHosts` and `extraConfigDirs` can't be set by a workspace;
  the Terminal | Claude Code switch writes where its value comes from.
- A second quick click on a recent chat no longer starts it twice; a check
  that's given up on ends its ssh too; a window started in the background
  no longer greets you with "While you were away".
- The view: one account that fails to draw no longer blanks the rest,
  subagents that ended on an API error show as failed, pets fetch a pose
  again after a failed load, and polls do less work.
- With the widget's backend fixes (vendored): SSH answers, shared chats,
  caches shared by several copies, and more (see the widget's changelog).

## 1.10.0

- **Open a subagent:** click a subagent in a chat's agent tree to unfold it:
  the task it was given, its tool calls and tokens so far, its last steps
  and, once it's done, its report. **Open the whole run** shows everything
  it did in VS Code's Markdown preview: the task, every step with the start
  of each result, messages the chat sent it, and its report (an SSH host's
  is fetched over ssh). Claude Code itself can't open a subagent from
  outside, so this is the way to read one.

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
