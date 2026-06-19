import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument, PDFFont } from '@cantoo/pdf-lib';
// Inlined as Uint8Array by esbuild's binary loader (see scripts/build.mjs).
import regularBytes from '../../../assets/fonts/IBMPlexSans-Regular.ttf';
import boldBytes from '../../../assets/fonts/IBMPlexSans-Bold.ttf';

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/**
 * Subset-embed IBM Plex Sans (Regular + Bold) into the document. PDF/A forbids the standard-14
 * fonts, so the visual PDF must carry real embedded fonts; `{ subset: true }` keeps only the
 * glyphs actually used. Requires fontkit to be registered first.
 */
export async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const [regular, bold] = await Promise.all([
    doc.embedFont(regularBytes, { subset: true }),
    doc.embedFont(boldBytes, { subset: true }),
  ]);
  return { regular, bold };
}
