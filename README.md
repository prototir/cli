# @prototir/cli

Publish what you (or your AI) built to [Prototir](https://prototir.com), where people try working
prototypes and you see real sessions, drop-off and feedback.

```sh
npx @prototir/cli publish ./dist
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
To publish or share what we build, run: npx @prototir/cli publish <build folder>
It prints a link where I finish publishing on Prototir.
```

For chat apps and assistants that use MCP, add it as a server:

```json
{
  "mcpServers": {
    "prototir": { "command": "npx", "args": ["-y", "@prototir/cli", "mcp"] }
  }
}
```

```sh
claude mcp add prototir -- npx -y @prototir/cli mcp
```

The server offers `prototir_publish`, `prototir_link`, `prototir_whoami` and `prototir_unlink`.

## From CI (GitHub Actions)

Prototir does not build your project: build it in your own pipeline, then hand the result over.
On your computer, create a token for CI and save it as a repository secret named `PROTOTIR_TOKEN`:

```sh
npx @prototir/cli token
```

It is a separate link you approve like any other. It can only upload builds that wait for you on
Prototir, it expires after 90 days, and you can unlink it from your account settings without
unlinking your computer. Then add a step after your build:

```yaml
- uses: prototir/cli@v0
  with:
    path: build/WebGL/WebGL # the folder or ZIP your build produced
    token: ${{ secrets.PROTOTIR_TOKEN }}
    slug: your-prototype-slug # from prototir.com/p/<slug>; leave out to start a new prototype
    version: build ${{ github.run_number }}
```

The build appears in Studio for that prototype, and the job summary links to it. Nothing is
published until you choose it there. Inputs: `path`, `token`, `slug`, `title`, `version`, and
`native: 'true'` with `platform` and `architecture` for a downloadable build. Outputs: `url` and
`for-prototype`.

[`examples/unity-gameci.yml`](examples/unity-gameci.yml) is a complete workflow for Unity with
[GameCI](https://game.ci). Any other CI works the same way: set `PROTOTIR_TOKEN` and run
`npx @prototir/cli publish <build> --slug <slug>`.

## Commands

Run them with `npx @prototir/cli <command>`, or install it (`npm i -g @prototir/cli`) and use
`prototir <command>`.

| Command | |
| --- | --- |
| `prototir publish [folder\|file.zip]` | Upload a build and get the link to finish publishing |
| `prototir link` | Link this computer to your account |
| `prototir whoami` | Show which account this computer is linked to |
| `prototir unlink` | Forget this computer's link |
| `prototir token` | Create an upload token for CI, printed for you to save as a secret |
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

## What runs in the sandbox

Published web builds run in an isolated sandbox. Three things to know before publishing:

- **Libraries.** Import them from `cdn.jsdelivr.net/npm/`, `unpkg.com`, `esm.sh` or
  `cdnjs.cloudflare.com` with an exact version, such as
  `https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.module.js`. The upload checks each
  version (at least a week old, no known malware) and copies it into the build. `@latest` or a
  missing version is refused, and scripts from any other site are blocked.
- **Other sites.** List every API, image or WebSocket host the build talks to in
  `prototir.json`, for example `"network": ["api.example.com", "*.supabase.co"]` (https or wss,
  up to 10). Players see the list, and everything else is blocked.
- **Devices.** Add `camera`, `microphone`, `geolocation`, `clipboard` (copy only) or `midi` to
  `"permissions"`. Players are asked before the prototype can use them.

## Where things are kept

The link token is saved in `~/.prototir/credentials.json`, one per Prototir server. Set
`PROTOTIR_API` and `PROTOTIR_SITE` (or `--api` and `--site`) to use another server, such as a
local one.

## License

MIT
