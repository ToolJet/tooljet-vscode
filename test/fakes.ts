import { Deps } from '../src/openFlow';
import { AppJson, CliRunner, LinkRecord, RunOptions, RunResult, Store, Ui } from '../src/ports';

/* Fakes for the flows: a scripted CLI, a scripted UI, an in-memory store and file system. */

export interface CliCall {
  args: string[];
  cwd: string;
  visible: boolean;
}

type Reply = RunResult | ((call: CliCall) => RunResult);

export class FakeCli implements CliRunner {
  calls: CliCall[] = [];
  installs = 0;
  installed = true;
  replies = new Map<string, Reply>();
  /** Chunks fed to onOutput for a long-running command, then its result. */
  streams = new Map<string, { chunks: string[]; result: Promise<RunResult> }>();
  installResult: RunResult = { code: 0, output: '' };
  onInstall?: () => void;

  reply(args: string, r: Reply) {
    this.replies.set(args, r);
    return this;
  }

  start(args: string[], options: RunOptions) {
    const call = { args, cwd: options.cwd, visible: options.visible };
    this.calls.push(call);
    const key = args.join(' ');
    if (!this.installed) return { done: Promise.resolve({ code: 127, output: 'tooljet was not found' }), kill: () => {} };
    const stream = this.streams.get(key);
    if (stream) {
      for (const c of stream.chunks) options.onOutput?.(c);
      return { done: stream.result, kill: () => {} };
    }
    const r = this.replies.get(key) ?? { code: 0, output: '' };
    return { done: Promise.resolve(typeof r === 'function' ? r(call) : r), kill: () => {} };
  }

  async installCli() {
    this.installs++;
    this.onInstall?.();
    return this.installResult;
  }

  /** The first call, other than a probe, whose arguments start with these words. */
  find(prefix: string) {
    return this.calls.find((c) => !c.args.includes('--help') && c.args.join(' ').startsWith(prefix));
  }

  /** The calls other than the CLI probes (--version and --help). */
  get work() {
    return this.calls.filter((c) => !c.args.includes('--version') && !c.args.includes('--help')).map((c) => c.args.join(' '));
  }
}

export class FakeUi implements Ui {
  asked: string[] = [];
  messages: { level: string; text: string }[] = [];
  answers: Record<string, string | undefined> = {};
  parent: string | undefined = '/home/me/apps';
  folderName: string | undefined = undefined; // undefined: accept the default
  version: string | undefined = '1.0.0';
  folderValidator?: (v: string) => string | undefined;
  pickedDefault?: string;

  /** Answers a question whose message starts with `prefix`. */
  answer(prefix: string, action: string | undefined) {
    this.answers[prefix] = action;
    return this;
  }

  async ask(message: string, _detail: string, actions: string[]) {
    this.asked.push(message);
    const key = Object.keys(this.answers).find((k) => message.startsWith(k));
    return key !== undefined ? this.answers[key] : actions[0];
  }
  async pickParentFolder(defaultPath?: string) {
    this.pickedDefault = defaultPath;
    return this.parent;
  }
  async inputFolderName(defaultName: string, validate: (v: string) => string | undefined) {
    this.folderValidator = validate;
    const value = this.folderName ?? defaultName;
    return validate(value) ? undefined : value;
  }
  async inputVersion() {
    return this.version;
  }
  info(text: string) {
    this.messages.push({ level: 'info', text });
  }
  warn(text: string) {
    this.messages.push({ level: 'warn', text });
  }
  error(text: string) {
    this.messages.push({ level: 'error', text });
  }
}

export class MemoryStore implements Store {
  parent?: string;
  linkList: LinkRecord[] = [];
  pending?: string;
  lastParentFolder = () => this.parent;
  setLastParentFolder = async (f: string) => void (this.parent = f);
  links = () => this.linkList;
  setLink = async (l: LinkRecord) => void (this.linkList = [...this.linkList.filter((x) => x.folder !== l.folder), l]);
  setPendingDev = async (f: string) => void (this.pending = f);
  takePendingDev = async (f: string) => {
    const hit = this.pending === f;
    if (hit) this.pending = undefined;
    return hit;
  };
}

export function makeDeps(opts: { logins?: { default?: string; stored?: string[] } } = {}) {
  const cli = new FakeCli();
  const ui = new FakeUi();
  const store = new MemoryStore();
  const files = new Map<string, AppJson>();
  const dirs = new Set<string>();
  const logins = { default: opts.logins?.default, stored: opts.logins?.stored ?? [] };
  const opened: string[] = [];
  const deps: Deps = {
    cli,
    ui,
    store,
    host: {
      exists: (p) => dirs.has(p) || files.has(p),
      isEmptyDir: (p) => ![...files.keys()].some((f) => f.startsWith(p)),
      readAppJson: (root) => files.get(root),
      join: (...parts) => parts.join('/'),
      loginState: (i) => (logins.default === i ? 'default' : logins.stored.includes(i) ? 'stored' : 'none'),
      defaultLoginOrigin: () => logins.default,
      openFolder: async (f) => void opened.push(f),
    },
  };
  return { deps, cli, ui, store, files, dirs, logins, opened };
}
