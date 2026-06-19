/**
 * @invoice-iob/format-ubl-cii — generic EN 16931 providers (UBL and CII syntax, EU-wide).
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
import { generateXml, type XmlFormat } from '@invoice-iob/engine-e-invoice-eu';

function xmlArtifact(xml: string): RenderedArtifact {
  return { bytes: new TextEncoder().encode(xml), mimeType: 'application/xml', extension: 'xml' };
}

function makeProvider(args: {
  id: string;
  label: string;
  syntax: 'UBL' | 'CII';
  format: XmlFormat;
}): FormatProvider {
  return {
    meta: {
      id: args.id,
      label: args.label,
      country: 'EU',
      standard: 'EN 16931',
      syntax: args.syntax,
      outputKind: 'xml',
      fileExtension: 'xml',
      mimeType: 'application/xml',
      bundleable: true,
    },
    validate(model: CanonicalInvoice): ValidationResult {
      return validationResult(baseEn16931Issues(model));
    },
    async render(model: CanonicalInvoice, options: RenderOptions): Promise<RenderedArtifact> {
      return xmlArtifact(await generateXml(model, args.format, { lang: options.lang }));
    },
  };
}

export const ublProvider = makeProvider({
  id: 'ubl',
  label: 'UBL (EN 16931)',
  syntax: 'UBL',
  format: 'UBL',
});

export const ciiProvider = makeProvider({
  id: 'cii',
  label: 'UN/CEFACT CII (EN 16931)',
  syntax: 'CII',
  format: 'CII',
});

/** Register the UBL and CII providers into a registry. */
export function register(registry: FormatRegistry): void {
  registry.register(ublProvider);
  registry.register(ciiProvider);
}
