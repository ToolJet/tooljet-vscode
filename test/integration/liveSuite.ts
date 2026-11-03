import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';

/*
  Live smoke test (opt-in, see runLive.ts): opens LIVE_LINK through the editor's own URL handling, so it reaches the
  extension's URI handler, and answers every question automatically, writing each to LIVE_TRANSCRIPT. The sign-in
  question is declined: the live run expects the CLI to be signed in already, and never mints a token itself.
  This file sits in the extension folder, so it shares the extension's `vscode` API object and its stubs apply.
*/

const transcript = process.env.LIVE_TRANSCRIPT!;
const note = (line: string) => fs.appendFileSync(transcript, line + '\n');

export async function run(): Promise<void> {
  const parent = process.env.LIVE_PARENT!;
  const w = vscode.window as any;
  w.showInformationMessage = async (message: string, ...rest: any[]) => {
    const modal = typeof rest[0] === 'object' && rest[0]?.modal;
    const actions: string[] = modal ? rest.slice(1) : rest;
    if (!modal) return void note(`[info] ${message}`);
    const answer = /^Sign in/.test(message) ? undefined : actions[0];
    note(`[modal] ${message}\n        ${String(rest[0].detail ?? '').replace(/\n+/g, ' ')}\n        buttons: ${actions.join(', ')} -> ${answer ?? 'dismissed'}`);
    return answer;
  };
  w.showWarningMessage = async (m: string) => void note(`[warning] ${m}`);
  w.showErrorMessage = async (m: string) => void note(`[error] ${m}`);
  w.showOpenDialog = async (o: any) => {
    note(`[folder picker] ${o.title} (default ${o.defaultUri?.fsPath ?? 'none'}) -> ${parent}`);
    return [vscode.Uri.file(parent)];
  };
  w.showInputBox = async (o: any) => {
    // A string is a refusal; an object is an information line (the clone's full path).
    const result = o.validateInput ? await o.validateInput(o.value) : undefined;
    const error = typeof result === 'string' ? result : undefined;
    const info = typeof result === 'object' && result ? ` (${result.message})` : '';
    note(`[input] ${o.title}: "${o.value}"${error ? ` (refused: ${error})` : info} -> ${error ? 'cancelled' : 'accepted'}`);
    return error ? undefined : o.value;
  };
  const opened = vscode.commands.executeCommand;
  (vscode.commands as any).executeCommand = async (id: string, ...args: any[]) => {
    if (id === 'vscode.openFolder') {
      note(`[open folder] ${args[0].fsPath} (new window: ${!!args[1]?.forceNewWindow})`);
      return;
    }
    return opened(id, ...args);
  };

  await vscode.workspace.getConfiguration('tooljet').update('cliPath', process.env.LIVE_CLI, vscode.ConfigurationTarget.Global);
  await vscode.extensions.getExtension('tooljet.tooljet')!.activate();

  note(`[link] ${process.env.LIVE_LINK}`);
  // The editor's command-line URL route, as the OS uses when a browser opens a vscode:// link.
  spawn(process.env.LIVE_CODE_CLI!, [`--user-data-dir=${process.env.LIVE_USER_DATA}`, '--open-url', process.env.LIVE_LINK!], { stdio: 'ignore' });

  const log = process.env.LIVE_CLI_LOG!;
  const end = Date.now() + 5 * 60 * 1000;
  while (!/^\[open folder\]|^\[error\]|dismissed$/m.test(fs.readFileSync(transcript, 'utf8'))) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1500));
  note(`\n[cli calls]\n${fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '(none)'}`);
}
