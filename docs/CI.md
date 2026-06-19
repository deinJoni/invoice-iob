# invoice-iob — Continuous Integration

CI lives in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) and runs on every push to
`main`, every pull request, and on manual dispatch.

The governing principle: **a compliance tool earns trust by passing official validators, not by
building.** So CI validates **every output path the server can produce — every format, and for the
hybrid every profile — against its official validator, for every example input, on every push.**

Everything Java (KoSIT, Saxon-HE/EN 16931 Schematron, Mustangproject/veraPDF) is **dev/CI only** and
downloaded on demand (pinned versions, see [`scripts/ci/`](../scripts/ci/)) — none of it is ever
bundled into the Node-only `.mcpb`. See [`docs/STACK.md`](STACK.md) for why.

## The validation matrix (single source of truth)

[`scripts/lib/matrix.mjs`](../scripts/lib/matrix.mjs) maps each **output path** to the **validator
gate** that proves its conformance. Everything downstream is derived from it:

| Output path (`format` id)        | Gate      | Validator                                                                                                                                                                                                                                                      |
| -------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `xrechnung-cii`, `xrechnung-ubl` | `kosit`   | KoSIT validator + `validator-configuration-xrechnung` (VARL report)                                                                                                                                                                                            |
| `ubl`, `cii`                     | `en16931` | CEN EN 16931 Schematron via Saxon-HE (SVRL report)                                                                                                                                                                                                             |
| `pdf`                            | `smoke`   | structural checks in `scripts/smoke.mjs` (no formal conformance standard)                                                                                                                                                                                      |
| `zugferd` / `factur-x`           | `mustang` | Mustangproject `--action validate` — embeds veraPDF (PDF/A-3b) + Factur-X container + embedded-XML EN 16931, for profiles `EN16931` / `BASIC` / `EXTENDED` / `XRECHNUNG`; the `XRECHNUNG` profile's embedded CII is additionally extracted and KoSIT-validated |

Two things consume the matrix:

- **[`scripts/gen-fixtures.mjs`](../scripts/gen-fixtures.mjs)** drives the built bundle over a real
  MCP stdio handshake and writes one fixture per _path × example_ into `dist/fixtures/`, plus a
  `manifest.json` describing each (which gate, which profile, expected verdict). `FIXTURE_GATES=…`
  limits generation to one gate so each CI job stays fast.
- The per-gate checkers (`kosit-check.mjs`, `en16931-check.mjs`, `mustang-check.mjs`) read that
  manifest, validate only their gate's fixtures, and **parse the validator's report** (never the
  exit code — see the footgun note below).

## Jobs

### `build-test` — fast, Java-free, on a Node matrix `{20, 22, 24}`

Proves both the dev/CI runtime and the **shipped bundle's Node floor** (the esbuild target is
`node20`; the `.mcpb` declares `node >=20`):

1. `pnpm install --frozen-lockfile`
2. `pnpm run format:check` — Prettier (Node ≥22 only; a dev-node check)
3. `pnpm run typecheck` — `tsc --noEmit`, the type source of truth (Node ≥22 only)
4. `pnpm test` — `node --test`; unit tests **including the report-parser gate tests** (Node ≥22
   only — `node --test` strips TypeScript types natively on Node ≥22.18, which Node 20 cannot do)
5. `pnpm run build` — esbuild single-file ESM bundle (**every node** — proves the floor builds)
6. `pnpm run check:coverage` — the **drift guard** (every node)
7. `pnpm run pack:mcpb` — `mcpb pack` (every node)
8. `pnpm run smoke` — drives the **packed bundle** over a real MCP stdio handshake (every node);
   this is also the conformance gate for the visual **`pdf`** path
9. uploads `dist/invoice-iob.mcpb` as an artifact (Node 24 only)

Steps 2–4 are skipped on the Node-20 job (they are dev-node checks); 5–8 run on **all three** so a
regression on the floor is caught on push.

### `kosit` — P0 XML exit gate

`needs: build-test`, Node 24 + Temurin JDK 21. Builds, generates the `kosit`-gate fixtures
(XRechnung CII & UBL, for every example), fetches the pinned validator
([`scripts/ci/fetch-kosit.sh`](../scripts/ci/fetch-kosit.sh)), and runs
[`scripts/kosit-check.mjs`](../scripts/kosit-check.mjs). The gate: if any fixture is not accepted,
CI fails.

### `en16931` — generic EN 16931 exit gate (UBL/CII)

`needs: build-test`, Node 24 + JDK 21. The pan-EU `ubl` / `cii` formats are not a national CIUS, so
they are validated against the official **CEN EN 16931 Schematron**
([`ConnectingEurope/eInvoicing-EN16931`](https://github.com/ConnectingEurope/eInvoicing-EN16931),
compiled to XSLT) run with **Saxon-HE**, fetched by
[`scripts/ci/fetch-en16931.sh`](../scripts/ci/fetch-en16931.sh). This is a _second, independent_
implementation of the EN 16931 rules from KoSIT, so the two XML families are cross-checked.
[`scripts/en16931-check.mjs`](../scripts/en16931-check.mjs) parses the SVRL report and fails on any
`<svrl:failed-assert flag="fatal">` (warnings do not block, matching the rule set).

> **Saxon gotcha (load-bearing):** Saxon-HE 12.x throws `NoClassDefFoundError org/xmlresolver/Resolver`
> at startup unless `org.xmlresolver:xmlresolver` is on the **classpath**. So the checker runs
> `java -cp <saxon>:<xmlresolver>:<xmlresolver-data> net.sf.saxon.Transform …`, never `java -jar`.
> `fetch-en16931.sh` downloads all three jars and emits the `SAXON_CP` classpath.

### `pdfa-hybrid` — P2 hybrid exit gate (all profiles)

`needs: build-test`, Node 24 + JDK 21. Generates the hybrid for **every profile × every example**,
then runs **Mustangproject 2.24.0** `--action validate` on each via
[`scripts/mustang-check.mjs`](../scripts/mustang-check.mjs). Mustang's validate **embeds veraPDF**,
so one invocation covers (a) PDF/A-3b conformance and (b) the Factur-X container + the embedded
`factur-x.xml` against the declared profile's EN 16931 rules. The checker parses the report's
`<summary status="valid">`, not the exit code.

It then proves the **`XRECHNUNG`-profile** hybrid's _embedded_ document is itself a valid XRechnung:
[`scripts/extract-embedded.mjs`](../scripts/extract-embedded.mjs) runs Mustang
`--action extract --source <pdf> --out <xml>` (note: the action is `extract`, **not** `pull`, and it
aborts if `--out` already exists), and the extracted CII is run back through `kosit-check.mjs`.

## The drift guard — keeping the tests up to date

`build-test` runs [`scripts/check-coverage.mjs`](../scripts/check-coverage.mjs): it boots the built
bundle, calls `list_formats`, and asserts the **live registry and the matrix are in exact sync** —
no registered format without a gate, no stale matrix row. (`gen-fixtures.mjs` runs the same check,
so the Java jobs are self-consistent too.) The moment someone registers a new format without telling
CI how to validate it, CI fails with the exact fix.

## Adding a new path — the runbook

> A _path_ is anything the server can emit: a format, or — for hybrids — a profile. The drift guard
> fails until the matrix covers it, so this is not optional.

1. **New format provider.** Add a row to [`scripts/lib/matrix.mjs`](../scripts/lib/matrix.mjs)
   `FORMAT_COVERAGE`, keyed by your provider's canonical `meta.id`, pointing at the gate that proves
   its conformance:
   - already covered by KoSIT (an XRechnung-like CIUS) → `gate: 'kosit'`;
   - generic EN 16931 XML → `gate: 'en16931'` (set `syntax: 'UBL' | 'CII'`);
   - a hybrid PDF/A-3 → `gate: 'mustang'` (list its `profiles`, and any `embeddedKosit` profiles);
   - a visual-only artifact with no formal validator → `gate: 'smoke'` (and add structural checks to
     `scripts/smoke.mjs`).
   - **A genuinely new validator** (e.g. SdI for FatturaPA)? Add `scripts/ci/fetch-<tool>.sh`
     (pinned download), a new gate in `GATES`, a `scripts/<tool>-check.mjs` that **parses the report,
     not the exit code**, the parse logic in `scripts/lib/reports.mjs` with a unit test in
     `reports.test.mjs`, and a CI job mirroring the existing ones.
2. **New hybrid profile.** Add it to that format's `profiles` (and `embeddedKosit` if its embedded
   XML should also go through KoSIT). It is generated + validated automatically.
3. **New example input.** Drop a `*.json` into [`examples/`](../examples/). Every gate picks it up
   automatically — no code change.

After any of these, run `pnpm run build && pnpm run check:coverage` to confirm the matrix is in sync.

## The KoSIT VARL footgun (read before trusting CI)

**The KoSIT validator exits `0` even for an INVALID invoice.** A non-zero exit only signals a
config/IO failure — never a failed invoice. Trusting the exit code silently passes invalid
e-invoices. The same "parse the report, not the exit code" discipline applies to Saxon (exits 0
regardless of how many asserts fire) and Mustang (exit code varies across versions).

So the parsing lives in [`scripts/lib/reports.mjs`](../scripts/lib/reports.mjs) and is
**unit-tested** ([`reports.test.mjs`](../scripts/lib/reports.test.mjs)) so a gate can never silently
degrade into an always-pass:

- **KoSIT (VARL):** PASS iff the `<rep:assessment>` verdict is `<rep:accept>` **and** there are zero
  `<rep:message level="error">`. (Real VARL element names — the verdict is `rep:accept`/`rep:reject`,
  errors are `rep:message[@level='error']`.)
- **EN 16931 (SVRL):** PASS iff there are zero `<svrl:failed-assert flag="fatal">` (warnings allowed).
- **Mustang:** PASS iff the report says `<summary status="valid">` (or it exits 0 with no `invalid`
  marker).

## Running the validators locally

The same pinned downloads CI uses are in [`scripts/ci/`](../scripts/ci/); each writes jars into
`.validators/` (git-ignored) and prints the env the checker needs. Requires a JDK (21 in CI; **the
EN 16931 / Saxon gate also runs on JDK 8+**, KoSIT/Mustang need 11+).

```bash
pnpm run build                       # the checkers drive the built bundle
pnpm run fixtures                    # generate every path's fixture into dist/fixtures/

# KoSIT (XRechnung): xrechnung-cii / xrechnung-ubl
eval "$(bash scripts/ci/fetch-kosit.sh)"          # exports KOSIT_JAR + KOSIT_SCENARIOS
node scripts/kosit-check.mjs

# EN 16931 Schematron (generic ubl / cii) — Saxon-HE, JDK 8+
eval "$(bash scripts/ci/fetch-en16931.sh)"        # exports SAXON_CP + EN16931_*_XSLT
node scripts/en16931-check.mjs

# Mustangproject / veraPDF (hybrid, all profiles)
eval "$(bash scripts/ci/fetch-mustang.sh)"        # exports MUSTANG_JAR
node scripts/mustang-check.mjs
node scripts/extract-embedded.mjs                 # extract XRECHNUNG-profile embedded CII
FIXTURES_DIR=dist/embedded node scripts/kosit-check.mjs
```

> Note on byte-equality: the PRD's "embedded XML byte-equals standalone XML" check applies to the
> embedded **Factur-X** CII, not the XRechnung CII (different schema versions — see docs/STACK.md
> correction #15). Mustang validates the embedded XML directly; the `XRECHNUNG`-profile cross-check
> above additionally proves it passes KoSIT as an XRechnung.

> Note on rule versions: the generic `en16931` gate uses the upstream CEN Schematron release, which
> can be a hair newer than the CEN rules bundled inside the pinned KoSIT XRechnung config. That is
> expected — they are two independent validators — and is not a bug if they momentarily differ on a
> brand-new rule.
