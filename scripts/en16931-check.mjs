// Validates GENERIC EN 16931 UBL and CII XML against the official CEN EN 16931 Schematron
// (the `en16931` gate). The XRechnung formats are a German CIUS validated by KoSIT; the generic
// `ubl` / `cii` formats have no national config, so we run the CEN rules directly: the EN 16931
// Schematron compiled to XSLT, executed with Saxon-HE, producing an SVRL report we parse
// (parseSvrl, unit-tested in lib/reports). A fixture PASSES iff it has zero FATAL failed-asserts.
//
// The exact Schematron release / Saxon jar are pinned + downloaded in CI (see .github/workflows/
// ci.yml); this script is deliberately config-driven so the tooling can be bumped without code
// changes.
//
// Inputs via env:
//   SAXON_CP          — classpath for Saxon-HE (Saxon-HE jar PLUS xmlresolver jar(s); Saxon 12.x
//                       throws NoClassDefFoundError org/xmlresolver/Resolver without it — so we run
//                       `java -cp <SAXON_CP> net.sf.saxon.Transform`, never `java -jar`).
//   EN16931_UBL_XSLT  — path to EN16931-UBL-validation.xslt (compiled Schematron, UBL syntax)
//   EN16931_CII_XSLT  — path to EN16931-CII-validation.xslt (compiled Schematron, CII syntax)
//   FIXTURES_DIR      — directory holding manifest.json + fixtures (default: dist/fixtures)
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSvrl } from './lib/reports.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAXON_CP = process.env['SAXON_CP'];
const XSLT = { UBL: process.env['EN16931_UBL_XSLT'], CII: process.env['EN16931_CII_XSLT'] };
const fixturesDir = resolve(process.env['FIXTURES_DIR'] ?? join(root, 'dist/fixtures'));

function die(msg) {
  console.error('✗', msg);
  process.exit(2);
}
if (!SAXON_CP) die('SAXON_CP is not set (classpath: Saxon-HE jar + xmlresolver jar(s)).');
if (!XSLT.UBL || !XSLT.CII) die('EN16931_UBL_XSLT and EN16931_CII_XSLT must both be set.');

// Prefer the manifest (validate exactly the en16931-gate fixtures); fall back to *.xml with a
// syntax guess from the filename (…__ubl / …__cii).
async function targets() {
  try {
    const manifest = JSON.parse(await readFile(join(fixturesDir, 'manifest.json'), 'utf8'));
    return manifest
      .filter((e) => e.gate === 'en16931')
      .map((e) => ({ file: join(fixturesDir, e.file), label: e.file, syntax: e.syntax }));
  } catch {
    return (await readdir(fixturesDir))
      .filter((f) => f.toLowerCase().endsWith('.xml'))
      .map((f) => ({
        file: join(fixturesDir, f),
        label: f,
        syntax: /__ubl/i.test(f) ? 'UBL' : 'CII',
      }));
  }
}

const files = await targets();
if (files.length === 0)
  die(`No XML for the en16931 gate in ${fixturesDir}. Run scripts/gen-fixtures.mjs first.`);

console.log(`EN 16931 Schematron (Saxon-HE) over ${files.length} file(s) in ${fixturesDir}`);
console.log(`  saxon cp: ${SAXON_CP}`);
console.log(`  xslt:     UBL=${XSLT.UBL}\n            CII=${XSLT.CII}\n`);

let failed = 0;
console.log('per-file result:');
for (const { file, label, syntax } of files) {
  const xslt = XSLT[syntax];
  if (!xslt) {
    console.log(`  ✗ ${label}  — FAIL (unknown syntax "${syntax}")`);
    failed++;
    continue;
  }
  // Saxon emits the SVRL report on stdout (the schematron XSLT's xsl:output is XML). Run via
  // -cp …net.sf.saxon.Transform (NOT -jar) so xmlresolver is on the classpath.
  const r = spawnSync(
    'java',
    ['-cp', SAXON_CP, 'net.sf.saxon.Transform', `-s:${file}`, `-xsl:${xslt}`],
    { encoding: 'utf8', cwd: root, maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0 && !r.stdout) {
    console.log(
      `  ✗ ${basename(label)}  — FAIL (Saxon error: ${(r.stderr ?? '').trim().split('\n')[0]})`,
    );
    failed++;
    continue;
  }
  const { fatalCount, warnCount, failures, pass } = parseSvrl(r.stdout);
  console.log(
    `  ${pass ? '✓' : '✗'} ${basename(label)}  — ${pass ? 'PASS' : 'FAIL'} (${syntax}; fatal=${fatalCount}, warn=${warnCount})`,
  );
  if (!pass) {
    failed++;
    if (failures.length) console.log(`      failed rules: ${failures.slice(0, 15).join(', ')}`);
  }
}

console.log(
  failed === 0
    ? `\n✅ EN 16931 GATE PASSED (${files.length}/${files.length} conformant)`
    : `\n❌ EN 16931 GATE FAILED (${failed}/${files.length} non-conformant)`,
);
process.exit(failed === 0 ? 0 : 1);
