import { spawn } from 'child_process';
import * as os from 'os';
import * as vscode from 'vscode';

import { CliRunner, RunOptions, RunResult, Running } from './ports';
import { cliEnv, NPM_INSTALL_CLI, spawnSpec } from './spawnSpec';

/*
  Runs the CLI as a child process. A visible run shows in a terminal of its own (a pseudoterminal fed from the
  process, so the extension can also read the output and Ctrl+C stops it); a quiet run goes to the ToolJet output
  channel. Either way the extension, not a shell, starts the process.
*/

const CTRL_C = '\x03';

export class VscodeCli implements CliRunner {
  constructor(private readonly output: vscode.OutputChannel) {}

  private executable(): string {
    const configured = vscode.workspace.getConfiguration('tooljet').inspect<string>('cliPath')?.globalValue;
    return configured?.trim() || 'tooljet';
  }

  start(args: string[], options: RunOptions): Running {
    return this.spawnRun(this.executable(), args, options, 'tooljet');
  }

  installCli(): Promise<RunResult> {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    return this.spawnRun(npm, NPM_INSTALL_CLI, { cwd: os.homedir(), title: 'ToolJet: install CLI', visible: true }, 'npm').done;
  }

  private spawnRun(executable: string, args: string[], options: RunOptions, label: string): Running {
    const spec = spawnSpec(executable, args);
    const display = [label, ...args].join(' ');
    let output = '';
    let child: ReturnType<typeof spawn> | undefined;
    const write = new vscode.EventEmitter<string>();
    const closed = new vscode.EventEmitter<number | void>();
    let terminal: vscode.Terminal | undefined;

    let finished = false;
    const done = new Promise<RunResult>((resolve) => {
      const finish = (result: RunResult) => {
        finished = true;
        resolve(result);
      };
      const begin = () => {
        try {
          child = spawn(spec.command, spec.args, {
            cwd: options.cwd,
            shell: spec.shell,
            env: cliEnv(process.env, options.visible),
          });
        } catch (err) {
          const message = (err as Error).message;
          finish({ code: 127, output: message });
          return;
        }
        const onData = (data: Buffer) => {
          const text = data.toString('utf8');
          output += text;
          options.onOutput?.(text);
          if (terminal) write.fire(text.replace(/\r?\n/g, '\r\n'));
          else this.output.append(text);
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', (err: NodeJS.ErrnoException) => {
          const message = err.code === 'ENOENT' ? `${executable} was not found` : err.message;
          output += message;
          if (terminal) write.fire(`${message}\r\n`);
          finish({ code: 127, output });
        });
        child.on('close', (code) => {
          if (terminal) write.fire(`\r\n[${code === 0 ? 'done' : `exited with code ${code}`}] Press any key to close.\r\n`);
          else this.output.appendLine(`[${display}: exit ${code}]`);
          finish({ code, output });
        });
      };

      if (!options.visible) {
        this.output.appendLine(`$ ${display}  (in ${options.cwd})`);
        begin();
        return;
      }
      const pty: vscode.Pseudoterminal = {
        onDidWrite: write.event,
        onDidClose: closed.event,
        open: () => {
          write.fire(`\x1b[2m$ ${display}\x1b[0m\r\n`);
          begin();
        },
        close: () => {
          if (!finished) child?.kill('SIGINT');
        },
        handleInput: (data) => {
          if (finished) return closed.fire();
          if (data === CTRL_C) child?.kill('SIGINT');
          else child?.stdin?.write(data === '\r' ? '\n' : data);
        },
      };
      terminal = vscode.window.createTerminal({ name: options.title, pty, iconPath: new vscode.ThemeIcon('tools') });
      terminal.show(true);
    });

    return {
      done,
      kill: () => {
        child?.kill('SIGINT');
        setTimeout(() => child && child.exitCode === null && child.kill('SIGKILL'), 3000);
      },
    };
  }
}
