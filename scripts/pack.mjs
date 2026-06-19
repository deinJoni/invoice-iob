// Packs the built bundle into a one-click .mcpb. Run after scripts/build.mjs.
// Copies the manifest next to the bundled server, then invokes the mcpb CLI.
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = join(root, 'dist/bundle');
const serverFile = join(bundleDir, 'server/index.mjs');
const outFile = join(root, 'dist/invoice-iob.mcpb');

try {
  await stat(serverFile);
} catch {
  console.error('✗ bundle not found — run `node scripts/build.mjs` first.');
  process.exit(1);
}

await mkdir(bundleDir, { recursive: true });
await copyFile(join(root, 'manifest.json'), join(bundleDir, 'manifest.json'));

// `mcpb pack <dir> <out>` validates the manifest and zips the directory.
execFileSync('pnpm', ['exec', 'mcpb', 'pack', bundleDir, outFile], {
  stdio: 'inherit',
  cwd: root,
});

const { size } = await stat(outFile);
console.log(`\n✓ packed ${outFile.replace(root + '/', '')} — ${(size / 1024 / 1024).toFixed(2)} MB`);
