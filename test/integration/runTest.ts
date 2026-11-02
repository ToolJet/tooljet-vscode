import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

/*
  Runs the extension in a real VS Code, isolated from the user's: its own user-data and extensions folders, a
  temporary HOME (so ~/.tooljet is a fake), and a fake `tooljet` CLI. Nothing contacts a ToolJet instance.
  VSCODE_EXECUTABLE points at an installed VS Code; without it, test-electron downloads one.
*/

async function main() {
  const repo = path.resolve(__dirname, '..', '..', '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tooljet-vscode-it-'));
  const home = path.join(tmp, 'home');
  const workspace = path.join(tmp, 'demo');
  fs.mkdirSync(path.join(home, '.tooljet'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.tooljet', 'credentials.json'),
    JSON.stringify({ default: 'w', workspaces: { w: { url: 'http://localhost:3055', apiToken: 'FAKE', email: 'dev@example.com' } } })
  );
  fs.mkdirSync(path.join(workspace, 'frontend', 'src', 'App'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'app.json'), JSON.stringify({ name: 'Demo', appId: '11111111-2222-4333-8444-555555555555', routes: [] }));
  fs.writeFileSync(path.join(workspace, 'frontend', 'src', 'App', 'index.tsx'), Array(40).fill('// line').join('\n'));

  const log = path.join(tmp, 'calls.jsonl');
  fs.writeFileSync(log, '');
  await runTests({
    ...(process.env.VSCODE_EXECUTABLE ? { vscodeExecutablePath: process.env.VSCODE_EXECUTABLE } : {}),
    extensionDevelopmentPath: repo,
    extensionTestsPath: path.join(__dirname, 'suite'),
    launchArgs: [
      workspace,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      `--user-data-dir=${path.join(tmp, 'user-data')}`,
      `--extensions-dir=${path.join(tmp, 'extensions')}`,
    ],
    extensionTestsEnv: {
      HOME: home,
      FAKE_TOOLJET_LOG: log,
      FAKE_TOOLJET: path.join(repo, 'test', 'integration', 'fake-tooljet.js'),
      IT_WORKSPACE: workspace,
    },
  });
  console.log(`Integration test passed. CLI calls: ${log}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
