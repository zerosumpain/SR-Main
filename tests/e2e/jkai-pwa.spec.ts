import { test, expect } from '@playwright/test';

test.describe('jkai PWA scoping', () => {
	test('non-jkai page does not register a service worker', async ({ page }) => {
		await page.goto('/');
		await page.waitForLoadState('networkidle');
		const regs = await page.evaluate(async () => {
			if (!('serviceWorker' in navigator)) return [];
			const list = await navigator.serviceWorker.getRegistrations();
			return list.map((r) => r.scope);
		});
		expect(regs).toEqual([]);
	});

	test('jkai page registers a service worker scoped to /jkai/', async ({ page }) => {
		// vite-pwa does not serve the generated SW in `vite dev` unless
		// `devOptions.enabled: true` is set in vite.config.ts, which we
		// deliberately leave off to avoid polluting local dev with a real SW.
		// The SW registration path is exercised by the production build; this
		// e2e should be re-enabled once the suite runs against `vite preview`.
		test.skip(true, 'vite-pwa dev: SW disabled; rerun against `vite preview` build');
		await page.goto('/jkai');
		await page.waitForFunction(
			async () => {
				const list = await navigator.serviceWorker?.getRegistrations();
				return (list?.length ?? 0) > 0;
			},
			undefined,
			{ timeout: 15_000 }
		);
		const regs = await page.evaluate(async () => {
			const list = await navigator.serviceWorker.getRegistrations();
			return list.map((r) => r.scope);
		});
		expect(regs.some((s) => s.endsWith('/jkai/'))).toBe(true);
	});

	test('jkai page links a manifest, homepage does not', async ({ page }) => {
		await page.goto('/jkai');
		expect(await page.locator('link[rel=manifest]').count()).toBeGreaterThan(0);
		await page.goto('/');
		expect(await page.locator('link[rel=manifest]').count()).toBe(0);
	});
});
