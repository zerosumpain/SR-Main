import { defineConfig } from 'vitest/config';

// Explicit local config so vitest does NOT walk up and inherit the parent
// SvelteKit project's vite + vite-plugin-svelte config. This stub is a
// standalone Node-only package.
export default defineConfig({
  root: __dirname,
  test: {
    include: ['**/*.test.ts'],
    environment: 'node',
  },
});
