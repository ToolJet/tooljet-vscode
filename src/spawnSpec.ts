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

export const NPM_INSTALL_CLI = ['i', '-g', '@tooljet/cli'];
