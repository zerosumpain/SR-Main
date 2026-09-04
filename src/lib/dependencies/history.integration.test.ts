/**
 * Durable dependency history against the disposable integration database.
 * Rows are identified by summary prefix and removed after every case; this
 * file must only be run in the hermetic integration lane.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { like } from 'drizzle-orm';
import { db } from '$lib/db';
import { dependencyStatusSamples } from '$lib/db/schema';
import { recordDependencyObservations, readDependencyOverview } from './history.server';
import type { DependencyObservation } from './catalog';

const PREFIX = 'itest_dependency_history:';

async function cleanup(): Promise<void> {
  await db
    .delete(dependencyStatusSamples)
    .where(like(dependencyStatusSamples.summary, `${PREFIX}%`));
}

function sample(
  state: DependencyObservation['state'],
  checkedAt: Date,
): DependencyObservation {
  return {
    dependencyId: 'public-site',
    state,
    summary: `${PREFIX}${state}`,
    checkedAt,
    latencyMs: state === 'amber' ? 3_200 : state === 'red' ? 8_000 : 120,
  };
}

beforeEach(cleanup);
afterEach(cleanup);

describe('dependency history', () => {
  it('deduplicates imported samples and reports historical public impact', async () => {
    const now = new Date();
    const observations = [
      sample('green', new Date(now.getTime() - 10 * 60_000)),
      sample('amber', new Date(now.getTime() - 5 * 60_000)),
      sample('red', now),
    ];

    await recordDependencyObservations(observations);
    await recordDependencyObservations(observations);

    const rows = await db
      .select()
      .from(dependencyStatusSamples)
      .where(like(dependencyStatusSamples.summary, `${PREFIX}%`));
    const overview = await readDependencyOverview(new Date(now.getTime() + 1_000));
    const publicJourney = overview.dependencies.find((item) => item.id === 'public-site');

    expect(rows).toHaveLength(3);
    expect(publicJourney?.state).toBe('red');
    expect(publicJourney?.healthyPct).toBe(33.333);
    expect(publicJourney?.availablePct).toBe(66.667);
    expect(publicJourney?.degradedChecks).toBe(1);
    expect(publicJourney?.downChecks).toBe(1);
    expect(overview.userImpact.confirmed).toBe(true);
  });

  it('calls out incomplete evidence instead of presenting the gap as uptime', async () => {
    const now = new Date();
    await recordDependencyObservations([
      sample('green', new Date(now.getTime() - 20 * 60_000)),
      sample('green', now),
    ]);

    const overview = await readDependencyOverview(new Date(now.getTime() + 1_000));
    const publicJourney = overview.dependencies.find((item) => item.id === 'public-site');

    expect(publicJourney?.largestGapMinutes).toBeGreaterThanOrEqual(19.9);
    expect(publicJourney?.coveragePct).toBeLessThan(50);
    expect(overview.userImpact.evidenceGap).toBe(true);
    expect(overview.userImpact.summary).toContain('monitoring gap');
  });
});
