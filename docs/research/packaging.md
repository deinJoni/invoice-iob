# Research: Packaging & distribution — one-click .mcpb for Claude Desktop + other install paths

## Summary

In 2026 the bundle format is finalized: the CLI is **`@anthropic-ai/mcpb@2.1.2`** (MIT), and the old `@anthropic-ai/dxt@0.2.6` is officially deprecated/renamed (`.dxt` → `.mcpb`). The manifest spec's current `manifest_version` is **`"0.3"`** (the PRD's "0.2" still validates but "0.3" is current). Use a `"node"` stdio server with a `user_config` field of type `"directory"` to capture the output folder at install time. One server build serves every channel: ship a single esbuild-bundled `server/index.js`, then (a) wrap it in a signed `.mcpb` for Claude Desktop one-click, and (b) document a plain stdio `command`+`args` entry that works verbatim for `claude mcp add`, project `.mcp.json`, manual `claude_desktop_config.json`, Cursor, and VS Code. Signing via `mcpb sign --self-signed` is strongly recommended for a finance tool.

## 1. Anthropic MCP Bundles — 2026 state and CLI

The format was renamed from DXT (`.dxt`, "Desktop Extensions") to MCPB ("MCP Bundles", `.mcpb`).

| Item           | 2026 value                                                                   |
| -------------- | ---------------------------------------------------------------------------- |
| CLI package    | `@anthropic-ai/mcpb`                                                         |
| CLI version    | **2.1.2**                                                                    |
| CLI license    | MIT                                                                          |
| bin name       | `mcpb`                                                                       |
| Old package    | `@anthropic-ai/dxt@0.2.6` — **deprecated** ("renamed to @anthropic-ai/mcpb") |
| File extension | `.mcpb` (was `.dxt`)                                                         |
| Repo           | github.com/anthropics/mcpb                                                   |

A `.mcpb` is a zip archive containing `manifest.json` + the server + its dependencies. Claude Desktop installs it with one click and runs the declared command on the user's machine.

### CLI commands

```
mcpb init [directory]                 # interactive: writes manifest.json
mcpb validate <path>                  # validate manifest against schema
mcpb pack <directory> [output]        # zip dir into output (default extension.mcpb); auto-validates
mcpb sign <mcpb-file> [options]       # sign a packed bundle
mcpb verify <mcpb-file>               # show signature validity, cert details, fingerprint
mcpb info <mcpb-file>                 # show file size, signature status
mcpb unsign <mcpb-file>               # remove signature (dev)
```

`mcpb sign` options: `--self-signed`, `--cert/-c <path>` (default cert.pem), `--key/-k <path>` (default key.pem), `--intermediate/-i <paths>`.

```bash
mcpb pack . dist/invoice-iob.mcpb
mcpb sign dist/invoice-iob.mcpb --self-signed         # dev / self-publish
mcpb sign dist/invoice-iob.mcpb -c cert.pem -k key.pem -i intermediate.pem   # real cert
mcpb verify dist/invoice-iob.mcpb
```

CLI's own runtime deps (informational): commander, fflate (zip), node-forge (signing), galactus (prunes devDeps), ignore, @inquirer/prompts, zod ^3.25. The CLI internally pins **zod v3** — independent of your project (which uses zod 4).

## 2. Manifest schema and a complete manifest.json

`manifest_version`: current spec value is **"0.3"** (2025-12-02). "0.1"/"0.2" still validate; ship "0.3".

**Required fields:** `manifest_version`, `name`, `version`, `description`, `author` (object, `name` required), `server` (`type` + `entry_point` + `mcp_config`).

`server.type`: `"node"` | `"python"` | `"binary"` | `"uv"`. Use **`"node"`** — Node ships inside Claude Desktop.

`server.mcp_config`: `command`, `args`, optional `env`, optional `platform_overrides.{win32,darwin,linux}`.

**Variable substitution** in `mcp_config`: `${__dirname}` (unpacked bundle dir), `${user_config.KEY}`, `${HOME}`, `${DESKTOP}`, `${DOCUMENTS}`, `${DOWNLOADS}`.

**`user_config` field types:** `"string"`|`"number"`|`"boolean"`|`"directory"`|`"file"`. Props: `type`, `title`, `description`, `required`, `default` (supports `${...}`), `sensitive`, `multiple`, `min`/`max`. For an output folder use **`"directory"`** with `multiple: false`.

**Array expansion gotcha:** a `directory`/`file` config with `multiple: true` referenced in `args` expands each value into a separate argument. For a single output folder set `multiple: false` and pass via `env` (cleanest).

`tools` array entries `{ "name", "description" }` are declarative for the install UI; the server still advertises them at runtime. Set `tools_generated: true` if discovered at runtime.

### Complete manifest.json for invoice-iob

```json
{
  "manifest_version": "0.3",
  "name": "invoice-iob",
  "display_name": "Invoice IOB — EN 16931 E-Invoices",
  "version": "1.0.0",
  "description": "Turn simple invoice details into EN 16931 compliant e-invoices (XRechnung/UBL/CII XML, visual PDF, and ZUGFeRD/Factur-X hybrid PDF/A-3). Fully local, no cloud.",
  "long_description": "Generates German/EU e-invoices conforming to EN 16931 entirely on-device. Outputs XRechnung, UBL, and CII XML; a human-readable PDF; and a ZUGFeRD/Factur-X hybrid PDF/A-3 with embedded XML. No LibreOffice, Ghostscript, JVM, or Chromium required.",
  "author": { "name": "Jonas Heinz", "email": "jonas.a.heinz@gmail.com" },
  "license": "MIT",
  "homepage": "https://github.com/<owner>/invoice-iob",
  "repository": { "type": "git", "url": "https://github.com/<owner>/invoice-iob" },
  "icon": "icon.png",
  "server": {
    "type": "node",
    "entry_point": "server/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/index.js"],
      "env": { "INVOICE_IOB_OUTPUT_DIR": "${user_config.output_directory}" }
    }
  },
  "tools": [
    {
      "name": "create_invoice",
      "description": "Create an EN 16931 e-invoice from structured invoice details; returns XRechnung/UBL/CII XML, a PDF, and a ZUGFeRD/Factur-X PDF/A-3, written to the configured output folder."
    },
    {
      "name": "validate_invoice",
      "description": "Validate provided invoice data or XML against EN 16931 business rules and report violations."
    }
  ],
  "tools_generated": false,
  "user_config": {
    "output_directory": {
      "type": "directory",
      "title": "Output folder",
      "description": "Where generated invoice files (XML and PDF) are written.",
      "multiple": false,
      "required": true,
      "default": "${DOCUMENTS}"
    }
  },
  "compatibility": {
    "claude_desktop": ">=1.0.0",
    "platforms": ["darwin", "win32", "linux"],
    "runtimes": { "node": ">=18.0.0" }
  },
  "keywords": [
    "invoice",
    "e-invoice",
    "EN16931",
    "XRechnung",
    "ZUGFeRD",
    "Factur-X",
    "UBL",
    "CII",
    "PDF/A-3"
  ]
}
```

- Output folder is captured via the `output_directory` directory config and passed via `env.INVOICE_IOB_OUTPUT_DIR`. The server reads `process.env.INVOICE_IOB_OUTPUT_DIR`.
- `runtimes.node >=18` matches the SDK's engine requirement.
- Keep `icon.png` (square, ~256–512px) at the bundle root.

## 3. Bundling a Node server, size, and signing

**Two strategies; pick single-file esbuild:**

1. _Ship `node_modules`_: `mcpb pack` zips the whole directory; the CLI runs `galactus` to prune dev deps, but the tree is large (10–40MB+).
2. _Single esbuild file (recommended)_: bundle to one file `server/index.js` (`esbuild --bundle --platform=node ...`). The packed dir is essentially `manifest.json` + `server/index.js` + data assets (OFL font, sRGB ICC if used, icon). Smallest/fastest.

esbuild details:

- Assets can be inlined via esbuild `loader: 'binary'` (preferred, fully self-contained) OR shipped as files next to the entry and resolved via `__dirname`. (See build doc — binary loader recommended.)
- Engine deps are all pure JS and esbuild-bundleable. No native addons.
- Keep `node` as the `command`. Do NOT ship a Node binary.

Size: a single-file build is a few MB of JS plus the font/ICC — expect a packed `.mcpb` in the low single-digit MB range.

**Signing (do it — finance tool):**

- `mcpb sign <file> --self-signed` for dev; Claude Desktop shows the publisher as self-signed but still verifies the archive wasn't tampered with.
- A real code-signing cert (`--cert/--key/--intermediate`) lets Claude Desktop display a verified publisher identity — materially raises trust for a tax-document tool.
- CI flow: `mcpb pack` → `mcpb sign` (real cert from CI secrets, `--self-signed` for nightlies) → `mcpb verify` as a gate → attach to GitHub release.

## 4. OTHER install paths from the SAME server build

The single esbuild artifact `server/index.js` is the only thing every client runs. The universal invocation is `node <abs path>/server/index.js`.

### A. Claude Code — `claude mcp add`

```bash
claude mcp add invoice-iob \
  --scope project \
  --transport stdio \
  --env INVOICE_IOB_OUTPUT_DIR=/Users/you/Invoices \
  -- node /abs/path/to/dist/bundle/server/index.js
```

- `--scope`: `local` (default), `project` (writes `.mcp.json`), `user` (`~/.claude.json`).
- The `--` separator is mandatory for stdio — everything after it is the server command.
- `--env KEY=value` may be repeated; keep another option between `--env` and the server name.

### B. Claude Code project config — `.mcp.json`

```json
{
  "mcpServers": {
    "invoice-iob": {
      "command": "node",
      "args": ["/abs/path/to/dist/bundle/server/index.js"],
      "env": {
        "INVOICE_IOB_OUTPUT_DIR": "${INVOICE_IOB_OUTPUT_DIR:-${CLAUDE_PROJECT_DIR:-.}/invoices}"
      }
    }
  }
}
```

- Claude Code expands env vars; provide defaults (`${VAR:-default}`) for project/user scope.
- Optional per-server `"timeout": 600000` (ms) for long PDF/A-3 assembly. `"type"` may be `"stdio"` (inferred from command+args).
- Project-scoped servers require interactive approval on first use.

### C. Claude Desktop manual config — `claude_desktop_config.json`

Same `mcpServers` schema. macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json`.

```json
{
  "mcpServers": {
    "invoice-iob": {
      "command": "node",
      "args": ["/abs/path/to/dist/bundle/server/index.js"],
      "env": { "INVOICE_IOB_OUTPUT_DIR": "/Users/you/Invoices" }
    }
  }
}
```

### D. Generic / other adapters (Cursor, VS Code, any MCP client)

- **Cursor**: `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global), same `mcpServers` shape.
- **VS Code (Copilot/Agent MCP)**: `.vscode/mcp.json`, top-level key is `servers` (not `mcpServers`), same `{ command, args, env }`; supports `inputs` for prompting values.
- **Generic clients**: document the literal launch command `node /abs/path/to/server/index.js` with env `INVOICE_IOB_OUTPUT_DIR`.

### What the monorepo should produce

1. **`dist/bundle/server/index.js`** — the single esbuild bundle (every client runs this).
2. **Bundle assets** alongside it (or inlined): OFL font, sRGB ICC if used, icon.png.
3. **`manifest.json`** → `mcpb pack dist/bundle invoice-iob.mcpb` → `mcpb sign ...` ⇒ **`invoice-iob.mcpb`** (Claude Desktop one-click; GitHub release asset).
4. **Copy-paste config snippets** in README for all channels.
5. Optionally publish to npm so args can be `npx -y invoice-iob`.

Validators (KoSIT, veraPDF, Mustang) stay CI/dev-only and are never referenced in the manifest or bundle.

## Decisions

- **Use `@anthropic-ai/mcpb` CLI pinned to 2.1.2; drop all `@anthropic-ai/dxt` / `.dxt` references.**
- **Set `manifest_version` to `"0.3"`.**
- **`server.type = "node"`, command `node`, args `["${__dirname}/server/index.js"]`.**
- **Capture output folder via `user_config` type `"directory"` (multiple:false, default `${DOCUMENTS}`); pass via `env.INVOICE_IOB_OUTPUT_DIR`.**
- **Bundle to a single esbuild file, not node_modules packing.**
- **Sign every released `.mcpb`** (real cert in CI, `--self-signed` for nightlies); gate on `mcpb verify`.
- **Document the same stdio command for all channels.**
- **Optionally publish to npm** for `npx -y invoice-iob`.

## Packages

| name               | version | license | role                                                              |
| ------------------ | ------- | ------- | ----------------------------------------------------------------- |
| @anthropic-ai/mcpb | 2.1.2   | MIT     | CLI to init/validate/pack/sign/verify MCP Bundles. Build/CI only. |
| @anthropic-ai/dxt  | 0.2.6   | MIT     | DEPRECATED predecessor — do not use.                              |

## Risks

- WTFPL licensing on `@e-invoice-eu/core` and `@esgettext/runtime` — permissive but unconventional for finance; may fail corporate allowlists.
- `tmp-promise` writes to the OS temp dir at runtime; Claude Desktop/sandbox permissions or temp cleanup could break PDF/A-3 assembly. Verify under bundle runtime constraints; clean up temp files (finance/PII).
- Single-file esbuild bundling can mishandle dynamic `require()`/`__dirname`-relative asset loading inside deps. Test the packed `.mcpb` end-to-end (asset paths shift after packing).
- Self-signed `.mcpb` shows an unverified publisher; plan for a real cert before public launch.
- A `directory` user_config gives a path, but actual write permission depends on the host. Validate write access at startup; surface a clear error.
- Bundle spec is pre-1.0 (manifest 0.3); pin the CLI version and re-validate on upgrade.
- Project `.mcp.json` env expansion needs defaults (`${VAR:-…}`) or startup fails when unset.

## Citations

- https://www.npmjs.com/package/@anthropic-ai/mcpb
- https://www.npmjs.com/package/@anthropic-ai/dxt
- https://github.com/anthropics/mcpb/blob/main/MANIFEST.md
- https://github.com/anthropics/mcpb/blob/main/README.md
- https://raw.githubusercontent.com/anthropics/mcpb/main/CLI.md
- https://code.claude.com/docs/en/mcp
- https://www.npmjs.com/package/@e-invoice-eu/core
- https://www.npmjs.com/package/@modelcontextprotocol/sdk
