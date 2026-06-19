// Runs the KoSIT validator (Java) over a directory of XML invoices and PARSES its report.
//
// ┌─ THE VARL FOOTGUN (load-bearing — see docs/STACK.md PRD correction #10) ───────────────────┐
// │ The KoSIT validator exits 0 even for INVALID invoices. A non-zero exit means a config/IO    │
// │ error (bad scenarios.xml, missing repository), NOT a failed invoice. So we NEVER trust the  │
// │ exit code: we parse each VARL report (Validation Result Report Language) instead.            │
// │                                                                                              │
// │ VARL report shape (rep: = http://www.xoev.de/de/validator/varl/1):                           │
// │   <rep:report> <rep:scenarioMatched> <rep:validationStepResult>                              │
// │       <rep:message level="error|warning|information" code=… />   ← findings                  │
// │   <rep:assessment> <rep:accept|rep:reject>                       ← the verdict               │
// │ We assert the assessment is <rep:accept> AND there are zero <rep:message level="error">.     │
// │ (The brief calls the verdict a "recommendation of accept"; in VARL that is literally the     │
// │ rep:accept element under rep:assessment, and errors are rep:message[@level='error'], not a   │
// │ rep:error element — so we match the real XSOEV output, not a paraphrase of it.)              │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Inputs via env:
//   KOSIT_JAR        — path to validator-<ver>-standalone.jar (KoSIT validator 1.6.2)
//   KOSIT_SCENARIOS  — path to scenarios.xml from validator-configuration-xrechnung (2026-01-31)
//   FIXTURES_DIR     — directory of *.xml to validate (default: dist/fixtures)
//
// Invocation (the validator resolves Schematron/XSD relative to the scenarios.xml's directory,
// which it treats as the repository): java -jar $KOSIT_JAR -s $KOSIT_SCENARIOS -r <repo> -o <out> <xml...>
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const allFiles = await readdir(fixturesDir);
const xmlFiles = allFiles
  .filter((f) => f.toLowerCase().endsWith('.xml'))
  .map((f) => join(fixturesDir, f));
if (xmlFiles.length === 0)
  die(`No *.xml found in ${fixturesDir}. Run scripts/gen-fixtures.mjs first.`);

console.log(`KoSIT validator over ${xmlFiles.length} file(s) in ${fixturesDir}`);
console.log(`  jar:        ${KOSIT_JAR}`);
console.log(`  scenarios:  ${KOSIT_SCENARIOS}`);
console.log(`  repository: ${repoDir}\n`);

const outDir = await mkdtemp(join(tmpdir(), 'kosit-report-'));
await mkdir(outDir, { recursive: true });

try {
  // We tolerate a non-zero exit here because the exit code is NOT the source of truth (see the
  // VARL footgun above) — the per-file report parse below is. A genuine config/IO failure shows
  // up as missing/empty reports, which we treat as FAIL too.
  execFileSync(
    'java',
    ['-jar', KOSIT_JAR, '-s', KOSIT_SCENARIOS, '-r', repoDir, '-o', outDir, ...xmlFiles],
    { stdio: 'inherit', cwd: root },
  );
} catch (err) {
  console.error(`\n(note) validator exited non-zero — parsing reports anyway: ${err.message}\n`);
}

// Count error findings: <rep:message ... level="error" ...> (attribute order is not fixed).
function countErrors(xml) {
  const messages = xml.match(/<(?:[A-Za-z0-9_]+:)?message\b[^>]*>/g) ?? [];
  return messages.filter((m) => /\blevel\s*=\s*["']error["']/i.test(m)).length;
}

// The verdict: <rep:accept> (or <rep:reject>) under <rep:assessment>. Match either as a
// self-closing or container element, namespace-agnostic.
function recommendation(xml) {
  if (/<(?:[A-Za-z0-9_]+:)?accept[\s/>]/.test(xml)) return 'accept';
  if (/<(?:[A-Za-z0-9_]+:)?reject[\s/>]/.test(xml)) return 'reject';
  return null;
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
  const rec = recommendation(report);
  const errors = countErrors(report);
  const pass = rec === 'accept' && errors === 0;
  console.log(
    `  ${pass ? '✓' : '✗'} ${base}  — ${pass ? 'PASS' : 'FAIL'} (recommendation=${rec ?? 'none'}, error findings=${errors})`,
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
