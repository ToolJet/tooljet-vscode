import { CliRunner, Host, RunResult, Store, Ui } from './ports';
import { stripAnsi } from './cliOutput';
import { NPM_CLI_PACKAGE } from './spawnSpec';
import { OpenRequest, parseInstance } from './uri';

/*
  "Open in VS Code" from the ToolJet editor: confirm the instance, make sure the CLI is there and signed in to that
  instance, clone the app into a folder the user picks, install its dependencies without install scripts, and open
  it in a new window, which then starts `tooljet app dev`.
*/

export interface Deps {
  ui: Ui;
  cli: CliRunner;
  host: Host;
  store: Store;
  /** Saves `tooljet.cliPath` and switches `cli` to a runner for that executable. */
  setCliPath(path: string): Promise<void>;
}

export type Outcome =
  | 'cancelled'
  | 'failed'
  /** Opened a folder already linked to this app. */
  | 'opened-existing'
  /** Cloned and opened; dev starts in the new window. */
  | 'cloned'
  /** Cloned and opened, but dev was not started (the app's source is not in ToolJet). */
  | 'cloned-no-dev';

const FOLDER_NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;

/** The last "✗ Error : ..." line of a CLI run, or its last non-empty line. */
export function lastError(result: RunResult): string {
  const lines = stripAnsi(result.output).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const error = [...lines].reverse().find((l) => l.startsWith('✗ Error'));
  return (error ?? lines[lines.length - 1] ?? `exit code ${result.code}`).replace(/^✗ Error\s*:\s*/, '');
}

const run = (deps: Deps, args: string[], cwd: string, title: string, visible = true) =>
  deps.cli.start(args, { cwd, title, visible }).done;

// CLIs already found good, so each command does not probe again. A new runner (after a cliPath change) probes anew.
const verified = new WeakSet<CliRunner>();

type CliState = 'missing' | 'old' | 'ok';

const probeCli = async (deps: Deps, cwd: string): Promise<CliState> => {
  const version = await run(deps, ['--version'], cwd, 'ToolJet: CLI version', false).catch(() => undefined);
  if (!version || version.code !== 0) return 'missing';
  const app = await run(deps, ['app', 'clone', '--help'], cwd, 'ToolJet: CLI check', false).catch(() => undefined);
  const auth = await run(deps, ['auth', 'login', '--help'], cwd, 'ToolJet: CLI check', false).catch(() => undefined);
  return app?.code === 0 && auth?.code === 0 ? 'ok' : 'old';
};

export const CHOOSE_CLI = 'Choose a CLI...';

/**
 * Checks the CLI is installed and has the `app` and `auth login` commands. When it is missing or too old, offers to
 * install or update it (npm, in a terminal the user can watch) or to pick another `tooljet` executable, and keeps
 * offering both until the CLI is good or the user gives up. The install comes from `server` when that ToolJet server
 * serves the CLI it was built with, whose commands match it; else from npm.
 */
export async function ensureCli(deps: Deps, cwd: string, server?: string): Promise<boolean> {
  if (verified.has(deps.cli)) return true;
  let state = await probeCli(deps, cwd);
  if (state === 'ok') {
    verified.add(deps.cli);
    return true;
  }
  const tarball = server ? await deps.host.cliTarball(server).catch(() => undefined) : undefined;
  const spec = tarball ?? NPM_CLI_PACKAGE;
  const from = tarball ? server : 'npm';
  let after: 'install' | 'choose' | undefined;
  while (state !== 'ok') {
    const install = state === 'missing' ? 'Install' : 'Update the CLI';
    const message =
      after === 'install'
        ? state === 'missing'
          ? 'The ToolJet CLI was installed but is not on the PATH the editor sees.'
          : `The ToolJet CLI from ${from} does not have the Code mode commands yet.`
        : after === 'choose'
          ? state === 'missing'
            ? 'That file did not run as the ToolJet CLI.'
            : 'That ToolJet CLI does not have the Code mode commands.'
          : state === 'missing'
            ? 'The ToolJet CLI is not installed.'
            : 'This ToolJet CLI is too old for Code mode apps.';
    const detail =
      after === 'install'
        ? 'Choose a ToolJet CLI that has the "app" commands (for example one built from the ToolJet repository\'s cli/bin/run), or restart the editor if the PATH changed.'
        : `${install === 'Install' ? 'Install' : 'Update'} it with "npm i -g ${spec}" in a terminal you can watch` +
          (tarball ? ` (the CLI ${server} was built with), ` : ', ') +
          'or choose a tooljet executable you already have. Your choice is saved as the "tooljet.cliPath" setting.';
    const actions = after === 'install' ? [CHOOSE_CLI] : [install, CHOOSE_CLI];
    const choice = await deps.ui.ask(message, detail, actions);
    if (choice === install) {
      const installed = await deps.cli.installCli(spec);
      if (installed.code !== 0) {
        deps.ui.error(`Installing the ToolJet CLI failed: ${lastError(installed)}`);
        return false;
      }
      after = 'install';
    } else if (choice === CHOOSE_CLI) {
      const picked = await deps.ui.pickCliPath();
      if (!picked) return false;
      await deps.setCliPath(picked);
      after = 'choose';
    } else {
      return false;
    }
    state = await probeCli(deps, cwd);
  }
  verified.add(deps.cli);
  return true;
}

/** Makes the CLI's default login the given instance, running `tooljet auth login` when it is not. */
export async function ensureLogin(deps: Deps, instance: string, cwd: string): Promise<boolean> {
  const result = await signIn(deps, instance, cwd);
  if (result.ok || result.declined) return result.ok;
  deps.ui.error(`Signing in to ${instance} did not finish: ${result.error}`);
  return false;
}

type SignIn = { ok: true; declined?: false } | { ok: false; declined: true } | { ok: false; declined?: false; error: string };

async function signIn(deps: Deps, instance: string, cwd: string): Promise<SignIn> {
  const state = deps.host.loginState(instance);
  if (state === 'default') return { ok: true };
  const other = deps.host.defaultLoginOrigin();
  const choice = await deps.ui.ask(
    `Sign in to ${instance}?`,
    (state === 'stored' || other
      ? `The ToolJet CLI is signed in to ${other ?? 'another instance'}, and its app commands use that login. `
      : 'The ToolJet CLI is not signed in to this instance. ') +
      '"tooljet auth login" shows a code in a terminal and opens your browser; approve the code there while signed in to ToolJet. ' +
      'The token is stored by the CLI, never by the editor.',
    ['Sign in']
  );
  if (choice !== 'Sign in') return { ok: false, declined: true };
  const result = await run(deps, ['auth', 'login', '--url', instance], cwd, 'ToolJet: sign in');
  if (result.code !== 0 || deps.host.loginState(instance) !== 'default') return { ok: false, error: lastError(result) };
  return { ok: true };
}

// What the CLI says when the address it was given has no device sign-in: usually a frontend served apart from its API.
const NO_BROWSER_SIGN_IN = /does not support browser sign-in|\b404\b|not found/i;

/**
 * Signs in to the server behind a link: its `api` origin when it names one, else the instance. When that address has
 * no browser sign-in and the link named no API origin, the API is probably served elsewhere (a separate server URL,
 * or a local stack's API port): ToolJet's frontend has that address compiled in, so ask the user for it.
 * Resolves to the origin the CLI is now signed in to.
 */
async function signInForLink(deps: Deps, req: OpenRequest, cwd: string): Promise<string | undefined> {
  let target = req.api ?? req.instance;
  for (;;) {
    const result = await signIn(deps, target, cwd);
    if (result.ok) return target;
    if (result.declined) return undefined;
    if (req.api || !NO_BROWSER_SIGN_IN.test(result.error) || target !== req.instance) {
      deps.ui.error(`Signing in to ${target} did not finish: ${result.error}`);
      return undefined;
    }
    const choice = await deps.ui.ask(
      `${target} has no browser sign-in.`,
      `This is usually because ToolJet's server runs at another address than the page you opened the app from ` +
        '(a separate server URL, or the API port of a local stack). Enter the server address to sign in there.',
      ['Enter server address']
    );
    if (choice !== 'Enter server address') return undefined;
    const entered = await deps.ui.inputServerAddress(req.instance, (value) => {
      const parsed = parseInstance(value.trim().replace(/\/+$/, ''));
      return parsed.ok ? undefined : parsed.error;
    });
    if (!entered) return undefined;
    const parsed = parseInstance(entered.trim().replace(/\/+$/, ''));
    if (!parsed.ok) return undefined;
    target = parsed.origin;
  }
}

const linkedFolderFor = (deps: Deps, req: OpenRequest): string | undefined => {
  for (const link of deps.store.links()) {
    if (link.appId !== req.appId || link.instance !== req.instance) continue;
    if (deps.host.readAppJson(link.folder)?.appId === req.appId) return link.folder;
  }
  return undefined;
};

/** Asks for the parent folder until it is outside any Git repository, or the user confirms one inside. */
async function pickParent(deps: Deps): Promise<string | undefined> {
  const { ui, host, store } = deps;
  let start = store.lastParentFolder() ?? host.defaultParentFolder();
  for (;;) {
    const parent = await ui.pickParentFolder(start);
    if (!parent) return undefined;
    const repo = host.gitRepositoryOf(parent);
    if (!repo) return parent;
    const choice = await ui.ask(
      `${parent} is inside a Git repository.`,
      `It belongs to ${repo}. Cloning the app there puts its project inside that repository. Clone there anyway, or choose another folder?`,
      ['Choose another folder', 'Clone there']
    );
    if (choice === 'Clone there') return parent;
    if (!choice) return undefined;
    start = host.defaultParentFolder();
  }
}

type SourceState = 'platform' | 'repository' | 'none' | 'unknown';

/**
 * Brings the app's code that ToolJet stores into the clone (`tooljet app source-pull`), when the CLI has the command.
 * Resolves to who owns that code: the ToolJet editor ('platform'), a Git repository, nobody (nothing stored), or
 * 'unknown' when the CLI could not say.
 */
async function pullStoredSource(deps: Deps, folder: string): Promise<SourceState> {
  const help = await run(deps, ['app', 'source-pull', '--help'], folder, 'ToolJet: CLI check', false).catch(() => undefined);
  if (help?.code !== 0) return 'unknown';
  const pulled = await run(deps, ['app', 'source-pull'], folder, 'ToolJet: get the app\'s code');
  const text = stripAnsi(pulled.output);
  if (pulled.code !== 0) {
    deps.ui.warn(`Getting the app's code from ToolJet failed: ${lastError(pulled)}`);
    return 'unknown';
  }
  const owner = /owner (platform|repository)\b/i.exec(text)?.[1]?.toLowerCase();
  if (owner === 'platform' || owner === 'repository') return owner;
  return /no source is stored|isn't saved|not saved/i.test(text) ? 'none' : 'unknown';
}

export async function openFromLink(req: OpenRequest, deps: Deps, home: string): Promise<Outcome> {
  const { ui, host, store } = deps;

  // 1. Nothing contacts the instance before the user agrees to it.
  const version = req.version ? `, version "${req.version}"` : '';
  const api = req.api && req.api !== req.instance ? ` Its server is at ${req.api}.` : '';
  const confirmed = await ui.ask(
    `Open a ToolJet app from ${req.instance}?`,
    `App ${req.appId}${version}.${api}\n\nThe ToolJet CLI will sign in to this instance if needed, clone the app into a folder ` +
      'you choose and start its live preview. Continue only if you clicked "Open in" on your own ToolJet instance.',
    ['Open']
  );
  if (confirmed !== 'Open') return 'cancelled';

  if (!(await ensureCli(deps, home, req.api ?? req.instance))) return 'cancelled';
  const server = await signInForLink(deps, req, home);
  if (!server) return 'cancelled';
  const linked = { ...req, instance: server };

  // 2. A folder already linked to this app opens as it is.
  const existing = linkedFolderFor(deps, linked);
  if (existing) {
    const choice = await ui.ask(
      'This app is already cloned.',
      `It is linked to ${existing}. Open that folder, or clone it again into a new one?`,
      ['Open folder', 'Clone again']
    );
    if (!choice) return 'cancelled';
    if (choice === 'Open folder') {
      await store.setPendingDev(existing);
      await host.openFolder(existing);
      return 'opened-existing';
    }
  }

  // 3. Where to put it: a neutral default (never the folder the editor happened to use last), the full path shown.
  const parent = await pickParent(deps);
  if (!parent) return 'cancelled';
  await store.setLastParentFolder(parent);
  const suggested = req.folder ?? `tooljet-app-${req.appId.slice(0, 8)}`;
  const name = await ui.inputFolderName(
    suggested,
    (value) => {
      if (!FOLDER_NAME.test(value) || value.includes('..')) return 'Use letters, digits, dot, dash or underscore.';
      const target = host.join(parent, value);
      if (host.exists(target) && !host.isEmptyDir(target)) return `${target} already exists and is not empty.`;
      return undefined;
    },
    (value) => `Clones into ${host.join(parent, value)}`
  );
  if (!name) return 'cancelled';
  const folder = host.join(parent, name);

  // 4. Clone, check out the version, bring in the code ToolJet stores, install.
  const clone = await run(deps, ['app', 'clone', req.appId, name], parent, 'ToolJet: clone');
  if (clone.code !== 0) {
    ui.error(`Cloning the app failed: ${lastError(clone)}`);
    return 'failed';
  }
  if (req.version) {
    const checkout = await run(deps, ['app', 'checkout', req.version], folder, 'ToolJet: checkout');
    if (checkout.code !== 0) {
      ui.error(`Checking out version "${req.version}" failed: ${lastError(checkout)}. The editing version is checked out.`);
    }
  }
  const source = await pullStoredSource(deps, folder);
  const install = await run(deps, ['app', 'install'], folder, 'ToolJet: install');
  if (install.code !== 0) ui.warn(`Installing dependencies failed: ${lastError(install)}. "tooljet app dev" will try again.`);

  await store.setLink({ appId: req.appId, instance: server, folder });

  /*
    The live preview uploads what is in the folder. Start it only when that is the app's code: code ToolJet stores
    and its editor owns, or an app the clone set up fresh. Otherwise the folder holds the starter template (code
    not stored in ToolJet) or a copy of code its Git repository owns, and a live preview from it would replace the
    developer's.
  */
  const notStored = /already in Code mode|code isn't saved in ToolJet/i.test(stripAnsi(clone.output));
  const startPreview = source === 'platform' || (!notStored && source !== 'repository');
  if (source === 'repository') {
    ui.warn(
      "This app's code is kept in its Git repository; ToolJet's copy is now in frontend/. Edit it in a clone of that repository, then run \"ToolJet: Start live preview\" there."
    );
  } else if (!startPreview) {
    ui.warn(
      "This app's code isn't saved in ToolJet. Copy it from your repository into the new folder's frontend/, then run \"ToolJet: Start live preview\"."
    );
  }
  if (startPreview) await store.setPendingDev(folder);
  await host.openFolder(folder);
  return startPreview ? 'cloned' : 'cloned-no-dev';
}
