import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInvoiceSchema } from './input.ts';
import { mapToCanonical } from './mapper.ts';

const baseInput = {
  format: 'CII',
  invoiceNumber: 'T-1',
  issueDate: '2026-06-19',
  seller: { name: 'S GmbH', vatId: 'DE123456789', address: { city: 'Berlin', countryCode: 'DE' } },
  buyer: { name: 'B GmbH', address: { city: 'München', countryCode: 'DE' } },
};

function build(overrides: Record<string, unknown>) {
  return createInvoiceSchema.parse({ ...baseInput, ...overrides });
}

test('computes line nets, single VAT group and totals', () => {
  const model = mapToCanonical(
    build({
      lines: [
        { name: 'Consulting', quantity: 20, unitCode: 'HUR', netUnitPrice: 150, vatRate: 19 },
        { name: 'Travel', quantity: 1, netUnitPrice: 89.9, vatRate: 19 },
      ],
    }),
  );
  assert.equal(model.totals.lineExtensionAmount, 3089.9);
  assert.equal(model.totals.taxExclusiveAmount, 3089.9);
  assert.equal(model.totals.taxAmount, 587.08); // round(3089.90 * 0.19)
  assert.equal(model.totals.taxInclusiveAmount, 3676.98);
  assert.equal(model.totals.payableAmount, 3676.98);
  assert.equal(model.vatBreakdown.length, 1);
  assert.equal(model.vatBreakdown[0]?.rate, 19);
  assert.equal(model.vatBreakdown[0]?.taxableAmount, 3089.9);
});

test('groups multiple VAT rates into separate breakdown entries', () => {
  const model = mapToCanonical(
    build({
      lines: [
        { name: 'Standard', quantity: 1, netUnitPrice: 100, vatRate: 19 },
        { name: 'Reduced', quantity: 1, netUnitPrice: 100, vatRate: 7 },
        { name: 'Standard 2', quantity: 2, netUnitPrice: 50, vatRate: 19 },
      ],
    }),
  );
  assert.equal(model.vatBreakdown.length, 2);
  const std = model.vatBreakdown.find((v) => v.rate === 19);
  const red = model.vatBreakdown.find((v) => v.rate === 7);
  assert.equal(std?.taxableAmount, 200); // 100 + 2*50
  assert.equal(std?.taxAmount, 38); // 200 * 0.19
  assert.equal(red?.taxableAmount, 100);
  assert.equal(red?.taxAmount, 7); // 100 * 0.07
  assert.equal(model.totals.taxAmount, 45);
  assert.equal(model.totals.taxInclusiveAmount, 345);
});

test('rounds VAT half-up to the cent', () => {
  // taxable 100.10 @ 19% = 19.019 -> 19.02
  const model = mapToCanonical(
    build({ lines: [{ name: 'X', quantity: 1, netUnitPrice: 100.1, vatRate: 19 }] }),
  );
  assert.equal(model.vatBreakdown[0]?.taxAmount, 19.02);
  assert.equal(model.totals.taxInclusiveAmount, 119.12);
});

test('reverse-charge category gets a default exemption reason and zero tax', () => {
  const model = mapToCanonical(
    build({
      lines: [{ name: 'Service', quantity: 1, netUnitPrice: 1000, vatRate: 0, vatCategory: 'AE' }],
    }),
  );
  assert.equal(model.vatBreakdown[0]?.taxAmount, 0);
  assert.equal(model.vatBreakdown[0]?.exemptionReason, 'Reverse charge');
  assert.equal(model.vatBreakdown[0]?.exemptionReasonCode, 'VATEX-EU-AE');
  assert.equal(model.totals.taxInclusiveAmount, 1000);
});

test('applies friendly-input defaults (typeCode, currency, unit, category)', () => {
  const model = mapToCanonical(
    build({ lines: [{ name: 'X', quantity: 1, netUnitPrice: 10, vatRate: 19 }] }),
  );
  assert.equal(model.typeCode, '380');
  assert.equal(model.currency, 'EUR');
  assert.equal(model.lines[0]?.unitCode, 'C62');
  assert.equal(model.lines[0]?.vatCategory, 'S');
});
