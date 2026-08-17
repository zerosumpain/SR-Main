import { describe, expect, it } from 'vitest';
import { pickLocation } from './device-location';

const NOW = Date.parse('2026-08-17T12:00:00Z');

describe('pickLocation', () => {
  it('takes the fix from the person entity when it has one', () => {
    const loc = pickLocation(
      {
        state: 'home',
        attributes: { latitude: 54.52, longitude: -1.55 },
        last_updated: '2026-08-17T11:50:00Z',
      },
      null,
      NOW,
    );
    expect(loc).toMatchObject({ lat: 54.52, lng: -1.55, label: 'Home', ageMins: 10, stale: false });
  });

  it('falls through to the source tracker when the person has no coordinates', () => {
    const loc = pickLocation(
      { state: 'not_home', attributes: { source: 'device_tracker.johns_phone' } },
      { attributes: { latitude: 54.6, longitude: -1.6, last_seen: '2026-08-17T11:00:00Z' } },
      NOW,
    );
    expect(loc).toMatchObject({ lat: 54.6, lng: -1.6, label: 'Away', ageMins: 60 });
  });

  it('prefers a street address over the zone verdict for the label', () => {
    const loc = pickLocation(
      { state: 'not_home', attributes: { latitude: 54.6, longitude: -1.6 } },
      { attributes: { address: '12 High Row, Darlington' } },
      NOW,
    );
    expect(loc?.label).toBe('12 High Row, Darlington');
  });

  it('flags a fix older than six hours as stale but still returns it', () => {
    const loc = pickLocation(
      {
        state: 'home',
        attributes: { latitude: 54.5, longitude: -1.5 },
        last_updated: '2026-08-17T04:00:00Z',
      },
      null,
      NOW,
    );
    expect(loc?.stale).toBe(true);
    expect(loc?.ageMins).toBe(480);
  });

  it('returns null with no coordinates anywhere', () => {
    expect(pickLocation({ state: 'unknown', attributes: {} }, null, NOW)).toBeNull();
    expect(pickLocation(null, null, NOW)).toBeNull();
  });
});
