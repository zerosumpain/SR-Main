import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:5273' });

test('news controls preserve the desk, filters and scroll without a page transition', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/news');
  await expect(page.locator('.story').first()).toBeVisible();
  // SSR renders the controls before hydration attaches their handlers.
  await expect(async () => {
    const filter = page.getByRole('button', { name: 'Hacker News', exact: true });
    await filter.click();
    await expect(filter).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
  }).toPass();
  await page.getByRole('searchbox').fill('hacker');
  await page.locator('.desk').evaluate((element) => element.scrollIntoView({ behavior: 'instant' }));
  const scroll = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => {
    document.querySelector('.news-lede')!.setAttribute('data-preserved', 'yes');
    document.documentElement.dataset.transitions = '0';
    const original = document.startViewTransition?.bind(document);
    if (original) document.startViewTransition = ((...args: Parameters<typeof original>) => {
      document.documentElement.dataset.transitions = String(Number(document.documentElement.dataset.transitions) + 1);
      return original(...args);
    }) as typeof document.startViewTransition;
  });
  let documents = 0;
  page.on('request', (request) => { if (request.resourceType() === 'document') documents++; });

  for (const view of ['New', 'Best', 'Top']) {
    await page.getByRole('navigation', { name: 'Feed order' }).getByRole('link', { name: view, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`view=${view.toLowerCase()}`));
    await expect(page.locator('.desk')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('searchbox')).toHaveValue('hacker');
    await expect(page.getByRole('button', { name: 'Hacker News', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.news-lede')).toHaveAttribute('data-preserved', 'yes');
    expect(Math.abs(await page.evaluate(() => window.scrollY) - scroll)).toBeLessThan(3);
  }
  await page.goBack();
  await expect(page).toHaveURL(/view=best/);
  await expect(page.getByRole('searchbox')).toHaveValue('hacker');
  await expect(page.locator('html')).toHaveAttribute('data-transitions', '0');
  expect(documents).toBe(0);
  await page.screenshot({ path: '/tmp/news-desktop.png' });
});

test('news desk fits a narrow mobile viewport', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/news');
  await expect(page.locator('.story').first()).toBeVisible();
  for (const selector of ['.desk', '.desk-tools', '.desk-summary', '.view-tabs']) {
    expect(await page.locator(selector).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: '/tmp/news-mobile.png' });
});
