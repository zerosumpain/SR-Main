// The page project's browser checks (spec §12.2): Playwright WebKit (the
// engine of the iPhone's WKWebView) runs the engine to the same hash as
// Node, the map's frames stay inside budget on the fixture metropolis, and
// harness mode is screenshotted. Run from the repository root, where
// Playwright is installed:
//
//   npx playwright install webkit
//   npx playwright test -c games/hometowns-view/playwright.config.ts
//
// HOMETOWNS_E2E_CHROMIUM=1 adds a Chromium project, for a machine without
// WebKit (V8 against V8 proves less, but it checks the page itself).

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.HOMETOWNS_E2E_PORT ?? 15588);

export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  use: { baseURL: `http://127.0.0.1:${PORT}/mobile.html` },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ...(process.env.HOMETOWNS_E2E_CHROMIUM === '1' ? [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }] : []),
  ],
  // The built page itself (dist/<ENGINE_HASH>/mobile.html, what the app loads), served on loopback for
  // this run only; the local preview's :15480 is WP9's dev server.
  webServer: {
    command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: decodeURIComponent(new URL('.', import.meta.url).pathname),
    url: `http://127.0.0.1:${PORT}/mobile.html`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
