import { describe, expect, it } from 'vitest';
import { decodePolyline, fromLngLat, MAX_LINE_POINTS, simplifyLine } from './geo';

describe('decodePolyline', () => {
  it('decodes the Google reference polyline at precision 5', () => {
    const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ lat: 38.5, lng: -120.2 });
    expect(pts[1].lat).toBeCloseTo(40.7, 5);
    expect(pts[2].lng).toBeCloseTo(-126.453, 5);
  });

  it('honours precision 7, as Transitous sends', () => {
    // The same three points encoded at 1e7 decode back to the same degrees.
    const enc = (v: number) => {
      let n = v < 0 ? ~(v << 1) : v << 1;
      let out = '';
      while (n >= 0x20) {
        out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
        n >>= 5;
      }
      return out + String.fromCharCode(n + 63);
    };
    const s = enc(Math.round(41.9 * 1e7)) + enc(Math.round(12.48 * 1e7));
    expect(decodePolyline(s, 7)[0].lat).toBeCloseTo(41.9, 6);
  });
});

describe('simplifyLine', () => {
  it('leaves a short line alone but rounds it', () => {
    expect(simplifyLine([{ lat: 1.123456789, lng: 2 }])).toEqual([{ lat: 1.123457, lng: 2 }]);
  });

  it('thins a long wiggly line to the cap, keeping both ends', () => {
    const line = Array.from({ length: 2000 }, (_, i) => ({ lat: 41.9 + i * 0.00001, lng: 12.48 + Math.sin(i / 5) * 0.0005 }));
    const out = simplifyLine(line);
    expect(out.length).toBeLessThanOrEqual(MAX_LINE_POINTS);
    expect(out[0].lat).toBeCloseTo(line[0].lat, 6);
    expect(out.at(-1)!.lat).toBeCloseTo(line.at(-1)!.lat, 6);
  });
});

describe('fromLngLat', () => {
  it('turns GeoJSON pairs into labelled points', () => {
    expect(fromLngLat([[12.5, 41.9]])).toEqual([{ lat: 41.9, lng: 12.5 }]);
  });
});
