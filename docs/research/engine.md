# Research: @e-invoice-eu/core engine

**Topic:** version, license, dependency tree, public API (XML + supply-a-PDF Factur-X path), LibreOffice avoidance, profiles, BT/BG mapping, maturity.

## Summary

`@e-invoice-eu/core` **3.1.1** (WTFPL, MIT-equivalent freedom) is a pure-TypeScript/JS library with NO native deps, NO postinstall, NO `.node` bindings — fully bundleable by esbuild. It DOES depend on `@cantoo/pdf-lib` (currently 2.7.1, MIT) which does the PDF/A-3 assembly entirely in JS. The single public entry point is `new InvoiceService(logger).generate(invoice, options)`: it emits UBL/CII/XRechnung-UBL/XRechnung-CII XML (string) or a Factur-X/ZUGFeRD PDF/A-3 (Uint8Array) depending on `options.format`.

**CRITICAL for this project:** LibreOffice is invoked ONLY on the spreadsheet→PDF path (`options.spreadsheet` set, `options.pdf` absent). If you ALWAYS pass `options.pdf` (your own rendered visual PDF as a `FileInfo`) and NEVER pass `options.spreadsheet`, the `child_process.spawn(libreoffice, ...)` code path is provably never reached — it uses your buffer verbatim.

The invoice input is NOT a bespoke JSON schema: it is a UBL-syntax JSON tree rooted at `ubl:Invoice` with `cbc:`/`cac:`-prefixed keys; every field carries its EN16931 BT-/BG- code in the JSON-Schema `description` (259 BT/BG references), so mapping your canonical model is path-based. XRechnung target is 3.0 (KoSIT urn `xrechnung_3.0`). All six Factur-X/ZUGFeRD profiles (MINIMUM, BASIC-WL, BASIC, EN16931/Comfort, EXTENDED, XRechnung) are supported. The PDF/A-3 path is self-admittedly "not battle tested" by the upstream author.

## 1. Identity, license, repo, dependency tree

- **Package:** `@e-invoice-eu/core`
- **Latest version:** `3.1.1` (published 2026-04-28). 3.x is current; pin `@e-invoice-eu/core@3.1.1` (or `^3.1.1`). Version 4 is signposted in code (a deprecation warning about coercing `cbc:Note` from string→array will be removed "in version 4").
- **License:** `WTFPL` (maximally permissive; functionally equivalent to public domain — fine for an open-source MIT/Apache project, but note WTFPL is not OSI-approved, which can matter for some corporate allowlists).
- **Repository:** `https://github.com/gflohr/e-invoice-eu` (monorepo; this package lives at `packages/core`).
- **Entry points:** `main: dist/e-invoice-eu.cjs.js`, `module: dist/e-invoice-eu.esm.js`, plus UMD `dist/e-invoice-eu.min.js` and a browser build. Ships its own `.d.ts` (no `@types` needed).

### Runtime dependencies (exact)

- `@cantoo/pdf-lib ^2.6.5` → resolves to **2.7.1** (MIT). The PDF/A-3 assembly engine. Transitive deps all pure JS: `@pdf-lib/standard-fonts`, `@pdf-lib/upng`, `color`, `crypto-js`, `node-html-better-parser`, `pako`, `tslib`. No native code.
- `@e965/xlsx ^0.20.3` (Apache-2.0, zero deps) — maintained SheetJS fork, used only by the spreadsheet/`MappingService` path. Pure JS.
- `@esgettext/runtime ^1.3.10` (WTFPL) — i18n runtime for log/error strings. Pure JS.
- `ajv ^8.18.0` (MIT) — JSON-Schema validation of the invoice input (Ajv 2019 dialect).
- `jsonpath-plus ^10.4.0` (MIT) — used by the mapping engine. Pure JS. (Historically had a sandbox CVE; 10.x is the patched line.)
- `tmp-promise ^3.0.3` (MIT) → `tmp` — temp files, used ONLY when shelling out to LibreOffice on the spreadsheet path.
- `tslib ^2.8.1` (0BSD), `xmlbuilder2 ^4.0.3` (MIT, deps `@oozcitak/*` + `js-yaml`, all pure JS) — XML serialization.

**Optional/peer deps:** NONE.

**Native runtimes / binaries:** NONE bundled or depended on. The ONLY external-binary touchpoint is an OS-level `libreoffice`/`soffice` executable that the library `spawn`s at runtime — but only on the spreadsheet path. No JVM, no Ghostscript, no Chromium, no node-gyp/prebuild/postinstall. esbuild can bundle this cleanly; mark `child_process`, `fs`, `crypto`, `url`, `path`, `tmp-promise` as Node externals (only used on the LibreOffice path you won't trigger, but imported at module top level).

## 2. Public API

All exports come from the package root. The surface you care about:

- `InvoiceService` (class) — the only thing you need for generation.
- `FormatFactoryService` (class) — enumerate/normalize formats.
- `MappingService` (class) — spreadsheet→Invoice; NOT used by this project.
- `invoiceSchema`, `mappingSchema` — Ajv `JSONSchemaType<Invoice>` / `<Mapping>` objects.
- Types: `Invoice` (and ~hundreds of sub-interfaces), `FileInfo`, `InvoiceServiceOptions`, `FormatInfo`, `Logger`.

### Core call

```ts
import { InvoiceService, type Invoice, type FileInfo } from '@e-invoice-eu/core';

const svc = new InvoiceService(console); // logger: any object with .log/.warn/.error
const result: string | Uint8Array = await svc.generate(invoice, options);
```

`InvoiceService.generate(input: Invoice, options: InvoiceServiceOptions): Promise<string | Uint8Array>`

- Returns a **`string`** (the XML) for pure-XML formats (UBL, CII, XRECHNUNG-UBL, XRECHNUNG-CII).
- Returns a **`Uint8Array`** (the PDF/A-3 bytes) for Factur-X/ZUGFeRD formats.

`InvoiceServiceOptions` (exact):

```ts
type FileInfo = {
  buffer: Uint8Array;
  filename: string;
  mimetype: string; // note: spelled "mimetype" (lowercase t), not mimeType
  id?: string;
  description?: string;
};
type InvoiceServiceOptions = {
  format: string; // e.g. 'XRECHNUNG-CII', 'Factur-X-EN16931', case-insensitive + aliases
  spreadsheet?: FileInfo; // DO NOT SET — triggers LibreOffice
  pdf?: FileInfo; // YOUR pre-rendered visual PDF goes here
  lang: string; // e.g. 'de-de' — only used for canned XMP text in Factur-X PDFs
  attachments?: FileInfo[]; // extra files: embedded in XML (XML formats) or attached to PDF (Factur-X)
  embedPDF?: boolean; // XML formats only: base64-embed a PDF inside the XML
  libreOfficePath?: string; // path to soffice; only consulted on the spreadsheet path
  noWarnings?: boolean; // silence the v4 deprecation console.warn
  postProcessor?: (data: ExpandObject) => Promise<void>; // hook to mutate the xmlbuilder2 tree before serialization
};
```

(The README's prose calls the spreadsheet arg `data`; the actual TS field is **`spreadsheet`**. Trust the type.)

### (a) Generate EN16931 XML — UBL / CII / XRechnung-UBL / XRechnung-CII

```ts
const xml: string = (await svc.generate(invoice, {
  format: 'XRECHNUNG-CII', // or 'XRECHNUNG-UBL' | 'UBL' | 'CII'
  lang: 'de-de',
})) as string;
```

Format names accepted (case-insensitive): `UBL`, `CII`, `XRECHNUNG-UBL`, `XRECHNUNG-CII`. `embedPDF: true` requires you to ALSO pass `pdf` (or it would try LibreOffice).

### (b) Generate ZUGFeRD/Factur-X PDF/A-3 by SUPPLYING YOUR OWN visual PDF (LibreOffice-free path)

```ts
const visualPdf: Uint8Array = /* your rendered PDF (pdf-lib/fontkit, etc.) */;
const pdfA3: Uint8Array = await svc.generate(invoice, {
  format: 'Factur-X-EN16931',   // or any profile/alias below
  lang: 'de-de',
  pdf: {
    buffer: visualPdf,
    filename: 'invoice.pdf',
    mimetype: 'application/pdf',
  },
}) as Uint8Array;
```

Confirmed by the bundle's `FormatXMLService.getInvoicePdf(options)`: `if (options.pdf) { if (!options.pdf.buffer) throw; return options.pdf.buffer; }` — your buffer is used verbatim; the LibreOffice branch is only reached when `pdf` is undefined.

### Enumerate / normalize formats

```ts
import { FormatFactoryService } from '@e-invoice-eu/core';
const f = new FormatFactoryService();
const infos = f.listFormatServices(); // FormatInfo[] { name, customizationID, profileID, mimeType, syntax }
const canonical = f.normalizeFormat('ZUGFeRD-Comfort'); // -> 'factur-x-en16931'
```

### Invoice JSON shape (its "schema")

It is **UBL-syntax JSON**, not a flat custom model. Root:

```ts
interface Invoice {
  'ubl:Invoice': {
    'cbc:CustomizationID'?: string;   // auto-filled per format if omitted
    'cbc:ProfileID'?: string;         // auto-filled per format if omitted
    'cbc:ID': string;                 // BT-1 invoice number  (REQUIRED)
    'cbc:IssueDate': string;          // BT-2 'YYYY-MM-DD'     (REQUIRED)
    'cbc:DueDate'?: string;           // BT-9
    'cbc:InvoiceTypeCode': string;    // BT-3 (e.g. '380')     (REQUIRED)
    'cbc:Note'?: string[];            // BT-22 (array of strings; string is deprecated→v4)
    'cbc:DocumentCurrencyCode': string; // BT-5               (REQUIRED)
    'cbc:TaxCurrencyCode'?: string;   // BT-6
    'cbc:BuyerReference'?: string;    // BT-10 (required by XRechnung CIUS in practice)
    'cac:InvoicePeriod'?: {...};      // BG-14
    'cac:OrderReference'?: {...};     // BT-13/BT-14
    'cac:AccountingSupplierParty': {...};  // BG-4 SELLER       (REQUIRED)
    'cac:AccountingCustomerParty': {...};  // BG-7 BUYER        (REQUIRED)
    'cac:Delivery'?: {...};
    'cac:PaymentMeans'?: [...];       // BG-16
    'cac:PaymentTerms'?: {...};
    'cac:AllowanceCharge'?: [...];    // BG-20/BG-21 doc-level
    'cac:TaxTotal': [TAXTOTAL] | [TAXTOTAL, TAXTOTAL]; // BG-22 (REQUIRED, 1 or 2 entries)
    'cac:LegalMonetaryTotal': {...};  // BG-22 DOCUMENTTOTALS  (REQUIRED)
    'cac:InvoiceLine': [INVOICELINE, ...INVOICELINE[]]; // BG-25 (REQUIRED, >=1)
  };
}
```

Field value types are heavily enumerated (currency/country codes, invoice type codes, scheme identifiers, EAS codes). Ajv enforces these at `generate()` time, throwing `Ajv2019.ValidationError` on bad input.

`generate()` internally: `structuredClone` input → (legacy Note coercion) → resolve format service → `ajv.compile(patchedSchema)` (`strict:true, allErrors:true, useDefaults:true`) → validate → `formatter.fillInvoiceDefaults()` → `formatter.generate()`. `fillInvoiceDefaults` auto-sets `cbc:CustomizationID` and `cbc:ProfileID` to the format-correct URNs if omitted — so omit them and let the engine set the right ones per format.

## 3. The LibreOffice path and how to guarantee it never runs

Confirmed by reading the compiled bundle (`dist/e-invoice-eu.cjs.js`):

- The module top-level imports `child_process`.
- `renderSpreadsheet(...)` does `child_process.spawn(libreoffice, ['--headless', ..., '--convert-to', 'pdf', ...])`. This is the ONLY external-binary shell-out.
- It is reached exclusively via `FormatXMLService.getInvoicePdf(options)`:
  1. `if (options.pdf?.buffer)` → return `options.pdf.buffer` (LibreOffice NOT touched).
  2. else if `!options.spreadsheet` → throw "Either an invoice spreadsheet file or an invoice PDF is needed!".
  3. else if `options.libreOfficePath === undefined` → throw "LibreOffice path is required for conversion to PDF!".
  4. else → `renderSpreadsheet(...)` (the spawn).

**100%-safe usage:** For Factur-X/ZUGFeRD, ALWAYS pass `options.pdf` and NEVER pass `options.spreadsheet` or `options.libreOfficePath`. For pure XML, don't pass `embedPDF` (or if you do, also pass `pdf`). Never use `MappingService` (only consumer of `@e965/xlsx`). The Factur-X PDF/A-3 builder uses Web Crypto `crypto.webcrypto.subtle` for hashing embedded-file relationships — available natively in modern Node.

## 4. Supported profiles and target versions

| format name          | syntax | mimeType        | customizationID                                                       |
| -------------------- | ------ | --------------- | --------------------------------------------------------------------- |
| `CII`                | CII    | application/xml | urn:cen.eu:en16931:2017                                               |
| `UBL`                | UBL    | application/xml | urn:cen.eu:en16931:2017                                               |
| `XRECHNUNG-UBL`      | UBL    | application/xml | urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0 |
| `XRECHNUNG-CII`      | CII    | application/xml | urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0 |
| `Factur-X-Minimum`   | CII    | application/pdf | urn:factur-x.eu:1p0:minimum                                           |
| `Factur-X-Basic WL`  | CII    | application/pdf | urn:factur-x.eu:1p0:basicwl                                           |
| `Factur-X-Basic`     | CII    | application/pdf | urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic           |
| `Factur-X-EN16931`   | CII    | application/pdf | urn:cen.eu:en16931:2017                                               |
| `Factur-X-Extended`  | CII    | application/pdf | urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended       |
| `Factur-X-XRechnung` | CII    | application/pdf | urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0 |

- **XRechnung version targeted: 3.0** (`urn:xeinkauf.de:kosit:xrechnung_3.0`). Plain UBL/CII profileID for Peppol is `urn:fdc:peppol.eu:2017:poacc:billing:01:1.0`.
- **Aliases** (`normalizeFormat`, case-insensitive): `*-Comfort` → `*-en16931`; `*-Basic WL`/`*-Basic-WL`/`*-Basic_WL` → `*-basic wl`; `zugferd-*` → `factur-x-*`.

## 5. BT-/BG- mapping into the engine input

Map your canonical model into the UBL-syntax `Invoice` object by element PATH, then call `generate()`. The engine's JSON Schema annotates every leaf with its EN16931 term (259 BT/BG references). Examples:

- BT-1 Invoice number → `ubl:Invoice.cbc:ID`
- BT-2 Issue date → `ubl:Invoice.cbc:IssueDate`
- BT-3 Type code → `ubl:Invoice.cbc:InvoiceTypeCode`
- BT-5 Currency → `ubl:Invoice.cbc:DocumentCurrencyCode`
- BT-9 Due date → `ubl:Invoice.cbc:DueDate`
- BT-22 Note → `ubl:Invoice.cbc:Note[]`
- BT-23 Business process → `cbc:ProfileID`; BT-24 Spec id → `cbc:CustomizationID`
- BG-4 Seller → `cac:AccountingSupplierParty`; BG-7 Buyer → `cac:AccountingCustomerParty`
- BG-22 Totals → `cac:LegalMonetaryTotal`; BG-23 VAT breakdown → `cac:TaxTotal[].cac:TaxSubtotal[]`; BG-25 lines → `cac:InvoiceLine[]`.

Keep your canonical model and write a one-shot serializer to this UBL-JSON tree — the SAME tree is used for ALL outputs (the engine internally transforms UBL-JSON → CII for CII/Factur-X/XRechnung-CII). The TS `Invoice` interface (`dist/invoice/invoice.interface.d.ts`, ~612 lines) is the authoritative field list with enumerated value types.

## 6. Maturity / known issues (PDF/A-3)

- XML generation paths (UBL/CII/XRechnung) are the mature, well-exercised core.
- The **PDF/A-3 path is explicitly self-flagged by upstream as "not battle tested."** The library builds the PDF/A solely with `@cantoo/pdf-lib` and performs "pretty complicated transformations" (output intent / sRGB ICC, XMP metadata incl. Factur-X DocumentType/Version/ConformanceLevel + PDF/A-3 extension schema, struct-tree root, MarkInfo, trailer ID, AF relationship for `factur-x.xml`, link-annotation fixes). The engine sets the output intent but does NOT fix YOUR visual PDF's missing fonts/color spaces — garbage-in for PDF/A means veraPDF failures out.
- **Action:** Gate every produced hybrid PDF through veraPDF (PDF/A-3b) + Mustang/ZUGFeRD validators in CI. Render your visual PDF PDF/A-ready (embed all fonts, sRGB, no encryption, no AcroForm/JS).
- Versioning is active (3.0.0 in 2026-03, 3.1.1 in 2026-04). v4 anticipated (cbc:Note coercion removal) — pin and watch.

## Decisions

- **Pin `@e-invoice-eu/core@3.1.1`** — current latest, WTFPL, pure JS, no native deps. v4 is anticipated with a breaking change.
- **Use the single entry point** `new InvoiceService(console).generate(invoice, options)`.
- **For Factur-X/ZUGFeRD: ALWAYS pass `options.pdf`; NEVER pass `options.spreadsheet` or `options.libreOfficePath`** — the documented supply-a-PDF path that avoids LibreOffice 100%.
- **Never import/use `MappingService` or pass `embedPDF` without a `pdf`.**
- **Build ONE UBL-syntax JSON input and reuse it for all formats.** Omit `cbc:CustomizationID`/`cbc:ProfileID` and let `fillInvoiceDefaults` set the URNs.
- **Map canonical model to engine input by EN16931 BT/BG codes** read from `invoiceSchema` descriptions / the `Invoice` `.d.ts`.
- **Target XRechnung 3.0**; expose `XRECHNUNG-CII` / `XRECHNUNG-UBL` / `Factur-X-EN16931` (default) plus aliases.
- **Bundle with esbuild marking node built-ins** (`child_process`, `fs`, `crypto`, `url`, `path`) and `tmp-promise` as externals; ship as Node CJS/ESM.
- **Gate every generated hybrid PDF/A-3 through veraPDF + Mustang in CI.**

## Packages

| name               | version | license    | purpose                                                                                |
| ------------------ | ------- | ---------- | -------------------------------------------------------------------------------------- |
| @e-invoice-eu/core | 3.1.1   | WTFPL      | EN16931 engine: UBL/CII/XRechnung XML + Factur-X/ZUGFeRD PDF/A-3 via supply-a-PDF path |
| @cantoo/pdf-lib    | 2.7.1   | MIT        | (transitive) PDF/A-3 transformation + factur-x.xml embedding                           |
| @e965/xlsx         | 0.20.3  | Apache-2.0 | (transitive) spreadsheet import for MappingService only — unused                       |
| ajv                | ^8.18.0 | MIT        | validates invoice input at generate() time                                             |
| xmlbuilder2        | 4.0.3   | MIT        | builds/serializes UBL/CII XML trees                                                    |
| jsonpath-plus      | 10.4.0  | MIT        | mapping engine only (unused); note CVE history, 10.x patched                           |
| @esgettext/runtime | 1.3.10  | WTFPL      | i18n runtime                                                                           |
| tmp-promise        | 3.0.3   | MIT        | temp files; LibreOffice path only                                                      |
| tslib              | ^2.8.1  | 0BSD       | TS helper runtime                                                                      |

## Risks

- PDF/A-3 path is upstream-flagged "not battle tested" — most likely source of veraPDF failures. Mitigate with CI gating + a PDF/A-ready visual PDF.
- Package imports `child_process` at module top level. If a future refactor sets `options.spreadsheet` without `options.pdf`, the engine throws (or spawns LibreOffice if `libreOfficePath` set). Add a provider guard asserting `pdf` is set and `spreadsheet`/`libreOfficePath` are never passed.
- WTFPL is not OSI-approved — may trip corporate license allowlists / SBOM tooling.
- v4 anticipated with a breaking change. Pin and add a dependabot review gate for major bumps.
- jsonpath-plus has a CVE history (10.4.0 patched) — keep in npm audit scope.
- XRechnung XML targets 3.0; depends on upstream to update the customizationID if the mandate bumps.
- esbuild must externalize node built-ins + tmp-promise.

## Citations

- https://www.npmjs.com/package/@e-invoice-eu/core
- https://github.com/gflohr/e-invoice-eu
- https://github.com/gflohr/e-invoice-eu/tree/main/packages/core
- https://github.com/gflohr/e-invoice-eu/blob/main/README.md
- https://gflohr.github.io/e-invoice-eu/en/docs/e-invoice-formats/factur-x-zugferd/
- https://gflohr.github.io/e-invoice-eu/en/docs/details/internal-format/
- https://www.npmjs.com/package/@cantoo/pdf-lib
- https://deepwiki.com/horstoeko/zugferd/6.4-zugferdpdfvalidator:-pdfa-validation-with-verapdf
