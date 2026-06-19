/**
 * Composes the format registry for this build. Each format package exposes a `register()`
 * entrypoint; the server wires them together here (explicit DI — bundler-safe, testable).
 * Adding a country = importing its package and calling its `register()`.
 */
import { FormatRegistry } from '@invoice-iob/core';
import { register as registerUblCii } from '@invoice-iob/format-ubl-cii';
import { register as registerXRechnung } from '@invoice-iob/format-xrechnung';
import { register as registerPdf } from '@invoice-iob/format-pdf';
import { register as registerZugferd } from '@invoice-iob/format-zugferd';

export function buildRegistry(): FormatRegistry {
  const registry = new FormatRegistry();
  registerXRechnung(registry); // DE launch formats (most likely default for DE users)
  registerUblCii(registry); // generic EU XML
  registerPdf(registry); // visual PDF
  registerZugferd(registry); // ZUGFeRD / Factur-X hybrid PDF/A-3
  return registry;
}
