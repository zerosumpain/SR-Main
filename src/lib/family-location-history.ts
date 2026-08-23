export type FamilyLocationState = 'home' | 'away' | 'unknown' | 'unavailable';

export interface HistoryPoint {
  lat: number;
  lng: number;
}

export interface FamilyLocationTransition {
  at: string;
  state: FamilyLocationState;
  point?: HistoryPoint;
  durationSeconds: number;
}

export interface FamilyLocationVisit {
  start: string;
  state: FamilyLocationState;
  point?: HistoryPoint;
  durationSeconds: number;
}

export interface HAHistoryRow {
  entity_id?: unknown;
  state?: unknown;
  last_changed?: unknown;
  last_updated?: unknown;
  attributes?: unknown;
}

interface PendingTransition {
  at: Date;
  state: FamilyLocationState;
  point?: HistoryPoint;
}

function normaliseState(value: unknown): FamilyLocationState {
  if (value === 'home') return 'home';
  if (value === 'unknown') return 'unknown';
  if (value === 'unavailable') return 'unavailable';
  return 'away';
}

function coordinate(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function pointFrom(attributes: unknown): HistoryPoint | undefined {
  if (!attributes || typeof attributes !== 'object') return undefined;
  const record = attributes as Record<string, unknown>;
  const lat = coordinate(record.latitude);
  const lng = coordinate(record.longitude);
  return lat === null || lng === null ? undefined : { lat, lng };
}

function timestamp(row: HAHistoryRow): Date | null {
  const value = typeof row.last_changed === 'string' ? row.last_changed : row.last_updated;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Pure HA history shaping. Points remain transition fixes only: this data never
 * attempts to infer a route between them.
 */
export function normaliseLocationHistory(
  rows: HAHistoryRow[],
  range: { start: string; end: string },
): { transitions: FamilyLocationTransition[]; visits: FamilyLocationVisit[]; summary: { awaySeconds: number; outings: number; latestState: FamilyLocationState } } {
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { transitions: [], visits: [], summary: { awaySeconds: 0, outings: 0, latestState: 'unknown' } };
  }

  const pending = rows
    .map((row) => ({ row, at: timestamp(row) }))
    .filter((entry): entry is { row: HAHistoryRow; at: Date } => entry.at !== null && entry.at <= end)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map(({ row, at }) => ({ at, state: normaliseState(row.state), point: pointFrom(row.attributes) }));

  // History may include transitions before the requested window. Only its
  // final state is relevant: carry that state into the window boundary.
  const beforeRange = [...pending].reverse().find((entry) => entry.at < start);
  const rowsInRange = pending.filter((entry) => entry.at >= start);
  const windowed = beforeRange ? [{ ...beforeRange, at: start }, ...rowsInRange] : rowsInRange;

  const collapsed: PendingTransition[] = [];
  for (const entry of windowed) {
    const previous = collapsed.at(-1);
    if (previous?.state === entry.state) {
      // Preserve the newest transition fix when HA repeats a state.
      if (entry.point) previous.point = entry.point;
      continue;
    }
    collapsed.push(entry);
  }

  // A short unavailable/unknown interruption which comes back to the previous
  // state is a GPS reporting gap, not a trip. Repeat so consecutive gaps fold.
  let removedGap = true;
  while (removedGap) {
    removedGap = false;
    for (let index = 1; index < collapsed.length - 1; index += 1) {
      const current = collapsed[index];
      const before = collapsed[index - 1];
      const after = collapsed[index + 1];
      if (
        (current.state === 'unknown' || current.state === 'unavailable') &&
        before.state === after.state &&
        after.at.getTime() - current.at.getTime() < 180_000
      ) {
        collapsed.splice(index, 2);
        removedGap = true;
        break;
      }
    }
  }

  const transitions = collapsed.map((entry, index) => {
    const next = collapsed[index + 1]?.at ?? end;
    return {
      at: entry.at.toISOString(),
      state: entry.state,
      ...(entry.point ? { point: entry.point } : {}),
      durationSeconds: Math.max(0, Math.round((next.getTime() - entry.at.getTime()) / 1000)),
    };
  });
  const visits = transitions
    .filter((transition) => transition.state === 'away')
    .map(({ at, state, point, durationSeconds }) => ({ start: at, state, ...(point ? { point } : {}), durationSeconds }));
  const latestKnown = [...transitions].reverse().find((transition) => transition.state === 'home' || transition.state === 'away');

  return {
    transitions,
    visits,
    summary: {
      awaySeconds: transitions
        .filter((transition) => transition.state === 'away')
        .reduce((total, transition) => total + transition.durationSeconds, 0),
      outings: visits.length,
      latestState: latestKnown?.state ?? 'unknown',
    },
  };
}
