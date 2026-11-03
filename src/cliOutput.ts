/*
  Parsers for the text the `tooljet` CLI prints. The CLI has no machine-readable output yet (a `--json` flag is
  requested in the report), so these follow its current wording in cli/src/commands/app/{check,dev}.ts and
  cli/src/lib/log.ts, and ignore every line they do not recognise.
*/

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
export const stripAnsi = (s: string): string => s.replace(ANSI, '');

export type Severity = 'error' | 'warning';

export interface Finding {
  severity: Severity;
  /** Path relative to the project root (the folder holding app.json). */
  file: string;
  line: number;
  column?: number;
  message: string;
  source: string;
  code?: string;
}

export interface CheckResult {
  findings: Finding[];
  /** Errors that name no file, such as "app.json has no appId". */
  generalErrors: string[];
  passed: boolean;
}

// `check` reports app findings relative to frontend/ ("src/App.tsx") and jsx-a11y warnings relative to
// frontend/src ("App.tsx"); both are rebased here onto the project root.
const toProjectPath = (file: string, base: 'frontend' | 'frontend/src'): string => {
  const clean = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (clean.startsWith('frontend/')) return clean;
  return `${base}/${clean}`;
};

const ERROR_LINE = /^✗ Error : (.*)$/;
const FILE_MESSAGE = /^(\S.*?\.[cm]?[jt]sx?):(\d+)(?::(\d+))?\s+(.*)$/;
const A11Y_WARNING = /^warning (\S.*?):(\d+)\s+(.*?)(?: \(([\w/@-]+)\))?$/;
const TS_DIAGNOSTIC = /^(\S.*?\.[cm]?[jt]sx?)(?::(\d+):(\d+)| ?\((\d+),(\d+)\)):? - error (TS\d+): (.*)$/;

export function parseCheckOutput(output: string, exitCode: number): CheckResult {
  const findings: Finding[] = [];
  const generalErrors: string[] = [];
  for (const rawLine of stripAnsi(output).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const a11y = A11Y_WARNING.exec(line);
    if (a11y) {
      findings.push({
        severity: 'warning',
        file: toProjectPath(a11y[1], 'frontend/src'),
        line: Number(a11y[2]),
        message: a11y[3],
        source: 'tooljet (jsx-a11y)',
        ...(a11y[4] ? { code: a11y[4] } : {}),
      });
      continue;
    }
    const error = ERROR_LINE.exec(line);
    if (error) {
      const fm = FILE_MESSAGE.exec(error[1]);
      if (fm) {
        findings.push({
          severity: 'error',
          file: toProjectPath(fm[1], 'frontend'),
          line: Number(fm[2]),
          ...(fm[3] ? { column: Number(fm[3]) } : {}),
          message: fm[4],
          source: 'tooljet check',
        });
      } else {
        generalErrors.push(error[1]);
      }
    }
  }
  return { findings, generalErrors, passed: exitCode === 0 };
}

/* ---- tooljet app dev ---- */

export type DevState = 'starting' | 'running' | 'error' | 'stopped';

export interface DevStatus {
  state: DevState;
  /** ISO time of the last successful upload. */
  lastUpload?: string;
  lastBuildMs?: string;
  /** Short description of the last failure, when state is 'error'. */
  error?: string;
  /** Warnings and TypeScript errors from the last build cycle. */
  findings: Finding[];
  editorUrl?: string;
}

const DEV_READY = /^✓ (Live preview of |Dev track for )/;
const DEV_UPLOADED = /^✓ \[([0-9T:.\-Z]+)\] built in (\S+), uploaded/;
const DEV_LINKED = /^✓ Linked the app's code .*Open: (\S+)/;
const DEV_WARNING = /^⚠ Warning : (.*)$/;

/**
 * Follows the output of a running `tooljet app dev`, fed in arbitrary chunks. Findings of one build cycle are
 * collected until the cycle ends (an upload or a failure), then published as the current set.
 */
export class DevOutputParser {
  status: DevStatus = { state: 'starting', findings: [] };
  private pending: Finding[] = [];
  private buffer = '';
  private inTsReport = false;

  constructor(private readonly onChange: (status: DevStatus) => void = () => {}) {}

  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) this.line(stripAnsi(line).trim());
  }

  exited(code: number | null): void {
    if (this.buffer) this.feed('\n');
    if (code === 0 || code === null || this.status.state === 'error') {
      this.update({ state: code ? 'error' : 'stopped' });
    } else {
      this.update({ state: 'error', error: this.status.error ?? `tooljet app dev exited with code ${code}` });
    }
  }

  private update(patch: Partial<DevStatus>) {
    this.status = { ...this.status, ...patch };
    this.onChange(this.status);
  }

  private line(line: string) {
    if (!line) return;
    let m: RegExpExecArray | null;
    if (DEV_READY.test(line)) return this.update({ state: 'running', error: undefined });
    if ((m = DEV_UPLOADED.exec(line))) {
      this.inTsReport = false;
      const findings = this.pending;
      this.pending = [];
      return this.update({ state: 'running', lastUpload: m[1], lastBuildMs: m[2], error: undefined, findings });
    }
    if ((m = DEV_LINKED.exec(line))) return this.update({ editorUrl: m[1] });
    if ((m = DEV_WARNING.exec(line))) {
      const fm = FILE_MESSAGE.exec(m[1]);
      if (fm) {
        this.pending.push({
          severity: 'warning',
          file: toProjectPath(fm[1], 'frontend'),
          line: Number(fm[2]),
          message: fm[4],
          source: 'tooljet live preview',
        });
      }
      return;
    }
    if ((m = TS_DIAGNOSTIC.exec(line))) {
      const finding: Finding = {
        severity: 'error',
        file: toProjectPath(m[1], 'frontend'),
        line: Number(m[2] ?? m[4]),
        column: Number(m[3] ?? m[5]),
        message: m[7],
        source: 'tooljet live preview (tsc)',
        code: m[6],
      };
      // The report follows its "not uploaded" line, which already ended the cycle: add to the shown set.
      if (this.inTsReport) return this.update({ findings: [...this.status.findings, finding] });
      this.pending.push(finding);
      return;
    }
    if ((m = ERROR_LINE.exec(line))) {
      this.inTsReport = /TypeScript error\(s\); not uploaded/.test(m[1]);
      const findings = this.pending;
      this.pending = [];
      return this.update({ state: 'error', error: m[1], findings });
    }
  }
}
