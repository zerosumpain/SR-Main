import { describe, expect, it } from "vitest";
import {
  about,
  advance,
  again,
  createRoom,
  deadline,
  deal,
  isWord,
  join,
  leave,
  missedWords,
  neighbours,
  points,
  POINTS,
  MAX_LENGTH,
  roll,
  roundOptions,
  solve,
  spells,
  start,
  toWire,
  trace,
  word,
  COUNTDOWN_MS,
  GRACE_MS,
  LOBBY_MS,
  TUNING,
  type Difficulty,
  type Room,
} from "./boggle";
import { LONG_COMMON, LONG_RARE } from "./words/boggle";

const T0 = 1_790_000_000_000;
const half = () => 0.5;

/** A fixed board: "star" along the top, "stale" and "tales" through the middle, "quest" on the left. */
// s  t a r
// qu e l o
// n  d e s
// i  g h t
const BOARD = [
  "s",
  "t",
  "a",
  "r",
  "qu",
  "e",
  "l",
  "o",
  "n",
  "d",
  "e",
  "s",
  "i",
  "g",
  "h",
  "t",
];

function room(
  invite = [{ id: "p_sam", name: "Sam" }],
  difficulty: Difficulty = "easy",
  options: Record<string, unknown> = {},
): Room {
  return createRoom({
    id: "g_1",
    host: { id: "p_john", name: "John" },
    invite,
    difficulty,
    options,
    now: T0,
  });
}

/** Start, run the countdown down, and fix the board so the test knows it. */
function playing(r: Room, grid = BOARD): number {
  start(r, "p_john", T0);
  advance(r, T0 + COUNTDOWN_MS, half);
  r.grid = [...grid];
  r.solution = solve(grid, TUNING[r.difficulty].minLength);
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
  it("are 8–16 lowercase letters, without repeats, common and rare apart", () => {
    for (const list of [LONG_COMMON, LONG_RARE]) {
      expect(list.every((w) => /^[a-z]{8,16}$/.test(w))).toBe(true);
      expect(new Set(list).size).toBe(list.length);
    }
    const common = new Set(LONG_COMMON);
    expect(LONG_RARE.some((w) => common.has(w))).toBe(false);
  });

  it("accept short and long words, and keep the pruned ones out", () => {
    for (const w of ["star", "quest", "together", "understanding"])
      expect(isWord(w)).toBe(true);
    for (const w of ["bullshit", "motherfucker", "pornography"])
      expect(isWord(w)).toBe(false);
    // The screen must not take innocent words with it.
    for (const w of ["basement", "therapist", "scraping", "classroom"])
      expect(isWord(w)).toBe(true);
  });
});

describe("the board", () => {
  it("knows which tiles touch, diagonals included", () => {
    expect(neighbours(0, 4).sort((a, b) => a - b)).toEqual([1, 4, 5]);
    expect(neighbours(5, 4)).toHaveLength(8);
    expect(neighbours(35, 6).sort((a, b) => a - b)).toEqual([28, 29, 34]);
  });

  it("rolls one face of every die, for each size", () => {
    for (const size of [4, 5, 6] as const) {
      const grid = roll(size, Math.random);
      expect(grid).toHaveLength(size * size);
      expect(grid.every((f) => /^[a-z]{1,2}$/.test(f))).toBe(true);
    }
    expect(roll(4, Math.random).some((f) => f === "q")).toBe(false);
  });

  it("traces a word through touching tiles, and never reuses one", () => {
    expect(trace(BOARD, "star")).toEqual([0, 1, 2, 3]);
    // Two ways through the middle; either is a trace.
    expect(spells(BOARD, trace(BOARD, "tales")!, "tales")).toBe(true);
    expect(spells(BOARD, [1, 2, 6, 10, 11], "tales")).toBe(true);
    expect(spells(BOARD, trace(BOARD, "stale")!, "stale")).toBe(true);
    // No `s` touches the `r`; "sight" needs an `s` beside the `i`.
    expect(trace(BOARD, "stars")).toBeNull();
    expect(trace(BOARD, "sight")).toBeNull();
    // "tat" would need the one `t` twice.
    expect(trace(BOARD, "tat")).toBeNull();
  });

  it("reads a qu tile as two letters", () => {
    expect(trace(BOARD, "quest")).toEqual([4, 5, 0, 1]);
    expect(spells(BOARD, [4, 5, 0, 1], "quest")).toBe(true);
    expect(spells(BOARD, [4, 5, 0, 1], "qest")).toBe(false);
    expect(points("quest")).toBe(3);
  });

  it("refuses a path that jumps or doubles back", () => {
    expect(spells(BOARD, [0, 2], "sa")).toBe(false);
    expect(spells(BOARD, [0, 1, 0], "sts")).toBe(false);
    expect(spells(BOARD, [0, 99], "s")).toBe(false);
  });

  it("solves every word it holds, each with a path that spells it", () => {
    const all = solve(BOARD, 3);
    expect(all.length).toBeGreaterThan(10);
    for (const t of all) {
      expect(isWord(t.word)).toBe(true);
      expect(spells(BOARD, t.path, t.word)).toBe(true);
    }
    expect(all.map((t) => t.word)).toContain("star");
    expect(solve(BOARD, 4).every((t) => t.word.length >= 4)).toBe(true);
  });

  it("deals an easy board rich in words, and always ends", () => {
    for (const size of [4, 5, 6] as const) {
      const { grid, solution } = deal(size, "easy", Math.random);
      expect(grid).toHaveLength(size * size);
      expect(solution.length).toBeGreaterThan(TUNING.hard.floor[size]);
    }
    // A clock stuck on one roll still deals.
    expect(deal(4, "easy", () => 0).grid).toHaveLength(16);
  });

  it("scores by length, qu as two letters", () => {
    expect([2, 3, 4, 5, 6, 7, 8, 12].map((n) => points("a".repeat(n)))).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 10],
    );
    expect(points("quit")).toBe(2);
    // The wire table agrees with the rule for every length a board allows.
    for (let n = 3; n <= MAX_LENGTH; n++)
      expect(POINTS[n]).toBe(points("a".repeat(n)));
  });
});

describe("round options", () => {
  it("takes the host’s pick and defaults the rest", () => {
    expect(roundOptions({ size: 6, seconds: 30, scoring: "every" })).toEqual({
      size: 6,
      seconds: 30,
      scoring: "every",
    });
    expect(roundOptions({ size: 7, seconds: 60, scoring: "x" })).toEqual({
      size: 4,
      seconds: 120,
      scoring: "classic",
    });
    expect(roundOptions(undefined)).toEqual({
      size: 4,
      seconds: 120,
      scoring: "classic",
    });
  });

  it("says what the round is on the invite", () => {
    expect(about(room(undefined, "easy", { size: 5, seconds: 120 }))).toBe(
      "5×5 · 2 minutes",
    );
    expect(
      about(
        room(undefined, "easy", { size: 4, seconds: 30, scoring: "every" }),
      ),
    ).toBe("4×4 · 30 seconds · every word counts");
  });

  it("plays for the seconds picked", () => {
    const r = room(undefined, "easy", { seconds: 90 });
    start(r, "p_john", T0);
    advance(r, T0 + COUNTDOWN_MS, Math.random);
    expect(r.phaseEndsAt).toBe(T0 + COUNTDOWN_MS + 90_000);
    expect(deadline(r)).toBe(T0 + COUNTDOWN_MS + 90_000 + GRACE_MS);
  });
});

describe("play", () => {
  it("takes a word, by path or by search, and refuses the rest for free", () => {
    const r = room();
    join(r, "p_sam", T0);
    const t = playing(r);
    word(r, "p_john", { word: "star", path: [0, 1, 2, 3] }, t);
    word(r, "p_john", { word: "STALE" }, t);
    expect(r.players[0].words.map((f) => f.word)).toEqual(["star", "stale"]);
    expect(status(() => word(r, "p_john", { word: "star" }, t))).toEqual([
      409,
      "You already have that one.",
    ]);
    expect(status(() => word(r, "p_john", { word: "st" }, t))[0]).toBe(400);
    expect(status(() => word(r, "p_john", { word: "zebra" }, t))).toEqual([
      400,
      "That word isn't on the board.",
    ]);
    // A bad path is not trusted, but the word is still looked for.
    word(r, "p_sam", { word: "star", path: [3, 2, 1, 0] }, t);
    expect(r.players[1].words[0].path).toEqual([0, 1, 2, 3]);
  });

  it("asks for four letters on hard", () => {
    const r = room(undefined, "hard");
    const t = playing(r);
    expect(status(() => word(r, "p_john", { word: "tar" }, t))).toEqual([
      400,
      "Words need at least 4 letters on hard.",
    ]);
  });

  it("closes the door after the limit and its grace", () => {
    const r = room();
    const t = playing(r);
    const end = r.phaseEndsAt!;
    word(r, "p_john", { word: "star" }, end + GRACE_MS - 1);
    expect(
      status(() => word(r, "p_john", { word: "stale" }, end + GRACE_MS + 1)),
    ).toEqual([409, "Time's up."]);
    expect(advance(r, end + GRACE_MS, half)).toBe(true);
    expect(r.phase).toBe("finished");
    expect(t).toBeLessThan(end);
  });
});

describe("the finish", () => {
  function finished(scoring: "classic" | "every") {
    const r = room(undefined, "easy", { scoring });
    join(r, "p_sam", T0);
    const t = playing(r);
    word(r, "p_john", { word: "star" }, t);
    word(r, "p_john", { word: "stale" }, t);
    word(r, "p_sam", { word: "star" }, t);
    advance(r, r.phaseEndsAt! + GRACE_MS, half);
    return r;
  }

  it("crosses out a shared word under classic scoring", () => {
    const w = toWire(finished("classic"), "p_john", T0);
    const mine = w.players[0].words!;
    expect(mine.find((s) => s.word === "star")).toMatchObject({
      points: 0,
      shared: true,
    });
    expect(mine.find((s) => s.word === "stale")).toMatchObject({
      points: 3,
      shared: false,
    });
    expect(w.standings!.map((s) => [s.id, s.score])).toEqual([
      ["p_john", 3],
      ["p_sam", 0],
    ]);
    expect(w.winnerIds).toEqual(["p_john"]);
    expect(w.found!.find((f) => f.word === "star")).toMatchObject({
      points: 0,
      shared: true,
      finderIds: ["p_john", "p_sam"],
    });
  });

  it("counts every word when the host said so", () => {
    const w = toWire(finished("every"), "p_john", T0);
    expect(w.standings!.map((s) => s.score)).toEqual([5, 2]);
  });

  it("never crosses out a word played solo", () => {
    const r = room([]);
    const t = playing(r);
    word(r, "p_john", { word: "star" }, t);
    advance(r, r.phaseEndsAt! + GRACE_MS, half);
    expect(toWire(r, "p_john", T0).players[0].score).toBe(2);
  });

  it("shows the best words nobody found, with how to trace them, and what the board held", () => {
    const r = finished("classic");
    const missed = missedWords(r);
    expect(missed.length).toBeGreaterThan(0);
    expect(missed.map((m) => m.word)).not.toContain("star");
    for (const m of missed) expect(spells(BOARD, m.path, m.word)).toBe(true);
    const w = toWire(r, "p_john", T0);
    expect(w.possible!.words).toBe(r.solution!.length);
    expect(w.missed![0]).toHaveProperty("points");
  });
});

describe("what a phone sees", () => {
  it("hides the board until play and the others’ words until the finish", () => {
    const r = room();
    join(r, "p_sam", T0);
    expect(toWire(r, "p_john", T0).grid).toBeNull();
    const t = playing(r);
    word(r, "p_sam", { word: "star" }, t);
    const w = toWire(r, "p_john", t);
    expect(w.grid).toHaveLength(16);
    expect(w.players[1]).toMatchObject({ wordCount: 1, score: 2, words: null });
    expect(w.found).toBeNull();
    expect(w.missed).toBeNull();
    expect(w.possible).toBeNull();
    expect(JSON.stringify(w)).not.toContain("solution");
  });
});

describe("the lobby", () => {
  it("runs the shared verbs, and plays again with the same round and a fresh roll", () => {
    const r = room(undefined, "medium", { size: 6, seconds: 180 });
    join(r, "p_sam", T0);
    const t = playing(r);
    word(r, "p_john", { word: "star" }, t);
    advance(r, r.phaseEndsAt! + GRACE_MS, half);
    again(r, "p_john", T0 + 1);
    expect(r).toMatchObject({
      phase: "lobby",
      grid: null,
      solution: null,
      size: 6,
      seconds: 180,
    });
    expect(r.players.every((p) => p.words.length === 0)).toBe(true);
    expect(r.phaseEndsAt).toBe(T0 + 1 + LOBBY_MS);
  });

  it("cancels when the host leaves the lobby", () => {
    const r = room();
    leave(r, "p_john", T0);
    expect(r.phase).toBe("closed");
  });
});
