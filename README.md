# ToolJet for VS Code, Cursor and Windsurf

Work on a ToolJet **Code mode** app in your editor: open it from ToolJet with one click, keep its live preview running,
and check, pull and publish without leaving the editor. The extension drives the `tooljet` CLI; it holds no
credentials of its own.

## Install

The extension is not on a marketplace yet. Install the `.vsix`:

- **VS Code**: Extensions view → `...` → *Install from VSIX...*, or `code --install-extension tooljet-0.1.0.vsix`
- **Cursor**: `cursor --install-extension tooljet-0.1.0.vsix`, or drag the file into the Extensions view
- **Windsurf**: `windsurf --install-extension tooljet-0.1.0.vsix`, or *Install from VSIX...* in the Extensions view

Build it yourself with `npm ci && npm run package` (it lands in `dist/`).

You also need the ToolJet CLI with the Code mode commands (`tooljet app ...`, `tooljet auth login`). The extension
offers to install it with `npm i -g @tooljet/cli` when it is missing, in a terminal you can watch, and only if you
agree. To use another build, set **ToolJet: Cli Path** (`tooljet.cliPath`) in your user settings.

## Open an app from ToolJet

In the ToolJet editor, **Code → Open locally → Open in VS Code / Cursor / Windsurf** opens a link like:

```
vscode://tooljet.tooljet/open?instance=https%3A%2F%2Ftooljet.example.com&app=421df0e7-861a-43fd-9b31-fa67f6649dfa
```

The extension then:

1. shows the instance and app and asks you to confirm before contacting anything;
2. checks the `tooljet` CLI is installed (and offers to install it);
3. runs `tooljet auth login --url <instance>` in a terminal if the CLI is not signed in to that instance: you approve
   the code in your browser, and the CLI stores the token;
4. asks for a parent folder (it remembers the last one) and a folder name;
5. runs `tooljet app clone`, `tooljet app checkout <version>` when the link names one, and `tooljet app install`
   (npm, pnpm or yarn with install scripts off);
6. opens the folder in a new window and starts the live preview (`tooljet app dev`) in a terminal there.

If the app is already cloned into a folder this editor knows, it offers to open that folder instead. If the app's
code isn't saved in ToolJet (it lives in your repository), the extension clones and opens the project but does not
start the live preview, so it never replaces your live preview with the starter template.

### Link format

```
<scheme>://tooljet.tooljet/open?instance=<origin>&app=<app id>[&version=<version name>][&folder=<folder name>]
```

| Parameter | Required | Rules |
|---|---|---|
| `scheme` | | `vscode`, `vscode-insiders`, `cursor` or `windsurf` (the editor that should open it) |
| `instance` | yes | the ToolJet **API** origin: `https://host[:port]`, or `http://` only for `localhost`, `127.x.x.x` or `[::1]`; no user, path, query or fragment |
| `app` | yes | the app id, a UUID |
| `version` | no | a version name to check out (letters, digits, space, `.`, `_`, `-`; up to 64) |
| `folder` | no | the suggested folder name (letters, digits, `.`, `_`, `-`; up to 64; no `..`) |

Any other parameter, a repeated one, a fragment, or anything that looks like a credential (a parameter named like
`token`, `pat`, `key`, `secret`, `code`, `session`..., or a JWT-shaped value) makes the extension refuse the whole link.

### What the ToolJet "Open locally" panel should link to

Use the same API origin the panel already shows in its `tooljet auth login --url` line (`instanceOrigin()` in
`OpenLocally.jsx`), and the folder name it already derives from the app name:

```js
const link = (scheme) =>
  `${scheme}://tooljet.tooljet/open?` +
  new URLSearchParams({ instance: instanceOrigin(), app: appId, folder }).toString();
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

Before each command that talks to ToolJet, the extension checks the CLI's current login is the instance this folder
came from (the CLI's app commands use its default login), and offers to sign in again if it is not.

## Security notes

- **No credentials in links.** The extension never takes, stores or logs a token from a link and refuses links that
  carry one. Sign-in is always `tooljet auth login`, approved in the browser by a signed-in user; the token stays in
  `~/.tooljet/credentials.json`, written by the CLI. The extension reads only each login's instance address from that
  file, never its token.
- **Confirmation first.** Anything can open a `vscode://` link, a web page included, so nothing is contacted, run or
  written before you confirm the instance and app. Only https instances are accepted, plus plain http on loopback.
- **No shell.** On macOS and Linux every CLI run is a child process with an argument list, never a shell command line.
  On Windows the npm shim needs a shell, so arguments with shell metacharacters are refused. App ids must be UUIDs and
  folder and version names are restricted to plain characters.
- **No install scripts.** Dependencies install through `tooljet app install`, which turns lifecycle scripts off. The
  CLI itself is installed only on your consent, in a visible terminal.
- **Trusted workspaces only.** The commands build and run the app's code, so in Restricted Mode they do nothing; a
  window opened from a link starts the live preview once you trust the folder.
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
