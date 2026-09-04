// Bundles the jkai-wa-worker for production. Run via `npm run build:wa-worker`.
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
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

// `$lib/*` is mapped in .svelte-kit/tsconfig.json, which the repo tsconfig
// merely extends — and a missing `extends` target is not an esbuild error. So
// without a prior `svelte-kit sync` the alias quietly disappears, `packages:
// 'external'` treats `$lib` as an ordinary package name, and the bundle builds
// clean and then dies on the VPS with
//
//   Error [ERR_MODULE_NOT_FOUND]: Cannot find package '$lib'
//
// That is not hypothetical: deploying from a fresh worktree on 2026-08-11 shipped
// exactly that bundle and crash-looped the production builder. Nothing before
// this point said a word.
const svelteKitTsconfig = resolve(repoRoot, '.svelte-kit/tsconfig.json');
if (!existsSync(svelteKitTsconfig)) {
  console.error(
    `[build:wa-worker] ${svelteKitTsconfig} is missing, so $lib/* would not resolve and the\n` +
      '                bundle would fail at startup, not here. Run `npx svelte-kit sync` first.',
  );
  process.exit(1);
}

const result = await build({
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
  metafile: true,
  logLevel: 'info',
});

// `packages: external` keeps this bundle small, but it also means every bare
// import must survive `npm ci --omit=dev` on the VPS. A package that happens to
// be hoisted from a dev or transitive dependency works on the build runner and
// then crash-loops only in production. Pin every external import as a direct
// runtime dependency and fail while the candidate is still at the gate.
const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const runtimeDependencies = rootPackage.dependencies ?? {};
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);
const packageName = (specifier) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
const externalImports = Object.values(result.metafile.outputs)
  .flatMap((output) => output.imports)
  .filter((entry) => entry.external)
  .map((entry) => entry.path)
  .filter((specifier) => !builtins.has(specifier));
const missingRuntimeDependencies = [...new Set(externalImports.map(packageName))]
  .filter((name) => !runtimeDependencies[name])
  .sort();
if (missingRuntimeDependencies.length > 0) {
  console.error(
    `[build:wa-worker] external runtime imports are not direct production dependencies: ` +
      `${missingRuntimeDependencies.join(', ')}.\n` +
      '                  Add them to dependencies; the VPS installs with --omit=dev.',
  );
  process.exit(1);
}

// Belt as well as braces: assert the shape of what we just produced. The
// pre-flight above covers the cause we have actually seen; this covers any
// other way a SvelteKit virtual import survives into a bundle that has to run
// under plain node. Cheap, and it fails on this machine instead of on the VPS.
const outfile = resolve(here, 'dist/start.js');
const bundle = readFileSync(outfile, 'utf8');
const unresolved = [...bundle.matchAll(/from\s*"(\$(?:lib|app|env)[^"]*)"/g)].map((m) => m[1]);
if (unresolved.length > 0) {
  console.error(
    `[build:wa-worker] ${outfile} still imports ${[...new Set(unresolved)].join(', ')} — these do not\n` +
      '                exist outside the SvelteKit runtime and node will refuse them at startup.',
  );
  process.exit(1);
}
