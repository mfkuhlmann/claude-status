<div align="center">

# Claude Status

**A KDE Plasma 6 widget and GNOME Shell extension that keeps all your Claude Code sessions in view.**

Which chats are working, which need you and how much of your plan is left,
across all your accounts and SSH hosts, one click away on your panel.
On GNOME (Ubuntu 26.04 and newer) it lives in the top bar: see [On GNOME](#on-gnome).

[![Tests](https://github.com/wzaielamri/claude-status/actions/workflows/tests.yml/badge.svg)](https://github.com/wzaielamri/claude-status/actions/workflows/tests.yml)
[![KDE Plasma 6](https://img.shields.io/badge/KDE_Plasma-6-1d99f3?logo=kde&logoColor=white)](https://kde.org/plasma-desktop/)
[![GNOME Shell 49+](https://img.shields.io/badge/GNOME_Shell-49%2B-4a86cf?logo=gnome&logoColor=white)](https://extensions.gnome.org/)
[![Python 3.7+](https://img.shields.io/badge/python-3.7%2B-3776ab?logo=python&logoColor=white)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

<img src="docs/screenshots/popup-light.png" alt="The Claude Status popup: a big Clawd says one chat needs you; below, each account shows its chats as pets, plan usage bars, token totals and its sessions" width="48%">&nbsp;<img src="docs/screenshots/popup-dark.png" alt="The same popup in a dark theme" width="48%">

</div>

> [!NOTE]
> An independent project: not affiliated with or endorsed by Anthropic, and written with AI assistance. See [About this project](#about-this-project).

## Features

**See everything at a glance**

- **Panel icon:** a ✳ spark in the state color: orange with a red badge counting the sessions that need you, blue and spinning while Claude works, green when it's your turn, grey when nothing runs. The 5-hour usage of the account you're using sits next to it.
- **The big Clawd** at the top of the popup sums it all up. His stage glows orange (gently pulsing) when a chat needs you, blue while chats work, green when it's your turn, and turns into a starry night once everything is done. His headline says what matters most, e.g. *2 chats need you*: click it to go there.
- **One section per Claude account** (profiles logged into the same account are merged): plan usage with reset countdowns, tokens for today and the last 7 days, and every session (terminal, background job or VS Code) with its state, how long it's been in it, project folder, model and reasoning effort (e.g. *Opus 5.5 · max*) and context fill, plus what a waiting session asks for (e.g. *approve Bash: rm -rf build/*).
- **What each chat is doing, without switching to it:** under each session, a line says what it's doing right now (`▸ Bash: npm test`), what it needs, or what Claude said last, with a bar for its task list (*2/5*). Click the line to read your last prompt, Claude's reply and the chat's tasks.
- **Where your usage is heading:** each usage bar shows where you'd be when the window resets at your pace (the faded part), a mark where an even pace would be by now, and a warning when you'd run out first (*At this pace: full in 1h 20m, 40m before it resets*).
- **A pet for every chat:** each account's chats walk on a little stage under its name, wearing the chat's name and color. The chat's row in the list gets a bar in the same color. A pet acts its chat out: it works (types, tests, reviews, juggles subagents), holds up a warning sign when the chat needs you, relaxes when it's your turn, sleeps once the chat is done and looks sad if it failed. Click a pet to open its chat.

<p align="center"><img src="docs/screenshots/pets.gif" alt="Pets reacting: a chat finishes and its pet celebrates, a new chat's pet walks in, and the big Clawd charges up when a usage limit resets" width="500"></p>

**Act on your sessions**

- **Jump to a session** by clicking its name: Konsole switches to the right tab (or tmux to its pane), VS Code opens the conversation, and a background job is attached in a terminal. Finished chats reopen with `claude --resume`.
- **Start a new chat** with the **+** next to an account: pick one of its recent project folders, or **Choose folder…** to pick any folder in the folder dialog, and a terminal opens with Claude in it. Or switch the **Terminal | VS Code** switch at the top of the list to VS Code, and the chat starts in VS Code's Claude panel instead (the switch is kept for next time). Without the `claude` command, **Terminal** is greyed out; without VS Code, **VS Code** is (the tooltip says why).
- **Stop or interrupt** any chat that's running, from the list (■; it asks first and keeps the conversation), or **hide** a finished one (－; nothing is deleted).
- **See what a chat changed:** **±3** next to a chat counts the files it changed. Click it to compare them in VS Code, side by side: each file as it was before the chat first changed it, and as it is now. The box under a chat also compares only its last turn.
- **A shortcut to the chat that needs you:** give the widget a key (its settings → Keyboard Shortcuts). It brings up the chat that has waited longest for you, then one that finished while you weren't looking; press it again for the next one. With none, it opens the popup.
- **Recent chats** per account, to reopen older conversations: in a terminal or in VS Code, with the same switch at the top of the list.
- **Notifications** when a session needs you or finishes a long turn, with sounds from your sound theme (quiet during Do Not Disturb). Click one to jump to the session. **While you're away** (the screen locked for 5 minutes or more) they wait: when you're back, one notification sums up what finished, failed or needs you.

**Beyond this computer**

- **SSH hosts:** pick hosts from your `~/.ssh/config`, and their Claude accounts, sessions, usage and recent chats join the dashboard. Nothing is installed on the host.
- **Several profiles and accounts:** every `~/.claude` and `~/.claude-*` config folder is found automatically, including linked ones such as `~/.claude` → `~/.claude-work`.
- **Share chats between accounts:** continue a finished chat on another account, e.g. when one hits its limit (see [Sharing chats](#sharing-chats)). A shared chat is listed once, where it runs, with a pointer from the other accounts.

<p align="center"><img src="docs/screenshots/ssh-host.png" alt="An SSH host in the popup: its Claude account with pets, plan usage, sessions and recent chats" width="500"></p>

<details>
<summary><b>All the details</b></summary>

- **SSH hosts:** the server button at the top lists the hosts in your `~/.ssh/config` (with `Include`s). Tick one and its Claude accounts show up below your own, like a second machine on the same dashboard:
  - its sessions count in the panel icon and at the top of the popup, and send the same "needs input" / "finished" notifications (with the host's name)
  - click a session or recent chat to bring it up. A background session or finished chat opens in a local terminal running `ssh -t <host> claude attach …` / `claude --resume …` in the right folder. A chat running in **VS Code connected to the host (Remote-SSH)** shows in that VS Code window (the one titled `[SSH: <host>]`), which opens on the host if it isn't open yet. A chat running in a terminal here (`ssh <host>`, then `claude`) brings up that terminal tab.
  - **+** starts a new chat there; ■ and － stop its background sessions and idle chats, or hide finished ones
  - checked every 30 seconds (configurable) while it's ticked; the ✕ next to the host's name hides it again
  - needs key-based login (the widget can't type a password: load your key with `ssh-add`, or log in once in a terminal to accept a new host key) and `python3` on the host. Nothing is installed there: the status script is sent over the connection each time. It keeps its caches in the host's `~/.cache/claude-widget`, like here. One connection per host stays open for a few minutes, so checks through a jump host are quick.
- **Subagents:** a session that started subagents shows an **agents 2/3** tag (finished/total), outlined while any are running. Click it for a tree of its agents, nested agents included: each one's type and the model it runs on (e.g. *Explore · Haiku 4.5*), its task, running/done/stopped, and what it is doing right now (e.g. `Bash: pytest -x`, `Edit: parser.py`, or the first line of its final answer).
- **Shared chats:** a chat shared across profiles (one transcript hard-linked into each profile) gets a **⇄ shared** tag. Its tooltip lists the profiles and, when known, which one has it open. It's listed once, under the account it runs on, or, once it's finished, the account it was used on last. Every other account it's shared with shows a short line pointing there (e.g. *⇄ my chat · on personal · Working*), and clicking it jumps to the chat.
  - When Claude forks a shared chat into a chat of its own (e.g. when a background session takes it over), that copy gets a **⇄ shared copy** tag: its new messages are only on that account. If the shared chat continued in the copy, the copy is listed instead of the chat, and the other accounts point to it (*copy on personal*).
  - A shared chat's tokens appear in every profile it's shared with, since a transcript doesn't record which account paid; the token tooltip shows how much that is.
  - **Share from the widget:** hover a finished chat (or a recent one) and press its share button: **Continue on work** (shares it if needed and opens it there with `claude --resume`, the quick way on when one account hits its limit), **Share with all accounts**, or **Keep only on personal…** (asks first). Nothing is done to a chat while a session has it open. See [Sharing chats](#sharing-chats).
- **Pets:**
  - a chat's pet stays the same pet, with the same color and on the same spot, as long as the chat is in the list, even while it finishes and runs again; a new chat's pet lines up on the right. When the chat leaves the list (you hide it, its terminal closes, or it gets old), the pet waves and walks off. Up to 5 pets per account (configurable); with more chats, the ones that need you get a pet first, and "+N" counts the rest.
  - the big Clawd (93 poses) takes the news that isn't about one chat's pet, such as limit resets. While Claude works he types, thinks, tests, reviews, debugs or talks to his rubber duck; at ≥ 90% of the 5-hour limit he's mind-blown or overheated now and then, and at 100% he shows a **429**. When things are quiet he wanders, takes coffee breaks and has hobbies (reading, music, gaming, gardening, stargazing, …), dresses for the season and greets you on holidays.
  - click Clawd to pet him (click quickly to tickle him), double-click to make him dance, drag to pick him up and drop him (he gets dizzy from high up)
  - notification icons show him with a warning sign (needs input), a trophy (finished) or a rain cloud (failed)
  - they only move while the popup is open
- **Jumping, in detail:** terminal sessions: Konsole switches to the tab running it (or tmux to its pane) and the window comes to the front. VS Code sessions: the conversation opens in the VS Code window of that project. Background jobs: the terminal already showing the job comes to the front; if there is none, a new terminal runs `claude attach <id>` in the job's folder. A finished background job is reopened the same way; if it ran in a folder Claude doesn't trust yet (always so for your home folder), Claude first asks whether you trust it, with "No, exit" preselected, and the terminal says so before the question comes up.
- **New chats in VS Code:** VS Code opens the folder (or brings up the window that has it), then the Claude extension opens a new conversation there. Which account it runs on is up to VS Code, not the widget: its `claudeCode.environmentVariables` setting (`CLAUDE_CONFIG_DIR`), else VS Code's own environment, else `~/.claude`. So **VS Code** in the switch only works on that account; on the others it's greyed out and says which account VS Code is on, and their new chats open in a terminal. For an SSH host, VS Code connects to it (Remote-SSH) and the chat starts once it's connected. The same switch sits at the top of an account's **Recent chats**: in VS Code, a recent chat reopens in the folder it last ran in, in a new tab of the Claude panel.
- **Terminal or VS Code, whichever is there:** **Terminal** is greyed out where the `claude` command isn't found (on PATH, in `~/.local/bin`, npm's or nvm's folders, or on your login shell's PATH, which is asked at most once an hour), and chats open in VS Code there. **VS Code** is greyed out where VS Code isn't installed. On an SSH host, Terminal depends on the host's `claude`.
- **Hiding finished sessions** only hides them in the widget; nothing is deleted, and you can still resume the conversation. A hidden session comes back by itself if it runs again, and right-click → *Show removed sessions again* brings all of them back. The widget deliberately has no real "delete": that can't be undone, and Claude's `claude rm` also removes a background session's worktree.
- **Stopping** a background session runs `claude stop <id>`: the conversation is kept and `claude attach <id>` resumes it. A session that is *working* is interrupted mid-step, and anything it started in the background stops too.
  - A **chat in a terminal** can be stopped whatever it's doing: Claude gets the signal it gets when its terminal closes and shuts down cleanly. A working one's current step is cut off, and a waiting one quits without your answer. Its terminal stays open, and the chat moves to **Recent chats**, from where it reopens.
  - A **chat in VS Code's Claude tab** is stopped the way the tab's own stop button does it: the tab says *Interrupted*, keeps the chat and goes on with your next message (which starts Claude again, a second or two). Claude gets SIGINT there, its clean exit; SIGTERM would put an error in the tab.
  - A **working chat in tmux** can be **interrupted** instead: Ctrl+C in its pane, as if you pressed it. Like the stop button in VS Code, that stops the turn and its subagents, background ones too, and keeps the chat open (a draft you typed stays). Esc would leave background subagents running. Other terminals take no keys from outside, so their chats can only be stopped.
  - The confirmation says which of these happens. The widget looks again before stopping: an idle chat that got back to work since you asked isn't touched. Stopping ends every subagent of the chat, since they run inside its Claude; commands it leaves behind are ended too, and a Claude that hasn't quit after 10 seconds is killed.
- **What a chat changed:** Claude backs up a file before a chat first changes it (in `file-history/`, the backups its undo uses). The comparison puts each file as it was then next to the file now; with the [Claude Status extension for VS Code](https://github.com/wzaielamri/claude-status-vscode) 1.8 or newer, all of them open in one view, else each in a tab of its own (at most 25). *Last turn* compares with the files as they were when you sent your last prompt. A file the chat edited with no backup on record (e.g. in a subagent) is compared with git's last commit. Changes made through shell commands (`sed`, scripts) aren't counted, since Claude doesn't back those up.
- **Usage forecast:** your pace is the last hour's in the 5-hour window, and the window's so far in the weekly ones (or while there's no hour on record yet). The widget notes each window's usage as it changes, in `~/.cache/claude-widget/usage.json`.
- **While you're away:** the widget asks every 10 s whether the screen is locked. Once it has been for 5 minutes (a setting), chats that finish or need you don't notify one by one; when you unlock, one notification (if notifications are on) and a card at the top of the popup say what happened since you left. Clicking the notification goes to the chat that needs you.
- **Notifications:** when a session needs you (a permission prompt, a question, or a background job that stopped to ask you something; closed again once you answer), and when a session finishes a turn that took at least 30 seconds (configurable, or off). Sounds: one each for "needs input", "finished" and "failed", from your sound theme, a sound file of your own, or none. They go through PipeWire's notification stream, so the system's notification volume applies. When several sessions change at once, only the most urgent sound plays.

</details>

## Requirements

- **KDE Plasma 6** (6.0 or newer). Plasma 5 isn't supported: Kubuntu 24.04 LTS, for example, ships Plasma 5.27.
- **Claude Code** (the `claude` command), signed in. The widget finds it on PATH, in `~/.local/bin` (Claude's installer) and npm's, bun's, Volta's, pnpm's or nvm's folders, or else on the PATH your login shell sets up.
- **python3**, 3.7 or newer. Every Plasma 6 distribution already has it.
- **jq**, for the status-line snippet that supplies plan usage and context.
- Optional:
  - **Konsole**, so that clicking a session switches to its tab. With other terminals the window is raised. New terminals open in your default terminal (System Settings → Default Applications).
  - **Qt 6.10 or newer with the QtQuick.VectorImage module**, for animated pets. Without it the pets are still images that walk, hop and react all the same.
  - **PipeWire** (`pw-play`) or PulseAudio (`paplay`) for sounds.
  - **kdialog** (usually installed with KDE) for *Choose folder…*; `zenity` works too.
  - **gdbus** (`libglib2.0-bin` on Debian and Kubuntu, `glib2-tools` on openSUSE; Fedora and Arch have it) for switching Konsole tabs and raising windows, and **xdg-open** (`xdg-utils`) for opening chats in VS Code.
  - tmux; VS Code with the Claude Code extension.

| Distribution | Extra packages |
|---|---|
| Fedora KDE | `sudo dnf install jq` (animated pets work out of the box) |
| Kubuntu, KDE neon, Debian | `sudo apt install jq`, and for animated pets on Qt 6.10+ (e.g. Kubuntu 26.04): `sudo apt install qml6-module-qtquick-vectorimage` |
| Arch Linux | `sudo pacman -S jq` |
| openSUSE | `sudo zypper install jq` |

**Tested on:** Fedora 44 (Plasma 6.7, Qt 6.11), in daily use; Kubuntu 26.04 LTS (Plasma 6.6, Qt 6.10) and Kubuntu 25.10 (Plasma 6.4, Qt 6.9): install, uninstall, the popup and the test suite.

## Installation

```bash
git clone https://github.com/wzaielamri/claude-status.git
cd claude-status
./install.sh
```

Then right-click your panel → **Add Widgets…**, search for **Claude Status** and drag it onto the panel (or onto the desktop).

Each [release](https://github.com/wzaielamri/claude-status/releases) also has the widget as a `.plasmoid` file and the GNOME extension as a `.zip`, for installing without the repository (its notes say how). `./install.sh` is still the easiest way: it also adds the status-line snippet.

`install.sh` does two things:

1. It installs the widget for your user (into `~/.local/share/plasma/plasmoids/`) with `kpackagetool6`.
2. It adds a small snippet to the status-line script of each Claude profile (the script that `statusLine` in `~/.claude*/settings.json` runs). It shows the change and asks first (`--yes` skips the question), and keeps a backup next to the script. The snippet is plain POSIX sh, so it works in sh, bash and zsh scripts; running `./install.sh` again replaces an older copy. The snippet saves the status-line data (plan limits, context) for the widget. What your status line shows stays the same.

<details>
<summary><b>No status line yet?</b></summary>

Plan usage and context come from Claude Code's status line. If you don't have one yet, this minimal one shows the model and the folder:

```bash
cat > ~/.claude/statusline.sh <<'EOF'
#!/bin/bash
input=$(cat)
jq -r '"\(.model.display_name) · \(.workspace.current_dir | split("/") | last)"' <<<"$input"
EOF
chmod +x ~/.claude/statusline.sh
```

Add this entry to `~/.claude/settings.json` (and likewise for other profiles such as `~/.claude-work`):

```json
"statusLine": { "type": "command", "command": "~/.claude/statusline.sh" }
```

Then run `./install.sh` again to add the snippet.

</details>

<details>
<summary><b>Manual installation</b></summary>

```bash
kpackagetool6 -t Plasma/Applet -i package
```

Then paste `statusline-snippet.sh` into your status-line script, right after the line that reads its input (`input=$(cat)`).

</details>

## On GNOME

The same dashboard as a GNOME Shell extension: the ✳ in the top bar, the popup with your accounts, sessions, plan usage, SSH hosts, notifications and pets. It uses the same scripts as the Plasma widget.

**Requirements:** GNOME Shell 49 or 50 (Ubuntu 26.04 LTS has 50), python3, jq (`sudo apt install jq`); zenity for *Choose folder…* (Ubuntu has it).

**Install:** `./install.sh` (it picks GNOME by itself in a GNOME session; `--gnome` to be sure), then log out and back in: GNOME loads new extension code only at login. Settings: the *Settings* entry at the bottom of the popup. Update the same way (`git pull`, `./install.sh`, log out and in); `./install.sh --uninstall` removes it.

**What's different from Plasma:**

- Jumping to a session brings its window to the front. Konsole and tmux also switch to the right tab or pane; in Ptyxis and GNOME Terminal the window comes up, but not the tab. New chats open in your default terminal (`xdg-terminal-exec`, else Ptyxis, GNOME Terminal or Console).
- The pets are still poses: they walk, hop, breathe and react, but don't move their arms. You can't pick them up.
- The menu at the bottom of the popup replaces the right-click menu; a middle click on the ✳ refreshes.
- Working sessions are blue rather than your accent color (Ubuntu's orange would look like "needs you").
- Sounds come from your GNOME sound theme and stay quiet with Do Not Disturb.
- The shortcut to the chat that needs you is **Super+Shift+C** (change it in the settings).
- GNOME turns extensions off while the screen is locked, so nothing notifies then; when you're back after 5 minutes or more, the summary comes as soon as the chats have been checked.

**Tested** in a headless GNOME Shell 50.1 on Ubuntu 26.04 (`tools/gnome/shell.sh`: the popup, jumping, notifications, settings, pets, install and uninstall), not yet on a physical Ubuntu desktop.

**Troubleshooting:** messages go to GNOME's log: `journalctl --user -f -o cat /usr/bin/gnome-shell`. If clicking a session doesn't bring it up, check that the extension is enabled (`gnome-extensions info claude-status@wzaielamri.github.io`): it's the extension that raises windows.

## Usage

| Where | What it does |
|---|---|
| Panel icon | Left-click opens the popup, middle-click refreshes. Right-click: *Refresh*, *Show removed sessions again*, *Open Usage Page on claude.ai*, and the settings. |
| The big Clawd | Click his headline (*… needs you*) to go to that chat. Click him to pet him, double-click to make him dance, drag him around. |
| A session's name | Jumps to the session: its terminal tab, its VS Code window, or a terminal attached to the background job. |
| The line under a session | Unfolds your last prompt, Claude's reply, the chat's tasks, and buttons that compare what it changed (all of it, or its last turn). |
| **±3** next to a session | Compares the files the chat changed in VS Code. |
| The widget's keyboard shortcut | Goes to the chat that needs you, else opens the popup (set the key in the settings, on the Keyboard Shortcuts page). |
| Hovering a session | ■ stops or interrupts a chat (it asks first), － hides a finished one, and the share button shares a chat with your other accounts. |
| A chat's pet | Opens its chat. |
| **+** next to an account | Lists the account's recent folders and **Choose folder…** (an SSH host's: its home folder instead). Click one for a new chat there: in a terminal, or in VS Code (the switch at the top of the list). |
| *Recent chats* | Unfolds the account's older conversations; click one to reopen it, in a terminal or in VS Code (the switch at the top of the list). |
| Server button at the top | Picks the SSH hosts to show. |

## Sharing chats

With two or more Claude accounts on this computer (say `~/.claude` and `~/.claude-work`), a finished chat can move between them. Hover it (or one of your recent chats), press its share button and pick:

- **Continue on work:** shares the chat with that account and reopens it there with `claude --resume`. The quick way on when one account hits its limit.
- **Share with all accounts:** the chat shows up in every account's past chats.
- **Keep only on personal…** (asks first): the chat becomes a normal chat of that account again; the others lose it.

**A second account to share with** is a second Claude config folder, logged into a *different* Claude account: profiles logged into the same account count as one, and sharing needs two. Make one with `CLAUDE_CONFIG_DIR=~/.claude-work claude` and log in there (`/login`) with the other account; an alias like `alias claude-work='CLAUDE_CONFIG_DIR=~/.claude-work claude'` keeps it handy. The widget finds every `~/.claude-*` folder by itself. For its plan usage bars, give it a status line as well: copy the `statusLine` entry from `~/.claude/settings.json` into `~/.claude-work/settings.json`, then run `./install.sh` again.

A shared chat is one transcript file hard-linked into each profile's `projects/<project>/` folder, so whichever account continues it writes to the same file and nothing is copied. Its subagent folder and undo checkpoints move to `~/.local/share/claude-status/shared-chats/<project>/`, and each profile links to them. Sharing uses no tokens and installs no hooks or settings.

- **One session at a time.** Two sessions on one chat would both write to its transcript. The widget doesn't share or unshare a chat while a session has it open, but nothing stops you from resuming it on a second account yourself: close it on one before you open it on the other.
- **The chat goes with it.** Everything in a chat is sent to whichever account continues it, work content included.
- If Claude forks a shared chat (e.g. when a background session takes it over), the fork is a chat of its own on that account, tagged **⇄ shared copy**.
- **One filesystem.** A hard link can't cross filesystems, so your Claude folders and `~/.local/share` must be on the same disk or partition (or btrfs subvolume). The widget checks first and says so otherwise, leaving everything as it was.
- Chats on SSH hosts can't be shared from here.
- To undo sharing, use **Keep only on …**. Before you delete `~/.local/share/claude-status`, keep each shared chat on one account: their subagent folders and undo checkpoints are in there.

## Settings

Right-click the widget → **Configure Claude Status…**

| Setting | Default | |
|---|---|---|
| Check every | 2000 ms | How often sessions are checked |
| …while nothing runs | 10000 ms | How often while no chat runs and the popup is closed (never more often than above; opening the popup checks at once) |
| Extra config dirs | – | Claude config folders besides `~/.claude` and `~/.claude-*` |
| Notify | both on | When a session needs input, and when it finishes a turn… |
| …if the turn took at least | 30 s | …that ran at least this long |
| While you're away | on, 5 min | Once the screen has been locked this long, one notification sums it all up when you're back |
| Sound | on, 70% | Sounds for needs input / finished / failed: from your sound theme, a file, or none |
| Keep finished background jobs | 24 h | 0 hides them right away |
| Recent chats per account | 5 | 0 hides the list |
| Check SSH hosts every | 30 s | |
| Panel | on | The 5-hour usage next to the icon |
| Keyboard shortcut | goes to the chat | Goes to the chat that needs you (else opens the popup); the key itself is set on the Keyboard Shortcuts page |
| Icon | on | Blink while a chat needs you (until you open the popup), pulse when one finishes |
| Pet | on | Clawd in the popup and in notifications |
| Chat pets per account | 5 | 0 keeps only the big Clawd |
| Popup | on | Token totals |

**The icon** shows one number, the most urgent: red for chats that need you, else green for chats that finished since you last opened the popup (turns as long as the "finished" notifications ask for). A working chat makes the spark spin, and hovering the icon lists every count.

**In the system tray (Plasma):** Claude Status can sit in the system tray as well as (or instead of) on a panel: right-click the tray's arrow → **Configure System Tray…** → **Entries** → **Claude Status**. It's off until you switch it on. *Shown when relevant* shows it while a chat runs; clicking it opens the same popup. With two Claude Status widgets, only one of them (the one running longest) sends notifications and sounds, and they share their settings: a change in one shows in the other within a few seconds, and a new one starts with what the others use.

## Updating

```bash
cd claude-status
git pull
./install.sh
```

If the panel keeps showing the old version, restart Plasma's shell: `systemctl --user restart plasma-plasmashell`.

## Uninstalling

1. Right-click the widget → **Remove Claude Status** (for each one you added).
2. In the repository folder, run:

   ```bash
   ./install.sh --uninstall
   ```

   This removes the widget and takes the snippet out of your status-line scripts (it shows the change and keeps a backup).
3. Optionally delete the widget's cache: `rm -rf ~/.cache/claude-widget`.

Apart from the chats you share, the widget never changes Claude Code's own files, so nothing else is left behind. Shared chats stay shared: use **Keep only on …** first if you want them back as normal chats (see [Sharing chats](#sharing-chats)).

## Troubleshooting

- **"No plan usage yet":** plan usage comes from the status line, so it shows up after the next reply in a session of that account. If it never does, check that `jq` is installed and that the snippet is in your status-line script (`./install.sh` adds it). Saved snapshots are in `~/.cache/claude-widget/statusline/`.
- **Claude Status isn't in the widget list:** it needs Plasma 6. Check that it's installed: `kpackagetool6 -t Plasma/Applet --list | grep claude`.
- **The old version is still showing after an update:** `systemctl --user restart plasma-plasmashell`.
- **"Can't find the claude command":** the widget looks on PATH, in the usual install folders and on your login shell's PATH. If Claude is somewhere else, add its folder to PATH in `~/.profile` (not only `~/.bashrc`) and log in again.
- **Clicking a session doesn't switch to its tab:** tab switching works with Konsole and tmux. With other terminals the window is raised.
- **An SSH host refuses the login:** the widget logs in without a terminal, so it needs key-based login. Load your key with `ssh-add`, or log in once with `ssh <host>` to accept its host key. The host also needs `python3`.
- **The pets don't move their arms:** animated poses need Qt 6.10 and the QtQuick.VectorImage module (see [Requirements](#requirements)). Without them, the pets are still images.
- **Something else:** run the widget in its own window to see its messages: `plasmawindowed org.wzaielamri.claudestatus`. You can also run the status script on its own: `python3 -I package/contents/code/claude_status.py --pretty`.

Issues and ideas are welcome on the [issue tracker](https://github.com/wzaielamri/claude-status/issues).

## How it works

```
~/.claude/statusline.sh ──(snippet)──▶ ~/.cache/claude-widget/statusline/<profile>/<session>.json
<profile>/sessions/<pid>.json ─┐
<profile>/jobs/<id>/state.json ┼─▶ package/contents/code/claude_status.py ──JSON──▶ QML widget (every 2 s)
<profile>/projects/**/*.jsonl ─┘
```

<details>
<summary><b>The details</b></summary>

- **Profiles** are found automatically: every `~/.claude` and `~/.claude-*` folder (what `CLAUDE_CONFIG_DIR` points to). A link such as `~/.claude` → `~/.claude-personal` counts as that profile; everything is keyed by the real folder, so switching the link to another profile never mixes their data. A session started through the link follows it when it's switched, so it's listed under the profile the link points to now. Profiles logged into the same account (`oauthAccount.accountUuid` in their `.claude.json`) are merged into one section, because they share plan limits. A profile is named by the `.profile-name` file in its folder, else by its folder name; a lone `~/.claude` is named after the account's display name. From `.claude.json` only the account id, plan type and display name are read, plus whether you've trusted a folder (so the widget can tell you before Claude asks); credentials are never touched.
- **Session state** comes from Claude Code's own session registry (`sessions/<pid>.json`: `status` `busy` / `shell` / `waiting` / `idle`, with `waitingFor`). Background jobs add their record in `jobs/<id>/state.json`, which also covers jobs whose process has already exited. Dead and reused PIDs are filtered out using the process start time. The rules follow Claude Code's own:
  - Background jobs use the same rules as `claude agents --all`. The live status wins over the job record; a job needs you only when its `tempo` is `blocked` or the session itself waits.
  - Interactive sessions follow Claude Code's terminal status. A dialog you opened yourself (`/model`, `/effort`, …) doesn't count as "needs input", and a background shell still running after the turn counts as working.
- **Plan limits and context** come from the JSON that Claude Code passes to the status line (`rate_limits`, `context_window`). `statusline-snippet.sh` saves a copy of it per session, under the profile's real folder name. Older copies filed under a link's name only count if they're newer than the link: before it was last switched, that name meant another profile.
- **Token totals** are read incrementally from transcripts (at most once a minute, cached per profile in `~/.cache/claude-widget/tokens-*.json`). Lines are de-duplicated per message, and summed per day, so a status check adds up a few numbers instead of every message of the week. Linked folders are followed, so a shared chat's subagents count too.
- **What a chat is doing** comes from the end of its transcript: its newest step (a tool call, thinking, writing), your last prompt and Claude's reply since (markdown read as plain text). Its **tasks** are Claude's own task list, `tasks/<session>/<n>.json`. The **files it changed** come from the transcript's `file-history-delta` and `file-history-snapshot` records (each prompt's snapshot is where that turn started), plus its edit tool calls; only what was appended since the last check is read (`~/.cache/claude-widget/chats.json`).
- **Subagents** are read from `projects/<project>/<session>/subagents/agent-*.jsonl` and their `.meta.json`. An agent is done when its transcript ends with its final answer, running otherwise, and stopped if its session ended first.
- **Shared chats** are transcripts with the same file (inode) in several profiles. Each row knows which conversation it shows: a background session that took a chat over counts as that chat while its own transcript holds no messages; a transcript that starts with a shared chat's history is a copy of it. Claude's own rule decides whether a chat moved on (its last `continued-in` record comes after its last finished reply). Where a finished shared chat was used last comes from the status-line snapshots, the prompt history (`history.jsonl`) and, if you use hooks that hold a shared chat to one session, their lock file (`~/.local/state/claude-shared-chats/lock-<id>`).
- **Sharing** (`package/contents/code/sharing.py`): hard links the transcript into each profile and the store, moves the chat's `projects/<project>/<id>/` and `file-history/<id>/` folders into the store and symlinks them back. A chat shared the same way by another tool, into a store of its own, is found through its links and handled where it is.
- **Jumping to a session** (`package/contents/code/jump.py`) finds the window through the session's process tree. Konsole tabs are switched over Konsole's D-Bus API. A window is raised with a short KWin script loaded over D-Bus, which is how one app can bring another's window to the front on Plasma Wayland. VS Code conversations open through the Claude extension's `vscode://anthropic.claude-code/open?session=…` link. Background jobs are attached under the same config-folder name as the running background service, because Claude keys that service by the folder's *name*. Terminals and VS Code windows the widget opens get a systemd scope of their own (like the apps KDE starts), so restarting Plasma doesn't kill the chats running in them.
- **SSH hosts** (`package/contents/code/remote.py`): `ssh -o BatchMode=yes … <host> python3 -I - --remote`, with `claude_status.py` on stdin. In `--remote` mode every row also carries the command that opens it on the host, and the JSON follows a marker line, so login scripts that print a banner can't break it. Connections are shared through `ControlMaster` sockets in `$XDG_RUNTIME_DIR/claude-status-ssh` (else a folder of yours in `/tmp`): a short path, since a socket's may have at most 107 characters.

</details>

## Privacy

- The widget reads the files Claude Code writes, on your computer and on the SSH hosts you pick (through your own SSH login). Besides those it reads only your `~/.ssh/config` host list, the desktop settings it needs (default terminal, sound theme, Do Not Disturb) and process and window info (`/proc`, Konsole, tmux, KWin) to find where a session runs; of a Claude process's environment it keeps only `CLAUDE_CONFIG_DIR` and `HOME`. To know which account VS Code's Claude uses, it reads `CLAUDE_CONFIG_DIR` from VS Code's settings (`claudeCode.environmentVariables`) or from VS Code's environment, nothing else. It never opens credential files. When `claude` isn't on the desktop's PATH or in the usual install folders, a click on a chat runs your login shell once (`$SHELL -l -i -c env`) to read the PATH it sets up, nothing else.
- It doesn't call any Anthropic API and sends no data anywhere. *Open Usage Page on claude.ai* just opens that page in your browser.
- Everything it stores lives in `~/.cache/claude-widget`, plus shared chats' folders in `~/.local/share/claude-status/shared-chats`; only your user can read either (mode 0700). SSH connection sockets go to `$XDG_RUNTIME_DIR/claude-status-ssh`, which is cleared when you log out. Its JSON output replaces account ids with a one-way hash.
- It changes Claude Code's files only when you share a chat: it links the chat into your other profiles, or out of them again.
- To show what a chat changed, it reads Claude's backups of the chat's files (`file-history/`) and the files themselves, runs `git show HEAD:<file>` for a file with no backup, and puts copies of the earlier versions in `~/.cache/claude-widget/changes` for VS Code to show; they're removed after a day. It also reads Claude's task lists (`tasks/`), and asks the screen saver over D-Bus whether the screen is locked.

## Limitations

- `sessions/*.json` is an internal Claude Code format and may change in a future version. The backend fails soft: the widget shows the error instead of breaking.
- Plan usage only refreshes when a session of that account gets a reply, because that's when the status line runs. The popup shows how old the numbers are and treats windows whose reset time has passed as reset.
- Token totals cover each machine's own transcripts (an SSH host shows its own). Plan limits are account-wide.
- An SSH host's terminal sessions can't be brought to your screen; the widget shows them and opens background sessions and finished chats in a new terminal.
- Jumping to the right tab is built for KDE Plasma (KWin) with Konsole. In other terminals the window is raised but the tab isn't selected.

## Development

```bash
python3 -m unittest discover -s tests           # the test suite
tools/render_popup.sh /tmp/popup.png            # screenshot of the repo's popup (offscreen), QML messages in /tmp/popup.log
kpackagetool6 -t Plasma/Applet -u package       # reinstall after changes
plasmawindowed org.wzaielamri.claudestatus      # run the installed widget in a window
```

GNOME extension:

```bash
gjs -m gnome/tests/test_logic.js                # its logic (no GNOME Shell needed)
gnome/build.sh                                  # build it into gnome/build/ (zip for gnome-extensions install)
tools/gnome/shell.sh /tmp/gnome                 # run it in a headless GNOME Shell (Ubuntu 26.04, podman) with made-up data, screenshots in /tmp/gnome
tools/gnome/shell.sh /tmp/gnome tools/gnome/steps-actions.sh   # jumping, notifications, settings, turning it off and on
```

```
package/                  the widget (what install.sh installs)
├── metadata.json
└── contents/
    ├── ui/               QML: main.qml (data, actions), FullRepresentation.qml (popup), GroupSection.qml (account),
    │                     SessionRow.qml, PetStrip.qml + Pet.qml (pets), …
    ├── code/             Python: claude_status.py (status), jump.py (actions), sharing.py (shared chats), remote.py (SSH),
    │                     notify_sound.py
    ├── config/           settings schema and pages
    └── pets/             Clawd artwork (clawd-pet, MIT)
gnome/                    the GNOME Shell extension: extension/ (GJS: indicator.js, logic.js, ui/, prefs.js), build.sh, tests/
statusline-snippet.sh     the snippet install.sh adds to your status line
tests/                    unit tests: they build Claude Code's files in temporary folders
tools/                    render_popup.sh (offscreen screenshots), bake_pet_origins.py (pet artwork for Qt), gnome/ (headless GNOME Shell test)
```

The tests build Claude Code's files (sessions, background jobs, transcripts, shared-chat links, a switched `~/.claude` link) in temporary folders. `tests/test_remote.py` drives the SSH code through a stand-in `ssh` that runs the command locally.

**Contributing:** issues and pull requests are welcome. Please run the tests, and check QML changes with `tools/render_popup.sh`. Keep `claude_status.py` compatible with Python 3.7, because it also runs on SSH hosts (a test checks this).

## About this project

I built this widget to make my own day-to-day work with Claude Code easier. With several sessions running across different profiles and machines, I wanted one glance at the panel to tell me which sessions need me and how much of my plan I've used. I'm sharing it in case it's useful to others.

### Not affiliated with Anthropic

This is an independent, personal project. It is not affiliated with, endorsed by, sponsored by or otherwise connected to Anthropic, PBC, and building it does not make me a representative of Anthropic in any way. "Claude" and "Claude Code" are trademarks of Anthropic, PBC; they appear here only to describe what the widget works with.

The widget only reads files that Claude Code writes on your own computer, and changes them only when you share a chat between your accounts. It does not call any Anthropic API, and it sends no data anywhere. The *Open Usage Page on claude.ai* menu entry just opens that page in your browser.

### AI-assisted development

The code, tests and documentation in this repository were largely generated with an AI coding assistant (Claude Code, using Anthropic's Claude models) under my direction. I defined what the widget should do, made the design decisions, and reviewed and tested the result on my own machine (Fedora, KDE Plasma 6).

As with any open-source code, please read it before you run it. It is provided under the MIT License, "as is", without warranty of any kind.

## Credits

The Clawd pet artwork (`package/contents/pets/`) comes from [clawd-pet](https://github.com/abderrahimghazali/clawd-pet) by Abderrahim Ghazali, used under the MIT License (see the `LICENSE` and `README.md` in that folder). `tools/bake_pet_origins.py` adapts the SVGs for Qt's renderer: it bakes each CSS pivot (`transform-origin`) into wrapper groups, because otherwise rotating limbs fly off the character. [Claude Usage Widget](https://github.com/projectvelox/claude-usage-widget) inspired how Clawd reacts to usage and clicks.

## Author

Made by Wadhah Zai El Amri: more of my projects and work are on [my website](https://wzaielamri.github.io).

## License

[MIT](LICENSE) © 2026 Wadhah Zai El Amri
