# invoice-iob — Engineering Architecture

> How the pieces fit together. This is the engineering view; for the *decisions* behind each
> choice (pinned versions, the LibreOffice footgun, PDF/A ownership, fonts) see
> [`docs/STACK.md`](STACK.md). For the roadmap see [`PLAN.md`](../PLAN.md); for the product spec
> see [`PRD.md`](../PRD.md).

invoice-iob is a fully local MCP server that turns simple invoice fields into EN 16931
e-invoices. The whole system is one idea repeated: **friendly input becomes a canonical model
once, and every output renders from that one model.** XML and PDF can never disagree because they
are two renderings of the same numbers.

---

## 1. The pipeline

A single, linear flow. The friendly JSON the user supplies is parsed and mapped into a canonical
EN 16931 model (with VAT/tax computed in integer cents along the way); the resolved
`FormatProvider` validates that model against its rules, then renders it to artifact bytes; the
server writes the bytes to disk. The registry sits to the side, feeding both `create_invoice`
(resolve a `format` string → provider) and `list_formats` (enumerate providers).

```
                                         ┌─────────────────────────────┐
                                         │      Format Registry        │
                                         │  id/alias → FormatProvider   │
                                         └──────────────┬──────────────┘
                          resolve(format) │             │ list()
                                          │             │
                                          ▼             ▼
  friendly JSON ─▶ createInvoiceShape ─▶ mapToCanonical ─▶  CanonicalInvoice ─▶ provider.validate
   (user fields)     (zod v4 parse)      (+ cents tax math)  (EN16931 BT/BG)          │
                                                                                      │ ok?
                                                                                      ▼
                                                                            provider.render(model)
                                                                                      │
                                                              ┌───────────────────────┤
                                                              ▼                       ▼
                                                       engine adapter            pdf-renderer (P1/P2)
                                                  (@e-invoice-eu/core)         (@cantoo/pdf-lib)
                                                              │                       │
                                                              └───────────┬───────────┘
                                                                          ▼
                                                                  RenderedArtifact
                                                                {bytes, mimeType, ext}
                                                                          │
                                                                          ▼
                                                            writeArtifact → output dir
                                                       <invoiceNumber>-<format>.<ext>
```

Two MCP tools sit at the front (`packages/server/src/index.ts`):

- **`create_invoice`** runs the full pipeline above. On a validation `error` it returns
  `{ isError: true }` with the rule messages (the model sees them and can fix the input); on
  success it returns structured content with the saved path and the net/VAT/gross totals **read
  back from the canonical model**, never recomputed.
- **`list_formats`** is a pure read of `registry.list()` — id, label, country, syntax, output
  kind, bundleable/available, profiles.

The output directory comes from `INVOICE_IOB_OUTPUT_DIR`; files are named
`<invoiceNumber>-<format>.<ext>`.

---

## 2. The canonical invoice model — single source of truth

`@invoice-iob/core` owns one model: `CanonicalInvoice` (`src/model.ts`), a flat representation of
EN 16931 business terms and groups (BT-/BG-). Everything funnels through it:

- **Input maps in once.** `createInvoiceShape` (`src/input.ts`, zod v4) parses friendly fields;
  `mapToCanonical` (`src/mapper.ts`) turns them into the canonical model.
- **Tax math happens here, once.** The mapper computes line nets, the VAT breakdown, and the
  document totals in **integer minor units (cents)** via `src/money.ts` (`toCents`, `vatCents`,
  `lineNetCents`, `formatMoney`). EN 16931 business rules (BR-CO-10..16, the per-category
  BR-S/E/Z/AE-08..10) compare the *printed* 2-decimal values, so amounts must be consistent to
  the cent — computing in cents avoids binary-float drift. Unit prices (BT-146) may carry more
  than two decimals and are formatted separately via `formatDecimal`.
- **Renderers never recompute.** A `FormatProvider.render` reads totals straight off
  `model.totals` and `model.vatBreakdown` and serializes them. The server's success message
  likewise reads `model.totals.{taxExclusiveAmount,taxAmount,taxInclusiveAmount}`. Nothing
  downstream re-derives an amount.

This is the load-bearing invariant. If the XML and the PDF were each free to do their own
arithmetic, rounding could diverge and the two artifacts for the same invoice could disagree —
exactly the failure EN 16931's cross-total rules are designed to catch. One model, computed once,
makes that class of bug impossible.

```
            friendly fields (numbers as the user typed them)
                                │
                                ▼
                  mapToCanonical  ── cents math (money.ts) ──┐
                                │                            │
                                ▼                            ▼
                       CanonicalInvoice          totals + vatBreakdown
                      (BT/BG, single truth)        (computed ONCE)
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼                ▼
            UBL render      CII render       PDF render      ← all read, none recompute
```

---

## 3. The extension point: `FormatProvider` + registry + explicit `register()`

A new country or format is **a new `FormatProvider`, not a fork of the pipeline**. The interface
lives in `packages/core/src/provider.ts`:

```ts
interface FormatProvider {
  readonly meta: FormatMeta;                                  // id, aliases, label, country,
                                                              //   standard, syntax, outputKind,
                                                              //   profiles, fileExtension,
                                                              //   mimeType, bundleable, requires
  validate(model: CanonicalInvoice, profile?: string): ValidationResult;   // cheap pre-flight
  render(model: CanonicalInvoice, options: RenderOptions): Promise<RenderedArtifact>;
  mapExtensions?(input: unknown): Record<string, unknown>;    // fold country-specific input
}
```

`validate` is a **cheap pre-flight** — generic checks (`baseEn16931Issues(model)`) plus any CIUS
rules the format layers on. It is deliberately *not* the authoritative validator. The real gate is
the external KoSIT / veraPDF / Mustang toolchain that runs in CI (Java, never bundled). Issues
carry a `rule` id and a `severity`; `validationResult(issues)` sets `ok` to `false` if any issue
is an `error`. XRechnung's `brDeIssues(model)` (`packages/format-xrechnung/src/index.ts`) is the
worked example: BR-DE-15 (buyer reference mandatory), BR-DE-5/6/7 (seller contact point),
BR-DE-16 (seller VAT id or tax registration), and an IBAN warning for SEPA credit transfer.

### The registry

`FormatRegistry` (`packages/core/src/registry.ts`) maps every id **and alias** (case-insensitive)
to a provider, throwing on a conflicting key, and remembers registration order so `list()` is
deterministic. `resolve(formatId)` powers `create_invoice`; `list()` powers `list_formats`;
`canonicalIds()` is used to build a helpful "unknown format" error.

### Explicit `register()` DI — not import side-effects

Each format package exports a `register(registry: FormatRegistry)` function. The server composes
them explicitly in `packages/server/src/registry.ts`:

```ts
export function buildRegistry(): FormatRegistry {
  const registry = new FormatRegistry();
  registerXRechnung(registry);  // DE launch formats first
  registerUblCii(registry);     // generic EU formats
  return registry;
}
```

This is deliberate. The alternative — a module-level `registry.register(...)` side-effect that
runs on import — is fragile under a tree-shaking bundler: esbuild can legally drop a module whose
imported bindings appear unused, taking the registration with it. Explicit DI means a provider is
registered **iff** the server chose to wire it in. It is also trivially testable (build a registry
with just the providers under test) and makes the build's format set a single, readable list.

```
   format-xrechnung ─┐  register(registry)
                     ├──────────────────────▶  buildRegistry()  ──▶  FormatRegistry
   format-ubl-cii ───┘                              (server)              │
                                                                          ├─▶ resolve() → create_invoice
                                                                          └─▶ list()    → list_formats
```

`FormatMeta.bundleable` lets the registry advertise a provider that needs a runtime not in the
default Node-only `.mcpb` (a future JVM/Go/binary-backed format): it appears in `list_formats`
with `available: false` rather than vanishing.

---

## 4. The engine adapter (`@invoice-iob/engine-e-invoice-eu`)

`core` is engine-agnostic. All knowledge of `@e-invoice-eu/core` (WTFPL) is quarantined in this
one adapter package, behind a two-function surface:
`generateXml(model, format, {lang})` → `string` and
`generateFacturX(model, {profile, pdf, lang})` → `Uint8Array` (`src/engine.ts`).

### One UBL-JSON tree for every format

The engine does **not** take simple invoice JSON. Its input is a UBL-syntax JSON `Invoice` tree
(`src/serialize.ts`, `serializeToUbl(model)`), and three things about its encoding are easy to get
wrong:

1. **Root + namespaced keys.** Root is `ubl:Invoice`; fields are `cbc:`/`cac:`-prefixed and mapped
   by EN 16931 BT/BG codes.
2. **Attributes are flattened sibling keys**, not nested objects:
   `'cbc:LineExtensionAmount@currencyID'`, `'cbc:InvoicedQuantity@unitCode'`,
   `'cbc:CompanyID@schemeID'` live *next to* their value key.
3. **All amounts/quantities/rates are strings** (`formatMoney`, `formatDecimal`, `formatRate`),
   never numbers.

We build **one** UBL-JSON tree and reuse it for UBL, CII, XRechnung-UBL/CII, and Factur-X — the
engine internally transforms UBL→CII as needed. We **omit** `cbc:CustomizationID`/`cbc:ProfileID`
so the engine fills the correct per-format URNs (e.g. the XRechnung 3.0 CIUS URN). The engine's TS
types are enormous closed unions (every ISO currency/unit code); we build a structurally-correct
object, rely on the engine's runtime Ajv validation, and assert the engine type only at the
boundary.

### The Factur-X path: supply our own PDF

For hybrid output we hand the engine **our own** rendered visual PDF and let it do the PDF/A-3
assembly (see §7). `generateFacturX` asserts a non-empty source PDF and passes it as
`options.pdf = { buffer, filename, mimetype: 'application/pdf' }` — note the lowercase-`t`
`mimetype`, which is the field the engine's `FileInfo` actually uses.

### The LibreOffice-avoidance guard (load-bearing)

`@e-invoice-eu/core` *does* import `child_process` and *can* spawn LibreOffice — but only on its
spreadsheet→PDF path. The Node-only-bundle promise holds **only** if we never take that path. The
adapter enforces it with `assertNoLibreOffice(options)`, called before every `generate()`, which
throws if `options.spreadsheet` or `options.libreOfficePath` is ever set:

```
generateXml / generateFacturX
        │
        ├─ serializeToUbl(model)                 (build the one UBL-JSON tree)
        ├─ assertNoLibreOffice(options)          ← throws if spreadsheet/libreOfficePath present
        └─ InvoiceService.generate(invoice, options)
                 │
                 ├─ XML formats ............... never touch LibreOffice
                 └─ Factur-X with options.pdf .. returns our buffer; spawn(libreoffice) unreachable
```

So: XML formats never trigger it, the Factur-X path always passes `options.pdf` and never the
spreadsheet options, and `MappingService` is never used. The engine's LibreOffice code then
bundles as harmless, provably-unreachable dead code. The guard is exported for a unit test.

The adapter also constructs `InvoiceService` with a **stderr logger** (`src/logger.ts`): stdout is
the MCP JSON-RPC channel and any stray write there corrupts the protocol and hangs the client.

---

## 5. Package layout & dependency direction

pnpm workspaces, no task runner. Every package is private, `type: module`, and exports
`./src/index.ts`. The dependency arrows point one way — **`core` depends on nothing app-specific;
the server composes everything.**

```
                         ┌──────────────────────────────┐
                         │      @invoice-iob/core        │   dep: zod only
                         │  model · provider · registry  │   (no MCP, no engine)
                         │  input · mapper · money ·      │
                         │  validation · errors          │
                         └───────────────┬───────────────┘
                                         │ (everything imports core)
              ┌──────────────────────────┼───────────────────────────┐
              ▼                          ▼                            ▼
   @invoice-iob/engine-       @invoice-iob/format-ubl-cii   @invoice-iob/format-xrechnung
        e-invoice-eu          (ubl, cii)                    (xrechnung-ubl, xrechnung-cii)
   wraps @e-invoice-eu/core           │                            │
   serializeToUbl · guard             └──────────┬─────────────────┘
              ▲                                  │  (providers call the adapter to render)
              └──────────────────────────────────┘
                                         ▲
                                         │ composes (register + tools + bundle)
                         ┌───────────────┴───────────────┐
                         │     @invoice-iob/server        │   deps: core, format pkgs,
                         │  MCP stdio · buildRegistry()    │         MCP SDK, zod
                         │  bundle entrypoint src/index.ts │
                         └────────────────────────────────┘

   (P1/P2, not yet created): pdf-renderer ─▶ format-pdf, format-zugferd
```

Why this shape:

- **`core` is engine- and transport-agnostic** (its only dependency is zod). A future non-MCP
  adapter (CLI, HTTP) can reuse the model, mapper, registry, and providers unchanged.
- **The engine adapter is the only package that knows `@e-invoice-eu/core` exists** — the WTFPL
  dependency and the UBL-JSON encoding are quarantined behind two functions.
- **Format packages depend on `core` + the adapter**, never on each other.
- **The server is the only composition root.** It imports the format packages, calls their
  `register()`, registers the MCP tools, and is the esbuild entrypoint. Adding a country = create
  a provider package, then add one `register(...)` line here.

---

## 6. Build & bundle

`pnpm run build` = `node scripts/build.mjs`, a single esbuild call (no tsup, no task runner). It
produces one self-contained ESM file: `dist/bundle/server/index.mjs` — the artifact every client
runs, and what `mcpb pack` wraps into `dist/invoice-iob.mcpb`.

Key esbuild settings (`scripts/build.mjs`):

- `bundle: true`, `platform: 'node'`, `format: 'esm'`, `target: 'node20'`, `minify: true`.
- **Externalize nothing.** All deps inline; only `node:` builtins stay external. The MCP SDK
  transitively pulls express/hono/jose, all tree-shaken away for a stdio-only entrypoint.
- **`createRequire` banner.** The shebang `#!/usr/bin/env node` must be byte 0, followed by a shim
  that reconstructs `require`, `__filename`, and `__dirname` from `import.meta.url`. Bundled-in CJS
  transitive deps call `require()`/`__dirname` at runtime under ESM, and without the shim they
  throw.
- **Binary asset loader.** `loader: { '.ttf': 'binary', '.otf': 'binary', '.icc': 'binary' }` so a
  font `import` yields a `Uint8Array` inlined into the bundle. The visual PDF font (IBM Plex Sans,
  OFL-1.1) ships *inside* the `.mjs` with no runtime file resolution — the bundle is fully
  self-contained. (Subset at render time; see [`docs/STACK.md`](STACK.md#fonts).)
- The output is `chmod 0o755`; the script prints size and module count.

**Typecheck is separate from build.** esbuild strips types and never typechecks.
`pnpm run typecheck` = `tsc --noEmit -p tsconfig.json` is the CI source of truth. `skipLibCheck`
is mandatory (tsc otherwise hangs crawling the Zod4 + SDK `.d.ts` graph), and source uses
erasable-syntax only so Node's type-stripping and esbuild agree.

```
   packages/*/src/*.ts ──┬──▶ esbuild (build.mjs) ──▶ dist/bundle/server/index.mjs ──▶ mcpb pack ──▶ .mcpb
                         │     bundle, ESM, node20            (single file, banner,        (Node-only,
                         │     inline deps + assets            inlined fonts)               877 KB)
                         │
                         └──▶ tsc --noEmit (skipLibCheck)  ←  separate, CI source of truth
```

Validators (KoSIT 1.6.2, veraPDF 1.30, Mustangproject 2.24.0) are **CI/dev only, Java, never
bundled.** The KoSIT footgun: it exits 0 even for invalid invoices, so CI must parse its VARL
report for `recommendation=accept` and zero `rep:error`, never trust the exit code.

---

## 7. PDF/A-3 ownership split (P2)

For ZUGFeRD/Factur-X the work is split cleanly between *us* and the engine. We render a **clean
source PDF**; the engine turns it into a conformant PDF/A-3 and attaches the XML. We do **not**
ship an ICC profile — the engine embeds its own inline sRGB profile.

```
   CanonicalInvoice
        │
        ▼
   pdf-renderer (@cantoo/pdf-lib + fontkit)            engine (@e-invoice-eu/core)
   ───────────────────────────────────────             ──────────────────────────────────
   WE OWN — the clean source PDF:                       ENGINE OWNS — the PDF/A-3 wrapper:
     • subset-embed every font (fontkit)                  • sRGB OutputIntent + inline ICC
     • DeviceRGB / DeviceGray only                        • XMP packet (pdfaid:part=3,
     • unencrypted                                          conformance B, Factur-X block)
     • no AcroForm / JS / multimedia                      • CII XML embedded as Associated File
     • no pre-set /Metadata /OutputIntents /AF              factur-x.xml (AFRelationship=Alternative)
        │                                                  • /MarkInfo + /StructTreeRoot, /ID, etc.
        │  visual PDF bytes (Uint8Array)                          ▲
        └──────────────────────────────────────────────▶ options.pdf.buffer
```

The boundary matters because the engine adds OutputIntent/XMP/AF but does **not** fix a missing
embedded font or non-Device color in our input PDF — so PDF/A-3 conformance depends on *our*
render quality, and the engine's pdf-lib PDF/A path is upstream-flagged "not battle tested." That
is exactly why the veraPDF (`-f 3b`) and Mustang validation CI gates are mandatory on every build.
Full rationale and the exact MUST/MUST-NOT list are in
[`docs/STACK.md`](STACK.md#pdfa-3-ownership-split).

---

## See also

- [`docs/STACK.md`](STACK.md) — pinned versions, the 16 PRD corrections, deep rationale.
- [`PLAN.md`](../PLAN.md) — phasing (P0 done; P1 PDF; P2 ZUGFeRD/Factur-X; P3 open up).
- [`PRD.md`](../PRD.md) — the product spec.
- [`README.md`](../README.md) — install matrix and quick start.
