import { describe, expect, it } from 'vitest';
import { newsItemPayload, NEWS_EVENT_MAX_ITEMS } from './item-event';

const item = (n: number, source = 'hn') => ({ key: `${source}:${n}`, source, title: `Story ${n}`, url: null, domain: null });

describe('newsItemPayload', () => {
  it('is nothing when nothing was new', () => {
    expect(newsItemPayload([])).toBeNull();
  });

  it('batches a gather into one payload with filterable headlines', () => {
    const p = newsItemPayload([item(1), item(2, 'lobsters')]);
    expect(p).toMatchObject({ count: 2, sources: ['hn', 'lobsters'], titles: 'Story 1 | Story 2' });
    expect((p?.items as unknown[]).length).toBe(2);
  });

  it('caps the items but reports the true count', () => {
    const many = Array.from({ length: NEWS_EVENT_MAX_ITEMS + 10 }, (_, i) => item(i));
    const p = newsItemPayload(many);
    expect(p?.count).toBe(NEWS_EVENT_MAX_ITEMS + 10);
    expect((p?.items as unknown[]).length).toBe(NEWS_EVENT_MAX_ITEMS);
  });
});
