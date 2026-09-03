import { describe, expect, it } from 'vitest';
import { DEFAULT_FEED_KINDS, cooldownHoursFor, isRoute, routeFor, routeSource } from './routes';

describe('routeFor', () => {
  it('routes by family with the security exception, and never leaves a kind unrouted', () => {
    expect(routeFor('musing_health')).toBe('whatsapp');
    expect(routeFor('mail_security')).toBe('whatsapp');
    expect(routeFor('mail_official')).toBe('feed');
    expect(routeFor('intel_missing_link')).toBe('briefing');
    expect(routeFor('unknown_place')).toBe('briefing');
    expect(routeFor('free_window')).toBe('briefing');
    expect(routeFor('rule_driven')).toBe('briefing');
    expect(routeFor('something_new_next_year')).toBe('briefing');
  });

  it('an override for the kind beats one for the family, which beats the defaults', () => {
    expect(routeFor('musing_money', { musings: 'briefing' })).toBe('briefing');
    expect(routeFor('musing_money', { musings: 'briefing', musing_money: 'whatsapp' })).toBe('whatsapp');
    expect(routeSource('musing_money', { musing_money: 'feed' })).toBe('kind');
    expect(routeSource('musing_money', { musings: 'feed' })).toBe('family');
    expect(routeSource('mail_security')).toBe('default-kind');
    expect(routeSource('mail_official')).toBe('default-family');
  });

  it('keeps the old feed-only kinds on the feed by default', () => {
    for (const k of DEFAULT_FEED_KINDS) expect(routeFor(k)).toBe('feed');
    expect(isRoute('briefing')).toBe(true);
    expect(isRoute('push')).toBe(false);
  });
});

describe('cooldownHoursFor', () => {
  it('shortens for a kind he rates up and lengthens for one he rates down', () => {
    expect(cooldownHoursFor(null)).toBe(20);
    expect(cooldownHoursFor(3)).toBe(20);
    expect(cooldownHoursFor(4)).toBe(14);
    expect(cooldownHoursFor(5)).toBe(8);
    expect(cooldownHoursFor(2)).toBe(32);
    expect(cooldownHoursFor(1)).toBe(48);
  });
});
