import { describe, expect, it } from "vitest";
import {
  about,
  advance,
  again,
  clear,
  createRoom,
  deadline,
  dealChoices,
  guess,
  hintOf,
  join,
  leave,
  normalise,
  pick,
  roundOptions,
  start,
  stroke,
  toWire,
  undo,
  withinOne,
  COUNTDOWN_MS,
  GUESS_GAP_MS,
  MAX_LOG,
  MAX_POINTS,
  MAX_POST_POINTS,
  PICK_MS,
  REVEAL_MS,
  type Room,
} from "./draw-guess";
import { ALL_WORDS, EASY, HARD, MEDIUM } from "./words/draw-guess";

const T0 = 1_790_000_000_000;
const first = () => 0;

const john = { id: "p_john", name: "John" };
const sam = { id: "p_sam", name: "Sam" };
const kim = { id: "p_kim", name: "Kim" };

/** A room of John (host), Sam and Kim, started and counted down: John is picking. */
function picking(
  options: Record<string, unknown> = {},
  people = [sam, kim],
): Room {
  const room = createRoom({
    id: "g_1",
    host: john,
    invite: people,
    difficulty: "easy",
    options,
    now: T0,
  });
  for (const p of people) join(room, p.id, T0);
  start(room, john.id, T0);
  advance(room, T0 + COUNTDOWN_MS, first);
  return room;
}

/** …and John has picked `word` (forced, so a test knows it). */
function drawing(word = "apple", options: Record<string, unknown> = {}): Room {
  const room = picking(options);
  room.turn!.choices[0] = { word, reveal: [0, word.length - 1] };
  pick(room, john.id, { index: 0 }, T0 + COUNTDOWN_MS + 1_000);
  return room;
}

const at = (room: Room) => room.turn!.startedAt!;
const line = (n: number, y = 500): [number, number][] =>
  Array.from({ length: n }, (_, i) => [i % 1000, y]);

describe("the word list", () => {
  it("holds 300+ distinct lowercase words over three tiers", () => {
    expect(ALL_WORDS.length).toBeGreaterThanOrEqual(300);
    expect(new Set(ALL_WORDS).size).toBe(ALL_WORDS.length);
    for (const w of ALL_WORDS) expect(w).toMatch(/^[a-z]+( [a-z]+)*$/);
    expect(EASY.length).toBeGreaterThan(100);
    expect(MEDIUM.length).toBeGreaterThan(80);
    expect(HARD.length).toBeGreaterThan(60);
  });

  it("deals three different words with two letters to give away (none for short words)", () => {
    const choices = dealChoices("easy", new Set(), Math.random);
    expect(choices).toHaveLength(3);
    expect(new Set(choices.map((c) => c.word)).size).toBe(3);
    for (const c of choices) {
      const letters = c.word.replace(/ /g, "").length;
      expect(c.reveal).toHaveLength(letters > 3 ? 2 : 0);
      for (const i of c.reveal) expect(c.word[i]).toMatch(/[a-z]/);
    }
  });

  it("never deals a word already used this game", () => {
    const used = new Set(EASY.slice(0, EASY.length - 3));
    const words = dealChoices("easy", used, Math.random).map((c) => c.word);
    expect(words.sort()).toEqual(EASY.slice(-3).slice().sort());
  });
});

describe("guess matching", () => {
  it("normalises case, accents, spaces, a leading article and a plural s", () => {
    expect(normalise("  The   Apples ")).toBe("apple");
    expect(normalise("an ÉCLAIR")).toBe("eclair");
    expect(normalise("Ice-Cream!")).toBe("ice cream");
    expect(normalise("glass")).toBe("glass");
    expect(normalise("bus")).toBe("bus");
  });

  it("tells one letter off from two", () => {
    expect(withinOne("aple", "apple")).toBe(true);
    expect(withinOne("applle", "apple")).toBe(true);
    expect(withinOne("apxle", "apple")).toBe(true);
    expect(withinOne("axxle", "apple")).toBe(false);
    expect(withinOne("app", "apple")).toBe(false);
  });

  it("shows blanks with spaces kept and given-away letters in place", () => {
    expect(hintOf("ice cream", [])).toBe("___ _____");
    expect(hintOf("ice cream", [4])).toBe("___ c____");
  });
});

describe("lobby", () => {
  it("takes the host's options, defaulting what is unknown", () => {
    expect(roundOptions({ turnsEach: 2, seconds: 60 })).toEqual({
      turnsEach: 2,
      seconds: 60,
    });
    expect(roundOptions({ turnsEach: 3, seconds: 120 })).toEqual({
      turnsEach: 1,
      seconds: 80,
    });
    const room = createRoom({
      id: "g",
      host: john,
      invite: [],
      difficulty: "easy",
      options: { turnsEach: 2 },
      now: T0,
    });
    expect(about(room)).toBe("80 seconds a drawing · twice round");
  });

  it("will not start alone", () => {
    const room = createRoom({
      id: "g",
      host: john,
      invite: [sam],
      difficulty: "easy",
      now: T0,
    });
    expect(() => start(room, john.id, T0)).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    join(room, sam.id, T0);
    start(room, john.id, T0);
    expect(room.phase).toBe("countdown");
    expect(room.order).toEqual([john.id, sam.id]);
  });

  it("goes round twice when asked", () => {
    const room = picking({ turnsEach: 2 });
    expect(room.order).toEqual([
      john.id,
      sam.id,
      kim.id,
      john.id,
      sam.id,
      kim.id,
    ]);
  });
});

describe("picking", () => {
  it("offers the words to the drawer only", () => {
    const room = picking();
    expect(room.phase).toBe("picking");
    const mine = toWire(room, john.id, T0);
    const theirs = toWire(room, sam.id, T0);
    expect(mine.turn!.choices).toHaveLength(3);
    expect(theirs.turn!.choices).toBeNull();
    expect(theirs.turn!.word).toBeNull();
    expect(() => pick(room, sam.id, { index: 0 }, T0)).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(() => pick(room, john.id, { index: 3 }, T0)).toThrow(
      expect.objectContaining({ status: 400 }),
    );
  });

  it("takes the first word when the drawer does not pick in time", () => {
    const room = picking();
    const word = room.turn!.choices[0].word;
    const due = deadline(room)!;
    expect(due).toBe(T0 + COUNTDOWN_MS + PICK_MS);
    expect(advance(room, due, first)).toBe(true);
    expect(room.phase).toBe("drawing");
    expect(room.turn!.word).toBe(word);
    expect(room.used).toContain(word);
  });
});

describe("never leaking the word", () => {
  it("keeps the word and choices out of an unsolved guesser's wire until the reveal", () => {
    const room = picking();
    const secret = room.turn!.choices.map((c) => c.word);
    const leaks = (w: unknown) =>
      secret.some((s) =>
        JSON.stringify({ ...(w as object), palette: null }).includes(`"${s}"`),
      );
    expect(leaks(toWire(room, sam.id, T0))).toBe(false);
    pick(room, john.id, { index: 1 }, T0 + 4_000);
    const word = room.turn!.word!;
    const contains = (w: unknown) =>
      JSON.stringify({ ...(w as object), palette: null }).includes(word);
    expect(contains(toWire(room, john.id, T0))).toBe(true);
    // Through the whole drawing, hints and all, right up to the end.
    for (const t of [0, 0.5, 0.75, 0.99]) {
      const now = at(room) + t * 80_000;
      advance(room, now, first);
      expect(room.phase).toBe("drawing");
      expect(contains(toWire(room, sam.id, now))).toBe(false);
    }
    advance(room, at(room) + 80_000, first);
    expect(room.phase).toBe("reveal");
    expect(toWire(room, sam.id, T0).turn!.word).toBe(word);
  });

  it("never shows a right guess to anyone else, nor a close one", () => {
    const room = drawing("apple");
    const t = at(room);
    guess(room, sam.id, { text: "aple" }, t + 1_000);
    guess(room, sam.id, { text: "The Apples" }, t + 2_000);
    const kimSees = toWire(room, kim.id, t + 2_000);
    expect(JSON.stringify(kimSees)).not.toContain("apple");
    expect(JSON.stringify(kimSees)).not.toContain("aple");
    expect(kimSees.turn!.feed.map((f) => [f.name, f.kind, f.text])).toEqual([
      ["Sam", "solved", null],
    ]);
    const samSees = toWire(room, sam.id, t + 2_000);
    expect(samSees.turn!.feed.map((f) => [f.kind, f.text])).toEqual([
      ["close", "aple"],
      ["solved", null],
    ]);
    // Having got it, Sam may see the word.
    expect(samSees.turn!.word).toBe("apple");
  });
});

describe("guessing and scoring", () => {
  it("puts wrong guesses in the feed, rate-limits, and refuses the drawer and solvers", () => {
    const room = drawing("apple");
    const t = at(room);
    guess(room, sam.id, { text: "pear" }, t + 1_000);
    expect(() =>
      guess(room, sam.id, { text: "plum" }, t + 1_000 + GUESS_GAP_MS - 1),
    ).toThrow(expect.objectContaining({ status: 409 }));
    guess(room, sam.id, { text: "plum" }, t + 1_000 + GUESS_GAP_MS);
    expect(toWire(room, kim.id, t).turn!.feed.map((f) => f.text)).toEqual([
      "pear",
      "plum",
    ]);
    expect(() => guess(room, john.id, { text: "apple" }, t + 5_000)).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    expect(() => guess(room, sam.id, { text: "" }, t + 5_000)).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    guess(room, sam.id, { text: "apple" }, t + 6_000);
    expect(() => guess(room, sam.id, { text: "apple" }, t + 8_000)).toThrow(
      expect.objectContaining({ status: 409 }),
    );
  });

  it("scores guessers by order and the drawer per solver, and ends early when all have it", () => {
    const room = drawing("apple");
    const t = at(room);
    guess(room, kim.id, { text: "apple" }, t + 1_000);
    expect(room.phase).toBe("drawing");
    guess(room, sam.id, { text: "APPLE" }, t + 2_000);
    expect(room.phase).toBe("reveal");
    expect(room.turn!.ended).toBe("solved");
    const score = (id: string) => room.players.find((p) => p.id === id)!.score;
    expect([score(kim.id), score(sam.id), score(john.id)]).toEqual([5, 4, 4]);
    expect(room.phaseEndsAt).toBe(t + 2_000 + REVEAL_MS);
    const wire = toWire(room, sam.id, t + 2_000);
    expect(wire.turn!.solvers).toEqual([
      { id: kim.id, points: 5 },
      { id: sam.id, points: 4 },
    ]);
    expect(wire.turn!.drawerPoints).toBe(4);
  });

  it("gives the drawer nothing when nobody gets it", () => {
    const room = drawing("apple");
    advance(room, at(room) + 80_000, first);
    expect(room.phase).toBe("reveal");
    expect(room.turn!.drawerPoints).toBe(0);
  });

  it("gives letters away at half and three-quarter time, as their own pushes", () => {
    const room = drawing("apple");
    const t = at(room);
    expect(toWire(room, sam.id, t).turn!.hint).toBe("_____");
    expect(deadline(room)).toBe(t + 40_000);
    expect(advance(room, t + 40_000, first)).toBe(true);
    expect(toWire(room, sam.id, t).turn!.hint).toBe("a____");
    expect(deadline(room)).toBe(t + 60_000);
    advance(room, t + 60_000, first);
    expect(toWire(room, sam.id, t).turn!.hint).toBe("a___e");
    expect(deadline(room)).toBe(t + 80_000);
  });

  it("gives nothing away for a three-letter word", () => {
    const room = picking();
    room.turn!.choices[0] = { word: "cat", reveal: [] };
    pick(room, john.id, { index: 0 }, T0 + 5_000);
    expect(deadline(room)).toBe(at(room) + 80_000);
  });

  it("plays every turn, then finishes with standings (ties in seat order)", () => {
    const room = drawing("apple");
    guess(room, sam.id, { text: "apple" }, at(room) + 1_000);
    guess(room, kim.id, { text: "apple" }, at(room) + 2_000);
    // Sam draws next, Kim after; nobody gets either.
    let now = room.phaseEndsAt!;
    for (const drawer of [sam.id, kim.id]) {
      advance(room, now, first);
      expect(room.phase).toBe("picking");
      expect(room.turn!.drawerId).toBe(drawer);
      expect(room.used).not.toContain(room.turn!.choices[0].word);
      now = room.phaseEndsAt!;
      advance(room, now, first);
      now = room.phaseEndsAt!;
      advance(room, now, first);
      expect(room.phase).toBe("reveal");
      now = room.phaseEndsAt!;
    }
    advance(room, now, first);
    expect(room.phase).toBe("finished");
    const wire = toWire(room, john.id, now);
    expect(wire.standings!.map((s) => [s.id, s.score])).toEqual([
      [sam.id, 5],
      [john.id, 4],
      [kim.id, 4],
    ]);
    expect(wire.winnerIds).toEqual([sam.id]);
    expect(new Set(room.used).size).toBe(3);
  });
});

describe("leaving", () => {
  it("a drawer leaving ends their turn with no drawer points", () => {
    const room = drawing("apple");
    guess(room, sam.id, { text: "apple" }, at(room) + 1_000);
    leave(room, john.id, at(room) + 2_000);
    expect(room.phase).toBe("reveal");
    expect(room.turn!.ended).toBe("left");
    expect(room.turn!.drawerPoints).toBe(0);
    expect(room.hostId).toBe(sam.id);
    // The next turn skips John.
    advance(room, room.phaseEndsAt!, first);
    expect(room.turn!.drawerId).toBe(sam.id);
  });

  it("a drawer leaving in the pick reveals the first word", () => {
    const room = picking();
    leave(room, john.id, T0 + 5_000);
    expect(room.phase).toBe("reveal");
    expect(toWire(room, sam.id, T0).turn!.word).toBe(
      room.turn!.choices[0].word,
    );
  });

  it("finishes when fewer than two are left", () => {
    const room = drawing("apple");
    leave(room, sam.id, at(room) + 1_000);
    expect(room.phase).toBe("drawing");
    leave(room, kim.id, at(room) + 2_000);
    expect(room.phase).toBe("finished");
  });

  it("ends early when the last unsolved guesser leaves", () => {
    const room = drawing("apple");
    guess(room, sam.id, { text: "apple" }, at(room) + 1_000);
    leave(room, kim.id, at(room) + 2_000);
    expect(room.phase).toBe("reveal");
    expect(room.turn!.ended).toBe("solved");
  });
});

describe("the clock", () => {
  it("ignores a clock that is not a number", () => {
    const room = drawing();
    expect(advance(room, NaN, first)).toBe(false);
    expect(advance(room, Infinity, first)).toBe(false);
    expect(room.phase).toBe("drawing");
  });

  it("takes one step per call on a stale clock, timing the next phase from now", () => {
    const room = picking();
    const late = T0 + 10 * 60_000;
    advance(room, late, first);
    expect(room.phase).toBe("drawing");
    expect(room.phaseEndsAt).toBe(late + 80_000);
    // A second call at the same instant has nothing due.
    expect(advance(room, late, first)).toBe(false);
  });
});

describe("drawing", () => {
  it("appends to a stroke by id, undoes the last, clears, and only for the drawer", () => {
    const room = drawing();
    const t = at(room);
    stroke(
      room,
      john.id,
      {
        id: 1,
        color: "red",
        width: 6,
        points: [
          [0, 0],
          [10.4, 2000],
        ],
      },
      t,
    );
    stroke(
      room,
      john.id,
      { id: 1, color: "blue", width: 32, points: [[20, -5]] },
      t,
    );
    stroke(
      room,
      john.id,
      { id: 2, color: "white", width: 32, points: [[1, 1]] },
      t,
    );
    expect(room.drawing.strokes).toEqual([
      {
        id: 1,
        color: "red",
        width: 6,
        points: [
          [0, 0],
          [10, 1000],
          [20, 0],
        ],
      },
      { id: 2, color: "white", width: 32, points: [[1, 1]] },
    ]);
    undo(room, john.id, t);
    expect(room.drawing.strokes.map((s) => s.id)).toEqual([1]);
    clear(room, john.id, t);
    expect(room.drawing.strokes).toEqual([]);
    expect(() =>
      stroke(
        room,
        sam.id,
        { id: 3, color: "red", width: 6, points: [[1, 1]] },
        t,
      ),
    ).toThrow(expect.objectContaining({ status: 403 }));
  });

  it("validates colour, width, points and the caps", () => {
    const room = drawing();
    const t = at(room);
    const bad = (input: Record<string, unknown>) =>
      expect(() =>
        stroke(
          room,
          john.id,
          {
            id: 1,
            color: "red",
            width: 6,
            points: [[1, 1]],
            ...input,
          } as never,
          t,
        ),
      ).toThrow(expect.objectContaining({ status: 400 }));
    bad({ color: "pink" });
    bad({ width: 7 });
    bad({ points: [] });
    bad({ points: [[1, "2"]] });
    bad({ points: [[1, NaN]] });
    bad({ points: line(MAX_POST_POINTS + 1) });
    bad({ id: -1 });
    for (let i = 0; i < MAX_POINTS / MAX_POST_POINTS - 1; i++)
      stroke(
        room,
        john.id,
        { id: i, color: "black", width: 6, points: line(MAX_POST_POINTS) },
        t,
      );
    expect(() =>
      stroke(
        room,
        john.id,
        { id: 999, color: "black", width: 6, points: line(MAX_POST_POINTS) },
        t,
      ),
    ).toThrow(expect.objectContaining({ status: 409 }));
    undo(room, john.id, t);
    stroke(
      room,
      john.id,
      { id: 999, color: "black", width: 6, points: line(MAX_POST_POINTS) },
      t,
    );
  });

  it("sends only the changes after `since`, and the whole drawing when that is too old", () => {
    const room = drawing();
    const t = at(room);
    const full = toWire(room, sam.id, t);
    expect(full.drawing).toMatchObject({ since: null, strokes: [], ops: null });
    const held = full.drawing!.revision;
    stroke(
      room,
      john.id,
      { id: 1, color: "red", width: 6, points: [[1, 1]] },
      t,
    );
    stroke(
      room,
      john.id,
      { id: 1, color: "red", width: 6, points: [[2, 2]] },
      t,
    );
    undo(room, john.id, t);
    const delta = toWire(room, sam.id, t, held);
    expect(delta.drawing).toEqual({
      revision: held + 3,
      since: held,
      strokes: null,
      ops: [
        {
          seq: held + 1,
          op: "stroke",
          id: 1,
          color: "red",
          width: 6,
          points: [[1, 1]],
        },
        {
          seq: held + 2,
          op: "stroke",
          id: 1,
          color: "red",
          width: 6,
          points: [[2, 2]],
        },
        { seq: held + 3, op: "undo" },
      ],
    });
    expect(toWire(room, sam.id, t, held + 3).drawing!.ops).toEqual([]);
    // From before this drawing, from the future, or not a number: the whole thing.
    expect(toWire(room, sam.id, t, held - 1).drawing!.since).toBeNull();
    expect(toWire(room, sam.id, t, held + 99).drawing!.since).toBeNull();
    // Past the log's reach.
    for (let i = 0; i < MAX_LOG + 5; i++) {
      stroke(
        room,
        john.id,
        { id: 50, color: "red", width: 6, points: [[3, 3]] },
        t,
      );
      undo(room, john.id, t);
    }
    expect(toWire(room, sam.id, t, held + 3).drawing!.since).toBeNull();
    expect(room.drawing.log).toHaveLength(MAX_LOG);
  });

  it("starts each turn's drawing afresh, and a cursor from the last one gets the whole (empty) drawing", () => {
    const room = drawing();
    const t = at(room);
    stroke(
      room,
      john.id,
      { id: 1, color: "red", width: 6, points: [[1, 1]] },
      t,
    );
    const held = room.revision;
    advance(room, room.phaseEndsAt!, first);
    // The drawing stays up through the reveal.
    expect(toWire(room, sam.id, t, held).drawing!.ops).toEqual([]);
    advance(room, room.phaseEndsAt!, first);
    expect(room.phase).toBe("picking");
    expect(toWire(room, sam.id, t, held).drawing).toMatchObject({
      since: null,
      strokes: [],
    });
  });

  // The numbers in the PR body come from here.
  it("measures the wire: the whole drawing at its cap against one batch as changes", () => {
    const room = drawing();
    const t = at(room);
    const size = (w: unknown) =>
      Buffer.byteLength(
        `data: ${JSON.stringify({ type: "room", room: w })}\n\n`,
      );
    // Worst case: every point three digits on both axes.
    const heavy = (i: number, n: number): [number, number][] =>
      Array.from({ length: n }, (_, k) => [
        100 + ((k * 7 + i) % 900),
        100 + ((k * 13 + i) % 900),
      ]);
    const batch = 12; // ~200 ms of a finger moving, after simplification
    let id = 0;
    while (
      MAX_POINTS -
        room.drawing.strokes.reduce((n, s) => n + s.points.length, 0) >
      batch
    ) {
      const left =
        MAX_POINTS -
        batch -
        room.drawing.strokes.reduce((n, s) => n + s.points.length, 0);
      stroke(
        room,
        john.id,
        {
          id: id++,
          color: "purple",
          width: 14,
          points: heavy(id, Math.min(MAX_POST_POINTS, left)),
        },
        t,
      );
    }
    const held = room.revision;
    stroke(
      room,
      john.id,
      { id: id - 1, color: "purple", width: 14, points: heavy(1, batch) },
      t,
    );
    expect(room.drawing.strokes.reduce((n, s) => n + s.points.length, 0)).toBe(
      MAX_POINTS,
    );
    const whole = size(toWire(room, sam.id, t));
    const change = size(toWire(room, sam.id, t, held));
    const empty = size(toWire(room, sam.id, t, room.revision));
    // A phone is pushed once per change to the room: the drawer's batches (~5/s at
    // 200 ms) plus guesses (each guesser at most 1 per 700 ms: ~5.7/s for four).
    const pushesPerSecond = 1000 / 200 + 4 * (1000 / GUESS_GAP_MS);
    console.info(
      `[draw-guess wire] whole drawing at ${MAX_POINTS} points: ${whole} B/push; ` +
        `one ${batch}-point batch as changes: ${change} B; no drawing change: ${empty} B; ` +
        `~${pushesPerSecond.toFixed(1)} pushes/s/phone → whole ${((whole * pushesPerSecond) / 1024).toFixed(0)} KiB/s ` +
        `vs changes ${((change * pushesPerSecond) / 1024).toFixed(1)} KiB/s per phone`,
    );
    expect(whole).toBeGreaterThan(40_000);
    expect(change).toBeLessThan(2_500);
    expect(empty).toBeLessThan(2_000);
  });
});
