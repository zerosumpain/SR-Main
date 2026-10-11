// The page's sections as things the rambler visits: the hero, Daydream, the
// health record, the app, the shipping record, Wildmind's valley, the writing
// strip and the footer. Each view marks its own version of a section with
// `data-rambler="<topic>"` (and, optionally, the interesting part of it with
// `data-rambler-focus`); the overlay reads the boxes, and this module decides
// where he stands to look at one (anchorFor) and what he does and says there
// (visitBeats). The visitor's own clicks get a reaction too (cueBeats).
//
// Every line is built from figures the section is already showing, in jk's
// voice (talk.ts): dry, British, lower case, no `!` and no `:`, the owner as
// "jk". Lines are read when their beat starts, not when the visit is planned,
// so a figure that changes while he watches (Wildmind's valley) is current.
// Pure apart from the random source.

import type { WildmindShowcase } from '../wildmind';
import type { Mode } from './rig';
import type { Line } from './talk';
import type { Floor, World } from './world';

export const TOPICS = ['hero', 'daydream', 'health', 'app', 'build', 'wildmind', 'writing', 'footer'] as const;
export type Topic = (typeof TOPICS)[number];

export const isTopic = (s: string | null | undefined): s is Topic => !!s && (TOPICS as readonly string[]).includes(s);

/** One thing he does on a visit: a pose for a while, and maybe something to say as it starts. */
export interface Beat {
  mode: Mode;
  dur: number;
  say?: () => Line | null;
}

type Band = 'low' | 'mid' | 'high' | null;

/** A person in Wildmind's valley, as the page shows them. */
export interface ValleyPerson {
  name: string;
  /** A fixed word from wildmind.ts DOING ("asleep", "at work"...). */
  doing: string;
  alive: boolean;
  thinking: boolean;
}

/** Wildmind's valley, cut down to what he talks about. */
export interface ValleyFacts {
  state: 'live' | 'resting' | 'paused' | 'between-lives' | 'stale' | 'offline';
  day: number | null;
  season: string | null;
  weather: string | null;
  people: ValleyPerson[];
  invented: number | null;
  latest: string[];
  generation: number | null;
  /** What the last life died of, as wildmind.ts CAUSE words ("hunger"). */
  lastCause: string | null;
  met: boolean | null;
}

/** What the sections are showing, all optional: a missing figure is never said as 0. */
export interface ExhibitFacts {
  bpm?: number | null;
  stepsToday?: number | null;
  deploysToday?: number | null;
  daydream?: { questions?: number | null; hours?: number | null; struckOut?: number | null; hitRate?: number | null; shipped?: number | null } | null;
  health?: { stepsYear?: number | null; kmYear?: number | null; daysOver10k?: number | null; sleep?: Band; recovery?: Band } | null;
  app?: { tabs?: number | null; watchPages?: number | null; widgets?: number | null; games?: string[] } | null;
  build?: { releases?: number | null; linesWritten?: number | null; deploysPerDay?: number | null; fromDaydream?: number | null } | null;
  valley?: ValleyFacts | null;
  /** Titles in the writing strip, newest first. */
  posts?: string[];
}

/** What the visitor did that he reacts to. */
export type Cue = 'view' | 'fair' | 'unfair' | 'hold' | 'unhold' | 'tuck' | 'explain' | 'back';

const pick = <T>(xs: readonly T[], random: () => number): T => xs[Math.floor(random() * xs.length) % xs.length];
const has = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);
const say = (text: string): Line => ({ text, kind: 'say' });
const think = (text: string): Line => ({ text, kind: 'think' });

/** 12,431 and 1.2m: a figure as he would say it. */
export function figure(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${Math.round(n / 100_000) / 10}m`;
  if (a >= 10_000) return `${Math.round(n / 1000)}k`;
  return Math.round(n).toLocaleString('en-GB');
}

/** A title quoted short enough for a bubble, cut at a word. */
export function quoted(title: string, max = 26): string {
  const t = title.trim().toLowerCase().replace(/[!:]/g, '');
  if (t.length <= max) return `"${t}"`;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `"${(at > 10 ? cut.slice(0, at) : cut).replace(/[\s,.;-]+$/, '')}..."`;
}

/**
 * Of a list of candidate lines (null where the figure is missing), one at
 * random; the fallback when none can be said.
 */
function oneOf(random: () => number, lines: Array<string | null | false | undefined>, fallback: string): string {
  const ok = lines.filter((l): l is string => typeof l === 'string' && l.length > 0);
  return ok.length ? pick(ok, random) : fallback;
}

// ---------------------------------------------------------------- the visits

function hero(f: () => ExhibitFacts, random: () => number): Beat[] {
  const beats: Beat[] = [];
  const bpm = f().bpm;
  if (has(bpm))
    beats.push({
      mode: 'pulse',
      dur: 5,
      say: () => {
        const b = f().bpm;
        if (!has(b)) return say('lost the beat. hang on');
        if (b >= 100) return say(`${b} a minute. jk is either running or reading emails`);
        if (b < 58) return say(`${b} a minute. jk is very relaxed. or asleep`);
        return say(oneOf(random, [`jk's heart, live. ${b} a minute`, `${b} bpm. i'm keeping time`, `that's jk's actual pulse. no pressure`], 'keeping time'));
      },
    });
  beats.push({
    mode: 'point',
    dur: 3.2,
    say: () => {
      const x = f();
      return say(
        oneOf(
          random,
          [
            has(x.stepsToday) && x.stepsToday > 0 && `${figure(x.stepsToday)} steps today. i've done laps of this page`,
            has(x.deploysToday) && x.deploysToday > 1 && `${x.deploysToday} deploys today. show-off`,
            has(x.deploysToday) && x.deploysToday === 1 && 'one deploy today. steady',
            'strange ramblings. i am the strange bit',
            'this is the front. i live here',
          ],
          'i live here',
        ),
      );
    },
  });
  if (!has(bpm)) beats.push({ mode: 'idle', dur: 2, say: () => say(pick(['make yourself at home', 'mind the numbers, they move'], random)) });
  return beats;
}

function daydream(f: () => ExhibitFacts, random: () => number): Beat[] {
  const d = () => f().daydream ?? {};
  return [
    {
      mode: 'think',
      dur: 5.5,
      say: () => {
        const x = d();
        return think(
          oneOf(
            random,
            [
              has(x.questions) && x.questions > 0 && `${figure(x.questions)} questions this week. mine was biscuits`,
              has(x.hours) && x.hours > 0 && `${x.hours} hours of thinking. i managed four minutes`,
              has(x.struckOut) && x.struckOut > 0 && `its own auditor struck out ${figure(x.struckOut)}. harsh`,
            ],
            'the site daydreams. so do i, mostly about tea',
          ),
        );
      },
    },
    {
      mode: 'point',
      dur: 3.2,
      say: () => {
        const x = d();
        return say(
          oneOf(
            random,
            [
              has(x.hitRate) && `${Math.round(x.hitRate * 100)}% of its ideas were useful. beats mine`,
              has(x.shipped) && x.shipped > 0 && `${figure(x.shipped)} of its daydreams shipped. none of mine have`,
            ],
            'it thinks so jk does not have to',
          ),
        );
      },
    },
    { mode: 'fidget', dur: 2, say: () => say(pick(['had a thought once. lost it', 'what was i saying'], random)) },
  ];
}

function health(f: () => ExhibitFacts, random: () => number): Beat[] {
  const h = () => f().health ?? {};
  return [
    {
      mode: 'flex',
      dur: 3.6,
      say: () => {
        const x = h();
        return say(
          oneOf(
            random,
            [
              has(x.kmYear) && x.kmYear > 0 && `${figure(x.kmYear)} km on foot this year. i get carried`,
              has(x.stepsYear) && x.stepsYear > 0 && `${figure(x.stepsYear)} steps this year. i'm on about nine`,
              has(x.daysOver10k) && x.daysOver10k > 0 && `${x.daysOver10k} days over ten thousand steps. show-off`,
            ],
            'all jk. i just do the posing',
          ),
        );
      },
    },
    {
      mode: 'idle',
      dur: 3,
      say: () => {
        const x = h();
        return say(
          oneOf(
            random,
            [
              x.sleep === 'low' && 'jk slept badly. i can tell from here',
              x.sleep === 'high' && 'jk slept like a log. smug about it',
              x.recovery === 'high' && "recovery's in the green. gym, then",
              x.recovery === 'low' && "recovery's in the red. sofa, then",
              x.recovery === 'mid' && 'recovery is middling. like me',
            ],
            'numbers going the right way. mostly',
          ),
        );
      },
    },
    { mode: 'pushup', dur: 3.5, say: () => say(pick(['solidarity', 'one for jk', 'right, my turn'], random)) },
    { mode: 'fan', dur: 2.2 },
  ];
}

function app(f: () => ExhibitFacts, random: () => number): Beat[] {
  const a = () => f().app ?? {};
  return [
    {
      mode: 'phone',
      dur: 4,
      say: () => {
        const x = a();
        const game = x.games?.length ? pick(x.games, random).toLowerCase() : null;
        return say(
          oneOf(
            random,
            [
              has(x.tabs) && x.tabs > 0 && `${x.tabs} tabs. i'm in none of them`,
              game && `they play ${game} on it. i lose`,
              has(x.widgets) && x.widgets > 0 && `${x.widgets} widgets. i'd make a good widget`,
              has(x.watchPages) && x.watchPages > 0 && `${x.watchPages} pages on the watch. tiny writing`,
            ],
            "there's an app for jk. none for me",
          ),
        );
      },
    },
    { mode: 'point', dur: 3, say: () => say(pick(["jk's whole day, in a pocket", 'it talks to this page, you know'], random)) },
    { mode: 'phone', dur: 2.6, say: () => say(pick(['no signal up here', 'one bar. typical'], random)) },
  ];
}

function build(f: () => ExhibitFacts, random: () => number): Beat[] {
  const b = () => f().build ?? {};
  return [
    {
      mode: 'point',
      dur: 3.6,
      say: () => {
        const x = b();
        const today = f().deploysToday;
        return say(
          oneOf(
            random,
            [
              has(x.releases) && x.releases > 0 && `${figure(x.releases)} releases. it ships itself`,
              has(x.linesWritten) && x.linesWritten > 0 && `${figure(x.linesWritten)} lines written. i read none of them`,
              has(today) && today === 0 && 'nothing shipped yet today. tea first',
              has(today) && today > 0 && `${today} out the door today. i shipped a brew`,
            ],
            'it rewrites itself. i can barely rewrite a list',
          ),
        );
      },
    },
    {
      mode: 'clap',
      dur: 2.6,
      say: () => {
        const x = b();
        return say(
          oneOf(
            random,
            [
              has(x.deploysPerDay) && x.deploysPerDay > 0 && `${x.deploysPerDay} a day. relentless`,
              has(x.fromDaydream) && x.fromDaydream > 0 && `${figure(x.fromDaydream)} were its own ideas. cheeky`,
            ],
            'ship it',
          ),
        );
      },
    },
    { mode: 'fidget', dur: 2, say: () => say(pick(["who's checking all this", 'does jk know about this'], random)) },
  ];
}

const DOING_QUIP: Record<string, string> = {
  asleep: 'lightweight',
  'at work': 'rather them than me',
  'thinking it over': 'relatable',
  talking: 'gossiping, probably',
  eating: 'now i am hungry',
  walking: 'off for a mooch. good lad',
  riding: 'giddy up',
  'standing about': 'my favourite hobby',
  busy: 'busy busy',
};

/** How the valley is going, from the outside. */
export function valleyMood(v: ValleyFacts | null | undefined): 'good' | 'bad' | 'quiet' {
  if (!v || v.state !== 'live') return 'quiet';
  if (v.people.some((p) => !p.alive)) return 'bad';
  return 'good';
}

/** The valley as the page holds it, cut down to what he talks about. */
export function valleyFrom(w: WildmindShowcase | null | undefined): ValleyFacts | null {
  if (!w) return null;
  return {
    state: w.state,
    day: w.day,
    season: w.season,
    weather: w.weather,
    people: w.people.map((p) => ({ name: p.name, doing: p.doing, alive: p.alive, thinking: p.thinking })),
    invented: w.invented,
    latest: w.latest,
    generation: w.generation,
    lastCause: w.earlierLives[0]?.cause ?? null,
    met: w.met ?? null,
  };
}

/** Something that happened in the valley between two looks, worth a reaction while he watches. */
export function valleyNews(prev: ValleyFacts | null, next: ValleyFacts | null, random: () => number = Math.random): Beat[] | null {
  if (!prev || !next || prev.state !== 'live' || next.state !== 'live') return null;
  const died = next.people.find((p) => !p.alive && prev.people.some((q) => q.name === p.name && q.alive));
  if (died) return [{ mode: 'surprised', dur: 1.4, say: () => say(`oh no. ${died.name.toLowerCase()}`) }, { mode: 'stressed', dur: 2.4 }];
  if (has(next.invented) && has(prev.invented) && next.invented > prev.invented) {
    const what = next.latest[0];
    return [{ mode: 'celebrate', dur: 2.4, say: () => say(what ? `a ${what.toLowerCase()}. get in` : pick(['they invented something. get in', 'new invention. clever lot'], random)) }];
  }
  if (prev.met === false && next.met === true) return [{ mode: 'clap', dur: 2.4, say: () => say("they've met. lovely") }];
  return null;
}

function wildmind(f: () => ExhibitFacts, random: () => number): Beat[] {
  const v = () => f().valley ?? null;
  const person = (x: ValleyFacts) => {
    const live = x.people.filter((p) => p.alive);
    return live.length ? pick(live, random) : null;
  };
  return [
    {
      mode: 'lookout',
      dur: 5.5,
      say: () => {
        const x = v();
        if (!x) return say('the valley. they have claude for brains');
        if (x.state === 'resting' || x.state === 'paused') return say("they're having a breather. fair");
        if (x.state === 'between-lives') return say('between lives. awkward');
        if (x.state === 'stale' || x.state === 'offline') return say("the valley's gone quiet. hello");
        return say(
          oneOf(
            random,
            [
              has(x.day) && x.season && `day ${x.day} in there. ${x.season.toLowerCase()}`,
              (x.weather === 'rain' || x.weather === 'storm') && 'raining in there as well',
              x.weather === 'snow' && 'snow in the valley. jealous',
              x.met === false && "they haven't met yet. go on",
            ],
            'two of them, claude for brains',
          ),
        );
      },
    },
    {
      mode: 'lookout',
      dur: 5.5,
      say: () => {
        const x = v();
        const p = x && x.state === 'live' ? person(x) : null;
        if (!p) {
          const gone = x?.people.find((q) => !q.alive);
          return say(gone ? `oh. ${gone.name.toLowerCase()}. not again` : 'nobody about');
        }
        if (p.thinking) return say(`${p.name.toLowerCase()} is having a think. that's claude in there`);
        return say(`${p.name.toLowerCase()} is ${p.doing}. ${DOING_QUIP[p.doing] ?? 'fair enough'}`);
      },
    },
    { mode: 'point', dur: 3, say: () => say(pick(['that one looks a lot like me', "he's got my walk", 'i taught them that'], random)) },
    {
      mode: 'lookout',
      dur: 5,
      say: () => {
        const x = v();
        if (!x) return null;
        const latest = x.latest[0];
        return say(
          oneOf(
            random,
            [
              latest && `they made a ${latest.toLowerCase()}. i'd have made tea`,
              has(x.invented) && x.invented > 0 && `${figure(x.invented)} inventions. i invented a sandwich`,
              has(x.generation) && x.generation > 1 && `life number ${x.generation}. they keep at it`,
              x.lastCause && `the last lot died of ${x.lastCause}. grim`,
            ],
            'doing better than me, to be fair',
          ),
        );
      },
    },
    {
      // How they are doing, as he sees it: applause, or his head in his hands.
      mode: valleyMood(v()) === 'bad' ? 'stressed' : 'clap',
      dur: 2.4,
      say: () => {
        const m = valleyMood(v());
        if (m === 'bad') return say('that is not going well');
        if (m === 'quiet') return null;
        return say(pick(['doing better than me, to be fair', 'go on, lads', 'proper little lives'], random));
      },
    },
  ];
}

function writing(f: () => ExhibitFacts, random: () => number): Beat[] {
  const title = () => {
    const posts = f().posts ?? [];
    return posts.length ? quoted(pick(posts.slice(0, 3), random)) : null;
  };
  return [
    {
      mode: 'study',
      dur: 6,
      say: () => {
        const t = title();
        return say(t ? oneOf(random, [`${t}. jk wrote that`, `i read ${t} twice. still lost`, `${t}. a page-turner`], '') : 'jk writes things down. i read them');
      },
    },
    { mode: 'point', dur: 2.6, say: () => say(pick(['more on the blog. ish', 'go on, have a read'], random)) },
  ];
}

function footer(_f: () => ExhibitFacts, random: () => number): Beat[] {
  return [
    { mode: 'idle', dur: 2.6, say: () => say(pick(["you've reached the bottom. well done", 'that is the lot', 'end of the line'], random)) },
    { mode: 'point', dur: 2.6, say: () => say(pick(["that's how i work, that link", 'the car is mine. do not tell jk'], random)) },
  ];
}

const VISITS: Record<Topic, (f: () => ExhibitFacts, random: () => number) => Beat[]> = { hero, daydream, health, app, build, wildmind, writing, footer };

/** What he does on a visit to `topic`. `facts` is read again as each beat starts. */
export function visitBeats(topic: Topic, facts: () => ExhibitFacts, random: () => number = Math.random): Beat[] {
  return VISITS[topic](facts, random);
}

/** His reaction to something the visitor did. */
export function cueBeats(cue: Cue, random: () => number = Math.random): Beat[] {
  const line = (xs: string[]) => () => say(pick(xs, random));
  switch (cue) {
    case 'view':
      return [
        { mode: 'surprised', dur: 1.3, say: line(['ooh. redecorating', 'who moved everything', 'new wallpaper', 'i liked the old one']) },
        { mode: 'idle', dur: 1.2 },
      ];
    case 'fair':
      return [{ mode: 'clap', dur: 2, say: line(["neater. jk's writing is worse", 'oh, that is legible']) }];
    case 'unfair':
      return [{ mode: 'idle', dur: 2, say: line(['back to the scribbles', 'proper doctor handwriting']) }];
    case 'hold':
      return [{ mode: 'idle', dur: 1.6, say: line(['holding still. not breathing either', 'statues, is it']) }];
    case 'unhold':
      return [{ mode: 'idle', dur: 1.2, say: line(['and breathe', 'phew']) }];
    case 'tuck':
      return [{ mode: 'surprised', dur: 1.6, say: line(['not the cupboard. i will be good', 'oi. i live here']) }];
    case 'explain':
      return [{ mode: 'point', dur: 2, say: line(["that's all about me, that", 'go on, read up on me']) }];
    case 'back':
      return [{ mode: 'wave', dur: 1.6, say: line(['missed me', 'right, where was i']) }];
  }
}

// ---------------------------------------------------------------- where he stands

export interface Box {
  x1: number;
  x2: number;
  top: number;
  bottom: number;
}

export interface Anchor {
  floor: Floor;
  x: number;
  /** Which way to face the interesting part, or 0 for straight on. */
  face: -1 | 0 | 1;
}

/**
 * Where to stand to look at a section: on the floor inside (or along the top
 * of) its box nearest its interesting part, preferring to stand above it and
 * look down. `extra` adds a cost per floor (Infinity rules one out: off
 * screen, say). Null when no floor runs through the box.
 */
export function anchorFor(w: World, box: Box, focus: { x: number; y: number }, extra: (f: Floor) => number = () => 0): Anchor | null {
  let best: Anchor | null = null;
  let bestCost = Infinity;
  for (const f of w.floors) {
    const more = extra(f);
    if (f.y < box.top - 12 || f.y > box.bottom + 12 || !Number.isFinite(more)) continue;
    const lo = Math.max(f.x1, box.x1) + w.margin;
    const hi = Math.min(f.x2, box.x2) - w.margin;
    if (hi < lo) continue;
    const x = Math.max(lo, Math.min(hi, focus.x));
    // Below the thing he is looking at costs more: he would be looking up at it.
    const cost = Math.abs(f.y - focus.y) * (f.y > focus.y ? 1.6 : 1) + Math.abs(x - focus.x) * 0.5 + more;
    if (cost < bestCost) {
      bestCost = cost;
      best = { floor: f, x, face: focus.x > x + 8 ? 1 : focus.x < x - 8 ? -1 : 0 };
    }
  }
  return best;
}
