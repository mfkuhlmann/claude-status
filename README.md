# Claude Status for VS Code

Every Claude Code chat you have running, on this computer and on your SSH
hosts, in one VS Code view: which ones need you, which are working, plan
usage, subagents, recent chats, and Talpa, the animated pet who acts it all
out. The VS Code companion of the
[Claude Status widget](https://github.com/wzaielamri/claude-status)
for KDE Plasma and GNOME; all of them use the same backend.

## TL;DR

- **What**: every Claude Code chat you have running, on this computer and on
  your SSH hosts, in one VS Code view: which need you, which are working,
  which are done, with each account's plan usage.
- **Why**: click a chat to go to it (its terminal, VS Code's Claude tab or
  its background job), get a notification when one needs you or finishes,
  and see what each chat is doing and what it changed without switching
  to it.
- **Also**: subagent runs, plans, memories, Find a Chat, tasks that start
  once a limit resets, moving a chat to another account, and Talpa acting it
  all out.
- **Install**: download `claude-status-<version>.vsix` from the
  [latest release](https://github.com/wzaielamri/claude-status-vscode/releases/latest),
  then `code --install-extension claude-status-<version>.vsix`. Needs
  Linux, Python 3.7+ and Claude Code; `jq` for the plan usage bars.
- **On your desktop**: the
  [Claude Status widget](https://github.com/wzaielamri/claude-status) for
  KDE Plasma and GNOME.

<!-- Screenshots show demo data only (Claude Status: Toggle Demo Data, or dev/harness.html), never real chats. -->
<p>
  <img src="docs/screenshots/view-dark.png" alt="The Claude Status view in a dark theme: Talpa under &quot;1 chat needs you&quot;, an account with three chats, their pets, plan usage bars and a queued task, and an SSH host with a chat a usage limit stopped" width="300">
  <img src="docs/screenshots/view-light.png" alt="The same view in a light theme" width="300">
</p>

As an editor tab (**Claude Status: Open in Editor Tab**):

<img src="docs/screenshots/editor-tab.png" alt="The view opened as a wide editor tab" width="640">

## What it shows

- **Every chat**, grouped by account: waiting for you (permission prompt,
  question…), working, your turn, finished. Background jobs too, and the
  subagents a chat runs.
- **What a subagent did**: click one in a chat's agent tree for the task it
  was given, its tool calls and tokens, its last steps and its report.
  **Open the whole run** shows every step in VS Code's Markdown preview (the
  start of each result, messages from the chat, the report). Claude Code
  can't open a subagent from outside, so the run is rendered from its
  transcript; an SSH host's is fetched over ssh.
- **What a chat is doing, without switching to it**: a line under each chat
  says what it's on right now (*▸ Bash: npm test*), what it needs, Claude's
  recap of it (when you come back to a chat after a while, Claude Code writes
  one: *You asked …; Next step: …*), or the first line of Claude's last
  reply. Click it for your last prompt, Claude's whole reply, the chat's task
  list and its changed files. A chat with a task list gets a **2/4** tag that
  fills up as tasks get done; a chat in plan mode, auto mode, accept edits or
  don't ask says so, and one that bypasses permissions says so in red.
- **Chats a usage limit stopped** say so in red, with when the limit resets;
  their pet's battery runs low. Once it has reset, a notification says which
  chats can go on. Meanwhile **Continue on …** under the chat moves it to
  another account with room left (shared with it, then reopened there), or
  **⏱ Go on at 10:41** has it go on by itself in the background once the
  limit resets (an idle Claude that still has it open quits first). In
  **Recent chats**, click a chat's **limit** tag for the same.
- **Find a Chat…** (the search button in the view's title bar): every chat
  with all the words you type in its name, folder or prompts, here and on
  the SSH hosts shown. Pick one to go to it, or to reopen it. It finds
  project folders (pick one for a new chat there), plans and memories too.
  Each kind, and each computer, folds under its heading (the chats show at
  first); the button in its title bar unfolds them all.
- **Plans**: a chat that wrote a plan in plan mode gets a **plan ↗** tag
  that shows it in VS Code's Markdown preview, and a **✎** that opens its
  file to change it (as does **Open Source** in the preview). There, the
  **+** next to a line adds a comment for Claude, and **Send Feedback to
  Claude** (the send button in the title bar) sends your comments and your
  changes to the chat that made the plan: Claude revises it in plan mode.
  Each account lists its plans (**Plans**):
  open one, carry it out in a new chat (the plan is its first message, with
  what you add), go back to the chat that made it, or share it with your
  other accounts (sharing a chat shares its plan too).
- **Queued tasks**: a task started in the background can wait for a day
  and time you pick (**Later, at a time you pick…**), or, when the account
  is at its limit, until the limit resets (**After the limit resets**),
  then starts by itself. The account lists its queued tasks with when they
  start: start one now or cancel it.
- **Chats changing the same files**: chats that are open and changed some of
  the same files get a red **⚠ same files** tag naming the other chat (and a
  notification), since two chats editing one file can overwrite each other.
- **Memories**: each account lists what Claude remembers about you and your
  projects (**Memories**), after its own `CLAUDE.md`: read one in the
  Markdown preview, or edit it.
- **What a chat changed**: its **± 3 files** tag opens VS Code's changes view
  with each file as it was before the chat and as it is now (or only the last
  turn: **Last turn** in the unfolded peek). The files come from the backups
  Claude Code makes before it edits a file; a file with no backup is compared
  with git's last commit. Changes made through shell commands aren't tracked.
- **Plan usage**: the 5-hour and weekly limits of each account with when they
  reset, today's and this week's tokens. Each bar also shows where your pace
  leads by the reset (the lighter part) and where an even pace would be by now
  (the tick); when the 5-hour limit would run out first, a line says when.
- **Your last days**: click an account's token line for its last 14 days:
  tokens per day as bars (hover one for its chats and prompts), the totals,
  the busiest folders and the models used. The prompts come from Claude
  Code's prompt history, the tokens from the transcripts.
- **Your week with Claude**: the view's **Week** tab recaps your last 7 days
  (and the weeks before, a click back): how long you were at it and how long
  Claude worked, against the week before; a row per day on a timeline, with
  when you were at it, when Claude worked (darker where several chats worked
  at once) and when it waited for your answer (point at a day to see what
  went on then); the projects and chats it worked on most (click one to bring
  it up); what the same work would cost at Claude's API prices, by model,
  with what the cache saved; and what would use less of your plan: the tips
  of Claude Code's own `/usage` (*Start fresh when you switch tasks*, *Save
  max effort for hard tasks*, …), each with the share of the week's usage it
  touches and a command to copy. For all your accounts or one, with the SSH
  hosts shown. It's read from the chats' transcripts, so it uses no tokens,
  and only while the tab is open: the first time takes a few seconds, after
  that only what's new is read.
- **A chat's recap**: the unfolded peek ends with the chat's numbers: your
  prompts, how long Claude worked (each turn from your prompt to its last
  step), its tool calls by tool, its tokens with its subagents', and what it
  would cost at API prices when the status line says so.
- **The chat that needs you, one key away**: **Ctrl+Alt+Shift+C** (**Claude
  Status: Go to the Chat That Needs You**) opens the chat that has waited
  longest; press it again for the next one, then the chats that finished
  while you weren't looking. With none, it shows the view.
- **While you were away**: back at VS Code after 5 minutes or more, one
  notification (and a card at the top of the view) sums up what happened:
  chats that need you, finished or failed, limits that reset. Meanwhile,
  notifications of finished chats wait for it.
- **SSH hosts**: the chats on the hosts you pick, side by side with this
  computer's. A host that wants a password shows **Log in…**: a terminal
  where `ssh` asks for it, so the extension never sees it; the checks then
  use that connection (until 30 minutes after their last use, logging out,
  or the host's **Disconnect** button).
- **Notifications** (and a sound) when a chat needs you or finishes a long turn.
- **The status bar**: how many chats need you, the 5-hour usage, and with
  two or more accounts which one VS Code's Claude runs on (**Claude: work**):
  click it to change the default account.
- **Talpa**: one pet for the whole dashboard, one per chat (in the same
  order as the list: the chats that need you first, the others in the order
  they started; its bar in the pet's color), each acting out its chat.
  Talpa lives in a burrow: it digs over to another spot instead of walking,
  a new chat's pet digs up out of the ground, and one whose chat leaves the
  list waves and digs away. Click a pet to open its chat, drag one out of
  its burrow, double-click the big one.
- **Shared chats**: with two or more Claude accounts on this computer (or
  on an SSH host), a finished chat's share button continues it on another
  account (say, when one hits its limit), shares it with all of them, or
  keeps it on one again (see "Good to know" for adding a second account).
- **Accounts**: **Claude Status: Claude Accounts…**
  (the view's **⋯** menu) lists the Claude accounts of this computer or of
  an SSH host in the view: whom each is logged in as, which one is the
  default, which ones VS Code's Claude and plain `claude` run on. **Add
  Account…** makes a `~/.claude-NAME` folder and opens a terminal with
  Claude's own login; an account can log in or out, get a `claude-NAME`
  command, become the default, or be removed (to the Trash). An account that
  isn't logged in shows **Log in…** in the view.
- **One default account**: listed first (here and in the Plasma and GNOME
  widgets) and marked **default**, its usage in the status bar, and both
  VS Code's Claude and plain `claude` run on it (see "Good to know"). Each
  SSH host has its own: what Claude Code there runs on.

## Your side, also over Remote-SSH

The extension always runs on your computer (`"extensionKind": ["ui"]`), even
when the VS Code window is connected to a server with Remote-SSH. So one view
shows your local chats *and* the server's (and any other host's), whichever
machine the window is on:

```text
 your computer                                 an SSH host
┌───────────────────────────────────────┐
│ VS Code window (local or Remote-SSH)  │
│   Claude Status view (webview)        │
│   extension: runs here, always        │
│     ├─ reads ~/.claude* here          │       ┌────────────────────────┐
│     └─ ssh host 'python3 -' ──────────┼─────► │ reads its ~/.claude*   │
└───────────────────────────────────────┘       │ (nothing is installed) │
                                                └────────────────────────┘
```

The host your window is connected to is shown without setting anything up.
Other hosts: **Claude Status: Show Claude on SSH Hosts…** lists the ones in
`~/.ssh/config`. A host needs key-based login (the check never asks for a
password) and `python3` 3.7 or newer; nothing is installed there.

Clicking a chat opens it on the machine it's on: in VS Code's terminal here,
on the window's host, or through `ssh -t` for another host. A chat already
running in one of this window's terminals is brought to the front; a chat of
the Claude Code extension is revealed in it.

**New chat** (＋) asks where: in a terminal, in one of the account's recent
folders or any other, or as a Claude Code chat tab in this window. **Start
with a task…** first asks what Claude should do: the chat starts with it (in
a terminal at once, in a chat tab typed in for you to send), and can also run
**in the background** (`claude --bg`: no window, listed right away; only in
folders Claude trusts already, since it can't ask there). **Later, at a time
you pick…** queues it for a day and time instead, and when the account is at
its usage limit, **After the limit resets** queues it for a minute after the
limit resets (the queue is shared with the Plasma widget, which starts it too
if VS Code isn't running). The chat
tab is offered for accounts on the window's own machine (this computer, or the
Remote-SSH host); it starts in the window's folder, on the account the Claude
Code extension is set to, and the menu says so when that's another account.
Without the `claude` command on that machine, the menu says so and offers only
the chat tab.

**Recent chats** reopen in a terminal (`claude --resume`) or in a Claude Code
tab: the **Terminal | Claude Code tab** switch above them picks which (kept in
`claudeStatus.reopenIn`). A Claude Code tab opens in the window that has the
chat's folder: this one, another, or a new one (an SSH host's chat: connected
to it). A half is greyed out where it can't work, and its tooltip says why: no
`claude` command on the chat's machine (the chats then reopen in Claude Code),
or Claude Code not installed or on another account.

**Stopping and interrupting** (■, asks first, saying what will happen): a
background session is stopped with `claude stop`. Any other running chat can
be stopped whatever it's doing: in a terminal, Claude quits as when its
terminal closes (the current step is cut off, the terminal stays open, and the
chat moves to Recent chats); in a Claude Code tab it's like the tab's own stop
button (the tab says *Interrupted*, keeps the chat and goes on with your next
message). A working chat in one of this window's terminals, or in tmux, can be
**interrupted** instead: Ctrl+C, as if pressed there, which, like the Claude
Code tab's stop button, stops the turn and its subagents (background ones
too) and keeps the chat open. Stopping ends every subagent of the chat, since
they run inside its Claude, and an idle chat that got back to work since you
asked isn't touched.

Each chat shows its model and reasoning effort (*Opus 5.5 · max*, from the
status line), and each subagent the model it runs on.

## Requirements

- VS Code 1.90 or newer.
- Python 3.7+ on this computer (`python3`, or set `claudeStatus.pythonPath`)
  and on every SSH host you pick.
- Linux on this computer for its running chats to show (they are found
  through `/proc`); SSH hosts work from macOS too. VS Code installed as a
  package (`.deb`, `.rpm`, Arch's): a Flatpak VS Code runs extensions in a
  sandbox that can't see Claude's sessions.
- Claude Code. A plain `~/.claude` is all it needs; more profiles
  (`~/.claude-*`, `$CLAUDE_CONFIG_DIR`, `claudeStatus.extraConfigDirs`) are
  picked up as well. `claude` is found on PATH, in `~/.local/bin` and npm's,
  bun's, Volta's, pnpm's and nvm's folders, or on your login shell's PATH.
- For plan usage bars: `jq`, and the status-line snippet (next section).

## Plan usage bars

Claude Code hands plan usage only to its status line. **Claude Status: Set Up
Plan Usage Bars…** adds a small snippet that keeps a copy of it:

- a status line that runs a script reading its input (`input=$(cat)`) gets
  the snippet after that line, the way the widget's `install.sh` adds it
  (the two never add it twice);
- a profile without a status line, or with another kind of command, gets a
  small wrapper as its status line, which keeps the copy and then shows what
  the status line showed before.

It shows what it will change (and the diff, if you like), asks, and backs up
every file it changes. **Remove the Plan Usage Status-Line Snippet** undoes
it. The bars fill in after the next reply in each account's chats.

## Install

Not on the Marketplace yet. Download `claude-status-<version>.vsix` from the
[latest release](https://github.com/wzaielamri/claude-status-vscode/releases/latest),
then in VS Code open the Extensions view, **⋯** → **Install from VSIX…**, or:

```sh
code --install-extension claude-status-<version>.vsix
```

A downloaded extension doesn't update by itself: install a newer release the
same way. Or build it from a clone:

```sh
npm ci
npm run package                     # builds claude-status-<version>.vsix
code --install-extension claude-status-*.vsix
```

## Settings

| Setting | Default | |
|---|---|---|
| `claudeStatus.sshHosts` | `[]` | SSH hosts to show (use the host picker) |
| `claudeStatus.includeCurrentRemote` | `true` | Also show the Remote-SSH window's host |
| `claudeStatus.remotePollSeconds` | `30` | How often hosts are checked |
| `claudeStatus.sshUsage` | `once` | Plan usage on hosts' accounts: an account on this computer and a host (or two hosts) shows it once, where it's listed first, with the newest numbers; `all`: under every copy; `none`: on no host |
| `claudeStatus.pollInterval` | `2000` | ms between checks of this computer while the view is open (10 s when hidden) |
| `claudeStatus.extraConfigDirs` | `[]` | More Claude Code config folders |
| `claudeStatus.openIn` | `vscode` | `system`: open chats in your desktop's terminal app instead |
| `claudeStatus.reopenIn` | `terminal` | `claudeCode`: reopen recent chats in a Claude Code tab (the switch above them) |
| `claudeStatus.notifyWaiting` / `notifyDone` | `true` | Notifications; turn them off here if the Plasma or GNOME widget notifies too |
| `claudeStatus.notifyDoneMinSeconds` | `30` | Shortest turn that gets a "finished" notification |
| `claudeStatus.awayDigest` / `awayMinutes` | `true` / `5` | The "while you were away" summary, after this many minutes without using VS Code (with notifications off, only its card in the view) |
| `claudeStatus.notifySound`, `soundVolume`, `soundWaiting`, `soundDone`, `soundFailed` | | Sounds (sound-theme names or files) |
| `claudeStatus.showPet` / `chatPets` | `true` / `5` | Talpa, and pets per account |
| `claudeStatus.showTokens`, `showUsageInStatusBar`, `recentChats`, `keepDoneHours` | | What the view shows |
| `claudeStatus.pythonPath` | `python3` | Python on this computer |

## Privacy

Nothing leaves your computer except the `ssh` connections to the hosts you
pick. There is no telemetry, and the view loads nothing from the internet.

What it reads, all of it written by Claude Code itself: the session registry
(`<config>/sessions`), background jobs (`<config>/jobs`), transcripts (for
token totals, chat titles, subagents, what a chat is doing and which files it
changed), task lists (`<config>/tasks`), the backups Claude makes before it
edits a file (`<config>/file-history`, to compare a chat's changes),
`history.jsonl` (recent folders, and your prompts for **Find a Chat…**),
the plans chats wrote (`<config>/plans`), Claude's memories
(`<config>/projects/<folder>/memory`) and each account's `CLAUDE.md`,
the account name and plan from `.claude.json`, and the status-line copies in
`~/.cache/claude-widget/statusline`. The **Week** tab reads the transcripts
too, and keeps what it read in `~/.cache/claude-widget/week-1.json`; it calls
no model. It writes only to
`~/.cache/claude-widget` (caches, the list of chats you removed, the tasks
you queue until they start, copies of the files a comparison shows, kept for
a day) and, if you
ask for it, the status-line change above, the links of the chats and plans
you share (see below) and the accounts you add or remove. A task you start a
chat with goes to Claude, which runs it like a prompt you type (with a plan
you carry out, the plan's text is part of it); so does feedback on a plan you
send (your comments and what you changed), which goes on your clipboard when
the extension can't type it in.

**Logins stay Claude's.** Logging in and out is Claude Code's own command
(`claude auth login` in a terminal, where you sign in on Claude's pages in
your browser; `claude auth logout`). The extension never opens a login
(`.credentials.json`), never sees a password, token or code, and writes
nothing of them to its log. A login terminal is a transient one: VS Code
neither keeps its screen nor restores it after a reload. **Claude
Accounts…** asks `claude auth status` whom each account is logged in as and
shows the email address only in that menu. Removing an account deletes its
`.credentials.json` (without opening it) after the logout, so no login ends
up in the Trash. On an SSH host, the login runs there over ssh, and the code
you paste goes straight to Claude on the host.

## Good to know

- Every VS Code window runs its own copy; only the window you used last
  shows notifications and plays sounds. "Away" means no VS Code window was in
  use, so switching between windows isn't an absence.
- The Plasma widget and the GNOME extension use this extension through its
  `vscode://wzaielamri.claude-status/…` links: a chat's changes open in its
  changes view (without it, one diff per file), a chat in one of VS Code's
  terminals brings up that terminal, and the Plasma widget's plans and
  subagent runs open in the Markdown preview (**Open plans and runs in: VS
  Code**).
- With the Plasma widget or the GNOME extension running too, both notify:
  turn notifications off in one of them.
- On KDE Plasma, a chat running in a terminal outside VS Code (or in
  another VS Code window) is brought to the front the way the widget does it
  (Konsole tab, window); on GNOME too, while the widget's Claude Status GNOME
  Shell extension runs (GNOME 43, 44, 49 and newer; log out and in after
  installing it). Elsewhere, and on GNOME without it, the view says where
  the chat runs. On GNOME, sounds use GNOME's sound theme.
- **Claude Status: Toggle Demo Data** shows made-up chats (for screenshots,
  or to try it without Claude Code).
- **Sharing a chat** hard-links its transcript into each account's profile,
  so whichever account continues it writes to the same file; its subagent
  folder and undo checkpoints move to `~/.local/share/claude-status/shared-chats`.
  No tokens, hooks or settings are involved. A shared chat can be open in one
  session at a time: the view won't share or unshare one that's open, so
  close it on one account before you resume it on another. Everything in the
  chat goes to the account that continues it. **Keep only on …** undoes it.
  **Continue on …** opens the chat like any other: in VS Code's terminal, or
  your desktop's with `claudeStatus.openIn` = `system`. On an SSH host
  (Remote-SSH's or a picked one) with two or more accounts it works the same,
  between that host's accounts; the sharing script goes over ssh like the
  status script, so nothing is installed there. A chat can't move between
  this computer and a host.
- **The default account** (click **Claude: …** in the status bar, run
  **Claude Status: Default Claude Account…**, or **Make Default** in Claude
  Accounts) is the one VS Code's Claude runs on: it sets `CLAUDE_CONFIG_DIR`
  in VS Code's `claudeCode.environmentVariables` and reloads the window
  (other windows offer to reload). Where `~/.claude` is a link, it's pointed
  at the account too, so plain `claude` in a terminal runs on it as well; a
  `~/.claude` folder stays as it is. It's refused while that would cut a chat
  off: one working in VS Code's Claude (the reload), or any Claude running
  through the name `~/.claude` (in a terminal, VS Code or the background: it
  would go on on the other account). In a Remote-SSH window it's the host's
  default: Claude Code there (a machine setting) and the host's `~/.claude`.
  Remote-SSH windows read the VS Code setting too: on a host without the
  folder, set `"claudeCode.environmentVariables": []` in its Remote Settings.
- **A second account to share with** is a second Claude config folder logged
  into a *different* Claude account (profiles on the same account count as
  one): **Claude Status: Add Claude Account…** makes one (`~/.claude-NAME`)
  and opens Claude's login for it; you sign in with the other account. Its
  settings can be linked to another account's: `settings.json` (your status
  line too, so its plan usage bars work), `CLAUDE.md`, keybindings and your
  own skills, agents and commands; the login, MCP servers, plugins and the
  skills claude.ai syncs stay per account. Its `claude-NAME` command
  (`~/.local/bin`) runs Claude on it in any terminal. Logging out isn't done while chats run on the account, and only a
  `~/.claude-NAME` folder that no chat, `~/.claude` or VS Code's Claude uses
  can be removed. On an SSH host it's the same, over ssh with nothing
  installed there: the login runs there in a terminal (you paste the code
  Claude gives you), and a removed account goes to the host's Trash.
  Sharing needs your Claude folders and
  `~/.local/share` on one filesystem (hard links can't cross disks or
  partitions); it checks first and says so otherwise.

## Development

```sh
npm ci
npm run build          # dist/: the extension and the webview
npm run check          # type-check both
npm test               # unit tests, and the backend on made-up homes
npm run watch          # rebuild on change; F5 in VS Code starts a test window
node esbuild.mjs --harness   # dev pages: look at the view with demo data in a browser
```

`vendor/` is the widget's backend and Talpa (the pet's drawing, moods and
actions, shared with the widget), copied by `scripts/sync-widget.sh` from a
widget commit; change them there.

To release: raise `version` in `package.json`, add a `## <version>` section to
`CHANGELOG.md`, commit, then push a tag. The Release workflow checks, tests and
packages it and publishes the `.vsix` with those notes:

```sh
git tag v<version> && git push origin main v<version>
```

This repository is kept publishable: `scripts/check_public.py` refuses
commits with tokens, keys, IP addresses, emails, home folders or anything
naming the machine it runs on or its SSH hosts. Enable it once per clone:

```sh
git config core.hooksPath .githooks
```

## Credits

- Backend: the [Claude Status widget](https://github.com/wzaielamri/claude-status) for KDE Plasma and GNOME.

Not affiliated with Anthropic. Claude and Claude Code are Anthropic's.

## Author

Made by [Wadhah Zai El Amri](https://wzaielamri.github.io/): more of my
projects and work are on my website.

## License

[MIT](LICENSE) © 2026 Wadhah Zai El Amri
