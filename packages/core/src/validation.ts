/**
 * Lightweight EN 16931 pre-flight checks shared by providers. This is NOT the authoritative
 * validator (KoSIT/veraPDF run in CI) — it catches the common, high-value rule violations early
 * so `create_invoice` returns a clear error instead of emitting an invoice that fails downstream.
 */
import type { CanonicalInvoice } from './model.ts';
import type { ValidationIssue } from './provider.ts';

/** Common EN 16931 business-rule checks applicable to every format. */
export function baseEn16931Issues(model: CanonicalInvoice): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (message: string, rule?: string): void => {
    issues.push(rule ? { severity: 'error', message, rule } : { severity: 'error', message });
  };

  if (!model.seller.name) error('Seller name (BT-27) is required.', 'BR-06');
  if (!model.seller.address?.countryCode)
    error('Seller country code (BT-40) is required.', 'BR-09');
  if (!model.buyer.name) error('Buyer name (BT-44) is required.', 'BR-07');
  if (!model.buyer.address?.countryCode) error('Buyer country code (BT-55) is required.', 'BR-11');
  if (model.lines.length === 0) error('At least one invoice line (BG-25) is required.', 'BR-16');

  // BR-S-02: a standard-rated invoice requires a seller VAT id or tax registration.
  const hasStandard = model.vatBreakdown.some((v) => v.category === 'S');
  if (hasStandard && !model.seller.vatId && !model.seller.taxNumber) {
    error(
      'A standard-rated invoice requires the seller VAT identifier (BT-31) or tax registration (BT-32).',
      'BR-S-02',
    );
  }

  // Non-standard, non-zero categories need an exemption reason (BR-E/AE/IC/G/O-10).
  for (const v of model.vatBreakdown) {
    if (v.category !== 'S' && v.category !== 'Z' && !v.exemptionReason && !v.exemptionReasonCode) {
      error(`VAT category ${v.category} requires an exemption reason (BT-120/BT-121).`);
    }
  }

  return issues;
}
