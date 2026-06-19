import { rgb } from '@cantoo/pdf-lib';

/** A4 in PostScript points, with a uniform content margin. */
export const PAGE = { width: 595.28, height: 841.89, margin: 50 } as const;

export const COLORS = {
  text: rgb(0.12, 0.12, 0.14),
  muted: rgb(0.42, 0.45, 0.5),
  line: rgb(0.8, 0.82, 0.85),
  headerBg: rgb(0.945, 0.957, 0.969),
  accent: rgb(0.09, 0.22, 0.45),
} as const;

/** Font sizes. */
export const FS = { title: 22, h2: 10.5, label: 7.5, body: 9.5, small: 8.2, tiny: 7.2 } as const;

export type Locale = 'de' | 'en' | 'fr';

export interface Labels {
  invoice: string;
  invoiceNo: string;
  issueDate: string;
  dueDate: string;
  deliveryDate: string;
  deliveryPeriod: string;
  buyerRef: string;
  vatId: string;
  taxNo: string;
  billedTo: string;
  pos: string;
  description: string;
  qty: string;
  unitPrice: string;
  vatRate: string;
  lineNet: string;
  subtotalNet: string;
  grossTotal: string;
  payable: string;
  paymentTitle: string;
  iban: string;
  bic: string;
  account: string;
  terms: string;
  vatBreakdownTitle: string;
  taxable: string;
  taxAmount: string;
  rate: string;
  reverseCharge: string;
  page: string;
  of: string;
  contact: string;
}

export const LABELS: Record<Locale, Labels> = {
  de: {
    invoice: 'Rechnung',
    invoiceNo: 'Rechnungsnr.',
    issueDate: 'Rechnungsdatum',
    dueDate: 'Fällig am',
    deliveryDate: 'Lieferdatum',
    deliveryPeriod: 'Leistungszeitraum',
    buyerRef: 'Leitweg-ID / Referenz',
    vatId: 'USt-IdNr.',
    taxNo: 'Steuernr.',
    billedTo: 'Rechnungsempfänger',
    pos: 'Pos.',
    description: 'Bezeichnung',
    qty: 'Menge',
    unitPrice: 'Einzelpreis',
    vatRate: 'USt.',
    lineNet: 'Nettobetrag',
    subtotalNet: 'Gesamt netto',
    grossTotal: 'Gesamtbetrag',
    payable: 'Zahlbetrag',
    paymentTitle: 'Zahlung',
    iban: 'IBAN',
    bic: 'BIC',
    account: 'Kontoinhaber',
    terms: 'Zahlungsbedingungen',
    vatBreakdownTitle: 'Steueraufschlüsselung',
    taxable: 'Netto',
    taxAmount: 'Steuerbetrag',
    rate: 'Satz',
    reverseCharge: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)',
    page: 'Seite',
    of: 'von',
    contact: 'Kontakt',
  },
  en: {
    invoice: 'Invoice',
    invoiceNo: 'Invoice no.',
    issueDate: 'Issue date',
    dueDate: 'Due date',
    deliveryDate: 'Delivery date',
    deliveryPeriod: 'Service period',
    buyerRef: 'Buyer reference',
    vatId: 'VAT ID',
    taxNo: 'Tax no.',
    billedTo: 'Billed to',
    pos: 'No.',
    description: 'Description',
    qty: 'Qty',
    unitPrice: 'Unit price',
    vatRate: 'VAT',
    lineNet: 'Net amount',
    subtotalNet: 'Net total',
    grossTotal: 'Total',
    payable: 'Amount due',
    paymentTitle: 'Payment',
    iban: 'IBAN',
    bic: 'BIC',
    account: 'Account holder',
    terms: 'Payment terms',
    vatBreakdownTitle: 'VAT breakdown',
    taxable: 'Net',
    taxAmount: 'VAT amount',
    rate: 'Rate',
    reverseCharge: 'Reverse charge',
    page: 'Page',
    of: 'of',
    contact: 'Contact',
  },
  fr: {
    invoice: 'Facture',
    invoiceNo: 'N° de facture',
    issueDate: 'Date de facture',
    dueDate: "Date d'échéance",
    deliveryDate: 'Date de livraison',
    deliveryPeriod: 'Période',
    buyerRef: 'Référence acheteur',
    vatId: 'N° TVA',
    taxNo: 'N° fiscal',
    billedTo: 'Facturé à',
    pos: 'N°',
    description: 'Désignation',
    qty: 'Qté',
    unitPrice: 'Prix unit. HT',
    vatRate: 'TVA',
    lineNet: 'Montant HT',
    subtotalNet: 'Total HT',
    grossTotal: 'Total TTC',
    payable: 'Net à payer',
    paymentTitle: 'Paiement',
    iban: 'IBAN',
    bic: 'BIC',
    account: 'Titulaire',
    terms: 'Conditions de paiement',
    vatBreakdownTitle: 'Détail de la TVA',
    taxable: 'Base HT',
    taxAmount: 'Montant TVA',
    rate: 'Taux',
    reverseCharge: 'Autoliquidation',
    page: 'Page',
    of: 'sur',
    contact: 'Contact',
  },
};

const UNIT_LABELS: Record<Locale, Record<string, string>> = {
  de: {
    HUR: 'Std.',
    DAY: 'Tag(e)',
    C62: 'Stk.',
    KGM: 'kg',
    MTR: 'm',
    LTR: 'l',
    MON: 'Monat(e)',
    H87: 'Stk.',
  },
  en: {
    HUR: 'hrs',
    DAY: 'day(s)',
    C62: 'pcs',
    KGM: 'kg',
    MTR: 'm',
    LTR: 'l',
    MON: 'month(s)',
    H87: 'pcs',
  },
  fr: { HUR: 'h', DAY: 'jour(s)', C62: 'u', KGM: 'kg', MTR: 'm', LTR: 'l', MON: 'mois', H87: 'u' },
};

/** Human-readable unit for a UN/ECE Rec 20 code; falls back to the code. */
export function unitLabel(locale: Locale, code: string): string {
  return UNIT_LABELS[locale][code] ?? code;
}

/** Scheme id (EN 16931 ICD list) → short label for party identifiers shown on the PDF. */
const ID_SCHEME_LABELS: Record<string, string> = {
  '0002': 'SIREN',
  '0009': 'SIRET',
  '0088': 'GLN',
  '0060': 'DUNS',
};

/** Short label for a party-identifier scheme id (e.g. "0009" → "SIRET"); undefined if unknown. */
export function idSchemeLabel(scheme: string | undefined): string | undefined {
  return scheme ? ID_SCHEME_LABELS[scheme] : undefined;
}
