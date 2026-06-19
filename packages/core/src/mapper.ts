/**
 * Input mapper: friendly input → {@link CanonicalInvoice}, computing VAT breakdown and all
 * document totals so renderers never recompute amounts (PRD §6.4). All money math goes through
 * integer cents (see `money.ts`) so the EN 16931 BR-CO-* equalities hold to the cent.
 */
import { createInvoiceSchema, type CreateInvoiceInput, type PartyInput } from './input.ts';
import { InvoiceInputError } from './errors.ts';
import { fromCents, lineNetCents, vatCents } from './money.ts';
import type {
  CanonicalInvoice,
  DocumentTotals,
  InvoiceLine,
  Party,
  VatBreakdownEntry,
  VatCategoryCode,
} from './model.ts';

/** Default exemption reason text/code for non-standard, non-zero VAT categories (EN 16931 BT-120/121). */
const DEFAULT_EXEMPTION: Partial<Record<VatCategoryCode, { code?: string; reason: string }>> = {
  AE: { code: 'VATEX-EU-AE', reason: 'Reverse charge' },
  K: { code: 'VATEX-EU-IC', reason: 'Intra-Community supply' },
  G: { code: 'VATEX-EU-G', reason: 'Export outside the EU' },
  E: { reason: 'Exempt from VAT' },
  O: { reason: 'Not subject to VAT' },
};

/** Categories that require an exemption reason (BT-120) and carry a 0 % rate. */
function requiresExemptionReason(category: VatCategoryCode): boolean {
  return category !== 'S' && category !== 'Z';
}

function mapParty(p: PartyInput): Party {
  return {
    name: p.name,
    tradingName: p.tradingName,
    vatId: p.vatId,
    taxNumber: p.taxNumber,
    address: {
      line1: p.address.line1,
      line2: p.address.line2,
      city: p.address.city,
      postalCode: p.address.postalCode,
      countrySubdivision: p.address.countrySubdivision,
      countryCode: p.address.countryCode,
    },
    contactName: p.contactName,
    contactEmail: p.contactEmail,
    contactPhone: p.contactPhone,
    electronicAddress: p.electronicAddress,
    legalRegistrationId: p.legalRegistrationId,
  };
}

/** Build the canonical invoice from already-validated friendly input. */
export function mapToCanonical(input: CreateInvoiceInput): CanonicalInvoice {
  // 1. Lines + per-line net amount in cents.
  const lineData = input.lines.map((li, idx) => {
    const baseQuantity = li.baseQuantity ?? 1;
    const cents = lineNetCents(li.quantity, li.netUnitPrice, baseQuantity);
    const line: InvoiceLine = {
      id: String(idx + 1),
      name: li.name,
      description: li.description,
      quantity: li.quantity,
      unitCode: li.unitCode,
      netUnitPrice: li.netUnitPrice,
      baseQuantity,
      vatCategory: li.vatCategory,
      vatRate: li.vatRate,
      lineNetAmount: fromCents(cents),
      sellerItemId: li.sellerItemId,
      buyerItemId: li.buyerItemId,
    };
    return { line, cents, exemptionReason: li.vatExemptionReason };
  });

  // 2. Group lines by (category, rate) → VAT breakdown.
  interface Group {
    category: VatCategoryCode;
    rate: number;
    taxableCents: number;
    reason?: string;
  }
  const groups = new Map<string, Group>();
  for (const { line, cents, exemptionReason } of lineData) {
    const key = `${line.vatCategory}:${line.vatRate}`;
    const g = groups.get(key) ?? { category: line.vatCategory, rate: line.vatRate, taxableCents: 0 };
    g.taxableCents += cents;
    if (!g.reason && exemptionReason) g.reason = exemptionReason;
    groups.set(key, g);
  }

  const vatBreakdown: VatBreakdownEntry[] = [];
  let totalTaxCents = 0;
  for (const g of groups.values()) {
    const taxCents = vatCents(g.taxableCents, g.rate);
    totalTaxCents += taxCents;
    const entry: VatBreakdownEntry = {
      category: g.category,
      rate: g.rate,
      taxableAmount: fromCents(g.taxableCents),
      taxAmount: fromCents(taxCents),
    };
    if (requiresExemptionReason(g.category)) {
      const def = DEFAULT_EXEMPTION[g.category];
      const reason = g.reason ?? def?.reason;
      if (reason) entry.exemptionReason = reason;
      if (def?.code) entry.exemptionReasonCode = def.code;
    }
    vatBreakdown.push(entry);
  }

  // 3. Document totals (no doc-level allowances/charges/prepaid in the MVP).
  const lineExtensionCents = lineData.reduce((sum, x) => sum + x.cents, 0);
  const taxExclusiveCents = lineExtensionCents;
  const taxInclusiveCents = taxExclusiveCents + totalTaxCents;
  const totals: DocumentTotals = {
    lineExtensionAmount: fromCents(lineExtensionCents),
    taxExclusiveAmount: fromCents(taxExclusiveCents),
    taxAmount: fromCents(totalTaxCents),
    taxInclusiveAmount: fromCents(taxInclusiveCents),
    payableAmount: fromCents(taxInclusiveCents),
  };

  return {
    invoiceNumber: input.invoiceNumber,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    typeCode: input.typeCode,
    currency: input.currency,
    buyerReference: input.buyerReference,
    notes: input.note ? [input.note] : undefined,
    orderReference: input.orderReference,
    seller: mapParty(input.seller),
    buyer: mapParty(input.buyer),
    delivery: input.delivery,
    payment: input.payment,
    lines: lineData.map((x) => x.line),
    vatBreakdown,
    totals,
    extensions: input.extensions ?? {},
  };
}

/** Validate raw friendly input (zod) and map it to the canonical model. Throws InvoiceInputError. */
export function parseAndMap(raw: unknown): CanonicalInvoice {
  const parsed = createInvoiceSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.map(String).join('.') || '(root)',
      message: i.message,
    }));
    throw new InvoiceInputError('Invalid invoice input.', issues);
  }
  return mapToCanonical(parsed.data);
}
