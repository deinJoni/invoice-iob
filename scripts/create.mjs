// Dev helper: create an invoice end-to-end by driving the BUILT bundle over a real MCP stdio
// handshake (the same path Claude Desktop / Claude Code use). Usage:
//   node scripts/create.mjs <input.json> [FORMAT ...]
// Output dir: $INVOICE_IOB_OUTPUT_DIR or ./output. Requires `pnpm run build` first.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'dist/bundle/server/index.mjs');

const inputArg = process.argv[2];
if (!inputArg) {
  console.error('usage: node scripts/create.mjs <input.json> [FORMAT ...]');
  process.exit(1);
}
const inputPath = isAbsolute(inputArg) ? inputArg : join(root, inputArg);
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const formats = process.argv.slice(3);
const fmts = formats.length ? formats : [input.format ?? 'XRECHNUNG-CII'];

const outDir = resolve(process.env['INVOICE_IOB_OUTPUT_DIR'] ?? join(root, 'output'));
await mkdir(outDir, { recursive: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [bundle],
  env: { ...process.env, INVOICE_IOB_OUTPUT_DIR: outDir },
  stderr: 'inherit',
});
const client = new Client({ name: 'invoice-iob-create', version: '0.0.0' });
await client.connect(transport);
console.log(`invoice ${input.invoiceNumber} → formats: ${fmts.join(', ')}\n`);

let failed = 0;
for (const format of fmts) {
  const res = await client.callTool({ name: 'create_invoice', arguments: { ...input, format } });
  if (res.isError) {
    console.error(`✗ ${format}: ${res.content?.[0]?.text}`);
    failed++;
    continue;
  }
  const s = res.structuredContent;
  console.log(`✓ ${format}: net ${s.net} + VAT ${s.vat} = ${s.gross} ${s.currency}`);
  console.log(`   → ${s.file}`);
  if (s.warnings?.length) console.log(`   warnings: ${s.warnings.join('; ')}`);
}
await client.close();
console.log(`\noutput dir: ${outDir}`);
process.exit(failed === 0 ? 0 : 1);
