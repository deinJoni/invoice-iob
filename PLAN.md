# invoice-iob — Build Plan & Progress Tracker

> Living document maintained across the autonomous build loop. Updated every iteration.
> Source of truth for **what's decided, what's done, what's next**. Architecture detail lives in
> [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); stack decisions in [`docs/STACK.md`](docs/STACK.md);
> the product spec in [`PRD.md`](PRD.md).

## 0. North star

A fully local, open-source MCP server that turns simple invoice fields into **EN 16931**-compliant
e-invoices — XRechnung/UBL/CII **XML**, a visual **PDF**, and a **ZUGFeRD/Factur-X PDF/A-3** —
shipping as a one-click Node-only `.mcpb` for Claude Desktop and installable into Claude Code,
Cursor, VS Code, and any MCP client. **New countries/formats are plugins, not forks.**

## 1. Owner decisions (PRD §14) — answered with PRD recommendations unless noted

| #   | Decision                 | Choice                                         | Note                                                                       |
| --- | ------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | License                  | **Apache-2.0**                                 | `LICENSE` written. Engine is WTFPL (permissive, not OSI) → list in NOTICE. |
| 2   | Display name vs codename | **`invoice-iob` is public**                    | npm scope `@invoice-iob/*`; repo `deinJoni/invoice-iob`.                   |
| 3   | Plugin model             | **Monorepo-internal, stable public interface** | Open external `invoice-iob-format-*` after interface settles (P3).         |
| 4   | PDF library              | **`@cantoo/pdf-lib`**                          | Same lib+version core uses → single `PDFDocument` identity.                |
| 5   | Default hybrid profile   | **`Factur-X-EN16931`** (Comfort)               | MINIMUM/BASIC-WL not offered as standalone-compliant.                      |
| 6   | Default DE output        | **XRechnung XML default; ZUGFeRD opt-in**      | `format` is explicit per call; no implicit default file.                   |
| 7   | Roadmap order            | **FR → IT → ES → PL**                          | FR is near-term (engine supports Factur-X already).                        |
| 8   | Branding                 | **Deferred to P3**                             | Plain, correct layout for P1.                                              |
| 9   | Font                     | **IBM Plex Sans (OFL-1.1), Regular+Bold**      | Full DE umlauts/ß/€; ship full TTF, subset at render.                      |

> These are my working defaults so the loop stays autonomous. Owner can override any; I'll re-plan.

## 2. Architecture (summary)

```
friendly input ─▶ Input Mapper ─▶ Canonical Invoice Model ─▶ FormatProvider.render ─▶ artifact
   (zod, core)     (+ tax math)     (EN16931 BT/BG + ext bag)   (validate + engine/pdf)   (xml/pdf/hybrid)
                                          ▲
                                   Format Registry  ◀── providers self-register; list_formats reads it
```

**Packages** (deviation from PRD layout: `core` stays engine-free per §7.4; a dedicated engine
adapter package centralizes the canonical→UBL-JSON serializer; the MCP server is its own package
so future non-MCP adapters can reuse `core`):

| package                            | role                                                                                      | key deps                             | phase |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ | ----- |
| `@invoice-iob/core`                | canonical model, `FormatProvider` iface, registry, input mapper, tax math, errors         | `zod`                                | P0    |
| `@invoice-iob/engine-e-invoice-eu` | engine adapter: canonical→UBL-JSON serializer + `generate()` wrappers + LibreOffice guard | `core`, `@e-invoice-eu/core`         | P0    |
| `@invoice-iob/format-ubl-cii`      | providers: `UBL`, `CII` (generic EN16931)                                                 | `core`, engine adapter               | P0    |
| `@invoice-iob/format-xrechnung`    | providers: `XRECHNUNG-UBL`, `XRECHNUNG-CII` + BR-DE + Leitweg-ID                          | `core`, engine adapter               | P0    |
| `@invoice-iob/server`              | MCP stdio server (`create_invoice`, `list_formats`); **bundle entrypoint**                | `core`, format pkgs, SDK, `zod`      | P0    |
| `@invoice-iob/pdf-renderer`        | visual PDF via `@cantoo/pdf-lib` + fontkit; template-driven                               | `core`, pdf-lib, fontkit             | P1    |
| `@invoice-iob/format-pdf`          | provider: `PDF` (visual only)                                                             | `core`, pdf-renderer                 | P1    |
| `@invoice-iob/format-zugferd`      | provider: `ZUGFERD`/`FACTUR-X` hybrid (visual PDF → engine Factur-X)                      | `core`, pdf-renderer, engine adapter | P2    |

## 3. Phasing & task checklist

### P0 — Extensible core + XML MVP ✅ **DONE — exit gate MET**

**Exit gate:** XML passes EN 16931 (+ KoSIT) validation ✅ (**KoSIT job green in CI**); one-click `.mcpb` installs ✅; a 2nd provider proves the interface ✅ (4 providers / 2 pkgs).

- [x] Recon env (Node 24, pnpm, git), research stack → `docs/STACK.md` + `docs/research/*`
- [x] Repo: git, dir tree, `LICENSE` (Apache-2.0), `.gitignore`, `.editorconfig`, `.nvmrc`
- [x] Origin remote `git@github.com:deinJoni/invoice-iob.git`
- [x] Root workspace config: `package.json`, `pnpm-workspace.yaml`, `tsconfig.{base,}.json`, `.npmrc`, `scripts/build.mjs`
- [x] `core`: canonical model + types + `FormatProvider` iface + registry + friendly input schema (zod v4) + input mapper + cents-based tax engine + errors + base EN16931 checks
- [x] `pnpm install`; read engine `invoice.interface.d.ts` (flat `@attr` siblings; all amounts strings)
- [x] `engine-e-invoice-eu`: canonical→UBL-JSON serializer (real `.d.ts`) + `generateXml`/`generateFacturX` wrappers + LibreOffice guard + stderr logger
- [x] `format-ubl-cii` (UBL, CII) + `format-xrechnung` (XRECHNUNG-UBL/CII + BR-DE) providers — **4 providers, 2 packages → interface proven**
- [x] `server`: MCP stdio server; `create_invoice` + `list_formats`; stderr-only; file output `<invoiceNumber>-<format>.xml`; structured output
- [x] esbuild bundle → single 2.81 MB `.mjs`; **smoke test PASSES** (real stdio handshake, all 4 formats, correct VAT, BR-DE-15 enforced)
- [x] 5 tax-engine unit tests pass; typecheck clean (`erasableSyntaxOnly`)
- [x] `manifest.json` (v0.3, node, directory user_config) validates; `mcpb pack` → **877 KB `.mcpb`** (≪ 5 MB cap)
- [x] Example input `examples/invoice-consulting.json`
- [x] OSS scaffolding: README, CONTRIBUTING (incl. §9.3 recipe), CODE_OF_CONDUCT, CODEOWNERS, issue/PR templates, `docs/ARCHITECTURE.md`, `docs/PROVIDER_GUIDE.md`, `docs/SUPPORT_MATRIX.md`, `docs/CI.md` — generated via workflow + accuracy-reviewed + fixes applied
- [x] CI (`.github/workflows/ci.yml`): install → typecheck → test → build → pack → smoke; **KoSIT validate** job (`scripts/gen-fixtures.mjs` + `scripts/kosit-check.mjs` parse the VARL `<rep:accept>` + 0 `<rep:message level="error">`). Fixtures verified locally. ⚠️ **The KoSIT Java job only runs once pushed to GitHub — not pushed yet, so the EN16931/KoSIT exit-gate is "pending live CI".**
- [x] Unit test for `assertNoLibreOffice` guard (4 tests; 9 total green)
- [ ] `.mcpbignore` + signing wiring (self-signed nightly; real cert at P3)
- [ ] **Push to GitHub to run CI** (awaiting owner go-ahead) → confirms the KoSIT exit-gate

### P1 — Visual PDF ✅ **DONE**

**Exit gate:** visual acceptance + totals match XML. — **MET** (rendered & eyeballed; totals identical to XML, both from the canonical model).

- [x] `@invoice-iob/pdf-renderer` — template-driven (DE/EN labels, Intl number/currency formatting), §14 UStG Pflichtangaben, IBM Plex Sans subset-embedded (vendored OFL TTFs), pagination + page-numbered footer, DeviceRGB/unencrypted (PDF/A-amenable source for P2)
- [x] `@invoice-iob/format-pdf` — `PDF` provider; amounts read from the canonical model (no recompute); registered in the server
- [x] Verified end-to-end: smoke test generates a valid 20 KB PDF; rasterized preview reviewed (umlauts + € correct). Bundle now 4.53 MB.
- [ ] (polish, later) expose `language` on `create_invoice` to select PDF locale; richer VAT-breakdown table; logo/branding (P3)

### P2 — ZUGFeRD/Factur-X ✅ **DONE — exit gate MET**

**Exit gate:** veraPDF 3b + ZUGFeRD/Mustang validator pass — **MET** (`pdfa-hybrid` job green in CI; Mustang `--action validate` runs veraPDF for PDF/A-3b + Factur-X container + embedded-XML EN 16931).

- [x] **De-risk spike (PRD §13) — WORKS.** Our visual PDF → `generateFacturX` → PDF/A-3: 28.6 KB hybrid, `factur-x.xml` embedded as `/AF`, XMP `pdfaid:part=3`/`conformance=B`, `fx:ConformanceLevel = EN 16931`. Visual layer preserved (rasterized + reviewed). The #1 flagged risk is retired.
- [x] `format-zugferd` provider (id `zugferd`, aliases `factur-x`/`facturx`; default profile EN16931; also BASIC/EXTENDED/XRECHNUNG). Registered in the server.
- [x] CI gate WIRED: `gen-fixtures` emits the hybrid; the `pdfa-hybrid` job runs Mustang `--action validate` (embeds veraPDF → PDF/A-3b + Factur-X container + embedded-XML EN 16931) via `scripts/mustang-check.mjs` (parses the report, not the exit code). Confirmed green only once CI runs **post-push**.

### P3 — Open up & grow

**FR — Factur-X France provider ✅ DONE (flagship plugin proof).** A new country added as a PLUGIN
against `FormatProvider`, with **zero forks** of the core pipeline — only additive changes + one
generic serializer improvement. Conformance proven locally (Mustang `--action validate` + embedded
veraPDF: 21/21 hybrids valid, incl. `invoice-fr × factur-x-fr` EN16931/BASIC/EXTENDED).

- [x] **Research** (3 parallel subagents, cited, verified vs 2026 reality) → [`docs/research/france.md`](docs/research/france.md): reform timeline (réception 2026-09-01 all; émission GE/ETI 2026, PME 2027), PPF/PDP model, the Factur-X/UBL/CII socle, Factur-X profiles (EN16931/Comfort = recommended default), SIREN/SIRET + EAS codes (0002/0009) + Luhn, FR mandatory mentions (CGI 242 nonies A / Code de commerce L441-9, 40 € indemnity), TVA rates + exemption→VATEX mapping, fr-FR labels/formatting, validators (Mustang sufficient).
- [x] **Smallest core change (generic, helps every country):** serializer emits `cac:PartyIdentification` (BT-29 seller array / BT-46 buyer single); SIREN via `legalRegistrationId` (0002), SIRET via new generic `Party.identifiers` (0009). Plus: wired the dormant `mapExtensions` hook in the server; exposed a `language` field on `create_invoice` (was hardcoded `de-de`) defaulting by seller country.
- [x] **Renderer `fr` locale:** `LABELS.fr` / `UNIT_LABELS.fr` / `Intl` `fr-FR` / `DD/MM/YYYY`; generic id-scheme→label map (SIREN/SIRET); `legalNotes` channel; normalized the U+202F narrow-space gotcha (accents é è à ç ô + € verified by rasterizing the PDF).
- [x] **New package `@invoice-iob/format-facturx-fr`** (`factur-x-fr` / `facturx-fr`, FR, hybrid, default EN16931): `validate()` = base EN16931 + FR rules (SIREN/SIRET Luhn incl. La Poste exception, FR TVA rates, FR VAT-number shape, mandatory mentions); `render()` = French PDF → `generateFacturX()`; `mapExtensions()` folds `extensions.fr`. Registered in the server. 13 unit tests (renderer-free `rules.ts`).
- [x] **CI:** `examples/invoice-fr.json` (mixed TVA 20 %/5,5 %, SIRET/SIREN) + `factur-x-fr` row in the validation matrix → existing `pdfa-hybrid` (Mustang+veraPDF) gate validates it; drift guard in sync (7 formats). Docs updated: SUPPORT_MATRIX (FR→Shipped), README, CODEOWNERS, PROVIDER_GUIDE (country-provider patterns + cross-product rule).
- [ ] (later) Public docs site, external-plugin guide, bundle signing (real cert), marketplace listing, optional `validate_invoice`; nightly PDP-sandbox integration test for the FR CTC/e-reporting layer (not a CI-runnable Schematron).

## 4. Key engineering constraints (from research — do not violate)

- **Engine input is UBL-syntax JSON** (`ubl:Invoice` + `cbc:`/`cac:`), NOT simple JSON. ONE tree for all formats; omit `CustomizationID`/`ProfileID` (engine fills per format).
- **LibreOffice avoidance:** for Factur-X ALWAYS pass `options.pdf`; NEVER `options.spreadsheet`/`libreOfficePath`; never use `MappingService`. Guard + test it.
- **`FileInfo.mimetype`** (lowercase t). Target **XRechnung 3.0**.
- **MCP:** `McpServer` + `registerTool` with **raw Zod shapes**; **zod v4** (`zod/v4`); **stdout is JSON-RPC — all logs to stderr**.
- **Build:** esbuild ESM, `target node22`, externalize nothing, createRequire+`__dirname` banner, assets via `loader:'binary'`. Typecheck separately: `tsc --noEmit --skipLibCheck`.
- **BR-DE-15:** `buyerReference` (BT-10) mandatory for XRechnung. B2G needs valid Leitweg-ID (implement checksum ourselves).
- **PDF/A:** engine adds OutputIntent/ICC/XMP/AF; we supply a clean source PDF (subset fonts, DeviceRGB/Gray, unencrypted, no forms/JS/metadata). **Don't ship ICC.**
- **CI gates:** KoSIT — parse VARL report (`recommendation=accept`, 0 errors), not exit code. veraPDF `-f 3b`. Byte-equality only vs standalone **Factur-X** CII (not XRechnung CII).

## 5. Progress log

- **2026-06-19 (7)** — **🇫🇷 FRANCE SHIPPED — the plugin thesis, proven.** Added France end-to-end as a
  `FormatProvider` plugin with **zero forks of the core pipeline**. Phase 1: 3 parallel research
  subagents (web, cited, verified vs 2026 reality) → `docs/research/france.md`. Key insight exploited:
  Factur-X _is_ the French national standard and is the same Franco-German standard as ZUGFeRD, which
  `@e-invoice-eu/core` already emits — so France = localization + French identifiers + French rules +
  a French template, not a new engine. The one generic core change France needed: the
  canonical→UBL-JSON serializer now emits `cac:PartyIdentification` (generic BT-29/46; helps every
  country) — SIREN via the existing legal-registration id (scheme 0002), SIRET via a new generic
  `Party.identifiers` (0009). Caught + fixed a real EN 16931 cardinality bug via the CI cross-product
  (seller identifier = array, buyer = single object). Also wired the previously-dormant `mapExtensions`
  hook and exposed a `language` field on `create_invoice` (was hardcoded `de-de`). New package
  `@invoice-iob/format-facturx-fr` (`factur-x-fr`/`facturx-fr`); `fr` renderer locale (accents + €
  - U+202F-normalized French number formatting verified by rasterization). Validation: typecheck +
    33 tests + build (4.54 MB) + smoke + drift guard all green; **Mustang `--action validate` + embedded
    veraPDF: 21/21 hybrids valid** (incl. `invoice-fr × factur-x-fr` EN16931/BASIC/EXTENDED) run locally
    with a portable JDK 21. Docs: SUPPORT_MATRIX (FR→Shipped), README, CODEOWNERS, PROVIDER_GUIDE
    (country-provider patterns + the CI cross-product rule). Not pushed (awaiting owner go-ahead).

- **2026-06-19 (6)** — **🎉 MVP COMPLETE + CI GREEN.** Pushed to GitHub (`deinJoni/invoice-iob`); all three CI jobs pass: `build-test`, `kosit` (P0 XML exit gate — XRechnung passes KoSIT), `pdfa-hybrid` (P2 exit gate — Mustang/veraPDF on the hybrid). Fixed two first-run CI issues: dev/CI must run Node 24 (native TS tests need ≥22.18); the Mustang CLI download used an invalid jq escape (→ pinned the release-asset URL). P0+P1+P2 exit gates formally MET. Remaining is P3 (open-up/grow): `validate_invoice`, `language` on the tool, FR/IT/… providers, bundle signing, marketplace listing.

- **2026-06-19 (1)** — Read PRD; ran parallel stack-research workflow (7 dims) → `docs/STACK.md` + `docs/research/*.md`. 16 PRD corrections captured (zod v4, mcpb rename, engine 3.1.1/WTFPL, UBL-JSON input, don't-ship-ICC, runtime font subset, KoSIT report-parsing, XRechnung 3.0.2, …). Scaffolded repo (git, license, dir tree).
- **2026-06-19 (5)** — **P2 de-risk spike SUCCEEDED → full MVP functionally complete.** New `format-zugferd` provider feeds our visual PDF to `@e-invoice-eu/core`'s Factur-X path. Smoke test produces a valid hybrid PDF/A-3 (factur-x.xml as `/AF`, PDF/A-3B XMP, `fx:ConformanceLevel EN 16931`); rasterized hybrid is pixel-identical to the standalone PDF. All 6 launch formats now generate from one canonical model. Remaining: live conformance gates (KoSIT for XML, veraPDF+Mustang for hybrid) which run in GitHub CI — i.e. they need a push.
- **2026-06-19 (4)** — **P1 visual PDF DONE.** New `pdf-renderer` + `format-pdf` packages. Vendored IBM Plex Sans (OFL) Regular+Bold TTFs into `assets/fonts/` (via subagent; all DE glyphs + € verified). Implemented a template-driven A4 renderer (`@cantoo/pdf-lib` + fontkit subset-embed): header/recipient/meta, USt-IdNr, line-item table with wrapping + pagination, per-rate VAT, totals, payment block, note, page-numbered footer; DE/EN labels + `Intl` number/currency formatting; codepoint sanitizer so arbitrary text can't crash `drawText`. Registered the `PDF` provider; smoke test now generates + validates a PDF; rasterized the output and visually confirmed a clean, correct German invoice. Bundle 2.81→4.53 MB (fonts).
- **2026-06-19 (3)** — OSS scaffolding + CI landed (workflow-generated, accuracy-reviewed, fixes applied): CONTRIBUTING/CoC/CODEOWNERS/issue+PR templates, ARCHITECTURE/PROVIDER_GUIDE/SUPPORT_MATRIX/CI docs, and `ci.yml` with the KoSIT gate (`gen-fixtures.mjs` + `kosit-check.mjs`, VARL-report parsing). Fixed reviewer punch-list (VARL element names, `list_formats` availability wording, Node `>=20`, gitignore `.claude/`); wrote CoC by-reference (Contributor Covenant subagent was content-filter-blocked). 9 unit tests green incl. LibreOffice guard. Note: KoSIT Java gate runs only in GitHub CI (not pushed yet). **P0 ~95%.**
- **2026-06-19 (2)** — **P0 XML MVP working end-to-end.** Built all 5 packages (core, engine adapter, 2 format pkgs, server). Read engine `.d.ts` → wrote canonical→UBL-JSON serializer against the real shape. Bundled with esbuild (2.81 MB single ESM). Smoke test over a real MCP stdio handshake passes: `list_formats` + `create_invoice` for XRECHNUNG-CII/UBL, UBL, CII with correct VAT math (3089.90+587.08=3676.98), XRechnung 3.0 URN present, BR-DE-15 enforced. 5 unit tests green, typecheck clean. `.mcpb` packs to 877 KB and validates. Caught + fixed: engine logger must go to stderr; param-properties break Node type-stripping (→ `erasableSyntaxOnly`); single shared zod 4.4.3 (no dual-instance). Remaining P0: OSS docs + KoSIT CI gate.

## 6. Open questions for owner (non-blocking; proceeding with defaults)

1. Confirm Apache-2.0 (vs MIT) — manifest currently set Apache-2.0.
2. `CODE_OF_CONDUCT` enforcement contact email — placeholder for now.
3. npm publish under `@invoice-iob/*` scope — reserve the org?
4. Real code-signing cert for `.mcpb` (needed before public release; self-signed for nightlies).
