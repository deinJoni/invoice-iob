import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CanonicalInvoice, Party } from '@invoice-iob/core';
// Import the pure rules layer (no PDF renderer / engine runtime), which `node --test` can load —
// importing the provider would transitively pull the renderer's embedded .ttf font.
import {
  FACTURX_FR_META,
  frIssues,
  isValidSiren,
  isValidSiret,
  luhnValid,
  mapFrExtensions,
  resolveProfile,
  validateFr,
} from './rules.ts';

// ── checksums ────────────────────────────────────────────────────────────────────────────────────

test('luhnValid: accepts valid sequences, rejects tampered ones and non-digits', () => {
  assert.equal(luhnValid('732829320'), true);
  assert.equal(luhnValid('732829321'), false);
  assert.equal(luhnValid('12345678a'), false);
});

test('isValidSiren: 9-digit Luhn, with the La Poste exception', () => {
  assert.equal(isValidSiren('732829320'), true);
  assert.equal(isValidSiren('404833048'), true);
  assert.equal(isValidSiren('356000000'), true); // La Poste
  assert.equal(isValidSiren('123456789'), false); // fails Luhn
  assert.equal(isValidSiren('73282932'), false); // too short
  assert.equal(isValidSiren('7328293200'), false); // too long
  assert.equal(isValidSiren('73282932X'), false); // non-digit
});

test('isValidSiret: 14-digit Luhn (with whitespace tolerated)', () => {
  assert.equal(isValidSiret('73282932000074'), true);
  assert.equal(isValidSiret('44306184100047'), true);
  assert.equal(isValidSiret('356 0000 0000 048'.replace(/ /g, '')), true); // La Poste head office
  assert.equal(isValidSiret('73282932000073'), false); // tampered check digit
  assert.equal(isValidSiret('7328293200007'), false); // 13 digits
});

// ── French business rules ──────────────────────────────────────────────────────────────────────

function frParty(over: Partial<Party> = {}): Party {
  return {
    name: 'Atelier Lumière SAS',
    vatId: 'FR44732829320',
    address: { city: 'Paris', postalCode: '75002', countryCode: 'FR' },
    legalRegistrationId: { scheme: '0002', value: '732829320' },
    identifiers: [{ scheme: '0009', value: '73282932000074' }],
    contactName: 'Camille Roux',
    contactPhone: '+33 1 23 45 67 89',
    contactEmail: 'facturation@atelier-lumiere.fr',
    ...over,
  };
}

function model(over: Partial<CanonicalInvoice> = {}): CanonicalInvoice {
  return {
    invoiceNumber: 'FR-2026-001',
    issueDate: '2026-06-19',
    typeCode: '380',
    currency: 'EUR',
    seller: frParty(),
    buyer: frParty({
      name: 'Studio Garance SARL',
      vatId: 'FR64443061841',
      legalRegistrationId: { scheme: '0002', value: '443061841' },
      identifiers: [{ scheme: '0009', value: '44306184100047' }],
    }),
    lines: [
      {
        id: '1',
        name: 'Conseil',
        quantity: 1,
        unitCode: 'C62',
        netUnitPrice: 1000,
        baseQuantity: 1,
        vatCategory: 'S',
        vatRate: 20,
        lineNetAmount: 1000,
      },
    ],
    vatBreakdown: [{ category: 'S', rate: 20, taxableAmount: 1000, taxAmount: 200 }],
    totals: {
      lineExtensionAmount: 1000,
      taxExclusiveAmount: 1000,
      taxAmount: 200,
      taxInclusiveAmount: 1200,
      payableAmount: 1200,
    },
    extensions: {},
    ...over,
  };
}

const errors = (m: CanonicalInvoice) => frIssues(m).filter((i) => i.severity === 'error');
const rules = (m: CanonicalInvoice) => frIssues(m).map((i) => i.rule);

test('a well-formed French invoice produces no French errors', () => {
  assert.deepEqual(errors(model()), []);
});

test('FR-01: a French seller without SIREN/SIRET is rejected', () => {
  const m = model({ seller: frParty({ legalRegistrationId: undefined, identifiers: undefined }) });
  assert.ok(errors(m).some((i) => i.rule === 'FR-01'));
});

test('FR-03: an invalid SIRET checksum is rejected', () => {
  const m = model({
    seller: frParty({ identifiers: [{ scheme: '0009', value: '73282932000073' }] }),
  });
  assert.ok(errors(m).some((i) => i.rule === 'FR-03'));
});

test('FR-02: an invalid SIREN checksum is rejected', () => {
  const m = model({
    seller: frParty({ legalRegistrationId: { scheme: '0002', value: '123456789' } }),
  });
  assert.ok(errors(m).some((i) => i.rule === 'FR-02'));
});

test('FR-05: a non-French TVA rate on a French invoice warns (does not block)', () => {
  const m = model({
    lines: [{ ...model().lines[0]!, vatRate: 19 }],
    vatBreakdown: [{ category: 'S', rate: 19, taxableAmount: 1000, taxAmount: 190 }],
  });
  const issues = frIssues(m);
  assert.ok(issues.some((i) => i.rule === 'FR-05' && i.severity === 'warning'));
  assert.deepEqual(errors(m), []); // a warning must not block
});

test('cross-product safety: a German seller produces no FR errors or warnings (no SIREN required)', () => {
  const de = frParty({
    name: 'Muster GmbH',
    vatId: 'DE123456789',
    address: { city: 'Berlin', postalCode: '10115', countryCode: 'DE' },
    legalRegistrationId: undefined,
    identifiers: undefined,
  });
  const m = model({ seller: de, buyer: de });
  assert.deepEqual(frIssues(m), []);
});

test('validateFr composes the EN 16931 base with the French rules', () => {
  const res = validateFr(model());
  assert.equal(res.ok, true);
  const bad = validateFr(
    model({ seller: frParty({ legalRegistrationId: undefined, identifiers: undefined }) }),
  );
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((i) => i.rule === 'FR-01'));
});

test('provider metadata is a bundleable FR Factur-X hybrid with EN16931 default', () => {
  assert.equal(FACTURX_FR_META.id, 'factur-x-fr');
  assert.deepEqual(FACTURX_FR_META.aliases, ['facturx-fr']);
  assert.equal(FACTURX_FR_META.country, 'FR');
  assert.equal(FACTURX_FR_META.outputKind, 'hybrid');
  assert.equal(FACTURX_FR_META.bundleable, true);
  assert.equal(FACTURX_FR_META.defaultProfile, 'EN16931');
});

test('mapFrExtensions normalizes the friendly French block (and ignores empty input)', () => {
  const out = mapFrExtensions({
    extensions: {
      fr: {
        legalForm: 'SAS',
        shareCapital: '10 000 €',
        rcsCity: 'Paris',
        operationType: 'services',
      },
    },
  });
  assert.deepEqual(out, {
    fr: { legalForm: 'SAS', shareCapital: '10 000 €', rcsCity: 'Paris', operationType: 'services' },
  });
  assert.deepEqual(mapFrExtensions({}), {});
});

test('resolveProfile maps friendly names and defaults to EN 16931', () => {
  assert.equal(resolveProfile(undefined), 'Factur-X-EN16931');
  assert.equal(resolveProfile('en16931'), 'Factur-X-EN16931');
  assert.equal(resolveProfile('COMFORT'), 'Factur-X-EN16931');
  assert.equal(resolveProfile('extended'), 'Factur-X-Extended');
  assert.equal(resolveProfile('basic'), 'Factur-X-Basic');
  assert.equal(resolveProfile('nonsense'), 'Factur-X-EN16931');
});
