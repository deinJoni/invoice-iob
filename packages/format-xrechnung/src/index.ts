/**
 * @invoice-iob/format-xrechnung — XRechnung 3.0 CIUS providers (UBL & CII syntax) with the
 * German BR-DE-* business rules layered on top of the generic EN 16931 checks.
 */
import {
  baseEn16931Issues,
  validationResult,
  type CanonicalInvoice,
  type FormatMeta,
  type FormatProvider,
  type FormatRegistry,
  type RenderOptions,
  type RenderedArtifact,
  type ValidationIssue,
  type ValidationResult,
} from '@invoice-iob/core';
import { generateXml, type XmlFormat } from '@invoice-iob/engine-e-invoice-eu';

const STANDARD = 'EN 16931 CIUS — XRechnung 3.0';

function xmlArtifact(xml: string): RenderedArtifact {
  return { bytes: new TextEncoder().encode(xml), mimeType: 'application/xml', extension: 'xml' };
}

/** German CIUS rules that go beyond generic EN 16931 (subset; full set enforced by KoSIT in CI). */
export function brDeIssues(model: CanonicalInvoice): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (message: string, rule: string): void => {
    issues.push({ severity: 'error', message, rule });
  };
  const warn = (message: string, rule: string): void => {
    issues.push({ severity: 'warning', message, rule });
  };

  // BR-DE-15: Buyer reference (BT-10) is mandatory.
  if (!model.buyerReference) {
    error('Buyer reference / Leitweg-ID (BT-10) is mandatory for XRechnung.', 'BR-DE-15');
  }

  // BR-DE-5/6/7: Seller contact point with name, telephone and email (BG-6) is mandatory.
  if (!model.seller.contactName)
    error('Seller contact point name (BT-41) is mandatory for XRechnung.', 'BR-DE-5');
  if (!model.seller.contactPhone)
    error('Seller contact telephone (BT-42) is mandatory for XRechnung.', 'BR-DE-6');
  if (!model.seller.contactEmail)
    error('Seller contact email (BT-43) is mandatory for XRechnung.', 'BR-DE-7');

  // BR-DE-16: seller must carry a VAT id or tax registration (also covered by BR-S-02 generically).
  if (!model.seller.vatId && !model.seller.taxNumber)
    error('Seller VAT identifier (BT-31) or tax registration (BT-32) is mandatory.', 'BR-DE-16');

  // Payment hygiene: SEPA credit transfer should carry an IBAN.
  const meansCode = model.payment?.meansCode ?? '58';
  if (meansCode === '58' && !model.payment?.iban)
    warn('A SEPA credit transfer (means code 58) should include an IBAN (BT-84).', 'BR-DE-1');

  return issues;
}

function makeProvider(args: {
  id: string;
  label: string;
  syntax: 'UBL' | 'CII';
  format: XmlFormat;
}): FormatProvider {
  const meta: FormatMeta = {
    id: args.id,
    label: args.label,
    country: 'DE',
    standard: STANDARD,
    syntax: args.syntax,
    outputKind: 'xml',
    fileExtension: 'xml',
    mimeType: 'application/xml',
    bundleable: true,
  };
  return {
    meta,
    validate(model: CanonicalInvoice): ValidationResult {
      return validationResult([...baseEn16931Issues(model), ...brDeIssues(model)]);
    },
    async render(model: CanonicalInvoice, options: RenderOptions): Promise<RenderedArtifact> {
      return xmlArtifact(await generateXml(model, args.format, { lang: options.lang ?? 'de-de' }));
    },
  };
}

export const xrechnungCiiProvider = makeProvider({
  id: 'xrechnung-cii',
  label: 'XRechnung 3.0 (CII)',
  syntax: 'CII',
  format: 'XRECHNUNG-CII',
});

export const xrechnungUblProvider = makeProvider({
  id: 'xrechnung-ubl',
  label: 'XRechnung 3.0 (UBL)',
  syntax: 'UBL',
  format: 'XRECHNUNG-UBL',
});

/** Register both XRechnung providers into a registry. */
export function register(registry: FormatRegistry): void {
  registry.register(xrechnungCiiProvider);
  registry.register(xrechnungUblProvider);
}
