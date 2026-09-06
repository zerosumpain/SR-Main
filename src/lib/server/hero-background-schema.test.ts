import { describe, expect, it } from 'vitest';
import { heroBackgroundSchema } from './hero-background-schema';

describe('hero background settings', () => {
  it('defaults to a single play, hold and slow fade to 20% opacity', () => {
    expect(heroBackgroundSchema.parse({})).toMatchObject({
      enabled: true, holdMs: 1000, fadeMs: 4000, finalTransparency: 80, overlayTitle: true,
    });
  });
  it.each([
    { playbackRate: 0 }, { playbackRate: 10 }, { fadeMs: -1 }, { holdMs: 15001 },
    { finalTransparency: 101 }, { playingOpacity: -1 }, { delayMs: NaN },
    { fit: 'stretch' }, { enabled: 'true' }, { source: '/api/files/private' },
  ])('rejects unsafe or malformed controls: %j', value => {
    expect(heroBackgroundSchema.safeParse(value).success).toBe(false);
  });
  it('allows instant transitions and keeping the final frame behind the title', () => {
    expect(heroBackgroundSchema.parse({ holdMs: 0, fadeMs: 0, overlayTitle: false }))
      .toMatchObject({ holdMs: 0, fadeMs: 0, overlayTitle: false });
  });
});
