/*
  How a CLI run is spawned. On macOS and Linux the arguments go straight to the process (no shell), so nothing in
  an app id, folder or version name can be interpreted by a shell. Windows needs a shell to run the npm-installed
  `tooljet.cmd` shim, so there each argument is validated and quoted.
*/

export interface SpawnSpec {
  command: string;
  args: string[];
  shell: boolean;
}

// Characters cmd.exe treats specially even inside double quotes.
const WINDOWS_UNSAFE = /["%!^&|<>\r\n]/;

export function spawnSpec(executable: string, args: string[], platform: NodeJS.Platform = process.platform): SpawnSpec {
  if (platform !== 'win32') return { command: executable, args, shell: false };
  for (const a of [executable, ...args]) {
    if (WINDOWS_UNSAFE.test(a)) throw new Error(`Refusing to pass ${JSON.stringify(a)} to the Windows shell.`);
  }
  const quote = (a: string) => (/[\s]/.test(a) || a === '' ? `"${a}"` : a);
  return { command: quote(executable), args: args.map(quote), shell: true };
}

/** npm's CLI, for an instance that does not serve its own (GET /api/code-mode/cli/tooljet-cli.tgz). */
export const NPM_CLI_PACKAGE = '@tooljet/cli@latest';
export const npmInstallCli = (spec: string = NPM_CLI_PACKAGE) => ['i', '-g', spec];

/** Where a ToolJet server serves the CLI it was built with. */
export const cliTarballUrl = (origin: string) => `${origin.replace(/\/+$/, '')}/api/code-mode/cli/tooljet-cli.tgz`;

/*
  The CLI prefers TOOLJET_URL and TOOLJET_PAT (or TOOLJET_TOKEN) from the environment over its stored login, and the
  editor inherits the user's shell environment. Left in, they would send a project's commands to whatever instance
  the shell names, with that shell's token, while the extension's instance check looks at the stored login. So every
  CLI run gets the environment without them, and the stored login for the linked instance is what the CLI uses.
*/
export const TARGET_ENV = ['TOOLJET_URL', 'TOOLJET_PAT', 'TOOLJET_TOKEN'];

export function cliEnv(base: NodeJS.ProcessEnv, visible: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, FORCE_COLOR: visible ? '1' : '0' };
  for (const name of Object.keys(env)) if (TARGET_ENV.includes(name.toUpperCase())) delete env[name];
  return env;
}
