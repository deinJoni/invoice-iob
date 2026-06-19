/**
 * Composes the format registry for this build. Each format package exposes a `register()`
 * entrypoint; the server wires them together here (explicit DI — bundler-safe, testable).
 * Adding a country = importing its package and calling its `register()`.
 */
import { FormatRegistry } from '@invoice-iob/core';
import { register as registerUblCii } from '@invoice-iob/format-ubl-cii';
import { register as registerXRechnung } from '@invoice-iob/format-xrechnung';

export function buildRegistry(): FormatRegistry {
  const registry = new FormatRegistry();
  registerXRechnung(registry); // DE launch formats first (most likely default for DE users)
  registerUblCii(registry); // generic EU formats
  return registry;
}
