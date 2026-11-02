import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

/*
  Live smoke test against a real ToolJet instance, opt-in:

    VSCODE_EXECUTABLE=".../Visual Studio Code.app/Contents/MacOS/Code" \
    LIVE_HOME=<home whose ~/.tooljet holds a login for the instance> LIVE_PARENT=<scratch folder> \
    LIVE_LINK='vscode://tooljet.tooljet/open?instance=...&app=...' TOOLJET_CLI=<path to tooljet> \
    node out/test/integration/runLive.js

  The CLI runs behind a wrapper that logs every call and refuses `app dev` and `app publish`, so the run can only
  read from the instance (plus the session the CLI opens from its token).
*/

async function main() {
  const repo = path.resolve(__dirname, '..', '..', '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tooljet-vscode-live-'));
  const userData = path.join(tmp, 'user-data');
  const transcript = path.join(tmp, 'transcript.txt');
  const cliLog = path.join(tmp, 'cli.log');
  const wrapper = path.join(tmp, 'tooljet');
  fs.writeFileSync(
    wrapper,
    `#!/bin/bash
set -o pipefail
case "$1 $2" in
  "app dev"|"app publish") echo "[wrapper] refused: tooljet $* (live run is read-only)" | tee -a "${cliLog}"; exit 1;;
esac
case "$*" in *--help|--version) exec "${process.env.TOOLJET_CLI}" "$@";; esac
echo "\\$ tooljet $*   (in $PWD)" >> "${cliLog}"
"${process.env.TOOLJET_CLI}" "$@" 2>&1 | tee -a "${cliLog}"
code=$?
echo "[exit $code]" >> "${cliLog}"
exit $code
`,
    { mode: 0o755 }
  );
  fs.writeFileSync(transcript, '');
  const codeCli = path.join(path.dirname(path.dirname(process.env.VSCODE_EXECUTABLE!)), 'Resources', 'app', 'bin', 'code');
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE,
    extensionDevelopmentPath: repo,
    extensionTestsPath: path.join(__dirname, 'liveSuite'),
    launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--skip-welcome', `--user-data-dir=${userData}`, `--extensions-dir=${path.join(tmp, 'extensions')}`],
    extensionTestsEnv: {
      HOME: process.env.LIVE_HOME!,
      LIVE_PARENT: process.env.LIVE_PARENT!,
      LIVE_LINK: process.env.LIVE_LINK!,
      LIVE_CLI: wrapper,
      LIVE_CLI_LOG: cliLog,
      LIVE_TRANSCRIPT: transcript,
      LIVE_USER_DATA: userData,
      LIVE_CODE_CLI: codeCli,
    },
  });
  console.log(fs.readFileSync(transcript, 'utf8'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
