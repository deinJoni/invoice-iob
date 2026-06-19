/**
 * @invoice-iob/engine-e-invoice-eu — engine adapter over @e-invoice-eu/core.
 * Centralizes the canonical→UBL-JSON serializer, the XML / Factur-X generate wrappers,
 * and the LibreOffice-avoidance guard.
 */
export { serializeToUbl } from './serialize.ts';
export { generateXml, generateFacturX, assertNoLibreOffice } from './engine.ts';
export type { XmlFormat, FacturXFormat } from './engine.ts';
export { stderrLogger } from './logger.ts';
export type { EngineLogger } from './logger.ts';
