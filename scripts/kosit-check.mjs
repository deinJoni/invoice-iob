// Runs the KoSIT validator (Java) over the XRechnung XML fixtures and PARSES its report.
//
// ┌─ THE VARL FOOTGUN (load-bearing — see docs/STACK.md PRD correction #10) ───────────────────┐
// │ The KoSIT validator exits 0 even for INVALID invoices. A non-zero exit means a config/IO    │
// │ error (bad scenarios.xml, missing repository), NOT a failed invoice. So we NEVER trust the  │
// │ exit code: we parse each VARL report instead (parseKositReport, unit-tested in lib/reports). │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Which files: by default the fixtures whose gate is `kosit` (xrechnung-cii / xrechnung-ubl, for
// every example), read from dist/fixtures/manifest.json. If FIXTURES_DIR has no manifest we
// validate every *.xml in it — that mode is how the hybrid job KoSIT-checks the factur-x.xml it
// extracts from the XRECHNUNG-profile hybrid.
//
// Inputs via env:
//   KOSIT_JAR        — path to validator-<ver>-standalone.jar (KoSIT validator 1.6.2)
//   KOSIT_SCENARIOS  — path to scenarios.xml from validator-configuration-xrechnung (2026-01-31)
//   FIXTURES_DIR     — directory of fixtures (default: dist/fixtures)
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKositReport } from './lib/reports.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const KOSIT_JAR = process.env['KOSIT_JAR'];
const KOSIT_SCENARIOS = process.env['KOSIT_SCENARIOS'];
const fixturesDir = resolve(process.env['FIXTURES_DIR'] ?? join(root, 'dist/fixtures'));

function die(msg) {
  console.error('✗', msg);
  process.exit(2);
}

if (!KOSIT_JAR) die('KOSIT_JAR is not set (path to the KoSIT validator standalone jar).');
if (!KOSIT_SCENARIOS) die('KOSIT_SCENARIOS is not set (path to scenarios.xml).');

// The scenarios.xml lives at the root of the validator-configuration repository; the validator
// resolves every referenced Schematron/XSD relative to the repository dir we pass with -r.
const repoDir = dirname(resolve(KOSIT_SCENARIOS));

// Prefer the manifest (validate exactly the kosit-gate fixtures); fall back to all *.xml.
async function xmlTargets() {
  try {
    const manifest = JSON.parse(await readFile(join(fixturesDir, 'manifest.json'), 'utf8'));
    return manifest.filter((e) => e.gate === 'kosit').map((e) => join(fixturesDir, e.file));
  } catch {
    return (await readdir(fixturesDir))
      .filter((f) => f.toLowerCase().endsWith('.xml'))
      .map((f) => join(fixturesDir, f));
  }
}

const xmlFiles = await xmlTargets();
if (xmlFiles.length === 0)
  die(`No XML for the kosit gate in ${fixturesDir}. Run scripts/gen-fixtures.mjs first.`);

console.log(`KoSIT validator over ${xmlFiles.length} file(s) in ${fixturesDir}`);
console.log(`  jar:        ${KOSIT_JAR}`);
console.log(`  scenarios:  ${KOSIT_SCENARIOS}`);
console.log(`  repository: ${repoDir}\n`);

const outDir = await mkdtemp(join(tmpdir(), 'kosit-report-'));
await mkdir(outDir, { recursive: true });

try {
  // Non-zero exit is tolerated here (the exit code is NOT the source of truth — see footgun).
  // A genuine config/IO failure shows up as missing/empty reports, which we treat as FAIL too.
  execFileSync(
    'java',
    ['-jar', KOSIT_JAR, '-s', KOSIT_SCENARIOS, '-r', repoDir, '-o', outDir, ...xmlFiles],
    { stdio: 'inherit', cwd: root },
  );
} catch (err) {
  console.error(`\n(note) validator exited non-zero — parsing reports anyway: ${err.message}\n`);
}

const reportFiles = (await readdir(outDir)).filter((f) => f.toLowerCase().endsWith('-report.xml'));

let failed = 0;
console.log('per-file result:');
for (const xml of xmlFiles) {
  const base = basename(xml).replace(/\.xml$/i, '');
  const reportName = reportFiles.find((r) => r.startsWith(base));
  if (!reportName) {
    console.log(`  ✗ ${base}  — FAIL (no VARL report produced; validator config/IO error?)`);
    failed++;
    continue;
  }
  const report = await readFile(join(outDir, reportName), 'utf8');
  const { recommendation, errorCount, pass } = parseKositReport(report);
  console.log(
    `  ${pass ? '✓' : '✗'} ${base}  — ${pass ? 'PASS' : 'FAIL'} (recommendation=${recommendation ?? 'none'}, error findings=${errorCount})`,
  );
  if (!pass) failed++;
}

await rm(outDir, { recursive: true, force: true });

console.log(
  failed === 0
    ? `\n✅ KoSIT GATE PASSED (${xmlFiles.length}/${xmlFiles.length} accepted)`
    : `\n❌ KoSIT GATE FAILED (${failed}/${xmlFiles.length} did not pass)`,
);
process.exit(failed === 0 ? 0 : 1);
