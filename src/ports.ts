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
  /** Runs `npm i -g <spec>` in a visible terminal (installs or updates): a tarball URL, or npm's package. */
  installCli(spec: string): Promise<RunResult>;
}

export interface Ui {
  /**
   * A modal question; resolves to the chosen action or undefined when dismissed. `warning` shows it as a warning
   * (a server new to this computer, a program about to be installed from one).
   */
  ask(message: string, detail: string, actions: string[], options?: { warning?: boolean }): Promise<string | undefined>;
  pickParentFolder(defaultPath?: string): Promise<string | undefined>;
  /** `describe` says, for a valid name, where the clone goes. */
  inputFolderName(
    defaultName: string,
    validate: (value: string) => string | undefined,
    describe: (value: string) => string
  ): Promise<string | undefined>;
  /** Asks for a ToolJet server address (an origin), prefilled with `suggestion`. */
  inputServerAddress(suggestion: string, validate: (value: string) => string | undefined): Promise<string | undefined>;
  inputVersion(prompt: string): Promise<string | undefined>;
  /** A file dialog for the `tooljet` executable. */
  pickCliPath(): Promise<string | undefined>;
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
  /**
   * A folder opened from a link, whose new window offers a "Start live preview" button. It never starts
   * `tooljet app dev` by itself: that builds the app's code (its PostCSS config included) on this computer.
   */
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
  /** Where clones go when the user has not picked a parent folder yet (~/ToolJet apps, created when missing). */
  defaultParentFolder(): string;
  /** The root of the Git repository that contains `path`, if any. */
  gitRepositoryOf(path: string): string | undefined;
  /** The URL of the CLI tarball this ToolJet server serves, if it serves one (a HEAD request; nothing is downloaded). */
  cliTarball(origin: string): Promise<string | undefined>;
  openFolder(folder: string): Promise<void>;
}
