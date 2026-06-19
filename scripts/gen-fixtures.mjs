// Generates the XML fixtures the KoSIT gate validates. Building the bundle is NOT this script's
// job — it assumes dist/bundle/server/index.mjs already exists (CI runs `pnpm run build` first).
//
// It drives the BUILT bundle over a real MCP stdio handshake using the SDK client — the exact
// connection/teardown pattern from scripts/smoke.mjs — so the fixtures come out of the same code
// path a real client (Claude Desktop / Claude Code) would hit. Files land in dist/fixtures/ via
// INVOICE_IOB_OUTPUT_DIR; the server names them <invoiceNumber>-<format>.<ext>.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'dist/bundle/server/index.mjs');
const outDir = join(root, 'dist/fixtures');

// XML fixtures for the KoSIT (P0) gate + the ZUGFeRD hybrid for the Mustang/veraPDF (P2) gate.
// kosit-check.mjs validates only *.xml; mustang-check.mjs validates only *.pdf.
const FORMATS = ['XRECHNUNG-CII', 'XRECHNUNG-UBL', 'ZUGFERD'];

let failures = 0;
const fail = (msg) => {
  console.error('  ✗', msg);
  failures++;
};
const ok = (msg) => console.log('  ✓', msg);

await mkdir(outDir, { recursive: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [bundle],
  env: { ...process.env, INVOICE_IOB_OUTPUT_DIR: outDir },
  stderr: 'inherit',
});
const client = new Client({ name: 'invoice-iob-gen-fixtures', version: '0.0.0' });
await client.connect(transport);
console.log('connected to bundled server over stdio\n');

const input = JSON.parse(await readFile(join(root, 'examples/invoice-consulting.json'), 'utf8'));
console.log('create_invoice:');
for (const format of FORMATS) {
  const res = await client.callTool({ name: 'create_invoice', arguments: { ...input, format } });
  if (res.isError) {
    fail(`${format}: ${res.content?.[0]?.text}`);
    continue;
  }
  const s = res.structuredContent;
  ok(`${format}: ${s.net}+${s.vat}=${s.gross} ${s.currency} → ${s.file.split('/').pop()}`);
}

await client.close();

console.log('\nwritten fixtures:');
const files = await readdir(outDir);
files.forEach((f) => console.log('   -', f));
console.log(`\noutput dir: ${outDir}`);

console.log(
  failures === 0
    ? '\n✅ FIXTURES GENERATED'
    : `\n❌ FIXTURE GENERATION FAILED (${failures} failures)`,
);
process.exit(failures === 0 ? 0 : 1);
