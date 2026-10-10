// showcase-notes-wildmind.ts — the notes view's Wildmind page in words: the
// page's heading and lede, the readings under the map, the family tree, the
// map's label, caption and stamp, the lines that say how the valley stands
// when it is not simply live, and the page typed up (the fair copy).
//
// Built only from what wildmind.ts lets through (enums, counts and bounded
// names), never from anything the minds wrote. The copy rules are the
// notebook's (pinned in showcase-notes-wildmind.test.ts):
//   - no digit is written into the copy, every figure comes from data;
//   - no "!" and no colons in prose; marginalia start in lower case, and
//     only their first sentence does;
//   - null is a dash with words a screen reader says instead, never a zero;
//   - game time only: a day of the valley, never a clock time or "ago";
//   - one count of places everywhere (placesCount), so the reading under
//     the map and the caption never disagree;
//   - when the valley is not answering or is paused, everyone is in the
//     past tense (what it shows is how things were when it stopped).

import type { Weather, WildmindPerson, WildmindShowcase } from "./wildmind";
import type { FairRow } from "./showcase-notes";
import { formatFigure } from "./showcase-motion";
import { countWord } from "./sentence";
import { MET_NOTE } from "./notes-map-words";
import {
  andList,
  causeWord,
  daysWord,
  doingWord,
  lineOfLives,
  mainName,
  ordinalWord,
} from "./wildmind-words";

/** The night wash counts as night from here (the stamp, the caption and the moon agree). */
export const NIGHT_AT = 0.5;
/** Earlier lives listed before the rest are summed up in one line. */
export const TREE_CAP = 3;

const isNight = (w: Pick<WildmindShowcase, "night">) =>
  (w.night ?? 0) >= NIGHT_AT;
const companion = (w: Pick<WildmindShowcase, "people">) =>
  w.people.find((p) => p.id === "companion") ?? null;
const main = (w: Pick<WildmindShowcase, "people">) =>
  w.people.find((p) => p.id === "main") ?? null;

/* ------------------------------------------------------------------ page */

export const WM_KICKER = "wildmind";
export const WM_HEAD = "Meanwhile, in the valley";
export const WM_CLOSE =
  "I’ll write up how it works once it stops surprising me.";

/** The lede, with the two names when both are on the map. */
export function wmLede(w: Pick<WildmindShowcase, "people">): string {
  const a = main(w);
  const b = companion(w);
  const who = a && b ? `${a.name} and ${b.name}` : "two people";
  return (
    `Wildmind is a small world I’m building where ${who} have Claude for minds. ` +
    "They start in a valley with nothing and have to invent whatever they need, and a referee in the code throws out any idea the valley couldn’t actually supply."
  );
}

/** The shirt joke after the lede: it needs the orange disc, so it goes wherever the map goes (not in print or the fair copy). */
export function wmShirt(w: Pick<WildmindShowcase, "people">): string | null {
  const a = main(w);
  return a && companion(w)
    ? `The orange one’s ${a.name}, you might recognise the shirt.`
    : null;
}

/** What SnPage takes: kicker, heading, lede (and its aside, the shirt) and the closing line (no link out). */
export function wmPage(w: Pick<WildmindShowcase, "people">): {
  kicker: string;
  head: string;
  lede: string;
  aside?: string;
  close: string;
} {
  const aside = wmShirt(w);
  return {
    kicker: WM_KICKER,
    head: WM_HEAD,
    lede: wmLede(w),
    ...(aside ? { aside } : {}),
    close: WM_CLOSE,
  };
}

/* ------------------------------------------------------------- the sheet */

/** The map's label, over it. */
export function figLabel(
  w: Pick<WildmindShowcase, "state" | "people">,
): string {
  if (w.state === "offline") return "The valley";
  if (w.state === "between-lives")
    return `The valley as ${mainName(w)} left it`;
  return "The valley as they’ve seen it";
}

/** How the valley stands, under the label, in the margin's hand. Null when live. */
export function stateNote(
  w: Pick<
    WildmindShowcase,
    "state" | "day" | "people" | "earlierLives" | "generation"
  >,
): string | null {
  switch (w.state) {
    case "resting":
      return "their minds are resting till tomorrow, so they’re getting by on habit.";
    case "paused":
      return "the valley’s paused just now, so everyone’s stopped where they stood.";
    case "between-lives": {
      const cause = causeWord(lineOfLives(w).ended?.cause);
      const when = w.day != null ? ` on day ${countWord(w.day)}` : "";
      const died = cause
        ? `${mainName(w)} died of ${cause}${when}.`
        : `${mainName(w)} died${when}.`;
      return w.generation != null
        ? `${died} The ${ordinalWord(w.generation + 1)} of the line is next.`
        : `${died} The next of the line is on the way.`;
    }
    case "stale":
      return w.day != null
        ? `this is how the valley stood on day ${countWord(w.day)}. It isn’t answering just now.`
        : "the valley isn’t answering just now.";
    default:
      return null;
  }
}

/** The line in the middle of an empty frame. */
export function emptyNote(w: Pick<WildmindShowcase, "state">): string {
  return w.state === "offline"
    ? "the valley isn’t answering just now, so there’s no map of it."
    : "the map of the valley is still being drawn.";
}

/** The weather as it goes before "summer day": "a cloudy summer day", "a wet spring night". */
export const WEATHER_ADJ: Record<Weather, string> = {
  clear: "clear",
  cloudy: "cloudy",
  rain: "wet",
  storm: "stormy",
  snow: "snowy",
  fog: "foggy",
};

/** "Day 18 of this life, a cloudy summer day" ("The last day of that life" between lives). Null without a day. */
export function daySentence(
  w: Pick<WildmindShowcase, "day" | "season" | "weather" | "night"> &
    Partial<Pick<WildmindShowcase, "state">>,
): string | null {
  if (w.day == null) return null;
  const head =
    w.state === "between-lives"
      ? "The last day of that life"
      : `Day ${countWord(w.day)} of this life`;
  if (!w.season || !w.weather) return `${head}.`;
  return `${head}, a ${WEATHER_ADJ[w.weather]} ${w.season} ${isNight(w) ? "night" : "day"}.`;
}

/**
 * How many places they have found, one number for the whole page: the names
 * on the map when there is one (that is what the map can show), else the
 * count the valley keeps. The reading, the caption and the fair copy all
 * use it, so they never disagree.
 */
export function placesCount(
  w: Pick<WildmindShowcase, "map" | "placesFound">,
): number | null {
  return w.map ? w.map.labels.length : w.placesFound;
}

/** Whether the page speaks of the valley in the past tense: it stopped answering, or it is paused, so what it shows is how things were. */
export const isPast = (w: Pick<WildmindShowcase, "state">) =>
  w.state === "stale" || w.state === "paused";

/**
 * What someone is doing, in the page's tense: "JKai is walking near Tusker
 * Wood", "JKai was walking". The dead have one tense: "JKai died near Tusker
 * Wood" in the caption, "JKai died here" on the map (the tag points at him).
 */
export function doingNow(
  p: Pick<WildmindPerson, "name" | "doing" | "alive" | "near">,
  past: boolean,
  place = true,
): string {
  if (!p.alive)
    return place
      ? p.near
        ? `${p.name} died near ${p.near}`
        : `${p.name} died`
      : `${p.name} died here`;
  const now = doingWord(p, place);
  return past ? `${p.name} was${now.slice(p.name.length + " is".length)}` : now;
}

/**
 * The map in words, one or two sentences: "A map of the land JKai and Wren
 * have seen, with 19 places named so far. JKai is walking near Tusker Wood
 * and Wren is at work near Bittern Beds." (Only a few of the names are ever
 * written on the map, so it never says they are all "on it".) In the past
 * tense when stale, and from the moment it stopped when paused.
 */
export function mapLine(w: WildmindShowcase): string {
  if (!w.map) return emptyNote(w).replace(/^./, (c) => c.toUpperCase());
  const stale = w.state === "stale";
  const past = isPast(w);
  const names = w.people.map((p) => p.name);
  const n = placesCount(w) ?? 0;
  const seen = stale
    ? "had seen by then"
    : names.length === 1
      ? "has seen"
      : "have seen";
  const who = names.length
    ? `the land ${andList(names)} ${seen}`
    : `the land seen${stale ? " by then" : ""}`;
  const where = n
    ? `, with ${countWord(n)} ${n === 1 ? "place" : "places"} named${stale ? "" : " so far"}`
    : "";
  const doing = w.people.map((p) => doingNow(p, past));
  const when = w.state === "paused" && doing.length ? "When it paused, " : "";
  return `A map of ${who}${where}.${doing.length ? ` ${when}${andList(doing)}.` : ""}`;
}

/** The figure's caption: the day, the map in words, and that it is live (not while the reader is holding it still). */
export function captionLine(w: WildmindShowcase, held = false): string {
  const live = (w.state === "live" || w.state === "resting") && !held;
  return [
    daySentence(w),
    mapLine(w),
    live ? "It’s redrawn while you’re looking." : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The stamp across the frame's foot, in the cover's idiom: game time only. Null for none. */
export function stampWords(
  w: Pick<WildmindShowcase, "state" | "day" | "season" | "night">,
): { one: string; two: string; faded: boolean } | null {
  if (w.state === "offline") return null;
  if (w.state === "between-lives")
    return { one: "between", two: "lives", faded: false };
  if (w.day == null) return null;
  const one = `day ${formatFigure(w.day)}`;
  if (w.state === "paused") return { one, two: "paused", faded: false };
  if (w.state === "stale") return { one, two: "as it stood", faded: true };
  // "Day 17 / summer" by day ("day" twice says nothing), "summer · night" with the moon out.
  return {
    one,
    two: isNight(w)
      ? [w.season, "night"].filter(Boolean).join(" · ")
      : (w.season ?? ""),
    faded: false,
  };
}

/** A tag on the map: "JKai is walking" ("JKai was walking" when stale), split so the name can be inked in its own colour. */
export function tagWords(
  p: Pick<WildmindPerson, "name" | "doing" | "alive" | "near">,
  past = false,
): { name: string; rest: string; all: string } {
  const all = doingNow(p, past, false);
  return { name: p.name, rest: all.slice(p.name.length), all };
}

/** The key under the map: the classes drawn, in a reader's order (open ground is the seen paper's own colour, so it needs no line). */
const KEY: Array<[string, string]> = [
  ["wood", "woods"],
  ["wet", "marsh"],
  ["fresh", "water"],
  ["sea", "sea"],
  ["shore", "sand"],
  ["high", "high ground"],
];
/**
 * The key: the ground drawn, the paper they haven't seen, then the marks that
 * are on the map (a camp, a hut, an animal). Only what the map doesn't
 * explain itself: the people's tags name them in their colours, every cross
 * has its name beside it, and open ground is plain paper. Nothing absent has
 * a line.
 */
export function keyItems(
  map: { layers: Array<{ cls: string }> } | null,
  marks: {
    camps?: number;
    huts?: number;
    animals?: number;
  } = {},
): Array<{ cls: string; words: string }> {
  if (!map) return [];
  const has = new Set(map.layers.map((l) => l.cls));
  const out = [
    ...KEY.filter(([c]) => has.has(c)).map(([cls, words]) => ({ cls, words })),
    { cls: "unseen", words: "not explored yet" },
  ];
  if (marks.camps)
    out.push({ cls: "camp", words: marks.camps === 1 ? "a camp" : "camps" });
  if (marks.huts) out.push({ cls: "hut", words: "a hut" });
  if (marks.animals) out.push({ cls: "animal", words: "an animal" });
  return out;
}

/* ------------------------------------------------------------ readings */

/**
 * Under "things invented": the newest names, as runs of words and names, so
 * the page can set the names upright inside the italic aside (the usual way
 * to mark a title, so "Reed basket" reads as a name, not a typo). Null when
 * the count is not known.
 */
export function latestParts(
  w: Pick<WildmindShowcase, "invented" | "latest">,
): Array<{ t: string; name: boolean }> | null {
  const [a, b, c] = w.latest;
  const W = (t: string) => ({ t, name: false });
  const N = (t: string) => ({ t, name: true });
  if (a && b && c)
    return [
      W("the newest is "),
      N(a),
      W(", and before that "),
      N(b),
      W(" and "),
      N(c),
      W("."),
    ];
  if (a && b)
    return [W("the newest is "), N(a), W(", and before that "), N(b), W(".")];
  if (a) return [W("the newest is "), N(a), W(".")];
  if (w.invented === 0) return [W("nothing yet. It’s early days.")];
  if (w.invented == null) return [W(LATEST_ABSENT)];
  return null;
}
/** The same as one line of text. */
export function latestLine(
  w: Pick<WildmindShowcase, "invented" | "latest">,
): string | null {
  return (
    latestParts(w)
      ?.map((p) => p.t)
      .join("") ?? null
  );
}

/** Under the headline when its count isn't known (its figure is a dash), as the family tree says it. */
export const LATEST_ABSENT = "the count isn’t answering just now.";

const HABIT: Record<NonNullable<WildmindShowcase["habitShare"]>, string> = {
  most: "most",
  "about-half": "about half",
  some: "some",
};

/** How much is habit and which minds they use, in one aside. Null when neither is known. */
export function habitModels(
  w: Pick<WildmindShowcase, "habitShare" | "models">,
): string | null {
  const habit = w.habitShare
    ? `${HABIT[w.habitShare]} of what they do is habit, so they only stop to think when something’s new.`
    : null;
  const m = w.models;
  const models = m
    ? m.mind === m.designer
      ? `they think and invent with ${m.mind}.`
      : `they think with ${m.mind} and invent with ${m.designer}.`
    : null;
  // Only the aside's first sentence starts in lower case.
  return (
    [habit, habit && models ? models.replace(/^t/, "T") : models]
      .filter(Boolean)
      .join(" ") || null
  );
}

/** Under "ideas turned down". Null with no count (the figure is a dash). */
export function refusedLine(n: number | null): string | null {
  if (n == null) return null;
  return n > 0
    ? "by the referee, for want of the makings."
    : "none yet. The referee’s been quiet.";
}

/** Under "places found": `written` is whether any name is written on the map in every layout. */
export function placesLine(n: number | null, written: boolean): string | null {
  if (n == null) return null;
  if (n === 0) return "none yet. They’ve hardly left camp.";
  return written
    ? "each has a name, and some are written on the map."
    : "each has a name.";
}

export interface TreeItem {
  kind: "life" | "living" | "ended" | "ghost";
  text: string;
  /**
   * The item's number in the margin, when the lines don't simply count on
   * from `start` (a line with lives left out): the generation, or null for a
   * life whose generation isn't known (no number is written). Absent when
   * they do.
   */
  n?: number | null;
}

/** An earlier life in a line: "the first lasted 32 days and died of the cold", or "an earlier one lasted …" without its number. */
function lifeLine(
  n: number | null,
  life: {
    days: number;
    cause: WildmindShowcase["earlierLives"][number]["cause"];
  },
): string {
  const cause = causeWord(life.cause);
  const who = n != null ? `the ${ordinalWord(n)}` : "an earlier one";
  return `${who} lasted ${daysWord(life.days)}${cause ? ` and died of ${cause}` : ""}`;
}

/**
 * The family tree, oldest first, on the lines: at most three listed earlier
 * lives (a ghost line sums up the listed ones before them), then this one.
 * Between lives the one that just ended closes the list, and a ghost line
 * says the next is on its way. Each life is named by its own generation
 * (lineOfLives); one whose generation isn't known goes without. `start` is
 * the first counted item's number, and when the line has lives left out each
 * item carries its own `n` instead. Null when the generation is not known.
 */
export function familyLines(
  w: Pick<WildmindShowcase, "state" | "generation" | "earlierLives" | "day">,
): { start: number; items: TreeItem[]; note: string } | null {
  const g = w.generation;
  if (g == null || w.state === "offline") return null;
  const ended = w.state === "between-lives";
  const line = lineOfLives(w);
  const shown = line.lives.slice(0, TREE_CAP);
  const before = line.lives.length - shown.length;
  // An unbroken line counts on from `start`; any other numbers each item.
  const own = (n: number | null) => (line.unbroken ? {} : { n });
  const items: TreeItem[] = [];
  if (before > 0)
    items.push({
      kind: "ghost",
      text: line.numbered
        ? `and ${countWord(before)} before them`
        : "and others before them",
    });
  [...shown].reverse().forEach((life) => {
    items.push({
      kind: life === line.ended ? "ended" : "life",
      text: lifeLine(life.n, life),
      ...own(life.n),
    });
  });
  if (ended)
    items.push({
      kind: "ghost",
      text: `the ${ordinalWord(g + 1)}, next in line`,
    });
  else
    items.push({
      kind: "living",
      text:
        w.day == null
          ? "this one, still going"
          : w.day <= 1
            ? "this one, on their first day"
            : `this one, ${countWord(w.day)} days in so far`,
      ...own(g),
    });
  const note =
    g > 1 || ended
      ? "when one dies, Claude reads back over the life and leaves the next a few lessons, which is roughly how families work too."
      : "they’re the first of the line, so nobody’s had to pass anything on yet.";
  const top = ended ? g : g - 1;
  return {
    start: line.unbroken ? top - shown.length + 1 : (shown.at(-1)?.n ?? g),
    items,
    note,
  };
}

export const TREE_ABSENT = "the family tree isn’t answering just now.";

/* ------------------------------------------------------------ fair copy */

const dash = (n: number | null | undefined, dec = 0) =>
  n == null ? "—" : formatFigure(n, dec);

/** The page typed up: what shows in place of the drawings when the hero's fair copy is on, and what prints. */
export function wildmindFair(w: WildmindShowcase): FairRow[] {
  const dayParts = [
    w.season,
    w.weather
      ? `a ${WEATHER_ADJ[w.weather]} ${isNight(w) ? "night" : "day"}`
      : null,
  ].filter(Boolean);
  const lives = [...lineOfLives(w).lives]
    .reverse()
    .map((l) => {
      const cause = causeWord(l.cause);
      return [
        l.n != null ? `the ${ordinalWord(l.n)}` : null,
        daysWord(l.days),
        cause,
      ]
        .filter(Boolean)
        .join(", ");
    })
    .join("; ");
  const m = w.models;
  const rows: FairRow[] = [
    {
      k: "Day of this life",
      v: w.day == null ? "—" : [formatFigure(w.day), ...dayParts].join(", "),
    },
    { k: "Things invented in this valley", v: dash(w.invented) },
    {
      k: "The newest inventions",
      v: w.latest.length ? andList(w.latest) : "—",
    },
    { k: "Ideas the referee turned down", v: dash(w.refused) },
    { k: "Places found", v: dash(placesCount(w)) },
    {
      k: "Generation",
      v:
        w.generation == null
          ? "—"
          : `the ${ordinalWord(w.generation)} of the line`,
    },
    { k: "Earlier lives", v: w.generation == null ? "—" : lives || "none" },
    // The name is the row's label, so the value starts with what they're doing.
    ...w.people.map((p) => ({
      k: p.name,
      v: p.alive
        ? [p.doing, p.near ? `near ${p.near}` : null].filter(Boolean).join(" ")
        : "dead",
    })),
    { k: "Choices made by habit", v: w.habitShare ? HABIT[w.habitShare] : "—" },
    {
      k: "Minds",
      v: m
        ? m.mind === m.designer
          ? `think and invent with ${m.mind}`
          : `think with ${m.mind}, invent with ${m.designer}`
        : "—",
    },
  ];
  const now = stateNote(w);
  if (now)
    rows.push({ k: "Just now", v: now.replace(/^./, (c) => c.toUpperCase()) });
  return rows;
}

/** Every fixed phrase the page prints, for the copy rules. */
export function allWildmindCopy(): string[] {
  return [
    WM_KICKER,
    WM_HEAD,
    WM_CLOSE,
    TREE_ABSENT,
    LATEST_ABSENT,
    MET_NOTE,
    "The valley",
    "The valley as they’ve seen it",
    "It’s redrawn while you’re looking.",
    ...Object.values(WEATHER_ADJ),
    ...KEY.map(([, w]) => w),
    "not explored yet",
    "a camp",
    "camps",
    "a hut",
    "an animal",
    "next in line",
    "The last day of that life",
    "When it paused, ",
  ];
}
