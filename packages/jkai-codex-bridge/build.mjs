// Bundles the jkai-codex-bridge for production. Run via:
//   node packages/jkai-codex-bridge/build.mjs
//
// Simpler than the builder/run-worker bundles: this process never touches the
// DB or the workflow engine, so there is no $env virtual module to shim. It
// does import one $lib module (the Codex model catalogue, kept as the single
// source of truth shared with the site), which the repo tsconfig's path alias
// resolves.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

await build({
  entryPoints: [resolve(here, 'bin/start.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: resolve(here, 'dist/start.js'),
  packages: 'external',
  tsconfig: resolve(repoRoot, 'tsconfig.json'),
  logLevel: 'info',
});
