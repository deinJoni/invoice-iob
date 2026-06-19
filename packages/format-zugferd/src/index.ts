/**
 * @invoice-iob/format-zugferd — the `ZUGFERD` / `FACTUR-X` provider: a hybrid PDF/A-3. We render
 * the visual PDF ourselves (@invoice-iob/pdf-renderer) and hand it to @e-invoice-eu/core, which
 * embeds the CII XML as the `factur-x.xml` Associated File and assembles the PDF/A-3 wrapper
 * (OutputIntent + sRGB ICC + XMP). Default profile: EN 16931 (Comfort).
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
import { generateFacturX, type FacturXFormat } from '@invoice-iob/engine-e-invoice-eu';
import { renderInvoicePdf, type Locale } from '@invoice-iob/pdf-renderer';

const PROFILES: Record<string, FacturXFormat> = {
  EN16931: 'Factur-X-EN16931',
  'EN 16931': 'Factur-X-EN16931',
  COMFORT: 'Factur-X-EN16931',
  BASIC: 'Factur-X-Basic',
  EXTENDED: 'Factur-X-Extended',
  XRECHNUNG: 'Factur-X-XRechnung',
};

/** Resolve a friendly profile name to the engine's Factur-X format; defaults to EN 16931. */
function resolveProfile(profile: string | undefined): FacturXFormat {
  if (!profile) return 'Factur-X-EN16931';
  return PROFILES[profile.trim().toUpperCase()] ?? 'Factur-X-EN16931';
}

function localeFromLang(lang: string | undefined): Locale | undefined {
  const l = lang?.toLowerCase();
  if (!l) return undefined;
  if (l.startsWith('de')) return 'de';
  if (l.startsWith('en')) return 'en';
  return undefined;
}

export const zugferdProvider: FormatProvider = {
  meta: {
    id: 'zugferd',
    aliases: ['factur-x', 'facturx'],
    label: 'ZUGFeRD / Factur-X (hybrid PDF/A-3)',
    country: 'DE',
    standard: 'EN 16931 (ZUGFeRD 2.x / Factur-X 1.0)',
    syntax: 'hybrid',
    outputKind: 'hybrid',
    profiles: ['EN16931', 'BASIC', 'EXTENDED', 'XRECHNUNG'],
    defaultProfile: 'EN16931',
    fileExtension: 'pdf',
    mimeType: 'application/pdf',
    bundleable: true,
  },
  validate(model: CanonicalInvoice): ValidationResult {
    return validationResult(baseEn16931Issues(model));
  },
  async render(model: CanonicalInvoice, options: RenderOptions): Promise<RenderedArtifact> {
    const locale = localeFromLang(options.lang);
    const visualPdf = await renderInvoicePdf(model, locale ? { locale } : {});
    const profile = resolveProfile(options.profile);
    const bytes = await generateFacturX(model, {
      profile,
      pdf: visualPdf,
      ...(options.lang ? { lang: options.lang } : {}),
      pdfFilename: `${model.invoiceNumber}.pdf`,
    });
    return { bytes, mimeType: 'application/pdf', extension: 'pdf' };
  },
};

/** Register the ZUGFeRD/Factur-X hybrid provider into a registry. */
export function register(registry: FormatRegistry): void {
  registry.register(zugferdProvider);
}
