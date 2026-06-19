/**
 * @invoice-iob/format-pdf — the `PDF` provider: a human-readable visual invoice, rendered from
 * the canonical model (amounts are never recomputed). Locale-driven labels (DE/EN).
 */
import {
  baseEn16931Issues,
  validationResult,
  type CanonicalInvoice,
  type FormatProvider,
  type FormatRegistry,
  type RenderOptions,
  type RenderedArtifact,
  type ValidationResult,
} from '@invoice-iob/core';
import { renderInvoicePdf, type Locale } from '@invoice-iob/pdf-renderer';

function localeFromLang(lang: string | undefined): Locale | undefined {
  const l = lang?.toLowerCase();
  if (!l) return undefined;
  if (l.startsWith('de')) return 'de';
  if (l.startsWith('fr')) return 'fr';
  if (l.startsWith('en')) return 'en';
  return undefined;
}

export const pdfProvider: FormatProvider = {
  meta: {
    id: 'pdf',
    label: 'Visual PDF',
    country: 'EU',
    standard: 'Visual document (EN 16931 fields; DE §14 UStG)',
    syntax: 'PDF',
    outputKind: 'pdf',
    fileExtension: 'pdf',
    mimeType: 'application/pdf',
    bundleable: true,
  },
  validate(model: CanonicalInvoice): ValidationResult {
    return validationResult(baseEn16931Issues(model));
  },
  async render(model: CanonicalInvoice, options: RenderOptions): Promise<RenderedArtifact> {
    const locale = localeFromLang(options.lang);
    const bytes = await renderInvoicePdf(model, locale ? { locale } : {});
    return { bytes, mimeType: 'application/pdf', extension: 'pdf' };
  },
};

/** Register the visual-PDF provider into a registry. */
export function register(registry: FormatRegistry): void {
  registry.register(pdfProvider);
}
