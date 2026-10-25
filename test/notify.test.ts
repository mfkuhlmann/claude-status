import assert from "node:assert/strict";
import { test } from "node:test";
import { demoState } from "../src/shared/demo";
import type { PermissionAsk, Session } from "../src/shared/types";

// A permission prompt's notification: its buttons in Claude's own order
// (Yes, Yes and don't ask again, No), as in its row and its tab
test("a permission prompt's notification lists Allow once, Always allow, Deny, Deny with a note…", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const vscode = (await import("vscode")) as unknown as typeof import("./vscode-stub");
  process.env.XDG_CACHE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "claude-status-notify-"));
  const { Notifier } = await import("../src/notify");
  const window = vscode.window as unknown as Record<string, unknown>;
  const shown: string[][] = [];
  let pick = "";
  let note: string | undefined = "";
  window.showWarningMessage = async (_m: string, ...buttons: string[]) => (shown.push(buttons), pick);
  window.showInputBox = async () => note;
  const answers: [string, string][] = [];
  const notifier = new Notifier({ sound() {} } as never, () => undefined);
  notifier.panes = { answer: async (_c: unknown, d: string, n = "") => (answers.push([d, n]), { ok: true, message: "" }) } as never;
  const ask = (p: Partial<PermissionAsk>): Session => ({
    ...demoState(Date.now()).status!.groups[0].sessions[0], state: "waiting", name: "deploy",
    permission: { tool: "Bash", line: "Bash: npm publish", command: "npm publish", file: "", diff: [], always: "", request: "r1", answer: "hook", ...p },
  }) as Session;
  const notify = async (s: Session) => {
    notifier.handle({ notices: [{ key: s.key, kind: "waiting", title: "deploy asks", body: "", session: s }], petEvents: [], sound: "", finished: [] });
    await new Promise((r) => setTimeout(r, 10));
  };

  await notify(ask({}));
  await notify(ask({ always: "Bash(npm publish:*)" }));
  assert.deepEqual(shown, [
    ["Allow once", "Deny", "Deny with a note…", "Open"],
    ["Allow once", "Always allow", "Deny", "Deny with a note…", "Open"],
  ]);

  pick = "Deny with a note…";
  note = "  publish to the test registry  ";
  await notify(ask({}));
  note = "";   // (Enter with no note: a plain deny)
  await notify(ask({}));
  note = undefined;   // (Escape: no answer)
  await notify(ask({}));
  assert.deepEqual(answers, [["deny", "publish to the test registry"], ["deny", ""]]);
  notifier.dispose();
});
