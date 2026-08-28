import { describe, it, expect } from 'vitest';
import { CHARTS, chartFor } from './index';

/**
 * The registry is the thing standing between "a study declares a figure" and
 * "the figure draws". Its two failure modes are both silent on the page — a
 * chart id nobody registered renders an empty reserved box, and a registered
 * id that resolves to nothing throws inside a snippet — so they are asserted
 * here rather than discovered by looking at the study.
 */
describe('fieldstudy · chart registry', () => {
  it('resolves every registered id to a component', () => {
    expect(Object.keys(CHARTS).length).toBeGreaterThan(0);
    for (const id of Object.keys(CHARTS)) {
      expect(chartFor(id), id).toBeTruthy();
    }
  });

  it('returns undefined for an unregistered id, so the slot is reserved rather than crashed', () => {
    // The reference study's own figures name charts that were never built
    // ('A4', 'A5'). They must keep rendering the dashed placeholder, not throw.
    expect(chartFor('A4')).toBeUndefined();
    expect(chartFor('definitely-not-a-chart')).toBeUndefined();
  });

  it('keys are kebab-case ids, not component names', () => {
    for (const id of Object.keys(CHARTS)) {
      expect(id, id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});
