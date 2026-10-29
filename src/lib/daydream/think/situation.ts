// src/lib/daydream/think/situation.ts
//
// "Right now": the whole picture a private cycle starts from. PURE — the
// shape and its words; `situation.server.ts` gathers it.
//
// Owner, 2026-10-29: daydreams should "consider all aspects of user location,
// physiology, health, family members they're with, mood, calendar … think
// about complex relationships". On 28 October, in Rome with the family, the
// loop twice suggested a short easy run at home pace because recovery was
// green: each cycle starts from ONE channel and saw nothing outside it.
//
// So code builds this card before the model looks, every private cycle, and
// it is citable like any other. It is context, not a channel: no note is ABOUT
// where he is (decision D1, 2026-09-25, still holds against place notes), but
// no note may ignore it either. Coordinates never appear — named places,
// home or away, a distance band.

export interface PersonNow {
  name: string;
  /** 'home' | 'out' | 'unknown' | 'off' — `nowStatus` from /home/people. */
  status: 'home' | 'out' | 'unknown' | 'off';
  place: string | null;
  distanceKm: number | null;
  ageMins: number | null;
}

export interface SituationInputs {
  /** Local, e.g. "Thursday 29 October 2026, 14:10". */
  localTime: string;
  me: PersonNow | null;
  /** The rest of the household, sharing or not. */
  others: PersonNow[];
  trip: { title: string; destination: string; startDate: string; endDate: string; today: boolean } | null;
  /** The /health read section, as text, or null when it could not be read. */
  body: string | null;
  sleepLastNight: number | null;
  recoveryToday: number | null;
  hrv: { today: number; usual: number } | null;
  mood: { latest: number; latestDay: string; week: number | null; before: number | null } | null;
  /** Today and tomorrow, as the diary tool renders them. */
  diary: string | null;
}

/** "with" = at the same named place, or both at home, on fresh fixes. */
export function companions(me: PersonNow | null, others: readonly PersonNow[]): string[] {
  if (!me || (me.status !== 'home' && me.status !== 'out')) return [];
  return others
    .filter((o) => o.status === me.status && (me.status === 'home' || (!!me.place && o.place === me.place)))
    .map((o) => o.name);
}

function distanceBand(km: number | null): string {
  if (km == null) return '';
  if (km < 2) return 'nearby';
  if (km < 30) return `about ${Math.round(km)} km from home`;
  if (km < 300) return `${Math.round(km / 10) * 10} km from home`;
  return 'far from home (abroad or a long trip)';
}

function where(p: PersonNow): string {
  switch (p.status) {
    case 'home':
      return 'at home';
    case 'out':
      return `out${p.place ? ` at ${p.place}` : ''}${p.distanceKm != null ? `, ${distanceBand(p.distanceKm)}` : ''}`;
    case 'off':
      return 'not sharing location';
    default:
      return p.ageMins == null ? 'location unknown' : `last seen ${p.place ? `at ${p.place}` : p.distanceKm != null ? distanceBand(p.distanceKm) : 'somewhere'} ${Math.round(p.ageMins / 60)} h ago`;
  }
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function moodWords(v: number): string {
  if (v <= -0.5) return 'very unpleasant';
  if (v < -0.1) return 'unpleasant';
  if (v <= 0.1) return 'neutral';
  if (v < 0.5) return 'pleasant';
  return 'very pleasant';
}

/** The card text. Every line says "unknown" rather than leave a gap. */
export function renderSituation(s: SituationInputs): string {
  const lines = [`RIGHT NOW — ${s.localTime} (Europe/London).`];

  lines.push(`Where he is: ${s.me ? where(s.me) : 'unknown'}.`);
  const withHim = companions(s.me, s.others);
  lines.push(withHim.length ? `With him (same place now): ${withHim.join(', ')}.` : 'With him: nobody else in the household is at the same place, as far as the trail shows.');
  const rest = s.others.filter((o) => !withHim.includes(o.name));
  if (rest.length) lines.push(`The rest of the household: ${rest.map((o) => `${o.name} ${where(o)}`).join('; ')}.`);

  if (s.trip) {
    lines.push(
      s.trip.today
        ? `ON A TRIP: "${s.trip.title}" in ${s.trip.destination}, ${s.trip.startDate} to ${s.trip.endDate}. Home routines, home training plans and house chores do not apply until he is back.`
        : `Next trip: "${s.trip.title}" in ${s.trip.destination}, ${s.trip.startDate} to ${s.trip.endDate}.`,
    );
  }

  const body: string[] = [];
  if (s.sleepLastNight != null) body.push(`slept ${r1(s.sleepLastNight)} h last night`);
  if (s.recoveryToday != null) body.push(`recovery ${Math.round(s.recoveryToday)}%`);
  if (s.hrv) body.push(`HRV ${Math.round(s.hrv.today)} ms against a usual ${Math.round(s.hrv.usual)} ms`);
  lines.push(body.length ? `Body: ${body.join(', ')}.` : 'Body: no sleep or recovery reading today.');
  if (s.body) lines.push(`What /health concludes: ${s.body.replace(/\s+/g, ' ').slice(0, 500)}`);

  if (s.mood) {
    const trend =
      s.mood.week != null && s.mood.before != null
        ? ` This week averages ${moodWords(s.mood.week)} (${r1(s.mood.week)}) against ${moodWords(s.mood.before)} (${r1(s.mood.before)}) before.`
        : '';
    lines.push(`Mood: last logged ${moodWords(s.mood.latest)} (${r1(s.mood.latest)} on −1 to 1) on ${s.mood.latestDay}.${trend}`);
  } else {
    lines.push('Mood: none logged in the last fortnight.');
  }

  lines.push(s.diary ? `Diary, today and tomorrow — ${s.diary.replace(/\n\s*/g, '; ').slice(0, 600)}` : 'Diary: could not be read — unknown, not empty.');
  return lines.join('\n');
}

/** The prompt's standing rules for the card. */
export const SITUATION_RULES = [
  'THE SITUATION CARD comes first: read it before anything else, and test every suggestion against it.',
  '- A suggestion that ignores it is wrong. Abroad or on a trip: no home training plan, no house chore, no "today at home" step. A red recovery: no hard session. A full diary: nothing that needs an hour he does not have. With the family: prefer what they can do together.',
  '- Look for the INTERACTION, not one signal: sleep with mood, recovery with who he was with, a busy diary with both. Say which factors you weighed.',
  '- Cite the situation card when it shaped the note.',
] as const;
