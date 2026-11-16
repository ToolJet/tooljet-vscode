import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { DevStatus, Finding } from './cliOutput';
import { loginStateFor, readStoredLogins } from './credentials';
import { Deps, openFromLink } from './openFlow';
import { AppJson, Host, LinkRecord, Store, Ui } from './ports';
import * as project from './projectCommands';
import { cliTarballUrl, tarballOriginAllowed } from './spawnSpec';
import { StatusBar } from './statusBar';
import { parseInstance, parseOpenUri } from './uri';
import { VscodeCli } from './vscodeCli';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING_TTL_MS = 10 * 60 * 1000;
const START_PREVIEW = 'Start live preview';

class GlobalStore implements Store {
  constructor(private readonly state: vscode.Memento) {}
  lastParentFolder = () => this.state.get<string>('tooljet.lastParentFolder');
  setLastParentFolder = (folder: string) => Promise.resolve(this.state.update('tooljet.lastParentFolder', folder));
  links = () => this.state.get<LinkRecord[]>('tooljet.links', []);
  setLink = async (link: LinkRecord) => {
    const rest = this.links().filter((l) => l.folder !== link.folder);
    await this.state.update('tooljet.links', [...rest, link].slice(-50));
  };
  setPendingDev = (folder: string) => Promise.resolve(this.state.update('tooljet.pendingDev', { folder, at: Date.now() }));
  takePendingDev = async (folder: string) => {
    const pending = this.state.get<{ folder: string; at: number }>('tooljet.pendingDev');
    if (!pending || pending.folder !== folder) return false;
    await this.state.update('tooljet.pendingDev', undefined);
    return Date.now() - pending.at < PENDING_TTL_MS;
  };
}

const host: Host = {
  exists: (p) => fs.existsSync(p),
  isEmptyDir: (p) => {
    try {
      return fs.readdirSync(p).length === 0;
    } catch {
      return false;
    }
  },
  readAppJson: (root) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')) as AppJson;
    } catch {
      return undefined;
    }
  },
  join: (...parts) => path.join(...parts),
  loginState: (instance) => loginStateFor(instance),
  defaultLoginOrigin: () => readStoredLogins().defaultOrigin,
  defaultParentFolder: () => {
    const folder = path.join(os.homedir(), 'ToolJet apps');
    try {
      fs.mkdirSync(folder, { recursive: true });
    } catch {
      return os.homedir();
    }
    return folder;
  },
  gitRepositoryOf: (start) => {
    for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
      if (path.dirname(dir) === dir) return undefined;
    }
  },
  cliTarball: async (origin) => {
    // HEAD, so nothing is downloaded; a gzip answer, since a dev frontend answers every path with its index.html.
    if (!tarballOriginAllowed(origin)) return undefined;
    const url = cliTarballUrl(origin);
    try {
      const res = await fetch(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(5000) });
      return res.ok && /gzip|octet-stream/.test(res.headers.get('content-type') ?? '') ? url : undefined;
    } catch {
      return undefined;
    }
  },
  openFolder: async (folder) => {
    const forceNewWindow = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), { forceNewWindow });
  },
};

const ui: Ui = {
  ask: (message, detail, actions, options) =>
    Promise.resolve(
      options?.warning
        ? vscode.window.showWarningMessage(message, { modal: true, detail }, ...actions)
        : vscode.window.showInformationMessage(message, { modal: true, detail }, ...actions)
    ),
  pickParentFolder: async (defaultPath) => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Clone here',
      title: 'Folder to clone the ToolJet app into',
      ...(defaultPath && fs.existsSync(defaultPath) ? { defaultUri: vscode.Uri.file(defaultPath) } : {}),
    });
    return picked?.[0]?.fsPath;
  },
  inputFolderName: (defaultName, validate, describe) =>
    Promise.resolve(
      vscode.window.showInputBox({
        title: 'Folder name for the app',
        value: defaultName,
        // A valid name shows where the clone goes, so the full path is in view before anything is written.
        validateInput: (value) => validate(value) ?? { message: describe(value), severity: vscode.InputBoxValidationSeverity.Info },
        ignoreFocusOut: true,
      })
    ),
  inputServerAddress: (suggestion, validate) =>
    Promise.resolve(
      vscode.window.showInputBox({
        title: "ToolJet server address",
        prompt: 'The address of ToolJet\'s server (API), for example https://tooljet-api.example.com or http://localhost:3000',
        value: suggestion,
        validateInput: validate,
        ignoreFocusOut: true,
      })
    ),
  pickCliPath: async () => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Use this CLI',
      title: 'The tooljet executable (for example cli/bin/run in a ToolJet checkout)',
    });
    return picked?.[0]?.fsPath;
  },
  inputVersion: (prompt) => Promise.resolve(vscode.window.showInputBox({ title: 'ToolJet: Publish', prompt, ignoreFocusOut: true })),
  info: (m) => void vscode.window.showInformationMessage(m),
  warn: (m) => void vscode.window.showWarningMessage(m),
  error: (m) => void vscode.window.showErrorMessage(m),
};

const toDiagnostics = (root: string, findings: Finding[]): Map<string, vscode.Diagnostic[]> => {
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const f of findings) {
    const line = Math.max(0, f.line - 1);
    const col = Math.max(0, (f.column ?? 1) - 1);
    const d = new vscode.Diagnostic(
      new vscode.Range(line, col, line, f.column ? col + 1 : Number.MAX_SAFE_INTEGER),
      f.message,
      f.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
    );
    d.source = f.source;
    if (f.code) d.code = f.code;
    const file = path.join(root, f.file);
    byFile.set(file, [...(byFile.get(file) ?? []), d]);
  }
  return byFile;
};

const showFindings = (collection: vscode.DiagnosticCollection, root: string, findings: Finding[]) => {
  collection.clear();
  for (const [file, diags] of toDiagnostics(root, findings)) collection.set(vscode.Uri.file(file), diags);
};

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('ToolJet');
  const checkProblems = vscode.languages.createDiagnosticCollection('tooljet-check');
  const devProblems = vscode.languages.createDiagnosticCollection('tooljet-dev');
  const store = new GlobalStore(context.globalState);
  const deps: Deps = {
    ui,
    cli: new VscodeCli(output),
    host,
    store,
    setCliPath: async (cliPath) => {
      await vscode.workspace.getConfiguration('tooljet').update('cliPath', cliPath, vscode.ConfigurationTarget.Global);
      deps.cli = new VscodeCli(output);
    },
  };
  const statusBar = new StatusBar();
  context.subscriptions.push(output, checkProblems, devProblems, statusBar);

  let dev: project.DevHandle | undefined;
  let opening = false;

  const currentProject = () =>
    project.findProject((vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath), deps);

  const refresh = () => {
    const p = currentProject();
    void vscode.commands.executeCommand('setContext', 'tooljet.linked', !!p);
    void vscode.commands.executeCommand('setContext', 'tooljet.devRunning', !!dev);
    statusBar.setProject(p && { name: p.app.name ?? 'ToolJet app', appId: p.app.appId, version: p.app.version?.name, instance: project.instanceOf(p, deps) });
    return p;
  };

  const withProject = (fn: (p: project.Project) => Promise<unknown>) => async () => {
    const p = refresh();
    if (!p) return void vscode.window.showWarningMessage('No ToolJet app here: open a folder with an app.json that has an appId.');
    if (!vscode.workspace.isTrusted) return void vscode.window.showWarningMessage('ToolJet commands run the app\'s build, so they need a trusted workspace.');
    await fn(p);
  };

  const startDev = withProject(async (p) => {
    if (dev) {
      const choice = await vscode.window.showInformationMessage('Live preview is already on.', 'Restart', 'Show');
      if (choice === 'Show') return;
      if (choice !== 'Restart') return;
      dev.running.kill();
      await dev.running.done;
    }
    const handle = await project.startDev(p, deps, (status: DevStatus) => {
      statusBar.setDev(status);
      showFindings(devProblems, p.root, status.findings);
    });
    if (!handle) return;
    dev = handle;
    refresh();
    handle.running.done.then(() => {
      if (dev === handle) dev = undefined;
      refresh();
    });
  });

  const stopDev = async () => {
    dev?.running.kill();
  };

  const openApp = async () => {
    const instance = await vscode.window.showInputBox({
      title: 'ToolJet: Open app (1/2)',
      prompt: 'Your ToolJet instance (its API origin), for example https://tooljet.example.com',
      ignoreFocusOut: true,
      validateInput: (v) => {
        const r = parseInstance(v.trim());
        return r.ok ? undefined : r.error;
      },
    });
    if (!instance) return;
    const appId = await vscode.window.showInputBox({
      title: 'ToolJet: Open app (2/2)',
      prompt: 'The app id (from the editor address, /apps/<app id>/...)',
      ignoreFocusOut: true,
      validateInput: (v) => (UUID.test(v.trim()) ? undefined : 'An app id is a UUID.'),
    });
    if (!appId) return;
    const origin = parseInstance(instance.trim());
    if (origin.ok) await runOpen({ instance: origin.origin, appId: appId.trim().toLowerCase() }, true);
  };

  const runOpen = async (req: Parameters<typeof openFromLink>[0], typed = false) => {
    if (opening) return void vscode.window.showWarningMessage('A ToolJet app is already being opened.');
    opening = true;
    try {
      const outcome = await openFromLink(req, deps, os.homedir(), typed);
      output.appendLine(`Open app ${req.appId} from ${req.instance}: ${outcome}`);
    } catch (err) {
      vscode.window.showErrorMessage(`Opening the ToolJet app failed: ${(err as Error).message}`);
    } finally {
      opening = false;
    }
  };

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async (uri) => {
        const parsed = parseOpenUri(uri.path, uri.query, uri.fragment);
        if (!parsed.ok) {
          // The link itself is never logged: a hostile one may carry a secret.
          output.appendLine(`Refused a ToolJet link: ${parsed.error}`);
          return void vscode.window.showErrorMessage(`ToolJet link refused: ${parsed.error}`);
        }
        await runOpen(parsed.value);
      },
    }),
    vscode.commands.registerCommand('tooljet.openApp', openApp),
    vscode.commands.registerCommand('tooljet.startDev', startDev),
    vscode.commands.registerCommand('tooljet.stopDev', stopDev),
    vscode.commands.registerCommand('tooljet.pull', withProject((p) => project.pull(p, deps))),
    vscode.commands.registerCommand(
      'tooljet.check',
      withProject(async (p) => {
        const result = await project.check(p, deps);
        if (result) showFindings(checkProblems, p.root, result.findings);
        if (result?.findings.some((f) => f.severity === 'error')) void vscode.commands.executeCommand('workbench.actions.view.problems');
      })
    ),
    vscode.commands.registerCommand('tooljet.publish', withProject((p) => project.publish(p, deps))),
    vscode.commands.registerCommand('tooljet.installAgentInstructions', withProject((p) => project.installAgentInstructions(p, deps))),
    vscode.commands.registerCommand('tooljet.showMenu', async () => {
      const items: (vscode.QuickPickItem & { command: string })[] = [
        dev ? { label: '$(debug-stop) Stop live preview', command: 'tooljet.stopDev' } : { label: '$(play) Start live preview', command: 'tooljet.startDev' },
        { label: '$(cloud-download) Pull', description: 'types for queries, tables and routes', command: 'tooljet.pull' },
        { label: '$(checklist) Check', description: 'queries, routes and pages the code names', command: 'tooljet.check' },
        { label: '$(rocket) Publish', command: 'tooljet.publish' },
        { label: '$(book) Install agent instructions', command: 'tooljet.installAgentInstructions' },
      ];
      const editorUrl = dev?.parser.status.editorUrl;
      if (editorUrl) items.push({ label: '$(link-external) Open in ToolJet', description: editorUrl, command: 'open-editor' });
      const pick = await vscode.window.showQuickPick(items, { title: 'ToolJet' });
      if (!pick) return;
      if (pick.command === 'open-editor' && editorUrl) return void vscode.env.openExternal(vscode.Uri.parse(editorUrl));
      await vscode.commands.executeCommand(pick.command);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      // A runner is checked once; a changed path gets a new one (setCliPath has already made it when it changed the path).
      if (e.affectsConfiguration('tooljet.cliPath')) deps.cli = new VscodeCli(output);
    }),
    { dispose: () => dev?.running.kill() }
  );

  /*
    A window opened from a link offers the live preview; it never starts it. `tooljet app dev` builds the cloned code
    on this computer (its PostCSS config runs in Node), so that is the user's own click, here, after they have seen
    the folder.
  */
  const p = refresh();
  if (p) {
    void store.takePendingDev(p.root).then(async (pending) => {
      if (!pending) return;
      const where = project.instanceOf(p, deps);
      const choice = await vscode.window.showInformationMessage(
        `Opened ${p.app.name ?? 'the ToolJet app'}${where ? ` from ${where}` : ''}. Start its live preview when you are ready: it builds the app's code on this computer.`,
        START_PREVIEW
      );
      if (choice === START_PREVIEW) await startDev();
    });
  }
}

export function deactivate(): void {}
