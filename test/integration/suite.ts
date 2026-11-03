import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/* Runs inside the test VS Code (see runTest.ts). Plain assertions; the first failure fails the run. */

const wait = async (what: string, cond: () => boolean, ms = 10000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

const calls = () =>
  fs
    .readFileSync(process.env.FAKE_TOOLJET_LOG!, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { args: string[]; cwd: string })
    .filter((c) => !c.args.includes('--help') && !c.args.includes('--version'))
    .map((c) => c.args.join(' '));

export async function run(): Promise<void> {
  const workspace = process.env.IT_WORKSPACE!;
  const ext = vscode.extensions.getExtension('tooljet.tooljet');
  assert.ok(ext, 'extension tooljet.tooljet is installed');
  await ext!.activate();
  assert.ok(ext!.isActive, 'extension activates');

  const commands = await vscode.commands.getCommands(true);
  for (const c of ['tooljet.openApp', 'tooljet.startDev', 'tooljet.stopDev', 'tooljet.pull', 'tooljet.check', 'tooljet.publish', 'tooljet.installAgentInstructions']) {
    assert.ok(commands.includes(c), `${c} is registered`);
  }

  await vscode.workspace.getConfiguration('tooljet').update('cliPath', process.env.FAKE_TOOLJET, vscode.ConfigurationTarget.Global);

  // Check: the fixture's findings land in the Problems panel at the right file and lines.
  await vscode.commands.executeCommand('tooljet.check');
  const file = vscode.Uri.file(path.join(workspace, 'frontend', 'src', 'App', 'index.tsx'));
  await wait('diagnostics', () => vscode.languages.getDiagnostics(file).length === 3);
  const diags = vscode.languages.getDiagnostics(file).map((d) => [d.severity, d.range.start.line, d.source, d.message.slice(0, 20)]);
  assert.deepStrictEqual(
    diags.sort(),
    [
      [vscode.DiagnosticSeverity.Error, 28, 'tooljet check', 'link to "/nowhere" m'],
      [vscode.DiagnosticSeverity.Error, 28, 'tooljet check', 'query "listOrders" d'],
      [vscode.DiagnosticSeverity.Warning, 28, 'tooljet (jsx-a11y)', 'img elements must ha'],
    ].sort()
  );

  await vscode.commands.executeCommand('tooljet.pull');
  await vscode.commands.executeCommand('tooljet.installAgentInstructions');

  // Live preview: runs in a terminal of its own and stops on command.
  await vscode.commands.executeCommand('tooljet.startDev');
  await wait('live preview terminal', () => vscode.window.terminals.some((t) => t.name === 'ToolJet: live preview'));
  await wait('dev call', () => calls().includes('app dev'));
  await new Promise((r) => setTimeout(r, 800));
  await vscode.commands.executeCommand('tooljet.stopDev');

  assert.deepStrictEqual(calls(), ['app check', 'app pull', 'skill install', 'app dev']);
  const cwds = fs
    .readFileSync(process.env.FAKE_TOOLJET_LOG!, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l).cwd);
  assert.ok(cwds.every((c: string) => fs.realpathSync(c) === fs.realpathSync(workspace)), 'every call runs in the project');
}
