export interface EvidenceDay {
  day: string;
  a: number | null;
  b: number | null;
  used: boolean;
}

/** Join by calendar date, not row position: missing days must not become next-day evidence. */
export function pairEvidence(
  days: string[], xs: Array<number | null>, ys: Array<number | null>, lagDays: number,
  afterDay?: string,
): EvidenceDay[] {
  const byDay = new Map(days.map((d, i) => [d, ys[i]]));
  return days.flatMap((day, index) => {
    if (afterDay && day <= afterDay) return [];
    const target = new Date(`${day}T12:00:00Z`);
    target.setUTCDate(target.getUTCDate() + lagDays);
    const a = xs[index] ?? null;
    const b = byDay.get(target.toISOString().slice(0, 10)) ?? null;
    return [{ day, a, b, used: a != null && b != null }];
  });
}
