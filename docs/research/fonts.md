# Research: Permissive embeddable font for the visual PDF (EN 16931 / ZUGFeRD invoices)

PDF/A requires all fonts embedded — Standard-14 fonts are forbidden.

## Summary

Recommend **IBM Plex Sans (OFL-1.1)** as the primary family: smallest full TTFs (~200 KB/weight, 391 KB for Regular+Bold), full coverage of German umlauts/ä ö ü Ä Ö Ü ß/ẞ + €/§ + EU Latin, and reads cleanly in dense invoice tables. **Source Sans 3 (OFL-1.1)** is the close runner-up with a warmer, more "document-grade" look at ~430 KB/weight. The PRD's "Carlito Apache?" note is wrong — **Carlito AND Caladea are SIL OFL-1.1, not Apache** (Carlito's TTFs are also the largest at ~600-680 KB/weight). Crucially, full TTF size is nearly irrelevant to the 5 MB cap: `@pdf-lib/fontkit` subsets at embed time, so after subsetting to a realistic ~142-codepoint invoice charset every candidate embeds at only 33-65 KB per weight (IBM Plex ~33 KB, Source Sans ~54 KB, Carlito ~62 KB). **Ship the FULL static TTFs in `assets/` (Regular + Bold) and let fontkit subset at render** — pre-subsetting saves almost nothing and risks dropping glyphs needed for arbitrary customer/address text.

## 1. Recommendation: IBM Plex Sans (primary), Source Sans 3 (alternative)

### Measured full static TTF sizes (verified 2026-06-19)

| Family                 | Regular                    | Bold   | R+B total  | License                             | RFN          |
| ---------------------- | -------------------------- | ------ | ---------- | ----------------------------------- | ------------ |
| **IBM Plex Sans**      | 196 KB                     | 196 KB | **391 KB** | OFL-1.1                             | "Plex"       |
| Source Sans 3          | 421 KB                     | 418 KB | 839 KB     | OFL-1.1                             | "Source"     |
| Carlito                | 613 KB                     | 666 KB | 1,279 KB   | OFL-1.1                             | "Carlito"    |
| Noto Sans              | variable wdth,wght — large | —      | —          | OFL-1.1                             | "Noto"       |
| Liberation Sans (v2.x) | ~292 KB                    | —      | —          | OFL-1.1 (was GPL+exception pre-2.0) | "Liberation" |
| Inter                  | OFL-1.1                    | —      | —          | OFL-1.1                             | "Inter"      |

(Noto Sans on Google Fonts ships only as a `wdth,wght` variable font — 4,515 glyphs; would need a static instance. Inter is OFL-1.1 but its tall x-height is less classic for paper invoices.)

### Why IBM Plex Sans

- Smallest footprint in `assets/` by far (391 KB for both weights) → easiest on the <5 MB cap even before subsetting.
- Corporate/technical typeface; excellent legibility at small sizes in tables, clear digit/letter disambiguation (good for amounts, IBANs, tax IDs).
- 1,019 glyphs / 895 cmap codepoints — lean but complete for Latin business use.

### Why Source Sans 3 is the alternative

- More humanist/friendly, common in document design; 2,478 glyphs. Larger but trivial post-subset. Choose for a softer aesthetic.

**Avoid Carlito as primary** unless Calibri metric-compatibility is a hard requirement (it isn't for a fresh layout) — heaviest, no benefit. (Carlito = Calibri-metric, Caladea = Cambria-metric, both OFL-1.1.)

## 2. Glyph coverage (verified with fontTools cmap inspection)

For IBM Plex Sans, Source Sans 3, Carlito, and Noto Sans, ALL of the following are present in both Regular and Bold:

- German: ä ö ü Ä Ö Ü (U+00E4/F6/FC/C4/D6/DC), ß (U+00DF), capital sharp s ẞ (U+1E9E)
- € (U+20AC), § (U+00A7), ° (U+00B0), × (U+00D7)
- German quotes „ " " (U+201E/201C/201D), « » (U+00AB/BB)
- Dashes – — (U+2013/2014), bullet •, ellipsis …
- Broader EU Latin accents (é è ê ë à â ç ñ ò ó ô õ í ì î ï ú ù û)
  No missing glyphs in any tested family. IBM Plex Sans is the leanest but 100% covers the required set.

## 3. Subsetting strategy: ship FULL TTFs, let fontkit subset at embed time

```js
import { PDFDocument } from '@cantoo/pdf-lib'; // v2.7.1, the fork core uses
import fontkit from '@pdf-lib/fontkit'; // v1.1.1
const pdfDoc = await PDFDocument.create();
pdfDoc.registerFontkit(fontkit); // REQUIRED before embedFont
const fontBytes = await readFile('assets/fonts/IBMPlexSans-Regular.ttf');
const font = await pdfDoc.embedFont(fontBytes, { subset: true }); // embeds only used glyphs
```

`embedFont(..., { subset: true })` emits a PDF subset (standard `ABCDEF+IBMPlexSans` 6-letter tag). Satisfies PDF/A glyph-embedding.

### Measured embedded (subset) sizes — to a realistic 142-codepoint invoice charset

| Family            | Regular subset | Bold subset | R+B embedded |
| ----------------- | -------------- | ----------- | ------------ |
| **IBM Plex Sans** | 33.0 KB        | 33.1 KB     | **~66 KB**   |
| Source Sans 3     | 54.0 KB        | 53.9 KB     | ~108 KB      |
| Carlito           | 60.1 KB        | 64.9 KB     | ~125 KB      |

**Recommendation: vendor the FULL static TTFs in `assets/fonts/` and rely on fontkit's embed-time subsetting.**

- Bundle cost is the FULL TTF (391 KB for Plex R+B) — <8% of a 5 MB cap, negligible.
- PDF output cost is the SUBSET (~66 KB R+B for Plex) — pre-subsetting buys nothing for the shipped PDF.
- Pre-subsetting in `assets/` is risky: invoice content is arbitrary user text (foreign names/addresses, free-text line items) — could contain codepoints outside a guessed subset → tofu. Shipping the full TTF means any Latin/German glyph the user types is available, and fontkit subsets exactly what each document uses.

If you ever need to shave `assets/` further, run `pyftsubset --unicodes-file=...` to a Latin+German+symbols range as a build step — but unnecessary at IBM Plex's 391 KB.

## 4. License vendoring (OFL-1.1 obligations)

All recommended families are SIL OFL-1.1. To comply:

1. **Include the full `OFL.txt`** alongside the font files (ship as `assets/fonts/OFL.txt` or `LICENSE-IBMPlexSans.txt`).
2. **Retain the copyright + Reserved Font Name notice.** IBM Plex: `Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"`. Source: `Copyright 2010-2024 Adobe ... with Reserved Font Name 'Source'`. Carlito: `... with Reserved Font Name "Carlito"`.
3. **Reserved Font Name constraint:** OFL forbids distributing a _modified_ version under a name containing the RFN. fontkit's embed-time subset preserves the original `name` table (subset still reports "IBM Plex Sans"). Embedding into a PDF for rendering is the normal, intended use and is NOT the kind of redistribution the RFN clause targets. Stay clean: do NOT rename the embedded font to something containing the RFN, and do NOT distribute the subset TTF as a standalone font. Shipping the unmodified full TTF in `assets/` has no RFN issue.
4. OFL forbids selling the fonts by themselves — N/A (bundled in a tool).
5. Add an attribution line in NOTICE/README.

## Concrete files to vendor (verified HTTP-200 URLs)

**Primary — IBM Plex Sans (recommended):**

- `IBMPlexSans-Regular.ttf` → https://github.com/IBM/plex/raw/master/packages/plex-sans/fonts/complete/ttf/IBMPlexSans-Regular.ttf
- `IBMPlexSans-Bold.ttf` → https://github.com/IBM/plex/raw/master/packages/plex-sans/fonts/complete/ttf/IBMPlexSans-Bold.ttf
- `OFL.txt` → https://github.com/IBM/plex/raw/master/LICENSE.txt
- npm alternative: `@fontsource/ibm-plex-sans@5.2.8` (OFL-1.1) ships TTFs under `files/`.

**Alternative — Source Sans 3:**

- `SourceSans3-Regular.ttf` → https://github.com/adobe-fonts/source-sans/raw/release/TTF/SourceSans3-Regular.ttf
- `SourceSans3-Bold.ttf` → https://github.com/adobe-fonts/source-sans/raw/release/TTF/SourceSans3-Bold.ttf
- license → https://github.com/adobe-fonts/source-sans/raw/release/LICENSE.md

**If Calibri metric-compat required — Carlito (OFL-1.1, NOT Apache):**

- https://github.com/googlefonts/carlito/raw/main/fonts/ttf/Carlito-Regular.ttf
- https://github.com/googlefonts/carlito/raw/main/fonts/ttf/Carlito-Bold.ttf
- https://github.com/googlefonts/carlito/raw/main/OFL.txt
- (repo archived/read-only since 2024-05; pin a commit SHA.)

## Integration notes

- Stack: `@cantoo/pdf-lib@2.7.1` (MIT), `@pdf-lib/fontkit@1.1.1` (MIT). `@e-invoice-eu/core@3.1.1` depends on `@cantoo/pdf-lib ^2.6.5` → share one pdf-lib instance across visual-PDF and Factur-X paths.
- Always call `pdfDoc.registerFontkit(fontkit)` before any `embedFont`, else subsetting throws.
- Embed Regular and Bold as separate `embedFont` calls. For italic, embed a third file; do not synthesize italics for PDF/A correctness.
- Pure-data `.ttf` assets — no native runtime, compatible with Node-only / esbuild bundling.

## Decisions

- **Primary font: IBM Plex Sans (Regular + Bold), SIL OFL-1.1.**
- **Alternative (softer look): Source Sans 3 (Regular + Bold), OFL-1.1.**
- **Do NOT use Carlito as primary; if Calibri-metric is mandated, Carlito is OFL-1.1 (NOT Apache).**
- **Ship the FULL static TTFs and subset at embed time via fontkit (`{ subset: true }`).**
- **Vendor `OFL.txt` next to the fonts; keep the RFN copyright notice; never distribute the subset TTF standalone under the reserved name.**

## Packages

| name                      | version | license | purpose                                               |
| ------------------------- | ------- | ------- | ----------------------------------------------------- |
| @fontsource/ibm-plex-sans | 5.2.8   | OFL-1.1 | npm-pinned source of IBM Plex Sans TTFs for vendoring |
| @fontsource/source-sans-3 | 5.2.9   | OFL-1.1 | Source Sans 3 (alternative)                           |
| @fontsource/inter         | 5.2.8   | OFL-1.1 | Inter (candidate, not recommended)                    |
| @fontsource/noto-sans     | 5.2.10  | OFL-1.1 | Noto Sans (candidate; only variable on Google Fonts)  |
| @cantoo/pdf-lib           | 2.7.1   | MIT     | PDF generation + font embedding                       |
| @pdf-lib/fontkit          | 1.1.1   | MIT     | fontkit adapter; enables embed-time subsetting        |
| @e-invoice-eu/core        | 3.1.1   | WTFPL   | EN16931 engine; depends on @cantoo/pdf-lib ^2.6.5     |

## Risks

- RFN compliance: fontkit's subset preserves the original name table. Fine for PDF embedding; do not distribute the subset `.ttf` standalone under the reserved name.
- pdf-lib docs note `{ subset: true }` "does not work for all fonts." IBM Plex / Source Sans / Carlito subset cleanly in fonttools testing, but validate the actual fontkit subset against veraPDF (PDF/A-3 glyph embedding) in CI before shipping.
- @e-invoice-eu/core is WTFPL — confirm acceptable for distribution.
- Pre-subsetting to a fixed charset risks tofu for non-German EU customer names (Polish/Czech/Turkish diacritics). Ship the full TTF to avoid this.
- Carlito repo archived since 2024-05 — pin a commit SHA if used.

## Citations

- https://github.com/IBM/plex
- https://github.com/IBM/plex/raw/master/LICENSE.txt
- https://github.com/adobe-fonts/source-sans
- https://github.com/adobe-fonts/source-sans/raw/release/LICENSE.md
- https://github.com/googlefonts/carlito
- https://github.com/googlefonts/carlito/raw/main/OFL.txt
- https://github.com/liberationfonts/liberation-fonts
- https://github.com/Hopding/pdf-lib
- https://www.npmjs.com/package/@cantoo/pdf-lib
- https://www.npmjs.com/package/@pdf-lib/fontkit
- https://www.npmjs.com/package/@e-invoice-eu/core
- https://www.npmjs.com/package/@fontsource/ibm-plex-sans
- https://fonts.google.com/specimen/Carlito
- https://scripts.sil.org/OFL
