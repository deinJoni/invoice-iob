// Validates ZUGFeRD/Factur-X hybrid PDFs with the Mustangproject CLI (the hybrid gate).
//
// Mustang's `--action validate` is a one-stop hybrid gate: it runs an embedded veraPDF for
// PDF/A-3b conformance AND validates the Factur-X container + the embedded factur-x.xml against
// the declared EN 16931 profile. We validate every hybrid PATH the matrix declares — i.e. every
// example × every profile (EN16931/BASIC/EXTENDED/XRECHNUNG) — reading the fixture list from
// dist/fixtures/manifest.json so we only touch this gate's fixtures. The verdict comes from the
// report (<summary status="valid">), never the exit code (inconsistent across versions).
//
// Inputs via env:
//   MUSTANG_JAR  — path to Mustang-CLI-<ver>.jar (Mustangproject 2.24.0)
//   FIXTURES_DIR — directory holding manifest.json + fixtures (default: dist/fixtures)
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMustangReport } from './lib/reports.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUSTANG_JAR = process.env['MUSTANG_JAR'];
const fixturesDir = resolve(process.env['FIXTURES_DIR'] ?? join(root, 'dist/fixtures'));

function die(msg) {
  console.error('✗', msg);
  process.exit(2);
}
if (!MUSTANG_JAR) die('MUSTANG_JAR is not set (path to the Mustang-CLI jar).');

// Prefer the manifest (validate exactly this gate's fixtures); fall back to globbing *.pdf.
async function targets() {
  try {
    const manifest = JSON.parse(await readFile(join(fixturesDir, 'manifest.json'), 'utf8'));
    return manifest
      .filter((e) => e.gate === 'mustang')
      .map((e) => ({ file: join(fixturesDir, e.file), label: e.file, expectProfile: e.profile }));
  } catch {
    const pdfs = (await readdir(fixturesDir)).filter((f) => f.toLowerCase().endsWith('.pdf'));
    return pdfs.map((f) => ({ file: join(fixturesDir, f), label: f, expectProfile: null }));
  }
}

const pdfs = await targets();
if (pdfs.length === 0)
  die(`No hybrid fixtures for the mustang gate in ${fixturesDir}. Run gen-fixtures first.`);

console.log(`Mustang validate over ${pdfs.length} hybrid PDF(s) — embeds veraPDF for PDF/A-3b`);
console.log(`  jar: ${MUSTANG_JAR}\n`);

let failed = 0;
for (const { file, label, expectProfile } of pdfs) {
  const r = spawnSync('java', ['-jar', MUSTANG_JAR, '--action', 'validate', '--source', file], {
    encoding: 'utf8',
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const { profile, pass } = parseMustangReport(out, r.status);
  const want = expectProfile ? `, want~${expectProfile}` : '';
  console.log(
    `  ${pass ? '✓' : '✗'} ${basename(label)} — ${pass ? 'valid' : 'INVALID'} (exit=${r.status}${profile ? `, profile~${profile}` : ''}${want})`,
  );
  if (!pass) {
    failed++;
    const lines = out
      .split('\n')
      .filter((l) => /error|invalid|fail|exception|not.*compliant/i.test(l))
      .slice(0, 20);
    if (lines.length) console.log(lines.map((l) => `      ${l.trim()}`).join('\n'));
    else
      console.log(
        out
          .split('\n')
          .slice(0, 20)
          .map((l) => `      ${l}`)
          .join('\n'),
      );
  }
}

console.log(
  failed === 0
    ? `\n✅ HYBRID GATE PASSED (${pdfs.length}/${pdfs.length} valid)`
    : `\n❌ HYBRID GATE FAILED (${failed}/${pdfs.length} invalid)`,
);
process.exit(failed === 0 ? 0 : 1);
