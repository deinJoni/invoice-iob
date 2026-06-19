/**
 * @invoice-iob/server — the MCP stdio server. Bundle entrypoint for the `.mcpb` and every
 * other client (Claude Code, Claude Desktop, Cursor, VS Code, generic stdio MCP).
 *
 * HARD RULE: stdout is the JSON-RPC channel. Never write to stdout. All diagnostics go to
 * stderr via `log()`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import {
  createInvoiceShape,
  mapToCanonical,
  formatMoney,
  FormatNotFoundError,
  type CreateInvoiceInput,
  type ValidationIssue,
} from '@invoice-iob/core';
import { buildRegistry } from './registry.ts';
import { resolveOutputDir, writeArtifact } from './output.ts';

const VERSION = '0.1.0';

/** STDERR-only logger. Using stdout here would corrupt the MCP protocol. */
function log(...args: unknown[]): void {
  console.error('[invoice-iob]', ...args);
}

function formatIssue(i: ValidationIssue): string {
  return `${i.rule ? `[${i.rule}] ` : ''}${i.message}`;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

const registry = buildRegistry();

const createInvoiceOutputShape = {
  format: z.string(),
  file: z.string(),
  mimeType: z.string(),
  byteLength: z.number(),
  currency: z.string(),
  net: z.string(),
  vat: z.string(),
  gross: z.string(),
  warnings: z.array(z.string()),
};

const formatInfoShape = {
  id: z.string(),
  label: z.string(),
  country: z.string(),
  standard: z.string(),
  syntax: z.string(),
  outputKind: z.string(),
  bundleable: z.boolean(),
  available: z.boolean(),
  profiles: z.array(z.string()),
  defaultProfile: z.string().nullable(),
};

const listFormatsOutputShape = {
  formats: z.array(z.object(formatInfoShape)),
};

function createServer(): McpServer {
  const server = new McpServer(
    { name: 'invoice-iob', version: VERSION },
    { capabilities: { tools: {}, logging: {} } },
  );

  server.registerTool(
    'create_invoice',
    {
      title: 'Create an EN 16931 e-invoice',
      description:
        'Build a compliant e-invoice (XRechnung/UBL/CII XML; PDF and ZUGFeRD/Factur-X arrive in later versions) from simple fields and save it locally. VAT subtotals and totals are computed automatically. Call list_formats for available formats.',
      inputSchema: createInvoiceShape,
      outputSchema: createInvoiceOutputShape,
    },
    async (args) => {
      try {
        const input = args as unknown as CreateInvoiceInput;
        const model = mapToCanonical(input);

        const provider = registry.resolve(input.format);
        if (!provider) throw new FormatNotFoundError(input.format, registry.canonicalIds());

        const validation = provider.validate(model, input.profile);
        if (!validation.ok) {
          const errors = validation.issues.filter((i) => i.severity === 'error').map(formatIssue);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Cannot create a valid ${provider.meta.label}. Fix:\n- ${errors.join('\n- ')}`,
              },
            ],
            isError: true,
          };
        }

        const artifact = await provider.render(model, {
          profile: input.profile,
          lang: 'de-de',
        });
        const outputDir = resolveOutputDir();
        const file = await writeArtifact(outputDir, input.invoiceNumber, provider.meta.id, artifact);
        const warnings = validation.issues
          .filter((i) => i.severity === 'warning')
          .map(formatIssue);

        const structuredContent = {
          format: provider.meta.id,
          file,
          mimeType: artifact.mimeType,
          byteLength: artifact.bytes.byteLength,
          currency: model.currency,
          net: formatMoney(model.totals.taxExclusiveAmount),
          vat: formatMoney(model.totals.taxAmount),
          gross: formatMoney(model.totals.taxInclusiveAmount),
          warnings,
        };

        const text =
          `Created ${provider.meta.label}\nSaved to: ${file}\n` +
          `Net ${structuredContent.net} + VAT ${structuredContent.vat} = ${structuredContent.gross} ${model.currency}` +
          (warnings.length ? `\n\nWarnings:\n- ${warnings.join('\n- ')}` : '');

        return { content: [{ type: 'text' as const, text }], structuredContent };
      } catch (err) {
        log('create_invoice error:', err);
        return {
          content: [{ type: 'text' as const, text: `create_invoice failed: ${describeError(err)}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'list_formats',
    {
      title: 'List available e-invoice formats',
      description:
        'Enumerate the e-invoice formats available in this build, with country, output kind, and profiles.',
      inputSchema: {},
      outputSchema: listFormatsOutputShape,
    },
    async () => {
      const formats = registry.list().map((m) => ({
        id: m.id,
        label: m.label,
        country: m.country,
        standard: m.standard,
        syntax: String(m.syntax),
        outputKind: m.outputKind,
        bundleable: m.bundleable,
        available: m.bundleable,
        profiles: m.profiles ?? [],
        defaultProfile: m.defaultProfile ?? null,
      }));
      const text =
        'Available formats:\n' +
        formats.map((f) => `• ${f.id} — ${f.label} (${f.country}, ${f.outputKind})`).join('\n');
      return { content: [{ type: 'text' as const, text }], structuredContent: { formats } };
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  log(`ready on stdio (v${VERSION}) — output dir: ${resolveOutputDir()}`);
}

main().catch((err) => {
  log('fatal:', err);
  process.exit(1);
});
