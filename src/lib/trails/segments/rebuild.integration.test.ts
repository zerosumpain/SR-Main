// Exercises the real rebuild against whatever is in the configured database.
// Excluded from `gate:test` (the *.integration.test.ts pattern) because it
// needs Postgres; run it directly when changing the matcher, to see what it
// actually does to real traces rather than to synthetic ones.
import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { rebuildSegments, listSegments, getSegment } from '../segments-service';
import { formatDistance, formatDuration, formatPace } from '../format';

it('rebuilds segments from the real activity set', async () => {
  const report = await rebuildSegments();
  const { rows } = await listSegments({ limit: 500 });

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

  writeFileSync(process.env.SEG_REPORT ?? '/tmp/seg-report.txt', lines.join('\n'));
  expect(report.activitiesConsidered).toBeGreaterThan(0);
}, 600_000);
