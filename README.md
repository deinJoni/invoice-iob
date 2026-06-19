# invoice-iob

> **A fully local, open-source MCP server that turns simple invoice details into compliant
> e-invoices.** No invoice data ever leaves your machine.

`invoice-iob` launches with **EN 16931** output for the German/EU market — **XRechnung** (UBL &
CII), generic **UBL/CII** XML, and (in upcoming versions) a human-readable **PDF** and a
**ZUGFeRD/Factur-X** hybrid PDF/A-3. It's architected so that **new countries and formats are
added as plugins, not forks**, and ships as a one-click `.mcpb` for Claude Desktop — no config
files, no runtimes to install.

| | |
|---|---|
| **Status** | P0 — Extensible core + XML MVP (working). PDF (P1) and ZUGFeRD/Factur-X (P2) next. |
| **License** | Apache-2.0 |
| **Runtime** | Node ≥ 20, fully local, no native dependencies |

## What it does

Two MCP tools:

- **`create_invoice`** — build an invoice in a chosen `format` from simple fields and save it
  locally. VAT subtotals and totals are computed automatically.
- **`list_formats`** — enumerate the formats available in this build.

### Formats (launch set)

| `format` | Output | Standard |
|---|---|---|
| `XRECHNUNG-CII` | XML (CII) | EN 16931 CIUS — XRechnung 3.0 |
| `XRECHNUNG-UBL` | XML (UBL) | EN 16931 CIUS — XRechnung 3.0 |
| `UBL` | XML (UBL) | EN 16931 |
| `CII` | XML (CII) | EN 16931 |
| `PDF` | Visual PDF | _coming in P1_ |
| `ZUGFERD` / `FACTUR-X` | Hybrid PDF/A-3 | _coming in P2_ |

## Quick start

### 1. Build the bundle

```bash
corepack enable           # uses the pinned pnpm
pnpm install
pnpm run pack:mcpb         # → dist/invoice-iob.mcpb  (and dist/bundle/server/index.mjs)
```

### 2. Install

**Claude Desktop (one-click):** open `dist/invoice-iob.mcpb`, pick your output folder when
prompted, done.

**Claude Code:**

```bash
claude mcp add invoice-iob --scope project --transport stdio \
  --env INVOICE_IOB_OUTPUT_DIR="$HOME/Documents/E-Invoices" \
  -- node /abs/path/to/dist/bundle/server/index.mjs
```

**Any MCP client** (Cursor `.cursor/mcp.json`, VS Code `.vscode/mcp.json`, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "invoice-iob": {
      "command": "node",
      "args": ["/abs/path/to/dist/bundle/server/index.mjs"],
      "env": { "INVOICE_IOB_OUTPUT_DIR": "/Users/you/Documents/E-Invoices" }
    }
  }
}
```

### 3. Use it

> *"Create an XRechnung for 20 h consulting at €150/h plus €89.90 travel for Globex DE GmbH."*

See [`examples/invoice-consulting.json`](examples/invoice-consulting.json) for the full field set.

## Architecture

```
friendly input ─▶ Input Mapper ─▶ Canonical Invoice Model ─▶ FormatProvider.render ─▶ artifact
   (zod, core)     (+ tax math)     (EN16931 BT/BG + ext bag)   (validate + engine/pdf)   (xml/pdf/hybrid)
                                          ▲
                                   Format Registry  ◀── providers register; list_formats reads it
```

A single **canonical invoice model** (EN 16931 business terms) is the source of truth: every
input maps into it, every output renders from it — so the XML and the PDF can never disagree.
A new country = a new `FormatProvider` against a stable interface.

Packages (pnpm monorepo):

- `@invoice-iob/core` — canonical model, `FormatProvider` interface, registry, input mapper, tax math
- `@invoice-iob/engine-e-invoice-eu` — adapter over [`@e-invoice-eu/core`](https://github.com/gflohr/e-invoice-eu) (UBL/CII/XRechnung + Factur-X)
- `@invoice-iob/format-ubl-cii`, `@invoice-iob/format-xrechnung` — format providers
- `@invoice-iob/server` — the MCP stdio server (bundle entrypoint)

See [`docs/STACK.md`](docs/STACK.md) for the full stack decisions and [`PLAN.md`](PLAN.md) for the
roadmap. The product spec is [`PRD.md`](PRD.md).

## Development

```bash
pnpm install
pnpm run typecheck     # tsc --noEmit (erasable-syntax-only, skipLibCheck)
pnpm test              # node --test (unit tests)
pnpm run build         # esbuild → dist/bundle/server/index.mjs
pnpm run smoke         # build + drive the bundle over a real MCP stdio handshake
pnpm run pack:mcpb     # build + package the .mcpb
```

Contributions — especially new country/format providers — are welcome. See
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

Apache-2.0 © invoice-iob contributors. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE) for
third-party attributions.
