// showcase-place-words.ts — the words of the landing showcase told in the
// "place" view (showcase-place.ts draws its scenes): each scene's labels,
// what the plate says when one is open, and the wayfinding sign's arms.
//
// The copy follows the landing page's rules: figures only ever come from the
// data (no digits in the words below, a test reads this file to make sure),
// en-GB grouping, a real minus sign, null is a dash with a spoken
// alternative, and nothing says where anyone is or how long a reading has
// been missing. Pure, and unit-tested with the scenes (showcase-place.test.ts).

import { formatFigure } from './showcase-motion';
import { TEN_THOUSAND } from './showcase-data';
import { clock, countWord } from './sentence';
import type { Daydream } from './sentence';
import type { DaydreamShowcase, HealthShowcase, AppShowcase, BuildShowcase } from './showcase';
import type { LandingVitals } from './live-vitals.svelte';
import { dayWords, trend, MOON_FULL_HOURS, type Band, type Sky } from './showcase-place';

/* =================================================================== copy */
/* copy:start — words only below this line; every figure comes from data. */

const DASH = '—';
const ASIDE = 'not answering just now';

export interface Tag {
  id: string;
  kicker: string;
  /** The figure or word shown large; a dash when it is not in. */
  value: string;
  /** Said instead of `value` when the value is only a dash. */
  spoken?: string;
  unit?: string;
  sub?: string;
  /** What the plate says when this label is open. */
  note: string;
}

/** A figure as a label shows it, or a dash with something to say instead. */
export function figure(n: number | null | undefined, decimals = 0): { value: string; spoken?: string } {
  if (n == null || !Number.isFinite(n)) return { value: DASH, spoken: ASIDE };
  return { value: formatFigure(n, decimals) };
}

/** "a", "b and c", "a, b and c". */
export function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "one idea", "three ideas", "14 ideas". */
export function plural(n: number, one: string, many: string): string {
  return `${countWord(n)} ${n === 1 ? one : many}`;
}

const BAND_WORD: Record<Band, string> = { high: 'good', mid: 'middling', low: 'low' };
export const bandWord = (b: Band | null | undefined) => (b ? BAND_WORD[b] : null);

/** A label as one line of text, for print and the loose list. */
export function tagLine(t: Tag): string {
  const v = t.spoken ? `${t.spoken}` : [t.value, t.unit].filter(Boolean).join(' ');
  return `${t.kicker} · ${v}${t.sub ? ` (${t.sub})` : ''}`;
}

/* ---- the observatory */

export interface DaydreamWords {
  head: { kicker: string; title: string; unit: string; aside: string };
  key: string;
  rules: string;
  tags: Record<'dome' | 'lookups' | 'struck' | 'useful' | 'shipped' | 'next', Tag>;
}

/**
 * The next think as the observatory says it: the dome's own words where the
 * hero's would only repeat one screen up, the hero's where they are a time.
 */
export function observatoryNext(next: Daydream, hero: { value: string; sub?: string }): { value: string; sub?: string } {
  switch (next.state) {
    case 'off':
      return { value: 'the dome’s shut', sub: 'for now' };
    case 'asleep':
      return { value: 'closed for the night', sub: `opens at ${next.wakes}` };
    case 'now':
      return { value: 'looking up', sub: 'right now' };
    case 'next':
      return { value: hero.value, sub: 'till the dome opens again' };
    default:
      return { value: hero.value, sub: hero.sub };
  }
}

export function daydreamWords(dd: DaydreamShowcase, sky: Pick<Sky, 'drawn' | 'capped'>, next: Daydream, nextWords: { value: string; sub?: string }): DaydreamWords {
  const w = dd.week;
  const im = dd.impact;
  const r = dd.rules;
  const hit = im?.hitRate == null ? null : Math.round(im.hitRate * 100);
  const was = im?.previousHitRate == null ? null : Math.round(im.previousHitRate * 100);
  const way = trend(im?.hitRate, im?.previousHitRate);
  const weeks = im?.weeks.length ?? 0;
  const hours = figure(w?.hours, 1);
  return {
    head: {
      kicker: 'Daydream · the observatory',
      title: 'It thinks while nobody’s watching',
      unit: 'questions it asked itself this week',
      aside: 'It keeps better hours than I do.',
    },
    key:
      w == null
        ? 'The sky is empty because the week’s figures aren’t answering just now, not because it stopped wondering.'
        : sky.capped
          ? `A star for every question it asked itself this week, the first ${formatFigure(sky.drawn)} of them anyway, the rest wouldn’t fit. By day they stay up as points on the dome’s chart.`
          : `A star for every question it asked itself this week, plotted on the dome’s chart while the sun’s up, and the dome lit for the hours it spent thinking.`,
    rules: `A think every ${r.cadenceMinutes} minutes from ${clock(r.activeHours.start)} to ${clock(r.activeHours.end)}, at most ${r.maxLookups} look-ups a think, and never more than ${r.dailyRaiseCap} notes a day raised to me.`,
    tags: {
      dome: {
        id: 'dome',
        kicker: 'In the dome',
        ...hours,
        unit: 'hours thinking',
        sub: w ? `across ${countWord(w.areasCovered)} of ${countWord(r.areas)} areas of life` : undefined,
        note: `The slit is lit for the share of the waking week it spent thinking, and each panel is an area of my life, lit if it looked there this week.`,
      },
      lookups: {
        id: 'lookups',
        kicker: 'Look-ups',
        ...figure(w?.lookups),
        unit: 'this week',
        sub: `never more than ${r.maxLookups} in one think`,
        note: `Before it writes anything down it can go and look things up, and it has to stop at ${r.maxLookups} a think.`,
      },
      struck: {
        id: 'struck',
        kicker: 'Struck out',
        ...figure(w?.struckOut),
        unit: w?.struckOut === 1 ? 'claim' : 'claims',
        sub: 'by its own auditor',
        note:
          'A second pass checks each claim against its source before a note reaches me, and crosses out what it can’t stand behind.' +
          (w?.struckOut === 0 ? ' This week it found nothing to cross out.' : w ? ' Those are the crossed stars.' : ''),
      },
      useful: {
        id: 'useful',
        kicker: 'Worth reading',
        ...(hit == null ? figure(null) : { value: `${formatFigure(hit)}%` }),
        unit: !im ? undefined : im.rated > 0 ? `of ${formatFigure(im.rated)} rated` : 'nothing rated yet',
        sub:
          way == null || was == null
            ? `over ${r.windowDays} days`
            : way === 'level'
              ? `level with the ${r.windowDays} days before`
              : `${way} from ${formatFigure(was)}%`,
        note: `My verdicts, a star a week for the last ${countWord(weeks)} weeks, higher where more notes were useful and bigger where I rated more. I rate them on my phone.`,
      },
      shipped: {
        id: 'shipped',
        kicker: 'Shipped',
        ...figure(im?.shipped),
        unit: im?.shipped === 1 ? 'idea' : 'ideas',
        sub: 'became real code',
        note: im
          ? `I’ve taken up ${formatFigure(im.accepted)} of its ideas so far and ${formatFigure(im.shipped)} ${im.shipped === 1 ? 'has' : 'have'} gone on to ship. They fall as shooting stars, towards the works further down.`
          : 'Ideas it had on its own that went on to ship, drawn as shooting stars when the figures are in.',
      },
      next: {
        id: 'next',
        kicker: 'Next think',
        ...observatoryNext(next, nextWords),
        note:
          next.state === 'asleep'
            ? 'Out of hours the cloud lies low as mist. It starts again in the morning.'
            : next.state === 'off'
              ? 'The cloud is only an outline while the loop is switched off.'
              : 'The cloud fills as the next think nears and rains while one is under way.',
      },
    },
  };
}

/* ---- the long walk */

export interface HealthWords {
  head: { kicker: string; title: string; unit: string; decimals: number; figure: number | null; aside: string };
  key: string;
  tags: Tag[];
}

export function healthWords(
  h: HealthShowcase,
  opts: { bpm: number | null; today: number | null; walkStep: number; overInWindow: number; days: number },
): HealthWords {
  const kmLead = h.stepsYear == null && h.kmYear != null;
  const r = h.recovery30;
  const total = r ? r.high + r.mid + r.low : 0;
  const best = h.bestDay;
  const tags: Tag[] = [
    {
      id: 'km',
      kicker: 'On foot',
      ...figure(h.kmYear, 1),
      unit: 'km this year',
      sub: best ? `best day ${formatFigure(best.steps)} steps, ${dayWords(best.date)}` : undefined,
      note:
        `The walkway is every kilometre I’ve walked or run since January, starting high up on the left` +
        (opts.walkStep > 0 ? `, with a marker every ${formatFigure(opts.walkStep)} km` : '') +
        '.',
    },
    {
      id: 'over',
      kicker: `Over ${formatFigure(TEN_THOUSAND)}`,
      ...figure(h.daysOver10k),
      unit: h.daysOver10k === 1 ? 'day this year' : 'days this year',
      sub: h.steps30?.length ? `${countWord(opts.overInWindow)} of the last ${opts.days}` : undefined,
      note: `A street tree for each of the last ${opts.days} days with readings, as tall as its steps. The ones over the dashed line made ${formatFigure(TEN_THOUSAND)}, and the tallest has a light on top. A gap is a day the phone didn’t send.`,
    },
    {
      id: 'recovery',
      kicker: 'Recovery',
      ...figure(r ? r.high : null),
      unit: r ? `good of ${total}` : undefined,
      sub: r
        ? `${countWord(r.mid)} middling, ${countWord(r.low)} low${h.bands.recovery ? ` · today ${bandWord(h.bands.recovery)}` : ''}`
        : undefined,
      note: 'A light on the festoon over the street for each morning’s recovery reading over the last month, sorted rather than dated. Lit for good, half-lit for middling and dark for low, so the shape says it as well as the colour.',
    },
    {
      id: 'sleep',
      kicker: 'Sleep',
      ...figure(h.sleepAvg7, 1),
      unit: 'hours a night',
      sub: `the last seven${h.bands.sleep ? ` · last night ${bandWord(h.bands.sleep)}` : ''}`,
      note: `The moon fills towards full at ${countWord(MOON_FULL_HOURS)} hours a night, naps not included.`,
    },
    // Today is a flourish: with no steps in yet it is left out, never said,
    // unless a fresh pulse has something to show at the town house instead.
    ...(opts.today == null && opts.bpm == null ? [] : [todayTag(opts.today, opts.bpm)]),
  ];
  return {
    head: {
      kicker: 'Health · the long walk',
      title: 'My body, on the record',
      unit: kmLead ? 'km on foot this year' : 'steps since January',
      decimals: kmLead ? 1 : 0,
      figure: kmLead ? h.kmYear : h.stepsYear,
      aside: 'Most of it was to the kettle and back.',
    },
    key: 'The year on foot winds down between the towers as one long walkway, the last month standing under it as street trees.',
    tags,
  };
}

/** The town house's label: today's steps (with the pulse under them when fresh), or the pulse alone. */
function todayTag(today: number | null, bpm: number | null): Tag {
  const glow = ' The front window glows with my pulse as the watch last read it.';
  if (today == null) return { id: 'today', kicker: 'Pulse', ...figure(bpm), unit: 'bpm', note: glow.trim() };
  return {
    id: 'today',
    kicker: 'Today',
    ...figure(today),
    unit: 'steps so far',
    sub: bpm != null ? `pulse ${formatFigure(bpm)} bpm` : undefined,
    note: 'Today on foot, an hour to a bar since midnight, nothing drawn after now.' + (bpm != null ? glow : ''),
  };
}

/* ---- the house with a light on */

export interface AppWords {
  head: { kicker: string; title: string; unit: string; aside: string };
  key: string;
  pairing: string;
  tags: Tag[];
}

export function appWords(a: AppShowcase): AppWords {
  const home = a.widgets.filter((w) => w.surface === 'home-screen').map((w) => w.name);
  const readiness = a.complications.find((c) => /readiness/i.test(c.name));
  const quoted = a.intents.map((i) => `“${i.title}”`);
  const games = a.games;
  return {
    head: {
      kicker: 'The SR App · the flat with a light on',
      title: 'It lives in my pocket',
      unit: 'doorways from the app into the site',
      aside: 'It goes everywhere I go, which is mostly the kitchen.',
    },
    key: 'Every lit pane in the office tower is a doorway the app can knock on, lit one by one. The phone and the watch on the sill of the flat do the knocking.',
    pairing: `A new phone gets in with a code that dies in ${countWord(a.pairCodeMinutes)} minutes, and the key it’s given lasts ${formatFigure(a.deviceTokenDays)} days.`,
    tags: [
      {
        id: 'phone',
        kicker: 'iPhone',
        ...figure(a.tabs),
        unit: a.tabs === 1 ? 'tab' : 'tabs',
        sub: a.tabNames.join(', '),
        note: 'A tab for each part of the site I use most. The Daydream inbox lives under More, a button for useful and one for not, which is where the percentage in the observatory comes from.',
      },
      {
        id: 'watch',
        kicker: 'Apple Watch',
        value: readiness ? readiness.name : formatFigure(a.watchPages),
        unit: readiness ? undefined : 'pages',
        sub: readiness ? 'the same number as the health page' : undefined,
        note: `The watch has ${countWord(a.watchPages)} pages of its own and ${plural(a.complications.length, 'complication', 'complications')} for the watch face. ${readiness ? `${readiness.name} shows the same number as the health page, from the same reading.` : ''}`.trim(),
      },
      {
        id: 'siri',
        kicker: 'Siri',
        ...figure(a.intents.length),
        unit: a.intents.length === 1 ? 'phrase' : 'phrases',
        sub: listWords(quoted),
        note: `Say ${listWords(quoted)} to Siri, or press the Action button, and it happens without the app being opened.`,
      },
      {
        id: 'lock',
        kicker: 'Lock Screen',
        value: a.liveActivities ? 'Live Activity' : formatFigure(a.widgets.length),
        unit: a.liveActivities ? undefined : 'widgets',
        sub: home.length ? `and ${listWords(home)} on the Home Screen` : undefined,
        note: 'A trip in progress shows on the Lock Screen, updated by push from the site, which decides every word. The family widgets sit on the Home Screen.',
      },
      {
        id: 'games',
        kicker: 'Family games',
        ...figure(games.length),
        unit: games.length === 1 ? 'game' : 'games',
        sub: games.length > 2 ? `${games.slice(0, 2).join(', ')} and ${countWord(games.length - 2)} more` : listWords(games),
        note: `${listWords(games)}. Who played and who won stays in the family.`,
      },
      {
        id: 'areas',
        kicker: 'Parts of the site',
        ...figure(a.nativeAreas),
        sub: `${formatFigure(a.nativeEndpoints)} ${a.nativeEndpoints === 1 ? 'window' : 'windows'} between them`,
        note: `Health, family, chat, games and the rest, ${formatFigure(a.nativeEndpoints)} doorways across ${formatFigure(a.nativeAreas)} parts of the site, each one only opening for a paired phone.`,
      },
    ],
  };
}

/* ---- the works */

export interface WorksWords {
  head: { kicker: string; title: string; unit: string; aside: string };
  key: string;
  tags: Tag[];
}

export function worksWords(b: BuildShowcase, builder: LandingVitals['builder'] | null): WorksWords {
  const since = b.firstDeploy ? dayWords(b.firstDeploy.slice(0, 10)) : null;
  const stage = builder ? (builder.stage || 'idle').toLowerCase() : null;
  return {
    head: {
      kicker: 'Builder · the works',
      title: 'It rewrites itself, then ships',
      unit: 'releases so far',
      aside: 'I mostly hold the ladder.',
    },
    key:
      b.releases == null
        ? 'A site between the towers, still going up. The release record isn’t answering just now, so nothing here is counted until it’s back.'
        : 'A site between the towers at the edge of town, still going up. The crane lowers today’s deploys onto it, a crate each.',
    tags: [
      {
        id: 'today',
        kicker: 'Today',
        ...figure(b.deploysToday),
        unit: b.deploysToday === 1 ? 'deploy' : 'deploys',
        sub: b.deploysToday == null ? undefined : 'on the hook',
        note: 'A crate on the hook for each deploy today. A deploy is the site swapping itself for a newer copy of itself, while it’s running.',
      },
      {
        id: 'rate',
        kicker: 'Every day',
        ...figure(b.deploysPerDay, 1),
        unit: 'deploys a day',
        sub: b.days == null ? undefined : `over ${formatFigure(b.days)} days`,
        note: since ? `On average, every day since the first deploy on ${since}.` : 'On average, every day since the first deploy.',
      },
      {
        id: 'lines',
        kicker: 'Lines written',
        ...figure(b.linesWritten),
        unit: 'lines',
        sub: b.days == null ? undefined : `in ${formatFigure(b.days)} days`,
        note: 'Lines of code added across every release, mine and the builder’s together.',
      },
      {
        id: 'builder',
        kicker: 'Builder',
        value: stage ?? DASH,
        spoken: stage ? undefined : ASIDE,
        sub: builder ? (builder.active ? 'at it right now' : builder.shippedCount > 0 ? `${formatFigure(builder.shippedCount)} shipped` : undefined) : undefined,
        note: 'The builder takes an idea I’ve accepted, writes the change, tests it and hands it to me to look over. The sign says what it’s doing now.',
      },
      {
        id: 'daydream',
        kicker: 'From Daydream',
        ...figure(b.fromDaydream),
        unit: b.fromDaydream === 1 ? 'idea shipped' : 'ideas shipped',
        sub: 'fell in from the observatory',
        note: 'Ideas Daydream had by itself that made it all the way here.',
      },
    ].filter((t) => (OPTIONAL_WORKS.has(t.id) ? t.value !== DASH : true)),
  };
}

/** Readings the works leaves out when they are not in, rather than draw a row of dashes. */
const OPTIONAL_WORKS = new Set(['today', 'rate', 'lines', 'daydream']);

/* ---- the signpost */

export interface Arm {
  id: string;
  name: string;
  status: string;
  href: string;
}

export function signposts(v: LandingVitals | null, now: number, agoFn: (iso: string | null | undefined, ref: number) => string): Arm[] {
  const c = v?.canvas;
  const jobs = v?.jkai.activeJobs ?? 0;
  const ran = c?.lastRunAt ? agoFn(c.lastRunAt, now) : '';
  return [
    {
      id: 'schedule',
      name: 'Run on a schedule',
      status: c ? `${plural(c.count, 'canvas', 'canvases')}${ran ? ` · ran ${ran}` : ''}` : 'canvases that fire on their own',
      href: '/projects/engine-room',
    },
    {
      id: 'answer',
      name: 'Answer back',
      status: v ? (jobs > 0 ? `${plural(jobs, 'job', 'jobs')} running` : 'quiet right now') : 'the assistant behind it all',
      href: '/projects/engine-room',
    },
    { id: 'family', name: 'Track the family', status: 'private to the family', href: '/projects/engine-room/app' },
  ];
}

/* copy:end */
