/*
  The link the ToolJet "Open locally" panel opens:

    vscode://tooljet.tooljet/open?instance=<origin>&app=<app id>[&version=<name>][&folder=<name>]

  (cursor:// and windsurf:// reach the same handler). Anything can open such a link, a web page included, so it is
  parsed strictly: only these four parameters, each once, and nothing that looks like a credential. The extension
  never takes a token from a link: sign-in is always `tooljet auth login`, approved in the browser.
*/

export const OPEN_PATH = '/open';

export interface OpenRequest {
  /** The ToolJet API origin, normalised (`https://host[:port]`, no trailing slash). */
  instance: string;
  appId: string;
  version?: string;
  /** Suggested folder name for the clone. */
  folder?: string;
}

export type ParseResult = { ok: true; value: OpenRequest } | { ok: false; error: string };

const ALLOWED = new Set(['instance', 'app', 'version', 'folder']);

// A parameter name or value that looks like it carries a secret. Checked before anything else, so such a link is
// refused as a whole and never half-used.
const CREDENTIAL_NAME = /(token|pat|secret|passw|pwd|auth|bearer|jwt|session|cookie|credential|api[-_]?key|key|code|otp|sig)/i;
const CREDENTIAL_VALUE = /^(eyJ[\w-]+\.[\w-]+\.[\w-]*|tj_[\w-]{8,}|Bearer\s)/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^[\w.-][\w. -]{0,63}$/;
const FOLDER = /^[A-Za-z0-9][\w.-]{0,63}$/;

export const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);

/** Checks that `input` is exactly an origin: https, or http on a loopback host; no user, path, query or fragment. */
export function parseInstance(input: string): { ok: true; origin: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: 'The instance is not a valid address.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'The instance must be an https:// address.' };
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    return { ok: false, error: 'The instance must use https:// (plain http is only allowed for localhost).' };
  }
  if (url.username || url.password) return { ok: false, error: 'The instance address must not contain a user name or password.' };
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash || /[?#]/.test(input)) {
    return { ok: false, error: 'The instance must be an origin only (no path, query or fragment).' };
  }
  return { ok: true, origin: url.origin };
}

/**
 * Parses the path and raw query of an open link. `query` is the URI's query string without the leading `?`, as
 * `vscode.Uri.query` gives it.
 */
export function parseOpenUri(path: string, query: string, fragment = ''): ParseResult {
  if (path !== OPEN_PATH) return { ok: false, error: `Unknown ToolJet link (${path || '/'}).` };
  if (fragment) return { ok: false, error: 'The link has a fragment; ToolJet links never do.' };

  const params = new URLSearchParams(query);
  const seen = new Map<string, string>();
  for (const [name, value] of params) {
    if (CREDENTIAL_NAME.test(name) || CREDENTIAL_VALUE.test(value)) {
      return { ok: false, error: 'The link carries what looks like a credential. ToolJet links never do, so it was refused.' };
    }
    if (!ALLOWED.has(name)) return { ok: false, error: `The link has an unknown parameter "${name}".` };
    if (seen.has(name)) return { ok: false, error: `The link repeats the parameter "${name}".` };
    seen.set(name, value);
  }

  const instanceRaw = seen.get('instance');
  const appId = seen.get('app');
  if (!instanceRaw) return { ok: false, error: 'The link has no instance.' };
  if (!appId) return { ok: false, error: 'The link has no app id.' };

  const instance = parseInstance(instanceRaw);
  if (!instance.ok) return instance;
  if (!UUID.test(appId)) return { ok: false, error: 'The app id is not a UUID.' };

  const version = seen.get('version');
  if (version !== undefined && !VERSION.test(version)) return { ok: false, error: 'The version name has characters ToolJet links do not use.' };
  const folder = seen.get('folder');
  if (folder !== undefined && (!FOLDER.test(folder) || folder.includes('..'))) {
    return { ok: false, error: 'The folder name must be a plain name (letters, digits, dot, dash, underscore).' };
  }

  return {
    ok: true,
    value: { instance: instance.origin, appId: appId.toLowerCase(), ...(version ? { version } : {}), ...(folder ? { folder } : {}) },
  };
}

/** Builds the link, as the ToolJet "Open locally" panel should. `scheme` is vscode, cursor or windsurf. */
export function buildOpenUri(scheme: 'vscode' | 'cursor' | 'windsurf', req: OpenRequest): string {
  const q = new URLSearchParams({ instance: req.instance, app: req.appId });
  if (req.version) q.set('version', req.version);
  if (req.folder) q.set('folder', req.folder);
  return `${scheme}://tooljet.tooljet${OPEN_PATH}?${q.toString()}`;
}
