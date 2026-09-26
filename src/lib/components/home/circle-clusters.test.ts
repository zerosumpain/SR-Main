import { describe, expect, it } from 'vitest';
import { clusterDots, type ClusterInput } from './circle-clusters';

const dot = (subject: string, x: number, y: number, at = '2026-09-26T09:00:00Z', isHome: boolean | null = true): ClusterInput => ({
  subject,
  label: subject.charAt(0).toUpperCase() + subject.slice(1),
  x,
  y,
  at,
  isHome,
});

describe('clusterDots', () => {
  it('merges dots under 28px apart into one pin with every name and the freshest time', () => {
    const pins = clusterDots([
      dot('katie', 100, 100, '2026-09-26T09:00:00Z'),
      dot('fintan', 103, 101, '2026-09-26T09:10:00Z'),
      dot('jemima', 110, 95, '2026-09-26T08:00:00Z'),
      dot('rory', 99, 110, '2026-09-26T09:05:00Z'),
    ]);
    expect(pins).toHaveLength(1);
    expect(pins[0].label).toBe('Katie · Fintan · Jemima · Rory');
    expect(pins[0].at).toBe('2026-09-26T09:10:00Z');
    expect(pins[0].isHome).toBe(true);
    expect(pins[0].x).toBeCloseTo(103);
  });

  it('keeps dots 28px or more apart as their own pins', () => {
    const pins = clusterDots([dot('a', 0, 0), dot('b', 28, 0), dot('c', 200, 200, undefined, false)]);
    expect(pins.map((p) => p.label)).toEqual(['A', 'B', 'C']);
    expect(pins[2].isHome).toBe(false);
  });

  it('chains: a-b close and b-c close is one pin', () => {
    expect(clusterDots([dot('a', 0, 0), dot('b', 20, 0), dot('c', 40, 0)])).toHaveLength(1);
  });

  it('is home only when everyone in it is', () => {
    const [pin] = clusterDots([dot('a', 0, 0), dot('b', 5, 0, undefined, false)]);
    expect(pin.isHome).toBe(false);
  });

  it('draws nothing for nobody', () => {
    expect(clusterDots([])).toEqual([]);
  });
});
