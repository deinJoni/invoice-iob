// THE DRIFT GUARD. Boots the BUILT bundle, asks it which formats it actually exposes
// (list_formats), and asserts the validation matrix (scripts/lib/matrix.mjs) covers exactly
// that set — no more, no less. This is what keeps CI honest as the project grows: the moment
// someone registers a new format (a new output *path*) without telling CI how to validate it,
// this fails with instructions instead of silently shipping an unvalidated format.
//
// Runs in the fast `build-test` job (no JDK needed) on every push and PR, so contributors get
// the failure immediately. Run locally with `pnpm run check:coverage` (needs `pnpm run build`).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMAT_COVERAGE, GATES, coverageDrift } from './lib/matrix.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'dist/bundle/server/index.mjs');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [bundle],
  env: { ...process.env, INVOICE_IOB_OUTPUT_DIR: join(root, 'dist/fixtures') },
  stderr: 'inherit',
});
const client = new Client({ name: 'invoice-iob-check-coverage', version: '0.0.0' });
await client.connect(transport);

const lf = await client.callTool({ name: 'list_formats', arguments: {} });
const formats = lf.structuredContent?.formats ?? [];
await client.close();

const problems = coverageDrift(formats);

console.log('Validation coverage (every registered format must map to a CI gate):\n');
for (const fmt of formats) {
  const cov = FORMAT_COVERAGE[fmt.id];
  const gate = cov ? (GATES[cov.gate]?.label ?? `?? (${cov.gate})`) : '❌ NOT IN MATRIX';
  const profiles = cov?.profiles?.length ? ` ×{${cov.profiles.join(',')}}` : '';
  console.log(`  ${cov ? '✓' : '✗'} ${fmt.id.padEnd(16)}${profiles.padEnd(34)} → ${gate}`);
}

if (problems.length) {
  console.error('\n❌ COVERAGE DRIFT — the tests are out of date for the current format set:\n');
  problems.forEach((p) => console.error('  •', p));
  console.error(
    '\nFix: edit scripts/lib/matrix.mjs (see docs/CI.md → "Adding a new path") so every\n' +
      'registered format maps to the gate that proves its conformance, then re-run.',
  );
  process.exit(1);
}

console.log(`\n✅ COVERAGE IN SYNC — ${formats.length} formats, all mapped to a CI gate.`);
process.exit(0);
