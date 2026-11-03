# Changelog

## 0.1.1

- A CLI that is missing or too old: **Update the CLI** (npm, `@tooljet/cli@latest`) or **Choose a CLI...** (saved as `tooljet.cliPath`), offered again until one works.
- Links may name ToolJet's server as `api` when it is not the page's origin; the CLI signs in there. A page without browser sign-in asks for the server address.
- The first clone goes under `~/ToolJet apps`; a parent folder inside a Git repository needs confirming; the clone's full path shows before anything is written.
- After cloning, `tooljet app source-pull` brings in the code ToolJet stores; code the ToolJet editor owns gets a live preview even when the clone says the code is not in ToolJet.

## 0.1.0

- Open a ToolJet Code mode app from a `vscode://`, `cursor://` or `windsurf://` link: sign in with the CLI, clone, install without install scripts, open, start the live preview.
- Commands: Open app, Start live preview, Stop live preview, Pull, Check (Problems panel), Publish, Install agent instructions.
- Status bar item with the linked app, its instance and the live preview's state.
