# Claude Status: a KDE Plasma widget for Claude Code

A panel widget for Plasma 6 that shows at a glance whether your Claude Code sessions are **working**, **waiting for your input** or **idle**, plus your **plan usage** (5-hour / 7-day limits), each session's **context window**, and **token totals**.

> This is an independent personal project. It is **not affiliated with or endorsed by Anthropic**, and the code was written **with AI assistance**. Details are in [About this project](#about-this-project).

- **Panel icon:** a ✳ spark in the state colour
  - orange: a session needs input; a red badge counts how many
  - blue, spinning: working
  - green: idle (Claude finished and waits for your next message)
  - grey: nothing running
  - Next to it, the 5-hour usage of the account you're using right now.
- **Popup:** a dashboard of all your Claude work. At the top, the big Clawd on a little stage sums it all up (see *Clawd, the pet* below); below, one section per Claude account. Each section has:
  - its chats' pets, one per chat, so you see what's done and what's still working (see *Pets for your chats* below)
  - usage bars with reset countdowns
  - tokens for today and the last 7 days (hover for the breakdown)
  - every running session (terminal, background job or VS Code) with its state and how long it's been in it, project, model and context fill, plus what a waiting session asks for (e.g. "approve Write: …")
  - background jobs that finished in the last 24 hours, with their result (configurable)
  - **recent chats** (folded; click to unfold): the account's latest other chats with their folder and when you last used them. Click one to reopen it in a terminal (`claude --resume`). A finished session you removed from the list shows up there too; older copies of a chat aren't repeated.
- **SSH hosts:** the server button at the top lists the hosts in your `~/.ssh/config`. Tick one and its Claude accounts, sessions, usage and recent chats show up below your own, like a second machine on the same dashboard:
  - its sessions count in the panel icon and at the top of the popup, and send the same "needs input" / "finished" notifications (with the host's name)
  - click a session or recent chat to bring it up. A background session or finished chat opens in a local terminal running `ssh -t <host> claude attach …` / `claude --resume …` in the right folder. A chat running in **VS Code connected to the host (Remote-SSH)** shows in that VS Code window (the one titled `[SSH: <host>]`), which opens on the host if it isn't yet. A chat running in a terminal here (`ssh <host>`, then `claude`) brings up that terminal tab.
  - **+** starts a new chat there; ■ and － stop or hide its background sessions
  - checked every 30 seconds (configurable) while it's ticked; the ✕ next to the host's name hides it again
  - needs key-based login (the widget can't type a password: load your key with `ssh-add`, or log in once in a terminal to accept a new host key) and `python3` on the host. Nothing is installed there: the status script is sent over the connection each time. It keeps its caches in the host's `~/.cache/claude-widget`, like here. One connection per host stays open for a few minutes, so checks through a jump host are quick.
- **Subagents:** a session that started subagents shows an **agents 2/3** tag (finished/total), outlined while any are running. Click it for a tree of its agents, nested agents included: each one's type, task, running/done/stopped, and what it is doing right now (e.g. `Bash: pytest -x`, `Edit: parser.py`, or the first line of its final answer).
- **Shared chats:** a chat shared across profiles (one transcript hard-linked into each profile, as a `/share-chat` tool does) gets a **⇄ shared** tag. Its tooltip lists the profiles and, when known, which one has it open. It's listed once, under the account it runs on, or, once it's finished, the account it was used on last. Every other account it's shared with shows a short line pointing there (e.g. *⇄ my chat · on personal · Working*), and clicking it jumps to the chat.
  - When Claude forks a shared chat into a chat of its own (e.g. when a background session takes it over), that copy gets a **⇄ shared copy** tag: its new messages are only on that account. If the shared chat continued in the copy, the copy is listed instead of the chat, and the other accounts point to it (*copy on personal*).
  - A shared chat's tokens appear in every profile it's shared with, since a transcript doesn't record which account paid; the token tooltip shows how much that is.
  - **Share from the widget** (if you use [`shared-chats.sh`](#shared-chat-tool), i.e. `~/.claude-shared/profile-tools/shared-chats.sh` exists): hover a finished chat (or a recent one) and press its share button:
    - **Continue on work** (or *Share and continue on work*, if it isn't shared yet) shares the chat if needed and opens it on that account in a terminal (`claude --resume`). It's the quick way on when one account hits its limit.
    - **Share with all accounts** only shares it.
    - **Keep only on personal…** makes a shared chat a normal chat of one account again; the others lose it from their lists. It asks first.
    - The widget only calls the tool (`share` / `unshare`), so the tool's own checks apply. Nothing is done to a chat while a session has it open, because a shared chat can be open in one session at a time: finish or stop it first.
- **New chat:** the **+** next to each account's name opens a menu of that account's recent project folders (and your home folder). Pick one and a terminal opens with a new Claude chat on that account, in that folder. It's a normal chat even when background sessions exist (plain `claude` would open the agent view then).
- **Pets for your chats:** every chat in the sessions list (here or on an SSH host) gets a Clawd of its own, on a small stage right under its account's name (personal, work, each SSH host's accounts), up to 5 per account (configurable; 0 = only the big Clawd). The stage slides open when the account has a chat in the list and away when it has none.
  - he wears the chat's name on a tag in the chat's own color, and the chat's row in the list gets a bar in the same color, so you see which pet is which at a glance. Colors differ across the whole popup while there are colors left (8).
  - he acts the chat out: works (typing, testing, reviewing, …) and juggles while its subagents run; shows a warning sign and hops when it needs you; rests while the chat is idle, ready for your next message; sleeps once it's done (after a little celebration), so you know there are results to look at; looks sad if it failed; points out a nearly full context window
  - **click him to go to his chat**; drag him for fun
  - he stays the same pet, with the same color and on the same spot, as long as the chat is in the list, even while it finishes and runs again; a new chat's pet lines up on the right. When the chat leaves the list (you hide it, so it moves to recent chats, or its terminal closes, or it gets old), he waves and walks off. With more chats than pets, the chats that need you get one first, then working, idle and finished ones; "+N" counts the chats without a pet.
- **Clawd, the pet:** the big Clawd (93 poses) lives on a stage at the top of the popup and in notifications, stands for all your sessions together, and behaves like a small pet:
  - **the dashboard at a glance:** his stage glows orange (gently pulsing) when a chat needs you, blue while chats work, green when it's your turn (Claude finished its reply), and turns into a starry night once everything is done. Beside him, a headline says what matters most (*2 chats need you*, *1 chat working*, *Your turn in 3 chats*, …; click *needs you* to go to that chat) above the sessions per state
  - he takes the news that isn't about one chat's pet: limit resets, and chats that have no pet of their own
  - **mirrors your sessions:** asleep when nothing runs; while Claude works he types, thinks, codes, tests, reviews, debugs, builds, deploys or talks to his rubber duck (switching every few seconds), and juggles, conducts or pair-programs while subagents run; when a session needs you he waves, rings, holds up a letter or prays; a working chat whose context window is almost full and that has no pet of its own makes him point it out
  - **limits:** at ≥ 90% of the 5-hour limit he's mind-blown, overheated or low on battery now and then; at 100% he shows a **429**; when a limit resets he recharges
  - **celebrates and commiserates:** a finished session gets a celebration (trophy, shipping, rocket, *200 OK*, clapping, …), a failed one a facepalm or tears, a stopped one a shrug, always with a speech bubble saying which one
  - **has a life of his own when idle:** walks and runs around, looks about, hops, smiles, takes coffee breaks, dances, yawns, and has hobbies: reading, music, gaming, yoga, painting, gardening, cooking, magic, stargazing, … He dresses for the season and greets you on Christmas, New Year, Halloween and Valentine's Day. When work starts again he wakes up yawning
  - **reacts to you:** turns towards your mouse and follows it; click to pet him (hearts; he blushes after a few), click quickly to tickle him; double-click to make him dance; drag to pick him up (held too long, he gets scared) and let go to drop him (he gets dizzy, or sick from high up); poking him while he sleeps makes him grumpy, then angry
  - notification icons show him with a warning sign (needs input), a trophy (finished) or a rain cloud (failed)
  - animates only while the popup is open; turn him off in the widget settings
- **Click a session's name to jump to it:**
  - terminal sessions: Konsole switches to the tab running it (or tmux to its pane) and the window comes to the front
  - VS Code sessions: the conversation opens in the VS Code window of that project
  - background jobs: the terminal already showing the job comes to the front; if there is none, a new Konsole window runs `claude attach <id>` in the job's folder
  - a finished shared chat listed under an account that has no session or background job for it (you last used it there in a terminal) opens in a new terminal with `claude --resume <id>`
  - a finished background job is reopened the same way as a running one. If it ran in a folder Claude doesn't trust yet (always so for your home folder: Claude never saves that answer there), Claude first asks whether you trust it, with "No, exit" preselected. The terminal says so before the question comes up.
- **Remove finished sessions from the list:** hover a finished session and press its **－** button. This only hides it in the widget; nothing is deleted, and you can still resume the conversation with Claude. It comes back by itself if the session runs again, and right-click → *Show removed sessions again* brings all of them back. The widget deliberately has no real "delete": that can't be undone, and Claude's `claude rm` also removes a background session's worktree.
- **Stop a background session:** hover its row and press ■. It asks first. Stopping runs `claude stop <id>`: the conversation is kept and `claude attach <id>` resumes it. But a session that is *working* is interrupted mid-step, and anything it started in the background stops too. Terminal sessions have no stop button; close their window instead. The widget never deletes sessions.
- **Notifications:**
  - when a session needs you: a permission prompt, a question, or a background job that stopped to ask you something. The notification is closed again once you answer.
  - when a session finishes a turn that took at least 30 seconds (configurable, or off)
  - click a notification (or its **Open session** button) to jump to that session
  - **with a sound** (on by default): one for "needs input", one for "finished" and one for "failed". In the widget settings you pick each from your sound theme (Message, Success, Bell, Attention, …), a sound file of your own, or none, and set the volume. ▶ plays it. Sounds go through PipeWire's notification stream (so the system's notification volume applies) and stay quiet while Do Not Disturb is on. When several sessions change at once, only the most urgent sound plays.
- **Mouse:** middle-click refreshes. Right-click has *Open Usage Page on claude.ai*.

## Install

```bash
./install.sh            # installs the plasmoid, shows a diff, then adds a snippet to your status line
```
Then right-click the panel → **Add Widgets…** → search **Claude Status** and drag it onto the panel (or the desktop).

`./install.sh` again upgrades it. If the panel keeps the old version, run `systemctl --user restart plasma-plasmashell`. `./install.sh --uninstall` removes the widget and the snippet.

## How it works

```
~/.claude/statusline-command.sh ──(snippet)──▶ ~/.cache/claude-widget/statusline/<cfg>/<session>.json
<cfg>/sessions/<pid>.json ─┐
<cfg>/jobs/<id>/state.json ┼─▶ package/contents/code/claude_status.py ──JSON──▶ QML widget (polls every 2 s)
<cfg>/projects/**/*.jsonl ─┘
```

- **Profiles** are found automatically: every `~/.claude` and `~/.claude-*` dir (what `CLAUDE_CONFIG_DIR` points to). A link such as `~/.claude` → `~/.claude-personal` counts as that profile; everything is keyed by the real folder, so switching the link to another profile never mixes their data. A session started through the link follows it when it's switched, so it's listed under the profile the link points to now. Profiles logged into the same account (`oauthAccount.accountUuid` in their `.claude.json`) are merged into one section, because they share plan limits. A profile is named by the `.profile-name` file in its folder, else by its folder name; a lone `~/.claude` is named after the account's display name instead of "default". Only the account id, plan type and display name are read; credentials are never touched.
- **Session state** comes from Claude Code's own session registry (`sessions/<pid>.json`: `status` `busy` / `shell` / `waiting` / `idle`, with `waitingFor`). Background jobs add their record in `jobs/<id>/state.json`, which also covers jobs whose process has already exited. Dead and reused PIDs are filtered out using the process start time. The rules follow Claude Code's own:
  - Background jobs use the same rules as `claude agents --all`. The live status wins over the job record; a job needs you only when its `tempo` is `blocked` or the session itself waits.
  - Interactive sessions follow Claude Code's terminal status. A dialog you opened yourself (`/model`, `/effort`, …) doesn't count as "needs input", and a background shell still running after the turn counts as working.
- **Plan limits and context** come from the JSON that Claude Code passes to the status line (`rate_limits`, `context_window`). `statusline-snippet.sh` saves a copy of it per session, under the profile's real folder name. Older copies filed under a link's name (`statusline/.claude/`) only count if they're newer than the link: before it was last switched, that name meant another profile.
- **Token totals** are read incrementally from transcripts (at most once a minute, cached per profile folder in `~/.cache/claude-widget/tokens-*.json`). Lines are de-duplicated per message. Linked folders are followed, so a shared chat's subagents count too.
- **Subagents** are read from `projects/<project>/<session>/subagents/agent-*.jsonl` and their `.meta.json`. An agent is done when its transcript ends with its final answer, running otherwise, and stopped if its session ended first. Only transcripts that changed since the last check are read again.
- **Shared chats** are transcripts with the same file (inode) in several profiles. Each row knows which conversation it shows:
  - A background session that took a chat over gets an id of its own. It counts as that chat when its own transcript holds no messages; the job's `resumeSessionId`, or a `continued-in` record in the chat, names it.
  - A transcript that starts with a shared chat's history (its first entry is in the shared transcript) is a copy of that chat. A session that started a new conversation is a separate chat.
  - Claude's own rule decides whether a chat moved on: its last `continued-in` record comes after its last finished reply.
  - Where a finished shared chat was used last comes from the status-line snapshots, the prompt history (`history.jsonl`) and shared-chats.sh's lock file. What the widget learns from big transcripts is kept in `~/.cache/claude-widget/links.json`, so they are only read where they grew.
- **Jumping to a session** (`package/contents/code/jump.py`) finds the window through the session's process tree. Konsole tabs are switched over Konsole's DBus API. A window is raised with a short KWin script loaded over DBus, which is how one app can activate another's window on Plasma Wayland. VS Code conversations open through the Claude extension's `vscode://anthropic.claude-code/open?session=…` link. Background jobs are attached under the same config-folder name as the running background service, because Claude keys that service by the folder's *name*. With linked profiles (e.g. `~/.claude` → `~/.claude-personal`) a client using the other name would wait forever at "Starting background service…".
- **SSH hosts** (`package/contents/code/remote.py`): `ssh -o BatchMode=yes … <host> python3 -I - --remote`, with `claude_status.py` on stdin. In `--remote` mode every row also carries the shell command that opens it on the host (found with the host's own `claude` path and `CLAUDE_CONFIG_DIR` rules), and the JSON follows a marker line, so login scripts that print a banner can't break it. Connections are shared through `ControlMaster` sockets in `~/.cache/claude-widget/ssh`.
- **Privacy:** everything the widget stores lives in `~/.cache/claude-widget`, which only your user can read (mode 0700). The backend's JSON output replaces account ids with a one-way hash.

Run the backend on its own:
```bash
python3 -I package/contents/code/claude_status.py --pretty
```

## Limits

- `sessions/*.json` is an internal Claude Code format and may change in a future version. The backend fails soft and the widget shows the error instead of breaking.
- Plan usage only refreshes when a session of that account gets a reply, because that's when the status line runs. The popup shows how old the numbers are and treats windows whose reset time has passed as reset.
- Token totals cover each machine's transcripts only (an SSH host shows its own). Plan limits are account-wide.
- An SSH host's terminal sessions can't be brought to your screen; the widget shows them and opens background sessions and finished chats in a new terminal. The host needs Python 3.7 or newer.
- Jumping is built for KDE Plasma (KWin) with Konsole. In other terminals the window is raised but the right tab isn't selected. A background job shown in Claude's agent view (plain `claude`) is recognised by its tab title.

## Development

```bash
python3 -m unittest discover -s tests      # backend + snippet tests
kpackagetool6 -t Plasma/Applet -u package  # reinstall after QML changes
QT_FORCE_STDERR_LOGGING=1 plasmawindowed org.wzaielamri.claudestatus   # run in a window, QML errors on stderr
tools/render_popup.sh /tmp/popup.png       # screenshot of the repo's popup (offscreen), QML warnings in /tmp/popup.log
```

The tests build Claude Code's files (sessions, background jobs, transcripts, shared-chat links, a switched `~/.claude` link) in temporary folders. `tests/test_remote.py` drives the SSH code through a stand-in `ssh` that runs the command locally.

## About this project

I built this widget to make my own day-to-day work with Claude Code easier. With several sessions running across different profiles, I wanted one glance at the panel to tell me which sessions need me and how much of my plan I've used. I'm sharing it in case it's useful to others.

### Not affiliated with Anthropic

This is an independent, personal project. It is not affiliated with, endorsed by, sponsored by or otherwise connected to Anthropic, PBC, and building it does not make me a representative of Anthropic in any way. "Claude" and "Claude Code" are trademarks of Anthropic, PBC; they appear here only to describe what the widget works with.

The widget only reads files that Claude Code writes on your own computer. It does not call any Anthropic API, and it sends no data anywhere. The *Open Usage Page on claude.ai* menu entry just opens that page in your browser.

### AI-assisted development

The code, tests and documentation in this repository were largely generated with an AI coding assistant (Claude Code, using Anthropic's Claude models) under my direction. I defined what the widget should do, made the design decisions, and reviewed and tested the result on my own machine (Fedora, KDE Plasma 6).

As with any open-source code, please read it before you run it. It is provided under the MIT License, "as is", without warranty of any kind.

## Shared-chat tool

The widget shows chats shared across profiles by any tool that hard-links one transcript into several profiles. Its share buttons call `~/.claude-shared/profile-tools/shared-chats.sh share <id>` / `unshare <id> <profile>`, which is the author's own tool and not part of this repository; without it the buttons don't appear.

## Credits

The Clawd pet artwork (`package/contents/pets/`) comes from [clawd-pet](https://github.com/abderrahimghazali/clawd-pet) by Abderrahim Ghazali, used under the MIT License (see the `LICENSE` and `README.md` in that folder). `tools/bake_pet_origins.py` adapts the SVGs for Qt's renderer: it bakes each CSS pivot (`transform-origin`) into wrapper groups, because otherwise rotating limbs fly off the character. [Claude Usage Widget](https://github.com/projectvelox/claude-usage-widget) inspired how Clawd reacts to usage and clicks.

## License

[MIT](LICENSE) © 2026 Wadhah Zai El Amri
