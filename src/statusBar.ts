import * as vscode from 'vscode';

import { DevStatus } from './cliOutput';
import { describeStatus, StatusProject } from './statusText';

/** One status bar item: the linked app, its instance and the dev loop's state. Hidden outside an app project. */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('tooljet.status', vscode.StatusBarAlignment.Left, 50);
  private project: StatusProject | undefined;
  private dev: DevStatus | undefined;
  private timer: NodeJS.Timeout;

  constructor() {
    this.item.name = 'ToolJet';
    this.item.command = 'tooljet.showMenu';
    // Keeps "uploaded 2 min ago" current.
    this.timer = setInterval(() => this.render(), 30_000);
  }

  setProject(project: StatusProject | undefined) {
    this.project = project;
    this.render();
  }

  setDev(status: DevStatus | undefined) {
    this.dev = status;
    this.render();
  }

  private render() {
    if (!this.project) return this.item.hide();
    const { text, tooltip, isError } = describeStatus(this.project, this.dev, new Date());
    this.item.text = text;
    const md = new vscode.MarkdownString(tooltip);
    md.isTrusted = false;
    this.item.tooltip = md;
    this.item.backgroundColor = isError ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
    this.item.show();
  }

  dispose() {
    clearInterval(this.timer);
    this.item.dispose();
  }
}
