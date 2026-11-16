# ToolJet for VS Code, Cursor and Windsurf

Work on a ToolJet **Code mode** app in your editor: open it from ToolJet with one click, keep its live preview running,
and check, pull and publish without leaving the editor. The extension drives the `tooljet` CLI; it holds no
credentials of its own.

## Install

The extension is not on a marketplace yet. Install the `.vsix`:

- **VS Code**: Extensions view → `...` → *Install from VSIX...*, or `code --install-extension tooljet-0.1.4.vsix`
- **Cursor**: `cursor --install-extension tooljet-0.1.4.vsix`, or drag the file into the Extensions view
- **Windsurf**: `windsurf --install-extension tooljet-0.1.4.vsix`, or *Install from VSIX...* in the Extensions view

Build it yourself with `npm ci && npm run package` (it lands in `dist/`).

You also need the ToolJet CLI with the Code mode commands (`tooljet app ...`, `tooljet auth login`). The extension
offers to install it when it is missing, in a terminal you can watch, and only if you agree: from a ToolJet server
you have signed in to before, or typed in yourself (`npm i -g <server>/api/code-mode/cli/tooljet-cli.tgz`, the CLI
that server was built with, https or a local stack only) when it serves one, else `npm i -g @tooljet/cli@latest`. A
server only a link named is never asked first: npm is offered, and that server's CLI only through
**Install the server's CLI...** and a second warning that names the download. When the CLI is out of date (no `app` commands, like npm's 0.0.14), it offers **Update the CLI**, which replaces the older `tooljet`, and **Choose a CLI...**: the second
picks a `tooljet` executable, for example `cli/bin/run` in a ToolJet checkout, and saves it as **ToolJet: Cli Path**
(`tooljet.cliPath`, a user setting).

## Open an app from ToolJet

In the ToolJet editor, **Code → Open locally → Open in VS Code / Cursor / Windsurf** opens a link like:

```
vscode://tooljet.tooljet/open?instance=https%3A%2F%2Ftooljet.example.com&app=421df0e7-861a-43fd-9b31-fa67f6649dfa
```

The extension then:

1. shows the instance and app and asks you to confirm before contacting anything. A server you have never signed in
   to from this computer gets a warning instead, naming it in full as a new server;
2. checks the `tooljet` CLI is installed and new enough (and offers to install, update or choose one);
3. runs `tooljet auth login --url <server>` in a terminal if the CLI is not signed in to ToolJet's server (the link's
   `api`, else its `instance`): you approve the code in your browser, and the CLI stores the token. Signing in keeps
   the CLI's default login: only the folder cloned from that server uses the new one. If that address has no browser
   sign-in (a frontend served apart from its API), it asks for the server address;
4. asks for a parent folder and a folder name. The first time it starts in `~/ToolJet apps`, then in the last folder
   you used; a folder inside a Git repository needs confirming; the full path of the clone shows as you type the name;
5. runs `tooljet app clone --instance <server>` (the CLI records the server in the project's
   `.tooljet/instance.json`, and its commands there use that server's login), `tooljet app checkout <version>` when the link names one, `tooljet app source-pull` (the
   app's code ToolJet stores, when the CLI has the command) and `tooljet app install` (npm, pnpm or yarn with install
   scripts off);
6. opens the folder in a new window, which offers **Start live preview** (`tooljet app dev` in a terminal). It never
   starts by itself: the live preview builds the app's code, its PostCSS config included, on this computer.

If the app is already cloned into a folder this editor knows, it offers to open that folder instead. The live
preview is offered only when the folder holds the app's code: code the ToolJet editor owns, or a new app. When the
app's code isn't saved in ToolJet, or its Git repository owns it, the extension clones and opens the project without
the offer, so it never replaces your live preview with the starter template or a copy.

### Link format

```
<scheme>://tooljet.tooljet/open?instance=<origin>&app=<app id>[&api=<origin>][&version=<version name>][&folder=<folder name>]
```

| Parameter | Required | Rules |
|---|---|---|
| `scheme` | | `vscode`, `vscode-insiders`, `cursor` or `windsurf` (the editor that should open it) |
| `instance` | yes | the ToolJet origin the link came from: `https://host[:port]`, or `http://` only for `localhost`, `127.x.x.x` or `[::1]`; no user, path, query or fragment |
| `app` | yes | the app id, a UUID |
| `api` | no | ToolJet's server (API) origin when it is not `instance` (a separate server URL, or a local stack's API port); same rules as `instance`. The CLI signs in to this one |
| `version` | no | a version name to check out (letters, digits, space, `.`, `_`, `-`; up to 64) |
| `folder` | no | the suggested folder name (letters, digits, `.`, `_`, `-`; up to 64; no `..`) |

Any other parameter, a repeated one, a fragment, or anything that looks like a credential (a parameter named like
`token`, `pat`, `key`, `secret`, `code`, `session`..., or a JWT-shaped value) makes the extension refuse the whole link.

### What the ToolJet "Open locally" panel should link to

The page's own origin as `instance`, the API origin the panel already shows in its `tooljet auth login --url` line
(`instanceOrigin()` in `OpenLocally.jsx`) as `api` when it differs, and the folder name it derives from the app name:

```js
const link = (scheme) => {
  const params = new URLSearchParams({ instance: window.location.origin, app: appId });
  if (instanceOrigin() !== window.location.origin) params.set('api', instanceOrigin());
  params.set('folder', folder);
  return `${scheme}://tooljet.tooljet/open?${params}`;
};
// scheme: 'vscode' | 'cursor' | 'windsurf'
```

Add `version` only when the developer should land on a specific version rather than the editing one. Never add a
token or code.

## Commands

All under **ToolJet:** in the Command Palette, and in the menu behind the status bar item.

| Command | Runs |
|---|---|
| Open app... | the open flow above, from an instance address and app id you type |
| Start live preview / Stop live preview | `tooljet app dev` in a terminal; Ctrl+C in it stops it too |
| Pull | `tooljet app pull` (types for queries, tables and routes) |
| Check | `tooljet app check`; problems go to the Problems panel |
| Publish | asks for a version (`1.2.0`) and a confirmation, then `tooljet app publish -v <version>` |
| Install agent instructions | `tooljet skill install` (CLAUDE.md, AGENTS.md, `.cursor/rules/tooljet.mdc`) |

The status bar shows the app, the instance it came from, and the live preview: starting, on with the time of the
last update, warnings, or the last error. Live preview warnings and TypeScript errors also go to the Problems panel.

Each command that talks to ToolJet names the instance this folder came from (`--instance`), so the CLI uses its login
for that instance whatever its default login is; when it has none, the extension offers to sign in there.

## Security notes

- **No credentials in links.** The extension never takes, stores or logs a token from a link and refuses links that
  carry one. Sign-in is always `tooljet auth login`, approved in the browser by a signed-in user; the token stays in
  `~/.tooljet/credentials.json`, written by the CLI. The extension reads only each login's instance address from that
  file, never its token.
- **Confirmation first.** Anything can open a `vscode://` link, a web page included, so nothing is contacted, run or
  written before you confirm the instance and app, and a server you have never signed in to is called out as new.
  Only https instances are accepted, plus plain http on loopback.
- **A link changes nothing outside its folder.** Signing in from a link never changes the CLI's default login, and
  the clone is tied to its server, so terminal commands in your other projects keep using the instance they used.
  The extension needs a CLI with `--instance` for this, and asks to update an older one.
- **No shell.** On macOS and Linux every CLI run is a child process with an argument list, never a shell command line.
  On Windows the npm shim needs a shell, so arguments with shell metacharacters are refused. App ids must be UUIDs and
  folder and version names are restricted to plain characters.
- **No install scripts.** Dependencies install through `tooljet app install`, which turns lifecycle scripts off. The
  CLI itself is installed only on your consent, in a visible terminal, and from a server a link named only after a
  second confirmation that names the download.
- **Nothing runs by itself.** The commands build and run the app's code, so in Restricted Mode they do nothing, and a
  window opened from a link only offers the live preview: it starts when you click **Start live preview**.
- **The CLI path is a machine setting.** A workspace's `.vscode/settings.json` cannot point the extension at another
  executable.
- The links log (Output → ToolJet) records why a link was refused, never the link itself.

## Develop

```sh
npm ci
npm test            # compile and run the unit tests (node:test)
npm run package     # dist/tooljet-<version>.vsix, then checks its contents
```

Press F5 in VS Code with this folder open to run an Extension Development Host. To try a link there:
`open 'vscode://tooljet.tooljet/open?instance=http%3A%2F%2Flocalhost%3A3055&app=<app id>'`.
