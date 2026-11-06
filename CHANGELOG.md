# Changelog

## Unreleased

- A link naming a server you have never signed in to from this computer gets a warning that names it in full as a new server.
- The CLI is never installed from a server only a link named without asking: npm is offered first, and that server's CLI only through **Install the server's CLI...** and a second warning naming the download. A server's CLI is installed only over https (or from a local stack).
- Signing in from a link keeps the CLI's default login; the clone runs with `--instance` and records its server, and project commands name it, so terminal commands elsewhere keep their instance. This needs a CLI with `--instance`; an older one is reported as out of date.
- After a clone, the new window offers **Start live preview** instead of starting it.

## 0.1.3

- A CLI from before Code mode (npm's 0.0.14, which has only `plugin` and `info`) now gets **Your ToolJet CLI is out of date**, and one click installs the CLI the server serves, replacing the older `tooljet`.
- When no server is known (a CLI that old is not signed in anywhere), or the server serves no CLI, **Enter server address** finds one, since npm's latest may be too old as well.

## 0.1.2

- **Install** and **Update the CLI** install the CLI the ToolJet server serves (`<server>/api/code-mode/cli/tooljet-cli.tgz`, built with that server, so its Code mode commands match), and use npm's `@tooljet/cli@latest` only when the server has none.

## 0.1.1

- A CLI that is missing or too old: **Update the CLI** (npm, `@tooljet/cli@latest`) or **Choose a CLI...** (saved as `tooljet.cliPath`), offered again until one works.
- Links may name ToolJet's server as `api` when it is not the page's origin; the CLI signs in there. A page without browser sign-in asks for the server address.
- The first clone goes under `~/ToolJet apps`; a parent folder inside a Git repository needs confirming; the clone's full path shows before anything is written.
- After cloning, `tooljet app source-pull` brings in the code ToolJet stores; code the ToolJet editor owns gets a live preview even when the clone says the code is not in ToolJet.

## 0.1.0

- Open a ToolJet Code mode app from a `vscode://`, `cursor://` or `windsurf://` link: sign in with the CLI, clone, install without install scripts, open, start the live preview.
- Commands: Open app, Start live preview, Stop live preview, Pull, Check (Problems panel), Publish, Install agent instructions.
- Status bar item with the linked app, its instance and the live preview's state.
