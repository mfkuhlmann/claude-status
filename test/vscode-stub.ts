// Just enough of the vscode module to run the extension outside VS Code:
// settings read as their defaults, no remote window, and a record of what
// the extension registers (commands, the view, the status bar item).

const disposable = () => ({ dispose() {} });

export const recorded = {
  commands: new Map<string, (...args: unknown[]) => unknown>(),
  viewProviders: new Map<string, unknown>(),
  uriHandlers: [] as unknown[],
  statusBarItems: [] as { text: string; tooltip: unknown; backgroundColor: unknown; show(): void; dispose(): void }[],
  messages: [] as string[],
};

// settings a test sets (key -> value); the rest read as their defaults
export const overrides = new Map<string, unknown>();

export const workspace = {
  getConfiguration: () => ({ get: <T>(key: string, fallback: T) => (overrides.has(key) ? (overrides.get(key) as T) : fallback), update: async () => undefined }),
  workspaceFolders: undefined,
  workspaceFile: undefined,
  onDidChangeConfiguration: disposable,
  onDidChangeWorkspaceFolders: disposable,
  registerTextDocumentContentProvider: disposable,
};

const logChannel = () => ({
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
  show() {},
  appendLine() {},
  dispose() {},
});

export const window = {
  terminals: [],
  visibleTextEditors: [],
  state: { focused: false },
  onDidCloseTerminal: disposable,
  onDidChangeWindowState: disposable,
  createOutputChannel: logChannel,
  createStatusBarItem: () => {
    const item = { text: "", tooltip: undefined as unknown, backgroundColor: undefined as unknown, show() {}, hide() {}, dispose() {} };
    recorded.statusBarItems.push(item);
    return item;
  },
  registerWebviewViewProvider: (id: string, provider: unknown) => {
    recorded.viewProviders.set(id, provider);
    return disposable();
  },
  registerUriHandler: (handler: unknown) => {
    recorded.uriHandlers.push(handler);
    return disposable();
  },
  showTextDocument: async () => undefined,
  showInformationMessage: async (m: string) => void recorded.messages.push(m),
  showWarningMessage: async (m: string) => void recorded.messages.push(m),
  showErrorMessage: async (m: string) => void recorded.messages.push(m),
};

export const commands = {
  registerCommand: (id: string, fn: (...args: unknown[]) => unknown) => {
    recorded.commands.set(id, fn);
    return disposable();
  },
  executeCommand: async () => undefined,
  getCommands: async () => [] as string[],
};

export const extensions = { onDidChange: disposable };

export const comments = {
  createCommentController: (id: string, label: string) => ({ id, label, options: undefined, commentingRangeProvider: undefined, dispose: () => undefined }),
};

export enum CommentMode {
  Editing = 0,
  Preview = 1,
}

export const clipboardWrites: string[] = [];
export const env = {
  remoteName: undefined as string | undefined,
  openExternal: async () => true,
  clipboard: { writeText: async (text: string) => void clipboardWrites.push(text), readText: async () => clipboardWrites.at(-1) ?? "" },
};

export enum ConfigurationTarget {
  Global = 1,
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export class ThemeIcon {
  constructor(public id: string) {}
}

export class ThemeColor {
  constructor(public id: string) {}
}

export class MarkdownString {
  value = "";
  constructor(value?: string, public supportThemeIcons?: boolean) {
    this.value = value ?? "";
  }
  appendMarkdown(s: string) {
    this.value += s;
    return this;
  }
  appendText(s: string) {
    this.value += s;
    return this;
  }
}

export class Uri {
  private constructor(public scheme: string, public path: string) {}
  static file(p: string) {
    return new Uri("file", p);
  }
  static parse(s: string) {
    return new Uri(s.split(":")[0], s);
  }
  static joinPath(base: Uri, ...parts: string[]) {
    return new Uri(base.scheme, [base.path, ...parts].join("/"));
  }
  get fsPath() {
    return this.path;
  }
  toString() {
    return `${this.scheme}://${this.path}`;
  }
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
