/**
 * Canonical invoice model — the single source of truth.
 *
 * A normalized, semantic representation based on the EN 16931 business-term model
 * (BT-/BG- codes referenced inline). Every friendly input maps INTO this model
 * (see `mapper.ts`); every output renders FROM it (see `FormatProvider`). This is
 * what guarantees XML ↔ PDF consistency: renderers must never recompute amounts.
 *
 * It holds a typed EN 16931 core plus an open `extensions` bag for country-specific
 * fields outside EN 16931 (e.g. Italian SdI codes, Spanish Facturae specifics).
 */

/** ISO 3166-1 alpha-2 country code, e.g. "DE". */
export type CountryCode = string;
/** ISO 4217 currency code, e.g. "EUR". */
export type CurrencyCode = string;

/**
 * EN 16931 VAT category codes (UNCL5305 subset).
 * S=standard, Z=zero-rated, E=exempt, AE=reverse charge, K=intra-community supply,
 * G=export outside EU, O=out of scope, L=Canary Islands IGIC, M=Ceuta/Melilla IPSI.
 */
export type VatCategoryCode = 'S' | 'Z' | 'E' | 'AE' | 'K' | 'G' | 'O' | 'L' | 'M';

/** BG-5 / BG-8 postal address. */
export interface PostalAddress {
  line1?: string; // BT-35 / BT-50
  line2?: string; // BT-36 / BT-51
  city: string; // BT-37 / BT-52
  postalCode?: string; // BT-38 / BT-53
  countrySubdivision?: string; // BT-39 / BT-54 (region/state)
  countryCode: CountryCode; // BT-40 / BT-55 (mandatory)
}

/** Electronic address (BT-34 seller / BT-49 buyer) with its EAS scheme id. */
export interface ElectronicAddress {
  /** EAS code list value, e.g. "EM" (email), "9930" (DE Leitweg routing), "0204" (DE Leitweg). */
  scheme: string;
  value: string;
}

/**
 * An additional party identifier (BT-29 seller / BT-46 buyer) with an optional ICD scheme id.
 * Generic across countries: e.g. French SIRET ({@link scheme} "0009"), GLN ("0088"). This is the
 * EN 16931 *Seller/Buyer identifier*, distinct from the legal-registration id (BT-30/BT-47) and the
 * VAT id (BT-31/BT-48).
 */
export interface PartyIdentifier {
  /** Scheme id from the EN 16931 ICD list, e.g. "0009" (FR SIRET), "0088" (GLN). Omit for a bare id. */
  scheme?: string;
  value: string;
}

/** A trading party (seller BG-4 / buyer BG-7). */
export interface Party {
  name: string; // BT-27 seller / BT-44 buyer — legal registration name
  tradingName?: string; // BT-28 / BT-45
  vatId?: string; // BT-31 seller VAT id / BT-48 buyer VAT id (USt-IdNr)
  taxNumber?: string; // BT-32 seller tax registration id (Steuernummer)
  address: PostalAddress;
  contactName?: string; // BT-41 / BT-56
  contactEmail?: string; // BT-43 / BT-58
  contactPhone?: string; // BT-42 / BT-57
  electronicAddress?: ElectronicAddress;
  legalRegistrationId?: { scheme?: string; value: string }; // BT-30 / BT-47 (e.g. FR SIREN @ scheme 0002)
  identifiers?: PartyIdentifier[]; // BT-29 seller / BT-46 buyer (e.g. FR SIRET @ scheme 0009)
}

/** A single invoice line (BG-25). `lineNetAmount` is computed by the mapper. */
export interface InvoiceLine {
  id: string; // BT-126
  name: string; // BT-153 item name
  description?: string; // BT-154
  quantity: number; // BT-129 invoiced quantity
  unitCode: string; // BT-130 unit of measure (UN/ECE Rec 20, e.g. HUR, DAY, KGM, C62)
  netUnitPrice: number; // BT-146 item net price (per base quantity)
  baseQuantity: number; // BT-149 (defaults to 1)
  vatCategory: VatCategoryCode; // BT-151
  vatRate: number; // BT-152 percentage (e.g. 19 for 19 %)
  lineNetAmount: number; // BT-131 computed = round(quantity / baseQuantity * netUnitPrice)
  sellerItemId?: string; // BT-155
  buyerItemId?: string; // BT-156
}

/** VAT breakdown entry per (category, rate) — BG-23. Computed by the mapper. */
export interface VatBreakdownEntry {
  category: VatCategoryCode; // BT-118
  rate: number; // BT-119 percentage
  taxableAmount: number; // BT-116
  taxAmount: number; // BT-117
  exemptionReasonCode?: string; // BT-121 (VATEX code)
  exemptionReason?: string; // BT-120 free text
}

/** Document-level monetary totals (BG-22). All computed by the mapper. */
export interface DocumentTotals {
  lineExtensionAmount: number; // BT-106 sum of line net amounts
  allowanceTotalAmount?: number; // BT-107
  chargeTotalAmount?: number; // BT-108
  taxExclusiveAmount: number; // BT-109
  taxAmount: number; // BT-110 total VAT in document currency
  taxInclusiveAmount: number; // BT-112
  prepaidAmount?: number; // BT-113
  roundingAmount?: number; // BT-114
  payableAmount: number; // BT-115
}

/** Payment instructions (BG-16) + terms (BT-20). */
export interface PaymentDetails {
  meansCode?: string; // BT-81 payment means type code (UNCL4461), e.g. "58" SEPA credit transfer, "30" credit transfer
  iban?: string; // BT-84 payment account id
  bic?: string; // BT-86
  accountName?: string; // BT-85
  reference?: string; // BT-83 remittance information
  terms?: string; // BT-20 payment terms text
}

/** Delivery information (BG-13 / BG-14 invoicing period). */
export interface DeliveryInfo {
  date?: string; // BT-72 actual delivery date (Lieferdatum), YYYY-MM-DD
  periodStart?: string; // BT-73 invoicing period start
  periodEnd?: string; // BT-74 invoicing period end
}

/** The canonical invoice. */
export interface CanonicalInvoice {
  // --- Document header ---
  invoiceNumber: string; // BT-1
  issueDate: string; // BT-2 (YYYY-MM-DD)
  dueDate?: string; // BT-9 (YYYY-MM-DD)
  typeCode: string; // BT-3 invoice type code (UNCL1001), default "380"
  currency: CurrencyCode; // BT-5 document currency
  taxCurrency?: CurrencyCode; // BT-6
  buyerReference?: string; // BT-10 buyer reference / Leitweg-ID
  notes?: string[]; // BT-22
  orderReference?: string; // BT-13 purchase order reference

  // --- Parties ---
  seller: Party; // BG-4
  buyer: Party; // BG-7

  // --- Optional groups ---
  delivery?: DeliveryInfo;
  payment?: PaymentDetails;

  // --- Lines, tax, totals (computed) ---
  lines: InvoiceLine[]; // BG-25 (>= 1)
  vatBreakdown: VatBreakdownEntry[]; // BG-23 (>= 1)
  totals: DocumentTotals; // BG-22

  // --- Extensibility: per-country fields outside EN 16931 core ---
  extensions: Record<string, unknown>;
}
