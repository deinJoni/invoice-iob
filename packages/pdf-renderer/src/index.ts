/**
 * @invoice-iob/pdf-renderer — template-driven visual invoice PDF (pure JS, @cantoo/pdf-lib +
 * subset-embedded IBM Plex Sans). Produces a PDF/A-amenable source PDF from the canonical model;
 * the ZUGFeRD/Factur-X provider (P2) feeds this PDF to the engine for PDF/A-3 assembly.
 */
export { renderInvoicePdf } from './render.ts';
export type { RenderPdfOptions } from './render.ts';
export type { Locale } from './theme.ts';
