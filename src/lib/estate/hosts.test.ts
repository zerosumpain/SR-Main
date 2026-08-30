import { describe, it, expect } from 'vitest';
import {
  HOST_TILES,
  THRESHOLDS,
  formatUptime,
  hostState,
  vitalsConcerns,
  type HostVitals,
} from './hosts';
import { ENDPOINTS } from './endpoints';

/** A healthy box, so each test can change one thing and assert on that. */
function vitals(over: Partial<HostVitals> = {}): HostVitals {
  return {
    host: 'homeserv',
    at: '2026-08-30T07:00:00.000Z',
    uptimeSec: 403_800,
    kernel: '6.8.0-138-generic',
    cpus: 4,
    load: [0.2, 0.25, 0.22],
    mem: { totalMb: 7830, availableMb: 4700, usedPct: 40 },
    swap: { totalMb: 8011, usedMb: 1458, usedPct: 18 },
    disk: { mount: '/', totalGb: 232.2, freeGb: 108.7, usedPct: 51 },
    tempC: 38,
    agent: 1,
    ...over,
  };
}

describe('host tiles', () => {
  it('names hosts that exist in the estate catalogue', () => {
    for (const tile of HOST_TILES) {
      expect(ENDPOINTS.some((e) => e.host === tile.id), `${tile.id} has no endpoints`).toBe(true);
    }
  });

  it('reaches each box on the tailnet, never its DHCP LAN address', () => {
    // porkserv's lease moves. A 192.168.x here would point at whatever picks
    // that address up next, and the tile would go on looking healthy.
    for (const tile of HOST_TILES) {
      expect(tile.vitalsUrl).toMatch(/^http:\/\/100\.\d+\.\d+\.\d+:9101\/vitals$/);
    }
  });

  it('probes every vitals agent it depends on', () => {
    // The thing that watches the boxes must not itself fail unwatched.
    for (const tile of HOST_TILES) {
      const agent = ENDPOINTS.find((e) => e.host === tile.id && e.id.endsWith('-vitals'));
      expect(agent, `${tile.id} has no vitals entry in the catalogue`).toBeTruthy();
      expect(agent?.probeId, `${tile.id}'s vitals agent is not probed`).toBeTruthy();
    }
  });
});

describe('vitalsConcerns', () => {
  it('says nothing about a healthy box', () => {
    expect(vitalsConcerns(vitals())).toEqual([]);
  });

  it('reports nothing for absent vitals — that is "unknown", not "fine"', () => {
    // The caller must tell "we looked and it was fine" apart from "we could not
    // look". An empty concerns list from a null must never be read as health.
    expect(vitalsConcerns(null)).toEqual([]);
  });

  it('catches a filling disk', () => {
    const c = vitalsConcerns(vitals({ disk: { mount: '/', totalGb: 232, freeGb: 9, usedPct: 96 } }));
    expect(c.join(' ')).toContain('disk 96%');
  });

  it('catches memory pressure — the failure this exists for', () => {
    const c = vitalsConcerns(vitals({ mem: { totalMb: 7830, availableMb: 500, usedPct: 94 } }));
    expect(c.join(' ')).toContain('memory 94%');
  });

  it('tolerates the swap homeserv normally carries', () => {
    // ~1.5GB of 8GB swapped is homeserv's resting state. Alerting on it would
    // mean an amber tile every day, which is how a tile stops being read.
    expect(vitalsConcerns(vitals({ swap: { totalMb: 8011, usedMb: 1458, usedPct: 18 } }))).toEqual([]);
    const heavy = vitalsConcerns(vitals({ swap: { totalMb: 8011, usedMb: 6000, usedPct: 75 } }));
    expect(heavy.join(' ')).toContain('swap 75%');
  });

  it('judges load per core, using the 5-minute average', () => {
    // The 1-minute figure spikes on every npm ci. Four cores at a 1-minute
    // load of 12 but a 5-minute load of 0.3 is a gate run, not a problem.
    expect(vitalsConcerns(vitals({ load: [12, 0.3, 0.2] }))).toEqual([]);
    const sustained = vitalsConcerns(vitals({ load: [9, 8.4, 8.1], cpus: 4 }));
    expect(sustained.join(' ')).toContain('load 8.40');
  });

  it('does not invent a temperature the box never reported', () => {
    expect(vitalsConcerns(vitals({ tempC: null }))).toEqual([]);
  });

  it('treats a swapless box as 0%, not NaN%', () => {
    expect(vitalsConcerns(vitals({ swap: { totalMb: 0, usedMb: 0, usedPct: 0 } }))).toEqual([]);
  });
});

describe('hostState', () => {
  const healthy = {
    vitals: vitals(),
    servicesUp: 5,
    servicesTotal: 5,
    servicesDown: [] as string[],
    concerns: [] as string[],
  };

  it('is up when the agent answers and every service does', () => {
    expect(hostState(healthy).state).toBe('up');
  });

  it('is down only when nothing at all answers', () => {
    const s = hostState({
      vitals: null,
      servicesUp: 0,
      servicesTotal: 5,
      servicesDown: ['Vitals agent', 'AdGuard Home'],
      concerns: [],
    });
    expect(s.state).toBe('down');
  });

  it('is degraded, NOT down, when only the agent is missing', () => {
    // A box with a working AdGuard and a dead agent has not gone away — we have
    // partially lost sight of it. Painting that red next to a resolver that is
    // plainly resolving is the false alarm that teaches you to ignore the tile.
    const s = hostState({
      vitals: null,
      servicesUp: 4,
      servicesTotal: 5,
      servicesDown: ['Vitals agent'],
      concerns: [],
    });
    expect(s.state).toBe('degraded');
    expect(s.reason).toBe('vitals agent not answering');
  });

  it('does not name the vitals agent twice, but does name what else is down', () => {
    // The agent is itself a catalogued service, so it is always in the down
    // list when vitals are missing. "vitals agent not answering — Vitals agent"
    // is noise; anything else down is the actual news.
    const only = hostState({
      vitals: null,
      servicesUp: 4,
      servicesTotal: 5,
      servicesDown: ['Vitals agent'],
      concerns: [],
    });
    expect(only.reason).toBe('vitals agent not answering');

    const plus = hostState({
      vitals: null,
      servicesUp: 3,
      servicesTotal: 5,
      servicesDown: ['Vitals agent', 'AdGuard DNS'],
      concerns: [],
    });
    expect(plus.reason).toBe('vitals agent not answering · also AdGuard DNS');
  });

  it('is unknown when there is nothing to go on', () => {
    expect(
      hostState({ vitals: null, servicesUp: 0, servicesTotal: 0, servicesDown: [], concerns: [] }).state,
    ).toBe('unknown');
  });

  it('is degraded when a service is down even though the box is healthy', () => {
    const s = hostState({ ...healthy, servicesUp: 4, servicesDown: ['AdGuard DNS'] });
    expect(s.state).toBe('degraded');
    expect(s.reason).toBe('not answering: AdGuard DNS');
  });

  it('surfaces the vitals concern as the reason when services are all fine', () => {
    const s = hostState({ ...healthy, concerns: ['disk 96% full · 9GB left'] });
    expect(s.state).toBe('degraded');
    expect(s.reason).toBe('disk 96% full · 9GB left');
  });
});

describe('formatUptime', () => {
  it('reads in days once past one', () => {
    expect(formatUptime(403_800)).toBe('4d 16h');
    expect(formatUptime(7_200)).toBe('2h 0m');
    expect(formatUptime(90)).toBe('1m');
  });

  it('does not print a number it was not given', () => {
    expect(formatUptime(null)).toBe('—');
    expect(formatUptime(undefined)).toBe('—');
    expect(formatUptime(Number.NaN)).toBe('—');
  });
});

describe('thresholds', () => {
  it('leaves headroom between amber and the threshold itself', () => {
    // The strip ambers at threshold-15, so every threshold must be above 15 or
    // a healthy box would render amber from zero.
    for (const [k, v] of Object.entries(THRESHOLDS)) {
      if (k === 'loadPerCpu') continue;
      expect(v, `${k} is too low to show pressure building`).toBeGreaterThan(15);
    }
  });
});
