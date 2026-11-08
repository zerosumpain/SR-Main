import { describe, expect, it } from 'vitest';
import { daylightAt, groundAt } from './sky-ground';
import { skyAt } from './sky';

describe('sky-ground', () => {
  it("paints the page below with the sky's own ground at every degree, rising and setting", () => {
    for (let alt = -90; alt <= 90; alt++) {
      for (const rising of [true, false]) {
        const sky = skyAt(alt, rising);
        expect(groundAt(alt)).toBe(sky.ground);
        expect(daylightAt(alt)).toBe(sky.daylight);
      }
    }
  });
});
