/**
 * THE OFFLINE PACK'S SHELL — a second, deliberately small Vite build.
 *
 * `npm run build:offline` compiles the policy dashboard into ONE IIFE and ONE
 * stylesheet under `static/policy-offline/`. The export endpoint then reads
 * those two files off disk and interpolates them into an HTML skeleton, so
 * producing a pack at request time is string concatenation — no headless
 * browser, no bundler in the request path, and the same bytes every time.
 *
 * WHY NOT REUSE THE SVELTEKIT BUILD: its client output is a module graph of
 * hashed chunks that resolve against a server's URL space. A `file://` page can
 * load none of it, and reading the chunk graph out of `.svelte-kit/output` to
 * reassemble it is the kind of thing that breaks silently on a framework
 * upgrade. A separate entry costs one config and cannot drift, because it
 * compiles the same components from the same source.
 *
 * WHAT IT MAY IMPORT: the dashboard's dependency graph is `$lib/policy-analysis`
 * and `svelte`, and nothing else — every component under
 * `$lib/components/policy-analysis` takes props and makes no request of its own.
 * If this build starts failing on an unresolved `$app/...`, a component has
 * acquired a SvelteKit dependency and the offline pack is the thing that noticed.
 */
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // `app.css` opens with `@import 'tailwindcss'`, and preflight is part of how
  // this page is laid out — the dashboard was built with the reset applied, so
  // dropping it would give every heading and list its user-agent margins back.
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
  },
  // Nothing here references a file in `static/`, and pointing at it would make
  // the build copy the whole directory — including the pack's own output — into
  // itself on every run.
  publicDir: false,
  build: {
    outDir: 'static/policy-offline',
    emptyOutDir: true,
    cssCodeSplit: false,
    target: 'es2022',
    lib: {
      entry: fileURLToPath(new URL('./src/lib/policy-analysis/offline/entry.ts', import.meta.url)),
      // IIFE, not ES: a `<script type="module">` is subject to CORS even from a
      // file:// page, and a double-clicked pack would execute nothing.
      formats: ['iife'],
      name: 'PolicyOfflinePack',
      fileName: () => 'app.js',
      // Vite would otherwise name the stylesheet after the package. The export
      // endpoint reads these two files by name, so both are pinned.
      cssFileName: 'app',
    },
  },
});
