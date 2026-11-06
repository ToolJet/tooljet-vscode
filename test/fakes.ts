import { Deps } from '../src/openFlow';
import { cliTarballUrl } from '../src/spawnSpec';
import { AppJson, CliRunner, LinkRecord, RunOptions, RunResult, Store, Ui } from '../src/ports';

/* Fakes for the flows: a scripted CLI, a scripted UI, an in-memory store and file system. */

export interface CliCall {
  args: string[];
  cwd: string;
  visible: boolean;
}

type Reply = RunResult | ((call: CliCall) => RunResult);

/** `tooljet app clone --help` of a CLI that has `--instance` (records a clone's instance, keeps the default login). */
export const GOOD_CLONE_HELP: RunResult = { code: 0, output: 'FLAGS\n  --instance=<value>  Use this instance\'s stored login\n' };

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
    const r = this.replies.get(key) ?? (key === 'app clone --help' ? GOOD_CLONE_HELP : { code: 0, output: '' });
    return { done: Promise.resolve(typeof r === 'function' ? r(call) : r), kill: () => {} };
  }

  /** The runner after `tooljet.cliPath` changed: a new object (so it is probed again) sharing calls and replies. */
  forPath(path: string): FakeCli {
    const next = Object.create(this) as FakeCli;
    next.path = path;
    return next;
  }
  path = 'tooljet';

  installedFrom: string[] = [];

  async installCli(spec: string) {
    this.installs++;
    this.installedFrom.push(spec);
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
  details: string[] = [];
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

  /** The questions asked as warnings. */
  warnings: string[] = [];
  async ask(message: string, detail: string, actions: string[], options?: { warning?: boolean }) {
    this.asked.push(message);
    this.details.push(detail);
    if (options?.warning) this.warnings.push(message);
    const key = Object.keys(this.answers).find((k) => message.startsWith(k));
    return key !== undefined ? this.answers[key] : actions[0];
  }
  /** Parent folders to answer, in turn, after `parent` (for repeated pickers). */
  parents: (string | undefined)[] = [];
  pickedDefaults: (string | undefined)[] = [];
  described?: string;
  serverAddress: string | undefined = undefined;
  cliPath: string | undefined = undefined;
  async pickParentFolder(defaultPath?: string) {
    this.pickedDefault = defaultPath;
    this.pickedDefaults.push(defaultPath);
    return this.pickedDefaults.length > 1 && this.parents.length ? this.parents.shift() : this.parent;
  }
  async inputFolderName(defaultName: string, validate: (v: string) => string | undefined, describe: (v: string) => string) {
    this.folderValidator = validate;
    const value = this.folderName ?? defaultName;
    if (validate(value)) return undefined;
    this.described = describe(value);
    return value;
  }
  async inputServerAddress(_suggestion: string, validate: (v: string) => string | undefined) {
    return this.serverAddress === undefined || validate(this.serverAddress) ? undefined : this.serverAddress;
  }
  async pickCliPath() {
    return this.cliPath;
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

export function makeDeps(
  opts: { logins?: { default?: string; stored?: string[] }; repos?: string[]; servesCli?: string[] } = {}
) {
  const cli = new FakeCli();
  const ui = new FakeUi();
  const store = new MemoryStore();
  const files = new Map<string, AppJson>();
  const dirs = new Set<string>();
  const logins = { default: opts.logins?.default, stored: opts.logins?.stored ?? [] };
  const opened: string[] = [];
  const cliPaths: string[] = [];
  const tarballChecks: string[] = [];
  const deps: Deps = {
    cli,
    setCliPath: async (p) => {
      cliPaths.push(p);
      deps.cli = cli.forPath(p);
    },
    ui,
    store,
    host: {
      exists: (p) => dirs.has(p) || files.has(p),
      isEmptyDir: (p) => ![...files.keys()].some((f) => f.startsWith(p)),
      readAppJson: (root) => files.get(root),
      join: (...parts) => parts.join('/'),
      loginState: (i) => (logins.default === i ? 'default' : logins.stored.includes(i) ? 'stored' : 'none'),
      defaultLoginOrigin: () => logins.default,
      defaultParentFolder: () => '/home/me/ToolJet apps',
      gitRepositoryOf: (p) => (opts.repos ?? []).find((r) => p === r || p.startsWith(r + '/')),
      cliTarball: async (origin) => {
        tarballChecks.push(origin);
        return (opts.servesCli ?? []).includes(origin) ? cliTarballUrl(origin) : undefined;
      },
      openFolder: async (f) => void opened.push(f),
    },
  };
  return { deps, cli, ui, store, files, dirs, logins, opened, cliPaths, tarballChecks };
}
