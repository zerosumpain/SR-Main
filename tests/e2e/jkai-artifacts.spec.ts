import { expect, test } from '@playwright/test';

/**
 * The renderers behind render_chart / render_diagram / render_table, driven in a
 * real browser.
 *
 * WHY THIS LANE. `render_chart` shipped in April and never once rendered: the
 * site CSP carries no 'unsafe-eval', vega-embed compiled each spec's expressions
 * into strings for `Function()`, and every chart died with an EvalError. Nothing
 * in ~9,900 unit tests could see it, because the fault only exists in a browser
 * enforcing a Content-Security-Policy. Hence an e2e.
 *
 * No LLM spend and no DB writes: the conversation GET is intercepted and the
 * assistant turn spliced in with the tool steps the renderers read. The chat
 * builds artifacts from `metadata.toolSteps[].result.data.artifact`, which is
 * the same shape the orchestrator persists.
 *
 * Note the map is deliberately not asserted on tiles — those are a live fetch to
 * a third-party host and a failure there says nothing about this code.
 */

const artifacts = {
  chart: {
    type: 'chart',
    spec: {
      mark: 'bar',
      encoding: {
        x: { field: 'day', type: 'ordinal' },
        y: { field: 'steps', type: 'quantitative' },
      },
    },
    // Deliberately NOT alphabetical: Vega-Lite's default ordinal sort would
    // reorder these to Fri/Mon/Sat, which `applyNaturalSort` exists to stop.
    data: [
      { day: 'Mon', steps: 8200 },
      { day: 'Tue', steps: 11400 },
      { day: 'Wed', steps: 6100 },
    ],
    caption: 'Steps',
  },
  diagram: {
    type: 'diagram',
    code: 'flowchart TD\n  A[Start here] --> B[Finish there]',
    caption: 'Flow',
  },
  table: {
    type: 'table',
    columns: [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Value', align: 'right' },
    ],
    rows: [{ metric: 'Resting HR', value: 51 }, { metric: 'HRV', value: 78 }],
    caption: 'Last night',
  },
};

function toolStep(tool: string, artifact: unknown) {
  return {
    id: `step-${tool}`,
    toolCallId: `step-${tool}`,
    tool,
    args: {},
    status: 'done',
    result: { success: true, data: { artifact, summary: tool } },
  };
}

test('chart, diagram and table artifacts render inline under the site CSP', async ({ page }) => {
  test.setTimeout(120_000);

  // The hub deep-links by conversation id, and only honours one it already has
  // in the server-rendered list — so take the id off the page rather than
  // inventing one, which `loadPane` would ignore.
  await page.goto('/jkai');
  const conversationId = await page.evaluate(async () => {
    const res = await fetch('/api/jkai/conversations');
    const body = await res.json();
    return body.items?.[0]?.id ?? null;
  });
  expect(conversationId, 'needs at least one conversation to deep-link into').toBeTruthy();

  await page.route(`**/api/jkai/conversations/${conversationId}*`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.messages = [
      { id: 'e2e-user', role: 'user', content: 'show me', createdAt: new Date().toISOString() },
      {
        id: 'e2e-assistant',
        role: 'assistant',
        content: 'Here you go.',
        createdAt: new Date().toISOString(),
        metadata: {
          toolSteps: [
            toolStep('render_chart', artifacts.chart),
            toolStep('render_diagram', artifacts.diagram),
            toolStep('render_table', artifacts.table),
          ],
        },
      },
    ];
    await route.fulfill({ response, json: body });
  });

  await page.goto(`/jkai?c=${conversationId}`);

  // --- chart: the CSP regression. An empty card is the failure to catch. ---
  const chart = page.locator('.chart-artifact');
  await expect(chart).toBeVisible();
  await expect(chart.locator('svg').first()).toBeVisible({ timeout: 30_000 });
  await expect(chart.locator('.error')).toHaveCount(0);

  // Data order survives: Vega-Lite would otherwise sort the domain alphabetically.
  // `allInnerTexts` returns undefined per node for SVG <text>; read textContent.
  const axisLabels = await chart
    .locator('svg text')
    .evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? '').trim()));
  expect(axisLabels.filter((t) => ['Mon', 'Tue', 'Wed'].includes(t))).toEqual(['Mon', 'Tue', 'Wed']);

  // --- diagram: boxes AND their labels. Stripping foreignObject once drew
  //     every box correctly and emptied every one of them, and an SVG-present
  //     assertion passed throughout. ---
  const diagram = page.locator('.diagram-artifact');
  await expect(diagram.locator('svg')).toBeVisible({ timeout: 30_000 });
  await expect(diagram.locator('.error')).toHaveCount(0);
  await expect(diagram.locator('svg')).toContainText('Start here');
  await expect(diagram.locator('svg')).toContainText('Finish there');
  // Nothing that fetches or embeds HTML survives into the rendered diagram.
  await expect(diagram.locator('img, image, foreignObject, script')).toHaveCount(0);

  // --- table ---
  const table = page.locator('.table-artifact');
  await expect(table.locator('tbody tr')).toHaveCount(2);
  await expect(table).toContainText('Resting HR');
});
