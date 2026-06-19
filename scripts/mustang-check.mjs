// Validates ZUGFeRD/Factur-X hybrid PDFs with the Mustangproject CLI (P2 gate).
//
// Mustang's `--action validate` is a one-stop hybrid gate: it runs an embedded veraPDF for
// PDF/A-3b conformance AND validates the Factur-X container + the embedded factur-x.xml against
// the EN 16931 profile. We treat a PDF as valid if Mustang's report says <summary status="valid">,
// or (as a fallback) the process exits 0 with no "invalid" marker — Mustang's exit code is not
// perfectly consistent across versions, so the report text is the primary signal.
//
// Inputs via env:
//   MUSTANG_JAR  — path to Mustang-CLI-<ver>.jar (Mustangproject 2.24.0)
//   FIXTURES_DIR — directory of *.pdf hybrids to validate (default: dist/fixtures)
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUSTANG_JAR = process.env['MUSTANG_JAR'];
const fixturesDir = resolve(process.env['FIXTURES_DIR'] ?? join(root, 'dist/fixtures'));

function die(msg) {
  console.error('✗', msg);
  process.exit(2);
}
if (!MUSTANG_JAR) die('MUSTANG_JAR is not set (path to the Mustang-CLI jar).');

const pdfs = (await readdir(fixturesDir))
  .filter((f) => f.toLowerCase().endsWith('.pdf'))
  .map((f) => join(fixturesDir, f));
if (pdfs.length === 0) die(`No *.pdf found in ${fixturesDir}. Run scripts/gen-fixtures.mjs first.`);

console.log(`Mustang validate over ${pdfs.length} hybrid PDF(s) — embeds veraPDF for PDF/A-3b`);
console.log(`  jar: ${MUSTANG_JAR}\n`);

let failed = 0;
for (const pdf of pdfs) {
  const base = basename(pdf);
  const r = spawnSync('java', ['-jar', MUSTANG_JAR, '--action', 'validate', '--source', pdf], {
    encoding: 'utf8',
    cwd: root,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const summaryValid = /<summary\b[^>]*\bstatus\s*=\s*["']valid["']/i.test(out);
  const summaryInvalid = /<summary\b[^>]*\bstatus\s*=\s*["']invalid["']/i.test(out);
  const profile = /\b(EN\s?16931|EXTENDED|BASIC(?:\sWL)?|MINIMUM|XRECHNUNG|COMFORT)\b/i.exec(out)?.[1];
  // Pass if the report explicitly says valid, or it exited cleanly with no "invalid" marker.
  const pass = summaryValid || (!summaryInvalid && r.status === 0);
  console.log(
    `  ${pass ? '✓' : '✗'} ${base} — ${pass ? 'valid' : 'INVALID'} (exit=${r.status}${profile ? `, profile~${profile}` : ''})`,
  );
  if (!pass) {
    failed++;
    const lines = out
      .split('\n')
      .filter((l) => /error|invalid|fail|exception|not.*compliant/i.test(l))
      .slice(0, 20);
    if (lines.length) console.log(lines.map((l) => `      ${l.trim()}`).join('\n'));
    else console.log(out.split('\n').slice(0, 20).map((l) => `      ${l}`).join('\n'));
  }
}

console.log(
  failed === 0
    ? `\n✅ HYBRID GATE PASSED (${pdfs.length}/${pdfs.length} valid)`
    : `\n❌ HYBRID GATE FAILED (${failed}/${pdfs.length} invalid)`,
);
process.exit(failed === 0 ? 0 : 1);
