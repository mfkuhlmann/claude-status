// The webview: in the Activity Bar view, and optionally as an editor tab.
// Both get the same page and the same state; the page only talks to the
// extension through messages (src/shared/types.ts), never to the network.

import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { Actions } from "./actions";
import { setReopenIn } from "./config";
import type { Dashboard } from "./dashboard";
import type { HostMessage, WebviewMessage } from "./shared/types";

export class ViewHost implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewId = "claudeStatus.view";
  private webviews = new Set<vscode.Webview>();
  private visibleCount = 0;
  private panel: vscode.WebviewPanel | undefined;
  private view: vscode.WebviewView | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private extensionUri: vscode.Uri,
    private dash: Dashboard,
    private actions: Actions,
  ) {
    this.disposables.push(
      dash.onState((state) => this.broadcast({ type: "state", state })),
      dash.onPetEvent((e) => this.broadcast({ type: "petEvent", kind: e.kind, text: e.text, key: e.key })),
    );
  }

  dispose(): void {
    this.panel?.dispose();
    for (const d of this.disposables) d.dispose();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.setUp(view.webview, false);
    let visible = view.visible;
    if (visible) this.visibleCount++;
    view.onDidChangeVisibility(() => {
      if (view.visible === visible) return;
      visible = view.visible;
      this.visibleCount += visible ? 1 : -1;
      this.visibilityChanged(view.webview, visible);
    });
    view.onDidDispose(() => {
      if (visible) this.visibleCount--;
      this.webviews.delete(view.webview);
      this.view = undefined;
      this.dash.setVisible(this.visibleCount > 0);
    });
    this.dash.setVisible(this.visibleCount > 0);
  }

  openInEditor(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel("claudeStatus.panel", "Claude Status", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: this.roots(),
    });
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "spark.svg");
    this.panel = panel;
    this.setUp(panel.webview, true);
    let visible = panel.visible;
    if (visible) this.visibleCount++;
    panel.onDidChangeViewState(() => {
      if (panel.visible === visible) return;
      visible = panel.visible;
      this.visibleCount += visible ? 1 : -1;
      this.visibilityChanged(panel.webview, visible);
    });
    panel.onDidDispose(() => {
      if (visible) this.visibleCount--;
      this.webviews.delete(panel.webview);
      this.panel = undefined;
      this.dash.setVisible(this.visibleCount > 0);
    });
    this.dash.setVisible(this.visibleCount > 0);
  }

  // The waiting count on the Activity Bar icon
  setBadge(waiting: number): void {
    if (this.view) this.view.badge = waiting ? { value: waiting, tooltip: `${waiting} chat${waiting === 1 ? " needs" : "s need"} you` } : undefined;
  }

  private visibilityChanged(webview: vscode.Webview, visible: boolean): void {
    void webview.postMessage({ type: "visible", visible } satisfies HostMessage);
    this.dash.setVisible(this.visibleCount > 0);
  }

  private roots(): vscode.Uri[] {
    return [vscode.Uri.joinPath(this.extensionUri, "dist"), vscode.Uri.joinPath(this.extensionUri, "vendor", "pets")];
  }

  private setUp(webview: vscode.Webview, editorTab: boolean): void {
    webview.options = { enableScripts: true, localResourceRoots: this.roots() };
    webview.html = this.html(webview, editorTab);
    this.webviews.add(webview);
    webview.onDidReceiveMessage((m: WebviewMessage) => this.receive(webview, m));
  }

  private broadcast(message: HostMessage): void {
    for (const w of this.webviews) void w.postMessage(message);
  }

  private receive(webview: vscode.Webview, m: WebviewMessage): void {
    switch (m.type) {
      case "ready":
        void webview.postMessage({ type: "state", state: this.dash.state() } satisfies HostMessage);
        void webview.postMessage({ type: "visible", visible: true } satisfies HostMessage);
        break;
      case "open":
        void this.actions.open(m.chat);
        break;
      case "openInClaudeCode":
        void this.actions.openInClaudeCode(m.chat);
        break;
      case "setReopenIn":
        void setReopenIn(m.where);
        break;
      case "stop":
        void this.actions.stop(m.chat);
        break;
      case "dismiss":
        void this.actions.dismiss(m.chat);
        break;
      case "share":
        void this.actions.share(m.chat);
        break;
      case "compareChanges":
        void this.actions.compareChanges(m.chat, m.turn);
        break;
      case "openAgentRun":
        void this.actions.openAgentRun(m.chat, m.agentId);
        break;
      case "dismissDigest":
        this.dash.dismissDigest();
        break;
      case "newChat":
        void this.actions.newChat(m.groupId, m.host);
        break;
      case "refresh":
        if (m.host) void this.dash.pollHost(m.host);
        else this.dash.refreshAll();
        break;
      case "showRemoved":
        void this.actions.showRemoved(m.host ?? null);
        break;
      case "hideHost":
        void this.actions.hideHost(m.host);
        break;
      case "pickHosts":
        void this.actions.pickHosts();
        break;
      case "setupUsageBars":
        void vscode.commands.executeCommand("claudeStatus.setupUsageBars");
        break;
      case "openUsagePage":
        void vscode.commands.executeCommand("claudeStatus.openUsagePage");
        break;
    }
  }

  private html(webview: vscode.Webview, editorTab: boolean): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const asset = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...p)).toString();
    const config = JSON.stringify({ petsBase: asset("vendor", "pets"), editorTab });
    // Scripts run only with the nonce, and nothing loads from outside the
    // extension. Styles may also be set inline (the pets move by element
    // styles; their SVGs' own styles go into constructed stylesheets).
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `connect-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset("dist", "webview-style.css")}">
<title>Claude Status</title>
</head>
<body>
<script nonce="${nonce}">window.CLAUDE_STATUS = ${config.replace(/</g, "\\u003c")};</script>
<script nonce="${nonce}" src="${asset("dist", "webview.js")}"></script>
</body>
</html>`;
  }
}
