# Writing a FormatProvider

> How to add a country or format to invoice-iob. A new format is a **plugin, not a fork**: you
> implement one stable interface, register it, and the core pipeline — friendly input → tax math →
> canonical model → `list_formats` / `create_invoice` — is untouched.

This guide assumes you've read [`README.md`](../README.md) (architecture) and
[`docs/STACK.md`](STACK.md) (stack decisions and the load-bearing rules). It walks through a
hypothetical `@invoice-iob/format-acme` package — a fictional national XML format for country
"AC" — to show every part of the contract end-to-end. Match the real interface in
[`packages/core/src/provider.ts`](../packages/core/src/provider.ts); the snippets below mirror it
exactly.

## The big picture

```
friendly input ─▶ Input Mapper ─▶ Canonical Invoice Model ─▶ FormatProvider.render ─▶ artifact
   (zod, core)     (+ tax math)     (EN16931 BT/BG + ext bag)   (validate + engine/lib)   (xml/pdf/hybrid)
                                          ▲
                                   Format Registry  ◀── providers register; list_formats reads it
```

The **canonical invoice model** ([`packages/core/src/model.ts`](../packages/core/src/model.ts)) is
the single source of truth. Amounts (line nets, VAT breakdown, totals) are computed once by the
input mapper. **A provider's `render()` reads the model — it MUST NOT recompute amounts.** That
invariant is what guarantees the XML and the (future) PDF can never disagree.

A `FormatProvider` does three things:

1. **declares metadata** (`meta`) — id, label, country, syntax, output kind, file extension,
   MIME type, and the honest `bundleable` flag;
2. **validates** the canonical model against its CIUS / national business rules (`validate`);
3. **renders** the artifact bytes (`render`).

Plus one optional hook: `mapExtensions`, to fold country-specific friendly input into the model's
extension bag.

## The interface

From `@invoice-iob/core` (do not redefine these — import them):

```ts
interface FormatMeta {
  id: string; // canonical, stable, kebab-case: "acme-xml"
  aliases?: string[]; // case-insensitive alternates: ["acme", "ac-national"]
  label: string; // human-readable, for list_formats
  country: string; // ISO 3166-1 alpha-2, or "EU" for pan-European generic
  standard: string; // e.g. "EN 16931" or "AC National e-Invoice 1.0"
  syntax: 'UBL' | 'CII' | 'PDF' | 'hybrid' | string;
  outputKind: 'xml' | 'pdf' | 'hybrid';
  profiles?: string[]; // for hybrids; omit for single-profile formats
  defaultProfile?: string;
  fileExtension: string; // without the dot: "xml"
  mimeType: string; // "application/xml"
  bundleable: boolean; // true = pure-JS, ships in the default Node-only .mcpb
  requires?: string[]; // native runtimes for non-bundleable providers
}

interface ValidationIssue {
  rule?: string;
  message: string;
  severity: 'error' | 'warning';
}
interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
} // helper: validationResult(issues)

interface RenderOptions {
  profile?: string;
  lang?: string;
}
interface RenderedArtifact {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
}

interface FormatProvider {
  readonly meta: FormatMeta;
  validate(model: CanonicalInvoice, profile?: string): ValidationResult;
  render(model: CanonicalInvoice, options: RenderOptions): Promise<RenderedArtifact>;
  mapExtensions?(input: unknown): Record<string, unknown>;
}
```

Each format package exports a `register(registry: FormatRegistry)` function; the server composes
them. `validationResult(issues)` is the convenience constructor — `ok` is `true` iff there are no
`error`-severity issues (warnings don't block).

## The `validate()` contract — cheap pre-flight, NOT the authoritative validator

This is the rule contributors most often get wrong. `validate()` is a **fast, in-process,
dependency-free pre-flight**. Its only job is to catch the common, high-value rule violations
early so `create_invoice` returns a clear, actionable error instead of emitting an invoice that
fails downstream. It must:

- **never throw** — return `ValidationResult` with `issues`;
- be **cheap** — no network, no spawning Java, no file I/O;
- layer **national rules on top of the shared base**: start from `baseEn16931Issues(model)` (in
  `@invoice-iob/core`) and add your country's CIUS rules (the way
  [`format-xrechnung`](../packages/format-xrechnung/src/index.ts) adds `brDeIssues` for German
  BR-DE-\*).

It is **NOT** the authoritative validator. The real conformance gate is the external Java/veraPDF
toolchain that runs in **CI only**, never in the shipped bundle:

- **KoSIT** validator + the XRechnung Schematron config (EN 16931 + BR-DE), for XML.
- **veraPDF** (PDF/A-3b) and **Mustangproject** (Factur-X profile/container), for hybrids.

> **KoSIT footgun (do not forget):** the KoSIT validator exits `0` even for INVALID invoices.
> The CI gate MUST parse its XML report (VARL): assert the `<rep:assessment>` contains
> `<rep:accept>` and there are zero `<rep:message level="error">` — never trust the exit code.
> (See `scripts/kosit-check.mjs`.) See [`docs/STACK.md`](STACK.md) §"PRD corrections" #10.

So: your `validate()` gives the model a friendly heads-up; CI proves real conformance. Don't try to
reimplement Schematron in TypeScript — implement the handful of rules that produce the clearest
user-facing errors, and let CI catch the long tail.

## `bundleable` and `requires` — be honest

`bundleable` decides whether your provider ships in the default one-click `.mcpb`, which is
**Node-only, no native runtime, no JVM, no external binary**.

- `bundleable: true` — your provider is pure JS (e.g. it wraps `@e-invoice-eu/core` like the
  launch formats, or builds XML with a JS library). It ships by default, so `list_formats` reports
  `available: true` for it.
- `bundleable: false` — your provider needs something the default bundle can't carry (a JVM for a
  Java signing lib, a Go binary, an external CLI). Declare what it needs in `requires`
  (e.g. `requires: ['java']`). The registry still lists it, but it is excluded when the caller
  asks for available-only formats. This is exactly the split that lets ES (Facturae, XAdES
  signing) and IT (FatturaPA, no JS lib yet) live in the matrix without bloating or breaking the
  default install. See [`SUPPORT_MATRIX.md`](SUPPORT_MATRIX.md).

Lying here breaks the install promise. If your renderer would shell out to a binary that isn't in
the bundle, it is **not** bundleable, full stop.

## The LibreOffice guard rule (load-bearing)

This applies the moment you touch the **Factur-X / ZUGFeRD** path of `@e-invoice-eu/core` (P2 and
the FR provider). The engine can produce a PDF two ways: from a spreadsheet (which spawns
**LibreOffice**) or from a PDF you supply. **invoice-iob's "no LibreOffice" promise holds only on
the supply-a-PDF path.**

- For Factur-X, **ALWAYS** pass `options.pdf` (your own rendered visual PDF bytes).
- **NEVER** pass `options.spreadsheet` or `options.libreOfficePath`, and never use `MappingService`.
  Those are the only LibreOffice triggers.
- **XML formats never touch LibreOffice** at all — if you're writing an XML-only provider (like
  `format-acme` below), this rule simply doesn't come up for you, but don't introduce a code path
  that could.

The engine adapter exposes `assertNoLibreOffice` (from `@invoice-iob/engine-e-invoice-eu`) as a
runtime guard; the Factur-X wrapper already enforces it. If you call the engine directly for a
hybrid, assert it yourself and unit-test the guard. The LibreOffice code then bundles as harmless
dead code. Full detail in [`docs/STACK.md`](STACK.md) §"Engine integration".

## A complete `format-acme` package

A fictional national XML format for country "AC". It is XML-only, pure JS, and therefore
bundleable. It reuses the shared EN 16931 checks, adds two national rules, and folds one
country-specific input field (`acmeTaxOfficeCode`) into the canonical extension bag.

### `packages/format-acme/package.json`

Mirror the existing format packages: private, `type: module`, `exports` pointing at the TypeScript
source (esbuild bundles; we don't pre-compile), and **workspace-protocol** deps on core plus
whatever engine/lib you render with.

```json
{
  "name": "@invoice-iob/format-acme",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "ACME national e-invoice (XML) provider for country AC, with AC business rules.",
  "license": "Apache-2.0",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "node --test"
  },
  "dependencies": {
    "@invoice-iob/core": "workspace:*",
    "@invoice-iob/engine-e-invoice-eu": "workspace:*"
  }
}
```

> If your format is **not** in `@e-invoice-eu/core` (FatturaPA, Facturae, KSeF), drop the engine
> dep and add your own pure-JS XML/serialization library instead — and set `bundleable`
> accordingly. The engine dep above is only because `format-acme` pretends to be an EN 16931 CIUS
> the engine can emit.

### `packages/format-acme/src/index.ts`

```ts
/**
 * @invoice-iob/format-acme — ACME national e-invoice (XML) provider for country "AC".
 * Reuses the shared EN 16931 pre-flight checks and layers AC-specific business rules on top.
 */
import {
  baseEn16931Issues,
  validationResult,
  type CanonicalInvoice,
  type FormatMeta,
  type FormatProvider,
  type FormatRegistry,
  type RenderOptions,
  type RenderedArtifact,
  type ValidationIssue,
  type ValidationResult,
} from '@invoice-iob/core';
import { generateXml } from '@invoice-iob/engine-e-invoice-eu';

const STANDARD = 'AC National e-Invoice (EN 16931 CIUS)';

/** AC-specific friendly input that lives outside EN 16931. */
interface AcmeExtensionInput {
  /** AC tax-office routing code; required for AC, has no EN 16931 business term. */
  acmeTaxOfficeCode?: string;
}

/** Where we stash AC fields in the canonical model's extension bag. */
const ACME_EXT_KEY = 'acme';

interface AcmeExtensions {
  taxOfficeCode?: string;
}

/** AC national rules that go beyond generic EN 16931 (the subset worth surfacing early). */
function acmeIssues(model: CanonicalInvoice): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (message: string, rule: string): void => {
    issues.push({ severity: 'error', message, rule });
  };

  // AC-01: the AC tax-office routing code is mandatory and lives in extensions.
  const ext = model.extensions[ACME_EXT_KEY] as AcmeExtensions | undefined;
  if (!ext?.taxOfficeCode) {
    error('AC tax-office routing code is mandatory for the ACME format.', 'AC-01');
  }

  // AC-02: AC accepts EUR invoices only (illustrative national constraint).
  if (model.currency !== 'EUR') {
    error('The ACME format only supports EUR-denominated invoices.', 'AC-02');
  }

  return issues;
}

function xmlArtifact(xml: string): RenderedArtifact {
  return { bytes: new TextEncoder().encode(xml), mimeType: 'application/xml', extension: 'xml' };
}

const meta: FormatMeta = {
  id: 'acme-xml',
  aliases: ['acme', 'ac-national'],
  label: 'ACME National e-Invoice (XML)',
  country: 'AC',
  standard: STANDARD,
  syntax: 'UBL',
  outputKind: 'xml',
  fileExtension: 'xml',
  mimeType: 'application/xml',
  // Pure JS over the engine → ships in the default Node-only .mcpb.
  bundleable: true,
};

export const acmeProvider: FormatProvider = {
  meta,

  validate(model: CanonicalInvoice): ValidationResult {
    // Cheap pre-flight: shared EN 16931 checks first, then AC national rules.
    // This is NOT the authoritative validator — CI runs the external toolchain.
    return validationResult([...baseEn16931Issues(model), ...acmeIssues(model)]);
  },

  async render(model: CanonicalInvoice, options: RenderOptions): Promise<RenderedArtifact> {
    // Read the canonical model; NEVER recompute amounts here.
    // (For a real national format you'd call your own serializer instead of the EU engine.)
    const xml = await generateXml(model, 'UBL', { lang: options.lang ?? 'en' });
    return xmlArtifact(xml);
  },

  /**
   * Fold AC-specific friendly input into the canonical extension bag. The input mapper merges
   * this into `model.extensions[ACME_EXT_KEY]` so it's available to `validate()` and `render()`.
   * Pure mapping — no validation here (that belongs in `validate`).
   */
  mapExtensions(input: unknown): Record<string, unknown> {
    const { acmeTaxOfficeCode } = (input ?? {}) as AcmeExtensionInput;
    if (!acmeTaxOfficeCode) return {};
    const ext: AcmeExtensions = { taxOfficeCode: acmeTaxOfficeCode };
    return { [ACME_EXT_KEY]: ext };
  },
};

/** Register the ACME provider into a registry. */
export function register(registry: FormatRegistry): void {
  registry.register(acmeProvider);
}
```

Notes on the skeleton:

- **`render` reads, never computes.** `model.lines`, `model.vatBreakdown`, and `model.totals` are
  already final. Touching the arithmetic here is the one way to break the XML↔PDF invariant.
- **`validate` returns, never throws.** Errors block the invoice with a clear message; warnings
  (like a missing IBAN on a SEPA transfer) inform without blocking.
- **`mapExtensions` is pure mapping.** It returns a `Record<string, unknown>` that the mapper folds
  into `model.extensions`. Namespacing under a single key (`acme`) keeps country bags from
  colliding. Do your validation in `validate()`, reading back from `model.extensions`.
- **`bundleable: true` is honest** here because the provider is pure JS. A Facturae provider that
  shells out to a Java XAdES signer would set `bundleable: false` and `requires: ['java']`.

## Composing it in the server

The server wires providers together explicitly — **no import side-effects**, so the bundler can't
tree-shake a registration away. Add one import and one call in
[`packages/server/src/registry.ts`](../packages/server/src/registry.ts):

```ts
import { FormatRegistry } from '@invoice-iob/core';
import { register as registerUblCii } from '@invoice-iob/format-ubl-cii';
import { register as registerXRechnung } from '@invoice-iob/format-xrechnung';
import { register as registerAcme } from '@invoice-iob/format-acme'; // ← add

export function buildRegistry(): FormatRegistry {
  const registry = new FormatRegistry();
  registerXRechnung(registry); // DE launch formats first
  registerUblCii(registry); // generic EU formats
  registerAcme(registry); // ← AC national format
  return registry;
}
```

Then add `@invoice-iob/format-acme` as a `workspace:*` dependency of `@invoice-iob/server` so the
import resolves. That's the whole integration: `list_formats` now enumerates `acme-xml`, and
`create_invoice` resolves `"acme-xml"`, `"acme"`, or `"ac-national"` (case-insensitive) to your
provider.

## Worked example: a country provider (the French `factur-x-fr`)

`format-acme` above is an XML-only toy. The French [`format-facturx-fr`](../packages/format-facturx-fr/src/index.ts)
is the real thing — a hybrid Factur-X provider that proves the thesis end-to-end (France was added
with **zero forks** of the core pipeline). A few patterns it establishes, worth reusing:

- **Carry national identifiers through the generic typed fields, not the extension bag.** Anything
  that has an EN 16931 home must live on the canonical model so the serializer can emit it — the
  opaque `extensions` bag never reaches the XML. France puts the **SIREN** on
  `Party.legalRegistrationId` (BT-30/47, scheme `0002`) and the **SIRET** on the generic
  `Party.identifiers` array (BT-29/46, scheme `0009`); the engine adapter emits both as
  `cac:PartyIdentification` / `cac:PartyLegalEntity`. Adding a _generic_ model field + serializer
  branch (the one core change France needed) beats hard-coding a country special-case in the engine.
  **EN 16931 cardinality:** the seller identifier is repeatable (array), the buyer is 0..1 (single
  object) — the engine schema enforces it, so honour it per side.
- **Reserve `extensions` + `mapExtensions` for fields with no EN 16931 home.** France uses them for
  the visible-document legals (legal form, share capital, RCS city, nature de l'opération) that drive
  the PDF mentions but aren't business terms. The server calls `mapExtensions(input)` and merges the
  result into `model.extensions` before `validate()`/`render()`.
- **A hybrid/PDF provider can't be unit-tested by importing its `index.ts`** — that transitively
  pulls the renderer's embedded `.ttf`, which `node --test` can't load. Factor the pure logic
  (checksums, rules, profile resolution, metadata) into a sibling module (e.g. `rules.ts`) and test
  that; keep `index.ts` as the thin renderer/engine composition. See
  [`format-facturx-fr/src/rules.ts`](../packages/format-facturx-fr/src/rules.ts).
- **Localize in the renderer, not the provider.** Add your locale to
  [`pdf-renderer/src/theme.ts`](../packages/pdf-renderer/src/theme.ts) (`LABELS`, `UNIT_LABELS`,
  `Intl` tag, date format). Watch the `Intl` output: French groups thousands with U+202F, outside the
  embedded font — the renderer normalizes it. Pass mandatory fine print via `RenderPdfOptions.legalNotes`.

### The CI cross-product: every example must validate against every provider

`gen-fixtures.mjs` crosses **every `examples/*.json` with every format path**, and a `create_invoice`
error (a failing `validate()`) fails fixture generation. So a national provider's **presence** rules
(e.g. "a French seller must have a SIREN/SIRET") must be **gated on the seller country** — otherwise
the German example invoices fail your provider's `validate()` and turn CI red. Format checks (a
checksum on an identifier that _is_ present) can apply unconditionally. `factur-x-fr` does exactly
this: `frIssues()` requires SIREN/SIRET only when `seller.country === 'FR'`, but Luhn-checks any
SIREN/SIRET it finds. Make your country example "universal" too (carry `buyerReference` + seller
contact) so it survives the other providers' gates (e.g. XRechnung's BR-DE rules).

## Checklist before you open a PR

- [ ] `meta.id` is stable, kebab-case, and unique; aliases don't collide with existing formats.
- [ ] `bundleable` is honest; `requires` lists any native runtime for non-bundleable providers.
- [ ] `validate()` starts from `baseEn16931Issues(model)`, adds national rules, never throws.
- [ ] `render()` reads the canonical model and **recomputes no amounts**.
- [ ] If you touch the Factur-X path: `options.pdf` only; never `spreadsheet`/`libreOfficePath`;
      guard + test it.
- [ ] National conformance is gated in **CI** (KoSIT/veraPDF/Mustang), parsing reports, not exit
      codes. Add a row to [`scripts/lib/matrix.mjs`](../scripts/lib/matrix.mjs) keyed by `meta.id`
      (the drift guard fails CI otherwise).
- [ ] National **presence** rules are gated on country (so the CI cross-product — every example ×
      every provider — stays green); format/checksum rules may apply unconditionally.
- [ ] National identifiers ride the canonical model's typed fields (so they reach the XML), not the
      `extensions` bag; respect the seller-array / buyer-single identifier cardinality.
- [ ] For a hybrid/PDF provider, the unit-tested logic lives in a renderer-free module (importing the
      provider pulls the renderer's `.ttf`, which `node --test` can't load).
- [ ] Provider registered in `packages/server/src/registry.ts`; package added as a `workspace:*`
      dep of the server.
- [ ] `pnpm run typecheck`, `pnpm test`, and `pnpm run smoke` all pass.

See [`SUPPORT_MATRIX.md`](SUPPORT_MATRIX.md) for the living list of shipped and planned formats.
