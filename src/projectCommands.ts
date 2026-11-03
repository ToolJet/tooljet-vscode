import { CheckResult, DevOutputParser, DevStatus, parseCheckOutput } from './cliOutput';
import { Deps, ensureCli, ensureLogin, lastError } from './openFlow';
import { AppJson, Running } from './ports';

/* The commands that work on the open app project: start dev, pull, check, publish, install agent instructions. */

export interface Project {
  root: string;
  app: AppJson & { appId: string };
  /** The instance this folder was opened from, when the extension linked it. */
  instance?: string;
}

export function findProject(roots: string[], deps: Pick<Deps, 'host' | 'store'>): Project | undefined {
  for (const root of roots) {
    const app = deps.host.readAppJson(root);
    if (!app?.appId) continue;
    const link = deps.store.links().find((l) => l.folder === root && l.appId === app.appId);
    return { root, app: app as Project['app'], instance: link?.instance };
  }
  return undefined;
}

/** The instance the CLI will talk to for this project: the linked one, else the CLI's default login. */
export const instanceOf = (project: Project, deps: Pick<Deps, 'host'>): string | undefined =>
  project.instance ?? deps.host.defaultLoginOrigin();

/**
 * The CLI's app commands use its default login, so before running one the default must be the instance this
 * project was opened from (another `tooljet auth login` elsewhere may have changed it).
 */
async function ready(project: Project, deps: Deps): Promise<boolean> {
  if (!(await ensureCli(deps, project.root, instanceOf(project, deps)))) return false;
  if (project.instance) return ensureLogin(deps, project.instance, project.root);
  if (!deps.host.defaultLoginOrigin()) {
    deps.ui.error('The ToolJet CLI is not signed in. Open the app from ToolJet ("Open in VS Code"), or run "tooljet auth login --url <instance>".');
    return false;
  }
  return true;
}

export async function pull(project: Project, deps: Deps): Promise<boolean> {
  if (!(await ready(project, deps))) return false;
  const result = await deps.cli.start(['app', 'pull'], { cwd: project.root, title: 'ToolJet: pull', visible: false }).done;
  if (result.code === 0) deps.ui.info('Pulled the app: frontend/src/tooljet.gen.ts is up to date.');
  else deps.ui.error(`Pull failed: ${lastError(result)}`);
  return result.code === 0;
}

export async function check(project: Project, deps: Deps): Promise<CheckResult | undefined> {
  if (!(await ready(project, deps))) return undefined;
  const result = await deps.cli.start(['app', 'check'], { cwd: project.root, title: 'ToolJet: check', visible: false }).done;
  const parsed = parseCheckOutput(result.output, result.code ?? 1);
  const errors = parsed.findings.filter((f) => f.severity === 'error').length;
  const warnings = parsed.findings.length - errors;
  if (parsed.generalErrors.length) deps.ui.error(`Check failed: ${parsed.generalErrors[parsed.generalErrors.length - 1]}`);
  else if (!parsed.passed) deps.ui.error(`Check found ${errors} problem${errors === 1 ? '' : 's'}: see the Problems panel.`);
  else deps.ui.info(warnings ? `Check passed with ${warnings} accessibility warning${warnings === 1 ? '' : 's'}.` : 'Check passed: no problems.');
  return parsed;
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export async function publish(project: Project, deps: Deps): Promise<boolean> {
  if (!(await ready(project, deps))) return false;
  const version = await deps.ui.inputVersion('Version to publish (for example 1.2.0)');
  if (!version) return false;
  if (!SEMVER.test(version)) {
    deps.ui.error(`"${version}" is not a version number like 1.2.0.`);
    return false;
  }
  const where = instanceOf(project, deps) ?? 'the signed-in instance';
  const confirmed = await deps.ui.ask(
    `Publish ${project.app.name ?? 'this app'} ${version}?`,
    `This checks the code, builds it for production and publishes it to ${where}, pinning the app's editing version to it.`,
    ['Publish']
  );
  if (confirmed !== 'Publish') return false;
  const result = await deps.cli.start(['app', 'publish', '-v', version], { cwd: project.root, title: 'ToolJet: publish', visible: true }).done;
  if (result.code === 0) deps.ui.info(`Published ${version}.`);
  else deps.ui.error(`Publish failed: ${lastError(result)}`);
  return result.code === 0;
}

export async function installAgentInstructions(project: Project, deps: Deps): Promise<boolean> {
  if (!(await ensureCli(deps, project.root, instanceOf(project, deps)))) return false;
  const result = await deps.cli.start(['skill', 'install'], { cwd: project.root, title: 'ToolJet: agent instructions', visible: false }).done;
  if (result.code === 0) deps.ui.info('Wrote the ToolJet agent instructions: CLAUDE.md, AGENTS.md and .cursor/rules/tooljet.mdc.');
  else deps.ui.error(`Installing agent instructions failed: ${lastError(result)}`);
  return result.code === 0;
}

export interface DevHandle {
  running: Running;
  parser: DevOutputParser;
}

/** Starts `tooljet app dev` in a visible terminal and follows its output. */
export async function startDev(project: Project, deps: Deps, onStatus: (status: DevStatus) => void): Promise<DevHandle | undefined> {
  if (!(await ready(project, deps))) return undefined;
  const parser = new DevOutputParser(onStatus);
  onStatus(parser.status);
  const running = deps.cli.start(['app', 'dev'], {
    cwd: project.root,
    title: 'ToolJet: live preview',
    visible: true,
    onOutput: (chunk) => parser.feed(chunk),
  });
  running.done.then((r) => parser.exited(r.code), () => parser.exited(1));
  return { running, parser };
}
