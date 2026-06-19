/**
 * Thin wrapper over `@e-invoice-eu/core`'s `InvoiceService`. Exposes exactly the two paths we
 * use — XML generation and the supply-our-own-PDF Factur-X path — and enforces the
 * LibreOffice-avoidance guard (PRD §8.1 / docs/STACK.md): for hybrid output we ALWAYS pass
 * `options.pdf` and NEVER `options.spreadsheet`/`libreOfficePath`, so the engine's
 * `child_process.spawn(libreoffice)` branch is provably unreachable.
 */
import { EngineError } from '@invoice-iob/core';
import type { CanonicalInvoice } from '@invoice-iob/core';
import { InvoiceService } from '@e-invoice-eu/core';
import type { InvoiceServiceOptions } from '@e-invoice-eu/core';
import { serializeToUbl } from './serialize.ts';
import { stderrLogger } from './logger.ts';

/** XML output formats the engine produces as a string. */
export type XmlFormat = 'UBL' | 'CII' | 'XRECHNUNG-UBL' | 'XRECHNUNG-CII';

/** Hybrid (Factur-X/ZUGFeRD) profile/format names. */
export type FacturXFormat =
  | 'Factur-X-Minimum'
  | 'Factur-X-Basic WL'
  | 'Factur-X-Basic'
  | 'Factur-X-EN16931'
  | 'Factur-X-Extended'
  | 'Factur-X-XRechnung';

let service: InvoiceService | undefined;
function getService(): InvoiceService {
  // The logger routes all output to stderr (stdout is the MCP JSON-RPC channel).
  service ??= new InvoiceService(
    stderrLogger as unknown as ConstructorParameters<typeof InvoiceService>[0],
  );
  return service;
}

/**
 * Guard against ever triggering the engine's LibreOffice path. Throws if a caller tries to set
 * the spreadsheet/libreOffice options. Exported for unit testing.
 */
export function assertNoLibreOffice(options: InvoiceServiceOptions): void {
  const o = options as Record<string, unknown>;
  if (o['spreadsheet'] !== undefined)
    throw new EngineError('Refusing to set options.spreadsheet — would invoke LibreOffice.');
  if (o['libreOfficePath'] !== undefined)
    throw new EngineError('Refusing to set options.libreOfficePath — would invoke LibreOffice.');
}

/** Generate EN 16931 XML (UBL / CII / XRechnung-UBL / XRechnung-CII) as a string. */
export async function generateXml(
  model: CanonicalInvoice,
  format: XmlFormat,
  opts: { lang?: string } = {},
): Promise<string> {
  const invoice = serializeToUbl(model);
  const options: InvoiceServiceOptions = {
    format,
    lang: opts.lang ?? 'de-de',
    noWarnings: true,
  };
  assertNoLibreOffice(options);
  try {
    const result = await getService().generate(invoice, options);
    if (typeof result !== 'string') {
      throw new EngineError(`Expected XML string for format "${format}", got binary output.`);
    }
    return result;
  } catch (err) {
    if (err instanceof EngineError) throw err;
    throw new EngineError(`Engine failed to generate ${format}: ${describe(err)}`, err);
  }
}

/**
 * Generate a Factur-X / ZUGFeRD PDF/A-3 by supplying our own rendered visual PDF. The engine
 * embeds the CII XML, builds the PDF/A-3 wrapper, OutputIntent, XMP, etc. Returns the PDF bytes.
 */
export async function generateFacturX(
  model: CanonicalInvoice,
  args: { profile: FacturXFormat; pdf: Uint8Array; lang?: string; pdfFilename?: string },
): Promise<Uint8Array> {
  if (!args.pdf || args.pdf.byteLength === 0) {
    throw new EngineError('generateFacturX requires a non-empty source PDF (options.pdf).');
  }
  const invoice = serializeToUbl(model);
  const options: InvoiceServiceOptions = {
    format: args.profile,
    lang: args.lang ?? 'de-de',
    noWarnings: true,
    pdf: {
      buffer: args.pdf,
      filename: args.pdfFilename ?? 'invoice.pdf',
      mimetype: 'application/pdf',
    },
  };
  assertNoLibreOffice(options);
  try {
    const result = await getService().generate(invoice, options);
    if (typeof result === 'string') {
      throw new EngineError(`Expected PDF bytes for "${args.profile}", got a string.`);
    }
    return result;
  } catch (err) {
    if (err instanceof EngineError) throw err;
    throw new EngineError(`Engine failed to generate ${args.profile}: ${describe(err)}`, err);
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
