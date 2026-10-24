// The map page's build (spec §10.10): `vite build` writes dist/<ENGINE_HASH>/
// with relative URLs, so a versioned copy can be served from any path. The
// dev server (harness mode, §14.1) may read only this package and the
// engine it imports, nothing else in the repository.

import { defineConfig } from 'vitest/config';
import { ENGINE_HASH } from '../../src/lib/games/hometowns/engine/engine-hash.generated';

// Plain paths without Node's url module, so the config type-checks with the page's DOM-only lib.
const here = decodeURIComponent(new URL('.', import.meta.url).pathname);
const engine = decodeURIComponent(new URL('../../src/lib/games/hometowns/engine/', import.meta.url).pathname);

export default defineConfig({
  base: './',
  server: {
    fs: { strict: true, allow: [here, engine] },
  },
  build: {
    outDir: `dist/${ENGINE_HASH}`,
    emptyOutDir: true,
    target: 'es2022',
    // Pixi is most of the bundle; one cached, versioned file is what the page wants (§10.10).
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
