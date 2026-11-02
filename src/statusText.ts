import { DevStatus } from './cliOutput';

export interface StatusProject {
  name: string;
  appId: string;
  version?: string;
  instance?: string;
}

const hostOf = (origin: string) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

export const ago = (iso: string, now: Date): string => {
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return iso;
  if (s < 45) return 'just now';
  if (s < 90 * 60) return `${Math.max(1, Math.round(s / 60))} min ago`;
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Markdown special characters in names that come from the app or the CLI.
const md = (s: string) => s.replace(/([\\`*_{}[\]()#+\-.!|<>])/g, '\\$1');

/** The status bar text and tooltip, kept free of the VS Code API so it can be tested. */
export function describeStatus(project: StatusProject, dev: DevStatus | undefined, now: Date) {
  const where = project.instance ? ` · ${hostOf(project.instance)}` : '';
  let devText = '';
  let devLine = 'Dev: not running';
  let isError = false;
  switch (dev?.state) {
    case 'starting':
      devText = ' $(loading~spin)';
      devLine = 'Dev: starting';
      break;
    case 'running': {
      const errors = dev.findings.filter((f) => f.severity === 'error').length;
      const warnings = dev.findings.length - errors;
      devText = dev.lastUpload ? ` $(pass) ${ago(dev.lastUpload, now)}` : ' $(sync~spin)';
      devLine = dev.lastUpload ? `Dev: running, last upload ${ago(dev.lastUpload, now)} (built in ${dev.lastBuildMs})` : 'Dev: running, first build';
      if (warnings) {
        devText += ` $(warning) ${warnings}`;
        devLine += `, ${warnings} warning${warnings === 1 ? '' : 's'}`;
      }
      break;
    }
    case 'error':
      isError = true;
      devText = ' $(error) dev';
      devLine = `Dev: ${dev.error ?? 'failed'}`;
      break;
    case 'stopped':
      devText = ' $(debug-stop)';
      devLine = 'Dev: stopped';
      break;
  }
  const lines = [
    `**ToolJet: ${md(project.name)}**`,
    `App ${md(project.appId)}${project.version ? `, version ${md(project.version)}` : ''}`,
    `Instance: ${project.instance ? md(project.instance) : 'the CLI\'s current login'}`,
    md(devLine),
    '',
    'Click for ToolJet actions.',
  ];
  return { text: `$(tools) ${project.name.replace(/\$\(/g, "$\u200b(")}${where}${devText}`, tooltip: lines.join('\n\n'), isError };
}
