// Exercises the real rebuild against whatever is in the configured database.
//
// Excluded from `gate:test` (the *.integration.test.ts pattern) because it
// needs Postgres, but INCLUDED in the nightly `gate:test:full`, which runs
// against a throwaway container with no workouts in it. So it does not assume
// data: an empty database is a real state — it is what production looks like
// before the first workout syncs — and the rebuild has to answer it with a
// coherent empty report rather than an exception.
//
// With real traces present it prints a readable report, which is the point of
// running it by hand after changing the matcher: synthetic tests prove the
// contract, this shows you what it actually did to your own walks.
import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { db } from '$lib/db';
import { activityTracks } from '$lib/db/schema';
import { rebuildSegments, listSegments, getSegment } from '../segments-service';
import { formatDistance, formatDuration, formatPace } from '../format';

it('rebuilds segments from whatever traces are stored', async () => {
  const anyTrack = await db.select({ id: activityTracks.id }).from(activityTracks).limit(1);

  if (!anyTrack.length) {
    const report = await rebuildSegments();
    expect(report.activitiesConsidered).toBe(0);
    expect(report.segments).toBe(0);
    expect(report.efforts).toBe(0);
    expect(report.created).toBe(0);
    return;
  }

  const report = await rebuildSegments();
  const { rows } = await listSegments({ limit: 500 });

  expect(report.activitiesConsidered).toBeGreaterThan(0);
  expect(rows.length).toBe(report.segments);
  // Every stored segment must clear both thresholds it claims to enforce.
  for (const row of rows) {
    expect(row.distanceM).toBeGreaterThanOrEqual(500);
    expect(row.effortCount).toBeGreaterThanOrEqual(2);
  }

  const lines: string[] = [
    `activities considered : ${report.activitiesConsidered}`,
    `segments              : ${report.segments} (created ${report.created}, kept ${report.kept}, removed ${report.removed})`,
    `efforts               : ${report.efforts}`,
    `elapsed               : ${(report.elapsedMs / 1000).toFixed(1)}s`,
    `notes                 : ${report.notes.join(' | ') || 'none'}`,
    '',
  ];

  const byType = new Map<string, number>();
  for (const row of rows) byType.set(row.activityType, (byType.get(row.activityType) ?? 0) + 1);
  lines.push(`by type: ${[...byType].map(([t, n]) => `${t}=${n}`).join(' ')}`, '');

  for (const row of rows.slice(0, 25)) {
    lines.push(`${row.name.padEnd(34)} ${row.activityType.padEnd(6)} ${row.descriptor}`);
  }

  const top = rows[0];
  if (top) {
    const detail = await getSegment(top.id);
    lines.push('', `--- ${top.name} (${detail?.efforts.length} efforts) ---`);
    lines.push('date         time      pace        avg HR   EF     beats/km');
    for (const e of (detail?.efforts ?? []).slice(0, 15)) {
      lines.push(
        [
          e.startDateLocal.slice(0, 10),
          formatDuration(e.durationS).padStart(8),
          formatPace(e.paceSPerKm).padStart(11),
          (e.avgHeartrate ? `${Math.round(e.avgHeartrate)} bpm` : '—').padStart(8),
          (e.efficiencyFactor?.toFixed(2) ?? '—').padStart(6),
          (e.beatsPerKm?.toFixed(0) ?? '—').padStart(9),
          formatDistance(e.distanceM).padStart(9),
        ].join(' '),
      );
    }
  }

  if (process.env.SEG_REPORT) writeFileSync(process.env.SEG_REPORT, lines.join('\n'));
}, 600_000);
