// Generates one conformance fixture per VALIDATED PATH, for EVERY example input, and writes
// dist/fixtures/manifest.json describing them. The per-gate checkers (kosit/en16931/mustang)
// read the manifest and validate the fixtures for their gate. Building the bundle is NOT this
// script's job — it assumes dist/bundle/server/index.mjs exists (CI runs `pnpm run build` first).
//
// A *path* = a format the registry lists, and — for hybrids — each profile. The set of paths
// comes from scripts/lib/matrix.mjs (the single source of truth), crossed with every
// examples/*.json. So adding an example OR a format automatically widens what CI validates.
//
// It drives the BUILT bundle over a real MCP stdio handshake (the exact pattern from
// scripts/smoke.mjs) so fixtures come out of the same code path a real client hits. The server
// names its output <invoiceNumber>-<format>.<ext> (and overwrites across hybrid profiles), so we
// copy each artifact out to a collision-free fixture name the moment it is produced.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverageDrift, fixtureName, fixtureSpecs } from './lib/matrix.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'dist/bundle/server/index.mjs');
const outDir = join(root, 'dist/fixtures');
const examplesDir = join(root, 'examples');

// Optional: limit generation to specific gates (CI sets this per job to stay fast), e.g.
// FIXTURE_GATES=mustang. Default: every fixture-based gate.
const gateFilter = (process.env['FIXTURE_GATES'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

let failures = 0;
const fail = (msg) => {
  console.error('  ✗', msg);
  failures++;
};
const ok = (msg) => console.log('  ✓', msg);
const slug = (name) =>
  basename(name)
    .replace(/\.json$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-');

// Fresh output dir so a stale fixture can never be validated by accident.
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
const rawDir = await mkdtemp(join(tmpdir(), 'invoice-iob-raw-'));

const exampleFiles = (await readdir(examplesDir)).filter((f) => f.toLowerCase().endsWith('.json'));
if (exampleFiles.length === 0) throw new Error(`No examples/*.json found in ${examplesDir}`);
const examples = await Promise.all(
  exampleFiles.map(async (f) => ({
    slug: slug(f),
    input: JSON.parse(await readFile(join(examplesDir, f), 'utf8')),
  })),
);

const specs = fixtureSpecs(gateFilter.length ? { gates: gateFilter } : {});
console.log(
  `generating ${specs.length} path(s) × ${examples.length} example(s)` +
    (gateFilter.length ? ` (gates: ${gateFilter.join(', ')})` : '') +
    `\n  examples: ${examples.map((e) => e.slug).join(', ')}\n`,
);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [bundle],
  env: { ...process.env, INVOICE_IOB_OUTPUT_DIR: rawDir },
  stderr: 'inherit',
});
const client = new Client({ name: 'invoice-iob-gen-fixtures', version: '0.0.0' });
await client.connect(transport);
console.log('connected to bundled server over stdio\n');

// ── Drift guard runs here too: the live registry must match the matrix, so a Java job can
// never quietly skip a newly-added format. (build-test runs the same check via check-coverage.)
const lf = await client.callTool({ name: 'list_formats', arguments: {} });
const drift = coverageDrift(lf.structuredContent?.formats ?? []);
if (drift.length) {
  console.error('❌ COVERAGE DRIFT — the validation matrix is out of sync with the registry:\n');
  drift.forEach((d) => console.error('  •', d));
  await client.close();
  process.exit(1);
}

const manifest = [];
console.log('create_invoice per path:');
for (const ex of examples) {
  for (const spec of specs) {
    const args = { ...ex.input, format: spec.formatId };
    if (spec.profile) args.profile = spec.profile;
    const res = await client.callTool({ name: 'create_invoice', arguments: args });
    const label = `${ex.slug} · ${spec.formatId}${spec.profile ? ` [${spec.profile}]` : ''}`;
    if (res.isError) {
      fail(`${label}: ${res.content?.[0]?.text}`);
      continue;
    }
    const s = res.structuredContent;
    const name = fixtureName(ex.slug, spec.formatId, spec.profile, spec.ext);
    await copyFile(s.file, join(outDir, name));
    manifest.push({
      file: name,
      example: ex.slug,
      invoiceNumber: ex.input.invoiceNumber,
      formatId: spec.formatId,
      profile: spec.profile,
      gate: spec.gate,
      ext: spec.ext,
      syntax: spec.syntax,
      embedKosit: spec.embedKosit,
      expect: 'valid',
    });
    ok(`${label}: ${s.net}+${s.vat}=${s.gross} ${s.currency} → ${name}`);
  }
}

await client.close();
await rm(rawDir, { recursive: true, force: true });

await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`\nwrote ${manifest.length} fixture(s) + manifest.json to ${outDir}`);
const byGate = manifest.reduce((m, e) => ((m[e.gate] = (m[e.gate] ?? 0) + 1), m), {});
console.log('  by gate:', JSON.stringify(byGate));

console.log(
  failures === 0
    ? '\n✅ FIXTURES GENERATED'
    : `\n❌ FIXTURE GENERATION FAILED (${failures} failures)`,
);
process.exit(failures === 0 ? 0 : 1);
