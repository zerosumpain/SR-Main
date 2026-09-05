import { describe, expect, it } from 'vitest';
import { activityEventSort } from './query';

describe('evidence sort URL', () => {
  it('defaults invalid parameters without accepting raw SQL', () => {
    expect(activityEventSort(new URLSearchParams('sort=drop table&direction=bad&then=bad'))).toEqual({ sort: 'observed', then: null, direction: 'desc' });
  });
  it('accepts both date keys and discards a duplicate second key', () => {
    expect(activityEventSort(new URLSearchParams('sort=occurred&then=observed&direction=asc'))).toEqual({ sort: 'occurred', then: 'observed', direction: 'asc' });
    expect(activityEventSort(new URLSearchParams('sort=occurred&then=occurred'))).toEqual({ sort: 'occurred', then: null, direction: 'desc' });
  });
});
