import { describe, expect, it } from "vitest";
import {
  advance,
  again,
  createRoom,
  deal,
  deadline,
  decline,
  fits,
  isWord,
  join,
  leave,
  missedWords,
  start,
  toWire,
  word,
  COUNTDOWN_MS,
  GRACE_MS,
  LOBBY_MS,
  POINTS,
  TUNING,
  type Difficulty,
  type Room,
} from "./anagram-blitz";
import { COMMON_WORDS, RARE_WORDS, SEEDS } from "./words/anagram";

const T0 = 1_790_000_000_000;
const half = () => 0.5;

function room(
  invite = [{ id: "p_sam", name: "Sam" }],
  difficulty: Difficulty = "easy",
): Room {
  return createRoom({
    id: "g_1",
    host: { id: "p_john", name: "John" },
    invite,
    difficulty,
    now: T0,
  });
}

/** Start, run the countdown down, and fix the letters so the test knows them. */
function playing(r: Room, seed = "painter"): number {
  start(r, "p_john", T0);
  advance(r, T0 + COUNTDOWN_MS, half);
  r.seed = seed;
  r.letters = [...seed].reverse();
  return T0 + COUNTDOWN_MS;
}

function status(fn: () => void): [number, string] {
  try {
    fn();
  } catch (e) {
    return [(e as { status: number }).status, (e as Error).message];
  }
  return [0, ""];
}

describe("word lists", () => {
  it("are 3–7 lowercase letters, without repeats, common and rare apart", () => {
    for (const list of [COMMON_WORDS, RARE_WORDS]) {
      expect(list.every((w) => /^[a-z]{3,7}$/.test(w))).toBe(true);
      expect(new Set(list).size).toBe(list.length);
    }
    const common = new Set(COMMON_WORDS);
    expect(RARE_WORDS.some((w) => common.has(w))).toBe(false);
    expect(COMMON_WORDS.length).toBeGreaterThan(10_000);
  });

  it("keeps British spellings and drops the crude words", () => {
    for (const w of [
      "colour",
      "centre",
      "grey",
      "tyre",
      "mould",
      "pain",
      "train",
    ])
      expect(isWord(w)).toBe(true);
    for (const w of ["shit", "fuck", "cunt", "rape", "slut"])
      expect(isWord(w)).toBe(false);
  });

  it("every seed is a seven-letter word with plenty to find in it", () => {
    expect(SEEDS.length).toBeGreaterThanOrEqual(TUNING.medium.pool);
    expect(new Set(SEEDS).size).toBe(SEEDS.length);
    for (const seed of SEEDS) {
      expect(seed).toMatch(/^[a-z]{7}$/);
      expect(isWord(seed)).toBe(true);
    }
    // Spot-check the ≥15 rule on a sample (every seed was checked when the list was built).
    for (const seed of SEEDS.filter((_, i) => i % 50 === 0)) {
      const subs = COMMON_WORDS.filter((w) => w !== seed && fits(w, [...seed]));
      expect(subs.length).toBeGreaterThanOrEqual(15);
      expect(subs.filter((w) => w.length >= 4).length).toBeGreaterThanOrEqual(
        10,
      );
    }
  });

  it("deals easy from the commonest seeds and hard from them all, shuffled", () => {
    const easy = deal("easy", () => 0.999_999);
    expect(easy.seed).toBe(SEEDS[TUNING.easy.pool - 1]);
    expect(deal("hard", () => 0.999_999).seed).toBe(SEEDS[SEEDS.length - 1]);
    const d = deal("medium", () => 0);
    expect(d.seed).toBe(SEEDS[0]);
    expect([...d.letters].sort()).toEqual([...d.seed].sort());
    expect(d.letters.join("")).not.toBe(d.seed);
  });
});

describe("letters", () => {
  it("counts each letter: a word may use it only as often as it is dealt", () => {
    const letters = [..."balloon"];
    expect(fits("ball", letters)).toBe(true);
    expect(fits("loon", letters)).toBe(true);
    expect(fits("balloon", letters)).toBe(true);
    expect(fits("lolly", letters)).toBe(false);
    expect(fits("bob", letters)).toBe(false);
    expect(fits("noon", letters)).toBe(false);
  });
});

describe("lobby", () => {
  it("seats the host and invites the rest, once each", () => {
    const r = room([
      { id: "p_sam", name: "Sam" },
      { id: "p_sam", name: "Sam" },
      { id: "p_john", name: "John" },
    ]);
    expect(r.players.map((p) => [p.id, p.status])).toEqual([
      ["p_john", "joined"],
      ["p_sam", "invited"],
    ]);
    expect(r.phaseEndsAt).toBe(T0 + LOBBY_MS);
    expect(r.game).toBe("anagram-blitz");
  });

  it("refuses a sixth player", () => {
    const five = ["a", "b", "c", "d", "e"].map((x) => ({ id: x, name: x }));
    expect(() => room(five)).toThrow(/Up to 5/);
  });

  it("only the host starts, unanswered invites lapse, and the letters are dealt at the go", () => {
    const r = room();
    expect(() => start(r, "p_sam", T0)).toThrow(/Only the host/);
    start(r, "p_john", T0);
    expect(r.phase).toBe("countdown");
    expect(r.letters).toBeNull();
    expect(r.players[1].status).toBe("declined");
    expect(() => join(r, "p_sam", T0)).toThrow(/already started/);
    advance(r, T0 + COUNTDOWN_MS, half);
    expect(r.phase).toBe("playing");
    expect(r.seed).toBe(SEEDS[Math.floor(0.5 * TUNING.easy.pool)]);
    expect([...r.letters!].sort()).toEqual([...r.seed!].sort());
    expect(r.startedAt).toBe(T0 + COUNTDOWN_MS);
    expect(r.phaseEndsAt).toBe(T0 + COUNTDOWN_MS + TUNING.easy.timeLimitMs);
  });

  it("times: easy 150 s, medium 120 s, hard 90 s", () => {
    expect([
      TUNING.easy.timeLimitMs,
      TUNING.medium.timeLimitMs,
      TUNING.hard.timeLimitMs,
    ]).toEqual([150_000, 120_000, 90_000]);
  });

  it("closes when nobody starts it, and when the host leaves the lobby", () => {
    const r = room();
    expect(advance(r, T0 + LOBBY_MS, half)).toBe(true);
    expect(r.phase).toBe("closed");
    const r2 = room();
    join(r2, "p_sam", T0);
    leave(r2, "p_john", T0);
    expect(r2.phase).toBe("closed");
  });

  it("decline only touches an open invite", () => {
    const r = room();
    decline(r, "p_sam", T0);
    expect(r.players[1].status).toBe("declined");
    expect(() => decline(r, "p_stranger", T0)).toThrow(/not in this game/);
  });

  it("ignores a clock that is not a number", () => {
    const r = room();
    expect(advance(r, Number.NaN, half)).toBe(false);
    expect(r.phase).toBe("lobby");
  });
});

describe("finding words", () => {
  it("takes any case and spacing", () => {
    const r = room([]);
    const t = playing(r);
    word(r, "p_john", { word: " PAINT " }, t + 1_000);
    expect(r.players[0].words).toEqual([{ word: "paint", at: t + 1_000 }]);
  });

  it("refuses wrong letters, too short, and non-words with 400 and a sentence", () => {
    const r = room([]);
    const t = playing(r);
    expect(status(() => word(r, "p_john", { word: "plant" }, t))).toEqual([
      400,
      "Use only the letters you have.",
    ]);
    expect(status(() => word(r, "p_john", { word: "pepper" }, t))).toEqual([
      400,
      "Use only the letters you have.",
    ]);
    expect(status(() => word(r, "p_john", { word: "pa1n" }, t))).toEqual([
      400,
      "Use only the letters you have.",
    ]);
    expect(status(() => word(r, "p_john", { word: "pa" }, t))).toEqual([
      400,
      "Words need at least 3 letters.",
    ]);
    expect(status(() => word(r, "p_john", { word: 42 }, t))).toEqual([
      400,
      "Words need at least 3 letters.",
    ]);
    expect(status(() => word(r, "p_john", { word: "tnirp" }, t))).toEqual([
      400,
      "Not in the word list.",
    ]);
    expect(r.players[0].words).toEqual([]);
  });

  it("a repeat is 409 and scores nothing more", () => {
    const r = room([]);
    const t = playing(r);
    word(r, "p_john", { word: "paint" }, t);
    expect(status(() => word(r, "p_john", { word: "Paint" }, t))).toEqual([
      409,
      "You already have that one.",
    ]);
    expect(r.players[0].words).toHaveLength(1);
  });

  it("hard needs four letters", () => {
    const r = room([], "hard");
    const t = playing(r);
    expect(r.phaseEndsAt! - t).toBe(90_000);
    expect(status(() => word(r, "p_john", { word: "pit" }, t))).toEqual([
      400,
      "Words need at least 4 letters on hard.",
    ]);
    word(r, "p_john", { word: "pint" }, t);
    const easy = room([]);
    const t2 = playing(easy);
    word(easy, "p_john", { word: "pit" }, t2);
    expect(easy.players[0].words).toHaveLength(1);
  });

  it("refuses a stranger, someone who left, and a word before play", () => {
    const r = room();
    join(r, "p_sam", T0);
    expect(status(() => word(r, "p_john", { word: "pain" }, T0))).toEqual([
      409,
      "The game has not started.",
    ]);
    const t = playing(r);
    expect(() => word(r, "p_kit", { word: "pain" }, t)).toThrow(
      /not in this game/,
    );
    leave(r, "p_sam", t);
    expect(() => word(r, "p_sam", { word: "pain" }, t)).toThrow(/not playing/);
  });

  it("runs to the clock, with a moment of grace for a word in flight", () => {
    const r = room();
    join(r, "p_sam", T0);
    const t = playing(r);
    const limit = r.phaseEndsAt!;
    expect(limit - t).toBe(TUNING.easy.timeLimitMs);
    expect(deadline(r)).toBe(limit + GRACE_MS);
    word(r, "p_john", { word: "pain" }, limit + 500);
    expect(
      status(() => word(r, "p_john", { word: "paint" }, limit + GRACE_MS + 1)),
    ).toEqual([409, "Time's up."]);
    expect(advance(r, limit + GRACE_MS - 1, half)).toBe(false);
    advance(r, limit + GRACE_MS, half);
    expect(r.phase).toBe("finished");
    expect(r.phaseEndsAt).toBeGreaterThan(limit);
    expect(
      status(() => word(r, "p_john", { word: "paint" }, limit + GRACE_MS)),
    ).toEqual([409, "That game is over."]);
  });

  it("hands the host on mid-game; the last one out closes it", () => {
    const r = room();
    join(r, "p_sam", T0);
    const t = playing(r);
    leave(r, "p_john", t + 1);
    expect(r.hostId).toBe("p_sam");
    expect(r.phase).toBe("playing");
    leave(r, "p_sam", t + 2);
    expect(r.phase).toBe("closed");
  });
});

function finishNow(r: Room): number {
  const due = deadline(r)!;
  advance(r, due, half);
  expect(r.phase).toBe("finished");
  return due;
}

describe("scoring", () => {
  it("scores by length", () => {
    expect(POINTS).toEqual({ 3: 1, 4: 2, 5: 4, 6: 6, 7: 10 });
  });

  it("a word only one player found scores double at the finish; shared words do not", () => {
    const r = room([
      { id: "p_sam", name: "Sam" },
      { id: "p_kit", name: "Kit" },
    ]);
    join(r, "p_sam", T0);
    join(r, "p_kit", T0);
    const t = playing(r);
    // John: paint (shared with Sam, 4) + painter (unique, 10) = 4 + 20
    // Sam:  paint (4) + pit (unique, 1) + pain (unique, 2)     = 4 + 2 + 4
    word(r, "p_john", { word: "paint" }, t);
    word(r, "p_john", { word: "painter" }, t);
    word(r, "p_sam", { word: "paint" }, t);
    word(r, "p_sam", { word: "pit" }, t);
    word(r, "p_sam", { word: "pain" }, t);

    const live = toWire(r, "p_kit", t);
    expect(live.players.map((p) => [p.id, p.score, p.wordCount])).toEqual([
      ["p_john", 14, 2],
      ["p_sam", 7, 3],
      ["p_kit", 0, 0],
    ]);

    finishNow(r);
    const w = toWire(r, "p_kit", t);
    expect(w.standings).toEqual([
      { id: "p_john", name: "John", score: 24, words: 2, longest: "painter" },
      { id: "p_sam", name: "Sam", score: 10, words: 3, longest: "paint" },
      { id: "p_kit", name: "Kit", score: 0, words: 0, longest: null },
    ]);
    expect(w.winnerIds).toEqual(["p_john"]);
    expect(w.players[0].words).toEqual([
      { word: "paint", points: 4, unique: false },
      { word: "painter", points: 20, unique: true },
    ]);
    expect(w.found).toEqual([
      { word: "painter", points: 10, finderIds: ["p_john"], unique: true },
      {
        word: "paint",
        points: 4,
        finderIds: ["p_john", "p_sam"],
        unique: false,
      },
      { word: "pain", points: 2, finderIds: ["p_sam"], unique: true },
      { word: "pit", points: 1, finderIds: ["p_sam"], unique: true },
    ]);
  });

  it("solo: no doubling, and nobody wins alone", () => {
    const r = room([]);
    const t = playing(r);
    word(r, "p_john", { word: "paint" }, t);
    finishNow(r);
    const w = toWire(r, "p_john", t);
    expect(w.standings).toEqual([
      { id: "p_john", name: "John", score: 4, words: 1, longest: "paint" },
    ]);
    expect(w.players[0].words).toEqual([
      { word: "paint", points: 4, unique: false },
    ]);
    expect(w.found![0].unique).toBe(false);
    expect(w.winnerIds).toEqual([]);
  });

  it("ties share, and nobody wins on nothing", () => {
    const r = room();
    join(r, "p_sam", T0);
    const t = playing(r);
    word(r, "p_john", { word: "pain" }, t);
    word(r, "p_sam", { word: "pint" }, t);
    finishNow(r);
    expect(toWire(r, "p_john", t).winnerIds).toEqual(["p_john", "p_sam"]);

    const r2 = room();
    join(r2, "p_sam", T0);
    playing(r2);
    finishNow(r2);
    expect(toWire(r2, "p_john", 0).winnerIds).toEqual([]);
  });

  it("a leaver's words still count against everyone else's uniqueness", () => {
    const r = room([
      { id: "p_sam", name: "Sam" },
      { id: "p_kit", name: "Kit" },
    ]);
    join(r, "p_sam", T0);
    join(r, "p_kit", T0);
    const t = playing(r);
    word(r, "p_john", { word: "paint" }, t);
    word(r, "p_sam", { word: "paint" }, t);
    leave(r, "p_sam", t + 1);
    finishNow(r);
    const w = toWire(r, "p_john", t);
    expect(w.players[0].words).toEqual([
      { word: "paint", points: 4, unique: false },
    ]);
    expect(w.standings!.map((s) => s.id)).toEqual(["p_john", "p_sam", "p_kit"]);
  });
});

describe("missed words", () => {
  it("leads with the seed if nobody found it, then the longest common words left", () => {
    const r = room([]);
    const t = playing(r);
    word(r, "p_john", { word: "pain" }, t);
    finishNow(r);
    const m = r.missed!;
    expect(m[0]).toBe("painter");
    expect(m.length).toBeLessThanOrEqual(5);
    expect(m).not.toContain("pain");
    for (let i = 2; i < m.length; i++)
      expect(m[i - 1].length).toBeGreaterThanOrEqual(m[i].length);
    const common = new Set(COMMON_WORDS);
    expect(m.every((w) => common.has(w) && fits(w, r.letters!))).toBe(true);
  });

  it("leaves out what was found, and short words on hard", () => {
    const r = room([], "hard");
    const t = playing(r);
    word(r, "p_john", { word: "painter" }, t);
    r.phase = "finished";
    const m = missedWords(r);
    expect(m).not.toContain("painter");
    expect(m.every((w) => w.length >= 4)).toBe(true);
  });
});

describe("again", () => {
  it("re-invites everyone who is not still here and clears the words and letters", () => {
    const r = room([
      { id: "p_sam", name: "Sam" },
      { id: "p_kit", name: "Kit" },
    ]);
    join(r, "p_sam", T0);
    const t = playing(r);
    word(r, "p_john", { word: "pain" }, t);
    expect(() => again(r, "p_john", t)).toThrow(/still going/);
    finishNow(r);
    expect(() => again(r, "p_sam", t)).toThrow(/Only the host/);
    again(r, "p_john", t);
    expect(r.phase).toBe("lobby");
    expect([r.seed, r.letters, r.missed, r.startedAt]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(r.players.map((p) => [p.id, p.status, p.words.length])).toEqual([
      ["p_john", "joined", 0],
      ["p_sam", "joined", 0],
      ["p_kit", "invited", 0],
    ]);
  });
});

describe("the wire", () => {
  it("shows my words, only counts and scores for everyone else, and no seed while playing", () => {
    const r = room();
    join(r, "p_sam", T0);
    const t = playing(r);
    word(r, "p_john", { word: "paint" }, t);
    word(r, "p_sam", { word: "pirate" }, t);
    const w = toWire(r, "p_john", t);
    expect(w.phase).toBe("playing");
    expect(w.letters).toEqual(r.letters);
    expect(w.phaseEndsAt).toBe(t + TUNING.easy.timeLimitMs);
    expect(w.minLength).toBe(3);
    expect(w.players[0].words).toEqual([
      { word: "paint", points: 4, unique: null },
    ]);
    expect(w.players[1]).toMatchObject({ wordCount: 1, score: 6, words: null });
    expect([w.seed, w.found, w.missed, w.standings]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(w.winnerIds).toEqual([]);
    expect(JSON.stringify(w)).not.toContain("pirate");
    expect(JSON.stringify(w)).not.toContain("painter");
    expect(JSON.stringify(toWire(r, "p_sam", t))).not.toContain('paint"');
  });

  it("reveals everything once the game is finished", () => {
    const r = room();
    join(r, "p_sam", T0);
    const t = playing(r);
    word(r, "p_john", { word: "paint" }, t);
    word(r, "p_sam", { word: "pirate" }, t);
    finishNow(r);
    const w = toWire(r, "p_john", t);
    expect(w.seed).toBe("painter");
    expect(w.players[1].words).toEqual([
      { word: "pirate", points: 12, unique: true },
    ]);
    expect(w.found!.map((f) => f.word)).toEqual(["pirate", "paint"]);
    expect(w.missed![0]).toBe("painter");
    expect(w.serverNow).toBe(t);
  });

  it("carries no letters before play", () => {
    const w = toWire(room(), "p_john", T0);
    expect(w.letters).toBeNull();
    expect(w.phaseEndsAt).toBe(T0 + LOBBY_MS);
  });
});
