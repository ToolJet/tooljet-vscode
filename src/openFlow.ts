import { CliRunner, Host, RunResult, Store, Ui } from './ports';
import { stripAnsi } from './cliOutput';
import { OpenRequest } from './uri';

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

/** Checks the CLI is installed and has the `app` and `auth login` commands; offers to install it. */
export async function ensureCli(deps: Deps, cwd: string): Promise<boolean> {
  if (verified.has(deps.cli)) return true;
  const probe = async (): Promise<'missing' | 'old' | 'ok'> => {
    const version = await run(deps, ['--version'], cwd, 'ToolJet: CLI version', false).catch(() => undefined);
    if (!version || version.code !== 0) return 'missing';
    const app = await run(deps, ['app', 'clone', '--help'], cwd, 'ToolJet: CLI check', false).catch(() => undefined);
    const auth = await run(deps, ['auth', 'login', '--help'], cwd, 'ToolJet: CLI check', false).catch(() => undefined);
    return app?.code === 0 && auth?.code === 0 ? 'ok' : 'old';
  };
  let state = await probe();
  if (state === 'ok') {
    verified.add(deps.cli);
    return true;
  }
  const choice = await deps.ui.ask(
    state === 'missing' ? 'The ToolJet CLI is not installed.' : 'This ToolJet CLI is too old for Code mode apps.',
    'Install it now with "npm i -g @tooljet/cli"? It runs in a terminal you can watch. ' +
      'You can also install it yourself and try again, or set "tooljet.cliPath".',
    ['Install']
  );
  if (choice !== 'Install') return false;
  const installed = await deps.cli.installCli();
  if (installed.code !== 0) {
    deps.ui.error(`Installing the ToolJet CLI failed: ${lastError(installed)}`);
    return false;
  }
  state = await probe();
  if (state !== 'ok') {
    deps.ui.error(
      state === 'missing'
        ? 'The ToolJet CLI was installed but is not on the PATH the editor sees. Set "tooljet.cliPath" or restart the editor.'
        : 'The installed ToolJet CLI does not have the Code mode commands yet.'
    );
    return false;
  }
  verified.add(deps.cli);
  return true;
}

/** Makes the CLI's default login the given instance, running `tooljet auth login` when it is not. */
export async function ensureLogin(deps: Deps, instance: string, cwd: string): Promise<boolean> {
  const state = deps.host.loginState(instance);
  if (state === 'default') return true;
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
  if (choice !== 'Sign in') return false;
  const result = await run(deps, ['auth', 'login', '--url', instance], cwd, 'ToolJet: sign in');
  if (result.code !== 0 || deps.host.loginState(instance) !== 'default') {
    deps.ui.error(`Signing in to ${instance} did not finish: ${lastError(result)}`);
    return false;
  }
  return true;
}

const linkedFolderFor = (deps: Deps, req: OpenRequest): string | undefined => {
  for (const link of deps.store.links()) {
    if (link.appId !== req.appId || link.instance !== req.instance) continue;
    if (deps.host.readAppJson(link.folder)?.appId === req.appId) return link.folder;
  }
  return undefined;
};

export async function openFromLink(req: OpenRequest, deps: Deps, home: string): Promise<Outcome> {
  const { ui, host, store } = deps;

  // 1. Nothing contacts the instance before the user agrees to it.
  const version = req.version ? `, version "${req.version}"` : '';
  const confirmed = await ui.ask(
    `Open a ToolJet app from ${req.instance}?`,
    `App ${req.appId}${version}.\n\nThe ToolJet CLI will sign in to this instance if needed, clone the app into a folder ` +
      'you choose and run its dev loop. Continue only if you clicked "Open in" on your own ToolJet instance.',
    ['Open']
  );
  if (confirmed !== 'Open') return 'cancelled';

  if (!(await ensureCli(deps, home))) return 'cancelled';
  if (!(await ensureLogin(deps, req.instance, home))) return 'cancelled';

  // 2. A folder already linked to this app opens as it is.
  const existing = linkedFolderFor(deps, req);
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

  // 3. Where to put it.
  const parent = await ui.pickParentFolder(store.lastParentFolder());
  if (!parent) return 'cancelled';
  await store.setLastParentFolder(parent);
  const suggested = req.folder ?? `tooljet-app-${req.appId.slice(0, 8)}`;
  const name = await ui.inputFolderName(suggested, (value) => {
    if (!FOLDER_NAME.test(value) || value.includes('..')) return 'Use letters, digits, dot, dash or underscore.';
    const target = host.join(parent, value);
    if (host.exists(target) && !host.isEmptyDir(target)) return `${target} already exists and is not empty.`;
    return undefined;
  });
  if (!name) return 'cancelled';
  const folder = host.join(parent, name);

  // 4. Clone, check out the version, install.
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
  const install = await run(deps, ['app', 'install'], folder, 'ToolJet: install');
  if (install.code !== 0) ui.warn(`Installing dependencies failed: ${lastError(install)}. "tooljet app dev" will try again.`);

  await store.setLink({ appId: req.appId, instance: req.instance, folder });

  // An app already in Code mode keeps its source in the developer's repository, not in ToolJet: the clone is the
  // starter template, and starting dev from it would replace the developer's dev build with that template.
  const sourceElsewhere = /already in Code mode/i.test(stripAnsi(clone.output));
  if (sourceElsewhere) {
    ui.warn(
      "This app is already in Code mode and its source is not stored in ToolJet. Bring the source from your repository into the new folder's frontend/, then run \"ToolJet: Start dev\"."
    );
  } else {
    await store.setPendingDev(folder);
  }
  await host.openFolder(folder);
  return sourceElsewhere ? 'cloned-no-dev' : 'cloned';
}
