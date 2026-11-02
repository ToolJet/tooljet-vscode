import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/*
  Which ToolJet instance the CLI is signed in to. `tooljet auth login` stores logins in ~/.tooljet/credentials.json,
  one per workspace, and `tooljet app ...` uses the default one. The extension reads only each login's `url` and
  which one is the default: it never reads a token into anything it keeps, logs or passes on.
*/

export const CREDENTIALS_PATH = path.join(os.homedir(), '.tooljet', 'credentials.json');

export type LoginState =
  /** The default login is for this instance: `tooljet app` commands will reach it. */
  | 'default'
  /** A login for this instance exists, but another instance's login is the default. */
  | 'stored'
  | 'none';

const originOf = (url: unknown): string | undefined => {
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

export interface StoredLogins {
  defaultOrigin?: string;
  origins: string[];
}

export function readStoredLogins(file = CREDENTIALS_PATH): StoredLogins {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { origins: [] };
  }
  let store: { workspaces?: Record<string, { url?: unknown }>; default?: unknown };
  try {
    store = JSON.parse(raw);
  } catch {
    return { origins: [] };
  }
  const workspaces = store && typeof store.workspaces === 'object' && store.workspaces ? store.workspaces : {};
  const origins: string[] = [];
  for (const entry of Object.values(workspaces)) {
    const origin = originOf(entry?.url);
    if (origin && !origins.includes(origin)) origins.push(origin);
  }
  const def = typeof store.default === 'string' ? workspaces[store.default] : undefined;
  return { defaultOrigin: originOf(def?.url), origins };
}

export function loginStateFor(instance: string, file = CREDENTIALS_PATH): LoginState {
  const logins = readStoredLogins(file);
  if (logins.defaultOrigin === instance) return 'default';
  return logins.origins.includes(instance) ? 'stored' : 'none';
}
