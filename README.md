# Claude Status for VS Code

Every Claude Code chat you have running, on this computer and on your SSH
hosts, in one VS Code view: which ones need you, which are working, plan
usage, subagents, recent chats, and Clawd, the animated pet who acts it all
out. The VS Code companion of the
[Claude Status widget](https://github.com/wzaielamri/claude-status)
for KDE Plasma and GNOME; all of them use the same backend.

<!-- Screenshots show demo data only (Claude Status: Toggle Demo Data, or dev/harness.html), never real chats. -->
<p>
  <img src="docs/screenshots/view-dark.png" alt="The Claude Status view in a dark theme: Clawd waves above &quot;1 chat needs you&quot;, an account with three chats, its pets and plan usage bars, and an SSH host" width="300">
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
  says what it's on right now (*▸ Bash: npm test*), what it needs, or the
  first line of Claude's last reply. Click it for your last prompt, Claude's
  whole reply, the chat's task list and its changed files. A chat with a task
  list gets a **2/4** tag that fills up as tasks get done.
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
  computer's.
- **Notifications** (and a sound) when a chat needs you or finishes a long turn.
- **The status bar**: how many chats need you, the 5-hour usage, and with
  two or more accounts which one VS Code's Claude runs on (**Claude: work**):
  click it to switch.
- **Clawd**: one pet for the whole dashboard, one per chat, each acting out
  its chat. Click a pet to open its chat, drag one around, double-click the
  big one.
- **Shared chats**: with two or more Claude accounts on this computer, a
  finished chat's share button continues it on another account (say, when
  one hits its limit), shares it with all of them, or keeps it on one again
  (see "Good to know" for adding a second account).

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
folders or any other, or as a Claude Code chat tab in this window. The chat
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
| `claudeStatus.pollInterval` | `2000` | ms between checks of this computer while the view is open (10 s when hidden) |
| `claudeStatus.extraConfigDirs` | `[]` | More Claude Code config folders |
| `claudeStatus.openIn` | `vscode` | `system`: open chats in your desktop's terminal app instead |
| `claudeStatus.reopenIn` | `terminal` | `claudeCode`: reopen recent chats in a Claude Code tab (the switch above them) |
| `claudeStatus.notifyWaiting` / `notifyDone` | `true` | Notifications; turn them off here if the Plasma or GNOME widget notifies too |
| `claudeStatus.notifyDoneMinSeconds` | `30` | Shortest turn that gets a "finished" notification |
| `claudeStatus.awayDigest` / `awayMinutes` | `true` / `5` | The "while you were away" summary, after this many minutes without using VS Code (with notifications off, only its card in the view) |
| `claudeStatus.notifySound`, `soundVolume`, `soundWaiting`, `soundDone`, `soundFailed` | | Sounds (sound-theme names or files) |
| `claudeStatus.showPet` / `chatPets` | `true` / `5` | Clawd, and pets per account |
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
`history.jsonl` (recent folders),
the account name and plan from `.claude.json`, and the status-line copies in
`~/.cache/claude-widget/statusline`. It writes only to
`~/.cache/claude-widget` (caches, the list of chats you removed, copies of
the files a comparison shows, kept for a day) and, if you
ask for it, the status-line change above and the links of the chats you share
(see below).

## Good to know

- Every VS Code window runs its own copy; only the window you used last
  shows notifications and plays sounds. "Away" means no VS Code window was in
  use, so switching between windows isn't an absence.
- The Plasma widget and the GNOME extension open a chat's changes in this
  extension's changes view (through its `vscode://wzaielamri.claude-status/changes`
  link); without it they open one diff per file.
- With the Plasma widget or the GNOME extension running too, both notify:
  turn notifications off in one of them.
- On KDE Plasma, a chat running in a terminal outside VS Code is brought to
  the front the way the widget does it (Konsole tab, window); on GNOME too,
  while the widget's Claude Status GNOME Shell extension is on. Elsewhere the
  view says where it runs. On GNOME, sounds use GNOME's sound theme.
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
  your desktop's with `claudeStatus.openIn` = `system`. Chats on SSH hosts
  aren't shared from here.
- **Switching VS Code's Claude** (click **Claude: …** in the status bar, or
  run **Claude Status: Use Account for VS Code's Claude…**) sets
  `CLAUDE_CONFIG_DIR` in VS Code's `claudeCode.environmentVariables` and
  reloads the window; other windows offer to reload. Plain `claude` in a
  terminal isn't affected (it keeps whatever account it uses). Remote-SSH windows read that VS Code setting too: on a host without the
  folder, set `"claudeCode.environmentVariables": []` in its Remote Settings.
- **A second account to share with** is a second Claude config folder logged
  into a *different* Claude account (profiles on the same account count as
  one): run `CLAUDE_CONFIG_DIR=~/.claude-work claude` once and log in there
  with the other account. Sharing needs your Claude folders and
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

`vendor/` is the widget's backend and pet art, copied by
`scripts/sync-widget.sh` from a widget commit; change them there.

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

- Clawd pet art: [clawd-pet](https://github.com/abderrahimghazali/clawd-pet),
  MIT © Abderrahim Ghazali (`vendor/pets/LICENSE`).
- Backend: the [Claude Status widget](https://github.com/wzaielamri/claude-status) for KDE Plasma and GNOME.

Not affiliated with Anthropic. Claude and Claude Code are Anthropic's.

## Author

Made by [Wadhah Zai El Amri](https://wzaielamri.github.io/): more of my
projects and work are on my website.

## License

[MIT](LICENSE) © 2026 Wadhah Zai El Amri
