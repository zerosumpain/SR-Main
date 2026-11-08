// The map page's build (spec §10.10): `vite build` writes dist/<PAGE_HASH>/
// with relative URLs, so a versioned copy can be served from any path.
// PAGE_HASH covers ENGINE_HASH and this package's build inputs
// (scripts/hometowns/page-hash.mjs), so a page-only change builds a new
// folder. The dev server (harness mode, §14.1) may read only this package,
// the engine it imports and the generated PAGE_HASH, nothing else.

import { defineConfig, type Plugin } from 'vitest/config';
import { ENGINE_HASH } from '../../src/lib/games/hometowns/engine/engine-hash.generated';
import { PAGE_HASH } from '../../src/lib/games/hometowns/page-hash.generated';

// Plain paths without Node's url module, so the config type-checks with the page's DOM-only lib.
const here = decodeURIComponent(new URL('.', import.meta.url).pathname);
const engine = decodeURIComponent(new URL('../../src/lib/games/hometowns/engine/', import.meta.url).pathname);
const pageHashFile = decodeURIComponent(new URL('../../src/lib/games/hometowns/page-hash.generated.ts', import.meta.url).pathname);

/**
 * The app loads `/projects/hometowns/<PAGE_HASH>/mobile.html` (§10.7 `client.page`), so the built
 * page is written under that name; the dev server keeps serving index.html.
 *
 * The page also carries both hashes in meta tags, so `scripts/hometowns/deploy-page.sh` and
 * `check-client-live.mjs` can prove that the file served at a page's URL is that page's build, of
 * the engine the server runs.
 */
const ENGINE_META = 'hometowns-engine-hash';
const PAGE_META = 'hometowns-page-hash';
const mobileHtml: Plugin = {
  name: 'hometowns-mobile-html',
  apply: 'build',
  // After Vite's own HTML plugin has put index.html into the bundle.
  enforce: 'post',
  transformIndexHtml() {
    return [
      { tag: 'meta', attrs: { name: ENGINE_META, content: ENGINE_HASH }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: PAGE_META, content: PAGE_HASH }, injectTo: 'head' },
    ];
  },
  generateBundle(_options, bundle) {
    const page = bundle['index.html'];
    if (!page) return;
    page.fileName = 'mobile.html';
    delete bundle['index.html'];
    bundle['mobile.html'] = page;
  },
};

/**
 * The TypeScript options the build compiles the page and the engine with, fixed here. A string
 * stops Vite reading any tsconfig.json (an object only overrides fields of the nearest one, which
 * for the engine is the repository's, extending SvelteKit's generated .svelte-kit/tsconfig.json),
 * so the bundle depends on nothing outside this package that PAGE_HASH does not cover. These are
 * the values the engine was compiled with before (`verbatimModuleSyntax` from SvelteKit's config,
 * class fields from its `esnext` target); tsconfig.json sets the same for `npm run check`.
 */
const TS_TRANSFORM = JSON.stringify({ compilerOptions: { verbatimModuleSyntax: true, useDefineForClassFields: true } });

export default defineConfig({
  base: './',
  plugins: [mobileHtml],
  esbuild: { tsconfigRaw: TS_TRANSFORM },
  server: {
    fs: { strict: true, allow: [here, engine, pageHashFile] },
  },
  build: {
    outDir: `dist/${PAGE_HASH}`,
    emptyOutDir: true,
    target: 'es2022',
    // Pixi is most of the bundle; one cached, versioned file is what the page wants (§10.10).
    chunkSizeWarningLimit: 900,
  },
  worker: { format: 'es' },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
