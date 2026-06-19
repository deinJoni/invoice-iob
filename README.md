# invoice-iob

[![CI](https://github.com/deinJoni/invoice-iob/actions/workflows/ci.yml/badge.svg)](https://github.com/deinJoni/invoice-iob/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

> **A fully local, open-source MCP server that turns simple invoice details into compliant
> e-invoices.** No invoice data ever leaves your machine.

`invoice-iob` produces **EN 16931** output for the German/EU market — **XRechnung** (UBL & CII),
generic **UBL/CII** XML, a human-readable **PDF**, a German **ZUGFeRD/Factur-X** hybrid PDF/A-3, and
a French **Factur-X** hybrid (`factur-x-fr`, localized to French with French business rules). It's
architected so that **new countries and formats are added as plugins, not forks** — France was added
with zero forks of the core pipeline — and ships as a one-click `.mcpb` for Claude Desktop — no config
files, no runtimes to install.

|             |                                                                                                                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**  | All formats work: XRechnung/UBL/CII XML, visual PDF, and German + French ZUGFeRD/Factur-X hybrid PDF/A-3. **Every output path is validated by an official validator on every push** (see [Validation & CI](#validation--ci)). |
| **License** | Apache-2.0                                                                                                                                                                                                                    |
| **Runtime** | Node ≥ 20 (CI proves the floor on Node 20/22/24), fully local, no native dependencies                                                                                                                                         |

## What it does

Two MCP tools:

- **`create_invoice`** — build an invoice in a chosen `format` from simple fields and save it
  locally. VAT subtotals and totals are computed automatically.
- **`list_formats`** — enumerate the formats available in this build.

### Formats

| `format`                     | Country | Output                        | Standard                                                               |
| ---------------------------- | ------- | ----------------------------- | ---------------------------------------------------------------------- |
| `XRECHNUNG-CII`              | DE      | XML (CII)                     | EN 16931 CIUS — XRechnung 3.0                                          |
| `XRECHNUNG-UBL`              | DE      | XML (UBL)                     | EN 16931 CIUS — XRechnung 3.0                                          |
| `UBL`                        | EU      | XML (UBL)                     | EN 16931                                                               |
| `CII`                        | EU      | XML (CII)                     | EN 16931                                                               |
| `PDF`                        | EU      | Visual PDF                    | DE §14 UStG / EN 16931 fields                                          |
| `ZUGFERD` / `FACTUR-X`       | DE      | Hybrid PDF/A-3 (XML embedded) | EN 16931 (Factur-X 1.0, default profile EN 16931)                      |
| `FACTUR-X-FR` / `FACTURX-FR` | FR      | Hybrid PDF/A-3 (XML embedded) | EN 16931 (Factur-X 1.0) — French localization + SIREN/SIRET + FR rules |

The visual PDF is localized — pass `language` (e.g. `"fr-FR"`, `"de-de"`, `"en"`) or let it default
from the seller's country. French invoices carry SIREN/SIRET via the generic party identifiers
(`legalRegistrationId` scheme `0002` for SIREN, `identifiers` scheme `0009` for SIRET).

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

> _"Create an XRechnung for 20 h consulting at €150/h plus €89.90 travel for Globex DE GmbH."_
>
> _"Génère une facture Factur-X pour Studio Garance SARL : 10 h de développement à 90 €/h (TVA 20 %)."_

See [`examples/invoice-consulting.json`](examples/invoice-consulting.json) (German XRechnung) and
[`examples/invoice-fr.json`](examples/invoice-fr.json) (French Factur-X, mixed TVA, SIREN/SIRET) for
the full field set.

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
- `@invoice-iob/pdf-renderer` — template-driven visual PDF (locales `de`/`en`/`fr`)
- `@invoice-iob/format-ubl-cii`, `@invoice-iob/format-xrechnung`, `@invoice-iob/format-pdf`, `@invoice-iob/format-zugferd` — format providers
- `@invoice-iob/format-facturx-fr` — French Factur-X provider (proof that a country is a plugin, not a fork)
- `@invoice-iob/server` — the MCP stdio server (bundle entrypoint)

See [`docs/STACK.md`](docs/STACK.md) for the full stack decisions and [`PLAN.md`](PLAN.md) for the
roadmap. The product spec is [`PRD.md`](PRD.md).

## Validation & CI

A compliance tool is only as trustworthy as the validators it runs against. So **every output the
server can produce — every format, and for the hybrid every profile — is validated by its official
validator on every push and pull request.** Nothing ships green unless real validators accept it.

The mapping of _output path → validator_ is one file, [`scripts/lib/matrix.mjs`](scripts/lib/matrix.mjs)
(the "validation matrix"). CI reads it to know what to generate and how to check it:

| Output path                                                                   | Validator gate                                              | What it proves                                                                                                   |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `xrechnung-cii`, `xrechnung-ubl`                                              | **KoSIT** validator + `validator-configuration-xrechnung`   | XRechnung 3.0 CIUS (EN 16931 + BR-DE), VARL report parsed                                                        |
| `ubl`, `cii` (generic EN 16931)                                               | **CEN EN 16931 Schematron** via **Saxon-HE**                | the official EN 16931 rules, SVRL report parsed (a _second, independent_ validator from KoSIT)                   |
| `pdf` (visual)                                                                | **smoke test** structural checks                            | valid PDF, fonts embedded, totals match the XML (no formal conformance standard exists for a human-readable PDF) |
| `zugferd` / `factur-x` — profiles `EN16931`, `BASIC`, `EXTENDED`, `XRECHNUNG` | **Mustangproject** `--action validate` (embeds **veraPDF**) | PDF/A-3b conformance **+** the Factur-X container **+** the embedded XML against the profile's EN 16931 rules    |
| `factur-x-fr` (France) — profiles `EN16931`, `BASIC`, `EXTENDED`              | **Mustangproject** `--action validate` (embeds **veraPDF**) | same gate — Factur-X ≡ ZUGFeRD, so the French hybrid is proven by the same official validator                    |
| `zugferd` — `XRECHNUNG` profile, additionally                                 | embedded XML **extracted** → **KoSIT**                      | the _embedded_ CII is itself a valid XRechnung, not just a valid container                                       |

Each path is exercised for **every example** in [`examples/`](examples/) (e.g. single-rate and
mixed-rate VAT), so a VAT-breakdown bug surfaces in every format at once. The Java validators are
**dev/CI-only** and downloaded on demand (pinned versions in [`scripts/ci/`](scripts/ci/)) — none of
it is ever bundled into the Node-only `.mcpb`.

### The drift guard — how the tests stay up to date

The matrix is enforced, not just documented. On every push, [`scripts/check-coverage.mjs`](scripts/check-coverage.mjs)
boots the built server, asks it which formats it actually exposes (`list_formats`), and **fails CI
if any registered format is missing from the matrix** (or vice-versa). So you cannot add a new
output and forget to validate it — CI tells you exactly what to wire up.

### Adding a new path (format or profile)? Keep the gates in sync

If you add a format provider, a hybrid profile, or an example input, do this so CI keeps validating
everything (the drift guard fails until you do):

1. **New format** → add a row to [`scripts/lib/matrix.mjs`](scripts/lib/matrix.mjs) keyed by your
   provider's `meta.id`, pointing at the gate that proves its conformance (`kosit` / `en16931` /
   `mustang` / `smoke`). For a brand-new validator, add a `scripts/ci/fetch-<tool>.sh` + a
   `scripts/<tool>-check.mjs` (parse the _report_, never the exit code) and a CI job mirroring the
   existing ones.
2. **New hybrid profile** → add it to that format's `profiles` (and `embeddedKosit` if its embedded
   XML should also go through KoSIT). It is then generated and validated automatically.
3. **New example** → just drop a `*.json` into [`examples/`](examples/); it is automatically run
   through every gate.

Full runbook and validator details: [`docs/CI.md`](docs/CI.md). Contributor checklist:
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Development

```bash
pnpm install
pnpm run format:check  # prettier --check (enforced in CI)
pnpm run typecheck     # tsc --noEmit (erasable-syntax-only, skipLibCheck)
pnpm test              # node --test — unit tests incl. the report-parser gate tests
pnpm run build         # esbuild → dist/bundle/server/index.mjs
pnpm run check:coverage # drift guard: every registered format maps to a CI gate (needs build)
pnpm run smoke         # build + drive the bundle over a real MCP stdio handshake
pnpm run fixtures      # generate one conformance fixture per path × example (needs build)
pnpm run pack:mcpb     # build + package the .mcpb
```

To run the official validators locally (KoSIT / EN 16931 Schematron / Mustang) the same way CI
does, see [`docs/CI.md`](docs/CI.md) → "Running the validators locally" — the pinned downloads live
in [`scripts/ci/`](scripts/ci/).

Contributions — especially new country/format providers — are welcome. See
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

Apache-2.0 © invoice-iob contributors. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE) for
third-party attributions.
