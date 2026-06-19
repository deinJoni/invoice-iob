/**
 * @invoice-iob/format-facturx-fr — the French `factur-x-fr` provider: a Factur-X hybrid PDF/A-3,
 * the national e-invoice standard for France (Factur-X is the Franco-German twin of ZUGFeRD, and
 * @e-invoice-eu/core already emits it). France is therefore mostly LOCALIZATION + French
 * identifiers + French business rules + a French template — NOT a new engine.
 *
 * We render the visual PDF ourselves in French (@invoice-iob/pdf-renderer, locale "fr") and hand it
 * to the engine, which embeds the CII XML as `factur-x.xml` and assembles the PDF/A-3 wrapper.
 * `validate()` layers French rules (valid SIREN/SIRET with checksum, French TVA rates, mandatory
 * mentions) on top of the shared EN 16931 pre-flight — see `rules.ts`. Default profile:
 * EN 16931 (Comfort), the lowest Factur-X profile that fully covers EN 16931.
 *
 * Carrying the identifiers needs ZERO France-specific core code: SIREN rides the generic legal
 * registration id (BT-30/BT-47, scheme "0002") and SIRET the generic party identifier
 * (BT-29/BT-46, scheme "0009") — both serialized generically by the engine adapter. The only core
 * change France needed was the generic `cac:PartyIdentification` emitter. See docs/research/france.md.
 */
import type {
  CanonicalInvoice,
  FormatProvider,
  FormatRegistry,
  RenderOptions,
  RenderedArtifact,
  ValidationResult,
} from '@invoice-iob/core';
import { generateFacturX } from '@invoice-iob/engine-e-invoice-eu';
import { renderInvoicePdf } from '@invoice-iob/pdf-renderer';
import {
  FACTURX_FR_META,
  frLegalNotes,
  mapFrExtensions,
  resolveProfile,
  validateFr,
} from './rules.ts';

export {
  frIssues,
  isValidSiren,
  isValidSiret,
  luhnValid,
  resolveProfile,
  validateFr,
  FACTURX_FR_META,
} from './rules.ts';

export const facturxFrProvider: FormatProvider = {
  meta: FACTURX_FR_META,

  validate(model: CanonicalInvoice): ValidationResult {
    return validateFr(model);
  },

  async render(model: CanonicalInvoice, options: RenderOptions): Promise<RenderedArtifact> {
    const visualPdf = await renderInvoicePdf(model, {
      locale: 'fr',
      legalNotes: frLegalNotes(model),
    });
    const profile = resolveProfile(options.profile);
    const bytes = await generateFacturX(model, {
      profile,
      pdf: visualPdf,
      lang: options.lang ?? 'fr-FR',
      pdfFilename: `${model.invoiceNumber}.pdf`,
    });
    return { bytes, mimeType: 'application/pdf', extension: 'pdf' };
  },

  mapExtensions(input: unknown): Record<string, unknown> {
    return mapFrExtensions(input);
  },
};

/** Register the French Factur-X provider into a registry. */
export function register(registry: FormatRegistry): void {
  registry.register(facturxFrProvider);
}
