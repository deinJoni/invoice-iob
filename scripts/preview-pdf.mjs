// Dev helper: generate the example invoice as a PDF into dist/preview/ via the bundled server,
// so it can be eyeballed / rasterized. Not part of CI.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, readFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'dist/bundle/server/index.mjs');
const outDir = join(root, 'dist/preview');
await mkdir(outDir, { recursive: true });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [bundle],
  env: { ...process.env, INVOICE_IOB_OUTPUT_DIR: outDir },
  stderr: 'inherit',
});
const client = new Client({ name: 'preview', version: '0.0.0' });
await client.connect(transport);

const input = JSON.parse(await readFile(join(root, 'examples/invoice-consulting.json'), 'utf8'));
const res = await client.callTool({ name: 'create_invoice', arguments: { ...input, format: 'PDF' } });
await client.close();

if (res.isError) {
  console.error('FAILED:', res.content?.[0]?.text);
  process.exit(1);
}
const file = res.structuredContent.file;
await copyFile(file, join(outDir, 'invoice.pdf'));
console.log('preview PDF:', join(outDir, 'invoice.pdf'));
