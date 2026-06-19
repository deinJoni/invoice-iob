/**
 * Friendly input — the simple, typed fields the `create_invoice` tool accepts. A typed core
 * plus an open `extensions` area so country-specific fields can be added by a provider without
 * breaking the core schema. The mapper (`mapper.ts`) turns this into a {@link CanonicalInvoice},
 * computing all VAT and totals.
 *
 * Schemas use zod v4 (`zod/v4`). The raw *shapes* are exported for the MCP SDK's
 * `registerTool({ inputSchema })`, which wants a `ZodRawShape`, not a `z.object()`.
 */
import * as z from 'zod/v4';

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date (YYYY-MM-DD)');

const VAT_CATEGORY = z.enum(['S', 'Z', 'E', 'AE', 'K', 'G', 'O', 'L', 'M']);

export const addressShape = {
  line1: z.string().optional().describe('Street and house number'),
  line2: z.string().optional().describe('Additional address line'),
  city: z.string().min(1).describe('City'),
  postalCode: z.string().optional().describe('Postal / ZIP code'),
  countrySubdivision: z.string().optional().describe('Region / state'),
  countryCode: z.string().length(2).describe('ISO 3166-1 alpha-2 country code, e.g. "DE"'),
};
export const addressSchema = z.object(addressShape);

export const electronicAddressSchema = z.object({
  scheme: z.string().describe('EAS scheme id, e.g. "EM" for email or "0204" for DE Leitweg'),
  value: z.string(),
});

export const partyShape = {
  name: z.string().min(1).describe('Legal/registered name'),
  tradingName: z.string().optional(),
  vatId: z.string().optional().describe('VAT identification number (USt-IdNr), e.g. "DE123456789"'),
  taxNumber: z.string().optional().describe('Tax registration number (Steuernummer)'),
  address: addressSchema,
  contactName: z.string().optional(),
  contactEmail: z.string().optional(),
  contactPhone: z.string().optional(),
  electronicAddress: electronicAddressSchema.optional(),
  legalRegistrationId: z
    .object({ scheme: z.string().optional(), value: z.string() })
    .optional()
    .describe('Legal registration id (e.g. Handelsregister number) + optional scheme'),
};
export const partySchema = z.object(partyShape);

export const lineItemSchema = z.object({
  name: z.string().min(1).describe('Item / service name'),
  description: z.string().optional(),
  quantity: z.number().positive().describe('Invoiced quantity'),
  unitCode: z
    .string()
    .default('C62')
    .describe('UN/ECE Rec 20 unit code (C62=unit, HUR=hour, DAY=day, KGM=kg, MTR=metre)'),
  netUnitPrice: z.number().describe('Net price per (base) unit, excluding VAT'),
  baseQuantity: z.number().positive().optional().describe('Base quantity for the unit price (default 1)'),
  vatRate: z.number().min(0).max(100).describe('VAT rate as a percentage, e.g. 19'),
  vatCategory: VAT_CATEGORY.default('S').describe(
    'VAT category: S=standard, Z=zero, E=exempt, AE=reverse charge, K=intra-EU, G=export, O=out of scope',
  ),
  vatExemptionReason: z
    .string()
    .optional()
    .describe('Required free-text reason when category is not S/Z (e.g. "Reverse charge")'),
  sellerItemId: z.string().optional(),
  buyerItemId: z.string().optional(),
});

export const paymentSchema = z.object({
  meansCode: z
    .string()
    .optional()
    .describe('Payment means code (UNCL4461): 58=SEPA credit transfer, 30=credit transfer'),
  iban: z.string().optional(),
  bic: z.string().optional(),
  accountName: z.string().optional(),
  reference: z.string().optional().describe('Remittance information / payment reference'),
  terms: z.string().optional().describe('Free-text payment terms, e.g. "Net 14 days"'),
});

export const deliverySchema = z.object({
  date: DATE.optional().describe('Actual delivery date (Lieferdatum)'),
  periodStart: DATE.optional(),
  periodEnd: DATE.optional(),
});

/** Raw shape for the MCP `create_invoice` tool. */
export const createInvoiceShape = {
  format: z
    .string()
    .describe(
      'Output format id. Launch set: XRECHNUNG-CII, XRECHNUNG-UBL, UBL, CII. Call list_formats for all available formats.',
    ),
  profile: z.string().optional().describe('Optional profile for hybrid formats (default per format)'),
  invoiceNumber: z.string().min(1).describe('Invoice number (BT-1)'),
  issueDate: DATE.describe('Issue date YYYY-MM-DD (BT-2)'),
  dueDate: DATE.optional().describe('Payment due date YYYY-MM-DD (BT-9)'),
  typeCode: z.string().default('380').describe('Invoice type code (UNCL1001); 380 = commercial invoice'),
  currency: z.string().length(3).default('EUR').describe('ISO 4217 document currency (BT-5)'),
  buyerReference: z
    .string()
    .optional()
    .describe('Buyer reference / Leitweg-ID (BT-10). Mandatory for XRechnung.'),
  note: z.string().optional().describe('Free-text note (BT-22)'),
  orderReference: z.string().optional().describe('Purchase order reference (BT-13)'),
  seller: partySchema.describe('Seller / supplier (BG-4)'),
  buyer: partySchema.describe('Buyer / customer (BG-7)'),
  delivery: deliverySchema.optional(),
  payment: paymentSchema.optional(),
  lines: z.array(lineItemSchema).min(1).describe('Invoice line items (>= 1)'),
  extensions: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Country/format-specific fields outside the EN 16931 core'),
};

export const createInvoiceSchema = z.object(createInvoiceShape);
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type LineItemInput = z.infer<typeof lineItemSchema>;
export type PartyInput = z.infer<typeof partySchema>;
