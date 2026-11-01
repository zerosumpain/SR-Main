// src/lib/daydream/think/movement.ts
//
// The household's movement, as the think loop reads it: the nightly patterns
// report (/home/people/patterns) and the live forecast (/home/people). PURE —
// `movement.server.ts` gathers both.
//
// Owner, 2026-11-01: "make all of this rich, new intelligence available to
// daydream, too — so it can consider patterns and forecasts". Two ways in:
//
//   - a HOUSEHOLD card, seeded beside the situation card, carries TODAY: each person's forecast day, anything
//     that looks off against their routine, and the household's sharpest
//     patterns, so no private cycle plans blind to them;
//   - the `household_patterns` tool carries the DEPTH, a section at a time
//     (every card is cut at CARD_CHARS, so one section per call fits).
//
// Like the rest of the card: named places only, never coordinates.

import { categoryLabel, type PatternsReport, type PersonPattern } from '$lib/home/presence/patterns';
import { WEEKDAYS } from '$lib/home/presence/habits';
import type { FamilyForecast } from '$lib/home/presence/forecast';
import type { Scorecard } from '$lib/home/presence/forecast-eval';

export const MOVEMENT_SECTIONS = ['summary', 'person', 'forecast', 'steps', 'together', 'habits'] as const;
export type MovementSection = (typeof MOVEMENT_SECTIONS)[number];

export interface MovementInputs {
  report: PatternsReport | null;
  forecast: FamilyForecast | null;
  scorecard: Scorecard | null;
  /** subject → display name, for the forecast (which carries subjects). */
  names: Record<string, string>;
}

const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hm = (iso: string) => clockFmt.format(new Date(iso));
const pct = (n: number) => `${Math.round(n * 100)}%`;
const num = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-GB'));
const nameOf = (m: MovementInputs, s: string) => m.names[s] ?? m.report?.people.find((p) => p.subject === s)?.displayName ?? s;

function routineLine(x: { category: Parameters<typeof categoryLabel>[0]; weekday: number; hits: number; of: number; usual: string; places: string[] }): string {
  return `${categoryLabel(x.category)} on ${WEEKDAYS[x.weekday]}s (${x.hits} of ${x.of}), about ${x.usual}${x.places.length ? ` at ${x.places.slice(0, 2).join(', ')}` : ''}`;
}

/** Each person's rest of today, as the forecast chains it from their routines. */
export function forecastLines(m: MovementInputs): string[] {
  const f = m.forecast;
  if (!f) return [];
  const out: string[] = [];
  for (const d of f.ahead) {
    const steps = d.segments.map((s) =>
      s.kind === 'stay'
        ? `${s.place || 'somewhere known'}${s.open ? ' for the rest of the day' : ` until ${hm(s.to)}`}`
        : `${s.confidence === 'live' ? 'on the way to' : 'then'} ${s.to} (arrive ${hm(s.arriveFrom)}–${hm(s.arriveTo)}${s.confidence === 'emerging' ? ', a newer routine' : ''})`,
    );
    if (steps.length) out.push(`${nameOf(m, d.subject)}: ${steps.join(', ')}.`);
  }
  return out;
}

/** What looks different from someone's own routine right now. */
export function watchLines(m: MovementInputs): string[] {
  return (m.forecast?.watch ?? []).map((w) => `${w.severity === 'alert' ? 'ALERT' : 'Watch'}: ${w.title}${w.detail ? ` — ${w.detail}` : ''}`);
}

/** The few lines the situation card carries. Bounded: the card is read every cycle. */
export function movementCardLines(m: MovementInputs, limit = 1800): string[] {
  const lines: string[] = [];
  const fc = forecastLines(m);
  lines.push(fc.length ? `Household today (forecast from their routines): ${fc.join(' ')}` : m.forecast ? 'Household today: no forecast day for anyone (places unknown or no routines from where they are).' : 'Household today: the forecast could not be read — unknown, not empty.');
  const watch = watchLines(m);
  if (watch.length) lines.push(`Looks off against routine: ${watch.slice(0, 3).join('; ')}.`);
  const r = m.report;
  if (r) {
    const top = r.findings.slice(0, 5).map((f) => f.text.replace(/\.$/, ''));
    if (top.length) lines.push(`Household patterns (${r.days} days): ${top.join('; ')}. More: household_patterns.`);
  } else {
    lines.push('Household patterns: not built yet.');
  }
  // One budget for the lot, cut at a line.
  const kept: string[] = [];
  let used = 0;
  for (const l of lines) {
    const t = l.length > limit ? `${l.slice(0, limit - 1)}…` : l;
    if (used + t.length > limit && kept.length) break;
    kept.push(t);
    used += t.length;
  }
  return kept;
}

function personBlock(p: PersonPattern, m: MovementInputs): string[] {
  const out = [
    `${p.displayName}: seen ${pct(p.coverage)} of the window; ${pct(p.homeShare)} of seen time at home; ${num(p.awayHours)} h out, ${num(p.travelHours)} h travelling, ${p.trips} journeys (median ${p.medianTrip} min, ${pct(p.activeTripShare)} on foot).`,
    `  First out ${p.firstOut.weekday ?? '—'} weekdays / ${p.firstOut.weekend ?? '—'} weekends; home by ${p.lastHome.weekday ?? '—'} / ${p.lastHome.weekend ?? '—'}. Steadiness ${pct(p.predictability)} (time where they usually are at that hour). Out alone ${pct(p.aloneOutShare)}. ${p.newPlaces} new places in 4 weeks; roams ${p.roamKm} km a week${p.farthest ? `, farthest ${p.farthest.name} at ${num(p.farthest.km)} km` : ''}.`,
  ];
  const away = p.places.filter((x) => x.category !== 'home').slice(0, 6);
  if (away.length) out.push(`  Destinations: ${away.map((x) => `${x.name} (${categoryLabel(x.category)}, ${num(x.hours)} h over ${x.days} days, usually arrives ${x.arrives}, stays ~${x.medianStay} min)`).join('; ')}.`);
  const kinds = [...p.categories].filter((c) => c.category !== 'home').sort((a, b) => b.hours - a.hours).slice(0, 6);
  if (kinds.length) out.push(`  Time out by kind: ${kinds.map((c) => `${categoryLabel(c.category)} ${num(c.hours)} h`).join(', ')}.`);
  const routines = p.habits?.routines?.slice(0, 3) ?? [];
  if (routines.length) out.push(`  Routines: ${routines.map(routineLine).join('; ')}.`);
  if (p.steps.days > 0) {
    const lift = p.steps.byCategory[0];
    out.push(`  Steps: ${num(p.steps.mean)} a day over ${p.steps.days} days; ${num(p.steps.homeDay)} on a day at home against ${num(p.steps.outDay)} on a day out${lift ? `; most on days ${categoryLabel(lift.category).toLowerCase()} (+${num(lift.lift)})` : ''}.`);
  }
  const ahead = m.forecast?.ahead.find((d) => d.subject === p.subject);
  if (ahead) out.push(`  Today: ${forecastLines({ ...m, forecast: m.forecast ? { ...m.forecast, ahead: [ahead] } : null })[0]?.replace(/^[^:]+: /, '') ?? '—'}`);
  return out;
}

function stepsBlock(r: PatternsReport): string[] {
  const rows = r.people.filter((p) => p.steps.days > 0).sort((a, b) => (b.steps.mean ?? 0) - (a.steps.mean ?? 0));
  if (!rows.length) return ['No step counts from the app in this window.'];
  const wk = (p: PersonPattern, end: boolean) => {
    const xs = p.steps.week.filter((w) => w.mean > 0 && (w.weekday >= 5) === end).map((w) => w.mean);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  return [
    'Steps, person by person (daily averages from the app; most first):',
    ...rows.map((p) => `  ${p.displayName}: ${num(p.steps.mean)} a day (${num(wk(p, false))} weekdays, ${num(wk(p, true))} weekends); home day ${num(p.steps.homeDay)} vs day out ${num(p.steps.outDay)}${p.steps.perOnFootHour != null && p.steps.perOnFootHour > 0 ? `; ~${num(p.steps.perOnFootHour)} more steps per hour out on foot` : ''}. By weekday Mon–Sun: ${p.steps.week.map((w) => (w.mean ? `${(w.mean / 1000).toFixed(1)}k` : '–')).join(' ')}.`),
    ...rows.flatMap((p) => p.steps.byCategory.slice(0, 2).map((l) => `  ${p.displayName} walks ${l.lift > 0 ? '+' : ''}${num(l.lift)} on days with ${categoryLabel(l.category).toLowerCase()} (${num(l.withMean)} vs ${num(l.withoutMean)}, ${l.days} days).`)),
  ];
}

function togetherBlock(r: PatternsReport, m: MovementInputs): string[] {
  const out = ['Who is with whom, out of the house:'];
  for (const pr of r.together.pairs.slice(0, 6)) out.push(`  ${nameOf(m, pr.a)} & ${nameOf(m, pr.b)}: ${num(pr.outHours)} h out together${pr.sharedTrips ? `, ${pr.sharedTrips} journeys together` : ''}.`);
  if (r.together.whole.hours > 0) out.push(`  The whole household out in one place: ${num(r.together.whole.hours)} h${r.together.whole.places[0] ? `, mostly at ${r.together.whole.places[0].name}` : ''}.`);
  const shared = r.household.shared.slice(0, 6);
  if (shared.length) out.push(`  Shared places: ${shared.map((s) => `${s.name} (${s.people.map((x) => nameOf(m, x)).join(', ')}; ${s.visits} visits, ${num(s.hours)} h)`).join('; ')}.`);
  return out;
}

function habitsBlock(r: PatternsReport): string[] {
  const hh = r.household.habits;
  if (!hh) return ['Habits: not in this report yet (the next nightly build adds them).'];
  const out = ['Household routines (a day counts once whoever went):', ...hh.routines.slice(0, 6).map((x) => `  ${routineLine(x)}.`)];
  const a = hh.outings.about;
  if (a) out.push(`Outings out and about: median ${a.medianMinutes} min over ${a.outings}; ${pct(a.longShare)} past three hours, ${pct(a.walkShare)} with an hour on foot, ${pct(a.foodShare)} stop to eat.`);
  for (const pr of hh.outings.pairs.slice(0, 3)) out.push(`  ${categoryLabel(pr.a)} goes with ${categoryLabel(pr.b).toLowerCase()}: ${pr.lift}× as likely (${pct(pr.rate)} vs ${pct(pr.base)}).`);
  for (const p of r.people) {
    const x = p.habits?.routines?.[0];
    if (x) out.push(`  ${p.displayName}'s strongest routine: ${routineLine(x)}.`);
  }
  return out;
}

function forecastBlock(m: MovementInputs): string[] {
  const f = m.forecast;
  if (!f) return ['The forecast could not be read.'];
  const out = [`Forecast as of ${hm(f.generatedAt)} (from ${f.days} days of routines):`];
  const fc = forecastLines(m);
  out.push(...(fc.length ? fc.map((l) => `  ${l}`) : ['  No forecast day for anyone right now.']));
  const watch = watchLines(m);
  if (watch.length) out.push('Looks off against routine:', ...watch.map((w) => `  ${w}`));
  const est = f.routines.filter((x) => x.days >= 8).sort((a, b) => b.days / b.of - a.days / a.of).slice(0, 8);
  if (est.length) out.push('Dependable routines:', ...est.map((x) => `  ${x.person}: ${x.from} → ${x.to} ${x.dayType === 'weekday' ? 'weekdays' : 'weekends'} about ${x.departure} (${x.days} of ${x.of} days, by ${x.mode}).`));
  const s = m.scorecard;
  if (s) {
    const parts = [
      s.next.precision != null ? `"usually leaves" came true ${pct(s.next.precision)} of the time` : null,
      s.next.recall != null ? `${pct(s.next.recall)} of journeys were foreseen` : null,
      s.duration.medianError != null ? `journey times within a median ${Math.round(s.duration.medianError)} min` : null,
    ].filter(Boolean);
    if (parts.length) out.push(`How good the forecast has been (${s.from} to ${s.to}): ${parts.join('; ')}. Weigh it accordingly.`);
  }
  return out;
}

/** One section of the `household_patterns` tool. */
export function renderMovement(m: MovementInputs, section: MovementSection, person: string | null): string {
  const r = m.report;
  if (section === 'forecast') return forecastBlock(m).join('\n');
  if (!r) return 'The household patterns report has not been built yet (it is built nightly at 2am).';
  const head = `HOUSEHOLD PATTERNS — ${r.days} days to ${r.to.slice(0, 10)}, built ${r.generatedAt.slice(0, 10)}.`;
  switch (section) {
    case 'person': {
      const q = (person ?? '').trim().toLowerCase();
      const p = r.people.find((x) => x.subject.toLowerCase() === q || x.displayName.toLowerCase() === q)
        ?? r.people.find((x) => q && x.displayName.toLowerCase().startsWith(q));
      if (!p) return `${head}\nName someone: ${r.people.map((x) => x.displayName).join(', ')}.`;
      return [head, ...personBlock(p, m), ...r.findings.filter((f) => f.subject === p.subject).slice(0, 4).map((f) => `  Worth knowing: ${f.text}`)].join('\n');
    }
    case 'steps':
      return [head, ...stepsBlock(r)].join('\n');
    case 'together':
      return [head, ...togetherBlock(r, m)].join('\n');
    case 'habits':
      return [head, ...habitsBlock(r)].join('\n');
    default:
      return [
        head,
        'Worth knowing:',
        ...r.findings.slice(0, 8).map((f) => `  - ${f.text}`),
        'People:',
        ...r.people.map((p) => `  ${p.displayName}: ${pct(p.homeShare)} home, ${num(p.awayHours)} h out, steps ${num(p.steps.mean)}/day, anchor ${p.places.find((x) => x.category !== 'home')?.name ?? '—'}.`),
        `Sections: ${MOVEMENT_SECTIONS.join(', ')} (person needs a name).`,
      ].join('\n');
  }
}
