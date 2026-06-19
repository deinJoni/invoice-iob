/**
 * Output folder resolution + artifact writing.
 *
 * The folder is set once at install via the `INVOICE_IOB_OUTPUT_DIR` env var (the `.mcpb`
 * `directory` user_config maps to it); default `~/Documents/E-Invoices`. Files are named
 * `<invoiceNumber>-<format>.<ext>` (PRD §6.5).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RenderedArtifact } from '@invoice-iob/core';

export function resolveOutputDir(): string {
  const fromEnv = process.env['INVOICE_IOB_OUTPUT_DIR'];
  if (fromEnv && fromEnv.trim()) return resolve(fromEnv.trim());
  return join(homedir(), 'Documents', 'E-Invoices');
}

/** Make a filesystem-safe token from a free-form string (e.g. an invoice number). */
export function sanitizeToken(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'invoice';
}

/** Write an artifact to the output dir and return its absolute path. */
export async function writeArtifact(
  outputDir: string,
  invoiceNumber: string,
  formatId: string,
  artifact: RenderedArtifact,
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const filename = `${sanitizeToken(invoiceNumber)}-${sanitizeToken(formatId)}.${artifact.extension}`;
  const filePath = join(outputDir, filename);
  await writeFile(filePath, artifact.bytes);
  return filePath;
}
