import { describe, expect, it } from "vitest";
import {
  about,
  advance,
  again,
  answer,
  createRoom,
  deadline,
  dealCard,
  dealLetter,
  done,
  join,
  leave,
  normalise,
  roundOptions,
  start,
  startsWith,
  strikeAt,
  toWire,
  unveto,
  veto,
  COUNTDOWN_MS,
  FINISHED_MS,
  GRACE_MS,
  LETTERS,
  LOBBY_MS,
  MAX_ANSWER,
  REVIEW_MS,
  type Difficulty,
  type Room,
} from "./categories";
import { CATEGORIES } from "./words/categories";

const T0 = 1_790_000_000_000;
const half = () => 0.5;

const SAM = { id: "p_sam", name: "Sam" };
const KIM = { id: "p_kim", name: "Kim" };

function room(
  invite = [SAM],
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

/** Start, run the countdown down, and fix the letter and card so the test knows them. */
function playing(r: Room, letter = "b", categories?: string[]): number {
  for (const p of r.players) if (p.status === "invited") join(r, p.id, T0);
  start(r, "p_john", T0);
  advance(r, T0 + COUNTDOWN_MS, half);
  r.letter = letter;
  if (categories) {
    r.categories = [...categories];
    for (const p of r.players) p.answers = categories.map(() => "");
  }
  return T0 + COUNTDOWN_MS;
}

/** Past the limit and its grace: into the review (or the finish, alone). */
function timeUp(r: Room): number {
  const t = r.phaseEndsAt! + GRACE_MS;
  advance(r, t, half);
  return t;
}

function status(fn: () => void): [number, string] {
  try {
    fn();
  } catch (e) {
    return [(e as { status: number }).status, (e as Error).message];
  }
  return [0, ""];
}

const CARD = ["An animal", "A food", "A country"];

describe("the categories list", () => {
  it("is long, distinct and tidy", () => {
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(150);
    expect(new Set(CATEGORIES.map((c) => c.toLowerCase())).size).toBe(
      CATEGORIES.length,
    );
    for (const c of CATEGORIES) {
      expect(c).toBe(c.trim());
      expect(c).not.toMatch(/\.$/);
      expect(c[0]).toBe(c[0].toUpperCase());
    }
  });
});

describe("dealing", () => {
  it("deals from the difficulty's letters, never the last one", () => {
    expect(LETTERS.easy).not.toContain("q");
    expect(LETTERS.easy).not.toContain("z");
    expect(LETTERS.hard).not.toContain("x");
    expect(LETTERS.hard).toContain("q");
    for (const d of ["easy", "medium", "hard"] as const)
      for (let i = 0; i < 50; i++) {
        const l = dealLetter(d, Math.random, "b");
        expect(LETTERS[d]).toContain(l);
        expect(l).not.toBe("b");
      }
    // A clock stuck high still lands on a letter.
    expect(LETTERS.easy).toContain(dealLetter("easy", () => 0.999999, null));
  });

  it("deals distinct categories, and keeps the last card off the next", () => {
    for (const n of [6, 8, 10]) {
      const card = dealCard(n, Math.random);
      expect(card).toHaveLength(n);
      expect(new Set(card).size).toBe(n);
      for (const c of card) expect(CATEGORIES).toContain(c);
    }
    const first = dealCard(10, Math.random);
    const next = dealCard(10, Math.random, first);
    expect(next.some((c) => first.includes(c))).toBe(false);
    expect(dealCard(8, () => 0)).toHaveLength(8);
  });
});

describe("checking an answer", () => {
  it("reads past case, accents, punctuation and a leading article", () => {
    expect(normalise("  The   Beatles! ")).toBe("beatles");
    expect(normalise("an Owl")).toBe("owl");
    expect(normalise("Éclair")).toBe("eclair");
    expect(normalise("The")).toBe("the");
    expect(startsWith("The Beatles", "b")).toBe(true);
    expect(startsWith("A banana", "B")).toBe(true);
    expect(startsWith("Apple", "b")).toBe(false);
    expect(startsWith("Éclair", "e")).toBe(true);
    expect(startsWith("   ", "b")).toBe(false);
  });
});

describe("round options", () => {
  it("takes the host's pick and defaults the rest", () => {
    expect(roundOptions({ categoryCount: 10, seconds: 180 })).toEqual({
      count: 10,
      seconds: 180,
    });
    expect(roundOptions({ categoryCount: 7, seconds: 30 })).toEqual({
      count: 8,
      seconds: 120,
    });
    expect(roundOptions(undefined)).toEqual({ count: 8, seconds: 120 });
  });

  it("says what the round is on the invite", () => {
    expect(
      about(room(undefined, "easy", { categoryCount: 6, seconds: 90 })),
    ).toBe("6 categories · 90 seconds");
    expect(about(room())).toBe("8 categories · 2 minutes");
  });

  it("deals the card size picked and plays for the seconds picked", () => {
    const r = room(undefined, "easy", { categoryCount: 10, seconds: 180 });
    playing(r);
    expect(r.categories).toHaveLength(10);
    expect(r.players[0].answers).toEqual(Array(10).fill(""));
    expect(r.phaseEndsAt).toBe(T0 + COUNTDOWN_MS + 180_000);
    expect(deadline(r)).toBe(T0 + COUNTDOWN_MS + 180_000 + GRACE_MS);
  });
});

describe("play", () => {
  it("writes, overwrites and clears an answer, trimmed and capped", () => {
    const r = room();
    const t = playing(r, "b", CARD);
    answer(r, "p_john", { index: 0, text: "  Badger\n" }, t);
    expect(r.players[0].answers[0]).toBe("Badger");
    answer(r, "p_john", { index: 0, text: "Bear" }, t);
    expect(r.players[0].answers[0]).toBe("Bear");
    answer(r, "p_john", { index: 1, text: "b".repeat(100) }, t);
    expect(r.players[0].answers[1]).toHaveLength(MAX_ANSWER);
    answer(r, "p_john", { index: 1, text: "" }, t);
    expect(r.players[0].answers[1]).toBe("");
    // A wrong letter is kept: the review shows it.
    answer(r, "p_john", { index: 2, text: "France" }, t);
    expect(r.players[0].answers[2]).toBe("France");
  });

  it("refuses a slot off the card, a non-text answer, and a stranger", () => {
    const r = room();
    const t = playing(r, "b", CARD);
    for (const index of [-1, 3, 1.5, "0", NaN])
      expect(
        status(() => answer(r, "p_john", { index, text: "Bear" }, t)),
      ).toEqual([400, "That isn't one of the categories."]);
    expect(status(() => answer(r, "p_john", { index: 0, text: 7 }, t))[0]).toBe(
      400,
    );
    expect(
      status(() => answer(r, "p_nobody", { index: 0, text: "B" }, t))[0],
    ).toBe(403);
  });

  it("refuses answers before the deal", () => {
    const r = room();
    expect(
      status(() => answer(r, "p_john", { index: 0, text: "Bear" }, T0)),
    ).toEqual([409, "The game has not started."]);
  });

  it("closes the door after the limit and its grace", () => {
    const r = room();
    playing(r, "b", CARD);
    const end = r.phaseEndsAt!;
    answer(r, "p_john", { index: 0, text: "Bear" }, end + GRACE_MS - 1);
    expect(
      status(() =>
        answer(r, "p_john", { index: 1, text: "Bread" }, end + GRACE_MS + 1),
      ),
    ).toEqual([409, "Time's up."]);
    expect(advance(r, end + GRACE_MS, half)).toBe(true);
    expect(r.phase).toBe("review");
    expect(r.phaseEndsAt).toBe(end + GRACE_MS + REVIEW_MS);
  });

  it("does nothing on a clock that is not a number", () => {
    const r = room();
    playing(r, "b", CARD);
    for (const t of [NaN, Infinity, -Infinity])
      expect(advance(r, t, half)).toBe(false);
    expect(r.phase).toBe("playing");
  });

  it("goes straight to the finish when playing alone", () => {
    const r = room([]);
    const t = playing(r, "b", CARD);
    answer(r, "p_john", { index: 0, text: "Bear" }, t);
    timeUp(r);
    expect(r.phase).toBe("finished");
    expect(toWire(r, "p_john", T0).players[0].score).toBe(1);
  });
});

describe("the review", () => {
  function reviewing(invite = [SAM]) {
    const r = room(invite);
    const t = playing(r, "b", CARD);
    answer(r, "p_john", { index: 0, text: "Bear" }, t);
    answer(r, "p_john", { index: 1, text: "Banana" }, t);
    answer(r, "p_john", { index: 2, text: "France" }, t);
    answer(r, "p_sam", { index: 0, text: "the bear" }, t);
    answer(r, "p_sam", { index: 1, text: "Bogus" }, t);
    answer(r, "p_sam", { index: 2, text: "Brazil" }, t);
    return { r, t: timeUp(r) };
  }

  it("shows every answer judged: shared, wrong letter, empty, ok", () => {
    const { r, t } = reviewing();
    const w = toWire(r, "p_john", t);
    expect(w.phase).toBe("review");
    const john = w.players[0].answers!;
    expect(john.map((a) => a.status)).toEqual(["shared", "ok", "wrong-letter"]);
    const sam = w.players[1].answers!;
    expect(sam.map((a) => [a.text, a.status])).toEqual([
      ["the bear", "shared"],
      ["Bogus", "ok"],
      ["Brazil", "ok"],
    ]);
    expect(w.players.map((p) => p.score)).toEqual([1, 2]);
    expect(w.standings).toBeNull();
  });

  it("strikes an answer on the other player's veto, and takes it back", () => {
    const { r, t } = reviewing();
    expect(strikeAt(r, "p_sam")).toBe(1);
    veto(r, "p_john", { playerId: "p_sam", index: 1 }, t);
    let w = toWire(r, "p_john", t);
    expect(w.players[1].answers![1]).toMatchObject({
      status: "struck",
      points: 0,
      vetoes: 1,
      strikeAt: 1,
      vetoed: true,
    });
    // Sam sees the veto, not that Sam cast it.
    expect(toWire(r, "p_sam", t).players[1].answers![1].vetoed).toBe(false);
    unveto(r, "p_john", { playerId: "p_sam", index: 1 }, t);
    w = toWire(r, "p_john", t);
    expect(w.players[1].answers![1]).toMatchObject({ status: "ok", vetoes: 0 });
  });

  it("needs half the other players, rounded up, to strike", () => {
    const r = room([SAM, KIM, { id: "p_ali", name: "Ali" }]);
    const t = playing(r, "b", CARD);
    answer(r, "p_sam", { index: 0, text: "Bat" }, t);
    const t2 = timeUp(r);
    // Three others: two vetoes strike.
    expect(strikeAt(r, "p_sam")).toBe(2);
    veto(r, "p_john", { playerId: "p_sam", index: 0 }, t2);
    veto(r, "p_john", { playerId: "p_sam", index: 0 }, t2);
    expect(toWire(r, "p_john", t2).players[1].answers![0].status).toBe("ok");
    veto(r, "p_kim", { playerId: "p_sam", index: 0 }, t2);
    expect(toWire(r, "p_john", t2).players[1].answers![0].status).toBe(
      "struck",
    );
    // Kim leaves: Kim's veto goes, and so does one of the others — the bar is now 1.
    leave(r, "p_kim", t2);
    expect(strikeAt(r, "p_sam")).toBe(1);
    expect(toWire(r, "p_john", t2).players[1].answers![0]).toMatchObject({
      status: "struck",
      vetoes: 1,
    });
  });

  it("refuses a veto on your own answer, an empty one, or outside the review", () => {
    const r = room([SAM, KIM]);
    const t = playing(r, "b", CARD);
    answer(r, "p_sam", { index: 0, text: "Bat" }, t);
    expect(
      status(() => veto(r, "p_john", { playerId: "p_sam", index: 0 }, t)),
    ).toEqual([409, "Vetoes come after the clock."]);
    const t2 = timeUp(r);
    expect(
      status(() => veto(r, "p_sam", { playerId: "p_sam", index: 0 }, t2)),
    ).toEqual([400, "You can't veto your own answer."]);
    expect(
      status(() => veto(r, "p_john", { playerId: "p_sam", index: 1 }, t2)),
    ).toEqual([400, "There is nothing there to veto."]);
    expect(
      status(() => veto(r, "p_john", { playerId: "p_sam", index: 9 }, t2))[0],
    ).toBe(400);
    expect(
      status(() => veto(r, "p_john", { playerId: 3, index: 0 }, t2))[0],
    ).toBe(400);
  });

  it("ends early once everyone still in is done, and on its own clock otherwise", () => {
    const { r, t } = reviewing();
    done(r, "p_john", t);
    expect(r.phase).toBe("review");
    expect(toWire(r, "p_sam", t).players[0].done).toBe(true);
    done(r, "p_sam", t + 5);
    expect(r.phase).toBe("finished");
    expect(r.phaseEndsAt).toBe(t + 5 + FINISHED_MS);

    const other = reviewing().r;
    advance(other, other.phaseEndsAt!, half);
    expect(other.phase).toBe("finished");
  });

  it("ends when the last undecided player leaves", () => {
    const { r, t } = reviewing([SAM, KIM]);
    done(r, "p_john", t);
    done(r, "p_sam", t);
    leave(r, "p_kim", t);
    expect(r.phase).toBe("finished");
  });
});

describe("the finish", () => {
  it("scores a point an answer that is right, unshared and not struck", () => {
    const r = room();
    const t = playing(r, "b", CARD);
    answer(r, "p_john", { index: 0, text: "Bear" }, t);
    answer(r, "p_john", { index: 1, text: "Banana" }, t);
    answer(r, "p_john", { index: 2, text: "Belgium" }, t);
    answer(r, "p_sam", { index: 0, text: "BEAR" }, t);
    answer(r, "p_sam", { index: 1, text: "Burger" }, t);
    const t2 = timeUp(r);
    veto(r, "p_sam", { playerId: "p_john", index: 1 }, t2);
    advance(r, r.phaseEndsAt!, half);
    const w = toWire(r, "p_john", t2);
    expect(w.phase).toBe("finished");
    expect(w.players[0].answers!.map((a) => a.status)).toEqual([
      "shared",
      "struck",
      "ok",
    ]);
    expect(w.standings).toEqual([
      { id: "p_john", name: "John", score: 1, filled: 3 },
      { id: "p_sam", name: "Sam", score: 1, filled: 2 },
    ]);
    // A tie shares the win.
    expect(w.winnerIds).toEqual(["p_john", "p_sam"]);
    // Vetoes are over.
    expect(
      status(() => veto(r, "p_john", { playerId: "p_sam", index: 1 }, t2)),
    ).toEqual([409, "That game is over."]);
  });

  it("gives nobody the win on nothing", () => {
    const r = room();
    playing(r, "b", CARD);
    timeUp(r);
    advance(r, r.phaseEndsAt!, half);
    const w = toWire(r, "p_john", T0);
    expect(w.standings!.map((s) => s.score)).toEqual([0, 0]);
    expect(w.winnerIds).toEqual([]);
  });

  it("counts a leaver's answers against the others", () => {
    const r = room([SAM, KIM]);
    const t = playing(r, "b", CARD);
    answer(r, "p_sam", { index: 0, text: "Bear" }, t);
    answer(r, "p_kim", { index: 0, text: "Bear" }, t);
    leave(r, "p_kim", t);
    timeUp(r);
    advance(r, r.phaseEndsAt!, half);
    const w = toWire(r, "p_john", T0);
    expect(w.players.find((p) => p.id === "p_sam")!.answers![0].status).toBe(
      "shared",
    );
    expect(w.standings!.map((s) => s.id)).toContain("p_kim");
  });
});

describe("what a phone sees", () => {
  it("hides the card until play and the others' answers until the review", () => {
    const r = room();
    join(r, "p_sam", T0);
    const lobby = toWire(r, "p_john", T0);
    expect(lobby.letter).toBeNull();
    expect(lobby.categories).toBeNull();
    const t = playing(r, "b", CARD);
    answer(r, "p_sam", { index: 0, text: "Bat" }, t);
    answer(r, "p_john", { index: 1, text: "Bread" }, t);
    const w = toWire(r, "p_john", t);
    expect(w.letter).toBe("b");
    expect(w.categories).toEqual(CARD);
    expect(w.players[1]).toMatchObject({ filled: 1, answers: null, score: 0 });
    expect(w.players[0].answers!.map((a) => a.text)).toEqual(["", "Bread", ""]);
    expect(w.players[0].answers![1].status).toBeNull();
    expect(JSON.stringify(w)).not.toContain("Bat");
    expect(JSON.stringify(w)).not.toContain('vetoes":{');
  });
});

describe("the lobby", () => {
  it("runs the shared verbs, and plays again with the same round, a new letter and a new card", () => {
    const r = room(undefined, "medium", { categoryCount: 6, seconds: 90 });
    const t = playing(r, "b");
    const card = r.categories!;
    answer(r, "p_john", { index: 0, text: "Bear" }, t);
    const t2 = timeUp(r);
    veto(r, "p_sam", { playerId: "p_john", index: 0 }, t2);
    advance(r, r.phaseEndsAt!, half);
    again(r, "p_john", T0 + 1);
    expect(r).toMatchObject({
      phase: "lobby",
      letter: null,
      categories: null,
      vetoes: {},
      count: 6,
      seconds: 90,
      lastLetter: "b",
    });
    expect(r.players.every((p) => p.answers.length === 0 && !p.done)).toBe(
      true,
    );
    expect(r.phaseEndsAt).toBe(T0 + 1 + LOBBY_MS);
    start(r, "p_john", T0 + 2);
    advance(r, T0 + 2 + COUNTDOWN_MS, Math.random);
    expect(r.letter).not.toBe("b");
    expect(r.categories!.some((c) => card.includes(c))).toBe(false);
  });

  it("cancels when the host leaves the lobby", () => {
    const r = room();
    leave(r, "p_john", T0);
    expect(r.phase).toBe("closed");
  });
});
