// A subagent's whole run, in VS Code's Markdown preview. Claude Code can't
// open a subagent from outside, so the widget's backend renders its
// transcript as Markdown into the cache (jump.py --agent-run; remote.py
// --agent-run fetches one from an SSH host) and this opens that file.

import * as path from "node:path";
import * as vscode from "vscode";
import { inside } from "./changes";
import { cacheDir } from "./config";
import type { ChatRef } from "./shared/types";

export function agentRunsRoot(root = cacheDir()): string {
  return path.join(root, "agent-runs");
}

// The helper to run, and its arguments (it saves the file, --no-open: we open it)
export function agentRunArgs(
  chat: Pick<ChatRef, "host" | "chatId" | "sessionId" | "profileDir">,
  agentId: string,
  extra: string[] = [],
): ["jump.py" | "remote.py", string[]] {
  const chatId = chat.chatId || chat.sessionId;
  if (chat.host) return ["remote.py", ["--agent-run", chat.host, chatId, agentId, ...(chat.profileDir ? [chat.profileDir] : []), "--no-open"]];
  return ["jump.py", ["--agent-run", agentId, "--chat", chatId, ...(chat.profileDir ? ["--profile", chat.profileDir] : []), "--no-open", ...extra]];
}

// Is it a file the backend saved, in the cache's agent-runs folder?
export function isAgentRunFile(file: string | undefined, root = agentRunsRoot()): file is string {
  return !!file && path.isAbsolute(file) && file.endsWith(".md") && inside(file, root);
}

// Opens it in the Markdown preview (as text where that's missing); the error
// to report, or "" when it opened
export async function openAgentRunFile(file: string): Promise<string> {
  const uri = vscode.Uri.file(file);
  try {
    await vscode.commands.executeCommand("markdown.showPreview", uri);
    return "";
  } catch (e) {
    try {
      await vscode.window.showTextDocument(uri, { preview: true });
      return "";
    } catch (e2) {
      return e2 instanceof Error ? e2.message : String(e2 ?? e);
    }
  }
}
