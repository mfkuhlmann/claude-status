// Just enough of the vscode module for unit tests outside VS Code: settings
// read as their defaults, no remote window.

const noop = () => ({ dispose() {} });

export const workspace = {
  getConfiguration: () => ({ get: <T>(_key: string, fallback: T) => fallback, update: async () => undefined }),
  workspaceFolders: undefined,
  workspaceFile: undefined,
  onDidChangeConfiguration: noop,
  onDidChangeWorkspaceFolders: noop,
  registerTextDocumentContentProvider: noop,
};

export const window = {
  terminals: [],
  visibleTextEditors: [],
  state: { focused: false },
  onDidCloseTerminal: noop,
  onDidChangeWindowState: noop,
};

export const env = { remoteName: undefined as string | undefined };

export enum ConfigurationTarget {
  Global = 1,
}

export class ThemeIcon {
  constructor(public id: string) {}
}

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  event = (l: (e: T) => void) => {
    this.listeners.push(l);
    return { dispose: () => undefined };
  };
  fire(e: T) {
    for (const l of this.listeners) l(e);
  }
  dispose() {}
}
