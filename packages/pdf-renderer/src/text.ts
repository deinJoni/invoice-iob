import type { PDFFont } from '@cantoo/pdf-lib';

/**
 * Code points our embedded IBM Plex Sans is overwhelmingly likely to cover: tab/newline, space
 * through Latin Extended-B (0x20-0x24F), the Euro sign (0x20AC), and common typographic
 * punctuation (0x2010-0x2027, 0x2030-0x205E). Anything else is replaced so `drawText` can never
 * throw on an unencodable glyph from arbitrary user input.
 */
function isAllowed(cp: number): boolean {
  return (
    cp === 0x09 ||
    cp === 0x0a ||
    (cp >= 0x20 && cp <= 0x24f) ||
    cp === 0x20ac ||
    (cp >= 0x2010 && cp <= 0x2027) ||
    (cp >= 0x2030 && cp <= 0x205e)
  );
}

/** Replace characters outside the safe set with '?'. */
export function sanitize(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    out += isAllowed(cp) ? ch : '?';
  }
  return out;
}

/** Greedy word-wrap to a max width; hard-splits words longer than the line. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const rawLine of sanitize(text).split('\n')) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let cur = '';
    for (const w of words) {
      const trial = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
        cur = trial;
      } else if (!cur) {
        // Single word wider than the line - hard-split by character.
        let chunk = '';
        for (const ch of w) {
          if (font.widthOfTextAtSize(chunk + ch, size) <= maxWidth) {
            chunk += ch;
          } else {
            if (chunk) out.push(chunk);
            chunk = ch;
          }
        }
        cur = chunk;
      } else {
        out.push(cur);
        cur = w;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}
