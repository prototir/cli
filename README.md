# prototir

Publish what you (or your AI) built to [Prototir](https://prototir.com), where people try working
prototypes and you see real sessions, drop-off and feedback.

```sh
npx prototir publish ./dist
```

It finds the build, uploads it to your account and prints a link where you finish publishing:
title, visibility and rights. Nothing is made public on its own.

## Link once

The first time, it shows a code. Approve it on prototir.com and this computer can upload builds
to your account. It cannot publish, comment or change anything else, and you can unlink it from
your account settings at any time.

## With an AI assistant

Assistants that run terminal commands (Claude Code, Codex, Cursor and others) can just run it. To
make them do it without asking, add this to your `AGENTS.md` or `CLAUDE.md`:

```
To publish or share what we build, run: npx prototir publish <build folder>
It prints a link where I finish publishing on Prototir.
```

For chat apps and assistants that use MCP, add it as a server:

```json
{
  "mcpServers": {
    "prototir": { "command": "npx", "args": ["-y", "prototir", "mcp"] }
  }
}
```

```sh
claude mcp add prototir -- npx -y prototir mcp
```

The server offers `prototir_publish`, `prototir_link`, `prototir_whoami` and `prototir_unlink`.

## Commands

| Command | |
| --- | --- |
| `prototir publish [folder\|file.zip]` | Upload a build and get the link to finish publishing |
| `prototir link` | Link this computer to your account |
| `prototir whoami` | Show which account this computer is linked to |
| `prototir unlink` | Forget this computer's link |
| `prototir mcp` | Run as an MCP server |

Publish options:

- `--title <text>` starts a new prototype with this title.
- `--slug <slug>` adds the build to one of your existing prototypes.
- `--version <label>` sets the version label.
- `--native --platform windows|macos|linux --arch x64|arm64|universal` uploads a downloadable
  build instead of a web build. To count sessions it needs the Prototir SDK for its engine, see the
  [creator guide](https://prototir.com/docs/creators).
- `--no-open` does not open the browser.

## What counts as a web build

A folder or ZIP with `index.html` at its top. Given a project folder, `publish` uses its `dist/`,
`build/`, `out/`, `public/` or `www/` folder when that is where `index.html` is, and refuses
plain source code with a hint to build it first. `node_modules` and `.git` are never uploaded.

## Where things are kept

The link token is saved in `~/.prototir/credentials.json`, one per Prototir server. Set
`PROTOTIR_API` and `PROTOTIR_SITE` (or `--api` and `--site`) to use another server, such as a
local one.

## License

MIT
