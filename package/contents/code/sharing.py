#!/usr/bin/env python3
"""Share a Claude Code chat between your Claude profiles, so another account
can continue it (jump.py's --share, --continue and --unshare).

A shared chat is one transcript file hard-linked into each profile's
projects/<project>/ folder: every profile lists it with its own chats, and
whichever account continues it writes to that same file. The chat's two
folders (projects/<project>/<id>/: subagents and tool results;
file-history/<id>/: undo checkpoints) move to a store, and each profile gets
a symlink to them, so Claude cleaning up one profile never takes them from
the others:

    ~/.local/share/claude-status/shared-chats/<project>/   ($XDG_DATA_HOME)
        <id>.jsonl           one more link to the transcript
        <id>/                the chat's folder
        <id>.file-history/   its undo checkpoints

A chat shared this way by another tool, into a store of its own, is found
through the profiles' links and handled where it is. claude_status.py tells
shared chats apart by the transcript's inode, whoever shared them.

A chat can be open in only one Claude session at a time (two would write the
same file): jump.py doesn't share or unshare a chat a session has open.
Nothing here starts Claude or sends anything anywhere.
"""

import os
import re
import shutil
from pathlib import Path

import claude_status as cs

# Claude's projects/<project> folder: the project's path with every other character as "-"
PROJECT_KEY = re.compile(r"^[A-Za-z0-9._-]+$")
TRANSCRIPT, FOLDER, CHECKPOINTS = "transcript", "folder", "checkpoints"
PARTS = (TRANSCRIPT, FOLDER, CHECKPOINTS)
FOLDERS = (FOLDER, CHECKPOINTS)


def store_root(home):
    data = os.environ.get("XDG_DATA_HOME", "")
    base = Path(data) if os.path.isabs(data) else home / ".local/share"
    return base / "claude-status" / "shared-chats"


def in_profile(profile, key, chat_id, part):
    """Where a part of the chat is in a profile (its real folder)."""
    if part == TRANSCRIPT:
        return profile.real / "projects" / key / f"{chat_id}.jsonl"
    if part == FOLDER:
        return profile.real / "projects" / key / chat_id
    return profile.real / "file-history" / chat_id


def in_store(folder, chat_id, part):
    """Where a part of the chat is in a store folder (<store>/<project>)."""
    return folder / {TRANSCRIPT: f"{chat_id}.jsonl", FOLDER: chat_id, CHECKPOINTS: f"{chat_id}.file-history"}[part]


def same(a, b):
    try:
        return os.path.samefile(str(a), str(b))
    except OSError:
        return False


def present(path):
    return path.exists() or path.is_symlink()


def target(link):
    """What a symlink points to, resolved (also when it's gone)."""
    return Path(os.path.realpath(str(link)))


def inside(path, folder):
    try:
        return os.path.commonpath([str(path), str(folder)]) == str(folder)
    except ValueError:
        return False


def links(path):
    try:
        return os.stat(str(path)).st_nlink
    except OSError:
        return 0


def copies(profiles, chat_id):
    """The profiles that have this chat, grouped by file: [[(profile, transcript)]],
    the file most profiles link to first (then the newest)."""
    groups = []
    for p in profiles:
        path = cs.transcript_path(p, chat_id)
        if path is None or path.is_symlink() or not path.is_file():
            continue
        for g in groups:
            if same(g[0][1], path):
                g.append((p, path))
                break
        else:
            groups.append([(p, path)])
    groups.sort(key=lambda g: (-len(g), -(cs.mtime(g[0][1]) or 0)))
    return groups


def store_paths(sharers, key, chat_id, root):
    """{part: where it is in the store}. A chat shared before keeps its folders
    where the profiles' symlinks point (maybe another tool's store); the rest
    goes to <root>/<project>."""
    ours = root / key
    paths = {part: in_store(ours, chat_id, part) for part in PARTS}
    for part in FOLDERS:
        link = next((in_profile(p, key, chat_id, part) for p in sharers
                     if in_profile(p, key, chat_id, part).is_symlink()), None)
        if link is not None:
            paths[part] = target(link)
    # that store's own link to the transcript sits next to the chat's folder
    beside = paths[FOLDER].parent / f"{chat_id}.jsonl"
    if paths[FOLDER].parent != ours and beside.is_file() and same(beside, in_profile(sharers[0], key, chat_id, TRANSCRIPT)):
        paths[TRANSCRIPT] = beside
    return paths


def device(path):
    """The filesystem (st_dev) a path is on, or would be on: that of its
    nearest folder that exists."""
    for p in (path, *path.parents):
        try:
            return os.stat(str(p)).st_dev
        except OSError:
            continue
    return None


def elsewhere(path, places):
    """Labels of the places (label, path) on another filesystem than path:
    hard links can't cross filesystems (another disk, partition or btrfs
    subvolume)."""
    here = device(path)
    return [label for label, p in places if device(p) != here]


def link_into(link, stored):
    """A profile's hard link to the transcript, or symlink to a folder."""
    link.parent.mkdir(parents=True, exist_ok=True)
    if stored.is_dir():
        os.symlink(str(stored), str(link))
    else:
        os.link(str(stored), str(link))


def share(profiles, chat_id, into, root, source=None):
    """Share a chat into the profiles `into`: from `source`'s copy, else the one
    most profiles have. (ok, message)."""
    groups = copies(profiles, chat_id)
    if not groups:
        return False, "That chat has no transcript on this computer"
    chat = next((g for g in groups if source is not None and any(p.real == source.real for p, _ in g)), None)
    if chat is None:
        if len(groups) > 1 and len(groups[1]) == len(groups[0]):
            names = ", ".join(p.label for g in groups for p, _ in g)
            return False, f"Different chats have this id on {names}; left everything as it is"
        chat = groups[0]
    path = chat[0][1]
    key = path.parent.name
    if not PROJECT_KEY.match(key) or key in (".", ".."):
        return False, f"Unexpected project folder {key}; left the chat as it is"
    sharers = [p for p, _ in chat]
    have = {p.real for p in sharers}
    store = store_paths(sharers, key, chat_id, root)
    # Checked first, so nothing is left half-done
    apart = elsewhere(path, [("the shared-chat folder", store[TRANSCRIPT])] +
                      [(q.label, in_profile(q, key, chat_id, TRANSCRIPT)) for q in into if q.real not in have])
    if apart:
        return False, (f"Can't share it: {', '.join(apart)} {'is' if len(apart) == 1 else 'are'} on another disk or "
                       f"partition than this chat, and a shared chat is one file linked into each account. "
                       f"Keep the Claude folders and {store[TRANSCRIPT].parent.parent} on one filesystem")
    old_umask = os.umask(0o077)  # the store holds chats: only you can read it
    try:
        if not present(store[TRANSCRIPT]):
            store[TRANSCRIPT].parent.mkdir(parents=True, exist_ok=True)
            os.link(str(path), str(store[TRANSCRIPT]))
        elif not same(store[TRANSCRIPT], path):
            return False, f"{store[TRANSCRIPT]} is a different chat with the same id; left everything as it is"
        # The chat's folders move to the store (the ones Claude makes later are
        # made there now), and the profiles that have it link to them.
        for part in FOLDERS:
            there = store[part]
            linked = any(here.is_symlink() and target(here) == there
                         for here in (in_profile(p, key, chat_id, part) for p in sharers))
            for p in sharers:
                here = in_profile(p, key, chat_id, part)
                if here.is_symlink():
                    if target(here) == there and not there.exists():
                        there.mkdir(parents=True)  # its store folder went missing
                elif here.is_dir():
                    if not linked and there.is_dir() and not any(there.iterdir()):
                        there.rmdir()  # left over, empty
                    if not present(there):
                        there.parent.mkdir(parents=True, exist_ok=True)
                        shutil.move(str(here), str(there))
                        os.symlink(str(there), str(here))
                        linked = True
                    elif not linked:
                        return False, f"{there} is already there; left the chat as it is"
                    # else: this profile keeps a folder of its own
                elif not present(here):
                    there.mkdir(parents=True, exist_ok=True)
                    link_into(here, there)
                    linked = True
        added, skipped = [], []
        for q in into:
            if q.real in have:
                continue
            plan = [(in_profile(q, key, chat_id, part), path if part == TRANSCRIPT else store[part]) for part in PARTS]
            if any(present(link) and not same(link, stored) for link, stored in plan):
                skipped.append(q.label)  # a chat of its own with this id
                continue
            for link, stored in plan:
                if not present(link):
                    link_into(link, stored)
            have.add(q.real)
            added.append(q.label)
    except OSError as exc:
        return False, f"Couldn't share the chat: {exc}"
    finally:
        os.umask(old_umask)
    on = [p.label for p in profiles if p.real in have]
    if added:
        message = f"Chat shared: it's now on {', '.join(on)}."
    elif skipped:
        return False, f"Not shared: {', '.join(skipped)} already has a different chat with the same id"
    else:
        message = f"This chat is already shared with {', '.join(on)}."
    if skipped:
        message += f" Not added to {', '.join(skipped)}: it has a different chat with the same id."
    return True, message


def keep_only(profiles, chat_id, keep, root):
    """Make a shared chat a normal chat of `keep` again: it keeps the
    transcript and gets the chat's folders back; the other profiles lose it.
    (ok, message)."""
    groups = copies(profiles, chat_id)
    mine = next((g for g in groups if any(p.real == keep.real for p, _ in g)), None)
    if mine is None and len(groups) > 1:
        return False, f"Several profiles have different chats with this id; {keep.label} has none of them"
    chat = mine or (groups[0] if groups else None)
    if chat is None:
        return False, "That chat has no transcript on this computer"
    path = chat[0][1]
    key = path.parent.name
    if not PROJECT_KEY.match(key) or key in (".", ".."):
        return False, f"Unexpected project folder {key}; left the chat as it is"
    sharers = sorted((p for p, _ in chat), key=lambda p: p.real != keep.real)  # keep's own links first
    shared = len(chat) > 1 or links(path) > 1 or any(
        in_profile(p, key, chat_id, part).is_symlink() for p in sharers for part in FOLDERS)
    if not shared:
        if any(len(g) > 1 for g in groups):
            return False, f"{keep.label} has its own, different copy of this chat; left everything as it is"
        return False, "This chat isn't shared"
    store = store_paths(sharers, key, chat_id, root)
    own_dirs = [p.real for p in profiles]
    moved = {}  # part: where its folder was
    removed = []
    old_umask = os.umask(0o077)
    try:
        # keep gets the chat's folders back
        for part in FOLDERS:
            here = in_profile(keep, key, chat_id, part)
            if here.is_symlink():
                was = target(here)
                os.unlink(str(here))
                if was.is_dir():
                    shutil.move(str(was), str(here))
                moved[part] = was
            elif not present(here) and store[part].is_dir():
                here.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(store[part]), str(here))
                moved[part] = store[part]
            # a real folder of its own stays
        kept = in_profile(keep, key, chat_id, TRANSCRIPT)
        if not present(kept):
            link_into(kept, path)
        # the others lose it
        for q in profiles:
            if q.real == keep.real:
                continue
            gone = False
            t = in_profile(q, key, chat_id, TRANSCRIPT)
            if not t.is_symlink() and t.is_file() and same(t, kept):
                os.unlink(str(t))
                gone = True
            for part in FOLDERS:
                link = in_profile(q, key, chat_id, part)
                if link.is_symlink() and target(link) in (moved.get(part), store[part]):
                    os.unlink(str(link))
                    gone = True
            if gone:
                removed.append(q.label)
        # and so does the store
        stored = store[TRANSCRIPT]
        if stored != kept and not any(inside(stored, d) for d in own_dirs) and stored.is_file() and same(stored, kept):
            os.unlink(str(stored))
        for folder in {stored.parent, *(m.parent for m in moved.values())}:
            if not any(inside(folder, d) for d in own_dirs):
                try:
                    folder.rmdir()  # only if it's empty now
                except OSError:
                    pass
    except OSError as exc:
        return False, f"Couldn't finish unsharing the chat: {exc}"
    finally:
        os.umask(old_umask)
    message = f"This chat is now a normal chat of {keep.label} again."
    if removed:
        message += f" Removed from {', '.join(removed)}."
    return True, message
