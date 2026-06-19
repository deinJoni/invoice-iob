/**
 * French business rules, identifier checksums, profile resolution and mandatory mentions for the
 * `factur-x-fr` provider — the pure, dependency-light layer (no PDF renderer / no engine runtime),
 * so it is unit-testable with `node --test` (which can't load the renderer's embedded `.ttf`).
 * The provider in `index.ts` composes these with the renderer + engine. See docs/research/france.md.
 */
import {
  baseEn16931Issues,
  validationResult,
  type CanonicalInvoice,
  type FormatMeta,
  type Party,
  type ValidationIssue,
  type ValidationResult,
} from '@invoice-iob/core';
import type { FacturXFormat } from '@invoice-iob/engine-e-invoice-eu';

/** ICD scheme ids (EN 16931 code list) for the French legal identifiers. */
export const SIREN_SCHEME = '0002';
export const SIRET_SCHEME = '0009';

/** Standard French TVA rates (metropolitan). Corsica/DOM rates differ — flagged as a warning only. */
const FR_VAT_RATES = new Set([20, 10, 5.5, 2.1, 0]);

/** Factur-X profiles this provider offers (the French-relevant subset; XRECHNUNG is German). */
const PROFILES: Record<string, FacturXFormat> = {
  EN16931: 'Factur-X-EN16931',
  'EN 16931': 'Factur-X-EN16931',
  COMFORT: 'Factur-X-EN16931',
  BASIC: 'Factur-X-Basic',
  EXTENDED: 'Factur-X-Extended',
};

/** Resolve a friendly profile name to the engine's Factur-X format; defaults to EN 16931 (Comfort). */
export function resolveProfile(profile: string | undefined): FacturXFormat {
  if (!profile) return 'Factur-X-EN16931';
  return PROFILES[profile.trim().toUpperCase()] ?? 'Factur-X-EN16931';
}

/** Provider metadata (a French EN 16931 Factur-X hybrid; pure JS → bundleable). */
export const FACTURX_FR_META: FormatMeta = {
  id: 'factur-x-fr',
  aliases: ['facturx-fr'],
  label: 'Factur-X France (hybrid PDF/A-3)',
  country: 'FR',
  standard: 'EN 16931 (Factur-X 1.0)',
  syntax: 'hybrid',
  outputKind: 'hybrid',
  profiles: ['EN16931', 'BASIC', 'EXTENDED'],
  defaultProfile: 'EN16931',
  fileExtension: 'pdf',
  mimeType: 'application/pdf',
  bundleable: true,
};

// ── French identifier checksums ────────────────────────────────────────────────────────────────

/** Luhn (mod 10) check over a digit string; true iff the total is a multiple of 10. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Valid SIREN: 9 digits passing Luhn. La Poste's SIREN 356000000 is the well-known exception that
 * is legally valid, so it is accepted explicitly (it also happens to pass Luhn).
 */
export function isValidSiren(siren: string): boolean {
  const s = siren.replace(/\s/g, '');
  if (!/^\d{9}$/.test(s)) return false;
  return luhnValid(s) || s === '356000000';
}

/**
 * Valid SIRET: 14 digits (SIREN + 5-digit NIC) passing Luhn. La Poste establishments (SIREN
 * 356000000) use the alternative rule "sum of the 14 digits is a multiple of 5".
 */
export function isValidSiret(siret: string): boolean {
  const s = siret.replace(/\s/g, '');
  if (!/^\d{14}$/.test(s)) return false;
  if (luhnValid(s)) return true;
  if (s.startsWith('356000000')) {
    const sum = [...s].reduce((acc, c) => acc + (c.charCodeAt(0) - 48), 0);
    return sum % 5 === 0;
  }
  return false;
}

// ── French business rules (CIUS-FR layer over EN 16931) ──────────────────────────────────────────

function isFrench(p: Party): boolean {
  return p.address?.countryCode?.toUpperCase() === 'FR';
}

/** The SIREN value (scheme 0002) carried on a party's legal registration id, if any. */
export function sirenOf(p: Party): string | undefined {
  return p.legalRegistrationId?.scheme === SIREN_SCHEME ? p.legalRegistrationId.value : undefined;
}

/** All SIRET values (scheme 0009) carried on a party's identifiers. */
export function siretsOf(p: Party): string[] {
  return (p.identifiers ?? []).filter((id) => id.scheme === SIRET_SCHEME).map((id) => id.value);
}

/**
 * French rules beyond generic EN 16931 (the subset worth surfacing early; full conformance is the
 * Mustang/veraPDF CI gate). PRESENCE requirements apply only when the seller is French — a German
 * seller using this French-localized provider still produces a valid EN 16931 Factur-X. FORMAT
 * (checksum) checks apply to any SIREN/SIRET provided, regardless of country.
 */
export function frIssues(model: CanonicalInvoice): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (message: string, rule: string): void => {
    issues.push({ severity: 'error', message, rule });
  };
  const warn = (message: string, rule: string): void => {
    issues.push({ severity: 'warning', message, rule });
  };

  // FR-01: a French seller must be identified by a SIREN (BT-30, scheme 0002) or SIRET (BT-29, 0009).
  const sellerSiren = sirenOf(model.seller);
  const sellerSirets = siretsOf(model.seller);
  if (isFrench(model.seller) && !sellerSiren && sellerSirets.length === 0) {
    error(
      'A French seller must carry a SIREN (legalRegistrationId scheme "0002") or SIRET (identifiers scheme "0009").',
      'FR-01',
    );
  }

  // FR-02 / FR-03: any provided SIREN / SIRET must have a valid checksum (Luhn), regardless of country.
  for (const [party, label] of [
    [model.seller, 'Seller'],
    [model.buyer, 'Buyer'],
  ] as const) {
    const siren = sirenOf(party);
    if (siren && !isValidSiren(siren)) {
      error(`${label} SIREN "${siren}" is not a valid 9-digit SIREN (checksum failed).`, 'FR-02');
    }
    for (const siret of siretsOf(party)) {
      if (!isValidSiret(siret)) {
        error(
          `${label} SIRET "${siret}" is not a valid 14-digit SIRET (checksum failed).`,
          'FR-03',
        );
      }
    }
  }

  // FR-04 (reform): a domestic French B2B invoice should carry the buyer's SIREN/SIRET.
  if (
    isFrench(model.seller) &&
    isFrench(model.buyer) &&
    !sirenOf(model.buyer) &&
    siretsOf(model.buyer).length === 0
  ) {
    warn(
      "The 2026 reform requires the buyer's SIREN/SIRET on a domestic French B2B invoice (BT-46/BT-47).",
      'FR-04',
    );
  }

  // FR-05: standard-rated lines on a French invoice should use a legal French TVA rate.
  if (isFrench(model.seller)) {
    for (const v of model.vatBreakdown) {
      if (v.category === 'S' && !FR_VAT_RATES.has(v.rate)) {
        warn(
          `TVA rate ${v.rate}% is not a standard French rate (20, 10, 5.5, 2.1). Verify it is a Corsica/DOM rate.`,
          'FR-05',
        );
      }
    }

    // FR-06: a French seller's VAT identifier (BT-31), when present, should be a French TVA number.
    if (model.seller.vatId && !/^FR/i.test(model.seller.vatId)) {
      warn(
        `Seller VAT id "${model.seller.vatId}" does not look like a French TVA number (expected "FR…").`,
        'FR-06',
      );
    }
  }

  return issues;
}

/** Cheap pre-flight: shared EN 16931 checks first, then French national rules. */
export function validateFr(model: CanonicalInvoice): ValidationResult {
  return validationResult([...baseEn16931Issues(model), ...frIssues(model)]);
}

// ── French mandatory mentions (Code de commerce / CGI) rendered as PDF fine print ────────────────

/** Where the provider stashes normalized French-only extras (no EN 16931 home) in the model. */
export const FR_EXT_KEY = 'fr';

export interface FrExtensions {
  /** Legal form, e.g. "SAS", "SARL". */
  legalForm?: string;
  /** Share capital, e.g. "10 000 €". */
  shareCapital?: string;
  /** RCS registration city, e.g. "Paris" → "RCS Paris <SIREN>". */
  rcsCity?: string;
  /** Nature of the operation: "biens" | "services" | "mixte". */
  operationType?: string;
}

/**
 * Build the legally-mandatory French mentions that belong on the visible document (they have no
 * EN 16931 business term). The late-payment penalty + fixed €40 recovery indemnity are mandatory on
 * every B2B invoice (Code de commerce art. L441-10 / D441-5).
 */
export function frLegalNotes(model: CanonicalInvoice): string[] {
  const notes: string[] = [];
  const ext = model.extensions[FR_EXT_KEY] as FrExtensions | undefined;

  // Seller legal-status mention: "<Name>, SAS au capital de 10 000 €, RCS Paris 123456789".
  if (ext?.legalForm || ext?.shareCapital || ext?.rcsCity) {
    const siren = sirenOf(model.seller);
    const bits = [model.seller.name];
    if (ext.legalForm) {
      bits.push(
        ext.shareCapital ? `${ext.legalForm} au capital de ${ext.shareCapital}` : ext.legalForm,
      );
    }
    if (ext.rcsCity) bits.push(`RCS ${ext.rcsCity}${siren ? ` ${siren}` : ''}`);
    notes.push(`${bits.join(', ')}.`);
  }

  if (ext?.operationType) {
    const label =
      ext.operationType === 'biens'
        ? 'Livraison de biens'
        : ext.operationType === 'services'
          ? 'Prestation de services'
          : ext.operationType === 'mixte'
            ? 'Opération mixte (biens et services)'
            : ext.operationType;
    notes.push(`Nature de l'opération : ${label}.`);
  }

  notes.push(
    'En cas de retard de paiement, des pénalités de retard sont exigibles (taux égal à trois fois le taux ' +
      "d'intérêt légal), ainsi qu'une indemnité forfaitaire pour frais de recouvrement de 40 € " +
      '(art. L441-10 et D441-5 du Code de commerce). Pas d’escompte pour paiement anticipé.',
  );
  return notes;
}

/**
 * Fold the friendly French-only block (`extensions.fr`) into a normalized extension bag the
 * renderer/validator read. EN 16931 identifiers (SIREN/SIRET/VAT) are NOT handled here — they ride
 * the generic typed party fields straight into the XML.
 */
export function mapFrExtensions(input: unknown): Record<string, unknown> {
  const raw = (input as { extensions?: { fr?: Record<string, unknown> } } | undefined)?.extensions
    ?.fr;
  if (!raw || typeof raw !== 'object') return {};
  const ext: FrExtensions = {};
  if (typeof raw['legalForm'] === 'string') ext.legalForm = raw['legalForm'];
  if (raw['shareCapital'] != null) ext.shareCapital = String(raw['shareCapital']);
  if (typeof raw['rcsCity'] === 'string') ext.rcsCity = raw['rcsCity'];
  if (typeof raw['operationType'] === 'string') ext.operationType = raw['operationType'];
  return Object.keys(ext).length ? { [FR_EXT_KEY]: ext } : {};
}
