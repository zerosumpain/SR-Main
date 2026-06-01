// Bundles the jkai-run-worker for production. Run via:
//   node packages/jkai-run-worker/build.mjs
//
// Mirrors packages/jkai-builder/build.mjs: the engine's transitive deps reach
// into SvelteKit's $env virtual modules (e.g. $lib/db/index.ts →
// $env/dynamic/private). Outside the SvelteKit runtime there's nothing to
// resolve those to, so we alias them to the same env-shim the builder uses
// (surfaces process.env directly). The launching systemd unit / shell provides
// the same env via EnvironmentFile= / exported vars.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const envShim = resolve(repoRoot, 'packages/jkai-builder/src/env-shim.ts');

await build({
  entryPoints: [resolve(here, 'bin/start.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: resolve(here, 'dist/start.js'),
  packages: 'external',
  tsconfig: resolve(repoRoot, 'tsconfig.json'),
  alias: {
    '$env/dynamic/private': envShim,
    '$env/static/private': envShim,
  },
  // CRITICAL: set the process-role flag at the very top of the bundle, BEFORE
  // any imported module evaluates. The entry's `process.env... = '1'` statement
  // is textually before the import, but ESM hoists imports above it, so the
  // platform-service boot guards in $lib/workflows/index.ts (WhatsApp socket,
  // scheduler, reaper, memory review — all gated on JKAI_BUILDER_PROCESS) would
  // otherwise run before the flag is set. The banner runs first, so the worker
  // process boots ONLY the engine + queue, never the web platform services.
  banner: {
    js: "process.env.JKAI_BUILDER_PROCESS = process.env.JKAI_BUILDER_PROCESS || '1';",
  },
  logLevel: 'info',
});
