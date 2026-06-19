// Proves the conformance-gate report parsers actually distinguish PASS from FAIL — the
// load-bearing safety property of CI. Runs Node-only (no JDK / validators), on every push.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseKositReport, parseMustangReport, parseSvrl } from './reports.mjs';

// ── KoSIT VARL ───────────────────────────────────────────────────────────────
const VARL_ACCEPT = `<?xml version="1.0"?>
<rep:report xmlns:rep="http://www.xoev.de/de/validator/varl/1">
  <rep:scenarioMatched>
    <rep:validationStepResult>
      <rep:message level="information" code="X">ok</rep:message>
    </rep:validationStepResult>
  </rep:scenarioMatched>
  <rep:assessment><rep:accept/></rep:assessment>
</rep:report>`;

const VARL_REJECT = `<?xml version="1.0"?>
<rep:report xmlns:rep="http://www.xoev.de/de/validator/varl/1">
  <rep:scenarioMatched>
    <rep:validationStepResult>
      <rep:message level="error" code="BR-DE-15">buyer reference missing</rep:message>
    </rep:validationStepResult>
  </rep:scenarioMatched>
  <rep:assessment><rep:reject/></rep:assessment>
</rep:report>`;

// The footgun case: verdict says accept but an error finding slipped through → must FAIL.
const VARL_ACCEPT_WITH_ERROR = `<?xml version="1.0"?>
<rep:report xmlns:rep="http://www.xoev.de/de/validator/varl/1">
  <rep:scenarioMatched>
    <rep:validationStepResult>
      <rep:message level="error" code="BR-CO-10">sum mismatch</rep:message>
    </rep:validationStepResult>
  </rep:scenarioMatched>
  <rep:assessment><rep:accept/></rep:assessment>
</rep:report>`;

test('parseKositReport: accept + 0 errors → PASS', () => {
  const r = parseKositReport(VARL_ACCEPT);
  assert.equal(r.recommendation, 'accept');
  assert.equal(r.errorCount, 0);
  assert.equal(r.pass, true);
});

test('parseKositReport: reject → FAIL', () => {
  const r = parseKositReport(VARL_REJECT);
  assert.equal(r.recommendation, 'reject');
  assert.equal(r.pass, false);
});

test('parseKositReport: accept BUT an error finding → FAIL (the VARL footgun)', () => {
  const r = parseKositReport(VARL_ACCEPT_WITH_ERROR);
  assert.equal(r.recommendation, 'accept');
  assert.equal(r.errorCount, 1);
  assert.equal(r.pass, false);
});

test('parseKositReport: no verdict at all (config/IO error) → FAIL', () => {
  assert.equal(parseKositReport('<rep:report/>').pass, false);
});

// ── Mustangproject ───────────────────────────────────────────────────────────
test('parseMustangReport: <summary status="valid"> → PASS', () => {
  const r = parseMustangReport(
    '<validation><summary status="valid"/></validation>\nprofile EN 16931',
    0,
  );
  assert.equal(r.pass, true);
  assert.equal(r.summaryValid, true);
  assert.match(r.profile ?? '', /16931/);
});

test('parseMustangReport: <summary status="invalid"> → FAIL even on exit 0', () => {
  const r = parseMustangReport('<validation><summary status="invalid"/></validation>', 0);
  assert.equal(r.pass, false);
  assert.equal(r.summaryInvalid, true);
});

test('parseMustangReport: detects each profile string', () => {
  for (const p of ['EN 16931', 'EXTENDED', 'BASIC', 'XRECHNUNG']) {
    const r = parseMustangReport(`<summary status="valid"/> profile=${p}`, 0);
    assert.equal(r.pass, true);
    assert.ok(r.profile, `profile parsed for ${p}`);
  }
});

test('parseMustangReport: no summary + non-zero exit → FAIL', () => {
  assert.equal(parseMustangReport('boom: exception', 1).pass, false);
});

// ── SVRL (EN 16931 Schematron) ───────────────────────────────────────────────
const SVRL_CLEAN = `<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl">
  <svrl:fired-rule context="cac:Invoice"/>
  <svrl:successful-report test="x" location="/"/>
</svrl:schematron-output>`;

const SVRL_FATAL = `<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl">
  <svrl:failed-assert flag="fatal" id="BR-01" location="/Invoice">
    <svrl:text>An Invoice shall have a Specification identifier.</svrl:text>
  </svrl:failed-assert>
</svrl:schematron-output>`;

const SVRL_WARNING_ONLY = `<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl">
  <svrl:failed-assert flag="warning" id="BR-CL-01" location="/Invoice">
    <svrl:text>code should be from the list</svrl:text>
  </svrl:failed-assert>
</svrl:schematron-output>`;

test('parseSvrl: no failed-assert → PASS', () => {
  const r = parseSvrl(SVRL_CLEAN);
  assert.equal(r.fatalCount, 0);
  assert.equal(r.pass, true);
});

test('parseSvrl: a fatal failed-assert → FAIL', () => {
  const r = parseSvrl(SVRL_FATAL);
  assert.equal(r.fatalCount, 1);
  assert.deepEqual(r.failures, ['BR-01']);
  assert.equal(r.pass, false);
});

test('parseSvrl: warning-only failed-assert → PASS (warnings do not block)', () => {
  const r = parseSvrl(SVRL_WARNING_ONLY);
  assert.equal(r.warnCount, 1);
  assert.equal(r.fatalCount, 0);
  assert.equal(r.pass, true);
});
