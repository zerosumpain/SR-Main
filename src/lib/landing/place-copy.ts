// place-copy.ts — the words of the landing hero's "place" view: the five small
// labels pinned to the picture, and the plate that explains whichever label is
// pointed at, focused or tapped.
//
// The honest states are the sentence's (sentence.ts), said in a label's few
// words: a dash until a reading is real, a stale pulse that never says for how
// long, steps that are "none yet" rather than zero, a daydreamer that is
// asleep, thinking now or switched off. The explanations are the sentence's
// footnotes, retold for the picture ("the beacon" where they say "the line").
// Pure, so every state is a unit test (place-copy.test.ts).

import type { CapabilityFacts } from './capabilities';
import { dayName, type DayCount, type ShipStats } from './rhythm';
import { agoWords, clock, sinceWords, spanWords, type Daydream, type NoteId, type Pulse } from './sentence';
import { lampFor } from './place';
import { BPM_MAX, BPM_MIN, clampBpm } from './traces';

export interface Tag {
  /** "Pulse". */
  kicker: string;
  /** The reading itself: "52", "2,884", "asleep", or "—" until it is real. */
  value: string;
  /** Said instead of `value` when the value is only a dash. */
  spoken?: string;
  /** Set small after the value: "bpm", "steps today". */
  unit: string;
  /** A second line, when the reading needs one. */
  sub?: string;
}

export interface TagInput {
  now: number;
  pulse: Pulse;
  steps: number | null;
  daydream: Daydream;
  cadenceMinutes: number;
  /** Deploys today and yesterday, or null when the release record is unavailable. */
  deploys: { today: number; yesterday: number } | null;
  releases: { total: number; since: string | null } | null;
}

const DASH = '—';

export function pulseTag(p: Pulse, now: number): Tag {
  if (p.state === 'fresh')
    return {
      kicker: 'Pulse',
      value: String(p.bpm),
      unit: 'bpm',
      sub: `Apple Watch · ${agoWords(p.at, now)}`,
    };
  // As in the sentence: stale says so, never for how long.
  return {
    kicker: 'Pulse',
    value: DASH,
    spoken: 'no fresh reading',
    unit: 'bpm',
    sub: p.state === 'stale' ? 'nothing fresh from the watch' : 'waiting on the watch',
  };
}

export function stepsTag(steps: number | null): Tag {
  if (steps == null) return { kicker: 'Steps', value: DASH, spoken: 'none', unit: 'not in yet' };
  return {
    kicker: 'Steps',
    value: steps.toLocaleString('en-GB'),
    unit: 'today',
  };
}

export function daydreamTag(d: Daydream): Tag {
  const kicker = 'Daydream';
  switch (d.state) {
    case 'next':
      return {
        kicker,
        value: spanWords(d.minutes),
        unit: '',
        sub: 'till the site next thinks',
      };
    case 'now':
      return { kicker, value: 'thinking', unit: '', sub: 'right now' };
    case 'late':
      return {
        kicker,
        value: 'running late',
        unit: '',
        sub: `it was due ${spanWords(d.minutes)} ago`,
      };
    case 'asleep':
      return {
        kicker,
        value: 'asleep',
        unit: '',
        sub: `till ${d.wakes} · the loop, not me`,
      };
    case 'off':
      return { kicker, value: 'switched off', unit: '', sub: 'for now' };
    case 'unknown':
      return { kicker, value: `every ${spanWords(d.cadence)}`, unit: '' };
  }
}

export function shipTag(deploys: TagInput['deploys']): Tag {
  if (!deploys)
    return {
      kicker: 'Ship',
      value: DASH,
      spoken: 'unknown',
      unit: 'the record isn’t answering',
    };
  const t = deploys.today;
  return {
    kicker: 'Ship',
    value: String(t),
    unit: t === 1 ? 'deploy today' : 'deploys today',
    sub: deploys.yesterday === 0 ? 'after a quiet yesterday' : `after ${deploys.yesterday} yesterday`,
  };
}

export function releasesTag(r: TagInput['releases'], now: number): Tag {
  if (!r || r.total <= 0)
    return {
      kicker: 'Releases',
      value: DASH,
      spoken: 'unknown',
      unit: 'the record isn’t answering',
    };
  const since = sinceWords(r.since, now);
  return {
    kicker: 'Releases',
    value: r.total.toLocaleString('en-GB'),
    unit: since ? `since ${since}` : 'in all',
  };
}

/** A label as one line of text, for print: a dashed reading says why rather than "— bpm". */
export function tagLine(t: Tag): string {
  if (t.spoken) return `${t.kicker} · ${t.sub ?? t.unit}`;
  return `${t.kicker} · ${[t.value, t.unit].filter(Boolean).join(' ')}${t.sub ? ` (${t.sub})` : ''}`;
}

/**
 * The line under the plate saying what the beacon is doing. Any rate it shows is
 * the real one; only a beacon that flashes says the rate it flashes at, and then
 * owns up when that is the nearest it can draw.
 */
export function lampCaption(bpm: number | null, reduced: boolean): string {
  if (bpm == null) return 'the beacon is dark: no fresh pulse to keep';
  const drawn = clampBpm(bpm);
  if (reduced) return `the beacon is lit for ${bpm} bpm, and keeps still`;
  if (lampFor(drawn) === 'steady') return `at ${bpm} bpm the beacon holds steady, too quick to flash`;
  return `the beacon keeps time at ${drawn} bpm${drawn === bpm ? '' : ', as near as it draws'}`;
}

/** All five, in the sentence's reading order. */
export function placeTags(s: TagInput): Record<NoteId, Tag> {
  return {
    pulse: pulseTag(s.pulse, s.now),
    steps: stepsTag(s.steps),
    daydream: daydreamTag(s.daydream),
    ship: shipTag(s.deploys),
    releases: releasesTag(s.releases, s.now),
  };
}

/* ------------------------------------------------------------- the plate */

export interface Plate {
  /** Read on focus, so a label explains itself before it is opened. */
  hint: string;
  head: string;
  text: string;
  href: string;
  cta: string;
}

export interface PlateInput {
  now: number;
  pulse: Pulse;
  facts: CapabilityFacts['daydream'];
  /** The last forty days, oldest first, and what they add up to. */
  days: DayCount[];
  stats: ShipStats;
  /** Null (or no releases) when the record is unavailable. */
  releases: { total: number; days: number } | null;
  /** The first and last day the far skyline draws, or null with none. */
  ridge: { from: string; to: string } | null;
}

/** The plate for a part drawn from the release record while the record is away. */
function away(kicker: 'Ship' | 'Releases', part: 'street' | 'far skyline'): Plate {
  return {
    hint: kicker === 'Ship' ? 'Deploys today.' : 'Every release on record.',
    head: `${kicker} · the record isn’t answering`,
    text: `The release record isn’t answering just now, so the ${part} is left out rather than drawn empty. Nothing here is counted until it’s back.`,
    href: '/releases',
    cta: 'Browse the record',
  };
}

/** What each label's plate says: the sentence's footnotes, told for the picture. */
export function placePlates(p: PlateInput): Record<NoteId, Plate> {
  const bpm = p.pulse.state === 'fresh' ? p.pulse.bpm : null;
  const drawn = bpm == null ? null : clampBpm(bpm);
  const lamp = lampFor(drawn);
  const dd = p.facts;
  const hit = dd.hitRate == null ? null : Math.round(dd.hitRate * 100);
  const busiest = p.stats.busiest;
  const n = p.days.length;
  return {
    pulse: {
      hint: 'Heart rate, from the Apple Watch.',
      head: `Pulse · Apple Watch · ${p.pulse.state === 'fresh' ? `read ${agoWords(p.pulse.at, p.now)}` : 'no fresh reading'}`,
      text:
        'My heart rate as the Apple Watch last read it, sent up by the phone. ' +
        (drawn == null
          ? 'With no fresh reading the beacon stays dark rather than make one up.'
          : lamp === 'steady'
            ? 'Above 180 a minute a flash would come more than three times a second, so the beacon holds steady instead.'
            : drawn !== bpm
              ? `The beacon keeps ${BPM_MIN} to ${BPM_MAX} a minute, so it flashes at ${drawn}, the nearest it can.`
              : lamp === 'lubdub'
                ? 'The beacon on the tallest tower flashes at exactly that rate, twice a beat like the heart.'
                : 'The beacon on the tallest tower flashes once a beat at exactly that rate.'),
      href: '/health',
      cta: 'Health record',
    },
    steps: {
      hint: 'Steps since midnight, from the phone.',
      head: 'Steps · 00:00 → 23:59 · a mark per quarter-hour',
      text: 'Today on foot along the promenade, each mark as tall as its quarter-hour’s steps: midnight at the left, 23:59 at the right. Nothing is drawn after now; the rest is pending.',
      href: '/health',
      cta: 'Health record',
    },
    daydream: {
      hint: 'When the site next thinks to itself.',
      head: `Daydream · every ${dd.cadenceMinutes} min · ${clock(dd.activeHours.start)}–${clock(dd.activeHours.end)}`,
      text:
        `Between ${clock(dd.activeHours.start)} and ${clock(dd.activeHours.end)} the site asks itself one narrow question at a time and writes down only what is worth attention. The cloud fills as the next one nears.` +
        (hit != null ? ` ${hit}% of rated notes were useful over the last ${dd.windowDays} days.` : ''),
      href: '/projects/engine-room/daydream',
      cta: 'How Daydream works',
    },
    // With the record down there is no street and no far skyline, and nothing to count:
    // the plate says so rather than state zeros, as the sentence does.
    ship: !n
      ? away('Ship', 'street')
      : {
          hint: 'Deploys today.',
          head: `Ship · ${p.days.at(-1)?.count ?? 0} today · ${p.days.at(-2)?.count ?? 0} yesterday · last ${n} days`,
          text:
            `A building a day for ${n} days, a lit pane per deploy, today outlined on the right. ` +
            (busiest
              ? `${p.stats.total.toLocaleString('en-GB')} in ${n} days, the busiest ${busiest.count} on ${dayName(busiest.date)}, and ${p.stats.quiet} days with none.`
              : `Nothing in ${n} days.`),
          href: '/releases',
          cta: 'Browse the record',
        },
    releases:
      !p.releases || p.releases.total <= 0
        ? away('Releases', 'far skyline')
        : {
            hint: 'Every release on record.',
            head: `Releases · ${p.releases.total.toLocaleString('en-GB')} over ${p.releases.days} days`,
            text: p.ridge
              ? `The far skyline is releases a day from ${dayName(p.ridge.from)} to ${dayName(p.ridge.to)}, taller for busier, each summarised from its own commit range. It stops where the street takes over, so no day is drawn twice.`
              : 'Releases a day since the first, each summarised from its own commit range. The record is too young for a far skyline yet; the street holds all of it.',
            href: '/releases',
            cta: 'Browse the record',
          },
  };
}
