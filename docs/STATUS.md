# invoice-iob — status snapshot

> Living status, maintained by the build loop. Roadmap detail lives in [`../PLAN.md`](../PLAN.md);
> spec in [`../PRD.md`](../PRD.md). Last synthesis: **2026-06-19**.

## Where we are

**The PRD's MVP is met and exceeded.** P0 (extensible core + EN 16931 XML), P1 (visual PDF), and
P2 (ZUGFeRD/Factur-X hybrid PDF/A-3) are shipped and CI-gated. P3 (open up & grow) is underway:
**France shipped end-to-end** as a `FormatProvider` plugin (`factur-x-fr`) with **zero forks of the
core pipeline** — the flagship proof of the extensibility thesis (committed: `feat(france)…`).

### Build health (verified 2026-06-19)

- `pnpm run typecheck` ✅ · `pnpm test` ✅ (33 tests) · `pnpm run build` ✅ (esbuild bundle 4.54 MB;
  packed `.mcpb` ≈ 1.5 MB, well under the 5 MB cap) · `pnpm run smoke` ✅ (all formats over a real
  MCP stdio handshake).
- Hybrid conformance: `Mustang --action validate` + embedded **veraPDF** = **21/21 hybrids valid**
  (DE `zugferd` and FR `factur-x-fr`, profiles EN16931/BASIC/EXTENDED), run locally with JDK 21.

### Stack currency (verified 2026-06-19)

Every pinned dependency equals the current npm `latest` — **nothing to upgrade**:
`@e-invoice-eu/core@3.1.1`, `@anthropic-ai/mcpb@2.1.2` (the `dxt` package is deprecated → renamed to
`mcpb`; we are correct), `@modelcontextprotocol/sdk@1.29.0`, `@cantoo/pdf-lib@2.7.1`, `zod@4.4.3`,
`esbuild@0.28.1`, manifest schema `0.3`.

- **Watch:** upstream `@e-invoice-eu/core` issue #303 (ZUGFeRD/Factur-X **PDF/A-3 XMP** can fail some
  validators). For us this is guarded — our output passes the Mustang + veraPDF gate — so it's a
  monitored risk, not an open defect.
- Minor: `@pdf-lib/fontkit@1.1.1` is the latest but dormant upstream (no action).

## Remaining gaps (prioritized) + ownership

| #   | Gap (PRD ref)                                                                  | Owner                | Status                                                            |
| --- | ------------------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------- |
| 1   | Stale `manifest.json` install copy ("PDF/ZUGFeRD coming")                      | this loop            | **DONE** — now reflects shipped XML/PDF/DE+FR hybrids             |
| 2   | Stale `bug_report.yml` format dropdown ("not yet released")                    | CI/templates session | hand off (file is already in the other session's working set)     |
| 3   | No bundle-size cap **enforced** in CI (§10) — only printed                     | CI session           | recommend: hard-fail `.mcpb` > 5 MB in `pack.mjs`/CI              |
| 4   | Embedded-XML **byte-equality** vs standalone Factur-X CII (§10)                | CI session           | recommend: add equality assertion to the hybrid gate              |
| 5   | Optional **standalone `.xml` alongside hybrid** (§6.5)                         | this loop            | candidate next feature (small `emitXml` flag on `create_invoice`) |
| 6   | CoC contact placeholder `[INSERT CONTACT METHOD]` (§9.2)                       | **owner**            | needs a real contact before public launch                         |
| 7   | P3 open-up: `validate_invoice`, bundle signing, docs site, marketplace listing | later                | explicitly deferred in the PRD                                    |
| 8   | Engine-abstraction unproven for a **non-bundleable** provider (§7.4 risk)      | later                | fine for launch; exercised when IT/ES/PL land                     |

## Notes / coordination

- **A second agent/session is concurrently editing this repo** (CI "validation-matrix" refactor:
  `scripts/lib/matrix.mjs`, `check-coverage.mjs` drift guard, `en16931-check.mjs` Saxon/SVRL gate,
  `ci.yml`). It and the France work share one working tree. This loop commits **only its own files by
  explicit path** (never `git add -A`) and does **not push** without the owner's go-ahead. Gaps #2–#4
  above are in that session's territory and are intentionally left to it.
- Deviations from the PRD sketch (all intentional / documented in `ARCHITECTURE.md`): monorepo is
  richer than §11 (separate `server`, `engine-e-invoice-eu`, `pdf-renderer` packages); manifest is
  `0.3` (PRD said 0.2 default — within the CLI's accepted range).

## This session's changes

- Committed the held France provider + generic core improvements (`feat(france)…`).
- Refreshed `manifest.json` install/tool copy to match shipped reality (incl. France).
- Wrote this status snapshot.
