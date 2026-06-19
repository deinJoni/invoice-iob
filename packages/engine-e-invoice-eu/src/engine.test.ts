import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoLibreOffice } from './engine.ts';

const pdf = { buffer: new Uint8Array([1, 2, 3]), filename: 'x.pdf', mimetype: 'application/pdf' };

test('assertNoLibreOffice allows a pdf-only Factur-X options object', () => {
  assert.doesNotThrow(() =>
    assertNoLibreOffice({ format: 'Factur-X-EN16931', lang: 'de-de', pdf } as never),
  );
});

test('assertNoLibreOffice allows plain XML options (no pdf, no spreadsheet)', () => {
  assert.doesNotThrow(() => assertNoLibreOffice({ format: 'XRECHNUNG-CII', lang: 'de-de' } as never));
});

test('assertNoLibreOffice rejects a spreadsheet option (would invoke LibreOffice)', () => {
  assert.throws(
    () =>
      assertNoLibreOffice({
        format: 'UBL',
        lang: 'de-de',
        spreadsheet: { buffer: new Uint8Array(), filename: 'x.ods', mimetype: 'application/x' },
      } as never),
    /LibreOffice/,
  );
});

test('assertNoLibreOffice rejects a libreOfficePath option', () => {
  assert.throws(
    () => assertNoLibreOffice({ format: 'UBL', lang: 'de-de', libreOfficePath: '/usr/bin/soffice' } as never),
    /LibreOffice/,
  );
});
