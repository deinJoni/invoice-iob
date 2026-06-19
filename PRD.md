# PRD — `invoice-iob`: an extensible, local-first e-invoicing MCP

**Status:** Draft for review · founding document
**Owner:** knupi
**Type:** Greenfield · **Open Source**
**Audience:** non-technical SMEs (DACH first, EU next) and their advisors; OSS contributors

---

## 1. Vision

`invoice-iob` is a **fully local, open-source** Model Context Protocol (MCP) server that turns
simple invoice details into compliant e-invoices. It launches with **EN 16931** output for the
German/EU market — **XML** (XRechnung/UBL/CII), a **human-readable PDF**, and a
**ZUGFeRD/Factur-X hybrid PDF/A-3** — and is architected so that **new countries and formats
(FatturaPA, Facturae, KSeF, Peppol BIS, …) are added as plugins, not forks.** Everything runs
on the user's own machine; **no invoice data ever leaves the computer**. It ships as a one-click
`.mcpb` for Claude Desktop — no config files, no runtimes to install.

Two audiences shape every decision: the **end user** (types _"make me an invoice"_ and gets a
valid file) and the **contributor** (adds a country by implementing one interface, not by
patching the core).

---

## 2. Goals / Non-goals

**Goals**

- Generate EN 16931 **XML**, a **visual PDF**, and **ZUGFeRD/Factur-X** — fully locally.
- Ship as a **one-click, self-contained `.mcpb`** (Node-only; no native runtimes bundled).
- **Extensible by design:** adding a new country/format is a self-contained plugin against a
  stable interface, with no changes to the core pipeline.
- **Open source from day one:** clear license, contribution path, and a documented recipe for
  adding formats.
- Keep visual document and XML derived from a **single source of truth** so they never disagree.

**Non-goals (for now)**

- Peppol/network transmission, real-time/CTC reporting — out of scope (not needed for the DE
  model; may arrive later as optional providers).
- Spanish **VeriFactu** software compliance — a separate workstream; do not conflate.
- Email delivery, GoBD-grade archival, accounting integrations, multi-tenant SaaS.

---

## 3. Compliance context (brief)

- **Germany (launch market):** decentralised post-audit model — no clearance, no tax-authority
  reporting. Receiving e-invoices is already required; issuing becomes mandatory in 2027–2028.
  **Both pure XRechnung XML and ZUGFeRD/Factur-X hybrid are accepted.**
- Engineering takeaway: generate XRechnung/UBL/CII and/or ZUGFeRD, save locally — that fully
  covers the German mandate. No transmission/signature/reporting layer is required _for DE_.
  Other countries (e.g. ES/IT signatures, PL clearance) bring their own requirements, handled
  per-provider (§7).

---

## 4. Users & scenarios

- **End user:** _"Create a ZUGFeRD invoice for 20 h consulting at €150/h for Globex DE GmbH."_
  → hybrid PDF/A-3 saved locally.
- **End user:** _"Give me the XRechnung XML."_ → standalone XML for a B2G portal.
- **Contributor:** _"Add Italian FatturaPA."_ → implements a `FormatProvider`, supplies
  fixtures + validator wiring, opens a PR; the format then shows up in `list_formats`.

---

## 5. Scope — formats

`create_invoice` selects output via a `format` option. **Formats are registry-driven** (§6.1),
so this table is the _launch set_, not a fixed ceiling:

| Value                  | Output                          | Embedded XML | Bundleable |
| ---------------------- | ------------------------------- | ------------ | ---------- |
| `XRECHNUNG-UBL`        | XML                             | n/a          | ✅         |
| `XRECHNUNG-CII`        | XML                             | n/a          | ✅         |
| `UBL` / `CII`          | XML (generic EN 16931, EU-wide) | n/a          | ✅         |
| `PDF`                  | Visual PDF only                 | No           | ✅         |
| `ZUGFERD` / `FACTUR-X` | Hybrid PDF/A-3                  | Yes (CII)    | ✅         |

- Hybrid output takes a **profile** sub-option, default **EN 16931 (Comfort)**. `MINIMUM` /
  `BASIC-WL` are **not** accepted as standalone compliant e-invoices — not offered as a default.
  _(Confirm against current BMF profile guidance before launch.)_
- See §9.4 for the **living support matrix** (planned countries/formats).

---

## 6. Functional requirements

### 6.1 Tool surface

- **`create_invoice`** — build an invoice in the chosen `format`/`profile` from simple fields
  and save it locally; compute VAT subtotals and totals automatically.
- **`list_formats`** — enumerate the formats **available in the current build** (reads the
  registry; filters by availability), with country, output kind, and profiles.
- **`validate_invoice`** _(later, optional)_ — validate an existing file where a JS validator
  exists (subject to bundling constraints; §10).

### 6.2 Input (friendly fields, extensible)

Core fields: seller, buyer, invoice number, issue date, optional due date, currency, buyer
reference / Leitweg-ID, line items (description, qty, unit price, unit code, VAT rate), optional
payment (IBAN/BIC), optional note, `format`, `profile`. The input schema carries a **typed core
plus an open extension area** so country-specific fields (e.g. Italian SdI codes, Spanish
Facturae specifics) can be added by a provider without breaking the core schema.

### 6.3 Visual document content (DE launch: Pflichtangaben, §14 UStG)

The visual PDF MUST render: supplier + recipient name/address; supplier **USt-IdNr** (or
Steuernummer); invoice number + issue date; time of supply (Lieferdatum) or period; line items;
**VAT breakdown by rate** plus exemption note where applicable; totals (net, VAT, gross/payable);
payment terms + bank details when provided; buyer reference where present. Mandatory-field sets
are **per-country/locale** (driven by the active provider + template), not hard-coded to DE.

### 6.4 Consistency

For hybrid output, page values and embedded-XML values MUST be identical — both derived from
the **same canonical invoice object** (§7.1). Renderers must not recompute amounts.

### 6.5 File output & configuration

- Save to a user-chosen output folder (set once at install; default `~/Documents/E-Invoices`).
  Filename `<invoiceNumber>-<format>.{xml|pdf}`.
- Hybrid output: the single PDF is the deliverable (XML embedded); optionally also emit
  standalone `.xml` on request.
- Invalid input returns a clear tool error, never a malformed file.

---

## 7. Extensibility architecture (the core design)

The pipeline is split into pluggable layers so **a new country = a new provider**, with the
core untouched.

```
friendly input ─▶ Input Mapper ─▶ Canonical Invoice Model ─▶ Format Provider ─▶ artifact
                  (core + per-       (semantic, EN16931-       (validate + render,   (xml/pdf/
                   country ext)       based, + ext bag)         via an engine)        hybrid)
                                            ▲
                                   Format Registry  ◀── providers register here; list_formats reads it
```

### 7.1 Canonical invoice model (single source of truth)

A **normalized, semantic** invoice representation, based on the **EN 16931 business-term model
(BT-/BG-)** as the backbone (most national formats are CIUS of, or mappable to, EN 16931). It
holds typed core fields **plus a country-extension area** for fields outside EN 16931. Every
input maps **into** it; every output renders **from** it. This decouples input, validation, and
output, and is what guarantees XML↔PDF consistency.

### 7.2 Format provider interface (the extension point)

Each output format is a **`FormatProvider`** declaring:

- **Metadata:** `id` (e.g. `xrechnung-ubl`, `zugferd`, `fatturapa`), `country` (ISO),
  `standard` (EN 16931 / national), `syntax` (UBL / CII / national-XML / PDF / hybrid),
  available `profiles`, `outputKind` (xml / pdf / hybrid), **`bundleable`** (pure-JS vs needs a
  runtime), and any `requires` (optional native deps).
- **`validate(model, profile)`** — country/CIUS business rules (e.g. German `BR-DE-*`,
  mandatory Leitweg-ID; Italian SdI rules; Spanish Facturae rules).
- **`render(model, options)`** — produce `{ bytes, mimeType, extension }`.
- Optionally **`mapExtensions(input)`** — fold country-specific input into the model's
  extension area.

### 7.3 Format registry

Providers self-register; `create_invoice` resolves `format` → provider; `list_formats`
enumerates the registry. A build includes a **curated set** of providers; the registry also
advertises **availability** so the tool can tell a user _"this format needs the optional X
add-on"_ instead of failing opaquely.

### 7.4 Engine abstraction (no single-engine lock-in)

`@e-invoice-eu/core` is the **first** engine adapter — it covers UBL/CII/XRechnung/Factur-X (and
the PDF/A-3 assembly). Other formats need other engines/libraries (FatturaPA, Facturae, KSeF),
so the core **must not assume one engine**. A provider brings its own engine adapter behind the
interface.

- **Hard constraint:** the default `.mcpb` stays **Node-only and one-click**. Pure-JS providers
  are bundleable. Providers that need a **JVM, Go runtime, or external binary** (e.g. some
  national engines, signature toolchains) are **opt-in / separately distributed** and excluded
  from the default bundle. The registry marks them `bundleable: false`.

### 7.5 Templates (visual output)

The visual-PDF renderer is **template-driven**, with per-country/locale templates carrying the
correct mandatory-field set and labels (DE/EN at launch). A new country can supply a template
without touching others.

### 7.6 Distribution as packages (OSS-friendly)

Target a **monorepo with a core package + per-format packages** (`core`, `format-xrechnung`,
`format-zugferd`, …). The default bundle composes a curated set; third parties can later publish
`invoice-iob-format-*` packages against the public `FormatProvider` interface. (Decision: start
monorepo-internal with a stable public interface; open external plugins once the interface
settles — §11.)

---

## 8. Technical guidelines (runtime & build)

### 8.1 Local-first, Node-only

- A **stdio MCP server** on the user's machine. stdout is the JSON-RPC channel — **all logging
  to stderr only**, or the protocol corrupts.
- The shipped `.mcpb` must be **self-contained and Node-only** (no LibreOffice/Ghostscript/JVM/
  Chromium). Every _launch-set_ format must be reachable without a native runtime.

### 8.2 Build & packaging

- TypeScript source; **build with esbuild**, not `tsc`.
  - Rationale (established in prototyping): `tsc` hangs resolving the Zod + MCP-SDK `.d.ts`
    graph; esbuild bundles the server + deps into a **single self-contained file in under a
    second** — exactly what an `.mcpb` wants (no `node_modules` shipped).
- Package with the **`mcpb` CLI**; manifest **v0.2** (CLI accepts ≤ 0.3, defaults to 0.2).
  Server type `node`; a **`directory` user-config** captures the output folder at install;
  recommend **signing** the bundle for a finance tool.

### 8.3 PDF generation strategy

```
canonical model ─┬─▶ visual PDF (pure JS)
                 └─▶ EN 16931 XML (engine) ──▶ engine.generate(format=Factur-X, pdf=<our PDF>) ─▶ ZUGFeRD/Factur-X PDF/A-3
```

- **We render the visual PDF ourselves in pure JS.** The engine's spreadsheet→PDF path needs
  **LibreOffice** (disqualified §8.1); its **supply-a-PDF path does not** — we hand it a finished
  PDF and it embeds the XML + produces PDF/A-3. Node-only.
- **We own** the visual PDF; **the engine owns** XML, the PDF/A-3 wrapper, XML embedding, and
  Factur-X XMP.

### 8.4 PDF library, fonts, PDF/A-3

- **Recommended lib:** `@cantoo/pdf-lib` (already an engine dep; PDF/A + attachments; bundles
  cleanly). Custom-font embedding via `@pdf-lib/fontkit`. Reject Chromium/puppeteer; avoid
  pdfkit's runtime font-metric files.
- **Fonts:** PDF/A forbids the standard-14 fonts — **embed a real font** (our source PDF must
  carry it), covering **ä ö ü ß and €**. Use a **subset** of a permissive (SIL OFL) face;
  vendor the licence.
- **PDF/A-3 target level 3b** (visual reproduction; A/U out of scope). Needs OutputIntent + ICC
  (sRGB), XMP (PDF/A part 3 + Factur-X extension schema), the XML embedded as an **Associated
  File** with the Factur-X relationship, all fonts embedded, no encryption, device-independent
  colour. The engine adds OutputIntent/XMP/AF given `format=Factur-X` + a source PDF; **our job
  is a PDF/A-amenable source PDF** so the conversion is conformant.

---

## 9. Open source

### 9.1 License

Pick a permissive, contributor- and corporate-friendly license. **Recommended: Apache-2.0**
(patent grant; matches GOBL/Mustang-style tooling) or **MIT** (simplest). Must stay compatible
with bundled deps (engine WTFPL, SDK/pdf-lib MIT, fonts OFL — all permissive, no copyleft
conflict). **Decision for owner (§11).**

### 9.2 Contribution model & repo hygiene

- `README`, `LICENSE`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, issue/PR templates, semantic
  versioning, changelog, CI badges, `CODEOWNERS`.
- A docs area documenting the **canonical model**, the **`FormatProvider` interface**, and the
  **support matrix**.

### 9.3 "Add a new country/format" recipe (the headline contributor flow)

1. Implement a **`FormatProvider`** (metadata + `validate` + `render`), choosing a **pure-JS**
   engine/lib where possible; mark `bundleable` honestly.
2. Fold any country-specific input into the canonical model's **extension area**
   (`mapExtensions`).
3. Add a **per-locale visual template** if PDF output is wanted.
4. Add **conformance fixtures** (sample invoices) and wire the relevant **official validator**
   into CI (e.g. KoSIT for XRechnung, veraPDF + ZUGFeRD validator for hybrids, SdI checks for
   FatturaPA).
5. **Register** the provider; it appears in `list_formats`.
6. Update the **support matrix** + docs; add a `CODEOWNERS` entry.

**Quality bar for a new format (merge gate):** passes its official validator in CI where one
exists; ships fixtures + docs; declares bundleability; does **not** pull native deps into the
default bundle unless marked optional.

### 9.4 Support matrix (living)

| Country | Format              | Standard       | Output         | Status                      | Bundleable            |
| ------- | ------------------- | -------------- | -------------- | --------------------------- | --------------------- |
| DE      | XRechnung (UBL/CII) | EN 16931 CIUS  | XML            | **Launch**                  | ✅                    |
| DE      | ZUGFeRD / Factur-X  | EN 16931       | Hybrid PDF/A-3 | **Launch (P2)**             | ✅                    |
| EU      | UBL / CII           | EN 16931       | XML            | **Launch**                  | ✅                    |
| FR      | Factur-X            | EN 16931       | Hybrid         | Near-term (engine supports) | ✅                    |
| IT      | FatturaPA           | National (SdI) | XML            | Planned                     | TBD — needs JS lib    |
| ES      | Facturae            | National       | XML (+ XAdES)  | Planned                     | ⚠ signature toolchain |
| PL      | KSeF                | National       | XML            | Planned                     | TBD                   |

> FatturaPA/Facturae/KSeF are **not** in `@e-invoice-eu/core` — they require different
> engines/libs (and ES/IT add e-signature), which is exactly why the engine abstraction (§7.4)
> and the bundleable/opt-in split exist.

---

## 10. Validation & acceptance criteria

Validators run in **CI/dev only** — they are often Java and are **never bundled**.

- **XML:** passes EN 16931 schema validation (engine) + the country validator where one exists
  (e.g. KoSIT for XRechnung); correct VAT/total math.
- **Visual PDF:** renders the active country's mandatory fields; opens in common readers;
  umlauts + € correct; printed totals equal the engine math.
- **Hybrid:** **veraPDF** passes **PDF/A-3b, zero errors**; a **ZUGFeRD/Factur-X validator**
  confirms the profile + valid embedded XML; embedded XML **byte-equals** the standalone XML for
  the same input; recognised as Factur-X by ≥ 1 independent tool.
- **Per provider:** ships fixtures + CI validation (§9.3 quality bar).
- **Packaging:** no native binaries in the default bundle; `.mcpb` installs one-click; packed
  bundle under a stated cap (**proposed < 5 MB** for the launch set).

---

## 11. Bootstrap — what the fresh repo must establish (P0)

P0 stands up the **extensible** skeleton (requirements, not code):

- **Repo & tooling:** TypeScript, Node ≥ 18, esbuild build, `mcpb` packaging, lint/format, the
  chosen OSS license, single-command `build`/`pack`, CI skeleton (install → build → pack →
  validate).
- **MCP server skeleton:** boots over stdio, registers `create_invoice` + `list_formats`,
  stderr-only logging, graceful tool errors.
- **The extension core (designed in, not later):** the **canonical invoice model**, the
  **`FormatProvider` interface**, the **format registry**, and the **input mapper** — with the
  launch providers (XRechnung-UBL/CII, UBL, CII) implemented against the interface to prove it.
- **Manifest:** `node` server, output-folder `directory` config, registry-driven tool list,
  name `invoice-iob`.
- **OSS scaffolding:** README, CONTRIBUTING (incl. the §9.3 recipe), CODE_OF_CONDUCT, templates,
  CODEOWNERS.
- **Repo layout (target, monorepo):**
  ```
  invoice-iob/
  ├── packages/
  │   ├── core/              # MCP server, canonical model, registry, mapper, build/pack
  │   │   ├── src/index.ts   # MCP server (tools, stderr logging)
  │   │   ├── src/model.ts   # canonical EN16931-based invoice model
  │   │   ├── src/registry.ts# FormatProvider interface + registry
  │   │   └── src/mapper.ts  # friendly input -> canonical model + tax math
  │   ├── format-xrechnung/  # provider (engine adapter: @e-invoice-eu/core)
  │   ├── format-zugferd/    # provider (P2; visual PDF + engine hybrid)
  │   └── format-ubl-cii/    # generic EN16931 providers
  ├── assets/                # embedded font (+ licence), ICC profile
  ├── examples/              # sample inputs + fixtures
  ├── docs/                  # this PRD, provider guide, support matrix, layout spec
  ├── .github/workflows/     # CI: build + pack + per-provider validation
  ├── LICENSE  ·  CONTRIBUTING.md  ·  CODE_OF_CONDUCT.md  ·  CODEOWNERS
  └── manifest.json          # MCPB manifest (composed bundle)
  ```

> A proven XML-only generator + tested mapper already exist from prototyping; they carry forward
> as the P0/P1 baseline (refactored behind the provider interface) rather than rebuilt.

---

## 12. Phasing / milestones

| Phase                              | Scope                                                                                                                                                      | Exit gate                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **P0 — Extensible core + XML MVP** | Repo, build/pack, MCP skeleton, **canonical model + provider interface + registry**, XML providers (XRechnung/UBL/CII), one-click `.mcpb`, OSS scaffolding | XML passes EN 16931 (+ KoSIT) validation; one-click install; a 2nd provider proves the interface |
| **P1 — Visual PDF**                | `PDF` provider: compliant layout, embedded font, mandatory fields, totals from canonical model                                                             | Visual acceptance + totals match XML                                                             |
| **P2 — ZUGFeRD/Factur-X**          | Hybrid provider (default EN16931 profile) feeding the P1 PDF into the engine                                                                               | **veraPDF 3b + ZUGFeRD validator pass + XML consistency**                                        |
| **P3 — Open up & grow**            | Public docs site, external-plugin guide, first additional country (e.g. FR), bundle signing, marketplace listing, optional `validate_invoice`              | Stable public `FormatProvider` interface; ≥ 1 extra country green in CI                          |

---

## 13. Risks & mitigations

- **Over-abstracting too early.** → Keep the interface minimal; prove it with ≥ 2 providers in
  P0 before freezing it; expand only on real second-country pressure.
- **Engine-per-country runtime constraints.** Some national engines need a JVM/Go/binary →
  can't be one-click-bundled. → Bundleable/opt-in split (§7.4); core stays lean; heavy providers
  ship separately.
- **PDF/A-3 conformance is fiddly; engine PDF path is flagged "not battle-tested."** → Hard
  validation gate (§10); own source-PDF quality. **De-risk first (one-day spike before P2):**
  render a minimal PDF → `generate(format=Factur-X, pdf=…)` → run veraPDF + a ZUGFeRD validator.
  **Fallback:** assemble PDF/A-3 ourselves with `@cantoo/pdf-lib` (contingency).
- **Build hang (known):** `tsc` chokes on the Zod/SDK type graph → esbuild (§8.2).
- **Conformance drift across many formats / contributor variance.** → Per-provider CI validation
  - fixtures as a merge gate (§9.3); CODEOWNERS per format.
- **Font licence / coverage** → permissive (OFL) subset, vendored licence.
- **Bundle-size creep** → subset fonts, reuse the engine's pdf-lib, enforce the size cap in CI.

---

## 14. Decisions needed from owner

1. **License:** Apache-2.0 (recommended) vs MIT.
2. **Display name vs codename:** is `invoice-iob` public or internal?
3. **Plugin model:** monorepo-internal providers now with a stable public interface
   (recommended), vs open external `invoice-iob-format-*` packages immediately.
4. **PDF library:** reuse `@cantoo/pdf-lib` (recommended) vs `pdfkit`.
5. **Default hybrid profile:** `EN16931` (recommended) vs `XRECHNUNG`.
6. **Default output for DE users:** XRechnung XML default + ZUGFeRD opt-in, or ZUGFeRD default.
7. **Roadmap order for additional countries** (e.g. FR → IT → ES → PL) and **governance** (who
   reviews/merges new providers).
8. **Branding (logo/colours)** in P1 or deferred to P3 (recommended: defer).
9. **Font choice + licence.**

---

## 15. Dependencies & bundle impact (estimate)

- **Runtime (bundled by esbuild):** `@modelcontextprotocol/sdk`, `zod`, `@e-invoice-eu/core`
  (pulls `@cantoo/pdf-lib`), `@pdf-lib/fontkit`, one subset font + an ICC profile.
- **Per-provider:** each pure-JS provider adds its own small lib; native-engine providers are
  **optional / separately distributed**, never in the default bundle.
- **Dev/CI only (not shipped):** `esbuild`, `mcpb` CLI, Java validators (veraPDF, KoSIT,
  Mustang).
- **No native/runtime dependencies in the default bundle.** Expected packed `.mcpb`: low
  single-digit MB for the launch set.
