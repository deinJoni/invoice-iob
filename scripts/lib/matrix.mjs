// ─────────────────────────────────────────────────────────────────────────────
// THE VALIDATION MATRIX — single source of truth for "which output paths exist and
// how CI validates each on every push".
//
// Every output `create_invoice` can produce (every format the registry lists, and —
// for hybrids — every profile) is a *path*. CI must validate every path on every
// deployment. This file is the one place that mapping lives:
//
//   • scripts/gen-fixtures.mjs   reads it to generate one fixture per path,
//   • scripts/{kosit,en16931,mustang}-check.mjs read the manifest it produces and
//     validate the fixtures for their gate,
//   • scripts/check-coverage.mjs (THE DRIFT GUARD) asserts this matrix stays in sync
//     with the live registry (list_formats) — adding a format without a row here, or
//     a row without a registered format, FAILS CI with instructions.
//
// ── Adding a new path? ──────────────────────────────────────────────────────────
// Add a `FORMAT_COVERAGE` row keyed by your provider's canonical `meta.id`, pointing
// at the gate that proves its conformance. The drift guard will tell you if you
// forget. See docs/CI.md → "Adding a new path" and CONTRIBUTING.md.
// ─────────────────────────────────────────────────────────────────────────────────

/**
 * The validator gates. `fixtureBased` gates consume the fixtures gen-fixtures writes;
 * `smoke` is satisfied structurally by scripts/smoke.mjs (no external conformance
 * standard exists for a human-readable PDF). `java` gates need a JDK in CI.
 */
export const GATES = {
  kosit: {
    label: 'KoSIT validator + validator-configuration-xrechnung (VARL report)',
    fixtureBased: true,
    java: true,
  },
  en16931: {
    label: 'CEN EN 16931 Schematron via Saxon-HE (SVRL report)',
    fixtureBased: true,
    java: true,
  },
  mustang: {
    label: 'Mustangproject --action validate (embeds veraPDF: PDF/A-3b + Factur-X)',
    fixtureBased: true,
    java: true,
  },
  smoke: {
    label: 'structural sanity in scripts/smoke.mjs (no formal conformance standard)',
    fixtureBased: false,
    java: false,
  },
};

/**
 * Coverage keyed by a provider's canonical `meta.id` (exactly what list_formats reports
 * as `id`). EVERY registered format must appear here and vice-versa — enforced by the
 * drift guard.
 *
 *   gate          which validator proves this path's conformance (key of GATES)
 *   ext           artifact file extension
 *   syntax        'UBL' | 'CII' — only for the en16931 gate (selects the schematron)
 *   profiles      hybrid profiles to generate + validate (one fixture per profile)
 *   embeddedKosit profiles whose embedded factur-x.xml is ALSO extracted and KoSIT-validated
 */
export const FORMAT_COVERAGE = {
  'xrechnung-cii': { gate: 'kosit', ext: 'xml' },
  'xrechnung-ubl': { gate: 'kosit', ext: 'xml' },
  ubl: { gate: 'en16931', ext: 'xml', syntax: 'UBL' },
  cii: { gate: 'en16931', ext: 'xml', syntax: 'CII' },
  pdf: { gate: 'smoke', ext: 'pdf' },
  zugferd: {
    gate: 'mustang',
    ext: 'pdf',
    profiles: ['EN16931', 'BASIC', 'EXTENDED', 'XRECHNUNG'],
    embeddedKosit: ['XRECHNUNG'],
  },
  'factur-x-fr': {
    gate: 'mustang',
    ext: 'pdf',
    profiles: ['EN16931', 'BASIC', 'EXTENDED'],
  },
};

/** Gates whose fixtures gen-fixtures actually writes (everything but `smoke`). */
export const FIXTURE_GATES = Object.entries(GATES)
  .filter(([, g]) => g.fixtureBased)
  .map(([id]) => id);

/**
 * Expand the matrix into one spec per *path* (a format, and for hybrids each profile).
 * gen-fixtures crosses these with every example input to produce the fixtures.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.gates] limit to these gates (default: all fixture-based gates)
 * @returns {{formatId:string, profile:string|null, gate:string, ext:string, syntax:string|null, embedKosit:boolean}[]}
 */
export function fixtureSpecs(opts = {}) {
  const wanted = new Set(opts.gates ?? FIXTURE_GATES);
  const specs = [];
  for (const [formatId, cov] of Object.entries(FORMAT_COVERAGE)) {
    if (!wanted.has(cov.gate)) continue;
    const profiles = cov.profiles ?? [null];
    for (const profile of profiles) {
      specs.push({
        formatId,
        profile,
        gate: cov.gate,
        ext: cov.ext,
        syntax: cov.syntax ?? null,
        embedKosit: Boolean(profile && cov.embeddedKosit?.includes(profile)),
      });
    }
  }
  return specs;
}

/** Deterministic, collision-free fixture filename for an (example, format, profile). */
export function fixtureName(exampleSlug, formatId, profile, ext) {
  const parts = [exampleSlug, formatId];
  if (profile) parts.push(profile);
  return `${parts.join('__')}.${ext}`;
}

/**
 * Cross-check the matrix against the live registry (the canonical ids list_formats
 * reports). Returns a list of human-readable drift problems; empty means in sync.
 * This is the heart of the drift guard.
 *
 * @param {{id:string, profiles?:string[]}[]} liveFormats from list_formats
 */
export function coverageDrift(liveFormats) {
  const problems = [];
  const liveIds = new Set(liveFormats.map((f) => f.id));
  const matrixIds = new Set(Object.keys(FORMAT_COVERAGE));

  for (const id of liveIds) {
    if (!matrixIds.has(id)) {
      problems.push(
        `Format "${id}" is registered but has NO row in scripts/lib/matrix.mjs → it is ` +
          `never validated in CI. Add a FORMAT_COVERAGE["${id}"] row pointing at the gate ` +
          `that proves its conformance (kosit / en16931 / mustang / smoke).`,
      );
    }
  }
  for (const id of matrixIds) {
    if (!liveIds.has(id)) {
      problems.push(
        `scripts/lib/matrix.mjs lists "${id}" but the registry does not (list_formats ` +
          `never returns it). Remove the stale FORMAT_COVERAGE["${id}"] row or fix the id.`,
      );
    }
  }
  for (const [id, cov] of Object.entries(FORMAT_COVERAGE)) {
    if (!GATES[cov.gate]) {
      problems.push(`FORMAT_COVERAGE["${id}"].gate = "${cov.gate}" is not a known gate.`);
    }
    if (cov.gate === 'en16931' && cov.syntax !== 'UBL' && cov.syntax !== 'CII') {
      problems.push(
        `FORMAT_COVERAGE["${id}"] uses the en16931 gate but is missing syntax: 'UBL'|'CII'.`,
      );
    }
  }
  // Hybrid profiles declared in the matrix should match what the provider advertises.
  for (const fmt of liveFormats) {
    const cov = FORMAT_COVERAGE[fmt.id];
    if (!cov || !cov.profiles) continue;
    const advertised = new Set(fmt.profiles ?? []);
    for (const p of cov.profiles) {
      if (advertised.size && !advertised.has(p)) {
        problems.push(
          `FORMAT_COVERAGE["${fmt.id}"] validates profile "${p}" but list_formats does not ` +
            `advertise it (advertised: ${[...advertised].join(', ') || 'none'}).`,
        );
      }
    }
  }
  return problems;
}
