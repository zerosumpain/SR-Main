// Bundles the jkai-builder for production. Run via `npm run build:builder`.
//
// The orchestrator's transitive deps reach into SvelteKit's $env virtual
// modules (e.g. $lib/db/index.ts → $env/dynamic/private). Outside the
// SvelteKit runtime there's nothing to resolve those to, so we alias them
// to a tiny env-shim that surfaces process.env directly. The systemd unit's
// EnvironmentFile= line gives us the same env the SvelteKit-side import
// would have seen.
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
  alias: {
    '$env/dynamic/private': resolve(here, 'src/env-shim.ts'),
    '$env/static/private': resolve(here, 'src/env-shim.ts'),
  },
  logLevel: 'info',
});
