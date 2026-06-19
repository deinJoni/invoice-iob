# Research: Pure-JS PDF rendering (@cantoo/pdf-lib) + PDF/A-3b-amenable source PDF

## Summary

`@cantoo/pdf-lib` **2.7.1** + `@pdf-lib/fontkit` **1.1.1** are both pure-JS, esbuild-bundleable, MIT-licensed, and are exactly the libs `@e-invoice-eu/core` 3.1.1 itself uses (core declares `@cantoo/pdf-lib ^2.6.5` as a runtime dep). Use `@cantoo/pdf-lib` directly to draw your visual invoice.

**Single most important PRD correction:** the `@cantoo` fork's real addition over upstream `pdf-lib` is **SVG drawing** (`drawSvg`/`drawSvgPath`), NOT PDF/A or attachments — upstream `pdf-lib` 1.17.1 already had `attach()`, `AFRelationship`, and the `/AF` catalog wiring, and the fork inherits them. ALL of the Factur-X/PDF-A3 machinery (sRGB OutputIntent, embedded ICC, XMP with `pdfaid` part=3 conformance=B + Factur-X extension schema, embedding the CII XML as an Associated File with `AFRelationship=Alternative`, MarkInfo/StructTreeRoot, trailer ID) is done by `@e-invoice-eu/core`'s `FormatFacturXService` when you pass `format=Factur-X-*` and `options.pdf.buffer` — confirmed by reading the shipped bundle. **Your job is only to hand core a clean source PDF:** subset-embedded fonts (no Standard-14), device-independent color, no encryption, no AcroForm/JS/external refs.

## 1. Versions, purity, licenses, and what the @cantoo fork actually adds

| pkg | version (2026-06) | license | pure-JS / bundleable |
|---|---|---|---|
| @cantoo/pdf-lib | 2.7.1 | MIT | Yes. Deps: @pdf-lib/standard-fonts, @pdf-lib/upng, color, crypto-js, node-html-better-parser, pako, tslib — all pure JS. |
| @pdf-lib/fontkit | 1.1.1 | MIT | Yes (only dep is `pako`). This is the pdf-lib-specific build — do NOT use upstream `fontkit` 2.x. |

**PRD CORRECTION — what the @cantoo fork adds.** The fork's addition is **SVG support** (`page.drawSvg`, `page.drawSvgPath`, `pdfDoc.embedSvg`). It does NOT add PDF/A or attachment features. Verified against `pdf-lib@1.17.1`: upstream already ships `PDFDocument.attach()`, the `AFRelationship` enum, `FileEmbedder` (`/Filespec`, `/EF`, `/AFRelationship`), and `PDFEmbeddedFile.embed()` which wires the `/AF` Associated-Files array into the catalog — same code as the fork. Practical reasons to use @cantoo/pdf-lib: (a) it's the exact dep core uses, so you share one copy and one `PDFDocument` class — important because core does `PDFDocument.load(yourBytes)`; (b) it's actively maintained (2.x line, ESM+CJS); (c) SVG drawing is handy for logos.

## 2. Should WE render the visual PDF with @cantoo/pdf-lib? Yes.

Render directly with @cantoo/pdf-lib and hand the bytes to core. To make the source PDF "PDF/A-3b amenable", it must satisfy what core does NOT fix:
- **Subset-embed every font** via fontkit; `embedFont(bytes, { subset: true })`.
- **No Standard-14 fonts.** Never `embedFont(StandardFonts.Helvetica)` — not embedded, fails PDF/A.
- **Device-independent color.** Use `rgb(...)`/`grayscale(...)` (DeviceRGB/DeviceGray — fine because core attaches an sRGB OutputIntent). Do NOT embed CMYK images or separation colors. Prefer pure black text `rgb(0,0,0)`.
- **No encryption** (default save is unencrypted).
- **No interactive AcroForm, no JavaScript, no embedded multimedia, no external/URI streams beyond simple links** (core's `fixLinkAnnotations` only sets the Print flag; it does not strip forms or JS).
- Embed raster logos as PNG (`embedPng`) or vector via `embedSvg`. JPEG fine; avoid exotic color spaces.

Code sketch (draw-time, before handing to core):
```ts
import { PDFDocument, rgb } from '@cantoo/pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs';

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);                       // REQUIRED before custom fonts

const regular = await doc.embedFont(fs.readFileSync('assets/NotoSans-Regular.ttf'), { subset: true });
const bold    = await doc.embedFont(fs.readFileSync('assets/NotoSans-Bold.ttf'), { subset: true });

const page = doc.addPage([595.28, 841.89]);          // A4 in pt
const { height } = page.getSize();
page.drawText('Rechnung 2026-001', { x: 50, y: height - 60, size: 18, font: bold, color: rgb(0,0,0) });

let y = height - 120;
for (const row of rows) {
  page.drawText(row.desc,  { x: 50,  y, size: 10, font: regular, color: rgb(0,0,0) });
  page.drawText(row.qty,   { x: 360, y, size: 10, font: regular, color: rgb(0,0,0) });
  page.drawText(row.total, { x: 460, y, size: 10, font: regular, color: rgb(0,0,0) });
  page.drawLine({ start:{x:50,y:y-4}, end:{x:545,y:y-4}, thickness:0.5, color: rgb(0.8,0.8,0.8) });
  y -= 18;
}

// Do NOT set custom XMP (core writes the PDF/A XMP); core overwrites Author/Title/Producer/dates + /Metadata.
const sourcePdfBytes = await doc.save({ useObjectStreams: false }); // safer for PDF/A toolchains; core re-saves anyway
```

## 3. Which party adds OutputIntent + sRGB ICC + XMP + embedded XML AF — the ENGINE

Verified by reading the shipped bundle of `@e-invoice-eu/core@3.1.1`. `FormatFacturXService.generate(invoice, options)`:
```ts
const pdf    = await this.getInvoicePdf(options);              // returns options.pdf.buffer (YOUR PDF)
const pdfDoc = await PDFDocument.load(pdf, { updateMetadata: false });
await this.attachFiles(pdfDoc, options);                       // options.attachments => AFRelationship.Supplement
const xml    = await super.generate(invoice, options);         // builds the CII XML
await this.attachFacturX(pdfDoc, options, xml);                // embeds factur-x.xml as Associated File
await this.createPDFA(pdfDoc, options, invoice);               // ALL the PDF/A-3 machinery
return await pdfDoc.save();
```
- `attachFacturX` attaches the CII XML with **`AFRelationship.Alternative`**, filename `factur-x.xml` (or `xrechnung.xml` for the factur-x-xrechnung profile), mimetype `text/xml`, description `Factur-X`.
- `createPDFA` (all done by core):
  - **OutputIntent**: `/OutputIntent { Type:'OutputIntent', S:'GTS_PDFA1', OutputConditionIdentifier:'sRGB', DestOutputProfile:<ICC ref> }`; sets `catalog./OutputIntents`.
  - **sRGB ICC**: core ships its OWN base64 sRGB profile inline ("IEC 61966-2-1 Default RGB Colour Space - sRGB" ICC v2). **You do NOT need to ship an ICC profile.**
  - **XMP**: builds a packet with `pdfaid:part=3`, `pdfaid:conformance=B`, dc:* fields, a PDF/A extension schema description, and Factur-X XMP (conformance level e.g. `EN 16931`, version `1.0`, DocumentFileName `factur-x.xml`); sets it as `/Metadata`.
  - Also `setAuthor/setCreator/setProducer/setTitle/setSubject/setKeywords(['Invoice','Factur-X','ZUGFeRD'])/setLanguage/dates`, a deterministic SHA-512 trailer `/ID`, `/MarkInfo {Marked:true}` + a `/StructTreeRoot`, and `fixLinkAnnotations`.

**What your source PDF must NOT contain** (core does not strip these):
- Standard-14 / non-embedded fonts (core won't embed fonts for you).
- Encryption (core loads without `ignoreEncryption`; encrypted input throws).
- CMYK/Separation/ICC-tagged images or Lab/non-device color (only DeviceRGB/DeviceGray are covered by the sRGB OutputIntent).
- Transparency with unusual blend, JavaScript, your own non-PDF/A-3-legal embedded files, multimedia/3D, or a pre-existing conflicting `/OutputIntents`/`/Metadata`/`/AF` tree. Keep attachments OUT of the source PDF; let core add them.
- A too-new PDF version is fine; core re-saves. You do NOT need to pre-mark the source as PDF/A.

Caveat: core's PDF/A transform is heuristic and runs no validator. The empty `/StructTreeRoot` is a minimal stub — veraPDF PDF/A-3**b** (visual, not accessible 'a') generally accepts it, but confirm on fixtures. **Validate output with veraPDF (PDF/A-3b) + KoSIT/Mustang (Factur-X) in CI.**

## 4. Contingency: assembling PDF/A-3 ourselves — realistic but redundant

Technically realistic — @cantoo/pdf-lib exposes every primitive core uses: `pdfDoc.attach(buf, name, { afRelationship: AFRelationship.Alternative, mimeType:'text/xml' })`, `pdfDoc.context.stream/register/obj`, `pdfDoc.catalog.set(PDFName.of('OutputIntents'|'Metadata'|'MarkInfo'|'StructTreeRoot'), ...)`, `setTitle/...`, `context.trailerInfo.ID`. You'd have to: (a) ship and embed an sRGB ICC stream + build the OutputIntent dict; (b) hand-author the XMP including pdfaid part/conformance, the PDF/A extension-schema description for the Factur-X namespace, and the Factur-X XMP block (the fiddly part); (c) set MarkInfo/StructTreeRoot + trailer ID + dates. Net: re-implementing `createPDFA` verbatim. **Recommendation: do NOT self-assemble for v1; rely on core.** Keep as a documented fallback only if a core bug blocks veraPDF conformance.

## 5. @cantoo/pdf-lib vs pdfkit for bundling — @cantoo wins

- @cantoo/pdf-lib is a document-object model — build the graph and `save()` to bytes; pure-JS deps, esbuild bundles to one file with zero runtime asset loading. pdfkit 0.19.1 is stream-based, pulls upstream fontkit 2.x + linebreak + png-js + @noble/* + js-md5, and relies on resolving AFM data files (awkward to bundle).
- **Decisive reason**: core's Factur-X path calls `PDFDocument.load(yourBytes)` from @cantoo/pdf-lib. Rendering with @cantoo/pdf-lib reuses the identical dep, keeps the round-trip within one library's object model, and avoids a second renderer in the bundle. pdfkit's only edge is high-level text layout — but for a structured invoice you lay out manually.

## Decisions

- **Render the visual invoice PDF directly with @cantoo/pdf-lib + @pdf-lib/fontkit; do not add pdfkit.**
- **Always subset-embed an OFL font via fontkit; never use Standard-14 fonts.**
- **Let @e-invoice-eu/core do ALL PDF/A-3 + Factur-X assembly.**
- **Produce a source PDF that is unencrypted, DeviceRGB/DeviceGray only, no AcroForm/JS/multimedia, no pre-set `/Metadata`/`/OutputIntents`; let core add attachments.**
- **Do NOT ship our own sRGB ICC profile for the Factur-X path** (core embeds its own). Only needed for the self-assembly contingency.
- **Treat self-assembly as a documented contingency only, not v1.**
- **Validate every build with veraPDF (PDF/A-3b) + KoSIT/Mustang (Factur-X) in CI.**

## Packages

| name | version | license | purpose |
|---|---|---|---|
| @cantoo/pdf-lib | 2.7.1 | MIT | Pure-JS PDF DOM: draw the visual invoice, embed subset fonts; same class core uses to load+transform. |
| @pdf-lib/fontkit | 1.1.1 | MIT | Font subsetting backend (`registerFontkit`); enables `embedFont(bytes,{subset:true})`. |
| @e-invoice-eu/core | 3.1.1 | WTFPL | Engine: maps canonical invoice → CII/UBL/XRechnung XML; for Factur-X, loads our source PDF and produces the PDF/A-3b hybrid. |
| pdf-lib (upstream) | 1.17.1 | MIT | Reference only (proves the fork doesn't add PDF/A). Do not depend on it. |
| pdfkit | 0.19.1 | MIT | Considered alternative — REJECTED (heavier dep tree, second PDF engine). |

## Risks

- core's PDF/A conversion is heuristic and runs no validator itself — conformance not guaranteed without veraPDF + KoSIT/Mustang CI gates on real fixtures.
- core sets only an empty `/StructTreeRoot` + `/MarkInfo{Marked:true}` (targets PDF/A-3b). A strict profile or PDF/A-3a expectation could flag it — verify on samples.
- Device-color reliance: DeviceRGB/DeviceGray conformance depends on core's sRGB OutputIntent. Constrain the renderer to `rgb()`/`grayscale()` and PNG/JPEG-RGB logos.
- Version coupling: you and core must resolve to the SAME @cantoo/pdf-lib (PDFDocument identity). core pins `^2.6.5`; pin compatibly and verify a single instance to avoid "foreign PDFDocument" errors.
- @e-invoice-eu/core is WTFPL — confirm it clears your OSS license policy.
- If your source PDF already contains attachments/`/Metadata`/`/OutputIntents`/`/AF`, it may collide with core's additions. Keep the source PDF minimal.
- The @cantoo fork is maintained "as long as we need it" — factor into long-term maintenance.
- Standard-14 fonts and encryption in the source PDF are silent killers — enforce subset embedding + unencrypted save in code.

## Citations

- https://www.npmjs.com/package/@cantoo/pdf-lib
- https://github.com/cantoo-scribe/pdf-lib
- https://www.npmjs.com/package/@pdf-lib/fontkit
- https://github.com/gflohr/e-invoice-eu
- https://github.com/gflohr/e-invoice-eu/tree/main/packages/core
- https://www.npmjs.com/package/@e-invoice-eu/core
- https://www.npmjs.com/package/pdf-lib
- https://www.npmjs.com/package/pdfkit
- https://www.pdfa.org/wp-content/uploads/2018/10/PDF20_AN002-AF.pdf
