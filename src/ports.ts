/*
  What the extension's flows need from the editor and the machine. extension.ts implements these with the VS Code
  API; the tests implement them with fakes, so the flows run without an editor and with the CLI mocked.
*/

export interface RunResult {
  code: number | null;
  /** Everything the process printed, stdout and stderr interleaved. */
  output: string;
}

export interface RunOptions {
  cwd: string;
  /** Terminal title. */
  title: string;
  /** Show the run in a terminal the user can see (and stop). Otherwise it goes to the ToolJet output channel. */
  visible: boolean;
  onOutput?: (chunk: string) => void;
}

export interface Running {
  done: Promise<RunResult>;
  kill(): void;
}

export interface CliRunner {
  /** Runs the `tooljet` CLI with these arguments. Never through a shell on macOS or Linux. */
  start(args: string[], options: RunOptions): Running;
  /** Runs `npm i -g @tooljet/cli` in a visible terminal. */
  installCli(): Promise<RunResult>;
}

export interface Ui {
  /** A modal question; resolves to the chosen action or undefined when dismissed. */
  ask(message: string, detail: string, actions: string[]): Promise<string | undefined>;
  pickParentFolder(defaultPath?: string): Promise<string | undefined>;
  inputFolderName(defaultName: string, validate: (value: string) => string | undefined): Promise<string | undefined>;
  inputVersion(prompt: string): Promise<string | undefined>;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface LinkRecord {
  appId: string;
  instance: string;
  folder: string;
}

export interface Store {
  lastParentFolder(): string | undefined;
  setLastParentFolder(folder: string): Promise<void>;
  links(): LinkRecord[];
  setLink(link: LinkRecord): Promise<void>;
  /** A folder opened from a link, whose new window should start `tooljet app dev`. */
  setPendingDev(folder: string): Promise<void>;
  takePendingDev(folder: string): Promise<boolean>;
}

export interface AppJson {
  name?: string;
  appId?: string;
  version?: { id?: string; name?: string };
}

export interface Host {
  exists(path: string): boolean;
  isEmptyDir(path: string): boolean;
  readAppJson(projectRoot: string): AppJson | undefined;
  join(...parts: string[]): string;
  loginState(instance: string): 'default' | 'stored' | 'none';
  defaultLoginOrigin(): string | undefined;
  openFolder(folder: string): Promise<void>;
}
