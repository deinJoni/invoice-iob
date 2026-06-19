// End-to-end smoke test: drives the BUILT bundle over a real MCP stdio handshake using the
// SDK client (the same way Claude Desktop / Claude Code would), then verifies the written XML.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'dist/bundle/server/index.mjs');
const outDir = await mkdtemp(join(tmpdir(), 'invoice-iob-smoke-'));

let failures = 0;
const fail = (msg) => {
  console.error('  ✗', msg);
  failures++;
};
const ok = (msg) => console.log('  ✓', msg);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [bundle],
  env: { ...process.env, INVOICE_IOB_OUTPUT_DIR: outDir },
  stderr: 'inherit',
});
const client = new Client({ name: 'invoice-iob-smoke', version: '0.0.0' });
await client.connect(transport);
console.log('connected to bundled server over stdio\n');

// 1. tools/list
const { tools } = await client.listTools();
const toolNames = tools.map((t) => t.name).sort();
console.log('tools:', toolNames.join(', '));
['create_invoice', 'list_formats'].forEach((n) =>
  toolNames.includes(n) ? ok(`tool ${n} present`) : fail(`tool ${n} missing`),
);

// 2. list_formats
const lf = await client.callTool({ name: 'list_formats', arguments: {} });
const formatIds = (lf.structuredContent?.formats ?? []).map((f) => f.id);
console.log('\nformats:', formatIds.join(', '));
['xrechnung-cii', 'xrechnung-ubl', 'ubl', 'cii'].forEach((id) =>
  formatIds.includes(id) ? ok(`format ${id} listed`) : fail(`format ${id} missing`),
);

// 3. create_invoice for each XML format
const input = JSON.parse(await readFile(join(root, 'examples/invoice-consulting.json'), 'utf8'));
console.log('\ncreate_invoice:');
for (const format of ['XRECHNUNG-CII', 'XRECHNUNG-UBL', 'UBL', 'CII', 'PDF', 'ZUGFERD']) {
  const res = await client.callTool({ name: 'create_invoice', arguments: { ...input, format } });
  if (res.isError) {
    fail(`${format}: ${res.content?.[0]?.text}`);
    continue;
  }
  const s = res.structuredContent;
  const totalsOk = s.net === '3089.90' && s.vat === '587.08' && s.gross === '3676.98';
  totalsOk
    ? ok(`${format}: ${s.net}+${s.vat}=${s.gross} ${s.currency} → ${s.file.split('/').pop()}`)
    : fail(`${format}: wrong totals ${s.net}/${s.vat}/${s.gross}`);
}

// 4. inspect written XML
console.log('\nwritten files:');
const files = await readdir(outDir);
files.forEach((f) => console.log('   -', f));

const ciiName = files.find((f) => f.includes('xrechnung-cii'));
const ublName = files.find((f) => f.includes('xrechnung-ubl'));
if (ciiName) {
  const xml = await readFile(join(outDir, ciiName), 'utf8');
  /CrossIndustryInvoice/.test(xml) ? ok('CII: CrossIndustryInvoice root') : fail('CII: wrong root');
  xml.includes('xrechnung_3.0') ? ok('CII: XRechnung 3.0 CustomizationID') : fail('CII: missing XRechnung URN');
  xml.includes('3676.98') ? ok('CII: grand total 3676.98 present') : fail('CII: total missing');
  xml.includes('DE123456789') ? ok('CII: seller VAT id present') : fail('CII: seller VAT missing');
} else fail('no xrechnung-cii file written');
if (ublName) {
  const xml = await readFile(join(outDir, ublName), 'utf8');
  /<(ubl:)?Invoice/.test(xml) ? ok('UBL: Invoice root') : fail('UBL: wrong root');
}

const pdfName = files.find((f) => f.endsWith('-pdf.pdf'));
if (pdfName) {
  const buf = await readFile(join(outDir, pdfName));
  const head = buf.subarray(0, 8).toString('latin1');
  const tail = buf.subarray(-1024).toString('latin1');
  head.startsWith('%PDF-1.') ? ok(`PDF: valid header (${head.trim()})`) : fail('PDF: bad header');
  tail.includes('%%EOF') ? ok('PDF: %%EOF trailer present') : fail('PDF: no %%EOF');
  buf.length > 8000 ? ok(`PDF: ${(buf.length / 1024).toFixed(1)} KB (fonts embedded)`) : fail(`PDF: too small (${buf.length} B)`);
} else fail('no PDF file written');

// ZUGFeRD / Factur-X hybrid PDF/A-3 (P2 de-risk): the engine must embed factur-x.xml as an
// Associated File and add PDF/A XMP. Full conformance (veraPDF 3b + Mustang) is the CI gate.
const zugferdName = files.find((f) => f.includes('zugferd'));
if (zugferdName) {
  const buf = await readFile(join(outDir, zugferdName));
  const raw = buf.toString('latin1');
  buf.subarray(0, 8).toString('latin1').startsWith('%PDF-') ? ok('ZUGFeRD: valid PDF') : fail('ZUGFeRD: bad PDF');
  raw.includes('factur-x.xml') ? ok('ZUGFeRD: factur-x.xml embedded') : fail('ZUGFeRD: factur-x.xml NOT embedded');
  raw.includes('AFRelationship') || /\/AF[\s/<\[]/.test(raw) ? ok('ZUGFeRD: Associated File (/AF) present') : fail('ZUGFeRD: no /AF');
  raw.includes('pdfaid') ? ok('ZUGFeRD: PDF/A XMP (pdfaid) present') : fail('ZUGFeRD: no PDF/A XMP');
  buf.length > 20000 ? ok(`ZUGFeRD: ${(buf.length / 1024).toFixed(1)} KB hybrid PDF/A-3`) : fail('ZUGFeRD: too small');
} else fail('no zugferd file written');

// 5. negative case: missing buyerReference must fail XRechnung (BR-DE-15)
const bad = { ...input, format: 'XRECHNUNG-CII' };
delete bad.buyerReference;
const badRes = await client.callTool({ name: 'create_invoice', arguments: bad });
badRes.isError && /BR-DE-15/.test(badRes.content?.[0]?.text ?? '')
  ? ok('XRechnung without buyerReference is rejected (BR-DE-15)')
  : fail('missing buyerReference was NOT rejected');

await client.close();
console.log(`\noutput dir: ${outDir}`);
console.log(failures === 0 ? '\n✅ SMOKE TEST PASSED' : `\n❌ SMOKE TEST FAILED (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
