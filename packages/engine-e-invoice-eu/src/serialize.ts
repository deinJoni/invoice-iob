/**
 * Serialize a {@link CanonicalInvoice} into the `@e-invoice-eu/core` UBL-syntax JSON `Invoice`.
 *
 * The engine accepts ONE UBL-JSON tree for every output format (UBL, CII, XRechnung-*,
 * Factur-X); it internally transforms UBL→CII as needed. We therefore build a single tree here
 * and reuse it. Attributes are encoded as flattened sibling keys (`'cbc:X@currencyID'`,
 * `'@unitCode'`, `'@schemeID'`); all amounts/quantities/rates are strings. We omit
 * `cbc:CustomizationID`/`cbc:ProfileID` so the engine fills the correct per-format URNs.
 *
 * The engine's TS types are enormous closed unions (every ISO currency, unit code, …); fully
 * satisfying them in the type system is impractical and Ajv validates the shape at runtime
 * anyway, so we build a structurally-correct object and assert the engine type at the boundary.
 */
import type { CanonicalInvoice, InvoiceLine, Party, VatBreakdownEntry } from '@invoice-iob/core';
import { formatDecimal, formatMoney } from '@invoice-iob/core';
import type { Invoice } from '@e-invoice-eu/core';

type Json = Record<string, unknown>;

/** Tax scheme id for a VAT identifier (BT-31/BT-48). */
const VAT = 'VAT';
/** Tax scheme id for a national tax registration / Steuernummer (BT-32). */
const TAX_REGISTRATION = 'FC';

/** A money field as the engine encodes it: value string + sibling `@currencyID`. */
function money(key: string, amountMajor: number, currency: string): Json {
  return { [key]: formatMoney(amountMajor), [`${key}@currencyID`]: currency };
}

/** A higher-precision amount (e.g. unit price BT-146) + sibling `@currencyID`. */
function priceAmount(key: string, value: number, currency: string): Json {
  return { [key]: formatDecimal(value), [`${key}@currencyID`]: currency };
}

function postalAddress(p: Party): Json {
  const addr = p.address;
  const out: Json = {};
  if (addr.line1) out['cbc:StreetName'] = addr.line1;
  if (addr.line2) out['cbc:AdditionalStreetName'] = addr.line2;
  out['cbc:CityName'] = addr.city;
  if (addr.postalCode) out['cbc:PostalZone'] = addr.postalCode;
  if (addr.countrySubdivision) out['cbc:CountrySubentity'] = addr.countrySubdivision;
  out['cac:Country'] = { 'cbc:IdentificationCode': addr.countryCode };
  return out;
}

function contact(p: Party): Json | undefined {
  if (!p.contactName && !p.contactPhone && !p.contactEmail) return undefined;
  const c: Json = {};
  if (p.contactName) c['cbc:Name'] = p.contactName;
  if (p.contactPhone) c['cbc:Telephone'] = p.contactPhone;
  if (p.contactEmail) c['cbc:ElectronicMail'] = p.contactEmail;
  return c;
}

function endpoint(p: Party): Json {
  if (!p.electronicAddress) return {};
  return {
    'cbc:EndpointID': p.electronicAddress.value,
    'cbc:EndpointID@schemeID': p.electronicAddress.scheme,
  };
}

/** One identifier → `{ cbc:ID, cbc:ID@schemeID? }`. */
function identifierJson(id: { scheme?: string; value: string }): Json {
  const out: Json = { 'cbc:ID': id.value };
  if (id.scheme) out['cbc:ID@schemeID'] = id.scheme;
  return out;
}

/**
 * Additional party identifiers (BT-29 seller / BT-46 buyer) → `cac:PartyIdentification`, carrying
 * `cbc:ID` + optional `cbc:ID@schemeID` (ICD code). Generic across countries — e.g. it is how a
 * French SIRET (schemeID "0009") rides into the UBL/CII the engine emits. EN 16931 makes the seller
 * identifier repeatable (0..n → array) but the buyer identifier 0..1 (single object); the engine's
 * schema enforces exactly that, so we honour the cardinality per side.
 */
function sellerIdentifications(p: Party): Json | undefined {
  if (!p.identifiers?.length) return undefined;
  return { 'cac:PartyIdentification': p.identifiers.map(identifierJson) };
}

function buyerIdentification(p: Party): Json | undefined {
  const first = p.identifiers?.[0];
  return first ? { 'cac:PartyIdentification': identifierJson(first) } : undefined;
}

function legalEntity(p: Party): Json {
  const le: Json = { 'cbc:RegistrationName': p.name };
  if (p.legalRegistrationId) {
    le['cbc:CompanyID'] = p.legalRegistrationId.value;
    if (p.legalRegistrationId.scheme) le['cbc:CompanyID@schemeID'] = p.legalRegistrationId.scheme;
  }
  return le;
}

/** Seller PartyTaxScheme is an array (VAT id and/or tax registration). */
function sellerTaxSchemes(p: Party): Json[] {
  const out: Json[] = [];
  if (p.vatId) out.push({ 'cbc:CompanyID': p.vatId, 'cac:TaxScheme': { 'cbc:ID': VAT } });
  if (p.taxNumber)
    out.push({ 'cbc:CompanyID': p.taxNumber, 'cac:TaxScheme': { 'cbc:ID': TAX_REGISTRATION } });
  return out;
}

function sellerParty(p: Party): Json {
  const party: Json = { ...endpoint(p) };
  const ids = sellerIdentifications(p);
  if (ids) Object.assign(party, ids);
  if (p.tradingName) party['cac:PartyName'] = { 'cbc:Name': p.tradingName };
  party['cac:PostalAddress'] = postalAddress(p);
  const taxSchemes = sellerTaxSchemes(p);
  if (taxSchemes.length) party['cac:PartyTaxScheme'] = taxSchemes;
  party['cac:PartyLegalEntity'] = legalEntity(p);
  const c = contact(p);
  if (c) party['cac:Contact'] = c;
  return { 'cac:Party': party };
}

function buyerParty(p: Party): Json {
  const party: Json = { ...endpoint(p) };
  const ids = buyerIdentification(p);
  if (ids) Object.assign(party, ids);
  if (p.tradingName) party['cac:PartyName'] = { 'cbc:Name': p.tradingName };
  party['cac:PostalAddress'] = postalAddress(p);
  // Buyer PartyTaxScheme is a single object (BT-48), not an array.
  if (p.vatId)
    party['cac:PartyTaxScheme'] = { 'cbc:CompanyID': p.vatId, 'cac:TaxScheme': { 'cbc:ID': VAT } };
  party['cac:PartyLegalEntity'] = legalEntity(p);
  const c = contact(p);
  if (c) party['cac:Contact'] = c;
  return { 'cac:Party': party };
}

function taxCategory(entry: VatBreakdownEntry): Json {
  const cat: Json = {
    'cbc:ID': entry.category,
    'cbc:Percent': formatRate(entry.rate),
  };
  if (entry.exemptionReasonCode) cat['cbc:TaxExemptionReasonCode'] = entry.exemptionReasonCode;
  if (entry.exemptionReason) cat['cbc:TaxExemptionReason'] = entry.exemptionReason;
  cat['cac:TaxScheme'] = { 'cbc:ID': VAT };
  return cat;
}

/** Rate as a plain numeric string ("19", "7", "0", "16.5"). */
function formatRate(rate: number): string {
  return Number.isInteger(rate) ? String(rate) : String(rate);
}

function invoiceLine(line: InvoiceLine, currency: string): Json {
  const item: Json = { 'cbc:Name': line.name };
  if (line.description) item['cbc:Description'] = line.description;
  if (line.buyerItemId) item['cac:BuyersItemIdentification'] = { 'cbc:ID': line.buyerItemId };
  if (line.sellerItemId) item['cac:SellersItemIdentification'] = { 'cbc:ID': line.sellerItemId };
  item['cac:ClassifiedTaxCategory'] = {
    'cbc:ID': line.vatCategory,
    'cbc:Percent': formatRate(line.vatRate),
    'cac:TaxScheme': { 'cbc:ID': VAT },
  };

  const price: Json = { ...priceAmount('cbc:PriceAmount', line.netUnitPrice, currency) };
  if (line.baseQuantity && line.baseQuantity !== 1) {
    price['cbc:BaseQuantity'] = formatDecimal(line.baseQuantity);
    price['cbc:BaseQuantity@unitCode'] = line.unitCode;
  }

  return {
    'cbc:ID': line.id,
    'cbc:InvoicedQuantity': formatDecimal(line.quantity),
    'cbc:InvoicedQuantity@unitCode': line.unitCode,
    ...money('cbc:LineExtensionAmount', line.lineNetAmount, currency),
    'cac:Item': item,
    'cac:Price': price,
  };
}

function paymentMeans(inv: CanonicalInvoice): Json[] | undefined {
  const pay = inv.payment;
  if (!pay) return undefined;
  const pm: Json = { 'cbc:PaymentMeansCode': pay.meansCode ?? '58' };
  if (pay.reference) pm['cbc:PaymentID'] = pay.reference;
  if (pay.iban) {
    const account: Json = { 'cbc:ID': pay.iban };
    if (pay.accountName) account['cbc:Name'] = pay.accountName;
    if (pay.bic) account['cac:FinancialInstitutionBranch'] = { 'cbc:ID': pay.bic };
    pm['cac:PayeeFinancialAccount'] = account;
  }
  return [pm];
}

/** Build the engine's UBL-JSON Invoice from the canonical model. */
export function serializeToUbl(inv: CanonicalInvoice): Invoice {
  const currency = inv.currency;
  const ubl: Json = {
    'cbc:ID': inv.invoiceNumber,
    'cbc:IssueDate': inv.issueDate,
  };
  if (inv.dueDate) ubl['cbc:DueDate'] = inv.dueDate;
  ubl['cbc:InvoiceTypeCode'] = inv.typeCode;
  if (inv.notes?.length) ubl['cbc:Note'] = inv.notes;
  ubl['cbc:DocumentCurrencyCode'] = currency;
  if (inv.taxCurrency) ubl['cbc:TaxCurrencyCode'] = inv.taxCurrency;
  if (inv.buyerReference) ubl['cbc:BuyerReference'] = inv.buyerReference;

  if (inv.delivery?.periodStart || inv.delivery?.periodEnd) {
    const period: Json = {};
    if (inv.delivery.periodStart) period['cbc:StartDate'] = inv.delivery.periodStart;
    if (inv.delivery.periodEnd) period['cbc:EndDate'] = inv.delivery.periodEnd;
    ubl['cac:InvoicePeriod'] = period;
  }
  if (inv.orderReference) ubl['cac:OrderReference'] = { 'cbc:ID': inv.orderReference };

  ubl['cac:AccountingSupplierParty'] = sellerParty(inv.seller);
  ubl['cac:AccountingCustomerParty'] = buyerParty(inv.buyer);

  if (inv.delivery?.date) ubl['cac:Delivery'] = { 'cbc:ActualDeliveryDate': inv.delivery.date };

  const pm = paymentMeans(inv);
  if (pm) ubl['cac:PaymentMeans'] = pm;
  if (inv.payment?.terms) ubl['cac:PaymentTerms'] = { 'cbc:Note': inv.payment.terms };

  ubl['cac:TaxTotal'] = [
    {
      ...money('cbc:TaxAmount', inv.totals.taxAmount, currency),
      'cac:TaxSubtotal': inv.vatBreakdown.map((e) => ({
        ...money('cbc:TaxableAmount', e.taxableAmount, currency),
        ...money('cbc:TaxAmount', e.taxAmount, currency),
        'cac:TaxCategory': taxCategory(e),
      })),
    },
  ];

  const totals: Json = {
    ...money('cbc:LineExtensionAmount', inv.totals.lineExtensionAmount, currency),
    ...money('cbc:TaxExclusiveAmount', inv.totals.taxExclusiveAmount, currency),
    ...money('cbc:TaxInclusiveAmount', inv.totals.taxInclusiveAmount, currency),
  };
  if (inv.totals.allowanceTotalAmount !== undefined)
    Object.assign(
      totals,
      money('cbc:AllowanceTotalAmount', inv.totals.allowanceTotalAmount, currency),
    );
  if (inv.totals.chargeTotalAmount !== undefined)
    Object.assign(totals, money('cbc:ChargeTotalAmount', inv.totals.chargeTotalAmount, currency));
  if (inv.totals.prepaidAmount !== undefined)
    Object.assign(totals, money('cbc:PrepaidAmount', inv.totals.prepaidAmount, currency));
  Object.assign(totals, money('cbc:PayableAmount', inv.totals.payableAmount, currency));
  ubl['cac:LegalMonetaryTotal'] = totals;

  ubl['cac:InvoiceLine'] = inv.lines.map((l) => invoiceLine(l, currency));

  return { 'ubl:Invoice': ubl } as unknown as Invoice;
}
