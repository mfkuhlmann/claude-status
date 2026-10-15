// Which SSH host this VS Code window is connected to (Remote-SSH), if any.
// The extension itself always runs on this computer ("extensionKind": ["ui"]),
// so it reaches that host with its own ssh, like any other picked host.

// The host names remote.py accepts (its HOST_NAME)
export const HOST_NAME = /^[A-Za-z0-9_.@][A-Za-z0-9_.@:-]*$/;

// "ssh-remote+myhost" -> "myhost". Remote-SSH writes names that don't fit in
// a URI authority (upper case, user@host, …) as hex-encoded JSON:
// "ssh-remote+7b22686f73744e616d65223a…" -> {"hostName":"…","user":"…"}.
export function hostFromAuthority(authority: string | undefined): string | undefined {
  if (!authority) return undefined;
  const plus = authority.indexOf("+");
  if (plus < 0 || authority.slice(0, plus) !== "ssh-remote") return undefined;
  let rest = authority.slice(plus + 1);
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return undefined;
  }
  let host = rest;
  if (/^(?:[0-9a-f]{2})+$/i.test(rest) && rest.startsWith("7b")) {
    try {
      const decoded = JSON.parse(Buffer.from(rest, "hex").toString("utf8"));
      if (decoded && typeof decoded.hostName === "string") {
        host = (typeof decoded.user === "string" && decoded.user ? decoded.user + "@" : "") + decoded.hostName;
        if (typeof decoded.port === "number" || (typeof decoded.port === "string" && decoded.port)) host += ":" + decoded.port;
      }
    } catch {
      // not JSON after all: a host name made of hex digits
    }
  }
  // "user@host:2222": ssh takes no port in the destination; keep host aliases simple
  if (host.includes(":")) host = host.slice(0, host.indexOf(":"));
  return HOST_NAME.test(host) ? host : undefined;
}

// The authority of whatever this window has open: a folder, a workspace file,
// or an editor.
export function currentRemoteHost(vscode: typeof import("vscode")): string | undefined {
  if (vscode.env.remoteName !== "ssh-remote") return undefined;
  const uris = [
    ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri),
    ...(vscode.workspace.workspaceFile ? [vscode.workspace.workspaceFile] : []),
    ...vscode.window.visibleTextEditors.map((e) => e.document.uri),
  ];
  for (const uri of uris) {
    if (uri.scheme === "vscode-remote") {
      const host = hostFromAuthority(uri.authority);
      if (host) return host;
    }
  }
  return undefined;
}
