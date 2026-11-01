import { describe, expect, it } from 'vitest';
import { analysePatterns, findingsOf, type PatternPlace } from '$lib/home/presence/patterns';
import type { InsightFix } from '$lib/home/presence/insights';
import type { FamilyForecast } from '$lib/home/presence/forecast';
import { movementCardLines, renderMovement, type MovementInputs } from './movement';
import { describeSource } from './explain';

const places: PatternPlace[] = [
  { id: 'home', label: 'Home', kind: 'home', lat: 51.5, lon: -0.12, radiusM: 100 },
  { id: 'school', label: 'Sample College', kind: 'school', lat: 51.59, lon: -0.12, radiusM: 100 },
];
const MIN = 60_000;
const fix = (subject: string, t: number, lat: number, extra: Partial<InsightFix> = {}): InsightFix =>
  ({ subject, ts: new Date(t), lat, lon: -0.12, accuracyM: 10, readingAgeS: 0, isHome: lat === 51.5, speedKmh: 0, mode: 'still', ...extra });
function schoolDay(subject: string, day: string): InsightFix[] {
  const d0 = Date.parse(`${day}T00:00:00Z`), leave = d0 + 7 * 60 * MIN, back = d0 + 15 * 60 * MIN, out: InsightFix[] = [];
  for (let t = d0; t <= leave; t += 2 * MIN) out.push(fix(subject, t, 51.5));
  for (let m = 2; m <= 16; m += 2) out.push(fix(subject, leave + m * MIN, 51.5 + 0.005 * m, { speedKmh: 33, mode: 'vehicle', isHome: false }));
  for (let t = leave + 18 * MIN; t <= back; t += 2 * MIN) out.push(fix(subject, t, 51.59));
  for (let m = 2; m <= 16; m += 2) out.push(fix(subject, back + m * MIN, 51.59 - 0.005 * m, { speedKmh: 33, mode: 'vehicle', isHome: false }));
  for (let t = back + 18 * MIN; t < d0 + 24 * 60 * MIN; t += 2 * MIN) out.push(fix(subject, t, 51.5));
  return out;
}
const DAYS = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'];
const people = [{ subject: 'alex', displayName: 'Alex' }, { subject: 'sam', displayName: 'Sam' }];
const rows = people.flatMap((p) => DAYS.flatMap((d) => schoolDay(p.subject, d)));
const steps = new Map([['alex', new Map(DAYS.map((d, i) => [d, 8000 + i * 500]))]]);

const forecast = {
  generatedAt: '2026-09-26T07:00:00Z', days: 28, routines: [], next: [], arrivals: [], departures: [], odds: [],
  watch: [{ key: 'k', kind: 'late', subject: 'sam', severity: 'watch', title: 'Sam is later than usual leaving school', detail: 'usually away by 15:20', at: '2026-09-26T14:40:00Z' }],
  ahead: [{
    subject: 'alex', until: '2026-09-26T23:00:00Z', segments: [
      { kind: 'stay', placeId: 'school', place: 'Sample College', from: '2026-09-26T07:00:00Z', to: '2026-09-26T14:00:00Z', open: false },
      { kind: 'trip', fromId: 'school', toId: 'home', from: 'Sample College', to: 'Home', leave: '2026-09-26T14:00:00Z', arriveFrom: '2026-09-26T14:15:00Z', arriveTo: '2026-09-26T14:25:00Z', arrive: '2026-09-26T14:18:00Z', confidence: 'established', routineId: 'r1' },
    ],
  }],
} as unknown as FamilyForecast;

async function inputs(): Promise<MovementInputs> {
  const report = await analysePatterns(rows, places, people, steps, new Date('2026-09-26T12:00:00Z'), 7, 'home');
  report.findings = findingsOf(report, (s) => (s === 'alex' ? 'Alex' : 'Sam'));
  return { report, forecast, scorecard: null, names: { alex: 'Alex', sam: 'Sam' } };
}

describe('movement for the think loop', () => {
  it('puts each person\'s forecast day and what looks off on the household card', async () => {
    const lines = movementCardLines(await inputs());
    const text = lines.join('\n');
    // London is UTC+1 in late September.
    expect(text).toContain('Alex: Sample College until 15:00, then Home (arrive 15:15–15:25)');
    expect(text).toContain('Sam is later than usual leaving school');
    expect(text).toMatch(/Household patterns \(7 days\): .+More: household_patterns\./);
  });

  it('keeps the card lines within their budget', async () => {
    const m = await inputs();
    m.report!.findings = Array.from({ length: 20 }, (_, i) => ({ subject: null, weight: 1, text: `Finding ${i} ${'x'.repeat(200)}.` }));
    expect(movementCardLines(m, 900).join('').length).toBeLessThanOrEqual(900);
  });

  it('says unknown, not empty, when nothing could be read', () => {
    const text = movementCardLines({ report: null, forecast: null, scorecard: null, names: {} }).join('\n');
    expect(text).toContain('could not be read — unknown, not empty');
    expect(text).toContain('not built yet');
  });

  it('renders a person, steps and togetherness as sections, with no coordinates', async () => {
    const m = await inputs();
    const person = renderMovement(m, 'person', 'alex');
    expect(person).toContain('Alex: seen');
    expect(person).toContain('Sample College');
    expect(person).toContain('Today: Sample College until 15:00');
    expect(renderMovement(m, 'steps', null)).toMatch(/Alex: 9,000 a day/);
    expect(renderMovement(m, 'together', null)).toMatch(/Alex & Sam: \d+ h out together/);
    for (const s of ['summary', 'person', 'forecast', 'steps', 'together', 'habits'] as const) {
      const t = renderMovement(m, s, 'Alex');
      expect(t, s).not.toMatch(/51\.5|-0\.12/);
      expect(t.length, s).toBeLessThanOrEqual(2400);
    }
  });

  it('asks for a name it does not know', async () => {
    expect(renderMovement(await inputs(), 'person', 'Robin')).toContain('Name someone: Alex, Sam.');
  });

  it('names its source plainly on the explain page', () => {
    expect(describeSource('household_patterns', { section: 'forecast' }).label).toBe('Household forecast');
    expect(describeSource('household_patterns', { section: 'person', person: 'Alex' })).toEqual({ label: 'Household movement patterns', detail: 'person · Alex' });
  });
});
