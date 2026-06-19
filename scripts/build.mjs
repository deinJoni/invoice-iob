// Bundles the MCP server + all workspace packages + runtime deps into a single
// self-contained ESM file for the .mcpb / direct-node execution.
//
// Verified config (see docs/research/build.md): ESM, platform node, target node22,
// externalize nothing (only node: builtins), createRequire banner for transitive CJS deps,
// binary loader for embedded font/ICC assets.
import { build } from 'esbuild';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'packages/server/src/index.ts');
const outfile = resolve(root, 'dist/bundle/server/index.mjs');

// Shebang must be byte 0; createRequire + __dirname/__filename shims are required because
// bundled-in CJS transitive deps call require()/__dirname at runtime under ESM.
const banner = [
  '#!/usr/bin/env node',
  "import { createRequire as __cr } from 'node:module';",
  "import { fileURLToPath as __ftp } from 'node:url';",
  "import { dirname as __dn } from 'node:path';",
  'const require = __cr(import.meta.url);',
  'const __filename = __ftp(import.meta.url);',
  'const __dirname = __dn(__filename);',
].join('\n');

await mkdir(dirname(outfile), { recursive: true });

const result = await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  sourcemap: false,
  banner: { js: banner },
  // Embedded assets (font/ICC) inlined as Uint8Array — keeps the bundle self-contained.
  loader: { '.ttf': 'binary', '.otf': 'binary', '.icc': 'binary' },
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
});

await chmod(outfile, 0o755);

const { size } = await stat(outfile);
const externals = Object.keys(result.metafile.inputs).length;
console.log(
  `\n✓ bundled ${outfile.replace(root + '/', '')}  —  ${(size / 1024 / 1024).toFixed(2)} MB  (${externals} modules inlined)`,
);
