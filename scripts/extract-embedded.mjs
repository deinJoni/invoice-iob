// Extracts the embedded factur-x.xml (the CII) from the hybrid fixtures whose matrix entry asks
// for an embedded-KoSIT cross-check (embedKosit: the XRECHNUNG-profile hybrids). The extracted XML
// is the XRechnung CII, so the CI job then runs scripts/kosit-check.mjs over the extract dir to
// prove the *embedded* document is itself a valid XRechnung — not just that the container validates.
//
// Uses Mustang's `--action extract --source <pdf> --out <xml>` (NOT `pull`, which is not a Mustang
// action). Mustang ABORTS if --out already exists (ensureFileNotExists), so we write into a fresh,
// emptied directory.
//
// Inputs via env:
//   MUSTANG_JAR   — path to Mustang-CLI-<ver>.jar
//   FIXTURES_DIR  — dir holding manifest.json + hybrid fixtures (default: dist/fixtures)
//   EXTRACT_DIR   — where to write the extracted XML (default: dist/embedded)
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUSTANG_JAR = process.env['MUSTANG_JAR'];
const fixturesDir = resolve(process.env['FIXTURES_DIR'] ?? join(root, 'dist/fixtures'));
const extractDir = resolve(process.env['EXTRACT_DIR'] ?? join(root, 'dist/embedded'));

function die(msg) {
  console.error('✗', msg);
  process.exit(2);
}
if (!MUSTANG_JAR) die('MUSTANG_JAR is not set (path to the Mustang-CLI jar).');

const manifest = JSON.parse(await readFile(join(fixturesDir, 'manifest.json'), 'utf8')).filter(
  (e) => e.embedKosit,
);
if (manifest.length === 0) {
  console.log('No fixtures request an embedded-KoSIT cross-check; nothing to extract.');
  process.exit(0);
}

await rm(extractDir, { recursive: true, force: true });
await mkdir(extractDir, { recursive: true });

console.log(`Extracting embedded factur-x.xml from ${manifest.length} hybrid(s) → ${extractDir}\n`);
let failed = 0;
for (const e of manifest) {
  const src = join(fixturesDir, e.file);
  const out = join(extractDir, e.file.replace(/\.pdf$/i, '.xml'));
  const r = spawnSync(
    'java',
    ['-jar', MUSTANG_JAR, '--action', 'extract', '--source', src, '--out', out],
    { encoding: 'utf8', cwd: root, maxBuffer: 64 * 1024 * 1024 },
  );
  const wrote = r.status === 0 && /Written to/i.test(`${r.stdout ?? ''}${r.stderr ?? ''}`);
  if (wrote) {
    console.log(`  ✓ ${e.file} → ${out.split('/').pop()}`);
  } else {
    console.log(`  ✗ ${e.file} — extract failed (exit=${r.status})`);
    console.log(
      `      ${(r.stderr ?? r.stdout ?? '').trim().split('\n').slice(0, 5).join('\n      ')}`,
    );
    failed++;
  }
}

console.log(
  failed === 0
    ? `\n✅ EXTRACTED ${manifest.length} embedded CII → run kosit-check with FIXTURES_DIR=${extractDir}`
    : `\n❌ EXTRACTION FAILED (${failed}/${manifest.length})`,
);
process.exit(failed === 0 ? 0 : 1);
