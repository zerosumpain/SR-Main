import { describe, expect, it } from "vitest";
import recorded from "./fixtures/wildmind-day16.json";
import {
  offlineShowcase,
  parseSnapshot,
  project,
  type WildmindShowcase,
} from "./wildmind";
import { traceGrid } from "./wildmind-trace.server";
import {
  WM_HEAD,
  allWildmindCopy,
  captionLine,
  daySentence,
  emptyNote,
  familyLines,
  figLabel,
  habitModels,
  isPast,
  keyItems,
  latestLine,
  latestParts,
  placesCount,
  placesLine,
  refusedLine,
  stampWords,
  stateNote,
  tagWords,
  wildmindFair,
  wmLede,
  wmPage,
  wmShirt,
} from "./showcase-notes-wildmind";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const snap = parseSnapshot(recorded)!;
const traced = traceGrid(snap.terrain!, snap.terrainVersion);
const live = project(snap, NOW, NOW, traced);
const at = (patch: Partial<WildmindShowcase>): WildmindShowcase => ({
  ...live,
  ...patch,
});
const STATES = [
  "live",
  "resting",
  "paused",
  "between-lives",
  "stale",
  "offline",
] as const;

/** Every line the page can print for a reading, in one list. */
function everything(w: WildmindShowcase): string[] {
  const tree = familyLines(w);
  return [
    wmLede(w),
    wmShirt(w),
    figLabel(w),
    stateNote(w),
    emptyNote(w),
    daySentence(w),
    captionLine(w),
    latestLine(w),
    habitModels(w),
    refusedLine(w.refused),
    placesLine(w.placesFound, true),
    placesLine(w.placesFound, false),
    ...(tree ? [...tree.items.map((i) => i.text), tree.note] : []),
    ...w.people.map((p) => tagWords(p).all),
    ...keyItems(w.map).map((k) => k.words),
  ].filter((s): s is string => !!s);
}

/** The variants worth checking: every state, nulls, zeros, one life and many. */
const CASES: WildmindShowcase[] = [
  ...STATES.map((state) =>
    state === "offline" ? offlineShowcase() : at({ state }),
  ),
  at({ invented: 0, latest: [], refused: 0, placesFound: 0 }),
  at({
    invented: null,
    latest: [],
    refused: null,
    placesFound: null,
    habitShare: null,
    models: null,
  }),
  at({ generation: 1, earlierLives: [], day: 1 }),
  at({
    generation: 9,
    earlierLives: [5, 4, 3, 2, 1].map((d) => ({
      days: d * 7,
      cause: "cold" as const,
    })),
  }),
  at({
    state: "between-lives",
    earlierLives: [{ days: 16, cause: null }, ...live.earlierLives],
  }),
  at({ day: null, season: null, weather: null }),
  at({ night: 0.9, weather: "rain" }),
  at({ people: [] }),
];

/** Strip every figure the data put in; any digit left is a literal in the copy. */
const literalDigits = (s: string, w: WildmindShowcase) => {
  let t = s;
  const figs = [
    w.day,
    w.invented,
    w.refused,
    w.placesFound,
    w.generation,
    ...w.earlierLives.map((l) => Math.round(l.days)),
    w.map?.labels.length,
  ]
    .filter((n): n is number => typeof n === "number")
    .map((n) => n.toLocaleString("en-GB"))
    .sort((a, b) => b.length - a.length);
  for (const f of figs) t = t.split(f).join("");
  return t.match(/\d/g) ?? [];
};

describe("the copy rules", () => {
  it('writes no digits, no "!" and no colons, in any fixed phrase or any case', () => {
    for (const s of allWildmindCopy()) {
      expect(s).not.toMatch(/\d/);
      expect(s).not.toMatch(/[!:]/);
    }
    for (const w of CASES)
      for (const s of everything(w)) {
        expect(literalDigits(s, w), s).toEqual([]);
        expect(s, s).not.toMatch(/[!:]/);
      }
  });

  it("starts only the first sentence of an aside in lower case", () => {
    for (const w of CASES) {
      const lines = [
        stateNote(w),
        emptyNote(w),
        latestLine(w),
        habitModels(w),
        refusedLine(w.refused),
        placesLine(w.placesFound, true),
        familyLines(w)?.note,
      ];
      for (const s of lines.filter((x): x is string => !!x))
        for (const later of s.split(/\. (?=\S)/).slice(1))
          expect(later[0], s).toBe(later[0].toUpperCase());
    }
  });

  it("starts the marginalia in lower case (or with a name)", () => {
    const names = live.people.map((p) => p.name);
    for (const w of CASES) {
      const lines = [
        stateNote(w),
        emptyNote(w),
        latestLine(w),
        habitModels(w),
        refusedLine(w.refused),
        placesLine(w.placesFound, true),
        familyLines(w)?.note,
      ];
      for (const s of lines.filter((x): x is string => !!x)) {
        const first = s.split(" ")[0];
        expect(
          s[0] === s[0].toLowerCase() ||
            names.includes(first) ||
            first === "JKai",
          s,
        ).toBe(true);
      }
    }
  });

  it('keeps to game time: no clock, no "ago", no "last seen"', () => {
    for (const w of CASES)
      for (const s of [
        stateNote(w),
        captionLine(w),
        ...wildmindFair(w).map((r) => r.v),
      ].filter(Boolean) as string[]) {
        expect(s).not.toMatch(
          /\bago\b|last seen|\d{1,2}:\d{2}|\b(am|pm)\b|o’clock|hour/i,
        );
      }
  });

  it("keeps the heading word for word, and not in the shape of the builder’s just above it", () => {
    expect(WM_HEAD).toBe("Meanwhile, in the valley");
    expect(WM_HEAD).not.toMatch(/^It .*, then /);
    expect(wmPage(live)).toMatchObject({
      kicker: "wildmind",
      close: expect.stringMatching(/^I’ll write up/),
    });
  });
});

describe("the lede", () => {
  it("names them both, and ties the shirt to the orange disc as an aside that goes with the map", () => {
    expect(wmLede(live)).toContain("where JKai and Wren have Claude for minds");
    expect(wmLede(live)).not.toMatch(/shirt|watching/);
    expect(wmShirt(live)).toBe(
      "The orange one’s JKai, you might recognise the shirt.",
    );
    expect(wmPage(live).aside).toBe(wmShirt(live));
    expect(wmPage(at({ people: [] }))).not.toHaveProperty("aside");
  });
  it("says two people, and leaves the shirt out, when the names are not known", () => {
    const s = wmLede(at({ people: [] }));
    expect(s).toContain("where two people have Claude for minds");
    expect(s).not.toMatch(/shirt/);
    expect(wmShirt(at({ people: [] }))).toBeNull();
  });
});

describe("readings", () => {
  it("lists the newest inventions, or says it is early days at a true zero", () => {
    expect(latestLine(live)).toBe(
      "the newest is Reed basket, and before that Woven fibre basket and Woven fibre storage cache.",
    );
    expect(latestLine(at({ latest: ["Reed basket"] }))).toBe(
      "the newest is Reed basket.",
    );
    expect(latestLine(at({ latest: [], invented: 0 }))).toBe(
      "nothing yet. It’s early days.",
    );
    // The names come apart from the words, so the page can set them upright.
    expect(
      latestParts(live)!
        .filter((p) => p.name)
        .map((p) => p.t),
    ).toEqual(live.latest);
    expect(latestLine(at({ latest: [], invented: null }))).toBe(
      "the count isn’t answering just now.",
    );
  });

  it("says how much is habit and names the models", () => {
    expect(habitModels(live)).toBe(
      "about half of what they do is habit, so they only stop to think when something’s new. They think with Haiku and invent with Sonnet.",
    );
    expect(
      habitModels(
        at({ models: { mind: "Opus", designer: "Opus" }, habitShare: null }),
      ),
    ).toBe("they think and invent with Opus.");
    expect(habitModels(at({ models: null, habitShare: null }))).toBeNull();
  });

  it("has a line for a true zero and none for a missing figure", () => {
    expect(refusedLine(1)).toBe("by the referee, for want of the makings.");
    expect(refusedLine(0)).toBe("none yet. The referee’s been quiet.");
    expect(refusedLine(null)).toBeNull();
    expect(placesLine(15, true)).toBe(
      "each has a name, and some are written on the map.",
    );
    expect(placesLine(15, false)).toBe("each has a name.");
    expect(placesLine(0, true)).toBe("none yet. They’ve hardly left camp.");
    expect(placesLine(null, true)).toBeNull();
  });

  it("never turns a missing figure into a zero in the fair copy", () => {
    const rows = wildmindFair(offlineShowcase());
    for (const k of [
      "Things invented in this valley",
      "Ideas the referee turned down",
      "Places found",
      "Generation",
      "Day of this life",
    ])
      expect(rows.find((r) => r.k === k)?.v).toBe("—");
    expect(JSON.stringify(rows)).not.toMatch(/"0"/);
  });
});

describe("the family tree", () => {
  it("runs oldest first and ends with this one", () => {
    const t = familyLines(live)!;
    expect(t.items.map((i) => i.text)).toEqual([
      "the first lasted 32 days and died of the cold",
      "the second lasted three days and died of hunger",
      "this one, 16 days in so far",
    ]);
    expect(t.start).toBe(1);
    expect(t.items.map((i) => i.kind)).toEqual(["life", "life", "living"]);
    expect(t.note).toMatch(/^when one dies/);
  });

  it("sums up the lives past three in a ghost line and numbers on from them", () => {
    const t = familyLines(
      at({
        generation: 9,
        earlierLives: [5, 4, 3, 2, 1].map((d) => ({
          days: d * 7,
          cause: "cold" as const,
        })),
      }),
    )!;
    expect(t.items[0]).toEqual({ kind: "ghost", text: "and five before them" });
    expect(t.items.filter((i) => i.kind === "life")).toHaveLength(3);
    expect(t.start).toBe(6);
    expect(t.items[1].text).toMatch(/^the sixth lasted/);
    expect(t.items[3].text).toMatch(/^the eighth lasted 35 days/);
  });

  it("says the first of the line has nobody to learn from", () => {
    const t = familyLines(at({ generation: 1, earlierLives: [], day: 1 }))!;
    expect(t.items).toEqual([
      { kind: "living", text: "this one, on their first day" },
    ]);
    expect(t.note).toMatch(/first of the line/);
  });

  it("between lives, closes on the life that just ended and the next one coming", () => {
    const t = familyLines(
      at({
        state: "between-lives",
        earlierLives: [{ days: 16, cause: "cold" }, ...live.earlierLives],
      }),
    )!;
    expect(t.items.map((i) => i.kind)).toEqual([
      "life",
      "life",
      "ended",
      "ghost",
    ]);
    expect(t.items[2].text).toBe(
      "the third lasted 16 days and died of the cold",
    );
    expect(t.items[3].text).toBe("the fourth, next in line");
  });

  it("is not drawn without a generation", () => {
    expect(familyLines(offlineShowcase())).toBeNull();
    expect(familyLines(at({ generation: null }))).toBeNull();
  });
});

describe("the sheet", () => {
  it("labels the map for each state", () => {
    expect(figLabel(live)).toBe("The valley as they’ve seen it");
    expect(figLabel(at({ state: "between-lives" }))).toBe(
      "The valley as JKai left it",
    );
    expect(figLabel(offlineShowcase())).toBe("The valley");
  });

  it("says how the valley stands only when it is not live", () => {
    expect(stateNote(live)).toBeNull();
    expect(stateNote(at({ state: "paused" }))).toBe(
      "the valley’s paused just now, so everyone’s stopped where they stood.",
    );
    expect(stateNote(at({ state: "stale" }))).toBe(
      "this is how the valley stood on day 16. It isn’t answering just now.",
    );
    expect(stateNote(at({ state: "stale", day: null }))).toBe(
      "the valley isn’t answering just now.",
    );
    expect(
      stateNote(
        at({
          state: "between-lives",
          earlierLives: [{ days: 16, cause: "cold" }],
        }),
      ),
    ).toBe("JKai died of the cold on day 16. The fourth of the line is next.");
    expect(
      stateNote(
        at({
          state: "between-lives",
          earlierLives: [{ days: 16, cause: null }],
          day: null,
        }),
      ),
    ).toMatch(/^JKai died\. /);
  });

  it("stamps the valley’s day, and nothing offline", () => {
    expect(stampWords(at({ night: 0 }))).toEqual({
      one: "day 16",
      two: "summer",
      faded: false,
    });
    expect(stampWords(at({ night: 0.8 }))!.two).toBe("summer · night");
    expect(stampWords(at({ state: "paused" }))!.two).toBe("paused");
    expect(stampWords(at({ state: "stale" }))).toMatchObject({
      two: "as it stood",
      faded: true,
    });
    expect(stampWords(at({ state: "between-lives" }))).toMatchObject({
      one: "between",
      two: "lives",
    });
    expect(stampWords(offlineShowcase())).toBeNull();
    expect(stampWords(at({ day: null }))).toBeNull();
  });

  it("captions the map in words, and says it is live only when it is", () => {
    const c = captionLine(at({ night: 0 }));
    expect(
      c.startsWith(
        "Day 16 of this life, a cloudy summer day. A map of the land JKai and Wren have seen, with 19 places named so far. JKai is ",
      ),
    ).toBe(true);
    expect(c.endsWith(" It’s redrawn while you’re looking.")).toBe(true);
    expect(captionLine(at({ state: "paused" }))).not.toMatch(/redrawn/);
    // Held still, nothing is being redrawn.
    expect(captionLine(at({ night: 0 }), true)).not.toMatch(/redrawn/);
    expect(
      daySentence(at({ state: "between-lives", night: 0 })),
    ).toBe("The last day of that life, a cloudy summer day.");
    expect(daySentence(at({ night: 0.9, weather: "rain" }))).toBe(
      "Day 16 of this life, a wet summer night.",
    );
    expect(daySentence(at({ season: null }))).toBe("Day 16 of this life.");
    expect(daySentence(at({ day: null }))).toBeNull();
  });

  it("tags people by name first, in the past tense when the valley isn’t answering", () => {
    for (const p of live.people)
      expect(tagWords(p).all.startsWith(p.name)).toBe(true);
    expect(
      tagWords({ name: "JKai", doing: "walking", alive: false, near: null })
        .all,
    ).toBe("JKai died here");
    expect(
      tagWords(
        { name: "JKai", doing: "walking", alive: true, near: null },
        true,
      ).all,
    ).toBe("JKai was walking");
    expect(
      tagWords(
        { name: "Wren", doing: "at work", alive: true, near: null },
        true,
      ),
    ).toEqual({ name: "Wren", rest: " was at work", all: "Wren was at work" });
  });

  it("keys only what is drawn and doesn't explain itself: the classes, the unexplored paper, then the marks", () => {
    const k = keyItems(live.map, {
      camps: 2,
      huts: 1,
      animals: 4,
    }).map((x) => x.words);
    expect(k[0]).toBe("woods");
    expect(k).toContain("not explored yet");
    expect(k.slice(-3)).toEqual(["camps", "a hut", "an animal"]);
    // The people are named by their tags, the crosses by their names, open ground is plain paper.
    for (const gone of ["open ground", "a named place", "JKai", "Wren", "sea"])
      expect(k).not.toContain(gone);
    expect(k.length).toBeLessThanOrEqual(9);
    const bare = keyItems(live.map).map((x) => x.words);
    expect(bare).not.toContain("a hut");
    expect(keyItems(null)).toEqual([]);
  });

  it("gives one count of places everywhere: the reading, the caption and the fair copy agree", () => {
    for (const w of CASES) {
      const n = placesCount(w);
      const cap = captionLine(w);
      const fair = wildmindFair(w).find((r) => r.k === "Places found")!.v;
      if (w.map && n)
        expect(cap).toMatch(
          new RegExp(`with ${n.toLocaleString("en-GB")} places? named`),
        );
      expect(fair).toBe(n == null ? "—" : n.toLocaleString("en-GB"));
    }
    expect(placesCount(live)).toBe(live.map!.labels.length);
    expect(placesCount(offlineShowcase())).toBe(offlineShowcase().placesFound);
  });

  it("speaks in the past tense when the valley isn’t answering", () => {
    const c = captionLine(at({ state: "stale" }));
    expect(c).toMatch(/had seen by then/);
    expect(c).toMatch(/JKai was /);
    expect(c).not.toMatch(/ is |redrawn/);
  });

  it("speaks of a paused valley as it was when it stopped, so the tags and the note agree", () => {
    const w = at({ state: "paused" });
    expect(isPast(w)).toBe(true);
    const c = captionLine(w);
    expect(c).toMatch(/When it paused, JKai was /);
    expect(c).not.toMatch(/ is |redrawn/);
    expect(tagWords(w.people[0], isPast(w)).all).toMatch(/ was /);
    expect(stateNote(w)).not.toMatch(/nobody’s going anywhere/);
  });

  it("says where the dead died, in the caption and on the map", () => {
    const w = at({
      state: "between-lives",
      people: live.people.map((p) =>
        p.id === "main" ? { ...p, alive: false } : p,
      ),
    });
    const dead = w.people.find((p) => p.id === "main")!;
    expect(tagWords(dead, isPast(w)).all).toBe("JKai died here");
    expect(captionLine(w)).toMatch(
      dead.near ? `JKai died near ${dead.near}` : /JKai died/,
    );
    expect(captionLine(w)).not.toMatch(/is dead|was dead/);
  });

  it("types up the minds in the plural, and leaves out what isn't drawn", () => {
    const rows = wildmindFair(live);
    expect(rows.find((r) => r.k === "Minds")!.v).toBe(
      "think with Haiku, invent with Sonnet",
    );
    expect(rows.find((r) => r.k === "Land seen")).toBeUndefined();
  });

  it("doesn’t repeat the name in the fair copy’s rows about people, nor the caption", () => {
    const rows = wildmindFair(live);
    for (const p of live.people)
      expect(rows.find((r) => r.k === p.name)!.v.startsWith(p.name)).toBe(
        false,
      );
    expect(rows.find((r) => r.k === "The map")).toBeUndefined();
  });
});

describe("free text", () => {
  it("never reaches anything the page prints, even when the snapshot sends it", () => {
    const o = structuredClone(recorded) as Record<string, any>;
    const SECRET = [
      "lastThought",
      "activityLabel",
      "speech",
      "mood",
      "plan",
      "description",
    ];
    for (const p of o.people)
      for (const k of SECRET) p[k] = `SECRET ${k} words`;
    o.stats.latest[0].description = "SECRET description";
    o.thoughts = ["SECRET thought"];
    const w = project(parseSnapshot(o)!, NOW, NOW, traced);
    const all = [
      ...everything(w),
      ...wildmindFair(w).flatMap((r) => [r.k, r.v]),
    ].join("\n");
    expect(all).not.toMatch(/SECRET/);
  });
});
