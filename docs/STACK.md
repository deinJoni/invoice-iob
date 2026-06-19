# invoice-iob — Authoritative Stack Decisions

Consolidated decision record for the invoice-iob MCP server: a fully local, open-source MCP
server that turns simple invoice details into EN 16931 compliant e-invoices
(XRechnung/UBL/CII XML, a visual PDF, and a ZUGFeRD/Factur-X hybrid PDF/A-3), shipped as a
self-contained Node-only `.mcpb` for Claude Desktop (no LibreOffice / Ghostscript / JVM /
Chromium bundled).

Per-topic depth: [engine](research/engine.md) · [mcp-sdk](research/mcp-sdk.md) ·
[packaging](research/packaging.md) · [pdf](research/pdf.md) · [standards](research/standards.md) ·
[build](research/build.md) · [fonts](research/fonts.md).

---

## Pinned dependencies

| package                             | version                                             | license       | purpose                                                                                  | bundled in .mcpb?                                     |
| ----------------------------------- | --------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `@modelcontextprotocol/sdk`         | **1.29.0**                                          | MIT           | MCP server: `McpServer` + `registerTool` + `StdioServerTransport`                        | **runtime (bundled)**                                 |
| `zod`                               | **4.4.3** (v4)                                      | MIT           | Tool input/output schemas as raw shapes; `import * as z from "zod/v4"`                   | **runtime (bundled)**                                 |
| `@e-invoice-eu/core`                | **3.1.1**                                           | WTFPL         | EN16931 engine: UBL/CII/XRechnung XML + Factur-X/ZUGFeRD PDF/A-3 assembly                | **runtime (bundled)**                                 |
| `@cantoo/pdf-lib`                   | **2.7.1**                                           | MIT           | Render the visual PDF; same class core uses to load+transform                            | **runtime (bundled)**                                 |
| `@pdf-lib/fontkit`                  | **1.1.1**                                           | MIT           | Subset-embed the OFL font (`registerFontkit` + `embedFont({subset:true})`)               | **runtime (bundled)**                                 |
| IBM Plex Sans (Regular+Bold TTF)    | IBM/plex master / `@fontsource/ibm-plex-sans@5.2.8` | OFL-1.1       | Visual PDF font (full TTF, subset at render)                                             | **runtime asset (inlined via esbuild binary loader)** |
| `esbuild`                           | **0.28.1**                                          | MIT           | Bundler (single self-contained `.mjs`)                                                   | dev only                                              |
| `typescript`                        | **6.0.3**                                           | Apache-2.0    | `tsc --noEmit` typecheck (CI source of truth; `skipLibCheck`)                            | dev only                                              |
| `pnpm`                              | **11.8.0**                                          | MIT           | Monorepo workspace manager                                                               | dev only                                              |
| `@anthropic-ai/mcpb`                | **2.1.2**                                           | MIT           | CLI: init/validate/pack/sign/verify the `.mcpb` (NOT the deprecated `@anthropic-ai/dxt`) | dev/CI only                                           |
| KoSIT `validator` (standalone jar)  | **1.6.2**                                           | Apache-2.0    | XSD + EN16931 + BR-DE Schematron validation                                              | **dev/CI only (Java) — never bundled**                |
| `validator-configuration-xrechnung` | **release 2026-01-31**                              | Apache-2.0    | KoSIT scenario config (XRechnung Schematron 2.4.0, CEN rules 1.3.15)                     | **dev/CI only — never bundled**                       |
| veraPDF                             | **1.30**                                            | GPLv3 / MPLv2 | PDF/A-3b conformance (`-f 3b`)                                                           | **dev/CI only (Java) — never bundled**                |
| Mustangproject CLI                  | **2.24.0**                                          | Apache-2.0    | ZUGFeRD/Factur-X profile + container validation (embeds veraPDF)                         | **dev/CI only (Java) — never bundled**                |

Transitive (auto, all pure JS, bundled): `@e965/xlsx` (Apache-2.0, unused), `ajv`, `xmlbuilder2`,
`jsonpath-plus` (unused path; CVE-patched line), `@esgettext/runtime` (WTFPL), `tmp-promise`,
`tslib`, and pdf-lib's pure-JS deps. SDK transitively pulls express/hono/jose — tree-shaken away
for a stdio-only entrypoint.

---

## Engine integration (@e-invoice-eu/core)

One entry point: `new InvoiceService(console).generate(invoice, options)`. Build ONE UBL-syntax
JSON `Invoice` (root `ubl:Invoice` with `cbc:`/`cac:` keys, mapped by EN16931 BT/BG codes) and
reuse it for every format. Omit `cbc:CustomizationID`/`cbc:ProfileID` — the engine fills the
correct per-format URNs.

**XML generation (returns a `string`):**

```ts
import { InvoiceService, type Invoice } from '@e-invoice-eu/core';
const svc = new InvoiceService(console);
const xml = (await svc.generate(invoice, {
  format: 'XRECHNUNG-CII', // or 'XRECHNUNG-UBL' | 'UBL' | 'CII'
  lang: 'de-de',
})) as string;
```

**Factur-X / ZUGFeRD PDF/A-3 — SUPPLY OUR OWN visual PDF (returns `Uint8Array`):**

```ts
const visualPdf: Uint8Array = await renderInvoicePdf(invoice); // our @cantoo/pdf-lib renderer
const pdfA3 = (await svc.generate(invoice, {
  format: 'Factur-X-EN16931', // default profile (Comfort); aliases ZUGFeRD-* normalize
  lang: 'de-de',
  pdf: { buffer: visualPdf, filename: 'invoice.pdf', mimetype: 'application/pdf' }, // NB: "mimetype"
})) as Uint8Array;
```

**LibreOffice-avoidance rule (load-bearing):** for Factur-X/ZUGFeRD ALWAYS pass `options.pdf`
and NEVER pass `options.spreadsheet` or `options.libreOfficePath`. Verified in the shipped
bundle: `getInvoicePdf` returns `options.pdf.buffer` verbatim when present and only reaches
`child_process.spawn(libreoffice)` when `pdf` is absent and `spreadsheet`+`libreOfficePath` are
set. Never use `MappingService`; never pass `embedPDF` without a `pdf`. Add a provider-level
guard asserting `pdf` is set and `spreadsheet`/`libreOfficePath` are never passed. The
LibreOffice code then bundles as harmless dead code.

`FileInfo.mimetype` is lowercase-t (not `mimeType`). Formats are case-insensitive with aliases
(`ZUGFeRD-Comfort` → `factur-x-en16931`). XRechnung target is **3.0**.

---

## MCP server skeleton

High-level `McpServer` + `registerTool` (the deprecated `Server`/`setRequestHandler` and
`.tool()` overloads are out). Schemas are **raw Zod shapes**, not `z.object()`.

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";   // .js extension mandatory
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const log = (...a: unknown[]) => console.error("[invoice-iob]", ...a); // STDERR ONLY

const server = new McpServer(
  { name: "invoice-iob", version: "1.0.0" },
  { capabilities: { tools: {}, logging: {} } }
);

server.registerTool("create_invoice", {
  title: "Create an EN 16931 e-invoice",
  description: "Generates XRechnung/UBL/CII XML, a PDF, and a ZUGFeRD/Factur-X PDF/A-3.",
  inputSchema: { format: z.enum([...]), /* ... raw shape ... */ },   // {} for zero-arg tools
  outputSchema: { format: z.string(), files: z.array(z.string()) },
}, async (args) => {
  try {
    const structured = await doWork(args);
    return { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured };
  } catch (err) {
    return { content: [{ type: "text", text: `Failed: ${(err as Error).message}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
log("ready on stdio");
```

**STDERR-logging rule:** stdout is the JSON-RPC channel; ANY stray stdout write corrupts it and
hangs Claude Desktop on connect. Diagnostics → `console.error` (stderr); client-visible logs →
`server.sendLoggingMessage(...)`. Route any logging library to fd 2. Surface business/validation
failures as `{ content, isError: true }` (the model sees them); `throw` only for
protocol/internal errors (`registerTool` already auto-validates input args).

---

## Build & bundle

**Monorepo manager: pnpm workspaces, NO task runner** (turbo/nx are overkill for core + a few
provider packages producing one bundle; add turbo 2.9.18 later only if cross-package
typecheck+tests get slow).

**Root layout:**

```
invoice-iob/
  pnpm-workspace.yaml            # packages: [ "packages/*" ]
  package.json                   # private, type:module, packageManager pnpm@11.8.0
  tsconfig.json                  # moduleResolution Bundler, skipLibCheck, verbatimModuleSyntax
  scripts/build.mjs              # esbuild driver
  assets/fonts/                  # IBMPlexSans-Regular.ttf, -Bold.ttf, OFL.txt
  packages/
    core/                        # canonical EN16931 model + FormatProvider iface + registry + input mapper
    server/                      # MCP entry (src/index.ts) — bundle entrypoint
    providers-*/                 # per-format providers (xml, facturx) wrapping @e-invoice-eu/core
  manifest.json                  # .mcpb manifest (or under a packaging dir copied into dist/bundle)
  dist/bundle/server/index.js    # the single esbuild artifact every client runs
```

**esbuild:** `bundle: true`, `platform: "node"`, `format: "esm"`, `target: "node22"`, single
`.mjs`, **externalize nothing** (all deps inline; only `node:` builtins external). Required
banner (shebang first byte, then a `createRequire` + `__dirname`/`__filename` shim — needed
because bundled-in CJS transitive deps call `require()` at runtime). **Assets:** inline the OFL
TTFs via `loader: { ".ttf": "binary" }` and `import fontBytes from "...ttf"` (yields a
`Uint8Array`, wrap in `Buffer.from`) so the bundle is fully self-contained with no runtime file
resolution; add ambient `declare module "*.ttf"` decls so tsc passes. Verified: core + SDK +
zod bundle into one ~5.5 MB `.mjs` (smaller minified) that imports cleanly.

**Typecheck is separate from build** — esbuild strips types and never typechecks. Run
`tsc --noEmit` (with `skipLibCheck: true`, which is mandatory because tsc otherwise crawls/hangs
on the Zod4 + SDK `.d.ts` graph) as the CI source of truth; optionally `tsgo` (TS7 beta) for the
fast dev loop. Use raw esbuild via `scripts/build.mjs`, NOT tsup.

---

## Packaging & install matrix

One `dist/bundle/server/index.js` serves every channel; only the wrapper differs. The universal
invocation is the stdio command `node <abs path>/server/index.js` with env
`INVOICE_IOB_OUTPUT_DIR`.

**`.mcpb` for Claude Desktop one-click** — `manifest_version: "0.3"`, `server.type: "node"`,
output folder captured via a `directory` user_config passed through `env`:

```json
{
  "manifest_version": "0.3",
  "name": "invoice-iob",
  "display_name": "Invoice IOB — EN 16931 E-Invoices",
  "version": "1.0.0",
  "description": "EN 16931 e-invoices (XRechnung/UBL/CII XML, visual PDF, ZUGFeRD/Factur-X PDF/A-3). Fully local.",
  "author": { "name": "Jonas Heinz", "email": "jonas.a.heinz@gmail.com" },
  "license": "MIT",
  "icon": "icon.png",
  "server": {
    "type": "node",
    "entry_point": "server/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/index.js"],
      "env": { "INVOICE_IOB_OUTPUT_DIR": "${user_config.output_directory}" }
    }
  },
  "tools": [
    {
      "name": "create_invoice",
      "description": "Create an EN 16931 e-invoice; writes XML + PDF + PDF/A-3 to the output folder."
    },
    {
      "name": "validate_invoice",
      "description": "Validate invoice data/XML against EN 16931 business rules."
    }
  ],
  "tools_generated": false,
  "user_config": {
    "output_directory": {
      "type": "directory",
      "title": "Output folder",
      "description": "Where generated invoice files are written.",
      "multiple": false,
      "required": true,
      "default": "${DOCUMENTS}"
    }
  },
  "compatibility": { "platforms": ["darwin", "win32", "linux"], "runtimes": { "node": ">=18.0.0" } }
}
```

Build flow: `mcpb pack dist/bundle invoice-iob.mcpb` → `mcpb sign invoice-iob.mcpb` (real
code-signing cert from CI secrets for releases; `--self-signed` for nightlies) → `mcpb verify`
as a release gate. Signing matters for a tax-document tool (integrity + verified-publisher
identity). Single-file esbuild bundle, NOT node_modules packing → low single-digit MB.

**Claude Code (`claude mcp add`):**

```bash
claude mcp add invoice-iob --scope project --transport stdio \
  --env INVOICE_IOB_OUTPUT_DIR=/Users/you/Invoices \
  -- node /abs/path/to/dist/bundle/server/index.js
```

The `--` separator is mandatory. Writes `.mcp.json` (project scope).

**Project `.mcp.json` / Claude Desktop `claude_desktop_config.json`** (same `mcpServers` shape):

```json
{
  "mcpServers": {
    "invoice-iob": {
      "command": "node",
      "args": ["/abs/path/to/dist/bundle/server/index.js"],
      "env": { "INVOICE_IOB_OUTPUT_DIR": "/Users/you/Invoices" }
    }
  }
}
```

For `.mcp.json` use env defaults (`${VAR:-default}`) since the var may be unset; optional
`"timeout": 600000` for long PDF/A-3 assembly.

**Generic clients:** Cursor `.cursor/mcp.json` (same `mcpServers`); VS Code `.vscode/mcp.json`
(top-level key `servers`, same `{command,args,env}`, supports `inputs`); any MCP client → the
literal `node <abs>/server/index.js` + env. Optionally publish to npm so args can be
`npx -y invoice-iob`.

---

## PDF/A-3 ownership split

We render the visual PDF with `@cantoo/pdf-lib` (the same lib + version core uses, so a single
`PDFDocument` class round-trips) and hand bytes to core; **core does ALL the PDF/A-3 + Factur-X
machinery.**

**Our source PDF MUST:** subset-embed every font via fontkit (`{subset:true}`); use only
DeviceRGB/DeviceGray (`rgb()`/`grayscale()`, pure-black text); be unencrypted; contain no
AcroForm / JavaScript / multimedia; have no pre-set `/Metadata`, `/OutputIntents`, or `/AF`
tree; keep logos as PNG/JPEG-RGB or SVG (`embedSvg`). `save({ useObjectStreams: false })` is
safer for PDF/A toolchains.

**Our source PDF MUST NOT:** use Standard-14 / non-embedded fonts (core does not embed fonts);
be encrypted (core throws on encrypted input); introduce CMYK/Separation/Lab/ICC-tagged color
(only Device color is covered by core's sRGB OutputIntent); carry its own attachments (let core
add them).

**The engine ADDS (verified in `FormatFacturXService.createPDFA`/`attachFacturX`):** the sRGB
OutputIntent + an INLINE sRGB ICC profile (so **we do NOT ship an ICC profile**); the XMP packet
(`pdfaid:part=3`, `conformance=B`, PDF/A extension schema + Factur-X block, ConformanceLevel
`EN 16931`); the CII XML embedded as an Associated File `factur-x.xml` with
`AFRelationship=Alternative`; `/MarkInfo`+`/StructTreeRoot`; document metadata; a deterministic
SHA-512 trailer `/ID`; link-annotation fixes. The `@cantoo` fork adds nothing here (upstream
pdf-lib already has `attach()`/`AFRelationship`/`/AF`) — its only differentiator is SVG drawing.
core's transform is heuristic and runs no validator → veraPDF + Mustang CI gates are mandatory.

---

## Fonts

**IBM Plex Sans (SIL OFL-1.1), Regular + Bold.** Vendor the FULL static TTFs in `assets/fonts/`
and subset at render via `@pdf-lib/fontkit` `{subset:true}` (don't pre-subset — invoices contain
arbitrary names/diacritics). Full set of German glyphs (ä ö ü Ä Ö Ü ß ẞ), €, §, EU-Latin all
present. Smallest full TTFs (391 KB R+B; ~66 KB embedded subset). Files to vendor:
`IBMPlexSans-Regular.ttf`, `IBMPlexSans-Bold.ttf`, and `OFL.txt` (keep the `Reserved Font Name
"Plex"` notice; never distribute the subset TTF standalone under the reserved name). Source Sans
3 is the documented softer-look alternative. (Carlito/Caladea are OFL-1.1 — _not_ Apache — and
only worth it for Calibri/Cambria metric compatibility.)

---

## PRD corrections (deduplicated — what to deviate from)

1. **Version pins missing in PRD.** Pin `@modelcontextprotocol/sdk@1.29.0`, `zod@^4.4.3` (v4 — use
   `import * as z from "zod/v4"`, NOT v3 as some may assume; the SDK's range is `^3.25 || ^4.0`),
   `@e-invoice-eu/core@3.1.1` (3.x, NOT 2.x; a breaking v4 is signposted — pin and gate),
   `@cantoo/pdf-lib@2.7.1`, `@pdf-lib/fontkit@1.1.1`.
2. **Packaging CLI/extension renamed.** Use `@anthropic-ai/mcpb@2.1.2` and `.mcpb` everywhere —
   `@anthropic-ai/dxt` / `.dxt` is deprecated. Set `manifest_version: "0.3"` (not 0.2).
3. **`@e-invoice-eu/core` license is WTFPL** (and transitive `@esgettext/runtime` too) — not
   MIT/Apache. Permissive but not OSI-approved; flag for license-policy/SBOM/allowlist gates and
   list it in the `.mcpb` NOTICE.
4. **No-LibreOffice promise holds ONLY on the supply-a-PDF path.** core DOES import
   `child_process` and spawns LibreOffice — but exclusively on the spreadsheet→PDF path. We must
   render the visual PDF ourselves and pass `options.pdf.buffer`, never `options.spreadsheet` /
   `options.libreOfficePath`, never use `MappingService`. Add a runtime guard + test. The
   LibreOffice code then bundles as harmless dead code.
5. **Engine input is NOT "simple invoice JSON."** It is a UBL-syntax tree (`ubl:Invoice` +
   `cbc:`/`cac:` keys). Budget for a non-trivial canonical→UBL-JSON serializer (hundreds of
   enumerated, Ajv-enforced fields, BT/BG-mapped). Build ONE input shape for all formats.
6. **`@cantoo/pdf-lib` does NOT "add PDF/A/attachments over upstream."** Upstream pdf-lib 1.17.1
   already has `attach()`/`AFRelationship`/`/AF`. The fork's real addition is SVG drawing. Choose
   `@cantoo` for dep-sharing with core (single `PDFDocument` identity) + maintenance, not PDF/A.
7. **Do NOT ship an sRGB ICC profile** as a required bundled asset for the Factur-X path — core
   embeds its own inline sRGB profile. (Only needed for the optional self-assembly contingency.)
8. **"OFL font subset" should be a FULL OFL TTF subset at runtime,** not pre-subset to a fixed
   glyph set (arbitrary customer/address Unicode would tofu). Inline the full TTF via esbuild
   `loader:'binary'` rather than shipping a sidecar file resolved at runtime.
9. **PDF/A-3 conformance depends on OUR render quality, not just the engine.** core adds
   OutputIntent/XMP/AF but does NOT fix missing embedded fonts or non-device color in our input
   PDF. The engine's pdf-lib PDF/A path is upstream-flagged "not battle tested."
10. **KoSIT validator exits 0 even for invalid invoices** (non-zero only on config/IO errors).
    The §10 "KoSIT pass" gate MUST parse the report for `recommendation=accept` + zero
    `rep:error`, or CI silently passes invalid invoices.
11. **Carlito/Caladea are OFL-1.1, NOT Apache** (PRD's "Apache?"). Liberation Sans is OFL-1.1
    only at v2.0+ (pre-2.0 is GPL+exception).
12. **Standards version drift:** target XRechnung **3.0.2** (Winter 2025/26 bundle), NOT the
    preliminary 4.0; hybrid is ZUGFeRD 2.3.3 / Factur-X 1.07.3; embedded XML filename is
    `factur-x.xml` (not legacy `zugferd-invoice.xml`); pin the KoSIT config to the 2026-01-31
    release. Use the string `EN 16931` for the XMP `fx:ConformanceLevel` ("Comfort" is the legacy
    alias).
13. **`FileInfo.mimetype` is lowercase-t**; the README calls the spreadsheet arg `data` but the
    TS field is `spreadsheet`. Code against the types.
14. **BR-DE-15: BT-10 Buyer reference is mandatory** in every XRechnung — make `buyerReference` a
    required input, never emit empty. B2G additionally needs a valid Leitweg-ID (KoSIT does NOT
    check its checksum — implement it yourself if claiming B2G readiness).
15. **Embedded-XML byte-equality caveat:** the standalone XRechnung CII (schema D16B) and the
    embedded Factur-X CII (D22B) are DIFFERENT documents. The §10 byte-equality check only holds
    when comparing the embedded Factur-X XML against the standalone _Factur-X_ CII artifact, not
    the XRechnung CII.
16. **esbuild ESM needs a `createRequire` banner** (transitive CJS `require()`), and **`tsc`
    needs `skipLibCheck:true`** (otherwise hangs on the Zod4+SDK `.d.ts` graph). Target `node22`
    is a safe floor on Node 24.

---

## Open risks and CI mitigations

| risk                                                                          | mitigation                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine's pdf-lib PDF/A-3 path is "not battle tested" — highest technical risk | CI gate EVERY build: veraPDF `-f 3b` (`isCompliant=true`, `failedChecks=0`) + Mustang `--action validate` (`status=valid`, profile == EN 16931) on real fixtures. |
| LibreOffice/spreadsheet path accidentally taken at runtime                    | Provider guard asserting `options.pdf` set and `spreadsheet`/`libreOfficePath` never passed; unit test the guard.                                                 |
| KoSIT exit-code footgun (0 on invalid)                                        | Parse the VARL report: assert `recommendation=accept` and zero `<rep:error>`; never trust exit code. Run for standalone XML AND extracted embedded XML.           |
| Stray stdout write hangs Claude Desktop                                       | All logs to stderr; test the bundled `.mjs` over a real stdio handshake in CI before shipping.                                                                    |
| Two divergent `@cantoo/pdf-lib` copies → "foreign PDFDocument"                | Pin compatibly with core's `^2.6.5`; assert a single resolved instance.                                                                                           |
| Bundle/`.mcpb` size + asset paths shift after packing                         | Verify the PACKED `.mcpb` end-to-end (not just the dev build); inline assets via binary loader; subset font; confirm low single-digit MB.                         |
| `tsc` hang on Zod4+SDK types                                                  | `skipLibCheck:true`; `tsc --noEmit` as CI source of truth (not tsgo, which is beta).                                                                              |
| WTFPL dependency (engine + esgettext) trips license policy                    | Document in NOTICE/SBOM; get legal sign-off before public launch.                                                                                                 |
| Self-signed `.mcpb` shows unverified publisher                                | Acquire a real code-signing cert before public release; `mcpb verify` as a release gate.                                                                          |
| XRechnung 4.0 / KoSIT version bumps                                           | Isolate the CIUS version in the model; pin validator config; track upstream `@e-invoice-eu/core` + KoSIT releases via dependabot.                                 |
| Validator download URLs rot each release                                      | Resolve artifact URLs via the GitHub releases API in CI, not hardcoded paths.                                                                                     |
| jsonpath-plus CVE history (transitive, unused path)                           | Keep in npm audit scope; 10.4.0 is the patched line.                                                                                                              |
