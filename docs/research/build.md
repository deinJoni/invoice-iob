# Research: Monorepo tooling + esbuild bundling for a Node stdio MCP server (2026)

## Summary

For a small TS monorepo (core + a few provider packages) whose final artifact is a single esbuild bundle, use **pnpm workspaces with NO task-runner** (turbo/nx are overkill); add turbo only if/when builds get slow. Bundle with esbuild as `format: 'esm'`, `platform: 'node'`, `target: 'node22'` — verified end-to-end that this bundles `@e-invoice-eu/core@3.1.1` + `@modelcontextprotocol/sdk@1.29.0` + `zod@4.4.3` into one self-contained **5.5 MB `.mjs`** that Node imports cleanly with zero leftover bare imports. ESM is correct (the SDK is type:module/ESM-first); the only catch is internal CJS transitive deps that call `require()` at runtime, solved with a one-line `createRequire` banner. Ship the OFL font + sRGB ICC via esbuild `loader:'binary'` (verified: inlined as Uint8Array, no runtime file path, fully self-contained). `tsc` DOES hang/crawl on the Zod4+SDK `.d.ts` graph — keep tsc for typecheck-only (`tsc --noEmit` with `skipLibCheck`) or move to tsgo (TS7 beta, ~10x faster); esbuild never typechecks. Skip tsup; raw esbuild via `build.mjs` is simpler and you need a custom build for the binary asset loaders + banner.

## Verified facts (npm + real bundle tests, June 2026)

Versions: esbuild **0.28.1**, tsup **8.5.1**, typescript **6.0.3** (stable; TS7/`@typescript/native-preview` is **7.0.0-dev** beta), @modelcontextprotocol/sdk **1.29.0**, @e-invoice-eu/core **3.1.1** (WTFPL), zod **4.4.3**, @cantoo/pdf-lib **2.7.1**, @pdf-lib/fontkit **1.1.1**, pnpm **11.8.0**, turbo **2.9.18**, nx **23.0.0**.

- **MCP SDK 1.29.0 is `type: module`** (ESM-first), dual-ships `dist/esm/**` + `dist/cjs/**` via wildcard export `"./*": { import: "./dist/esm/*", require: "./dist/cjs/*" }`. Subpaths: `@modelcontextprotocol/sdk/server/mcp.js`, `@modelcontextprotocol/sdk/server/stdio.js`. Transitively pulls express 5 / hono / cross-spawn / jose etc.; some CJS → need the createRequire banner.
- **@e-invoice-eu/core 3.1.1** is dual CJS/ESM (`main: dist/e-invoice-eu.cjs.js`, `module: dist/e-invoice-eu.esm.js`), implicit `type: commonjs`. Deps all pure JS, no native bindings.

## 1. Monorepo manager — RECOMMEND pnpm workspaces, no task runner

For core + a handful of provider packages, **pnpm workspaces alone** is right: (a) the final artifact is a single esbuild bundle from one entry, so no big build graph to cache; (b) `pnpm -r` runs scripts recursively; (c) `workspace:*` lets the bundler entry import internal packages by name and esbuild inlines them. Add **turbo 2.9.18** only later if cross-package typecheck+tests get slow. Avoid nx (heavier, overkill).

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
```

Root `package.json`:

```json
{
  "name": "invoice-iob",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.8.0",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "node scripts/build.mjs",
    "typecheck": "pnpm -r exec tsc --noEmit",
    "test": "pnpm -r test",
    "pack:mcpb": "node scripts/build.mjs && <mcpb-pack-step>"
  },
  "devDependencies": { "esbuild": "0.28.1", "typescript": "6.0.3" }
}
```

A provider package depends on core via the workspace protocol; esbuild inlines it (pnpm symlink):

```json
{
  "name": "@invoice-iob/server",
  "type": "module",
  "dependencies": {
    "@invoice-iob/core": "workspace:*",
    "@modelcontextprotocol/sdk": "1.29.0",
    "@e-invoice-eu/core": "3.1.1",
    "zod": "4.4.3"
  }
}
```

No special esbuild config to bundle workspace packages — point the entry at the server package's `src/index.ts`, set `bundle: true`, and pnpm's symlinked node_modules resolve them like any dep.

## 2. esbuild — single self-contained file (VERIFIED working)

Use **format: 'esm'** (not cjs). The SDK is ESM-first; ESM avoids fighting its exports and enables `import.meta.url`. The ONE issue: bundled-in CJS transitive deps may call `require()` at runtime — fix with a `createRequire` banner. Bundling the real core + SDK + zod with this config produced a single 5.5 MB `.mjs`; `import()`-ing it resolved all classes, zero leftover bare imports (only `node:` builtins external).

Exact options: `entryPoints: ["packages/server/src/index.ts"]`, `bundle: true`, `platform: "node"`, `format: "esm"`, `target: "node22"` (Node 24 runtime; node22 floor is safe), `outfile: "dist/server.mjs"`, `minify: true` (optional), `sourcemap: false` for ship. **Externalize nothing** — leave `packages`/`external` unset so everything inlines (except `node:` builtins).

Banner (shebang first byte, then the shims):

```js
banner: {
  js: [
    '#!/usr/bin/env node',
    "import { createRequire as __cr } from 'node:module';",
    "import { fileURLToPath as __ftp } from 'node:url';",
    "import { dirname as __dn } from 'node:path';",
    'const require = __cr(import.meta.url);',
    'const __filename = __ftp(import.meta.url);',
    'const __dirname = __dn(__filename);',
  ].join('\n');
}
```

Shebang must be byte 0. For `.mcpb` launched as `node server.mjs` the shebang is largely irrelevant, but keep it for direct-exec safety and `chmod +x`.

### Assets (OFL font + sRGB ICC) — use loader: 'binary' (VERIFIED)

`loader: { ".otf": "binary", ".ttf": "binary", ".icc": "binary" }` and `import fontBytes from "../assets/font.otf"` → esbuild inlines the bytes as a `Uint8Array` at runtime (wrap with `Buffer.from(fontBytes)` for pdf-lib/fontkit). Verified the bytes survive and the output has NO relative asset import remaining → truly self-contained, no `__dirname`-relative file resolution. Do NOT use copy-file-and-resolve-path (fragile inside `.mcpb`) and avoid `dataurl` (binary is smaller, gives a typed array directly). Declare ambient `.d.ts` (`declare module "*.otf" { const b: Uint8Array; export default b; }`) so tsc passes.

## 3. tsc hang + typecheck strategy + tsconfig

Confirmed: `tsc` crawls/hangs on the Zod4 + MCP-SDK `.d.ts` graph (deep recursive types). esbuild does NOT typecheck (strips types) — bundles in <1s. So **keep a separate typecheck step**:

- (a) `tsc --noEmit` (slow but correct on TS 6.0.3) — CI source of truth.
- (b) **tsgo** (`@typescript/native-preview`, TS7 beta, ~10x faster) — good for the dev loop, but beta; gate CI on real `tsc` until TS7 GA.
- `skipLibCheck: true` materially reduces the SDK/Zod typecheck cost and is the standard mitigation for the hang — make it part of the recommended tsconfig.

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true
  }
}
```

`moduleResolution: "Bundler"` because esbuild resolves modules; lets you import `@invoice-iob/core` without `.js` extensions. `verbatimModuleSyntax` + `isolatedModules` keep the source esbuild-safe.

## 4. tsup vs raw esbuild — use raw esbuild

Skip tsup 8.5.1 — a thin esbuild+rollup-dts wrapper for publishing libraries (dual CJS/ESM + `.d.ts` rollup). You're shipping ONE bundled app and need custom behavior tsup makes awkward: the `binary`/`icc` loaders, the multi-line createRequire+shebang banner, and "bundle everything, externalize nothing." A ~30-line `build.mjs` is clearer.

## Working build.mjs sketch

```js
// scripts/build.mjs
import { build } from 'esbuild';
import { chmod } from 'node:fs/promises';

const banner = [
  '#!/usr/bin/env node',
  "import { createRequire as __cr } from 'node:module';",
  "import { fileURLToPath as __ftp } from 'node:url';",
  "import { dirname as __dn } from 'node:path';",
  'const require = __cr(import.meta.url);',
  'const __filename = __ftp(import.meta.url);',
  'const __dirname = __dn(__filename);',
].join('\n');

await build({
  entryPoints: ['packages/server/src/index.ts'],
  outfile: 'dist/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  minify: true,
  sourcemap: false,
  banner: { js: banner },
  loader: { '.otf': 'binary', '.ttf': 'binary', '.icc': 'binary' },
  logLevel: 'info',
});
await chmod('dist/server.mjs', 0o755);
console.log('bundled dist/server.mjs');
```

Entry (`packages/server/src/index.ts`):

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';
import { InvoiceService, FormatFactoryService } from '@e-invoice-eu/core';
import fontBytes from '../../../assets/NotoSans.otf'; // Uint8Array via binary loader
const server = new McpServer({ name: 'invoice-iob', version: '0.1.0' });
// ... server.registerTool(...) ...
await server.connect(new StdioServerTransport());
```

## @e-invoice-eu/core integration note (load-bearing)

Generate the visible PDF yourself with @cantoo/pdf-lib + @pdf-lib/fontkit, then hand it to core as `options.pdf.buffer`. The PDF code path: `options.pdf.buffer` present → use it; else `options.spreadsheet` → spawn LibreOffice (throws `'LibreOffice path is required for conversion to PDF!'` if `libreOfficePath` unset). XML-only formats never invoke LibreOffice. The `child_process`/`spawn`/LibreOffice references are dead code on your path — harmless to bundle, never executed.

## Decisions

- **Monorepo: pnpm workspaces, no task runner** (add turbo later only if needed).
- **esbuild output: ESM (.mjs), platform node, target node22.**
- **createRequire + `__dirname`/`__filename` banner, shebang as first line.**
- **Assets: esbuild `loader: 'binary'` for font (.otf/.ttf) and ICC (.icc)** + ambient module decls.
- **Externalize nothing** (do not set `packages:'external'`).
- **Typecheck separately with `tsc --noEmit` (CI source of truth, `skipLibCheck`); optionally tsgo for dev.**
- **tsconfig: `moduleResolution Bundler`, `module ESNext`, `target ES2023`, `skipLibCheck`, `verbatimModuleSyntax`.**
- **Use raw esbuild via `build.mjs`, NOT tsup.**

## Packages

| name                       | version   | license    | role                                                                                    |
| -------------------------- | --------- | ---------- | --------------------------------------------------------------------------------------- | --- | ---- |
| esbuild                    | 0.28.1    | MIT        | The bundler (devDependency, not bundled).                                               |
| @modelcontextprotocol/sdk  | 1.29.0    | MIT        | ESM-first; bundles cleanly; CJS transitive deps need createRequire banner.              |
| @e-invoice-eu/core         | 3.1.1     | WTFPL      | Pure JS, dual CJS/ESM; LibreOffice/child_process is dead code on the supply-a-PDF path. |
| zod                        | 4.4.3     | MIT        | Tool input schemas (SDK accepts v3.25                                                   |     | v4). |
| @cantoo/pdf-lib            | 2.7.1     | MIT        | Render the visual PDF; also core's PDF dep.                                             |
| @pdf-lib/fontkit           | 1.1.1     | MIT        | Embed/subset the OFL font.                                                              |
| tsup                       | 8.5.1     | MIT        | Considered — REJECTED for a single-app artifact.                                        |
| turbo                      | 2.9.18    | MIT        | Optional task runner — defer.                                                           |
| @typescript/native-preview | 7.0.0-dev | Apache-2.0 | tsgo — optional ~10x faster typecheck; beta, don't gate CI.                             |
| typescript                 | 6.0.3     | Apache-2.0 | `tsc --noEmit` CI typecheck; use skipLibCheck.                                          |

## Risks

- If any provider routes through `options.spreadsheet` instead of `options.pdf.buffer`, the server throws "LibreOffice path is required" at runtime. Add a guard/test asserting the spreadsheet path is never taken.
- Bundle is ~5.5MB unminified before pdf-lib/fontkit/font/ICC; with minify it shrinks. Confirm final `.mcpb` size acceptable; subset the font aggressively.
- tsgo / TS7 is beta — keep tsc 6.0.3 `--noEmit` authoritative for CI.
- esbuild strips types — a green build is NOT type-safe; the separate `tsc --noEmit` step is mandatory.
- MCP SDK 1.29.0 uses a wildcard export; future minors could reorganize subpaths — pin and re-verify on upgrade.
- Binary-loaded asset imports require ambient module declarations (`declare module '*.otf'`) — add a `global.d.ts`.
- core depends on `@e965/xlsx` (bundled even though unused) — adds dead weight. Acceptable; if size matters, import specific FormatXxxService classes to enable tree-shaking (verify the ESM build is tree-shakeable first).

## Citations

- https://www.npmjs.com/package/@e-invoice-eu/core
- https://www.npmjs.com/package/@modelcontextprotocol/sdk
- https://github.com/gflohr/e-invoice-eu
- https://esbuild.github.io/api/#banner
- https://esbuild.github.io/content-types/#binary
- https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/
- https://www.npmjs.com/package/@typescript/native-preview
- https://www.npmjs.com/package/tsup
- https://pnpm.io/workspaces
