/**
 * @invoice-iob/core — canonical EN 16931 invoice model, the FormatProvider extension point,
 * the format registry, friendly-input schema, and the input mapper / tax math.
 *
 * Engine- and transport-agnostic: this package has no dependency on the MCP SDK or any
 * specific e-invoice engine, so it is reusable by non-MCP adapters (CLI/HTTP) too.
 */
export * from './model.ts';
export * from './provider.ts';
export * from './registry.ts';
export * from './errors.ts';
export * from './money.ts';
export * from './validation.ts';
export * from './input.ts';
export * from './mapper.ts';
