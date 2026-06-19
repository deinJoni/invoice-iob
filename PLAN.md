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

| # | Decision | Choice | Note |
|---|---|---|---|
| 1 | License | **Apache-2.0** | `LICENSE` written. Engine is WTFPL (permissive, not OSI) → list in NOTICE. |
| 2 | Display name vs codename | **`invoice-iob` is public** | npm scope `@invoice-iob/*`; repo `deinJoni/invoice-iob`. |
| 3 | Plugin model | **Monorepo-internal, stable public interface** | Open external `invoice-iob-format-*` after interface settles (P3). |
| 4 | PDF library | **`@cantoo/pdf-lib`** | Same lib+version core uses → single `PDFDocument` identity. |
| 5 | Default hybrid profile | **`Factur-X-EN16931`** (Comfort) | MINIMUM/BASIC-WL not offered as standalone-compliant. |
| 6 | Default DE output | **XRechnung XML default; ZUGFeRD opt-in** | `format` is explicit per call; no implicit default file. |
| 7 | Roadmap order | **FR → IT → ES → PL** | FR is near-term (engine supports Factur-X already). |
| 8 | Branding | **Deferred to P3** | Plain, correct layout for P1. |
| 9 | Font | **IBM Plex Sans (OFL-1.1), Regular+Bold** | Full DE umlauts/ß/€; ship full TTF, subset at render. |

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

| package | role | key deps | phase |
|---|---|---|---|
| `@invoice-iob/core` | canonical model, `FormatProvider` iface, registry, input mapper, tax math, errors | `zod` | P0 |
| `@invoice-iob/engine-e-invoice-eu` | engine adapter: canonical→UBL-JSON serializer + `generate()` wrappers + LibreOffice guard | `core`, `@e-invoice-eu/core` | P0 |
| `@invoice-iob/format-ubl-cii` | providers: `UBL`, `CII` (generic EN16931) | `core`, engine adapter | P0 |
| `@invoice-iob/format-xrechnung` | providers: `XRECHNUNG-UBL`, `XRECHNUNG-CII` + BR-DE + Leitweg-ID | `core`, engine adapter | P0 |
| `@invoice-iob/server` | MCP stdio server (`create_invoice`, `list_formats`); **bundle entrypoint** | `core`, format pkgs, SDK, `zod` | P0 |
| `@invoice-iob/pdf-renderer` | visual PDF via `@cantoo/pdf-lib` + fontkit; template-driven | `core`, pdf-lib, fontkit | P1 |
| `@invoice-iob/format-pdf` | provider: `PDF` (visual only) | `core`, pdf-renderer | P1 |
| `@invoice-iob/format-zugferd` | provider: `ZUGFERD`/`FACTUR-X` hybrid (visual PDF → engine Factur-X) | `core`, pdf-renderer, engine adapter | P2 |

## 3. Phasing & task checklist

### P0 — Extensible core + XML MVP  ← **CURRENT (≈95% — only the live KoSIT CI run, which needs a push, remains)**
**Exit gate:** XML passes EN 16931 (+ KoSIT) validation; one-click `.mcpb` installs; a 2nd provider proves the interface.

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

### P1 — Visual PDF
**Exit gate:** visual acceptance + totals match XML.
- [ ] `pdf-renderer` (template-driven, DE/EN; §14 UStG Pflichtangaben); embed IBM Plex Sans subset; PDF/A-amenable source PDF
- [ ] `format-pdf` provider; totals/VAT pulled from canonical model (no recompute)

### P2 — ZUGFeRD/Factur-X
**Exit gate:** veraPDF 3b zero errors + ZUGFeRD/Mustang validator pass + embedded XML byte-equals standalone Factur-X CII.
- [ ] **De-risk spike first** (PRD §13): minimal PDF → `generate(format=Factur-X, pdf=…)` → veraPDF + Mustang
- [ ] `format-zugferd` provider (default `Factur-X-EN16931`)
- [ ] CI: veraPDF `-f 3b` + Mustang `--action validate` on fixtures

### P3 — Open up & grow
- [ ] Public docs site, external-plugin guide, FR provider, bundle signing (real cert), marketplace listing, optional `validate_invoice`

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

- **2026-06-19 (1)** — Read PRD; ran parallel stack-research workflow (7 dims) → `docs/STACK.md` + `docs/research/*.md`. 16 PRD corrections captured (zod v4, mcpb rename, engine 3.1.1/WTFPL, UBL-JSON input, don't-ship-ICC, runtime font subset, KoSIT report-parsing, XRechnung 3.0.2, …). Scaffolded repo (git, license, dir tree).
- **2026-06-19 (3)** — OSS scaffolding + CI landed (workflow-generated, accuracy-reviewed, fixes applied): CONTRIBUTING/CoC/CODEOWNERS/issue+PR templates, ARCHITECTURE/PROVIDER_GUIDE/SUPPORT_MATRIX/CI docs, and `ci.yml` with the KoSIT gate (`gen-fixtures.mjs` + `kosit-check.mjs`, VARL-report parsing). Fixed reviewer punch-list (VARL element names, `list_formats` availability wording, Node `>=20`, gitignore `.claude/`); wrote CoC by-reference (Contributor Covenant subagent was content-filter-blocked). 9 unit tests green incl. LibreOffice guard. Note: KoSIT Java gate runs only in GitHub CI (not pushed yet). **P0 ~95%.**
- **2026-06-19 (2)** — **P0 XML MVP working end-to-end.** Built all 5 packages (core, engine adapter, 2 format pkgs, server). Read engine `.d.ts` → wrote canonical→UBL-JSON serializer against the real shape. Bundled with esbuild (2.81 MB single ESM). Smoke test over a real MCP stdio handshake passes: `list_formats` + `create_invoice` for XRECHNUNG-CII/UBL, UBL, CII with correct VAT math (3089.90+587.08=3676.98), XRechnung 3.0 URN present, BR-DE-15 enforced. 5 unit tests green, typecheck clean. `.mcpb` packs to 877 KB and validates. Caught + fixed: engine logger must go to stderr; param-properties break Node type-stripping (→ `erasableSyntaxOnly`); single shared zod 4.4.3 (no dual-instance). Remaining P0: OSS docs + KoSIT CI gate.

## 6. Open questions for owner (non-blocking; proceeding with defaults)

1. Confirm Apache-2.0 (vs MIT) — manifest currently set Apache-2.0.
2. `CODE_OF_CONDUCT` enforcement contact email — placeholder for now.
3. npm publish under `@invoice-iob/*` scope — reserve the org?
4. Real code-signing cert for `.mcpb` (needed before public release; self-signed for nightlies).
