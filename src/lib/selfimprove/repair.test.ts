import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CustomToolHealth } from './context';

const records: Array<{ key: string; data: Record<string, unknown> }> = [];
vi.mock('$lib/datastore', () => ({
  upsertRecord: vi.fn(async () => {}),
  queryRecords: vi.fn(async () => ({ records })),
}));

import { pickRepairTargets, recentlyFailedRepairs, repairsOnCooldown } from './repair';
import { WORK_CAPS } from './types';

function tool(name: string, runCount: number, errorCount: number, enabled = true): CustomToolHealth {
  return {
    name, description: '', enabled, runCount, errorCount,
    errorRate: runCount ? errorCount / runCount : 0, handlerCode: '',
  } as CustomToolHealth;
}

/** The three tools actually eligible on production, 2026-08-16. */
const REAL = [
  tool('reverse_geocode', 572, 398),
  tool('reverse_geocode_osm', 6, 6),
  tool('nearby_places', 6, 4),
];

beforeEach(() => { records.length = 0; });

describe('picking what to repair', () => {
  it('still takes the worst offenders first when nothing is resting', () => {
    // Pinned to 2, not WORK_CAPS.maxToolsRepaired: this asserts the ORDER, and
    // tying it to the cap made it silently assert something else the moment
    // the cap moved from 2 to 3.
    expect(pickRepairTargets(REAL, 2).map((t) => t.name))
      .toEqual(['reverse_geocode', 'reverse_geocode_osm']);
  });

  it('reaches the tool that was starved behind them', () => {
    // The measured loop: those two were re-authored every night for eight
    // nights while `nearby_places` sat third of three and only two are
    // repaired per night, so it was never once reached.
    const resting = new Set(['reverse_geocode', 'reverse_geocode_osm']);
    expect(pickRepairTargets(REAL, 2, resting).map((t) => t.name))
      .toEqual(['nearby_places']);
  });

  it('keeps the existing eligibility rules intact', () => {
    const noisy = [
      tool('too_few_runs', WORK_CAPS.repairMinRuns - 1, 4),
      tool('healthy_enough', 100, 10), // 10% — under the threshold
      tool('disabled_one', 100, 90, false),
      tool('genuinely_bad', 100, 90),
    ];
    expect(pickRepairTargets(noisy, 5).map((t) => t.name)).toEqual(['genuinely_bad']);
  });

  it('returns nothing rather than something when every candidate is resting', () => {
    const all = new Set(REAL.map((t) => t.name));
    expect(pickRepairTargets(REAL, 2, all)).toEqual([]);
  });
});

describe('saying which tools are resting', () => {
  it('names only the eligible ones held back, not every skipped tool', () => {
    const resting = new Set(['reverse_geocode', 'healthy_tool_nobody_asked_about']);
    expect(repairsOnCooldown(REAL, resting)).toEqual(['reverse_geocode']);
  });

  it('is empty when nothing is held back, so the ledger stays quiet', () => {
    expect(repairsOnCooldown(REAL, new Set())).toEqual([]);
  });
});

describe('reading the cooldown off the attempt ledger', () => {
  const now = new Date('2026-08-16T02:30:00Z');
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();

  it('collects repairs rejected inside the window', async () => {
    records.push(
      { key: 'r1', data: { mode: 'repair', status: 'rejected', name: 'reverse_geocode', attemptedAt: at(1) } },
      { key: 'r2', data: { mode: 'repair', status: 'rejected', name: 'reverse_geocode_osm', attemptedAt: at(3) } },
    );
    expect([...(await recentlyFailedRepairs(now))].sort()).toEqual(['reverse_geocode', 'reverse_geocode_osm']);
  });

  it('lets a tool back in once the cooldown expires', async () => {
    // Not a permanent exclusion — the upstream may settle, or better smoke
    // cases may exist by then.
    records.push({ key: 'r1', data: { mode: 'repair', status: 'rejected', name: 'old_failure', attemptedAt: at(WORK_CAPS.repairCooldownDays + 1) } });
    expect(await recentlyFailedRepairs(now)).toEqual(new Set());
  });

  it('ignores successful repairs — shipping is not a reason to sit out', async () => {
    records.push({ key: 'r1', data: { mode: 'repair', status: 'created', name: 'was_fixed', attemptedAt: at(1) } });
    expect(await recentlyFailedRepairs(now)).toEqual(new Set());
  });

  it('ignores create-mode attempts, which are about a different tool entirely', async () => {
    records.push({ key: 'c1', data: { mode: 'create', status: 'rejected', name: 'brand_new', attemptedAt: at(1) } });
    expect(await recentlyFailedRepairs(now)).toEqual(new Set());
  });

  it('survives malformed rows without losing the good ones', async () => {
    records.push(
      { key: 'x', data: { mode: 'repair', status: 'rejected', attemptedAt: at(1) } },        // no name
      { key: 'y', data: { mode: 'repair', status: 'rejected', name: 'no_date' } },            // no timestamp
      { key: 'z', data: { mode: 'repair', status: 'rejected', name: 'bad_date', attemptedAt: 'yesterday' } },
      { key: 'ok', data: { mode: 'repair', status: 'rejected', name: 'good', attemptedAt: at(2) } },
    );
    expect(await recentlyFailedRepairs(now)).toEqual(new Set(['good']));
  });

  it('applies no cooldown when the datastore is unreachable', async () => {
    const ds = await import('$lib/datastore');
    vi.mocked(ds.queryRecords).mockRejectedValueOnce(new Error('down') as never);
    // Degrade towards doing the work, not towards skipping it — a missing
    // ledger must cost the phase its cooldown, not its run.
    expect(await recentlyFailedRepairs(now)).toEqual(new Set());
  });
});
