# Contributing to invoice-iob

Thanks for helping turn simple invoice fields into compliant EN 16931 e-invoices. This project is
architected so **new countries and formats are added as plugins, not forks** — if you came here to
add one, jump straight to [Add a new country/format](#add-a-new-countryformat-the-headline-recipe).

Before writing code or docs, skim [`README.md`](README.md), [`docs/STACK.md`](docs/STACK.md), and
[`PLAN.md`](PLAN.md) so your change stays consistent with the decisions already made. Deeper
extension detail lives in [`docs/PROVIDER_GUIDE.md`](docs/PROVIDER_GUIDE.md); the living list of
what's supported is [`docs/SUPPORT_MATRIX.md`](docs/SUPPORT_MATRIX.md).

## Dev setup

Node ≥ 22 for development (dev/CI run on Node 24; `pnpm test` executes the TypeScript tests via
Node's native type-stripping, which is default on Node ≥ 22.18) and the pinned pnpm — no native
toolchain, no JVM, no LibreOffice, no Chromium required to build or run the server. The shipped
`.mcpb` is plain JS and runs on Node ≥ 20.

```bash
corepack enable        # activates the pnpm version pinned in package.json
pnpm install           # installs the workspace (pnpm 10.32)
```

The exact root scripts (run from the repo root):

```bash
pnpm run build          # esbuild → single self-contained dist/bundle/server/index.mjs
pnpm run typecheck      # tsc --noEmit -p tsconfig.json  (the CI type source of truth)
pnpm test               # node --test  (unit tests + the report-parser gate tests)
pnpm run check:coverage # drift guard: every registered format maps to a CI gate (needs build)
pnpm run smoke          # build + drive the bundled server over a real MCP stdio handshake
pnpm run fixtures       # generate one conformance fixture per path × example (needs build)
pnpm run pack:mcpb      # build + mcpb pack → dist/invoice-iob.mcpb
pnpm run format         # prettier --write
pnpm run format:check   # prettier --check (enforced in CI — run before you push)
```

To run the official validators locally exactly as CI does (KoSIT, EN 16931 Schematron, Mustang),
see [`docs/CI.md`](docs/CI.md) → "Running the validators locally".

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
pnpm test`. For anything that touches the server, a renderer, or the format set, also run
  `pnpm run smoke` and `pnpm run check:coverage`.
- Open a PR against the default branch. CI runs format:check → typecheck → test → build → **coverage
  drift guard** → pack → smoke on a Node 20/22/24 matrix, plus the official-validator gates (KoSIT,
  EN 16931 Schematron, Mustang/veraPDF) for every output path × example (see the merge gate below
  and [`docs/CI.md`](docs/CI.md)). Fill in the PR template and link the relevant issue.
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
- **`validate(model, profile?): ValidationResult`** — a _cheap pre-flight_, **not** the
  authoritative validator. Layer your country's checks on top of the shared
  `baseEn16931Issues(model)` from `@invoice-iob/core` (see `brDeIssues()` in `format-xrechnung` for
  the pattern), and return via the `validationResult(issues)` helper.
- **`render(model, options): Promise<RenderedArtifact>`** — produce `{ bytes, mimeType, extension }`
  from the canonical model. **Choose a pure-JS engine/lib wherever one exists.** If the EU engine
  already covers your format (e.g. FR Factur-X), reuse `@invoice-iob/engine-e-invoice-eu`. If it
  doesn't (FatturaPA, Facturae, KSeF are _not_ in `@e-invoice-eu/core`), wrap a JS library — and if
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

### 4. Map your path into the validation matrix (this is what makes CI validate it)

CI validates **every output path × every example** against an official validator on every push, all
driven by one file: [`scripts/lib/matrix.mjs`](scripts/lib/matrix.mjs). The **drift guard**
(`pnpm run check:coverage`) fails until your new format has a row there — so this step is not
optional. Full runbook: [`docs/CI.md`](docs/CI.md) → "Adding a new path".

- **Add a `FORMAT_COVERAGE` row** keyed by your provider's canonical `meta.id`, pointing at the gate
  that proves its conformance:
  - an XRechnung-like CIUS → `gate: 'kosit'`;
  - generic EN 16931 XML → `gate: 'en16931'` (set `syntax: 'UBL' | 'CII'` — validated against the
    CEN Schematron via Saxon-HE);
  - a ZUGFeRD/Factur-X hybrid → `gate: 'mustang'` (list its `profiles`, and any `embeddedKosit`
    profiles whose embedded XML should also pass KoSIT);
  - a visual-only artifact with no formal validator → `gate: 'smoke'` (add structural checks to
    `scripts/smoke.mjs`).
- **No fixtures to hand-author** — [`scripts/gen-fixtures.mjs`](scripts/gen-fixtures.mjs) drives the
  bundle and emits a fixture per path × example automatically.
- **A genuinely new validator** (e.g. SdI for FatturaPA)? Add a pinned `scripts/ci/fetch-<tool>.sh`,
  a new gate in `GATES`, a `scripts/<tool>-check.mjs` that **parses the report, never the exit
  code**, the parse logic + a unit test in `scripts/lib/reports.{mjs,test.mjs}`, and a CI job
  mirroring the existing ones.

**The report-not-exit-code footgun (load-bearing):** KoSIT exits `0` even for INVALID invoices
(Saxon and Mustang have their own exit-code quirks). Always parse the validator's report — VARL
`<rep:accept>` + zero `<rep:message level="error">` for KoSIT, zero `<svrl:failed-assert flag="fatal">`
for the EN 16931 Schematron, `<summary status="valid">` for Mustang. The unit-tested parsers in
`scripts/lib/reports.mjs` guarantee a gate can never silently become an always-pass.

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
