// Pure report-parsing logic for the CI conformance gates, factored out of the check
// scripts so it can be unit-tested WITHOUT a JDK or the validators (scripts/lib/reports.test.mjs).
//
// Why this matters: every one of these validators has a footgun where trusting the exit
// code (or eyeballing output) silently passes INVALID invoices — the KoSIT validator
// famously exits 0 for a rejected invoice. The load-bearing safety property of the whole
// CI is that these functions correctly distinguish PASS from FAIL. The unit tests assert
// exactly that, on every push, so a gate can never silently degrade into an always-pass.

/**
 * KoSIT VARL report (Validation Result Report Language, ns http://www.xoev.de/de/validator/varl/1).
 * A file PASSES iff the assessment verdict is <rep:accept> AND there are zero error-level
 * messages. We parse the report, NEVER the exit code (KoSIT exits 0 even for a reject).
 *
 * @param {string} reportXml
 * @returns {{recommendation: 'accept'|'reject'|null, errorCount: number, pass: boolean}}
 */
export function parseKositReport(reportXml) {
  const xml = String(reportXml);
  // Error findings: <rep:message ... level="error" ...> (attribute order is not fixed).
  const messages = xml.match(/<(?:[A-Za-z0-9_]+:)?message\b[^>]*>/g) ?? [];
  const errorCount = messages.filter((m) => /\blevel\s*=\s*["']error["']/i.test(m)).length;
  // Verdict: <rep:accept> / <rep:reject> under <rep:assessment>, namespace-agnostic.
  let recommendation = null;
  if (/<(?:[A-Za-z0-9_]+:)?accept[\s/>]/.test(xml)) recommendation = 'accept';
  else if (/<(?:[A-Za-z0-9_]+:)?reject[\s/>]/.test(xml)) recommendation = 'reject';
  return { recommendation, errorCount, pass: recommendation === 'accept' && errorCount === 0 };
}

/**
 * Mustangproject `--action validate` report. `--action validate` embeds veraPDF, so a
 * single run covers PDF/A-3b conformance AND the Factur-X container + embedded-XML EN 16931
 * profile. The report's <summary status="valid"> is the primary signal; the exit code is a
 * fallback because it is not consistent across Mustang versions.
 *
 * @param {string} output combined stdout+stderr
 * @param {number|null} exitStatus process exit code (null if it never ran)
 * @returns {{summaryValid: boolean, summaryInvalid: boolean, profile: string|null, pass: boolean}}
 */
export function parseMustangReport(output, exitStatus) {
  const out = String(output);
  const summaryValid = /<summary\b[^>]*\bstatus\s*=\s*["']valid["']/i.test(out);
  const summaryInvalid = /<summary\b[^>]*\bstatus\s*=\s*["']invalid["']/i.test(out);
  const profile =
    /\b(EN\s?16931|EXTENDED|BASIC(?:\sWL)?|MINIMUM|XRECHNUNG|COMFORT)\b/i.exec(out)?.[1] ?? null;
  const pass = summaryValid || (!summaryInvalid && exitStatus === 0);
  return { summaryValid, summaryInvalid, profile, pass };
}

/**
 * SVRL (Schematron Validation Report Language, ns http://purl.oclc.org/dsdl/svrl) — the
 * output of running the CEN EN 16931 Schematron (compiled to XSLT) via Saxon. The EN 16931
 * rules flag each assertion as fatal or warning. A file PASSES iff there are zero
 * fatal <svrl:failed-assert> findings (warnings do not block, matching the EN 16931 rule set).
 *
 * @param {string} svrlXml
 * @returns {{fatalCount: number, warnCount: number, failures: string[], pass: boolean}}
 */
export function parseSvrl(svrlXml) {
  const xml = String(svrlXml);
  const asserts = xml.match(/<(?:[A-Za-z0-9_]+:)?failed-assert\b[^>]*>/g) ?? [];
  let fatalCount = 0;
  let warnCount = 0;
  const failures = [];
  for (const a of asserts) {
    const flag = /\bflag\s*=\s*["']([^"']*)["']/i.exec(a)?.[1]?.toLowerCase();
    const role = /\brole\s*=\s*["']([^"']*)["']/i.exec(a)?.[1]?.toLowerCase();
    const id = /\bid\s*=\s*["']([^"']*)["']/i.exec(a)?.[1] ?? '?';
    // EN 16931 marks warnings with flag/role "warning"; everything else is a hard error.
    const isWarning = flag === 'warning' || role === 'warning';
    if (isWarning) {
      warnCount++;
    } else {
      fatalCount++;
      failures.push(id);
    }
  }
  return { fatalCount, warnCount, failures, pass: fatalCount === 0 };
}
