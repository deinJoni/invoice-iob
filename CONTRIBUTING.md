# Contributing to invoice-iob

Thanks for helping turn simple invoice fields into compliant EN 16931 e-invoices. This project is
architected so **new countries and formats are added as plugins, not forks** — if you came here to
add one, jump straight to [Add a new country/format](#add-a-new-countryformat-the-headline-recipe).

Before writing code or docs, skim [`README.md`](README.md), [`docs/STACK.md`](docs/STACK.md), and
[`PLAN.md`](PLAN.md) so your change stays consistent with the decisions already made. Deeper
extension detail lives in [`docs/PROVIDER_GUIDE.md`](docs/PROVIDER_GUIDE.md); the living list of
what's supported is [`docs/SUPPORT_MATRIX.md`](docs/SUPPORT_MATRIX.md).

## Dev setup

Node ≥ 20 (dev happens on Node 24) and the pinned pnpm — no native toolchain, no JVM, no
LibreOffice, no Chromium required to build or run the server.

```bash
corepack enable        # activates the pnpm version pinned in package.json
pnpm install           # installs the workspace (pnpm 10.32)
```

The exact root scripts (run from the repo root):

```bash
pnpm run build         # esbuild → single self-contained dist/bundle/server/index.mjs
pnpm run typecheck     # tsc --noEmit -p tsconfig.json  (the CI type source of truth)
pnpm test              # node --test "packages/**/*.test.ts"  (unit tests)
pnpm run smoke         # build + drive the bundled server over a real MCP stdio handshake
pnpm run pack:mcpb     # build + mcpb pack → dist/invoice-iob.mcpb
pnpm run format        # prettier --write
pnpm run format:check  # prettier --check (run before you push)
```

A few load-bearing facts worth internalizing early:

- **stdout is the MCP JSON-RPC channel.** Any stray `console.log` corrupts it and hangs Claude
  Desktop on connect. All diagnostics go to stderr (`console.error`); client-visible logs go
  through `server.sendLoggingMessage(...)`.
- **The canonical model is the single source of truth.** Renderers read amounts from it and
  **never recompute** VAT or totals — that's how the XML and the PDF can never disagree.
- **Typecheck is separate from the build.** esbuild strips types and never checks them; `tsc
  --noEmit` is the authority. The bundle is built, not type-emitted.

## Repo layout

pnpm monorepo, one esbuild bundle out the back. All packages are private, `type: module`, and
export `./src/index.ts` directly (no per-package build step).

```
invoice-iob/
  package.json              # root scripts, pnpm pin
  pnpm-workspace.yaml        # packages: [ "packages/*" ]
  tsconfig.json / tsconfig.base.json
  scripts/build.mjs          # esbuild driver (single-file ESM bundle)
  scripts/pack.mjs           # mcpb pack
  scripts/smoke.mjs          # spawns the bundle, drives it via the MCP SDK client
  assets/fonts/              # IBM Plex Sans TTFs (P1; inlined into the bundle at build)
  examples/                  # sample inputs (e.g. invoice-consulting.json)
  docs/                      # STACK.md, PROVIDER_GUIDE.md, SUPPORT_MATRIX.md, research/
  packages/
    core/                    # @invoice-iob/core — canonical EN16931 model, FormatProvider
                             #   interface + registry, friendly input schema, input mapper,
                             #   cents-based VAT/tax math, base EN16931 checks, errors. Dep: zod only.
    engine-e-invoice-eu/     # @invoice-iob/engine-e-invoice-eu — adapter over @e-invoice-eu/core:
                             #   canonical→UBL-JSON serializer, generateXml / generateFacturX,
                             #   the LibreOffice guard, stderr logger.
    format-ubl-cii/          # @invoice-iob/format-ubl-cii — providers "ubl" and "cii".
    format-xrechnung/        # @invoice-iob/format-xrechnung — providers "xrechnung-ubl",
                             #   "xrechnung-cii" + brDeIssues().
    server/                  # @invoice-iob/server — MCP stdio server (create_invoice, list_formats);
                             #   bundle entrypoint src/index.ts; registry composed in src/registry.ts.
```

`@invoice-iob/core` has no dependency on the engine or the MCP SDK — keep it that way. A new
country is a new package under `packages/` that depends on `core` (and, if it reuses the EU engine,
the engine adapter).

## Code style

- **Prettier** is the formatter — config in [`.prettierrc.json`](.prettierrc.json) (single quotes,
  semicolons, trailing commas, 100-col print width, always-parens arrows). Run `pnpm run format`
  before pushing; `pnpm run format:check` is enforced in CI.
- **TypeScript, erasable-syntax-only.** `tsconfig.base.json` sets `erasableSyntaxOnly: true`, so use
  only syntax Node can strip: **no `enum`, no parameter properties** (`constructor(private x)`), no
  namespaces with runtime emit, no decorators with emit. Use plain assignments and `import type` /
  `export type` (`verbatimModuleSyntax` is on). Strict mode and `noUncheckedIndexedAccess` are on.
- **zod v4** for all schemas — `import * as z from 'zod/v4'`. MCP tool inputs are **raw Zod shapes**,
  not `z.object()`.
- **No native runtime dependencies** in anything that ships in the default bundle. Validators
  (KoSIT, veraPDF, Mustangproject) are Java and are **CI/dev only — never bundled**.

## Commit & PR process

- Branch off the default branch; never commit directly to it.
- Keep commits focused and the message imperative ("Add FatturaPA provider", not "added stuff").
- Before opening a PR, make the local gate pass: `pnpm run format:check && pnpm run typecheck &&
  pnpm test`. For anything that touches the server or a renderer, also run `pnpm run smoke`.
- Open a PR against the default branch. CI runs install → format:check → typecheck → test → build →
  pack, plus the official validators for any format that has one (see the merge gate below). Fill in
  the PR template and link the relevant issue.
- A maintainer (and the format's `CODEOWNERS` entry, if it has one) reviews. Green CI + an approval
  lands it.

## Add a new country/format (the headline recipe)

This is the contributor flow the whole architecture exists to serve (PRD §9.3). A new country is a
**`FormatProvider`** against a stable interface plus its fixtures — not a fork. Read
[`docs/PROVIDER_GUIDE.md`](docs/PROVIDER_GUIDE.md) for the worked walkthrough; this is the checklist.

### 1. Implement a `FormatProvider`

Add a `packages/format-<country>/` package that exports a provider implementing the interface in
[`packages/core/src/provider.ts`](packages/core/src/provider.ts):

- **`meta: FormatMeta`** — `id`, optional `aliases`, `label`, `country`, `standard`, `syntax`
  (`'UBL' | 'CII' | 'PDF' | 'hybrid' | …`), `outputKind` (`'xml' | 'pdf' | 'hybrid'`), optional
  `profiles` / `defaultProfile`, `fileExtension`, `mimeType`, `requires?`, and — read honestly —
  **`bundleable: boolean`**.
- **`validate(model, profile?): ValidationResult`** — a *cheap pre-flight*, **not** the
  authoritative validator. Layer your country's checks on top of the shared
  `baseEn16931Issues(model)` from `@invoice-iob/core` (see `brDeIssues()` in `format-xrechnung` for
  the pattern), and return via the `validationResult(issues)` helper.
- **`render(model, options): Promise<RenderedArtifact>`** — produce `{ bytes, mimeType, extension }`
  from the canonical model. **Choose a pure-JS engine/lib wherever one exists.** If the EU engine
  already covers your format (e.g. FR Factur-X), reuse `@invoice-iob/engine-e-invoice-eu`. If it
  doesn't (FatturaPA, Facturae, KSeF are *not* in `@e-invoice-eu/core`), wrap a JS library — and if
  the only correct option needs a JVM / Go runtime / external binary, set **`bundleable: false`** and
  declare what it `requires`. **Never recompute amounts** — read them off the model.

### 2. Fold country-specific input into the model via `mapExtensions`

Country-specific fields that don't have an EN 16931 business term belong in the canonical model's
**extension area**, not new top-level model fields. Implement the optional
`mapExtensions(input): Record<string, unknown>` on your provider so friendly input maps into the
extension bag, and read it back in `render`. The canonical EN 16931 BT/BG model stays the shared
backbone; your CIUS-specific bits ride alongside it.

### 3. Add a per-locale visual template (only if you want PDF output)

For an XML-only format you can skip this. If you want a visual PDF or a hybrid (PDF/A-3), add a
per-locale template driven by the visual renderer (`@invoice-iob/pdf-renderer`, P1). For hybrids,
remember the **LibreOffice-avoidance rule**: for Factur-X/ZUGFeRD **always pass `options.pdf`** and
**never** `options.spreadsheet` / `options.libreOfficePath` — that is the only thing that spawns
LibreOffice. XML formats never touch it.

### 4. Add conformance fixtures + wire the official validator into CI

- Ship **conformance fixtures** (sample inputs + expected artifacts). The smoke harness
  (`scripts/smoke.mjs`) is the pattern for generating them: it spawns the bundle and drives it via
  the MCP SDK client.
- Wire the **official validator** for your format into CI:
  - **XRechnung / EN 16931 XML** → **KoSIT validator** (1.6.2) with
    `validator-configuration-xrechnung`. **Footgun:** KoSIT exits 0 even for INVALID invoices — you
    MUST parse its XML report (VARL): assert `<rep:assessment>` contains `<rep:accept>` and there
    are zero `<rep:message level="error">`. Never trust the exit code. (See `scripts/kosit-check.mjs`.)
  - **Hybrid PDF/A-3** → **veraPDF** (`-f 3b`, `isCompliant=true`, `failedChecks=0`) **plus** the
    **ZUGFeRD / Mustangproject** validator (`--action validate`, `status=valid`, profile matches).
  - Other nationals → their official conformance check (e.g. SdI for FatturaPA) where one exists.

### 5. Register the provider + compose it in the server

Export a `register(registry: FormatRegistry)` function from your package that registers the
provider(s). Then wire it into the server's registry composition in
[`packages/server/src/registry.ts`](packages/server/src/registry.ts) — import your `register` and
call it inside `buildRegistry()`. Once registered, the format shows up in `list_formats`
automatically.

### 6. Update the support matrix + CODEOWNERS

- Add a row to [`docs/SUPPORT_MATRIX.md`](docs/SUPPORT_MATRIX.md) (country, format, standard, output,
  status, **bundleable**).
- Add a `CODEOWNERS` entry for your package so future changes route to you for review.

### Merge gate (the quality bar for a new format)

A new format lands only when it:

- **passes its official validator in CI** where one exists (KoSIT for XRechnung; veraPDF + the
  ZUGFeRD validator for hybrids; the national check otherwise);
- **ships fixtures + docs** (conformance samples and an entry in the provider guide / support matrix);
- **declares bundleability honestly** in `meta.bundleable`;
- **pulls no native dependencies into the default bundle** unless they are explicitly marked
  optional (`bundleable: false` + `requires`).

## Reporting issues

Use the templates in [`.github/ISSUE_TEMPLATE`](.github/ISSUE_TEMPLATE). For a compliance bug,
include the input, the format, and — if you have it — the validator report.

## License

By contributing you agree your contributions are licensed under [Apache-2.0](LICENSE). See
[`NOTICE`](NOTICE) for third-party attributions.
