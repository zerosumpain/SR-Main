import { defineConfig } from '@playwright/test';

// Note: port 5173 is occupied on homeserv by the always-on production svelte
// service (strange-rambling-svelte.service — required for VPS scraper proxy).
// Run the e2e dev server on 5273 instead to avoid the conflict.
const PORT = Number(process.env.PLAYWRIGHT_DEV_PORT ?? 5273);

export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 30_000,
	use: {
		baseURL: `http://localhost:${PORT}`,
	},
	webServer: {
		command: `NODE_OPTIONS=--max-old-space-size=8192 npm run dev -- --port ${PORT}`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: true,
		timeout: 180_000,
	},
});
