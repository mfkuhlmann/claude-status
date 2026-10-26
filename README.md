<div align="center">

# Claude Status

**A KDE Plasma 6 widget and GNOME Shell extension that keeps all your Claude Code sessions in view.**

Which chats are working, which need you and how much of your plan is left,
across all your accounts and SSH hosts, one click away on your panel.
On GNOME (Ubuntu 26.04 and newer) it lives in the top bar: see [On GNOME](#on-gnome).
In VS Code, [Claude Status for VS Code](https://github.com/wzaielamri/claude-status-vscode) shows the same in a view of its own.

[![Tests](https://github.com/wzaielamri/claude-status/actions/workflows/tests.yml/badge.svg)](https://github.com/wzaielamri/claude-status/actions/workflows/tests.yml)
[![KDE Plasma 6](https://img.shields.io/badge/KDE_Plasma-6-1d99f3?logo=kde&logoColor=white)](https://kde.org/plasma-desktop/)
[![GNOME Shell 49+](https://img.shields.io/badge/GNOME_Shell-49%2B-4a86cf?logo=gnome&logoColor=white)](https://extensions.gnome.org/)
[![Python 3.7+](https://img.shields.io/badge/python-3.7%2B-3776ab?logo=python&logoColor=white)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

<img src="docs/screenshots/popup-light.png" alt="The Claude Status popup: the big Talpa says one chat needs you; below, each account shows its chats as pets, plan usage bars, token totals and its sessions" width="48%">&nbsp;<img src="docs/screenshots/popup-dark.png" alt="The same popup in a dark theme" width="48%">

</div>

## TL;DR

- **What:** every Claude Code chat you have running, in your panel: which need you, which are working, which are done, with the plan usage of each account. All your accounts, and your SSH hosts too.
- **Why:** one click takes you to the chat that needs you (its Konsole tab, tmux pane, VS Code tab or background job), notifications tell you when one needs you or finishes, and the usage bars show where your pace leads before you hit a limit.
- **Also:** start chats (with a task, in the background, or once a limit resets), find any chat, read and edit plans and memories, move a chat to another account, and a pet that acts out each chat.
- **Install:** `git clone https://github.com/wzaielamri/claude-status.git && cd claude-status && ./install.sh`, then add **Claude Status** to your panel. Needs KDE Plasma 6 (or GNOME Shell 49+), Claude Code, python3 and jq.
- **In VS Code:** [Claude Status for VS Code](https://github.com/wzaielamri/claude-status-vscode).

> [!NOTE]
> An independent project: not affiliated with or endorsed by Anthropic, and written with AI assistance. See [About this project](#about-this-project).

## Features

**See everything at a glance**

- **Panel icon:** Talpa peeking up through the panel's edge, in the state color: orange and popping up, with a red badge counting the sessions that need you; blue and glancing around while Claude works; green and smiling when it's your turn; grey and asleep when nothing runs. The 5-hour usage of your default account sits next to it (see [Accounts](#accounts)).
- **The big Talpa** at the top of the popup sums it all up. Its stage glows orange (gently pulsing) when a chat needs you, blue while chats work, green when it's your turn, and turns into a starry night once everything is done. Its headline says what matters most, e.g. *2 chats need you*: click it to go there. Under it, a line says what the working chats do right now (*fix parser ▸ Edit: parser.py +12 −3*), each new step as it comes, taking turns between the chats at work: click it for that chat's pane.
- **Changes show the moment they happen:** the widget watches Claude's session files, so a chat that starts, ends, starts working, asks for something or finishes its turn shows at once (also when you answer or interrupt it in its terminal), with its pet, notification and sound. **Live mode** (a setting) shows each step of each chat as it happens too: every tool call in its row, its pane and the line under the big Talpa. Between changes the widget checks far less often than before, so it costs less while your chats sit idle. (Not on GNOME yet.)
- **One section per Claude account** (profiles logged into the same account are merged; the default account comes first): plan usage with reset countdowns, tokens for today and the last 7 days, and every session (terminal, background job or VS Code) with its state, how long it's been in it, project folder, model and reasoning effort (e.g. *Opus 5.5 · max*) and context fill, plus what a waiting session asks for (e.g. *approve Bash: rm -rf build/*).
- **What each chat is doing, without switching to it:** under each session, a line says what it's doing right now (`▸ Bash: npm test`), what it needs, Claude's recap of it (when you come back to a chat after a while, Claude Code writes one: *You asked …; Next step: …*) or what Claude said last, with a bar for its task list (*2/5*). Click the line to read your last prompt, Claude's reply and the chat's tasks. A chat in plan mode, auto mode, accept edits or don't ask says so next to its name; one that bypasses permissions says so in red.
- **Chats a usage limit stopped** say so in red, with when the limit resets (a background session too, which Claude marks as blocked); their pet runs out of steam, and the notification says the chat hit the usage limit, not that it finished. Once it has reset, a notification says which chats can go on. Meanwhile **Continue on personal** moves the chat to another account with room left (see [Sharing chats](#sharing-chats)), or **Go on at 10:41** has it go on by itself once the limit resets: in the background, in the permission mode it had, telling Claude the limit has reset (an idle Claude that still has it open quits first). **Keep going** beside it does that after every later limit too, until the chat is done; a chat at work gets the same from its ↻ button. In **Recent chats**, click a chat's **limit** tag (once) or **↻** (keep going) for the same.
- **Where your usage is heading:** each usage bar shows where you'd be when the window resets at your pace (the faded part), a mark where an even pace would be by now, and a warning when you'd run out first (*At this pace: full in 1h 20m, 40m before it resets*).
- **Your last days in numbers:** click an account's token line for its last 14 days: tokens per day as bars, chats and prompts, your busiest folders and the models used. Each chat's unfolded box ends with its own recap (*3 prompts · worked 54m · 313 tool calls (Bash 265, Read 25) · 100.6M tokens · $37.06 at API prices*).
- **Your days with Claude:** the popup's **Recap** tab shows a day, your last 7 days or everything since your first chat (**Day | Week | Overall**; step back a day or a week at a time). Claude Code deletes chats after 30 days, but the Recap keeps their numbers, so **Overall** keeps growing (a setting turns that off, and **Delete Saved History…** starts it again). For the 7 days: how long you were at it and how long Claude worked, against the week before; a timeline with a row per day that shows when you were at it, when Claude worked (darker where several chats worked at once) and when it waited for your answer (point at a day to see what went on then); red marks where a usage limit stopped a chat; click a day for its chats, and a project for its chats; how full your plan's windows are now and how they filled up; a trend line of the last five weeks under each number; what Claude did (tool calls, commands, edits with the files and lines they changed, subagents, web searches, compactions); the projects and chats it worked on most; how many tokens it used and what the same work would cost at Claude's API prices, by model, with what the cache saved, the turns that cost most and what coming back to chats whose cache had expired cost; and what would use less of your plan: the tips of Claude Code's own `/usage` (*Start fresh when you switch tasks*, *Save max effort for hard tasks*, *Compact before you step away*, …), each with the share of the week's usage it touches and a command to copy. For all your accounts or one, in US dollars or your currency. It's read from the chats on this computer and the SSH hosts shown, so it uses no tokens, and only while the tab is open (the first time takes a few seconds; after that only what's new is read).
- **The permissions you gave, in one place:** the popup's **Permissions** tab lists everything that lets chats go without asking you, here and on the SSH hosts shown: rules, modes and loosened checks in your settings, your administrator's and every folder's `.claude` settings, approved MCP servers, and the folders you trusted. **Revoke…** changes that one entry in its file (on the host for a host's). Under it, the permission prompts you answered in the last 7 days, with the rules that would have let the most of them through (**Allow…** writes one, **Undo** takes it back; a setting leaves them out). Read from your settings and the transcripts, so it uses no tokens.
- **A pet for every chat:** Talpa lives in a burrow, and each account's chats get one on a little stage under its name, in the same order as the list (the chats that need you first, the others in the order they started), wearing the chat's name and a calm version of its color. The chat's row in the list gets a bar in that color. A pet acts its chat out, half out of its burrow: it works (types, thinks, hunts bugs, checks tests, juggles subagents), pops up waving or holding up a sign when the chat needs you, plays when it's your turn, sleeps once the chat is done and looks sad if it failed. The lamp on its head glows in the chat's state color. Click a pet to go to its chat (its terminal or VS Code tab).

<p align="center"><img src="docs/screenshots/pets.gif" alt="Pets reacting: a chat finishes and its pet celebrates, a new chat's pet digs up out of the ground, and the big Talpa cheers when a usage limit resets" width="500"></p>

**Act on your sessions**

- **Chat with any chat from the panel:** click a chat and it opens beside the popup: the conversation as it goes, drawn the way Claude's terminal draws it: a dot before each reply and tool call, Claude's replies rendered (headings, lists, code blocks with a **Copy** link, tables), each tool call on one line with what came of it under it (*● Bash(pytest) ⎿ 3 passed*, the dot green or red; click it for what it ran and got), updating while it works. **A−** / **A+** (or Ctrl+wheel) set its text size. Below it, a box to reply (Enter sends, Shift+Enter starts a new line, **Ctrl+V** pastes a picture, shown under the box): **Send**, or **Send when this turn ends** (the widget keeps it and sends it once the turn is over). Your message goes the way the chat can take it: typed into its tmux pane; into the input of its VS Code tab (press Enter there); or, for a background session or a chat that isn't open, the chat goes on with it in the background (`claude --bg --resume`, the same chat; a background session that's running stops first). A terminal like Konsole takes no text from outside, so there you choose: send it, and Claude in the terminal quits and the chat goes on in the background, or copy it and open its tab. An SSH host's chats work the same, over the connection the widget already has. A notification takes a reply too.
- **Answer permission prompts from the panel:** a chat that asks for a permission shows what it asks, the command or the file with its change, with **Allow once**, **Always allow** and **Deny** (with a note for Claude), in Claude's own order, in its row, its pane and its notification. That takes the opt-in setting *Answer permission prompts from the widget*: it adds a hook to each Claude profile's `settings.json` (and on the SSH hosts shown) that hands each request to the widget. Claude still asks in the chat too; whichever you answer first counts. **Always allow** saves the rule Claude suggests, as its own *don't ask again* does. Chats in tmux can be answered without the hook, with their dialog's keys.
- **Answer Claude's questions from the panel:** when Claude asks you a multiple-choice question, its row and its pane show each question with its options (choose one, or any for a question that takes several) and a field to answer in your own words, then **Send answers** or **Decline…** (with a note for Claude). Its notification has a button for each option when it's one question with one answer, then **Other…** (the pane, ready to type); with more questions, **Answer…** opens the pane. Your answers reach Claude as they would from its own dialog. This also takes *Answer permission prompts from the widget* (without it, the question shows, to answer in the chat).
- **Review what a chat did:** the pane's **Review** tab lists the files it changed with their added and removed lines, against how they were before the chat (from Claude's own backups), each with its diff and **Undo**; **Undo all** puts them all back. **Commit these files…** commits only this chat's files (yours stay as they are) with a message made from its name and Claude's recap, that you edit first. Finished chats that changed files say **to review** until you **Mark reviewed** (or until they change files again), with whether tests ran and passed after their last edit (**tests ✓**, **tests ✗**, **not tested**).
- **Jump to a session** with the window button beside it or its pet (or by clicking its name, when the setting *A click on a chat opens it beside the popup* is off): Konsole switches to the right tab (or tmux to its pane), VS Code opens the conversation, and a background job is attached in a terminal. Finished chats reopen with `claude --resume`.
- **Start a new chat** with the **+** next to an account: pick one of its recent project folders, or **Choose folder…** to pick any folder in the folder dialog, and a terminal opens with Claude in it. Or switch the **Terminal | VS Code** switch at the top of the list to VS Code, and the chat starts in VS Code's Claude panel instead (the switch is kept for next time). Without the `claude` command, **Terminal** is greyed out; without VS Code, **VS Code** is (the tooltip says why).
- **Start it with a task, also in the background:** write what Claude should do in the field above the folders, then click a folder (Ctrl+Enter: the first one). In a terminal the task is sent right away, in VS Code it's typed into the new conversation for you to send. With **In the background** no window opens: Claude's background service runs the chat (`claude --bg`), and it's listed right away, so you see when it needs you. That works in folders Claude trusts already (it can't ask there), so never in your home folder. Pick the model, the reasoning effort and the permission mode (manual, accept edits, plan, auto, …) it starts with above the folders; the next chat starts with the same. The field grows with what you write, and **Ctrl+V** pastes a picture from the clipboard (a screenshot, say) for Claude to look at, with a thumbnail under the field (it needs `wl-paste` or `xclip`). For an SSH host's chat, the box asks to copy it to the host first.
- **Wait for the usage limit, or start later:** with an account at its limit, **After the limit resets** queues a background task (in a recent folder, or **Choose folder…**): it starts by itself a minute after the limit resets. **Later:** starts it on a day and at a time you pick instead (today or in the next six days). Queued tasks (and chats that go on by themselves) are listed under their account, to start now or cancel.
- **Two chats changing the same files** get a red **⚠ same files** tag (and a notification): they can overwrite each other's work.
- **Memories:** each account lists what Claude remembers about you and your projects (**Memories**, folded), after its own `CLAUDE.md` (your instructions for every chat on it): read one, or change it (✎).
- **Find a chat:** the magnifier at the top looks through all your chats, here and on the SSH hosts shown: every one with all the words you type in its name, its folder or one of your prompts, newest first. Click one to go to it, or to reopen it. It finds project folders (click one for a new chat there), plans and memories with those words too. Each kind, and each computer, folds under its heading (the chats show at first); **Unfold all** shows everything.
- **Plans:** a chat that wrote a plan in plan mode gets a **plan ↗** tag that opens it rendered (in Okular where it's installed, else in your browser; a setting can pick VS Code's preview or your own app), and a **✎** that opens its Markdown file to change it, in your text editor (an SSH host's in VS Code, over Remote-SSH). Once you changed a plan, **↩ send to Claude** sends your changes (and notes you wrote into it) to the chat that made it, which revises the plan in plan mode. Each account lists its plans (**Plans**, folded): open one, edit it (✎), send your changes (↩), **carry it out** in a new chat (the plan is the chat's first message, with your own notes, in a terminal, VS Code or the background), go back to the chat that made it, or share it with your other accounts.
- **Stop or interrupt** any chat that's running, from the list (■; it asks first and keeps the conversation), or **hide** a finished one (－; nothing is deleted).
- **See what a chat changed:** **±3** next to a chat counts the files it changed. Click it to compare them in VS Code, side by side: each file as it was before the chat first changed it, and as it is now. The box under a chat also compares only its last turn.
- **A shortcut to the chat that needs you:** give the widget a key (its settings → Keyboard Shortcuts). It brings up the chat that has waited longest for you, then one that finished while you weren't looking; press it again for the next one. With none, it opens the popup.
- **Recent chats** per account, to reopen older conversations: in a terminal or in VS Code, with the same switch at the top of the list.
- **Notifications** when a session needs you or finishes a long turn, with sounds from your sound theme (quiet during Do Not Disturb). Click one to jump to the session. **While you're away** (the screen locked for 5 minutes or more) they wait: when you're back, one notification sums up what finished, failed or needs you. Meanwhile, chats that need you can go to your phone with KDE Connect (off until you turn it on).

**Beyond this computer**

- **SSH hosts:** pick hosts from your `~/.ssh/config`, and their Claude accounts, sessions, usage and recent chats join the dashboard. Nothing is installed on the host.
- **Several profiles and accounts:** every `~/.claude` and `~/.claude-*` config folder is found automatically, including linked ones such as `~/.claude` → `~/.claude-work`.
- **Add, log in, log out and remove accounts, and pick the default one** in the widget's settings (**Accounts**), here and on your SSH hosts, with no extra tool: a new account is a `~/.claude-NAME` folder that Claude's own login signs in, in a terminal. The default account comes first everywhere, its usage is in the panel, and VS Code's Claude and plain `claude` run on it (see [Accounts](#accounts)). An account that isn't logged in shows **Log in…** in the popup.
- **Share chats between accounts:** continue a finished chat on another account, e.g. when one hits its limit (see [Sharing chats](#sharing-chats)). A shared chat is listed once, where it runs, with a pointer from the other accounts.

<p align="center"><img src="docs/screenshots/ssh-host.png" alt="An SSH host in the popup: its Claude account with pets, plan usage, sessions and recent chats" width="500"></p>

<details>
<summary><b>All the details</b></summary>

- **SSH hosts:** the server button at the top lists the hosts in your `~/.ssh/config` (with `Include`s). Tick one and its Claude accounts show up below your own, like a second machine on the same dashboard:
  - its sessions count in the panel icon and at the top of the popup, and send the same "needs input" / "finished" notifications (with the host's name)
  - click a session or recent chat to bring it up. A background session or finished chat opens in a local terminal running `ssh -t <host> claude attach …` / `claude --resume …` in the right folder. A chat running in **VS Code connected to the host (Remote-SSH)** shows in that VS Code window (the one titled `[SSH: <host>]`), which opens on the host if it isn't open yet. A chat running in a terminal here (`ssh <host>`, then `claude`) brings up that terminal tab.
  - **+** starts a new chat there, in a terminal or in VS Code connected to it: on an account other than the one VS Code's Claude runs on there, VS Code's Claude on that host switches to it first (in the host's VS Code server settings, `~/.vscode-server/data/Machine/settings.json`) and stays on it; ■ and － stop its background sessions and idle chats, or hide finished ones
  - with two or more Claude accounts on the host, its chats can be shared between them (see [Sharing chats](#sharing-chats))
  - checked every 30 seconds (configurable) while it's ticked; the ✕ next to the host's name hides it again
  - a host that wants a password (or a passphrase, a one-time code, or a new host key confirmed) shows **Log in…** (Plasma): it opens a terminal where `ssh` itself asks you, so the widget never sees or keeps what you type. The checks then go through the connection that login opened, until 30 minutes after their last check, until you log out, or until you click **Disconnect** next to the host's name. With key-based login (your key in the agent, `ssh-add`) none of this is needed. The host needs `python3`. Nothing is installed there: the status script is sent over the connection each time. It keeps its caches in the host's `~/.cache/claude-widget`, like here. One connection per host stays open for a few minutes, so checks through a jump host are quick.
- **Subagents:** a session that started subagents shows an **agents 2/3** tag (finished/total), outlined while any are running. Click it for a tree of its agents, nested agents included: each one's type and the model it runs on (e.g. *Explore · Haiku 4.5*), its task, running/done/stopped, and what it is doing right now (e.g. `Bash: pytest -x`, `Edit: parser.py`, or the first line of its final answer).
  - **Click an agent** for what it was asked to do, its tool calls and tokens so far, its last steps and, once it's done, the report it handed back.
  - **Open the whole run** shows everything it did as a Markdown file, in the app you use for those: its task, each step (what it wrote, every tool call with its input and the start of the result, messages the chat sent it while it ran) and its report. On an SSH host it's fetched over your ssh connection. Claude Code itself has no way to open a subagent from outside (its terminal shows an agent's run only when you pick it there with the keys, and a subagent isn't a chat you can resume), so this is for reading.
- **Shared chats:** a chat shared across profiles (one transcript hard-linked into each profile) gets a **⇄ shared** tag. Its tooltip lists the profiles and, when known, which one has it open. It's listed once, under the account it runs on, or, once it's finished, the account it was used on last. Every other account it's shared with shows a short line pointing there (e.g. *⇄ my chat · on personal · Working*), and clicking it does what clicking the chat's name does.
  - When Claude forks a shared chat into a chat of its own (e.g. when a background session takes it over), that copy gets a **⇄ shared copy** tag: its new messages are only on that account. If the shared chat continued in the copy, the copy is listed instead of the chat, and the other accounts point to it (*copy on personal*).
  - A shared chat's tokens appear in every profile it's shared with, since a transcript doesn't record which account paid; the token tooltip shows how much that is.
  - **Share from the widget:** hover a finished chat (or a recent one) and press its share button: **Continue on work** (shares it if needed and opens it there with `claude --resume`, the quick way on when one account hits its limit), **Share with all accounts**, or **Keep only on personal…** (asks first). Nothing is done to a chat while a session has it open. See [Sharing chats](#sharing-chats).
- **Pets:**
  - a chat's pet stays the same pet, with the same color and on the same spot, as long as the chat is in the list, even while it finishes and runs again; a new chat's pet lines up on the right. A new chat's pet digs up out of the ground; when the chat leaves the list (you hide it, its terminal closes, or it gets old), the pet waves and digs away. Up to 5 pets per account (configurable); with more chats, the ones that need you get a pet first, and "+N" counts the rest.
  - the big Talpa takes the news that isn't about one chat's pet, such as limit resets. It picks what to do at random from what fits the moment, so it's never the same twice: while Claude works it types, thinks, gets ideas, hunts bugs with a magnifier or reads the docs; at ≥ 90% of the 5-hour limit it's mind-blown now and then, and at 100% it runs out of steam. When things are quiet it digs over to wherever your mouse is, sneezes itself out of its burrow, blows bubbles, floats off with a balloon, plays peekaboo, listens to music and greets you on holidays.
  - click Talpa to pet it (click quickly to tickle it), double-click to make it dance, drag it out of its burrow and drop it: it gets dizzy from high up, then digs back in where it landed
  - notification icons show Talpa with a sign (needs input), cheering (finished), sad (failed) or with an empty battery (a usage limit stopped the chat)
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
- **The Recap tab, in detail:** *You* is the time between your prompts (and your answers to Claude's questions and permission prompts) and Claude's replies, where that gap is under 15 minutes, plus a minute for each prompt you write: time away doesn't count. *Claude worked* adds up Claude Code's own count of each turn (its *Worked for …*), which leaves out the time a turn waited for you; a stretch of half an hour with nothing written in a turn (the computer asleep, a usage limit) doesn't count either. Chats working at the same time each count; *on the clock*, in the tooltip, counts that time once. The cost is each reply's tokens at the API list prices (cache reads and 5-minute or 1-hour cache writes at their own prices), as Claude Code prices its `/usage`; a reply in two transcripts (a forked chat) counts once. The tips use the rules, thresholds and weights of Claude Code's `/usage` (*What's contributing to your limits usage?*), and add how long Claude waited for your answers and how often a usage limit stopped you. A *cold resume* is a reply more than an hour after the chat's last one that writes 20k tokens or more of its context to the cache again (on a plan the cache keeps a chat's context an hour); its cost is what that write cost more than reading the same tokens. The plan windows are this computer's accounts', from the usage the widget saw (the 5-hour and weekly bars). A chat shared between accounts counts on each account that has it. What was read is kept in `~/.cache/claude-widget/week-2.json`.
- **Rules for permission prompts:** the Permissions tab lists the prompts you allowed in the last 7 days in a chat on this computer and the rule that would have let each through: a folder of another project to read (`permissions.additionalDirectories`), edits in the chat's own folder (`permissions.defaultMode` `acceptEdits`), a read-only command (`Bash(git log *)`, `Bash(grep *)`, …) or a site's pages (`WebFetch(domain:…)`). Only those: never a prompt Claude flagged as unsafe, one you refused, a command with pipes, redirects or `&&`, nor anything in a hidden config folder of your home (`~/.ssh`, `~/.config`, …), outside your home or in a temporary folder. **Allow…** says what it changes, and on **Allow** the rule goes into the `.claude/settings.local.json` of the folder the chats started in (Claude reads it for chats started there; git doesn't share it), keeping what's in the file; your user settings never change. **Undo** takes back a rule it added, as it was (the file goes again if the widget made it). A rule your settings have already shows *Allowed now*. The setting *Suggest rules for the permission prompts you answered* leaves the rules out, with their **Allow…** buttons: the tab then only counts the prompts.
- **Permissions you gave:** the Permissions tab lists everything that lets chats go without asking you, here and on the SSH hosts shown (each as listed there): in the settings files (each account's `settings.json`, the `.claude/settings.local.json` and `.claude/settings.json` of every folder Claude ran in, and your administrator's `/etc/claude-code/managed-settings.json`), the `permissions.allow` rules, `permissions.additionalDirectories`, a `permissions.defaultMode` that skips prompts (accept edits, auto, bypass permissions), approved `.mcp.json` servers, and the settings that loosen a check (bypass or auto mode without their warning, fetching pages without the site check, commands without asking in the sandbox, remote control, unattended remote tools, channels, chats uploaded by themselves); and in each account's `.claude.json`, the folders you trusted (those that still exist) and what was approved in them. The rules Claude saved when you answered *don't ask again* are among them. **Revoke…** says what it changes in which file; **Revoke** then changes that entry only (on a host, there), keeping the rest of the file: a rule or setting goes, a trusted folder is marked untrusted (Claude asks again before it works there). A rule the tab's **Allow** added goes as **Undo** would take it. Not changed here: a folder's `.claude/settings.json` (shared through git: *In git*) and your administrator's (*Administrator's*).
- **The Recap in your currency:** Claude's API prices are in US dollars. Pick another currency in the settings (**Recap amounts in**), and the amounts are turned at the European Central Bank's euro reference rate of the day: the Recap tab downloads it from `ecb.europa.eu` at most every 6 hours, only while it's open, and keeps the last one for when you're offline. The tab's last line says the rate and its day.
- **Usage forecast:** your pace is the last hour's in the 5-hour window, and the window's so far in the weekly ones (or while there's no hour on record yet). The widget notes each window's usage as it changes, in `~/.cache/claude-widget/usage.json`.
- **Your phone (Plasma):** with *Phone* on, once the screen has been locked as long as set, a chat that needs you is sent to your phone with `kdeconnect-cli --ping-msg` (its name, what it asks and its folder), and if you like a chat that finishes a turn too. The phone gets it while KDE Connect reaches it (the same network). Pair the phone in System Settings → KDE Connect first.
- **While you're away:** the widget asks every 10 s whether the screen is locked. Once it has been for 5 minutes (a setting), chats that finish or need you don't notify one by one; when you unlock, one notification (if notifications are on) and a card at the top of the popup say what happened since you left. Clicking the notification goes to the chat that needs you.
- **Notifications:** when a session needs you (a permission prompt, a question, or a background job that stopped to ask you something; closed again once you answer), and when a session finishes a turn that took at least 30 seconds (configurable, or off), or a usage limit (or an expired login) stops it. Sounds: one each for "needs input", "finished" and "failed", from your sound theme, a sound file of your own, or none. They go through PipeWire's notification stream, so the system's notification volume applies. When several sessions change at once, only the most urgent sound plays.

</details>

## Requirements

- **KDE Plasma 6** (6.0 or newer). Plasma 5 isn't supported: Kubuntu 24.04 LTS, for example, ships Plasma 5.27.
- **Claude Code** (the `claude` command), signed in. The widget finds it on PATH, in `~/.local/bin` (Claude's installer) and npm's, bun's, Volta's, pnpm's or nvm's folders, or else on the PATH your login shell sets up.
- **python3**, 3.7 or newer. Every Plasma 6 distribution already has it.
- **jq**, for the status-line snippet that supplies plan usage and context.
- Optional:
  - **Konsole**, so that clicking a session switches to its tab. With other terminals the window is raised. New terminals open in your default terminal (System Settings → Default Applications).
  - **PipeWire** (`pw-play`) or PulseAudio (`paplay`) for sounds.
  - **kdialog** (usually installed with KDE) for *Choose folder…*; `zenity` works too.
  - **Okular**, to read plans, memories and subagent runs rendered. Without it they open as a page in your web browser.
  - **gdbus** (`libglib2.0-bin` on Debian and Kubuntu, `glib2-tools` on openSUSE; Fedora and Arch have it) for switching Konsole tabs and raising windows, and **xdg-open** (`xdg-utils`) for opening chats in VS Code.
  - tmux; VS Code with the Claude Code extension.

| Distribution | Extra packages |
|---|---|
| Fedora KDE | `sudo dnf install jq` |
| Kubuntu, KDE neon, Debian | `sudo apt install jq` |
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

You can add it more than once, e.g. on the panel and on each screen's desktop: the copies share one check and their settings, and only one of them notifies. On the desktop, the pets rest while a window covers the whole widget.

Each [release](https://github.com/wzaielamri/claude-status/releases) also has the widget as a `.plasmoid` file and the GNOME extension as a `.zip`, for installing without the repository (its notes say how). `./install.sh` is still the easiest way: it also adds the status-line snippet.

For VS Code, [Claude Status for VS Code](https://github.com/wzaielamri/claude-status-vscode) is an extension of its own, installed from its [releases](https://github.com/wzaielamri/claude-status-vscode/releases/latest) (a `.vsix`). It brings its own copy of the backend, so it doesn't need the widget, and it works alongside it.

`install.sh` does two things:

1. It installs the widget for your user (into `~/.local/share/plasma/plasmoids/`) with `kpackagetool6`. So that the chat pane shows Talpa in the taskbar rather than Plasma's icon (it's a window of Plasma's shell), it adds a KWin window rule for it (*Claude Status: Talpa as the chat pane's icon*, in System Settings → Window Rules) and a desktop file hidden from menus (`~/.local/share/applications/org.wzaielamri.claudestatus.chat.desktop`).
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

The same dashboard as a GNOME Shell extension: Talpa in the top bar, the popup with your accounts, sessions, plan usage, SSH hosts, notifications and pets, and its **Recap** tab. It uses the same scripts as the Plasma widget.

**Requirements:** GNOME Shell 49 or 50 (Ubuntu 26.04 LTS has 50), python3, jq (`sudo apt install jq`); zenity for *Choose folder…* (Ubuntu has it).

**Install:** `./install.sh` (it picks GNOME by itself in a GNOME session; `--gnome` to be sure), then log out and back in: GNOME loads new extension code only at login. Settings: the *Settings* entry at the bottom of the popup. Update the same way (`git pull`, `./install.sh`, log out and in); `./install.sh --uninstall` removes it.

**What's different from Plasma:**

- Not on GNOME yet: chats a usage limit stopped (and their **Continue on …** and **Go on at …**), Claude's recaps and permission modes, starting a chat with a task or in the background, queued tasks, finding a chat, starred chats, plans, memories, **⚠ same files**, the chat pane (replying, answering permission prompts and Claude's questions, the review). Nor are the share button on an SSH host's chats, **Log in…** for an SSH host that wants a password, and the *Phone* setting.
- Jumping to a session brings its window to the front. Konsole and tmux also switch to the right tab or pane; in Ptyxis and GNOME Terminal the window comes up, but not the tab. New chats open in your default terminal (`xdg-terminal-exec`, else Ptyxis, GNOME Terminal or Console).
- You can't pick the pets up (they do everything else, with the same Talpa as the widget).
- The menu at the bottom of the popup replaces the right-click menu; a middle click on the icon refreshes.
- Working sessions are blue rather than your accent color (Ubuntu's orange would look like "needs you").
- Sounds come from your GNOME sound theme and stay quiet with Do Not Disturb.
- The shortcut to the chat that needs you is **Super+Shift+C** (change it in the settings).
- GNOME turns extensions off while the screen is locked, so nothing notifies then; when you're back after 5 minutes or more, the summary comes as soon as the chats have been checked.

**Tested** in a headless GNOME Shell 50.1 on Ubuntu 26.04 (`tools/gnome/shell.sh`: the popup, jumping, notifications, settings, pets, install and uninstall), not yet on a physical Ubuntu desktop.

**GNOME Shell 43 and 44** (e.g. Debian 12) load extensions the older way. On them `./install.sh` builds a converted copy (`gnome/build.sh --gnome43`, which runs `gnome/gnome43/port43.py`): the same code with GNOME 43's imports, and small stand-ins (`gnome/gnome43/compat43*.js`) for the newer APIs it uses. If an update to the extension uses an API the converter doesn't know yet, the build stops and says which one. Tested in a headless GNOME Shell 43.9 on Debian 12. GNOME Shell 45 to 48 aren't supported.

**Troubleshooting:** messages go to GNOME's log: `journalctl --user -f -o cat /usr/bin/gnome-shell`. If clicking a session doesn't bring it up, check that the extension is enabled (`gnome-extensions info claude-status@wzaielamri.github.io`): it's the extension that raises windows.

## Usage

| Where | What it does |
|---|---|
| Panel icon | Left-click opens the popup, middle-click refreshes. Right-click: *Refresh*, *Show removed sessions again*, *Open Usage Page on claude.ai*, and the settings. |
| The big Talpa | Click its headline (*… needs you*) to go to that chat. Click it to pet it, double-click to make it dance, drag it out of its burrow. |
| A session's name | Jumps to the session: its terminal tab, its VS Code window, or a terminal attached to the background job. |
| The line under a session | Unfolds your last prompt, Claude's reply, the chat's tasks, and buttons that compare what it changed (all of it, or its last turn). |
| **±3** next to a session | Compares the files the chat changed in VS Code. |
| An account's token line | Unfolds its last 14 days: tokens per day, chats, prompts, busiest folders and models. |
| The widget's keyboard shortcut | Goes to the chat that needs you, else opens the popup (set the key in the settings, on the Keyboard Shortcuts page). |
| Hovering a session | ■ stops or interrupts a chat (it asks first), － hides a finished one, and the share button shares a chat with your other accounts. |
| A chat's pet | Opens its chat. |
| **+** next to an account | A field for what Claude should do (optional), then the account's recent folders and **Choose folder…** (an SSH host's: its home folder instead). Click one for a new chat there: in a terminal, in VS Code (the switch at the top of the list) or, with a task and **In the background**, as a background session. |
| *Recent chats* | Unfolds the account's older conversations; click one to reopen it, in a terminal or in VS Code (the switch at the top of the list). |
| *Plans* | Unfolds the account's plans: click one to open it. Hovering one: ▶ carries it out in a new chat, ◀ goes back to the chat that made it, and the share button shares it with your other accounts. |
| **plan ↗** next to a session | Opens the plan that chat wrote, to read. |
| **✎** next to it, or in a plan's row | Opens the plan's Markdown file to change it (your text editor; VS Code if the settings open plans there). |
| **↩ send to Claude** next to a session | You changed its plan: sends your changes to the chat, which revises the plan. |
| *Memories* | Unfolds the account's `CLAUDE.md` and what Claude remembers: click one to read it, ✎ to change it. |
| **Continue on …** under a session | A usage limit stopped it: continues it on that account, which has room left. |
| **Go on at …** under a session | A usage limit stopped it: it goes on by itself in the background once the limit resets (click again to cancel). In *Recent chats*, its **limit** tag does the same. |
| **☆** next to a session, recent chat or plan | Stars it: the account lists it under *Recent chats → ★ Starred* or *Plans → ★ Starred*, however old it is. **★** unstars it. |
| **Keep going** under a session | The same, and again after every later limit, until it's done (in *Recent chats*: **↻**). Click **↻ keeps going** to stop that. |
| A queued task under an account | Starts it now, or cancels it. |
| **⚠ same files** next to a session | Goes to the other chat that changes the same files. |
| Magnifier at the top | Finds a chat by the words in its name, folder or your prompts, and project folders, plans and memories with those words. |
| Server button at the top | Picks the SSH hosts to show. |
| **Log in…** at an account | An account that isn't logged in (a new one, or one you logged out of): a terminal opens with Claude's own login. |

## Sharing chats

With two or more Claude accounts on this computer (say `~/.claude` and `~/.claude-work`), a finished chat can move between them. Hover it (or one of your recent chats), press its share button and pick:

- **Continue on work:** shares the chat with that account and reopens it there with `claude --resume`. The quick way on when one account hits its limit.
- **Share with all accounts:** the chat shows up in every account's past chats.
- **Keep only on personal…** (asks first): the chat becomes a normal chat of that account again; the others lose it.

A chat a usage limit stopped gets **Continue on …** right under it, for the account with the most room left in that limit: the chat is shared with that account and reopens there in a terminal. If an idle Claude still has it open here, that one quits first (in a terminal as with ■, a background session with `claude stop`); a chat in VS Code's Claude tab, close it there first.

A chat's plan goes with it: sharing a chat also shares the plan it wrote, so it goes on with its plan on the other account. A plan can be shared on its own too (its share button under **Plans**): it's one file on each account, so a change shows on all of them; **Keep only on …** takes it off the others.

**A second account to share with** is a second Claude config folder, logged into a *different* Claude account: profiles logged into the same account count as one, and sharing needs two. Add one in the widget's settings, **Accounts** → **Add an account** (see [Accounts](#accounts)), and log in with the other account. By hand: `CLAUDE_CONFIG_DIR=~/.claude-work claude`, log in there (`/login`), and for its plan usage bars copy the `statusLine` entry from `~/.claude/settings.json` into `~/.claude-work/settings.json`, then run `./install.sh` again. The widget finds every `~/.claude-*` folder by itself.

A shared chat is one transcript file hard-linked into each profile's `projects/<project>/` folder, so whichever account continues it writes to the same file and nothing is copied. Its subagent folder and undo checkpoints move to `~/.local/share/claude-status/shared-chats/<project>/`, and each profile links to them. Sharing uses no tokens and installs no hooks or settings.

- **One session at a time.** Two sessions on one chat would both write to its transcript. The widget doesn't share or unshare a chat while a session has it open, but nothing stops you from resuming it on a second account yourself: close it on one before you open it on the other.
- **The chat goes with it.** Everything in a chat is sent to whichever account continues it, work content included.
- If Claude forks a shared chat (e.g. when a background session takes it over), the fork is a chat of its own on that account, tagged **⇄ shared copy**.
- **One filesystem.** A hard link can't cross filesystems, so your Claude folders and `~/.local/share` must be on the same disk or partition (or btrfs subvolume). The widget checks first and says so otherwise, leaving everything as it was.
- **On an SSH host** with two or more accounts, the share button works the same, between that host's accounts: **Continue on …** opens the chat on the other account in a local terminal over ssh (`ssh -t <host> claude --resume …`). The sharing script is sent over the connection like the status script, so nothing is installed there, and the chat's folders go to the host's `~/.local/share/claude-status/shared-chats`. A chat can't move between this computer and a host.
- To undo sharing, use **Keep only on …**. Before you delete `~/.local/share/claude-status`, keep each shared chat on one account: their subagent folders and undo checkpoints are in there.

## Settings

Right-click the widget → **Configure Claude Status…**

| Setting | Default | |
|---|---|---|
| While a chat works, check every | 2000 ms | How often a working chat's line (what it's doing) is brought up to date; with live mode its steps show as they happen, and the widget checks every 6 s at most often |
| While no chat works, check every | 20000 ms | For what changes without a chat doing anything (plan usage, times); never more often than above. A chat that starts, ends, starts working, asks for something or finishes its turn shows at once either way |
| Extra config dirs | – | Claude config folders besides `~/.claude` and `~/.claude-*` |
| Chats | click opens the pane | A click on a chat opens it beside the popup (off: in its terminal or VS Code tab) |
| Answer permission prompts from the widget | off | The hook that lets rows, the pane and notifications answer permission prompts and Claude's questions (see above); changes Claude's settings at once |
| Live mode | off | A hook that notes each step of each chat as it happens (Claude doesn't wait for it), so rows, the pane and the line under the big Talpa follow every tool call; changes Claude's settings at once |
| Notify | both on | When a session needs input, and when it finishes a turn… |
| …if the turn took at least | 30 s | …that ran at least this long |
| While you're away | on, 5 min | Once the screen has been locked this long, one notification sums it all up when you're back |
| Phone | off | Meanwhile, send chats that need you (and, if you like, ones that finish) to your phone with KDE Connect: every paired phone that's reachable, or the one you pick; *Send a test* tries it |
| Sound | on, 70% | Sounds for needs input / finished / failed: from your sound theme, a file, or none |
| Keep finished background jobs | 24 h | 0 hides them right away |
| Recent chats per account | 5 | 0 hides the list |
| Check SSH hosts every | 30 s | |
| Plan usage on SSH hosts | once per account | An account on this computer and a host (or on two hosts) shows its plan usage where it's listed first, with the newest numbers of them all; or on every host, or on none |
| Panel | on | The default account's 5-hour usage next to the icon |
| Keyboard shortcut | goes to the chat | Goes to the chat that needs you (else opens the popup); the key itself is set on the Keyboard Shortcuts page |
| Icon | on | Blink while a chat needs you (until you open the popup), pulse when one finishes |
| Pet | on | Talpa in the popup and in notifications |
| Open plans and runs in | Okular if installed, else your browser | Plans and subagent runs (Markdown): in Okular, your browser (a page the widget makes), VS Code's Markdown preview (with the Claude Status extension for VS Code 1.13 or newer), or your app for Markdown files |
| Chat pets per account | 5 | 0 keeps only the big Talpa |
| Popup | on | Token totals |
| Recap amounts in | US dollars | The Recap tab's amounts: US dollars (Claude's API prices), or another currency at the European Central Bank's rate of the day |

## Accounts

The **Accounts** page of the settings (on GNOME, the *Accounts* tab of its settings) lists the Claude accounts on this computer, or with **On:** those of an SSH host you picked in the popup: each one's folder, whom it's logged in as (Claude's own `claude auth status` says), whether it's the default, whether plain `claude` or VS Code's Claude runs on it, and its running chats. It works with one account or many, with `~/.claude` as a folder or as a link to one of them, with or without VS Code:

- **Add an account:** a name, e.g. `work`, makes `~/.claude-work` (with a `.profile-name` file holding its name), then opens a terminal with Claude's own login (`claude auth login`): Claude opens your browser, you sign in with the other account, and Claude keeps the login in that folder. The account is in the popup right away, with **Log in…** until you're logged in.
  - **Settings shared with** an account you pick: its `settings.json` (your status line too, so the plan usage bars work at once), `CLAUDE.md`, `keybindings.json`, and your own skills, agents, commands and output styles one by one, are linked into the new folder. A change on one account is a change on both. The links point at the real files, never through `~/.claude` (which may be switched to another account). The login, history, MCP servers, plugins and the skills claude.ai syncs for an account (`skills/synced`) stay per account. Or *Claude's defaults*: a fresh folder.
  - **A `claude-work` command** (on unless you untick it): `~/.local/bin/claude-work` runs Claude on the account in any terminal, in bash, zsh or fish. An existing program of that name is never replaced. Where `~/.claude` links to the account, it runs Claude under that name, as terminals do, since Claude keys its background service by the folder's name.
- **Log in…** for an account that isn't logged in; **Log out…** (asks first) is `claude auth logout`: Claude revokes the login and deletes it, and the account's chats and history stay. Not while chats run on it: they'd lose the login.
- **Remove…** (asks first) logs out, then moves the folder to the Trash, with its chats, history and settings: restore it from there if you change your mind. Its `claude-NAME` command goes too. Only for `~/.claude-NAME` folders that no chat, `~/.claude` (a link to it) or VS Code's Claude uses. Chats shared with your other accounts stay on them.
- **Make Default:** the default account is listed first in the popup (and in the VS Code extension), marked **default** where a machine has two or more accounts, its 5-hour usage goes next to the panel icon, and both VS Code's Claude and plain `claude` run on it. **Make Default** points them there: VS Code's Claude through its `claudeCode.environmentVariables` setting (only that entry of VS Code's settings file changes; its comments and the rest stay), plain `claude` by pointing the `~/.claude` link at the account. Where `~/.claude` is a folder, it's never turned into a link: plain `claude` stays on it, and `claude-NAME` runs the others. A link is only re-pointed, never made (also where there's no `~/.claude`): without `CLAUDE_CONFIG_DIR` set, plain `claude` reads its account settings from `~/.claude.json`, whatever the link says, so a `~/.claude` link of your own needs `export CLAUDE_CONFIG_DIR="$HOME/.claude"` in your shell (profile tools that make the link set it). Without VS Code and a `~/.claude` link there's nothing to switch, and **Make Default** doesn't show. The panel icon's right-click menu has the accounts too, under **Default Account**, to switch without opening the settings. Which account is the default: VS Code's Claude's where VS Code is installed (what the VS Code extension's status bar shows), else plain `claude`'s. When the two differ (say you switched VS Code's Claude by hand), the page says so, and **Make Default** on the default lines plain `claude` up with it.
  - **Not while it would cut a chat off:** a chat working in VS Code's Claude (VS Code's account changes, and its window reloads), or any Claude running through the name `~/.claude` (a chat in a terminal, VS Code or the background, or Claude's background service: pointed elsewhere, it would go on on the other account). Close those, or let them finish, then try again. Chats started on an account's own folder (`claude-work`, the **+** in the popup) aren't affected.
- **On an SSH host** (**On:** at the top), all of this works the same, on the host's own accounts: over ssh, with nothing installed there (`accounts.py` goes over the connection like the status script). Logging in opens a terminal here, where Claude's login runs on the host: open the address it shows in your browser and paste the code you get back. Its default account is the one its VS Code server's Claude uses (that server's settings), else plain `claude`'s there, and it's marked **default** in the host's part of the popup. **Make Default** there changes that server's setting (only that entry; the file's comments stay) and the host's `~/.claude` link, with the same checks, made on the host; removing an account puts it into the host's own Trash.

The widget never sees a login: you sign in on Claude's own pages, and Claude itself writes and deletes it (`.credentials.json` in the account's folder, which the widget never opens). On an SSH host the code you paste goes into that terminal, straight to Claude on the host. A login terminal in VS Code isn't kept or restored by VS Code.

Chats aren't copied between accounts: to move a chat to another account, share it (see [Sharing chats](#sharing-chats)).

**The icon** shows one number, the most urgent: red for chats that need you, else green for chats that finished since you last opened the popup (turns as long as the "finished" notifications ask for). While a chat works, Talpa glances around; hovering the icon lists every count.

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

   This removes the widget and its window rule, and takes the snippet out of your status-line scripts (it shows the change and keeps a backup).
3. Optionally delete the widget's cache: `rm -rf ~/.cache/claude-widget`.

Apart from the chats you share and the accounts you add, the widget never changes Claude Code's own files, so nothing else is left behind. Accounts you added stay (they're Claude's folders now), and so do their `~/.local/bin/claude-NAME` commands: remove those on the Accounts page first if you like. Shared chats stay shared: use **Keep only on …** first if you want them back as normal chats (see [Sharing chats](#sharing-chats)).

## Troubleshooting

- **"No plan usage yet":** plan usage comes from the status line, so it shows up after the next reply in a session of that account. If it never does, check that `jq` is installed and that the snippet is in your status-line script (`./install.sh` adds it). Saved snapshots are in `~/.cache/claude-widget/statusline/`.
- **Claude Status isn't in the widget list:** it needs Plasma 6. Check that it's installed: `kpackagetool6 -t Plasma/Applet --list | grep claude`.
- **The old version is still showing after an update:** `systemctl --user restart plasma-plasmashell`.
- **"Can't find the claude command":** the widget looks on PATH, in the usual install folders and on your login shell's PATH. If Claude is somewhere else, add its folder to PATH in `~/.profile` (not only `~/.bashrc`) and log in again.
- **Clicking a session doesn't switch to its tab:** tab switching works with Konsole and tmux. With other terminals the window is raised.
- **An SSH host refuses the login:** the checks log in without a terminal, so they need key-based login (load your key with `ssh-add`) or a connection you logged in with: click **Log in…** at the host (Plasma) and type your password where `ssh` asks for it. The host also needs `python3`.
- **Something else:** run the widget in its own window to see its messages: `plasmawindowed org.wzaielamri.claudestatus`. You can also run the status script on its own: `python3 -I package/contents/code/claude_status.py --pretty`.

Issues and ideas are welcome on the [issue tracker](https://github.com/wzaielamri/claude-status/issues).

## How it works

```
~/.claude/statusline.sh ──(snippet)──▶ ~/.cache/claude-widget/statusline/<profile>/<session>.json
<profile>/sessions/<pid>.json ─┐
<profile>/jobs/<id>/state.json ┼─▶ package/contents/code/claude_status.py ──JSON──▶ QML widget (when a chat changes, else every 2–20 s)
<profile>/projects/**/*.jsonl ─┘
<profile>/sessions/ + ~/.cache/claude-widget/live/ ──▶ live.py --wait (inotify) ──▶ "check now" + each step (live mode)
```

<details>
<summary><b>The details</b></summary>

- **Profiles** are found automatically: every `~/.claude` and `~/.claude-*` folder (what `CLAUDE_CONFIG_DIR` points to). A link such as `~/.claude` → `~/.claude-personal` counts as that profile; everything is keyed by the real folder, so switching the link to another profile never mixes their data. A session started through the link follows it when it's switched, so it's listed under the profile the link points to now. Profiles logged into the same account (`oauthAccount.accountUuid` in their `.claude.json`) are merged into one section, because they share plan limits. A profile is named by the `.profile-name` file in its folder, else by its folder name (`~/.claude-work`: *work*); `~/.claude` is *main*, and a lone one is named after the account's display name. From `.claude.json` only the account id, plan type and display name are read, plus whether you've trusted a folder (so the widget can tell you before Claude asks) and Claude Code's own cache of your plan usage (`cachedUsageUtilization`); credentials are never touched.
- **Session state** comes from Claude Code's own session registry (`sessions/<pid>.json`: `status` `busy` / `shell` / `waiting` / `idle`, with `waitingFor`). Background jobs add their record in `jobs/<id>/state.json`, which also covers jobs whose process has already exited. Dead and reused PIDs are filtered out using the process start time. The rules follow Claude Code's own:
  - Background jobs use the same rules as `claude agents --all`. The live status wins over the job record; a job needs you only when its `tempo` is `blocked` or the session itself waits.
  - Interactive sessions follow Claude Code's terminal status. A dialog you opened yourself (`/model`, `/effort`, …) doesn't count as "needs input", and a background shell still running after the turn counts as working.
- **Plan limits and context** come from the JSON that Claude Code passes to the status line (`rate_limits`, `context_window`), and plan limits also from Claude Code's own cache of them in the profile's `.claude.json` (`cachedUsageUtilization`, what `/usage` and VS Code's Claude panel fetch), whichever is newer: VS Code's panel runs no status line. `statusline-snippet.sh` saves a copy of it per session, under the profile's real folder name. Older copies filed under a link's name only count if they're newer than the link: before it was last switched, that name meant another profile.
- **Token totals** are read incrementally from transcripts (at most once a minute, cached per profile in `~/.cache/claude-widget/tokens-*.json`). Lines are de-duplicated per message, and summed per day, so a status check adds up a few numbers instead of every message of the week. Linked folders are followed, so a shared chat's subagents count too.
- **Watching:** `package/contents/code/live.py --wait` (one for all copies of the widget) waits with inotify for a change in each profile's `sessions/` folder, which Claude rewrites whenever a chat's state changes, and in `~/.cache/claude-widget/live/`; then it answers and runs again. A session file that changed makes the widget check at once (a check that's running then runs again once it's done). Steps alone come at most every 0.4 s, and with nothing new it answers every 50 s anyway. What it told the widget last is kept in that folder, so nothing that happens between two runs is missed.
- **Live mode** is `~/.local/share/claude-widget/live-hook.py` (from `live_hook.py`), named in each profile's `settings.json` for Claude's hook events (a prompt, each tool call's start and end, a permission request, a notification, a subagent's start and end, the end of a turn, a session's start and end) with `async: true`, so Claude doesn't wait for it. It folds each event into the chat's file in `~/.cache/claude-widget/live/` (what it does now, its last 8 steps with the lines an edit added and removed, its running subagents, the first line of what it said last), under a lock, written in one go.
- **What a chat is doing** comes from the end of its transcript: its newest step (a tool call, thinking, writing), your last prompt and Claude's reply since (markdown read as plain text). Its **tasks** are Claude's own task list, `tasks/<session>/<n>.json`. The **files it changed** come from the transcript's `file-history-delta` and `file-history-snapshot` records (each prompt's snapshot is where that turn started), plus its edit tool calls; only what was appended since the last check is read (`~/.cache/claude-widget/chats.json`).
- **Recaps, modes and limits** come from the end of each listed chat's transcript, like what it's doing: Claude's recap is a `system` record of subtype `away_summary` (it counts while no prompt or reply came after it), the permission mode the newest `permission-mode` record (or the one your last prompt carries), and a chat stopped by a usage limit ends with Claude's API error message naming the limit (*You've hit your session limit · resets …*). When that limit resets comes from the account's plan window of that limit (a window that started after the chat stopped means it's over), else from the time in the message.
- **Plans** are the Markdown files a chat in plan mode writes, `<config>/plans/<slug>.md`; the chat's transcript carries its slug (read from its end, kept in `~/.cache/claude-widget/plans.json`), which is how a plan is matched to the chat that made it. **Carry it out** starts a chat with the plan's text (up to 100 KB) as its first message. A shared plan is one file hard-linked into each profile's `plans/` (Claude writes plans in place, so it stays one file).
- **Finding a chat** reads each transcript's name and folder (from its first and last 64 KB, kept in `~/.cache/claude-widget/links.json`) and your prompts from each profile's `history.jsonl`; it runs when you search, not with the checks. The folders it finds are the ones chats ran in; plans are matched by their title and text, memories by their name, description and text.
- **Memories** are Claude's own notes, `<config>/projects/<folder>/memory/*.md` (the name, description and kind at the top of each), listed newest first after the account's `CLAUDE.md`. The folder a memory is for is found from the `projects/` folder's name, which Claude makes from the folder's path.
- **Queued tasks** are kept in `~/.cache/claude-widget/queue.json` (an SSH host's too: they start from here, over ssh). The widget that notifies starts one once its time has come (`jump.py --start-queued`), which takes it out of the queue first, so of several copies (and the VS Code extension) only one starts it. A chat that goes on by itself is checked first: if its newest turn isn't the limit's message any more, it went on already and nothing happens. Else an idle session that has it open ends (as for **Continue on …**), and `claude --bg --resume <chat> "The usage limit has reset: go on where you stopped."` goes on with the same chat in the background (only in a folder Claude trusts, as for background tasks).
- **Chats changing the same files:** two listed chats that each have a process (they can still change files) and changed some of the same files, as the widget reads what a chat changed (Claude's backups and edit tool calls, subagents included; not shell commands).
- **Markdown pages:** without Okular, `package/contents/code/markdown_page.py` turns a plan or run into an HTML page (standard library only: headings, lists, code, tables, quotes, links), written to `~/.cache/claude-widget/agent-runs` and opened in your browser. Everything is escaped, only http(s) links are links, images aren't loaded, and the page's Content-Security-Policy blocks scripts and any loading.
- **Starting a task in the background** runs `claude --bg "<task>"` in the folder, under the account's config folder, in a systemd scope of its own (so the background service it may start outlives a Plasma restart). Commands for background sessions (`attach`, `stop`, `--bg`) run without `CLAUDE_CODE_DISABLE_AGENT_VIEW`, which makes Claude refuse them; new chats in a terminal get it, so they open as a normal chat.
- **Stats:** the token scan also keeps per-day sums for 30 days (tokens by model and folder, which chats ran), and counts your prompts per day and folder from `history.jsonl`. A chat's tokens count for the folder it started in. A chat's recap comes from its own transcript and its subagents': prompts, tool calls by name, tokens, and how long Claude worked (each turn, from your prompt to its last step). The price is the status line's `cost.total_cost_usd`: what the session would cost through the API.
- **Subagents** are read from `projects/<project>/<session>/subagents/agent-*.jsonl` and their `.meta.json`. An agent is done when its transcript ends with its final answer (or the report it hands back), running otherwise, and stopped if its session ended first. Its task is its transcript's first prompt (a fork's directive); its last steps and report come from the end of the transcript, read again only when it changed (`~/.cache/claude-widget/agent-details.json`). *Open the whole run* reads the transcript in full and writes it to `~/.cache/claude-widget/agent-runs/`.
- **Shared chats** are transcripts with the same file (inode) in several profiles. Each row knows which conversation it shows: a background session that took a chat over counts as that chat while its own transcript holds no messages; a transcript that starts with a shared chat's history is a copy of it. Claude's own rule decides whether a chat moved on (its last `continued-in` record comes after its last finished reply). Where a finished shared chat was used last comes from the status-line snapshots, the prompt history (`history.jsonl`) and, if you use hooks that hold a shared chat to one session, their lock file (`~/.local/state/claude-shared-chats/lock-<id>`).
- **Sharing** (`package/contents/code/sharing.py`): hard links the transcript into each profile and the store, moves the chat's `projects/<project>/<id>/` and `file-history/<id>/` folders into the store and symlinks them back. A chat shared the same way by another tool, into a store of its own, is found through its links and handled where it is.
- **Jumping to a session** (`package/contents/code/jump.py`) finds the window through the session's process tree. Konsole tabs are switched over Konsole's D-Bus API. A window is raised with a short KWin script loaded over D-Bus, which is how one app can bring another's window to the front on Plasma Wayland. VS Code conversations open through the Claude extension's `vscode://anthropic.claude-code/open?session=…` link. Background jobs are attached under the same config-folder name as the running background service, because Claude keys that service by the folder's *name*. Terminals and VS Code windows the widget opens get a systemd scope of their own (like the apps KDE starts), so restarting Plasma doesn't kill the chats running in them.
- **SSH hosts** (`package/contents/code/remote.py`): `ssh -o BatchMode=yes … <host> python3 -I - --remote`, with `claude_status.py` on stdin (for sharing, `sharing.py` behind it, `claude_status.py` loaded as the module it imports). In `--remote` mode every row also carries the command that opens it on the host, and the JSON follows a marker line, so login scripts that print a banner can't break it. Connections are shared through `ControlMaster` sockets in `$XDG_RUNTIME_DIR/claude-status-ssh` (else a folder of yours in `/tmp`): a short path, since a socket's may have at most 107 characters. **Log in…** runs `remote.py --login-here <host>` in a terminal: `ssh -o ControlMaster=auto -o ControlPersist=30m -o ForwardAgent=no -o ForwardX11=no … -T <host> true`, without batch mode, so ssh asks for the password, passphrase, code or host key itself (host keys are checked as always), and the connection it opens becomes the shared one; **Disconnect** is `ssh -O exit`. While it's open, programs running as you can use it, as with a key in your agent.

</details>

## Privacy

- The widget reads the files Claude Code writes, on your computer and on the SSH hosts you pick (through your own SSH login). It never handles your SSH password: you type it into `ssh` itself, in a terminal, and nothing of it is stored. On an SSH host it also reads which account VS Code's Claude uses there (the VS Code server's settings), and changes only that one setting (`claudeCode.environmentVariables`' `CLAUDE_CONFIG_DIR`), when you start a VS Code chat there on another account. Besides those it reads only your `~/.ssh/config` host list, the desktop settings it needs (default terminal, sound theme, Do Not Disturb) and process and window info (`/proc`, Konsole, tmux, KWin) to find where a session runs (and, for a widget on the desktop, where your windows are, to rest the pets while one covers it); of a Claude process's environment it keeps only `CLAUDE_CONFIG_DIR` and `HOME`. To know which account VS Code's Claude uses, it reads `CLAUDE_CONFIG_DIR` from VS Code's settings (`claudeCode.environmentVariables`) or from VS Code's environment, nothing else. It never opens Claude's credentials (`.credentials.json`, the system keyring); of `.claude.json` it reads only what's listed above. When `claude` isn't on the desktop's PATH or in the usual install folders, a click on a chat runs your login shell once (`$SHELL -l -i -c env`) to read the PATH it sets up, nothing else.
- It doesn't call any Anthropic API and sends no data anywhere. *Open Usage Page on claude.ai* just opens that page in your browser. With the Recap tab's amounts in a currency other than US dollars, the tab downloads the European Central Bank's public exchange rates (`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`) at most every 6 hours while it's open: a plain download that sends nothing about you or your chats. A task you start a chat with goes to Claude, which runs it like a prompt you type (with a plan you carry out, the plan's text is part of it); so does feedback on a plan you send (what you changed in it), which the widget puts on your clipboard when it can't type it in. The one exception is the *Phone* setting (off unless you turn it on): then a chat's name, what it needs and its folder go to your phone through KDE Connect.
- Everything it stores lives in `~/.cache/claude-widget` (tasks you queue too, with their text, until they start), plus shared chats' folders in `~/.local/share/claude-status/shared-chats`; only your user can read either (mode 0700). SSH connection sockets go to `$XDG_RUNTIME_DIR/claude-status-ssh`, which is cleared when you log out. Its JSON output replaces account ids with a one-way hash.
- It changes Claude Code's files only when you share a chat or a plan, when you **Allow…** a rule in the Permissions tab (one entry of `.claude/settings.local.json` in the folder its chats started in; **Undo** takes it back, and `~/.cache/claude-widget/rules.json` remembers what it added) or **Revoke…** one of the permissions you gave (that entry of the settings file it's in) (here, or between an SSH host's accounts on that host): it links the chat (with its plan) or the plan into your other profiles, or out of them again; and when you add or remove an account in its settings (see [Accounts](#accounts)): it makes the `~/.claude-NAME` folder (its `.profile-name` and the links to the settings you share) and the `~/.local/bin/claude-NAME` command, or moves the folder to the Trash. **Make Default** changes the `~/.claude` link (when it is one) and one entry of VS Code's settings (`claudeCode.environmentVariables`' `CLAUDE_CONFIG_DIR`; on an SSH host, its VS Code server's), nothing else of them. The same happens on an SSH host when you manage its accounts. Logging in and out is Claude's own `claude auth login` / `logout`; the Accounts page asks `claude auth status` whom each account is logged in as, and shows its email address only there. Before a removed folder goes to the Trash, the widget deletes its `.credentials.json` without opening it, so no login ends up in the Trash.
- With **Live mode** on, the live hook writes each chat's last steps to `~/.cache/claude-widget/live/<session>.json` (the tool and its file name or command, cut to 60 characters, and the first line of Claude's last reply); a file goes once its chat has said nothing for 3 days. Turning live mode off takes the hook out of `settings.json` again.
- The chat pane reads the chat's transcript. What you send goes to Claude as your message; an answer to a permission prompt (or to Claude's questions) goes to Claude through the hook (*Answer permission prompts from the widget*: it's `~/.local/share/claude-widget/permission-hook.py`, named in each profile's `settings.json`; it writes each request to `~/.cache/claude-widget/permissions` while it waits, and removes it once answered) or as the dialog's keys in tmux. **Undo** writes the files back as they were before the chat (a file it made is removed), **Commit** runs `git add` and `git commit` on only the chat's files, and **Mark reviewed** is kept in `~/.cache/claude-widget/reviewed.json`.
- To show what a chat changed, it reads Claude's backups of the chat's files (`file-history/`) and the files themselves, runs `git show HEAD:<file>` for a file with no backup, and puts copies of the earlier versions in `~/.cache/claude-widget/changes` for VS Code to show; they're removed after a day. A subagent's run you open is written to `~/.cache/claude-widget/agent-runs` (an SSH host's comes over your ssh connection) and opened with `xdg-open`; it's removed after a day too. It also reads Claude's task lists (`tasks/`), plans (`plans/`; an SSH host's plan you open comes over your ssh connection and is written to `~/.cache/claude-widget/agent-runs`, removed after a day) and memories (`projects/<folder>/memory/`), and each account's `CLAUDE.md`; it changes none of them itself (✎ opens the file in your editor). It asks the screen saver over D-Bus whether the screen is locked.
- It reads the clipboard only when you press Ctrl+V in a new chat's task field or the chat pane's reply box and there's no text to paste: a picture there is saved in `~/.cache/claude-widget/images` for the chat to open (only that folder is added to a chat it starts or that goes on in the background, `claude --add-dir`), and deleted after 30 days. For an SSH host's chat it's copied to the host's `~/.cache/claude-widget/images` only once you click **Copy**, and deleted there after 30 days too.

## Limitations

- `sessions/*.json` is an internal Claude Code format and may change in a future version. The backend fails soft: the widget shows the error instead of breaking.
- Plan usage only refreshes when a terminal session of that account gets a reply (that's when the status line runs), or when Claude Code fetches it itself (`/usage`, VS Code's Claude panel). The popup shows how old the numbers are and treats windows whose reset time has passed as reset.
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
    │                     SessionRow.qml, PetStrip.qml + Pet.qml (pets), hub/Hub.qml (checks shared by all copies), …
    ├── code/             Python: claude_status.py (status; poll.py runs it for each check, compiled code cached),
    │                     jump.py (actions), sharing.py (shared chats), accounts.py (accounts), remote.py (SSH),
    │                     markdown_page.py (plans and runs as a web page), notify_sound.py
    ├── config/           settings schema and pages
    ├── ui/talpa/         Talpa, the pet: its parts, moods and actions (shared with GNOME and VS Code)
    └── pets/             Talpa's notification icons (made by tools/talpa_icons.mjs)
gnome/                    the GNOME Shell extension: extension/ (GJS: indicator.js, logic.js, ui/, prefs.js), build.sh, tests/
statusline-snippet.sh     the snippet install.sh adds to your status line
tests/                    unit tests: they build Claude Code's files in temporary folders
tools/                    render_popup.sh (offscreen screenshots), talpa_icons.mjs (Talpa's still pictures), gnome/ (headless GNOME Shell test)
```

The tests build Claude Code's files (sessions, background jobs, transcripts, shared-chat links, a switched `~/.claude` link) in temporary folders. `tests/test_remote.py` drives the SSH code through a stand-in `ssh` that runs the command locally.

**Contributing:** issues and pull requests are welcome. Please run the tests, and check QML changes with `tools/render_popup.sh`. Keep `claude_status.py` and `sharing.py` compatible with Python 3.7, because they also run on SSH hosts (a test checks this).

## About this project

I built this widget to make my own day-to-day work with Claude Code easier. With several sessions running across different profiles and machines, I wanted one glance at the panel to tell me which sessions need me and how much of my plan I've used. I'm sharing it in case it's useful to others.

### Not affiliated with Anthropic

This is an independent, personal project. It is not affiliated with, endorsed by, sponsored by or otherwise connected to Anthropic, PBC, and building it does not make me a representative of Anthropic in any way. "Claude" and "Claude Code" are trademarks of Anthropic, PBC; they appear here only to describe what the widget works with.

The widget only reads files that Claude Code writes on your own computer, and changes them only when you share a chat between your accounts, or add, remove or pick the default account. It does not call any Anthropic API, and it sends no data anywhere: logging in and out is Claude Code's own command. The *Open Usage Page on claude.ai* menu entry just opens that page in your browser.

### AI-assisted development

The code, tests and documentation in this repository were largely generated with an AI coding assistant (Claude Code, using Anthropic's Claude models) under my direction. I defined what the widget should do, made the design decisions, and reviewed and tested the result on my own machine (Fedora, KDE Plasma 6).

As with any open-source code, please read it before you run it. It is provided under the MIT License, "as is", without warranty of any kind.

## Credits

[Claude Usage Widget](https://github.com/projectvelox/claude-usage-widget) inspired how the pet reacts to usage and clicks.

## Author

Made by Wadhah Zai El Amri: more of my projects and work are on [my website](https://wzaielamri.github.io).

## License

[MIT](LICENSE) © 2026 Wadhah Zai El Amri
