import { expect, test } from '@playwright/test';
import { encode } from '@auth/core/jwt';

const origin = process.env.POLICY_LAB_TEST_ORIGIN ?? 'http://127.0.0.1:5275';
test.skip(!process.env.POLICY_LAB_LOCAL_TESTS, 'Explicit isolated local stack only');
test.use({ baseURL: origin });

test('private synthetic workflow: source, approvals, immutable run, reproducibility and reports', async ({ page, request }) => {
  test.setTimeout(180000);
  expect(['http://127.0.0.1:5275', 'http://192.168.0.77:5275']).toContain(origin);
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const token = await encode({ secret: 'jkai-preview-local-only', salt: 'authjs.session-token', token: { email: 'preview@example.test', name: 'Synthetic local reviewer', sub: 'local-preview' } });
  await page.context().addCookies([{ name: 'authjs.session-token', value: token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  const headers = { cookie: `authjs.session-token=${token}`, origin };
  const root = '/api/policy-incentives-lab/projects';
  if (origin.includes('192.168.')) {
    const bootstrap = await request.get('/api/auth/session');
    expect(bootstrap.headers()['set-cookie'] ?? '').not.toContain('authjs.session-token');
  }
  const anonymous = await request.get(root); expect(anonymous.status()).toBe(403);
  expect((await request.get('/%70olicy-incentives-lab')).status()).toBe(403);
  const guest = await encode({ secret: 'jkai-preview-local-only', salt: 'authjs.session-token', token: { email: 'guest@example.test', sub: 'synthetic-guest' } });
  expect((await request.get(root, { headers: { cookie: `authjs.session-token=${guest}` } })).status()).toBe(403);
  const create = await request.post(root, { headers, data: { title: 'SYNTHETIC — automated Lantern analysis' } });
  expect(create.status(), await create.text()).toBe(201); const project = await create.json();
  const base = `${root}/${project.id}`;
  let revision = 0;
  async function post(resource: string, body: object, expected = 200) {
    const response = await request.post(`${base}/${resource}`, { headers, data: { ...body, revision } });
    expect(response.status(), await response.text()).toBe(expected);
    const value = await response.json();
    if (typeof value.revision === 'number') revision = value.revision;
    return value;
  }
  await post('sources', { synthetic: true });
  let state = await post('extraction-jobs', { task: 'extract-objectives' });
  await post('versions', {}, 422);
  const ids: string[] = [];
  function collect(v: unknown) {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(collect);
    const o = v as Record<string, unknown>; if (o.id && o.approval_status) ids.push(o.id as string);
    Object.values(o).forEach(collect);
  }
  collect(state.payload.candidate.game);
  // Explicit synthetic-review action: each stored item ID is named in the request.
  await post('approvals', { item_ids: ids });
  const version = await post('versions', {}, 201); revision++;
  const config = { simulation_type: 'repeated', seed: 42, rounds: 8, scenario: 'baseline', parameters: {} };
  const first = await post('runs', { version_id: version.id, config }, 201);
  const second = await post('runs', { version_id: version.id, config }, 201);
  expect(JSON.stringify(first.payload.result)).toBe(JSON.stringify(second.payload.result));
  expect(first.payload.result_hash).toBe(second.payload.result_hash);
  expect(first.payload.result.rounds).toHaveLength(8);
  const exported = await request.get(`${base}/reports?run=${first.id}&format=markdown`, { headers });
  const markdown = await exported.text(); expect(markdown).toContain('SYNTHETIC EXAMPLE'); expect(markdown).toContain('## Source evidence'); expect(markdown).toContain('## Assumptions'); expect(markdown).toContain('## Deterministic calculations');
  expect(exported.headers()['cache-control']).toBe('private, no-store');
  const annotation = await post('extraction-jobs', { task: 'explain-results', run_id: first.id }, 201);
  expect(annotation.payload.source_run_id).toBe(first.id);
  expect(annotation.payload.result_hash).toBe(first.payload.result_hash);
  const annotatedReport = await request.get(`${base}/reports?run=${annotation.id}&format=markdown`, { headers });
  expect(await annotatedReport.text()).toContain('Hypothesis: credit incentives');
  await post('sensitivity', { version_id: version.id, sensitivity: { config, ranges: [{ assumption_id: 'value-3-0', low: 0, high: 10, steps: 3 }] } }, 201);
  const originalSnapshot = JSON.stringify(version.payload);
  state = await post('model', { candidate: state.payload.candidate });
  expect(state.payload.candidate.game.actors[0].approval_status.status).toBe('pending');
  await post('versions', {}, 422);
  expect(JSON.stringify((await (await request.get(`${base}/versions`, { headers })).json())[0].payload)).toBe(originalSnapshot);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`/policy-incentives-lab/${project.id}?step=actors`);
  await expect(page.getByRole('heading', { name: 'Who is involved and what matters to them' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Amber Workshop', exact: true })).toBeVisible();
  await expect(page.locator('.network g.node')).toHaveCount(2);
  await expect.poll(() => page.locator('.network g.node').first().getAttribute('transform')).toMatch(/translate\([\d.-]+,[\d.-]+\)/);
  await page.locator('.network').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/policy-lab-actors-desktop.png', fullPage: false });
  await page.goto(`/policy-incentives-lab/${project.id}?step=results`);
  await expect(page.getByRole('heading', { name: 'Calculated scenarios' })).toBeVisible();
  await expect(page.locator('.vega-embed').first()).toBeVisible();
  await page.locator('.vega-embed').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/policy-lab-results-desktop.png', fullPage: false });
  await page.getByText('Distribution of calculated round/profile values', { exact: true }).click();
  await expect(page.locator('.vega-embed')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/policy-lab-results-mobile.png', fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('the synthetic workflow can be completed through the interface', async ({ page }) => {
  test.setTimeout(180000);
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const token = await encode({ secret: 'jkai-preview-local-only', salt: 'authjs.session-token', token: { email: 'preview@example.test', name: 'Synthetic reviewer', sub: 'local-preview' } });
  await page.context().addCookies([{ name: 'authjs.session-token', value: token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto('/policy-incentives-lab');
  await page.getByLabel('Analysis title').fill('SYNTHETIC — UI-reviewed Lantern scenario');
  await page.getByRole('button', { name: 'Create private analysis' }).click();
  await page.getByRole('button', { name: 'Load synthetic Lantern example' }).click();
  await expect(page.getByRole('region', { name: 'First-look red-team dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download first look (Markdown)' })).toBeVisible();
  await page.getByRole('link', { name: 'Policy evidence', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Suggest a starting model' })).toBeEnabled();
  await page.getByRole('button', { name: 'Suggest a starting model' }).click();
  await expect(page.getByText('ev-scheme · Section 1', { exact: false }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Choices and trade-offs', exact: true }).click();
  const boxes = page.locator('.review input[type="checkbox"]');
  await expect(boxes).toHaveCount(49);
  for (const checkbox of await boxes.all()) await checkbox.check();
  await page.getByRole('button', { name: 'Approve selected items (49)' }).click();
  await expect(page.getByText('49/49 items approved', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Try a scenario', exact: true }).click();
  await page.getByRole('button', { name: 'Save approved model snapshot' }).click();
  await expect(page.getByRole('button', { name: 'Run approved scenario', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Run approved scenario', exact: true }).click();
  await expect(page.getByText('1 saved runs', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Results', exact: true }).click();
  await expect(page.getByText('1 pure-strategy Nash equilibrium/equilibria.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Audit and export', exact: true }).click();
  await expect(page.getByRole('link', { name: 'JSON report' })).toBeVisible();
});

test('novice onboarding, publication catalogue and first look before any simulation', async ({ page, request }) => {
  test.setTimeout(180000);
  expect(['http://127.0.0.1:5275', 'http://192.168.0.77:5275']).toContain(origin);
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const token = await encode({ secret: 'jkai-preview-local-only', salt: 'authjs.session-token', token: { email: 'preview@example.test', name: 'Synthetic local reviewer', sub: 'local-preview' } });
  await page.context().addCookies([{ name: 'authjs.session-token', value: token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/policy-incentives-lab');
  await expect(page.getByRole('heading', { name: 'Start with a policy, not a maths problem' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read on GOV.UK ↗' })).toHaveCount(4);
  await page.screenshot({ path: '/tmp/policy-lab-catalogue-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Use these publication details' }).first().click();
  await expect(page.getByLabel('Publication title', { exact: true })).toHaveValue('Soft Drinks Industry Levy');
  await expect(page.getByLabel('Policy text', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Load synthetic Lantern example' }).click();
  await expect(page.getByRole('region', { name: 'First-look red-team dashboard' })).toBeVisible();
  await expect(page.getByText('Basic source scan', { exact: false })).toBeVisible();
  const reportLink = page.getByRole('link', { name: 'Download first look (Markdown)' });
  const report = await request.get((await reportLink.getAttribute('href'))!, { headers: { cookie: `authjs.session-token=${token}` } });
  expect(report.status()).toBe(200); expect(await report.text()).toContain('UNREVIEWED HYPOTHESES');
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
  await page.getByRole('region', { name: 'First-look red-team dashboard' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/policy-lab-first-look-desktop.png', fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('region', { name: 'First-look red-team dashboard' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/policy-lab-first-look-mobile.png', fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Choices and trade-offs', exact: true }).click();
  await page.getByText('Build a small starting model in everyday words', { exact: true }).click();
  await page.getByLabel('What should the policy achieve?').fill('SYNTHETIC lasting repairs');
  await page.getByLabel('What rule or reward is supposed to help?').fill('Pay after checking work');
  for (let i = 0; i < 2; i++) {
    const group = page.getByRole('group', { name: `Group ${i + 1}`, exact: true });
    await group.getByLabel('Who can make a choice?').fill(i ? 'Fictional council' : 'Fictional workshop');
    await group.getByLabel('What do they want?').fill(i ? 'Lasting repairs' : 'Reliable income');
    await group.getByLabel('One thing they could do').fill('Check all repairs');
    await group.getByLabel('A different thing they could do').fill('Check some repairs');
  }
  await page.getByLabel('What outcome would you measure?').fill('Reliability');
  await page.getByLabel('What unit would you use?').fill('illustrative score');
  await page.getByRole('button', { name: 'Create unapproved outline' }).click();
  await expect(page.getByRole('heading', { name: 'What each combination of choices could change' })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Unknown/ }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Try a scenario', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save approved model snapshot' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Run approved scenario', exact: true })).toBeDisabled();
});
