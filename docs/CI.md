# invoice-iob — Continuous Integration

CI lives in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) and runs on every push to
`main`, every pull request, and on manual dispatch. It closes the P0 exit-gate item from
[`PLAN.md`](../PLAN.md): the generated XML must pass **KoSIT** validation, not just build.

Everything Java (KoSIT, and later veraPDF/Mustang) is **dev/CI only** and is downloaded on demand —
none of it is ever bundled into the Node-only `.mcpb`. See [`docs/STACK.md`](STACK.md) for why.

## Jobs

### `build-test`

The fast feedback loop, on `ubuntu-latest` / Node 24:

1. `corepack enable` (pins pnpm from the `packageManager` field — no `pnpm/action-setup` needed)
2. `pnpm install --frozen-lockfile`
3. `pnpm run typecheck` — `tsc --noEmit` (the type source of truth; esbuild never typechecks)
4. `pnpm test` — `node --test` unit tests
5. `pnpm run build` — esbuild single-file ESM bundle → `dist/bundle/server/index.mjs`
6. `pnpm run pack:mcpb` — `mcpb pack` → `dist/invoice-iob.mcpb`
7. `pnpm run smoke` — drives the **packed bundle** over a real MCP stdio handshake (catches the
   stray-stdout-write footgun before it ships)

The `dist/invoice-iob.mcpb` is uploaded as a build artifact. The pnpm store is cached via
`actions/setup-node`'s `cache: pnpm`.

### `kosit` — P0 exit gate

`needs: build-test`. Sets up Node 24 + Temurin JDK 21, installs, rebuilds the bundle, then:

1. `node scripts/gen-fixtures.mjs` — drives the bundle (same MCP client pattern as the smoke test)
   to write `XRECHNUNG-CII` and `XRECHNUNG-UBL` into `dist/fixtures/`.
2. Downloads the **KoSIT validator 1.6.2** standalone jar and the
   **validator-configuration-xrechnung (release `v2026-01-31`, XRechnung Schematron 2.4.0)**
   configuration zip. The asset download URLs are **resolved at runtime via the GitHub Releases
   API** (`gh api repos/itplr-kosit/validator/releases/tags/v1.6.2`, and the same for
   `validator-configuration-xrechnung`) rather than hardcoded — release asset paths rot. Documented
   fallback URLs are kept in a comment in the workflow.
3. `node scripts/kosit-check.mjs` — validates every `dist/fixtures/*.xml` and **parses the report**.

This job is the gate: if any fixture is not accepted, CI fails.

### `pdfa-hybrid` — P2 hybrid gate

Generates the ZUGFeRD/Factur-X hybrid fixture (`gen-fixtures.mjs` emits `…-zugferd.pdf`), then runs
**Mustangproject 2.24.0** `--action validate` on it via `scripts/mustang-check.mjs`. Mustang's
validate **embeds veraPDF**, so a single invocation covers (a) PDF/A-3b conformance and (b) the
Factur-X container + the embedded `factur-x.xml` against EN 16931. The checker parses the report's
`<summary status="valid">` rather than trusting the exit code (which varies across versions).

> Note on byte-equality: the PRD's "embedded XML byte-equals standalone XML" check applies to the
> embedded **Factur-X** CII, not the XRechnung CII (different schema versions — see docs/STACK.md
> correction #15). The embedded XML *is* the Factur-X CII (there is no separate standalone artifact
> for it), and Mustang validates it directly, so that gate is satisfied by the Mustang pass.

## The KoSIT VARL footgun (read before trusting CI)

**The KoSIT validator exits `0` even for an INVALID invoice.** A non-zero exit only signals a
config/IO failure (bad `scenarios.xml`, missing repository) — never a failed invoice. Trusting the
exit code silently passes invalid e-invoices.

So [`scripts/kosit-check.mjs`](../scripts/kosit-check.mjs) ignores the exit code and parses each
`*-report.xml` (VARL — Validation Result Report Language, namespace
`http://www.xoev.de/de/validator/varl/1`). A file PASSES only when both hold:

- the assessment verdict is **`<rep:accept>`** (under `<rep:assessment>`), and
- there are **zero `<rep:message level="error">`** findings.

Note the real VARL element names: the verdict is `rep:accept` / `rep:reject` (not a
`rep:recommendation` text node), and errors are `rep:message[@level='error']` (not a `rep:error`
element). The script matches the actual XÖV output namespace-agnostically. The script prints a
per-file `PASS`/`FAIL` line and exits non-zero on any `FAIL`.

## Running the validators locally

```bash
# 1. Build + generate the XML fixtures into dist/fixtures/
pnpm run build
node scripts/gen-fixtures.mjs

# 2. Fetch the pinned KoSIT validator + XRechnung configuration (downloaded, never committed —
#    .gitignore already excludes /.validators/ and *.jar).
mkdir -p .validators
curl -fsSL -o .validators/validator-standalone.jar \
  https://github.com/itplr-kosit/validator/releases/download/v1.6.2/validator-1.6.2-standalone.jar
curl -fsSL -o .validators/config.zip \
  https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/v2026-01-31/xrechnung-3.0.2-validator-configuration-2026-01-31.zip
unzip -q .validators/config.zip -d .validators/config

# 3. Point the checker at the jar + scenarios.xml and run the gate.
export KOSIT_JAR="$PWD/.validators/validator-standalone.jar"
export KOSIT_SCENARIOS="$(find .validators/config -maxdepth 2 -name scenarios.xml | head -n1)"
node scripts/kosit-check.mjs        # validates dist/fixtures/*.xml; override with FIXTURES_DIR=...
```

Requires a JDK (21 in CI; any 11+ works locally). The validator resolves its Schematron/XSD
relative to the directory of the `scenarios.xml` you pass — `kosit-check.mjs` derives that
repository directory for you.

### P2 validators (hybrid PDF)

```bash
# veraPDF — PDF/A-3b conformance
verapdf -f 3b dist/fixtures/<invoice>.pdf        # assert isCompliant=true, failedChecks=0

# Mustangproject — Factur-X/ZUGFeRD profile + container
java -jar Mustang-CLI-2.24.0.jar --action validate --source dist/fixtures/<invoice>.pdf
#   assert status=valid AND profile == "EN 16931"
```
