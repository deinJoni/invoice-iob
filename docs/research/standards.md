# Research: EN 16931 standards versions + dev-only Java CI validator toolchain

**Topic:** XRechnung / ZUGFeRD-Factur-X versions + KoSIT, veraPDF, Mustang CI validators.

## Summary

As of mid-2026 the production German CIUS is **XRechnung 3.0.2** (still current; the "Winter 2025/26 bugfix" bundle took effect 2026-01-31, normative content frozen since 3.0.0). **XRechnung 4.0** (based on EN 16931-1:2026 / UBL 2.5 + CII D25A) is announced/preliminary but NOT yet mandatory — target 3.0.2 today. The hybrid standard is **ZUGFeRD 2.3.x / Factur-X 1.07.x** (latest 2.3.3 / 1.07.3, in force 2026-01-15); per the BMF letter of 2024-10-15 the MINIMUM and BASIC-WL profiles are explicitly NOT EN16931-compliant e-invoices, so the PRD's choice of EN16931 ("Comfort") as the default standalone-compliant profile is correct. The CI validator stack is all dev-only Java and must never be bundled: **KoSIT validator v1.6.2** + **validator-configuration-xrechnung release 2026-01-31** (XRechnung Schematron 2.4.0, CEN rules 1.3.15), **veraPDF 1.30** (PDF/A-3b via `-f 3b`), and **Mustang 2.24.0** for the ZUGFeRD profile + embedded-XML check.

## 1. XRechnung (current standard)

- **Current production version: XRechnung 3.0.2.** Normative content frozen since 3.0.0; KoSIT ships maintenance "bugfix" bundles twice a year. Latest: **Winter 2025/26 (2026-01-31, current)**. There is no 3.0.3.
- **XRechnung 4.0** is announced (March 2026), preliminary/test only. Rebases on EN 16931-1:2026 + UBL 2.5 / CII D25A. No mandatory adoption date — do NOT target it.
- **Syntaxes (two, both EN16931-compliant):** UBL 2.1 Invoice/CreditNote; UN/CEFACT CII **D16B**. Note: ZUGFeRD/Factur-X uses a later CII schema (SCRDM **D22B**, backward-compatible with D16B) — same family, different schema versions; matters for XSD selection.
- **Customization ID (BT-24) for XRechnung 3.0:** `urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0` (Extension: `...#conformant#urn:xeinkauf.de:kosit:extension:xrechnung_3.0`). Plain EN16931 UBL/CII uses `urn:cen.eu:en16931:2017`.
- **BR-DE-\* essentials (the German layer on top of EN16931 + BR-CO):**
  - **BR-DE-1**: SELLER CONTACT (BG-6) mandatory.
  - **BR-DE-2..5**: seller contact point (BT-41), phone (BT-42), email (BT-43), postal address detail must be present.
  - **BR-DE-15**: **BT-10 Buyer reference is MANDATORY** (promoted from optional). The single most important DE rule — every emitted XRechnung must carry BT-10.
  - **BR-DE-21**: BT-24 must equal the XRechnung customization ID.
  - **BR-DE-23/24/25**: credit transfer (58) → payment account (BG-17) present; SEPA/direct-debit conditional groups likewise.
  - **BR-DE-26**: invoice type code 384 (corrected) → PRECEDING INVOICE REFERENCE (BG-3) present.
  - Plus BR-DEX-_ extension rules and CEN BR-CO-_ / codelist rules. KoSIT enforces all three layers.
- **Leitweg-ID / BT-10:**
  - BT-10 is always required in XRechnung (BR-DE-15), independent of BT-13.
  - **B2G** to German authorities: BT-10 must be a valid Leitweg-ID (structured `Grobadressierung-Feinadressierung-Prüfziffer`). Portals ZRE/OZG-RE reject invoices lacking it. KoSIT does NOT verify the checksum — only that BT-10 is present/non-empty.
  - **B2B** (2025+ mandate): no Leitweg-ID needed; BT-10 may carry any internal reference but must be present/non-empty. For the input mapper: require a `buyerReference` field, default it sensibly, never emit empty BT-10.
- **KoSIT GitHub artifacts (github.com/itplr-kosit):** `validator` (engine), `validator-configuration-xrechnung` (scenario config — point the validator here), `xrechnung-schematron` (source), `xrechnung-testsuite` (positive/negative instances for CI smoke tests), `xrechnung-visualization` (reference XSL/XSL-FO).

## 2. ZUGFeRD vs Factur-X (hybrid PDF/A-3)

- Same standard, published jointly by FeRD (DE) and FNFE-MPE (FR). **ZUGFeRD 2.3 == Factur-X 1.07.** Latest patch: **ZUGFeRD 2.3.3 / Factur-X 1.07.3** (released May 2025, in force 2026-01-15). Underlying XML is UN/CEFACT CII **SCRDM D22B**.
- **Profiles (ascending): MINIMUM, BASIC-WL, BASIC, EN16931 ("Comfort"), EXTENDED, plus XRECHNUNG** (CII carrying the XRechnung CIUS).
- **Standalone EN16931-compliant (per BMF 2024-10-15):**
  - **NOT compliant: MINIMUM and BASIC-WL** — excluded (not full invoices). PRD correct.
  - **Compliant: BASIC, EN16931/Comfort, EXTENDED, XRECHNUNG.**
  - Embedded-XML filename must be `factur-x.xml` (accepted legacy alias `zugferd-invoice.xml`) — use `factur-x.xml`; declare the AFRelationship as `Alternative`; XMP `fx:` block uses namespace `urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#` and `fx:ConformanceLevel` = profile name (e.g. `EN 16931`).
- **PRD default EN16931/"Comfort" is correct**: minimal profile that is both a valid standalone EN16931 e-invoice AND fully machine-processable. Default to EN16931; allow EXTENDED/XRECHNUNG as opt-ins.

## 3. CI validators (dev/CI-only Java — NEVER bundled)

### KoSIT validator (XML / EN16931 + BR-DE)

- **Tool:** `validator` v**1.6.2** (released 2026-02-17). `validator-1.6.2-standalone.jar`. **Java 11+** (up to Java 25; Java 8 dropped at 1.6.0). Apache-2.0.
- **Config:** `validator-configuration-xrechnung` release **2026-01-31** (XRechnung Schematron 2.4.0, CEN rules 1.3.15, SchXslt 1.10.1, targets XRechnung 3.0.x). Release zip contains `scenarios.xml` + resources.
- **Headless invocation:**
  ```bash
  java -jar validator-1.6.2-standalone.jar \
    -r /path/to/validator-configuration-xrechnung_3.0.x_2026-01-31 \
    -s scenarios.xml -o reports invoice.xml
  ```
  `-r` repository dir, `-s` scenario config, `-o` output dir, `-h` HTML report, `-D` daemon mode.
- **What "green" looks like:** the validator ALWAYS writes `<inputname>-report.xml` and **does NOT set a failing exit code on a rejected document** — it exits 0 for "validation ran", non-zero only for config/IO errors. **CI must parse the report.** Pass = recommendation resolves to **accept** (`<rep:assessment><rep:accept>` present, `xmlns:rep="http://www.xoev.de/de/validator/varl/1"`) and zero `<rep:error>`. (`--check-assertions` testsuite mode does flip the exit code.)

### veraPDF (PDF/A-3b conformance)

- **Tool:** veraPDF **1.30** (released 2026-06-03). `verapdf-installer.zip` / `verapdf-gf-installer.zip` (greenfield parser — recommended). Dual GPLv3 / MPLv2. Java 8+ (bundled).
- **Headless invocation:**
  ```bash
  verapdf -f 3b --format xml invoice.pdf > verapdf-report.xml
  ```
  `-f 3b` selects PDF/A-3b. Green signal: `isCompliant="true"` on `<validationReport>` and `failedChecks="0"`.
- PDF/A-3**b** (visual) is the right target (3a adds tagging/accessibility — not required).

### Mustang (ZUGFeRD/Factur-X profile + embedded-XML)

- **Tool:** Mustangproject **2.24.0** (released 2026-06-12). `Mustang-CLI-2.24.0.jar`. Apache-2.0. **Embeds veraPDF** for the PDF/A check — validates both the container and the CII XML against the declared profile.
- **Headless invocation:**
  ```bash
  java -Xmx1G -Dfile.encoding=UTF-8 -jar Mustang-CLI-2.24.0.jar \
    --action validate --source invoice.pdf --no-notices
  ```
  Actions: `validate`, `validateExpectValid`/`validateExpectInvalid` (directory batch, flips exit code — ideal for CI fixtures), `--no-notices`.
- **What "green" looks like:** `<summary status="valid"/>` and exit 0 on valid. The report echoes the detected profile (e.g. `... profile EN 16931 ...`) — use for the profile-confirmation check.

## 4. PRD §10 acceptance bar — concrete CI mapping

| §10 requirement                         | Tool + assertion                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EN16931 schema + KoSIT pass             | KoSIT 1.6.2 + config 2026-01-31; report recommendation `accept` and zero `<rep:error>`. Run for the standalone XML AND the XML extracted from the hybrid PDF.                                                                                                                                                                                                                                                                                                                           |
| veraPDF PDF/A-3b zero errors            | `verapdf -f 3b --format xml`; assert `isCompliant="true"` and `failedChecks="0"`.                                                                                                                                                                                                                                                                                                                                                                                                       |
| ZUGFeRD validator confirms profile      | `Mustang-CLI --action validate`; assert `<summary status="valid"/>` and reported profile == expected (EN16931/Comfort).                                                                                                                                                                                                                                                                                                                                                                 |
| Embedded XML byte-equals standalone XML | Extract embedded `factur-x.xml` (pdf-lib / `qpdf --show-attachment` / Mustang `--action extract`) and `cmp`/sha256 against the standalone CII XML artifact. Keep the embedding step from re-serializing so bytes match. **Note:** the standalone XRechnung CII (D16B) and the embedded Factur-X CII (D22B) are DIFFERENT documents — the byte-equality check only holds when comparing the embedded Factur-X XML against the standalone _Factur-X_ CII artifact, not the XRechnung CII. |

### GitHub Actions skeleton (Java tools fetched at CI time, never shipped)

```yaml
- uses: actions/setup-java@v4
  with: { distribution: temurin, java-version: '21' }
- name: Fetch validators
  run: |
    curl -L -o validator.jar https://github.com/itplr-kosit/validator/releases/download/v1.6.2/validator-1.6.2-standalone.jar
    curl -L -o cfg.zip https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/release-2026-01-31/validator-configuration-xrechnung_3.0.x_2026-01-31.zip
    unzip cfg.zip -d cfg
    curl -L -o Mustang-CLI.jar https://github.com/ZUGFeRD/mustangproject/releases/download/core-2.24.0/Mustang-CLI-2.24.0.jar
    curl -L -o verapdf.zip https://software.verapdf.org/releases/verapdf-installer.zip
    unzip verapdf.zip && ./verapdf-*/verapdf-install <(printf 'INSTALL_PATH=%s\n[Pack]\n0\n' "$PWD/verapdf")
- name: Validate
  run: |
    java -jar validator.jar -r cfg -s scenarios.xml -o reports out/invoice-ubl.xml out/invoice-cii.xml
    ./verapdf/verapdf -f 3b --format xml out/invoice.pdf > reports/verapdf.xml
    java -jar Mustang-CLI.jar --action validate --source out/invoice.pdf --no-notices > reports/mustang.xml
    # a node/jq script asserts accept / isCompliant=true / status=valid + byte-equal
```

(Resolve exact asset URLs via the GitHub releases API rather than hardcoding — they rot every release.)

## Engine + dependency reality check (npm, verified)

- `@e-invoice-eu/core` **3.1.1** (WTFPL). Supports UBL, CII, XRechnung (UBL+CII), Factur-X/ZUGFeRD all profiles incl. EN16931/Comfort; PDF/A-3 assembly purely with pdf-lib (Node-only). Its built-in _visual_ PDF generation shells out to LibreOffice — bypass it (supply your own PDF).
- `@cantoo/pdf-lib` **2.7.1** (MIT); `@pdf-lib/fontkit` **1.1.1** (MIT); `@modelcontextprotocol/sdk` **1.29.0** (MIT); `zod` **4.4.3**.

## Decisions

- **Target XRechnung 3.0.2 (Winter 2025/26 bundle), NOT 4.0.**
- **Hybrid = ZUGFeRD 2.3 / Factur-X 1.07, default profile EN16931 (Comfort).**
- **Make BT-10 buyer reference a required input field, never emit empty.**
- **KoSIT validator v1.6.2 + config release 2026-01-31** for XML validation in CI.
- **veraPDF 1.30 with `-f 3b`** for PDF/A-3b conformance.
- **Mustang 2.24.0 CLI** for ZUGFeRD profile confirmation + container check.
- **Assert acceptance via report parsing, not exit codes, for KoSIT.**
- **Pin @e-invoice-eu/core 3.1.1 but supply own PDF rendering** (its built-in visual PDF path shells out to LibreOffice).

## Packages

| name                              | version            | license     | bundleable  | purpose                                                                                |
| --------------------------------- | ------------------ | ----------- | ----------- | -------------------------------------------------------------------------------------- |
| @e-invoice-eu/core                | 3.1.1              | WTFPL       | conditional | EN16931 XML + Factur-X profiles + PDF/A-3 assembly (avoid LibreOffice visual-PDF path) |
| @cantoo/pdf-lib                   | 2.7.1              | MIT         | yes         | PDF rendering + PDF/A-3 hybrid assembly                                                |
| @pdf-lib/fontkit                  | 1.1.1              | MIT         | yes         | Font embedding/subsetting                                                              |
| @modelcontextprotocol/sdk         | 1.29.0             | MIT         | yes         | MCP server SDK                                                                         |
| zod                               | 4.4.3              | MIT         | yes         | Input schema validation                                                                |
| KoSIT validator (standalone jar)  | 1.6.2              | Apache-2.0  | no (dev/CI) | XSD + EN16931 + BR-DE Schematron validation                                            |
| validator-configuration-xrechnung | release 2026-01-31 | Apache-2.0  | no (dev/CI) | scenarios.xml + Schematron resources                                                   |
| veraPDF                           | 1.30               | GPLv3/MPLv2 | no (dev/CI) | PDF/A-3b conformance                                                                   |
| Mustangproject CLI                | 2.24.0             | Apache-2.0  | no (dev/CI) | ZUGFeRD/Factur-X profile + container validation (embeds veraPDF)                       |

## Risks

- @e-invoice-eu/core PDF generation requires LibreOffice (native) on the spreadsheet path — conflicts with no-native-runtime; must bypass and render PDF in pure Node.
- WTFPL license may be unacceptable for some corporate users.
- core's pure-pdf-lib PDF/A path is upstream-flagged "not battle tested" — highest-technical-risk area; budget veraPDF iteration time.
- XRechnung 4.0 (EN16931-1:2026, UBL 2.5/CII D25A) is coming — isolate the CIUS version so a future bump doesn't ripple through the model; do NOT implement it yet.
- KoSIT validator exit-code semantics (0 even on invalid) is a footgun — parse the report.
- Leitweg-ID checksum/structure is NOT validated by KoSIT or EN16931 schema — if claiming B2G readiness, implement Leitweg-ID format/check-digit validation yourself or the portal rejects at submission.
- Validator artifact download URLs/zip naming change every release — resolve via GitHub releases API.

## Citations

- https://github.com/itplr-kosit/validator/releases
- https://github.com/itplr-kosit/validator
- https://github.com/itplr-kosit/validator-configuration-xrechnung/releases
- https://github.com/itplr-kosit/validator-configuration-xrechnung/blob/master/CHANGELOG.md
- https://xeinkauf.de/xrechnung/versionen-und-bundles/
- https://e-rechnung-bund.de/en/faq_category/buyer-reference/
- https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html
- https://www.ferd-net.de/en/downloads/publications/details/zugferd-23-english
- https://www.vatupdate.com/2025/05/13/updated-factur-x-1-07-3-and-zugferd-2-3-3-e-invoicing-standards-released-for-eu-compliance/
- https://docs.verapdf.org/cli/
- https://software.verapdf.org/releases
- https://github.com/veraPDF/veraPDF-apps
- https://github.com/ZUGFeRD/mustangproject/releases
- https://www.mustangproject.org/commandline/
- https://github.com/gflohr/e-invoice-eu
- https://github.com/itplr-kosit/xrechnung-schematron/blob/master/CHANGELOG.md
- https://www.npmjs.com/package/@e-invoice-eu/core
